import { documentVersion } from "@/lib/analysis/findings";
import { normaliseText } from "@/lib/analysis/fingerprint";
import { log } from "@/lib/log";
import type { ProofreadingCategory, ProofreadingCoverage, ProofreadingFinding, ProofreadingLanguage, ProofreadingReport } from "@/lib/types";
import { UNRECOGNISED_WORD } from "./local";
import { ProviderResult, type ProofreadingProvider, type ProviderIssue } from "./provider";
import { proofreadingLanguage, proofreadingProvider, proofreadingTimeoutMs } from "./settings";
import { officialNameSpans } from "./terminology";

// Runs a provider and turns its answer into the report a student sees. This is where the failure rules
// live: a timeout, an exception, or output that doesn't validate gives "unavailable", and a finding whose
// quote isn't at the position it claims is dropped and makes the report "partial". Nothing here can produce
// a pass, and nothing here touches a score, a fingerprint or the student's text.

/** Time a provider gets after its signal fires to hand back what it has before it counts as timed out. */
const GRACE_MS = 250;

class TimeoutError extends Error {}

const SEVERITY = { spelling: "medium", grammar: "medium", punctuation: "low", regional: "info" } as const;
/** Not knowing a word isn't a claim that it's wrong. */
const severityOf = (i: ProviderIssue) => (i.rule === UNRECOGNISED_WORD ? "info" : SEVERITY[i.category]);

const NOT_ASSESSED: Record<ProofreadingCategory, ProofreadingCoverage> = {
  spelling: { status: "not_assessed", note: "Not assessed: the check didn't run." },
  grammar: { status: "not_assessed", note: "Not assessed: the check didn't run." },
  punctuation: { status: "not_assessed", note: "Not assessed: the check didn't run." },
  regional: { status: "not_assessed", note: "Not assessed: the check didn't run." },
};

function unavailable(provider: string, language: ProofreadingLanguage, text: string, limit: string): ProofreadingReport {
  return { status: "unavailable", provider, engine: null, dictionary: null, terminology: null, language, documentVersion: documentVersion(text), coverage: NOT_ASSESSED, stats: { wordsChecked: 0, wordsSkipped: 0 }, limits: [limit], findings: [] };
}

function toAction(i: ProviderIssue): string {
  if (!i.suggestions.length) return "We don't have a replacement to suggest. Check this yourself. We haven't changed anything in your CV.";
  const options = i.suggestions.map((s) => `"${s}"`).join(" or ");
  return `Consider ${options}. We haven't changed anything in your CV.`;
}

/** Groups issues into findings, one per distinct word and rule, each listing everywhere that word appears. */
function toFindings(issues: ProviderIssue[], doc: string): ProofreadingFinding[] {
  const byId = new Map<string, ProofreadingFinding>();
  for (const i of issues) {
    const id = `${i.category}:${i.rule}:${i.quote.toLowerCase()}`;
    const evidence = { documentVersion: doc, block: "doc", range: { start: i.start, end: i.end }, quote: i.quote };
    const existing = byId.get(id);
    if (existing) existing.evidence.push(evidence);
    else byId.set(id, { id, check: `proofreading.${i.category}`, category: i.category, rule: i.rule, status: "needs_attention", severity: severityOf(i), confidence: null, method: "rules", explanation: i.message, action: toAction(i), suggestions: i.suggestions, evidence: [evidence] });
  }
  return [...byId.values()];
}

export interface RunOptions {
  provider: ProofreadingProvider;
  language: ProofreadingLanguage;
  timeoutMs: number;
}

/** Proofreads a document's text. Never throws: every failure comes back as a report that says so. */
export async function runProofreading(text: string, { provider, language, timeoutMs }: RunOptions): Promise<ProofreadingReport> {
  const normalised = normaliseText(text);
  const failed = (reason: string, limit: string) => {
    // The reason only, never the text or anything quoted from it.
    log("warn", "proofreading_unavailable", { provider: provider.id, reason });
    return unavailable(provider.id, language, text, limit);
  };

  const controller = new AbortController();
  let abortTimer: ReturnType<typeof setTimeout> | undefined;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  let raw: unknown;
  try {
    abortTimer = setTimeout(() => controller.abort(), timeoutMs);
    raw = await Promise.race([
      provider.proofread({ text: normalised, language, signal: controller.signal }),
      new Promise((_, reject) => {
        hardTimer = setTimeout(() => reject(new TimeoutError()), timeoutMs + GRACE_MS);
      }),
    ]);
  } catch (e) {
    return e instanceof TimeoutError || controller.signal.aborted
      ? failed("timeout", "The spelling check took too long and didn't finish, so nothing was assessed. This doesn't mean your CV has no mistakes.")
      : failed("provider_error", "The spelling check couldn't run, so nothing was assessed. This doesn't mean your CV has no mistakes.");
  } finally {
    clearTimeout(abortTimer);
    clearTimeout(hardTimer);
  }

  const parsed = ProviderResult.safeParse(raw);
  if (!parsed.success) return failed("malformed_output", "The spelling check gave an answer we couldn't read, so nothing was assessed. This doesn't mean your CV has no mistakes.");
  const r = parsed.data;

  const located = r.issues.filter((i) => i.start < i.end && i.end <= normalised.length && normalised.slice(i.start, i.end) === i.quote);
  const dropped = r.issues.length - located.length;
  // An official name stays as it is, whichever provider raised it and whichever English was chosen.
  const names = officialNameSpans(normalised);
  const valid = located.filter((i) => !names.some((n) => i.start < n.end && n.start < i.end));
  // A provider that looked at nothing has assessed nothing, however confident its status.
  if (r.stats.wordsChecked === 0 && !valid.length) return failed("nothing_checked", "There were no words we could check, so nothing was assessed.");

  const coverage = { ...r.coverage };
  if (dropped) for (const c of new Set(r.issues.map((i) => i.category))) if (coverage[c].status === "assessed") coverage[c] = { ...coverage[c], status: "partial" };
  return {
    status: dropped ? "partial" : r.status,
    provider: provider.id,
    engine: r.engine,
    dictionary: r.dictionary,
    terminology: r.terminology,
    language,
    documentVersion: documentVersion(text),
    coverage,
    stats: r.stats,
    limits: dropped ? [...r.limits, `${dropped} of the check's results didn't line up with your text and were left out.`] : r.limits,
    findings: toFindings(valid, documentVersion(text)),
  };
}

/** The call a report builder makes: the configured provider, or a report saying proofreading is off. */
export async function proofreadCv(text: string, env: Record<string, string | undefined> = process.env, chosen?: ProofreadingLanguage | null): Promise<ProofreadingReport> {
  const provider = proofreadingProvider(env);
  // What the student chose (OP-008), otherwise this deployment's default.
  const language = chosen ?? proofreadingLanguage(env);
  if (!provider) return unavailable("off", language, text, "The spelling check is switched off, so nothing was assessed.");
  return runProofreading(text, { provider, language, timeoutMs: proofreadingTimeoutMs(env) });
}
