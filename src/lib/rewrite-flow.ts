import "server-only";
import { z } from "zod";
import { buildClaimInventory, withoutInstructions, type ClaimInventory } from "@/lib/analysis/claims";
import { judgmentFromLine, ruleRewrite } from "@/lib/analysis/cv";
import { documentVersion } from "@/lib/analysis/findings";
import { ALREADY_STRONG, checkRewrite, confirmationsNeeded, factsFromCheck, forTypedText, withPlaceholders, type RewriteCheck, type RewriteIssue } from "@/lib/analysis/rewrite-check";
import { cvFacts } from "@/lib/analysis/tailor-edits";
import { runAnalysisJob } from "@/lib/analysis-job";
import { JOB_POLICY } from "@/lib/analysis/job-state";
import { log } from "@/lib/log";
import { AI_LIMITS, ReportConflictError, type Repo } from "@/lib/repo/types";
import type { CvReviewPayload, LineResult, LineUndoEntry } from "@/lib/types";

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

const WRITE_TRIES = 4;
const CONFLICT = "This line changed in another tab or window. Reload to see the latest version, then try again.";
const UNDO_KEPT = 20;

/**
 * Changes one line as one step: the write only lands if nothing has been saved since the read, and otherwise it's made
 * again on what is there now, so saving line 3 in one tab can't lose line 7 saved in another.
 */
async function writeLine(repo: Repo, reportId: string, index: number, change: (line: LineResult, payload: CvReviewPayload) => LineResult | { stop: { error?: string; check?: RewriteCheck; conflict?: boolean } }): Promise<{ error?: string; check?: RewriteCheck; conflict?: boolean }> {
  for (let i = 0; i < WRITE_TRIES; i++) {
    const report = await repo.getReport<CvReviewPayload>(reportId);
    const at = Index.safeParse(index);
    const line = at.success ? report?.payload.analysis?.lines?.[at.data] : undefined;
    if (!report || !line) return { error: NOT_FOUND };
    const next = change(line, report.payload);
    if ("stop" in next) return next.stop;
    const before = report.payload.editRevision ?? null;
    report.payload.analysis.lines[index] = next;
    report.payload.editRevision = (before ?? 0) + 1;
    try {
      await repo.updateReport(reportId, { payload: report.payload }, { ifRevision: before });
      return {};
    } catch (error) {
      if (!(error instanceof ReportConflictError)) throw error;
    }
  }
  return { error: CONFLICT, conflict: true };
}

const snapshot = (line: LineResult, at: string): LineUndoEntry => ({ text: line.accepted ?? null, check: line.acceptedCheck ?? null, at });
const pushUndo = (line: LineResult, at: string) => [...(line.acceptedHistory ?? []), snapshot(line, at)].slice(-UNDO_KEPT);

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
  const at = i.data as number;
  // A repeat of the same request answers from what was saved; the job also stops two identical ones calling the provider.
  return runAnalysisJob<RewriteResult>(
    repo,
    {
      workflow: "line_rewrite",
      key: `${reportId}:${at}:${variant}`.replace(/[^A-Za-z0-9_:.-]/g, "_").slice(0, 200),
      freshSeconds: JOB_POLICY.repeatWindowSeconds,
      // A failed save has always reached the action as a throw; the action decides what to say.
      rethrow: true,
      replay: async () => {
        const now = await repo.getReport<CvReviewPayload>(reportId);
        const saved = now?.payload.analysis?.lines?.[at];
        if (!now || !saved) return null;
        return { rewrite: saved.rewrite, ai: !!saved.aiRewrite, left: AI_LIMITS.line_rewrite - (await repo.aiUsedToday("line_rewrite")), check: checkRewrite(buildClaimInventory(now.payload.text, cvFacts(now.payload)), { index, text: saved.text }, saved.rewrite) };
      },
      refuse: (error) => ({ error }),
    },
    async (job) => {
      // Reserve the use first so parallel requests can't go over the limit.
      const charge = await job.charge("line_rewrite");
      if (!charge.allowed) return { status: "failed", value: { error: "You've used all your rewrites for today. They reset at midnight.", left: 0 }, errorCode: charge.reason === "limit" ? "quota" : "failed_cap", countFailure: false };
      const used = charge.used;

      const inv = buildClaimInventory(report.payload.text, cvFacts(report.payload));
      const ref = { index, text: line.text };
      const sent = withoutInstructions(line.text).text;
      const previousCheck = variant > 0 ? checkRewrite(inv, ref, line.rewrite) : null;
      const previous = previousCheck && previousCheck.verdict !== "block" && line.rewrite !== ALREADY_STRONG ? line.rewrite : undefined;

      let chosen: { text: string; check: RewriteCheck; ai: boolean } | null = null;
      let note: string | undefined;
      // The provider was asked and gave nothing the student can use, so the use goes back.
      let notDelivered = false;
      let providerFailed = false;
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
              notDelivered = true;
              note = `We didn't use the AI suggestion because it included ${describe(check.issues)}, which your CV doesn't show for this entry. This version comes from our rules instead.`;
            }
          }
        } else {
          notDelivered = providerFailed = true;
          note = "We couldn't get an AI suggestion just now, so this one comes from our rules.";
        }
      }
      const left = AI_LIMITS.line_rewrite - used + (notDelivered ? 1 : 0);
      // A failure doesn't cost the student the good suggestion they already have.
      if (providerFailed && line.aiRewrite && previous && previousCheck) {
        return { status: "partial", value: { rewrite: line.rewrite, ai: true, left, check: previousCheck, note: "We couldn't get a new suggestion just now, so your last one is still here." }, errorCode: "provider", release: true, result: { ai: true } };
      }
      if (!chosen) chosen = { ...safeRuleSuggestion(inv, index, line, variant, line.rewrite), ai: false };
      if (!note && chosen.check.sourceHadInstructions) note = "Part of this line reads like instructions to software rather than experience, so we didn't treat it as something you did.";
      else if (chosen.check.sourceHadInstructions) note += " Part of this line reads like instructions to software, so we didn't treat it as something you did.";

      const picked = chosen;
      // Re-read for the write: the provider can take half a minute, and the student may have saved something meanwhile.
      const saved = await writeLine(repo, reportId, index, (latest) => ({ ...latest, rewrite: picked.text, aiRewrite: picked.ai }));
      if (saved.error) return { status: "failed", value: { error: saved.error, left }, errorCode: "input", countFailure: false };
      const value: RewriteResult = { rewrite: chosen.text, ai: chosen.ai, left, check: chosen.check, note };
      return notDelivered ? { status: "partial", value, errorCode: providerFailed ? "provider" : "output_rejected", release: true, result: { ai: false } } : { status: "completed", value, result: { ai: chosen.ai } };
    },
  );
}

const NO_FACTS = "This wording says something your CV doesn't show for this entry, so we can't save it.";
const NOT_CONFIRMED = "Confirm each point above is accurate before you use this version.";
const Accepted = z.string().trim().min(3).max(400);

const NOT_SAVED = "That wording can't be saved: it has to be a single line of a CV, with nothing in brackets except a clear blank to fill.";

export interface AcceptOptions {
  /** The student typed these words, so a fact the CV doesn't show is theirs to confirm by name rather than refused. */
  typed?: boolean;
  /** The saved version the student was looking at. If it has changed, this is refused rather than overwriting it. */
  expected?: string | null;
}

/** Saves the student's chosen version, checking it again here: the check that matters is the one on the server. */
export async function acceptRewriteFlow(repo: Repo, reportId: string, index: number, text: string | null, confirmed: string[] = [], options: AcceptOptions = {}): Promise<{ error?: string; check?: RewriteCheck; conflict?: boolean }> {
  let last: RewriteCheck | undefined;
  const at = new Date().toISOString();
  const out = await writeLine(repo, reportId, index, (line, payload) => {
    if (options.expected !== undefined && (line.accepted ?? null) !== options.expected) return { stop: { error: CONFLICT, conflict: true } };
    if (text === null || text === "") {
      const rest = { ...line, acceptedHistory: pushUndo(line, at) };
      delete rest.accepted;
      delete rest.acceptedCheck;
      return rest;
    }
    const clean = Accepted.safeParse(text);
    if (!clean.success || clean.data === ALREADY_STRONG) return { stop: { error: "That version is too short or too long to save." } };
    // This line's own earlier confirmations are being replaced, so they can't vouch for its new wording.
    const others = { analysis: { ...payload.analysis, lines: payload.analysis.lines.map((l, n) => (n === index ? { ...l, accepted: undefined } : l)) } };
    const raw = checkRewrite(buildClaimInventory(payload.text, cvFacts(others)), { index, text: line.text }, clean.data);
    const check = options.typed ? forTypedText(raw) : raw;
    last = check;
    if (check.verdict === "block") return { stop: { error: options.typed ? NOT_SAVED : NO_FACTS, check } };
    const needed = confirmationsNeeded(check);
    if (needed.some((k) => !confirmed.includes(k))) return { stop: { error: NOT_CONFIRMED, check } };
    const facts = factsFromCheck(check, needed, { idPrefix: `l${index}`, quote: clean.data, scope: "line", entryId: check.entry?.id ?? null, entryHeading: check.entry?.heading ?? null, lineText: line.text, how: options.typed ? "typed" : "confirmed-suggestion", sourceVersion: documentVersion(payload.text), reportId, at });
    return { ...line, accepted: clean.data, acceptedCheck: { validator: check.validator, confirmed: needed, ...(facts.length ? { facts } : {}), ...(options.typed ? { typed: true } : {}) }, acceptedHistory: pushUndo(line, at) };
  });
  return out.error ? out : { check: last };
}

/** Puts a line's saved version back to what it was before the last change, and with it what the student had confirmed. */
export async function undoAcceptFlow(repo: Repo, reportId: string, index: number, expected?: string | null): Promise<{ error?: string; conflict?: boolean; accepted?: string | null }> {
  let restored: string | null = null;
  const out = await writeLine(repo, reportId, index, (line) => {
    if (expected !== undefined && (line.accepted ?? null) !== expected) return { stop: { error: CONFLICT, conflict: true } };
    const history = line.acceptedHistory ?? [];
    const to = history[history.length - 1];
    if (!to) return { stop: { error: "There's nothing to undo on this line." } };
    const rest: LineResult = { ...line, acceptedHistory: history.slice(0, -1) };
    if (!rest.acceptedHistory!.length) delete rest.acceptedHistory;
    delete rest.accepted;
    delete rest.acceptedCheck;
    if (to.text !== null) rest.accepted = to.text;
    if (to.check) rest.acceptedCheck = to.check;
    restored = to.text;
    return rest;
  });
  return out.error ? out : { accepted: restored };
}

/**
 * What the line editor shows: every saved suggestion checked as it is read. A suggestion saved before this check existed
 * and now blocked is replaced for display by a safe one; the report itself isn't rewritten by reading it.
 */
export function presentLines(payload: Pick<CvReviewPayload, "text" | "analysis">): (LineResult & { check: RewriteCheck })[] {
  const inv = buildClaimInventory(payload.text, cvFacts(payload));
  return payload.analysis.lines.map((line, index) => {
    const check = checkRewrite(inv, { index, text: line.text }, line.rewrite);
    if (check.verdict !== "block") return { ...line, check };
    const safe = safeRuleSuggestion(inv, index, line, 0);
    return { ...line, rewrite: safe.text, aiRewrite: false, check: safe.check };
  });
}
