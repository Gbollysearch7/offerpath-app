import "server-only";
import { z } from "zod";
import { bracketsIn, buildClaimInventory, withoutInstructions } from "@/lib/analysis/claims";
import { documentVersion } from "@/lib/analysis/findings";
import { displayTerm, isToolTerm, jobKeywords, matchScores } from "@/lib/analysis/job";
import { evidencePrompts, remeasure } from "@/lib/analysis/job-match";
import { confirmationsNeeded, factsFromCheck, type RewriteCheck } from "@/lib/analysis/rewrite-check";
import { buildTailoredCv, checkTailorDraft, existingProfile, occurrenceOf, promptSafeCv, type CheckedDraft } from "@/lib/analysis/tailor";
import { applyMove, baseDocument, checkFor, currentVersion, cvFacts, documentOf, interpretationsNow, restore, saveCheck, startEdits, syncPayload, undo, versionFacts, type EditResult } from "@/lib/analysis/tailor-edits";
import { MESSAGES, runAnalysisJob } from "@/lib/analysis-job";
import { sha256 } from "@/lib/analysis/fingerprint";
import { JOB_POLICY } from "@/lib/analysis/job-state";
import { log } from "@/lib/log";
import { AI_LIMITS, ReportConflictError, type Repo } from "@/lib/repo/types";
import type { CvReviewPayload, TailorDecision, TailorEdits, TailorPayload, TailorSuggestion } from "@/lib/types";

// OP-014, OP-016: the logic behind the tailoring actions. The server actions add the session and revalidation; the tests call
// these directly against both repositories with a simulated provider. Every provider result goes through checkTailorDraft
// before anything is saved, and a failed or refused one leaves the student's decisions and versions as they were.

export interface TailorProviderInput {
  jobTitle: string;
  employer: string;
  jobText: string;
  cvText: string;
  lines: { id: number; where: string; text: string }[];
  keywords: string[];
  confirmedFacts: string[];
}
/** Null means it could not (no key, a provider error, a refusal). May also throw or return junk: it is treated as untrusted. */
export type TailorProvider = (input: TailorProviderInput) => Promise<unknown>;

export interface FlowResult {
  error?: string;
  /** The report changed in another tab or request. Nothing was saved. */
  conflict?: boolean;
  /** What has to be confirmed before this can be saved. */
  check?: RewriteCheck;
  ai?: boolean;
  note?: string;
}

/** The client's attempt: `key` makes a retry harmless, and `revision` is the version of the report the student was looking at. */
export interface Attempt {
  key?: string;
  revision?: number | null;
}

const NOT_FOUND = "We couldn't find that report.";
const CV_GONE = "The CV for this report has been deleted.";
const CONFLICT = "This tailoring changed in another tab or window. Reload to see the latest version, then try again.";
const NOT_CONFIRMED = "Confirm each point above is accurate before you use this version.";
const NO_FACTS = "This wording says something your CV doesn't show for this entry, so we can't save it.";
const WRITE_TRIES = 4;
const KEEP_ATTEMPTS = 20;

const Draft = z.object({
  summary: z.string().max(4_000),
  bullets: z.array(z.object({ id: z.number().int().min(0), after: z.string().max(2_000), keywords: z.array(z.string().max(80)).max(20) })).max(60),
  skills: z.array(z.string().max(80)).max(40),
  notEvidenced: z.array(z.string().max(80)).max(60),
});
const Typed = z.string().trim().min(3).max(700);
const Label = z.string().max(120);

type Report = { row: { id: string; type: string }; payload: TailorPayload };

async function readTailor(repo: Repo, id: string): Promise<Report | null> {
  const r = await repo.getReport<TailorPayload>(id);
  return r && r.row.type === "tailor" ? (r as Report) : null;
}

const stale = (p: TailorPayload, a: Attempt) => a.revision !== undefined && (p.editRevision ?? null) !== a.revision;
const alreadyDone = (p: TailorPayload, a: Attempt) => !!a.key && (p.attempts ?? []).includes(a.key);

/**
 * Reads, changes and writes as one step: the write only lands if nothing has been saved since the read, and otherwise the
 * change is made again on what is there now. `change` returns a result to stop without writing.
 */
async function writeTailor(repo: Repo, id: string, attempt: Attempt, change: (p: TailorPayload, report: Report) => Promise<FlowResult | void> | FlowResult | void): Promise<FlowResult> {
  for (let i = 0; i < WRITE_TRIES; i++) {
    const r = await readTailor(repo, id);
    if (!r) return { error: NOT_FOUND };
    if (alreadyDone(r.payload, attempt)) return {};
    if (stale(r.payload, attempt)) return { error: CONFLICT, conflict: true };
    const before = r.payload.editRevision ?? null;
    const out = await change(r.payload, r);
    if (out?.error) return out;
    r.payload.editRevision = (before ?? 0) + 1;
    if (attempt.key) r.payload.attempts = [...(r.payload.attempts ?? []), attempt.key].slice(-KEEP_ATTEMPTS);
    try {
      await repo.updateReport(id, { payload: r.payload }, { ifRevision: before });
      return out ?? {};
    } catch (error) {
      if (!(error instanceof ReportConflictError)) throw error;
      // The student's view is out of date only if they said which revision they saw; that's refused on the next read.
    }
  }
  return { error: CONFLICT, conflict: true };
}

const apply = (p: TailorPayload, res: EditResult): FlowResult | void => {
  if ("error" in res) return { error: res.error };
  syncPayload(p, res.edits);
};

const nowIso = () => new Date().toISOString();

/* ---------- Choosing what to work on ---------- */

/** A choice about what to work on, never evidence: no document, number or assessment changes. */
export function toggleKeywordFlow(repo: Repo, reportId: string, word: string): Promise<FlowResult> {
  return writeTailor(repo, reportId, {}, (p) => {
    if (!p.keywords.some((k) => k.w === word)) return { error: "We couldn't find that keyword." };
    p.added = p.added.includes(word) ? p.added.filter((w) => w !== word) : [...p.added, word];
  });
}

/**
 * Records that the student reads a requirement as not applying to them, as their reading. The requirement stays in the
 * advert's list, in the gaps and in the number; only the record and what's offered for tailoring change.
 */
export function setInterpretationFlow(repo: Repo, reportId: string, requirementId: string, on: boolean, note: string | null, attempt: Attempt = {}): Promise<FlowResult> {
  return writeTailor(repo, reportId, attempt, (p) => {
    const req = p.jobMatch?.requirements.find((r) => r.id === requirementId);
    if (!req) return { error: "We couldn't find that requirement." };
    const list = p.interpretations ?? [];
    const open = list.find((i) => i.requirementId === requirementId && !i.withdrawnAt);
    if (on === !!open) return;
    const at = nowIso();
    p.interpretations = on ? [...list, { requirementId, label: req.label, category: req.category, stance: "not_relevant", note: note?.trim().slice(0, 300) || null, by: "student", at, withdrawnAt: null }] : list.map((i) => (i === open ? { ...i, withdrawnAt: at } : i));
  });
}

/* ---------- Generating suggestions ---------- */

function suggestionsFrom(checked: CheckedDraft, cv: CvReviewPayload, generation: number, baseText: string): TailorSuggestion[] {
  const lines = cv.analysis.lines;
  const current = lines.map((l) => l.accepted ?? l.text);
  const out: TailorSuggestion[] = [];
  if (checked.summary && checked.summaryCheck) {
    out.push({ id: `g${generation}-summary`, kind: "summary", lineIndex: null, occurrence: 0, entryId: null, where: "PROFILE", before: existingProfile(baseText), proposed: checked.summary, origin: "ai", keywords: [], note: null, generation, check: saveCheck(checked.summaryCheck) });
  }
  for (const b of [...checked.bullets].sort((x, y) => x.id - y.id)) {
    out.push({ id: `g${generation}-b${b.id}`, kind: "bullet", lineIndex: b.id, occurrence: occurrenceOf(current, b.id), entryId: b.check.entry?.id ?? null, where: lines[b.id].where, before: current[b.id], proposed: b.after, origin: "ai", keywords: b.keywords, note: b.note, generation, check: saveCheck(b.check) });
  }
  checked.skillChecks.forEach((s, n) => {
    out.push({ id: `g${generation}-s${n}`, kind: "skill", lineIndex: null, occurrence: 0, entryId: s.check.entry?.id ?? null, where: "SKILLS", before: "", proposed: s.term, origin: "ai", keywords: [s.term], note: null, generation, check: saveCheck(s.check) });
  });
  return out;
}

const sameSlot = (a: TailorSuggestion, b: TailorSuggestion) => a.kind === b.kind && (a.kind === "bullet" ? a.lineIndex === b.lineIndex : a.kind === "summary" ? true : a.kind === "skill" ? a.proposed.toLowerCase() === b.proposed.toLowerCase() : false);

/** Merges a new set in: what the student kept stays, what they haven't decided is replaced, and a suggestion they rejected isn't offered again word for word. */
function mergeGeneration(edits: TailorEdits, fresh: TailorSuggestion[]): { suggestions: TailorSuggestion[]; shown: string[]; decisions: Record<string, TailorDecision> } {
  const cur = currentVersion(edits);
  const shownNow = cur.shown.map((id) => edits.suggestions.find((s) => s.id === id)!);
  const decided = shownNow.filter((s) => cur.decisions[s.id]);
  const keptOnes = decided.filter((s) => cur.decisions[s.id].status !== "rejected");
  const rejected = decided.filter((s) => cur.decisions[s.id].status === "rejected");
  const added = fresh.filter((s) => !keptOnes.some((k) => sameSlot(k, s)) && !rejected.some((k) => sameSlot(k, s) && k.proposed === s.proposed));
  const stillShownRejected = rejected.filter((r) => !added.some((a) => sameSlot(a, r)));
  const shown = [...keptOnes, ...stillShownRejected, ...added].map((s) => s.id);
  const decisions = Object.fromEntries(shown.filter((id) => cur.decisions[id]).map((id) => [id, cur.decisions[id]]));
  return { suggestions: [...edits.suggestions, ...added], shown, decisions };
}

const safeLines = (cv: CvReviewPayload) => cv.analysis.lines.map((l, i) => ({ id: i, where: withoutInstructions(l.where).text, text: withoutInstructions(l.accepted ?? l.text).text }));

/** Asks the provider, once, and returns only what parsed. A throw, a refusal and junk are all the same answer: nothing. */
async function askProvider(provider: TailorProvider, p: TailorPayload, cv: CvReviewPayload, baseText: string, facts: string[]): Promise<z.infer<typeof Draft> | null> {
  try {
    const raw = await provider({ jobTitle: p.jobTitle, employer: p.employer, jobText: p.jobText, cvText: promptSafeCv(baseText), lines: safeLines(cv), keywords: p.added, confirmedFacts: facts });
    const parsed = Draft.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    log("error", "tailor-provider-failed", { error });
    return null;
  }
}

function promptsFor(p: TailorPayload) {
  const skipped = new Set(interpretationsNow(p).map((i) => i.label));
  const targets = p.added.length ? p.keywords.filter((k) => p.added.includes(k.w)) : p.keywords.filter((k) => k.must && !k.inCv);
  return evidencePrompts(p.jobMatch!, targets.filter((k) => !skipped.has(k.w)).map((k) => k.w));
}

const NO_NEW = "We couldn't make a new version just now. Your tailored CV is still here, and this didn't count against today's limit. Try again in a minute.";

/**
 * Makes suggestions. Nothing goes into the document until the student keeps it, so the number doesn't move here. If the
 * provider fails, refuses, runs out or everything it wrote is blocked, the student gets prompts for what to add, and what
 * they've already decided stays exactly as it was. Runs as one analysis job (OP-025): a repeat of the same request while
 * nothing has changed answers from the first.
 */
export async function tailorFlow(repo: Repo, reportId: string, provider: TailorProvider | null, attempt: Attempt = {}): Promise<FlowResult> {
  const first = await readTailor(repo, reportId);
  if (!first) return { error: NOT_FOUND };
  if (alreadyDone(first.payload, attempt)) return { ai: first.payload.aiTailored ?? false };
  if (stale(first.payload, attempt)) return { error: CONFLICT, conflict: true };
  const cvReport = await repo.getReport<CvReviewPayload>(first.payload.cvReportId);
  if (!cvReport) return { error: CV_GONE };
  const cv = cvReport.payload;
  const start = first.payload;
  // A good AI version already here isn't replaced with less because the provider failed or today's limit has gone.
  const hasGoodVersion = !!start.aiTailored && (!!start.tailoredCv || !!start.edits);
  const key = `${reportId}:${sha256(JSON.stringify([[...start.added].sort(), start.editRevision ?? 0]))}`.replace(/[^A-Za-z0-9_:.-]/g, "_");
  return runAnalysisJob<FlowResult>(
    repo,
    { workflow: "tailor_version", key, freshSeconds: JOB_POLICY.repeatWindowSeconds, replay: async (j) => ({ ai: !!j.result?.ai }), refuse: (error) => ({ error }) },
    async (run) => {
      const base = baseDocument(cv);
      const facts = [...cvFacts(cv), ...(start.edits ? versionFacts(currentVersion(start.edits)) : [])];
      const lines = cv.analysis.lines.map((l) => ({ text: l.accepted ?? l.text, locate: l.text, where: l.where }));
      let draft: z.infer<typeof Draft> | null = null;
      let notDelivered = false;
      let quotaGone: "limit" | "failed_cap" | undefined;
      if (provider) {
        const charge = await run.charge("tailor");
        if (charge.allowed) {
          draft = await askProvider(provider, start, cv, base.text, facts.map((f) => `${f.entryHeading ?? "Your CV"}: ${f.value}`));
          const usable = draft ? checkTailorDraft(draft, lines, cv.text, facts, start.jobText) : null;
          notDelivered = !usable || !(usable.bullets.length || usable.summary || usable.skills.length);
        } else quotaGone = charge.reason ?? "limit";
      }
      if (hasGoodVersion && notDelivered) return { status: "failed", value: { error: NO_NEW }, errorCode: "provider", result: { ai: false } };
      if (hasGoodVersion && quotaGone) return { status: "failed", value: { error: quotaGone === "limit" ? `You've tailored ${AI_LIMITS.tailor} times today. Your tailored CV is still here. You can make more tomorrow.` : MESSAGES.failedCap }, errorCode: quotaGone === "limit" ? "quota" : "failed_cap", release: false, countFailure: false };

      const note = notDelivered ? (draft ? "None of the AI suggestions passed our check against your CV, so here's what to add yourself." : "We couldn't get AI suggestions just now, so here's what to add yourself.") : quotaGone ? "You've used all your AI tailoring for today, so here's what to add yourself." : null;
      const out = start.jobMatch ? await revisedTailor(repo, reportId, cv, base, lines, notDelivered ? null : draft, note, attempt) : await legacyTailor(repo, reportId, start, cv, lines, notDelivered ? null : draft);
      if (out.error) return { status: "failed", value: out, errorCode: "input", countFailure: false };
      const result = { ai: !!out.ai };
      return notDelivered || quotaGone ? { status: "partial", value: out, resultId: reportId, errorCode: notDelivered ? "provider" : "quota", release: notDelivered, result } : { status: "completed", value: out, resultId: reportId, result };
    },
  );
}

/** The usual path: saves suggestions and leaves the document to the student's decisions. */
async function revisedTailor(repo: Repo, reportId: string, cv: CvReviewPayload, base: { text: string; version: string }, lines: { text: string; locate: string; where: string }[], draft: z.infer<typeof Draft> | null, note: string | null, attempt: Attempt): Promise<FlowResult> {
  let usedAi = false;
  const result = await writeTailor(repo, reportId, attempt, (p) => {
    const at = nowIso();
    let edits = p.edits ?? startEdits(p.jobMatch!, p.jobText, base.text, at);
    if (!edits.documents.some((d) => d.documentVersion === base.version)) edits = { ...edits, documents: [...edits.documents, { documentVersion: base.version, text: base.text, match: remeasure(p.jobMatch!, p.jobText, base.text) }] };
    // Checked again here, against the student's decisions as they are at the moment of saving.
    const checked = draft ? checkTailorDraft(draft, lines, cv.text, [...cvFacts(cv), ...versionFacts(currentVersion(edits))], p.jobText) : null;
    const generation = edits.generation + 1;
    const fresh = checked ? suggestionsFrom(checked, cv, generation, base.text) : [];
    usedAi = fresh.length > 0;
    const v = currentVersion(edits);
    const merged = usedAi ? mergeGeneration(edits, fresh) : { suggestions: edits.suggestions, shown: v.shown, decisions: v.decisions };
    const next: TailorEdits = { ...edits, generation, suggestions: merged.suggestions, withheld: checked?.withheld ?? edits.withheld, prompts: usedAi ? [] : promptsFor(p), note };
    const moved = applyMove(next, p.jobMatch!, p.jobText, { action: "tailor", label: usedAi ? "New suggestions" : "Your CV, with prompts", shown: merged.shown, decisions: merged.decisions, baseVersion: base.version }, at);
    if ("error" in moved) return { error: moved.error };
    if (checked && usedAi) p.notEvidenced = checked.notEvidenced;
    syncPayload(p, moved.edits);
    return note ? { note } : undefined;
  });
  return result.error ? result : { ...result, ai: usedAi };
}

/** A report from before versioned job scoring: its old scale stays and only what passes unasked goes in, as it did before. */
async function legacyTailor(repo: Repo, reportId: string, start: TailorPayload, cv: CvReviewPayload, checkLines: { text: string; locate: string; where: string }[], draft: z.infer<typeof Draft> | null): Promise<FlowResult> {
  const lines = cv.analysis.lines;
  const current = (i: number) => lines[i].accepted ?? lines[i].text;
  const checked = draft ? checkTailorDraft(draft, checkLines, cv.text, cvFacts(cv), start.jobText) : null;
  const clean = checked ? checked.bullets.filter((b) => b.check.verdict === "pass") : [];
  const summary = checked?.summaryCheck?.verdict === "pass" ? checked.summary : "";
  if (clean.length || summary) {
    const r = await writeTailor(repo, reportId, {}, (p) => {
      const texts = lines.map((l) => l.text);
      const tailoredCv = buildTailoredCv(cv.text, { summary, replacements: clean.map((b) => ({ from: lines[b.id].text, occurrence: occurrenceOf(texts, b.id), to: b.after })), skills: [] });
      p.tailored = clean.map((b) => ({ where: lines[b.id].where, before: current(b.id), after: b.after, keywords: b.keywords }));
      p.summary = summary || null;
      p.skillsToAdd = [];
      p.notEvidenced = checked!.notEvidenced;
      p.tailoredCv = tailoredCv;
      p.aiTailored = true;
      p.matchTailored = Math.max(p.matchNow ?? 0, matchScores(jobKeywords(p.jobText, tailoredCv)).now);
    });
    return r.error ? r : { ai: true };
  }
  const targets = start.added.length ? start.keywords.filter((k) => start.added.includes(k.w)) : start.keywords.filter((k) => k.must && !k.inCv);
  if (!targets.length) return { error: "Pick at least one keyword to add first." };
  const used = new Set<number>();
  const tailored: { where: string; before: string; after: string }[] = [];
  const skills: string[] = [];
  for (const k of targets) {
    if (k.where === "Skills section") {
      skills.push(k.w);
      continue;
    }
    const roleWord = k.where.replace(/ role$/, "").toUpperCase().split(/\s+/)[0];
    let i = lines.findIndex((l, idx) => !used.has(idx) && l.where.includes(roleWord));
    if (i < 0) i = lines.findIndex((_, idx) => !used.has(idx));
    if (i < 0) {
      skills.push(k.w);
      continue;
    }
    used.add(i);
    tailored.push({ where: lines[i].where, before: current(i), after: `${current(i).replace(/\.$/, "")}, ${weave(k.w)}.` });
  }
  if (skills.length) tailored.push({ where: "SKILLS", before: "Your current skills list", after: `Add to skills: ${skills.join(", ")}` });
  const r = await writeTailor(repo, reportId, {}, (p) => {
    p.tailored = tailored;
    p.summary = null;
    p.skillsToAdd = [];
    p.notEvidenced = [];
    p.tailoredCv = null;
    p.aiTailored = false;
  });
  return r.error ? r : { ai: false };
}

/** Phrase that works a keyword into the end of an existing bullet. */
function weave(word: string): string {
  if (/^stakeholder$/i.test(word)) return "working closely with stakeholders";
  if (isToolTerm(word)) return `using ${word}`;
  return `drawing on my ${displayTerm(word)} skills`;
}

/* ---------- Deciding ---------- */

interface DecisionInput {
  suggestionId: string;
  /** Null: keep the suggestion's own words. A string: the student's words. */
  text: string | null;
  confirmed: string[];
}

function factScope(s: TailorSuggestion): "line" | "entry" | "cv" {
  return s.kind === "bullet" ? "line" : s.kind === "new-line" ? "entry" : "cv";
}

/** Checks one decision on the server, whatever the page showed, and returns what to save or why not. */
function decideOne(s: TailorSuggestion, input: DecisionInput, ctx: { cv: CvReviewPayload; reportId: string; edits: TailorEdits; at: string }): { decision: TailorDecision } | FlowResult {
  const v = currentVersion(ctx.edits);
  const others = Object.fromEntries(Object.entries(v.decisions).filter(([id]) => id !== s.id));
  const facts = [...cvFacts(ctx.cv), ...versionFacts({ decisions: others })];
  const inv = buildClaimInventory(ctx.cv.text, facts);
  const parsed = input.text === null ? null : Typed.safeParse(input.text.replace(/\s+/g, " "));
  if (parsed && !parsed.success) return { error: "That version is too short or too long to save." };
  const words = parsed ? parsed.data! : s.proposed;
  const typed = s.origin === "student" || (parsed !== null && words !== s.proposed);
  const check = checkFor(inv, s, ctx.cv.analysis.lines, words, typed);
  if (check.verdict === "block") return { error: typed ? "We can't save that: it has to be a single line of a CV, with nothing in brackets except a clear blank to fill." : NO_FACTS, check };
  const needed = confirmationsNeeded(check);
  if (needed.some((k) => !input.confirmed.includes(k))) return { error: NOT_CONFIRMED, check };
  const lineText = s.lineIndex !== null && s.kind === "bullet" ? (ctx.cv.analysis.lines[s.lineIndex]?.text ?? null) : null;
  const newFacts = factsFromCheck(check, needed, {
    idPrefix: s.id,
    quote: words,
    scope: factScope(s),
    entryId: check.entry?.id ?? s.entryId,
    entryHeading: check.entry?.heading ?? null,
    lineText,
    how: typed ? "typed" : "confirmed-suggestion",
    sourceVersion: documentVersion(ctx.cv.text),
    reportId: ctx.reportId,
    at: ctx.at,
  });
  return { decision: { status: typed ? "edited" : "accepted", text: words, confirmed: needed, facts: newFacts, at: ctx.at } };
}

const shortLabel = (s: Pick<TailorSuggestion, "where" | "kind" | "proposed">) => Label.catch("a line").parse(s.kind === "skill" ? s.proposed : s.where.split("·").pop()!.trim().slice(0, 80) || "a line");

async function needCv(repo: Repo, p: TailorPayload): Promise<CvReviewPayload | null> {
  return (await repo.getReport<CvReviewPayload>(p.cvReportId))?.payload ?? null;
}

/** Keeps a suggestion, in its own words or the student's. */
export async function decideFlow(repo: Repo, reportId: string, input: DecisionInput, attempt: Attempt = {}): Promise<FlowResult> {
  return writeTailor(repo, reportId, attempt, async (p, r) => {
    const e = p.edits;
    if (!e || !p.jobMatch) return { error: "Tailor your CV first." };
    const s = e.suggestions.find((x) => x.id === input.suggestionId);
    if (!s || !currentVersion(e).shown.includes(s.id)) return { error: "We couldn't find that suggestion. Reload to see the latest version." };
    const cv = await needCv(repo, p);
    if (!cv) return { error: CV_GONE };
    const at = nowIso();
    const out = decideOne(s, input, { cv, reportId: r.row.id, edits: e, at });
    if (!("decision" in out)) return out;
    const v = currentVersion(e);
    const edited = out.decision.status === "edited";
    return apply(p, applyMove(e, p.jobMatch, p.jobText, { action: edited ? "edit" : "accept", label: `${edited ? "Edited" : "Accepted"}: ${shortLabel(s)}`, shown: v.shown, decisions: { ...v.decisions, [s.id]: out.decision } }, at));
  });
}

/** Keeps every undecided suggestion that needs nothing confirmed. Anything that asks a question waits for the student. */
export function acceptClearFlow(repo: Repo, reportId: string, attempt: Attempt = {}): Promise<FlowResult> {
  return writeTailor(repo, reportId, attempt, async (p, r) => {
    const e = p.edits;
    if (!e || !p.jobMatch) return { error: "Tailor your CV first." };
    const cv = await needCv(repo, p);
    if (!cv) return { error: CV_GONE };
    const at = nowIso();
    const v = currentVersion(e);
    const decisions = { ...v.decisions };
    for (const id of v.shown) {
      if (decisions[id]) continue;
      const s = e.suggestions.find((x) => x.id === id)!;
      if (s.origin !== "ai") continue;
      const out = decideOne(s, { suggestionId: id, text: null, confirmed: [] }, { cv, reportId: r.row.id, edits: e, at });
      // A blank still asks a question ("improving results by [X%]" asserts a result), so it gets looked at one by one.
      if ("decision" in out && !bracketsIn(s.proposed).length) decisions[id] = out.decision;
    }
    return apply(p, applyMove(e, p.jobMatch, p.jobText, { action: "accept-all", label: "Accepted the suggestions with nothing to confirm", shown: v.shown, decisions }, at));
  });
}

/** Rejects a suggestion, which takes it back out of the document if it was in. */
export function rejectFlow(repo: Repo, reportId: string, suggestionId: string, attempt: Attempt = {}): Promise<FlowResult> {
  return writeTailor(repo, reportId, attempt, (p) => {
    const e = p.edits;
    if (!e || !p.jobMatch) return { error: "Tailor your CV first." };
    const s = e.suggestions.find((x) => x.id === suggestionId);
    const v = currentVersion(e);
    if (!s || !v.shown.includes(suggestionId)) return { error: "We couldn't find that suggestion. Reload to see the latest version." };
    const at = nowIso();
    return apply(p, applyMove(e, p.jobMatch, p.jobText, { action: "reject", label: `Rejected: ${shortLabel(s)}`, shown: v.shown, decisions: { ...v.decisions, [s.id]: { status: "rejected", text: null, confirmed: [], facts: [], at } } }, at));
  });
}

/** Puts a decided suggestion back to undecided. */
export function reopenFlow(repo: Repo, reportId: string, suggestionId: string, attempt: Attempt = {}): Promise<FlowResult> {
  return writeTailor(repo, reportId, attempt, (p) => {
    const e = p.edits;
    if (!e || !p.jobMatch) return { error: "Tailor your CV first." };
    const s = e.suggestions.find((x) => x.id === suggestionId);
    const v = currentVersion(e);
    if (!s || !v.decisions[suggestionId]) return { error: "We couldn't find that decision. Reload to see the latest version." };
    const rest = { ...v.decisions };
    delete rest[suggestionId];
    return apply(p, applyMove(e, p.jobMatch, p.jobText, { action: "reopen", label: `Undecided again: ${shortLabel(s)}`, shown: v.shown, decisions: rest }, nowIso()));
  });
}

/** The student's own words for a line, or a new line under an entry. Always typed: every fact the CV doesn't show is confirmed by name. */
export function ownLineFlow(repo: Repo, reportId: string, input: { lineIndex: number; asNewLine: boolean; text: string; confirmed: string[] }, attempt: Attempt = {}): Promise<FlowResult> {
  return writeTailor(repo, reportId, attempt, async (p, r) => {
    const at = nowIso();
    const cv = await needCv(repo, p);
    if (!cv) return { error: CV_GONE };
    if (!p.jobMatch) return { error: "Tailor your CV first." };
    const line = cv.analysis.lines[input.lineIndex];
    if (!line) return { error: "We couldn't find that line." };
    const base = baseDocument(cv);
    const e = p.edits ?? startEdits(p.jobMatch, p.jobText, base.text, at);
    const v = currentVersion(e);
    const current = cv.analysis.lines.map((l) => l.accepted ?? l.text);
    const inv = buildClaimInventory(cv.text, cvFacts(cv));
    const n = e.suggestions.length;
    const entryId = inv.bullets[input.lineIndex]?.entryId ?? null;
    if (input.asNewLine && !entryId) return { error: "We couldn't place a new line there." };
    const s: TailorSuggestion = {
      id: `own-${n}`,
      kind: input.asNewLine ? "new-line" : "bullet",
      lineIndex: input.lineIndex,
      occurrence: occurrenceOf(current, input.lineIndex),
      entryId,
      where: line.where,
      before: current[input.lineIndex],
      proposed: input.text.replace(/\s+/g, " ").trim(),
      origin: "student",
      keywords: [],
      note: null,
      generation: e.generation,
      check: { validator: "", verdict: "pass", issues: [], used: [], questions: [] },
    };
    const out = decideOne(s, { suggestionId: s.id, text: s.proposed, confirmed: input.confirmed }, { cv, reportId: r.row.id, edits: e, at });
    if (!("decision" in out)) return out;
    // A new wording for a line takes the place of any earlier one for that line. A new line stands alongside.
    const replaced = input.asNewLine ? [] : v.shown.filter((id) => {
      const x = e.suggestions.find((y) => y.id === id)!;
      return x.kind === "bullet" && x.lineIndex === input.lineIndex;
    });
    const decisions = Object.fromEntries(Object.entries(v.decisions).filter(([id]) => !replaced.includes(id)));
    const check = out.decision.facts.length || out.decision.confirmed.length ? "confirm" : "pass";
    const saved: TailorSuggestion = { ...s, check: { ...s.check, validator: "typed", verdict: check } };
    return apply(p, applyMove({ ...e, suggestions: [...e.suggestions, saved] }, p.jobMatch, p.jobText, { action: "own-line", label: `Your own words: ${shortLabel(s)}`, shown: [...v.shown.filter((id) => !replaced.includes(id)), s.id], decisions: { ...decisions, [s.id]: out.decision } }, at));
  });
}

export function undoFlow(repo: Repo, reportId: string, attempt: Attempt = {}): Promise<FlowResult> {
  return writeTailor(repo, reportId, attempt, (p) => (p.edits ? apply(p, undo(p.edits)) : { error: "There's nothing to undo." }));
}

export function restoreFlow(repo: Repo, reportId: string, versionId: string, attempt: Attempt = {}): Promise<FlowResult> {
  return writeTailor(repo, reportId, attempt, (p) => (p.edits ? apply(p, restore(p.edits, versionId)) : { error: "We couldn't find that version." }));
}

/** Records that the student has seen the blanks in this exact document and wants to keep them. A changed document asks again. */
export function retainPlaceholdersFlow(repo: Repo, reportId: string, attempt: Attempt = {}): Promise<FlowResult> {
  return writeTailor(repo, reportId, attempt, (p) => {
    const dv = p.edits ? documentOf(p.edits, currentVersion(p.edits)).documentVersion : p.tailoredCv ? documentVersion(p.tailoredCv) : null;
    if (!dv) return { error: "There's no tailored CV to download yet." };
    if (!(p.retainedPlaceholders ?? []).some((r) => r.documentVersion === dv)) p.retainedPlaceholders = [...(p.retainedPlaceholders ?? []), { documentVersion: dv, at: nowIso() }];
  });
}
