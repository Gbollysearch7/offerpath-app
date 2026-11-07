import "server-only";
import { z } from "zod";
import { buildClaimInventory, withoutInstructions, type ClaimInventory } from "@/lib/analysis/claims";
import { judgmentFromLine, ruleRewrite } from "@/lib/analysis/cv";
import { ALREADY_STRONG, checkRewrite, confirmationsNeeded, withPlaceholders, type RewriteCheck, type RewriteIssue } from "@/lib/analysis/rewrite-check";
import { log } from "@/lib/log";
import { AI_LIMITS, type Repo } from "@/lib/repo/types";
import type { CvReviewPayload, LineResult } from "@/lib/types";

// OP-015: the logic behind the rewriteLine and acceptRewrite actions. A suggestion reaches the report only after
// checkRewrite has read it, whoever wrote it. The server actions add the session and revalidation; the tests call
// these directly against both repositories with a simulated provider, so no model is ever called.

/** Writes one rewrite. Null means it could not (no key, a provider error, a refusal). May also throw or return junk: it is treated as untrusted. */
export type RewriteProvider = (line: string, context: { role: string; sector: string; previous?: string }) => Promise<unknown>;

export interface RewriteResult {
  rewrite?: string;
  ai?: boolean;
  left?: number;
  check?: RewriteCheck;
  /** Why the student is seeing this version rather than what was generated. */
  note?: string;
  error?: string;
}

const NOT_FOUND = "We couldn't find that line.";
const Output = z.string().trim().min(1).max(2_000);
const Index = z.number().int().min(0).max(1_000);

const describe = (issues: RewriteIssue[]) => {
  const blocks = issues.filter((i) => i.severity === "block");
  const named = blocks.map((i) => i.found).filter(Boolean).slice(0, 3);
  return named.length ? named.map((n) => `"${n}"`).join(", ") : "wording";
};

/** The rule engine's next suggestion that needs nothing confirmed; failing that, the source line, which claims nothing new. */
function safeRuleSuggestion(inv: ClaimInventory, index: number, line: LineResult, variant: number, avoid?: string): { text: string; check: RewriteCheck } {
  const judgment = judgmentFromLine(line);
  let fallback: { text: string; check: RewriteCheck } | null = null;
  // Enough tries to go round the verb and ending lists once.
  for (let v = variant; v < variant + 12; v++) {
    const text = ruleRewrite(line.text, v, judgment, index);
    const check = checkRewrite(inv, { index, text: line.text }, text);
    if (check.verdict === "block" || text === avoid) continue;
    if (check.verdict === "pass") return { text, check };
    fallback ??= { text, check };
  }
  if (fallback) return fallback;
  // Nothing different to offer: keep what's there if it holds up, rather than swapping a suggestion for the source.
  if (avoid) return safeRuleSuggestion(inv, index, line, variant);
  return { text: line.text, check: checkRewrite(inv, { index, text: line.text }, line.text) };
}

export async function rewriteLineFlow(repo: Repo, reportId: string, index: number, variant: number, provider: RewriteProvider | null): Promise<RewriteResult> {
  const report = await repo.getReport<CvReviewPayload>(reportId);
  const i = Index.safeParse(index);
  const line = i.success ? report?.payload.analysis?.lines?.[i.data] : undefined;
  if (!report || !line) return { error: NOT_FOUND };
  // Reserve the use first so parallel requests can't go over the limit.
  const used = await repo.bumpAi("line_rewrite");
  if (used > AI_LIMITS.line_rewrite) return { error: "You've used all your rewrites for today. They reset at midnight.", left: 0 };

  const inv = buildClaimInventory(report.payload.text);
  const ref = { index, text: line.text };
  const sent = withoutInstructions(line.text).text;
  const previousCheck = variant > 0 ? checkRewrite(inv, ref, line.rewrite) : null;
  const previous = previousCheck && previousCheck.verdict !== "block" && line.rewrite !== ALREADY_STRONG ? line.rewrite : undefined;

  let chosen: { text: string; check: RewriteCheck; ai: boolean } | null = null;
  let note: string | undefined;
  // Nothing left to rewrite once instructions are removed means there's no experience to send to the model.
  if (provider && sent.length >= 12) {
    let raw: unknown = null;
    try {
      // The entry's label as read for the inventory, so a heading can't carry instructions in either.
      const role = checkRewrite(inv, ref, line.text).entry?.heading ?? withoutInstructions(line.where).text;
      raw = await provider(sent, { role, sector: report.payload.sector, previous });
    } catch (error) {
      log("error", "rewrite-provider-failed", { error });
    }
    const out = Output.safeParse(raw);
    if (out.success) {
      const check = checkRewrite(inv, ref, out.data);
      if (check.verdict !== "block") {
        chosen = { text: out.data, check, ai: true };
      } else {
        log("warn", "rewrite-blocked", { codes: check.issues.filter((x) => x.severity === "block").map((x) => x.code) });
        const repaired = withPlaceholders(out.data, check);
        const again = repaired ? checkRewrite(inv, ref, repaired) : null;
        if (repaired && again && again.verdict !== "block") {
          chosen = { text: repaired, check: again, ai: true };
          note = `We replaced ${describe(check.issues)} with a placeholder, because your CV doesn't give that for this entry. Add the real figure only if you have one.`;
        } else {
          note = `We didn't use the AI suggestion because it included ${describe(check.issues)}, which your CV doesn't show for this entry. This version comes from our rules instead.`;
        }
      }
    } else {
      note = "We couldn't get an AI suggestion just now, so this one comes from our rules.";
    }
  }
  if (!chosen) chosen = { ...safeRuleSuggestion(inv, index, line, variant, line.rewrite), ai: false };
  if (!note && chosen.check.sourceHadInstructions) note = "Part of this line reads like instructions to software rather than experience, so we didn't treat it as something you did.";
  else if (chosen.check.sourceHadInstructions) note += " Part of this line reads like instructions to software, so we didn't treat it as something you did.";

  report.payload.analysis.lines[index] = { ...line, rewrite: chosen.text, aiRewrite: chosen.ai };
  await repo.updateReport(reportId, { payload: report.payload });
  return { rewrite: chosen.text, ai: chosen.ai, left: AI_LIMITS.line_rewrite - used, check: chosen.check, note };
}

const NO_FACTS = "This wording says something your CV doesn't show for this entry, so we can't save it.";
const NOT_CONFIRMED = "Confirm each point above is accurate before you use this version.";
const Accepted = z.string().trim().min(3).max(400);

/** Saves the student's chosen version, checking it again here: the check that matters is the one on the server. */
export async function acceptRewriteFlow(repo: Repo, reportId: string, index: number, text: string | null, confirmed: string[] = []): Promise<{ error?: string; check?: RewriteCheck }> {
  const report = await repo.getReport<CvReviewPayload>(reportId);
  const i = Index.safeParse(index);
  const line = i.success ? report?.payload.analysis?.lines?.[i.data] : undefined;
  if (!report || !line) return { error: NOT_FOUND };
  if (text === null || text === "") {
    const rest = { ...line };
    delete rest.accepted;
    delete rest.acceptedCheck;
    report.payload.analysis.lines[index] = rest;
    await repo.updateReport(reportId, { payload: report.payload });
    return {};
  }
  const clean = Accepted.safeParse(text);
  if (!clean.success || clean.data === ALREADY_STRONG) return { error: "That version is too short or too long to save." };
  const check = checkRewrite(buildClaimInventory(report.payload.text), { index, text: line.text }, clean.data);
  if (check.verdict === "block") return { error: NO_FACTS, check };
  const needed = confirmationsNeeded(check);
  if (needed.some((k) => !confirmed.includes(k))) return { error: NOT_CONFIRMED, check };
  report.payload.analysis.lines[index] = { ...line, accepted: clean.data, acceptedCheck: { validator: check.validator, confirmed: needed } };
  await repo.updateReport(reportId, { payload: report.payload });
  return { check };
}

/**
 * What the line editor shows: every saved suggestion checked as it is read. A suggestion saved before this check existed
 * and now blocked is replaced for display by a safe one; the report itself isn't rewritten by reading it.
 */
export function presentLines(payload: Pick<CvReviewPayload, "text" | "analysis">): (LineResult & { check: RewriteCheck })[] {
  const inv = buildClaimInventory(payload.text);
  return payload.analysis.lines.map((line, index) => {
    const check = checkRewrite(inv, { index, text: line.text }, line.rewrite);
    if (check.verdict !== "block") return { ...line, check };
    const safe = safeRuleSuggestion(inv, index, line, 0);
    return { ...line, rewrite: safe.text, aiRewrite: false, check: safe.check };
  });
}
