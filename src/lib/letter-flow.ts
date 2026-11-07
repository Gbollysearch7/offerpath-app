import "server-only";
import { z } from "zod";
import { withoutInstructions } from "@/lib/analysis/claims";
import { sha256 } from "@/lib/analysis/fingerprint";
import { documentVersion } from "@/lib/analysis/findings";
import { JOB_POLICY } from "@/lib/analysis/job-state";
import { checkLetterDraft, checkLetterText, cleanGenerated, confirmationsNeeded, isGreeting, isSignoff, LetterDraftSchema, type CheckedDraft } from "@/lib/analysis/letter-check";
import { applyLetterMove, baseLetter, buildParagraphs, currentLetterVersion, factContext, inputsFor, letterDocumentOf, letterInventory, letterVersionFacts, restoreLetter, ruleSuggestions, saveLetterCheck, syncLetter, undoLetter, type LetterEditResult, type LetterInputs } from "@/lib/analysis/letter-edits";
import { forTypedText, factsFromCheck, type RewriteCheck } from "@/lib/analysis/rewrite-check";
import { promptSafeCv } from "@/lib/analysis/tailor";
import { baseDocument, cvFacts } from "@/lib/analysis/tailor-edits";
import { MESSAGES, runAnalysisJob } from "@/lib/analysis-job";
import { log } from "@/lib/log";
import { ReportConflictError, type Repo } from "@/lib/repo/types";
import { buildLetterReviewPayload } from "@/lib/services";
import type { CoverLetterPayload, CvReviewPayload, LetterEdits, LetterSuggestion, TailorDecision } from "@/lib/types";

// OP-016, OP-017: the logic behind the letter actions. The server actions add the session and revalidation; the tests call these
// directly against both repositories with a simulated provider. Generated text only reaches a report through checkLetterDraft or
// cleanGenerated, and every write is one atomic step with its revision in the WHERE clause.

export interface LetterProviderInput {
  jobTitle: string;
  employer: string;
  jobText: string;
  cvText: string;
  name: string;
  addressee: string | null;
  notes: string | null;
  existingLetter: string | null;
  wordLimit: number | null;
}
/** Null means it could not. May also throw or return junk: it is treated as untrusted. */
export type LetterProvider = (input: LetterProviderInput) => Promise<unknown>;

export interface LetterFlowResult {
  id?: string;
  error?: string;
  conflict?: boolean;
  check?: RewriteCheck;
  ai?: boolean;
  note?: string;
}

export interface LetterAttempt {
  key?: string;
  revision?: number | null;
}

const NOT_FOUND = "We couldn't find that letter.";
const CONFLICT = "This letter changed in another tab or window. Reload to see the latest version, then try again.";
const OLD_REPORT = "This letter was checked with an earlier version, so its report stays as it was saved. Use “Check as a new letter” to edit a copy.";
const NOT_CONFIRMED = "Confirm each point above is accurate before you use this version.";
const NO_FACTS = "This wording says something your CV or the advert doesn't show, so we can't save it.";
const TYPED_REFUSED = "We can't save that: it has code or a link in it, or brackets that aren't a clear blank to fill.";
const NOT_IMPROVED = "We couldn't write an improved version just now. Your letter hasn't changed, and this didn't count against today's limit. Try again in a minute.";
const WRITE_TRIES = 4;
const KEEP_ATTEMPTS = 20;
const Typed = z.string().trim().min(1).max(3000);

type Report = { row: { id: string; type: string; score: number | null }; payload: CoverLetterPayload };

async function readLetterReport(repo: Repo, id: string): Promise<Report | null> {
  const r = await repo.getReport<CoverLetterPayload>(id);
  return r && r.row.type === "cover_letter" ? (r as unknown as Report) : null;
}

const stale = (p: CoverLetterPayload, a: LetterAttempt) => a.revision !== undefined && (p.editRevision ?? null) !== a.revision;
const alreadyDone = (p: CoverLetterPayload, a: LetterAttempt) => !!a.key && (p.attempts ?? []).includes(a.key);

/**
 * Reads, changes and writes as one step: the write lands only if nothing has been saved since the read, and otherwise the change
 * is made again on what is there now. `change` returns a result to stop without writing, or a score to save with it. An old report
 * never gets a score written, so what it saved stays what it says.
 */
async function writeLetter(repo: Repo, id: string, attempt: LetterAttempt, change: (p: CoverLetterPayload, r: Report) => Promise<(LetterFlowResult & { score?: number | null }) | void> | (LetterFlowResult & { score?: number | null }) | void): Promise<LetterFlowResult> {
  for (let i = 0; i < WRITE_TRIES; i++) {
    const r = await readLetterReport(repo, id);
    if (!r) return { error: NOT_FOUND };
    if (alreadyDone(r.payload, attempt)) return {};
    if (stale(r.payload, attempt)) return { error: CONFLICT, conflict: true };
    const before = r.payload.editRevision ?? null;
    const out = await change(r.payload, r);
    if (out?.error) return out;
    r.payload.editRevision = (before ?? 0) + 1;
    if (attempt.key) r.payload.attempts = [...(r.payload.attempts ?? []), attempt.key].slice(-KEEP_ATTEMPTS);
    const patch: { payload: CoverLetterPayload; score?: number | null } = { payload: r.payload };
    if (out && "score" in out) patch.score = out.score;
    try {
      await repo.updateReport(id, patch, { ifRevision: before });
      if (!out) return {};
      const rest = { ...out };
      delete rest.score;
      return rest;
    } catch (error) {
      if (!(error instanceof ReportConflictError)) throw error;
    }
  }
  return { error: CONFLICT, conflict: true };
}

const nowIso = () => new Date().toISOString();

const applied = (p: CoverLetterPayload, res: LetterEditResult): LetterFlowResult & { score?: number | null } => {
  if ("error" in res) return { error: res.error };
  return { score: syncLetter(p, res.edits) };
};

async function cvOf(repo: Repo, p: CoverLetterPayload): Promise<CvReviewPayload | null> {
  return p.cvReportId ? ((await repo.getReport<CvReviewPayload>(p.cvReportId))?.payload ?? null) : null;
}

/* ---------- Deciding ---------- */

/** The inventory facts for a check: from the CV, the student's notes, and decisions other than this one. */
function inventoryFor(p: CoverLetterPayload, cv: CvReviewPayload, edits: LetterEdits, except: string | null) {
  const v = currentLetterVersion(edits);
  const others = { decisions: Object.fromEntries(Object.entries(v.decisions).filter(([id]) => id !== except)) };
  return letterInventory(baseDocument(cv).text, [...cvFacts(cv), ...letterVersionFacts(others)], p.notes);
}

/** Checks one decision on the server, whatever the page showed. A paragraph with no CV to compare with, or a greeting or sign-off, has no claims to check. */
function decideOne(s: LetterSuggestion, words: string, typed: boolean, confirmed: string[], ctx: { p: CoverLetterPayload; cv: CvReviewPayload | null; edits: LetterEdits; reportId: string; at: string }): { decision: TailorDecision } | LetterFlowResult {
  const status = typed ? "edited" : "accepted";
  // The rules' own wording, unchanged, is built from the student's sentence and their CV's words; a greeting or sign-off makes no claim.
  const nothingToCheck = !ctx.cv || !words || isGreeting(words) || isSignoff(words) || (!typed && s.origin === "rule");
  if (nothingToCheck) return { decision: { status, text: words, confirmed: [], facts: [], at: ctx.at } };
  const inputs = inputsFor(ctx.p, ctx.cv);
  const inv = inventoryFor(ctx.p, ctx.cv!, ctx.edits, s.id);
  // A blank the student keeps is theirs to fill, and the download asks about it. A model's brackets stay checked.
  const raw = checkLetterText(inv, typed ? words.replace(/\[[^\]\n]*\]/g, " ") : words, factContext(inputs));
  const check = typed ? forTypedText(raw) : raw;
  if (check.verdict === "block") return { error: typed ? TYPED_REFUSED : NO_FACTS, check };
  const needed = confirmationsNeeded(check);
  if (needed.some((k) => !confirmed.includes(k))) return { error: NOT_CONFIRMED, check };
  const facts = factsFromCheck(check, needed, { idPrefix: s.id, quote: words, scope: "cv", entryId: null, entryHeading: null, lineText: null, how: typed ? "typed" : "confirmed-suggestion", sourceVersion: documentVersion(ctx.cv!.text), reportId: ctx.reportId, at: ctx.at });
  return { decision: { status, text: words, confirmed: needed, facts, at: ctx.at } };
}

function editing(p: CoverLetterPayload): LetterEdits | null {
  return p.edits && p.review ? p.edits : null;
}

const labelOf = (s: LetterSuggestion, verb: string) => `${verb}: paragraph ${s.paragraph + 1}`;

export interface LetterDecision {
  suggestionId: string;
  /** Null keeps the suggestion's own words. */
  text: string | null;
  confirmed: string[];
}

export function decideLetterFlow(repo: Repo, reportId: string, input: LetterDecision, attempt: LetterAttempt = {}): Promise<LetterFlowResult> {
  return writeLetter(repo, reportId, attempt, async (p, r) => {
    const e = editing(p);
    if (!e) return { error: OLD_REPORT };
    const s = e.suggestions.find((x) => x.id === input.suggestionId);
    const v = currentLetterVersion(e);
    if (!s || !v.shown.includes(s.id)) return { error: "We couldn't find that suggestion. Reload to see the latest version." };
    const parsed = input.text === null ? null : Typed.safeParse(input.text);
    if (parsed && !parsed.success) return { error: "That version is too short or too long to save." };
    const words = parsed ? parsed.data! : s.proposed;
    const typed = s.origin === "student" || (parsed !== null && words !== s.proposed);
    const at = nowIso();
    const cv = await cvOf(repo, p);
    const out = decideOne(s, words, typed, input.confirmed, { p, cv, edits: e, reportId: r.row.id, at });
    if (!("decision" in out)) return out;
    return applied(p, applyLetterMove(e, inputsWith(p, cv), { action: typed ? "edit" : "accept", label: labelOf(s, typed ? "Edited" : "Accepted"), shown: v.shown, decisions: { ...v.decisions, [s.id]: out.decision } }, at));
  });
}

const inputsWith = (p: CoverLetterPayload, cv: CvReviewPayload | null): LetterInputs => inputsFor(p, cv);

/** Keeps every undecided suggestion that needs nothing confirmed and asks nothing. A blank or a question waits for the student. */
export function acceptClearLetterFlow(repo: Repo, reportId: string, attempt: LetterAttempt = {}): Promise<LetterFlowResult> {
  return writeLetter(repo, reportId, attempt, async (p, r) => {
    const e = editing(p);
    if (!e) return { error: OLD_REPORT };
    const cv = await cvOf(repo, p);
    const v = currentLetterVersion(e);
    const at = nowIso();
    const decisions = { ...v.decisions };
    for (const id of v.shown) {
      if (decisions[id]) continue;
      const s = e.suggestions.find((x) => x.id === id)!;
      if (/\[[^\]]*\]/.test(s.proposed)) continue;
      const out = decideOne(s, s.proposed, false, [], { p, cv, edits: e, reportId: r.row.id, at });
      if (!("decision" in out)) continue;
      const attempt_ = { ...decisions, [id]: out.decision };
      if (!buildParagraphs(baseLetter(e).paragraphs, e.suggestions, attempt_).missing.length) decisions[id] = out.decision;
    }
    return applied(p, applyLetterMove(e, inputsWith(p, cv), { action: "accept-all", label: "Accepted the suggestions with nothing to confirm", shown: v.shown, decisions }, at));
  });
}

export function rejectLetterFlow(repo: Repo, reportId: string, suggestionId: string, attempt: LetterAttempt = {}): Promise<LetterFlowResult> {
  return writeLetter(repo, reportId, attempt, async (p) => {
    const e = editing(p);
    if (!e) return { error: OLD_REPORT };
    const s = e.suggestions.find((x) => x.id === suggestionId);
    const v = currentLetterVersion(e);
    if (!s || !v.shown.includes(suggestionId)) return { error: "We couldn't find that suggestion. Reload to see the latest version." };
    const at = nowIso();
    return applied(p, applyLetterMove(e, inputsWith(p, await cvOf(repo, p)), { action: "reject", label: labelOf(s, "Rejected"), shown: v.shown, decisions: { ...v.decisions, [s.id]: { status: "rejected", text: null, confirmed: [], facts: [], at } } }, at));
  });
}

export function reopenLetterFlow(repo: Repo, reportId: string, suggestionId: string, attempt: LetterAttempt = {}): Promise<LetterFlowResult> {
  return writeLetter(repo, reportId, attempt, async (p) => {
    const e = editing(p);
    if (!e) return { error: OLD_REPORT };
    const s = e.suggestions.find((x) => x.id === suggestionId);
    const v = currentLetterVersion(e);
    if (!s || !v.decisions[suggestionId]) return { error: "We couldn't find that decision. Reload to see the latest version." };
    const rest = { ...v.decisions };
    delete rest[suggestionId];
    return applied(p, applyLetterMove(e, inputsWith(p, await cvOf(repo, p)), { action: "reopen", label: labelOf(s, "Undecided again"), shown: v.shown, decisions: rest }, nowIso()));
  });
}

/** The student's own words for a whole paragraph. A later edit of the same paragraph replaces their earlier one. */
export function ownParagraphFlow(repo: Repo, reportId: string, input: { paragraph: number; text: string; confirmed: string[] }, attempt: LetterAttempt = {}): Promise<LetterFlowResult> {
  return writeLetter(repo, reportId, attempt, async (p, r) => {
    const e = editing(p);
    if (!e) return { error: OLD_REPORT };
    const parsed = Typed.safeParse(input.text);
    if (!parsed.success) return { error: "A paragraph can't be empty." };
    const base = baseLetter(e);
    const v = currentLetterVersion(e);
    const now = buildParagraphs(base.paragraphs, e.suggestions, v.decisions).paragraphs.find((x) => x.slot === input.paragraph);
    if (!base.paragraphs[input.paragraph] || !now) return { error: "We couldn't find that paragraph." };
    if (now.text === parsed.data) return;
    const at = nowIso();
    const cv = await cvOf(repo, p);
    const s: LetterSuggestion = { id: `own-${e.suggestions.length}`, kind: "own", paragraph: input.paragraph, before: now.text, proposed: parsed.data, origin: "student", reason: "Your own words.", area: null, generation: e.generation, check: { validator: "typed", verdict: "pass", issues: [], used: [], questions: [] } };
    const out = decideOne(s, parsed.data, true, input.confirmed, { p, cv, edits: e, reportId: r.row.id, at });
    if (!("decision" in out)) return out;
    const replaced = v.shown.filter((id) => e.suggestions.find((x) => x.id === id)?.kind === "own" && e.suggestions.find((x) => x.id === id)?.paragraph === input.paragraph);
    const decisions = Object.fromEntries(Object.entries(v.decisions).filter(([id]) => !replaced.includes(id)));
    return applied(p, applyLetterMove({ ...e, suggestions: [...e.suggestions, s] }, inputsWith(p, cv), { action: "own", label: labelOf(s, "Your own words"), shown: [...v.shown.filter((id) => !replaced.includes(id)), s.id], decisions: { ...decisions, [s.id]: out.decision } }, at));
  });
}

export function deleteParagraphFlow(repo: Repo, reportId: string, paragraph: number, attempt: LetterAttempt = {}): Promise<LetterFlowResult> {
  return writeLetter(repo, reportId, attempt, async (p) => {
    const e = editing(p);
    if (!e) return { error: OLD_REPORT };
    const v = currentLetterVersion(e);
    const now = buildParagraphs(baseLetter(e).paragraphs, e.suggestions, v.decisions).paragraphs.find((x) => x.slot === paragraph);
    if (!now) return { error: "We couldn't find that paragraph." };
    const at = nowIso();
    const s: LetterSuggestion = { id: `del-${e.suggestions.length}`, kind: "delete", paragraph, before: now.text, proposed: "", origin: "student", reason: "You removed this paragraph.", area: null, generation: e.generation, check: { validator: "typed", verdict: "pass", issues: [], used: [], questions: [] } };
    return applied(p, applyLetterMove({ ...e, suggestions: [...e.suggestions, s] }, inputsWith(p, await cvOf(repo, p)), { action: "delete", label: labelOf(s, "Removed"), shown: [...v.shown, s.id], decisions: { ...v.decisions, [s.id]: { status: "accepted", text: "", confirmed: [], facts: [], at } } }, at));
  });
}

export function undoLetterFlow(repo: Repo, reportId: string, attempt: LetterAttempt = {}): Promise<LetterFlowResult> {
  return writeLetter(repo, reportId, attempt, (p) => (editing(p) ? applied(p, undoLetter(p.edits!)) : { error: OLD_REPORT }));
}

export function restoreLetterFlow(repo: Repo, reportId: string, versionId: string, attempt: LetterAttempt = {}): Promise<LetterFlowResult> {
  return writeLetter(repo, reportId, attempt, (p) => (editing(p) ? applied(p, restoreLetter(p.edits!, versionId)) : { error: OLD_REPORT }));
}

/** The student has seen what's still open in this exact document and wants to keep it. A changed document asks again. */
export function retainLetterFlow(repo: Repo, reportId: string, attempt: LetterAttempt = {}): Promise<LetterFlowResult> {
  return writeLetter(repo, reportId, attempt, (p) => {
    if (!editing(p)) return { error: OLD_REPORT };
    const dv = letterDocumentOf(p.edits!, currentLetterVersion(p.edits!)).documentVersion;
    if (!(p.retainedPlaceholders ?? []).some((r) => r.documentVersion === dv)) p.retainedPlaceholders = [...(p.retainedPlaceholders ?? []), { documentVersion: dv, at: nowIso() }];
  });
}

/** Marks a letter as saved. Writes no score, on any report. */
export function saveLetterFlow(repo: Repo, reportId: string, attempt: LetterAttempt = {}): Promise<LetterFlowResult> {
  return writeLetter(repo, reportId, attempt, (p) => {
    p.saved = true;
  });
}

/** The selected text, assessed afresh against today's CV as a new report. The report it came from isn't touched, which is how an old report gets edited. */
export async function recheckLetterFlow(repo: Repo, reportId: string): Promise<LetterFlowResult> {
  const r = await readLetterReport(repo, reportId);
  if (!r) return { error: NOT_FOUND };
  const p = r.payload;
  const cv = await cvOf(repo, p);
  const { payload, score } = buildLetterReviewPayload({ letterText: p.letterText, jobTitle: p.jobTitle, employer: p.employer, jobText: p.jobText, tailorReportId: p.tailorReportId, cvReportId: cv ? p.cvReportId : null, cvFileName: cv ? p.cvFileName : null, cvPayload: cv, notes: p.notes, addressee: p.addressee, name: p.signer ?? cv?.analysis.meta.name ?? null, format: p.review?.context.format ?? "letter", wordLimit: p.review?.context.limit?.source === "student" ? p.review.context.limit.amount : null });
  const id = await repo.createReport({ type: "cover_letter", title: `${p.employer} cover letter review`, score, payload });
  return { id };
}

/* ---------- Generating ---------- */

const safe = (s: string | null) => (s ? withoutInstructions(s).text : null);

async function askProvider(provider: LetterProvider, input: LetterProviderInput): Promise<unknown> {
  try {
    return await provider({ ...input, cvText: promptSafeCv(input.cvText), notes: safe(input.notes), existingLetter: input.existingLetter === null ? null : promptSafeCv(input.existingLetter) });
  } catch (error) {
    log("error", "letter-provider-failed", { error });
    return null;
  }
}

/** A new draft from the provider, through the fact check. Null when nothing usable came back. */
export async function generateDraft(provider: LetterProvider, input: Omit<LetterProviderInput, "existingLetter" | "wordLimit"> & { wordLimit?: number | null }, cv: CvReviewPayload): Promise<CheckedDraft | null> {
  const raw = await askProvider(provider, { ...input, existingLetter: null, wordLimit: input.wordLimit ?? null });
  const inv = letterInventory(baseDocument(cv).text, cvFacts(cv), input.notes);
  return checkLetterDraft(raw, inv, { employer: input.employer, jobTitle: input.jobTitle, addressee: input.addressee, jobText: input.jobText, notes: input.notes, name: input.name });
}

const stems = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\d]{4,}/gu) ?? []);

/** Pairs each generated paragraph with the student's closest one, in order, so a change is offered against the words it changes. */
export function alignToLetter(current: { slot: number; text: string }[], generated: string[]): { slot: number; text: string; insert: boolean }[] {
  const out: { slot: number; text: string; insert: boolean }[] = [];
  let from = 0;
  let last = current[0]?.slot ?? 0;
  for (const text of generated) {
    const mine = stems(text);
    let best = -1;
    let bestShare = 0.25;
    for (let i = from; i < current.length; i++) {
      const theirs = stems(current[i].text);
      const share = [...mine].filter((w) => theirs.has(w)).length / Math.max(1, Math.min(mine.size, theirs.size));
      if (share > bestShare) {
        best = i;
        bestShare = share;
      }
    }
    if (best >= 0) {
      out.push({ slot: current[best].slot, text, insert: false });
      last = current[best].slot;
      from = best + 1;
    } else out.push({ slot: last, text, insert: true });
  }
  return out;
}

/**
 * Suggestions, paragraph by paragraph, on the same report. Nothing goes into the letter until the student keeps it, so the
 * letter and its number don't move here. A provider that fails or whose every word is refused leaves the report as it was.
 */
export async function improveLetterFlow(repo: Repo, reportId: string, provider: LetterProvider | null, attempt: LetterAttempt = {}): Promise<LetterFlowResult> {
  const first = await readLetterReport(repo, reportId);
  if (!first) return { error: NOT_FOUND };
  if (!editing(first.payload)) return { error: OLD_REPORT };
  if (stale(first.payload, attempt)) return { error: CONFLICT, conflict: true };
  const cv = await cvOf(repo, first.payload) ?? (await repo.latestReport<CvReviewPayload>("cv_review"))?.payload ?? null;
  if (!cv) return { error: "Upload a CV first. We only use facts from your CV." };
  const p0 = first.payload;
  // The repeat of a click: the same letter, while the first is running or just after.
  const key = `${reportId}:${sha256(p0.letterText)}`.replace(/[^A-Za-z0-9_:.-]/g, "_");
  return runAnalysisJob<LetterFlowResult>(
    repo,
    { workflow: "letter_improve", key, freshSeconds: JOB_POLICY.repeatWindowSeconds, replay: async (j) => (j.resultId ? { id: j.resultId } : null), refuse: (error) => ({ error }) },
    async (run) => {
      let raw: unknown = null;
      if (provider) {
        const charge = await run.charge("letter");
        if (!charge.allowed) return charge.reason === "limit" ? { status: "failed", value: { error: "You've used all your letter rewrites for today. They reset at midnight." }, errorCode: "quota", countFailure: false } : { status: "failed", value: { error: MESSAGES.failedCap }, errorCode: "failed_cap", countFailure: false };
        raw = await askProvider(provider, { jobTitle: p0.jobTitle, employer: p0.employer, jobText: p0.jobText, cvText: baseDocument(cv).text, name: p0.signer ?? cv.analysis.meta.name ?? "", addressee: p0.addressee, notes: p0.notes, existingLetter: p0.letterText, wordLimit: p0.review?.context.limit?.unit === "words" ? p0.review.context.limit.amount : null });
      }
      const parsed = provider ? LetterDraftSchema.safeParse(raw) : null;
      if (provider && !parsed?.success) return { status: "failed", value: { error: NOT_IMPROVED }, errorCode: "provider" };
      let usedAi = false;
      const out = await writeLetter(repo, reportId, attempt, (p) => {
        const e = editing(p);
        if (!e) return { error: OLD_REPORT };
        const inputs = inputsWith(p, cv);
        const v = currentLetterVersion(e);
        const generation = e.generation + 1;
        const doc = letterDocumentOf(e, v);
        const slots = buildParagraphs(baseLetter(e).paragraphs, e.suggestions, v.decisions).paragraphs.flatMap((x) => (x.slot !== null && !isGreeting(x.text) && !isSignoff(x.text) && x.text.split(/\s+/).length > 8 ? [{ slot: x.slot, text: x.text }] : []));
        const withheld: LetterEdits["withheld"] = [];
        let fresh: LetterSuggestion[] = [];
        if (parsed?.success) {
          const inv = inventoryFor(p, cv, e, null);
          const ctx = factContext(inputs);
          const generated = parsed.data.map((x) => x.text).filter((t) => !isGreeting(t) && !isSignoff(t));
          for (const a of alignToLetter(slots, generated)) {
            const clean = cleanGenerated(inv, a.text, ctx);
            for (const reason of clean.removed) withheld.push({ where: `Paragraph ${a.slot + 1}`, reason });
            if (!clean.text) continue;
            const before = a.insert ? "" : slots.find((s) => s.slot === a.slot)!.text;
            if (clean.text === before) continue;
            fresh.push({ id: `g${generation}-a${fresh.length}`, kind: a.insert ? "insert" : "replace", paragraph: a.slot, before, proposed: clean.text, origin: "ai", reason: a.insert ? "A new paragraph the writing tool suggests." : "A rewrite of this paragraph from the writing tool. Your words are kept unless you accept it.", area: null, generation, check: saveLetterCheck(clean.check) });
          }
          if (!fresh.length) return { error: NOT_IMPROVED };
          usedAi = true;
        } else {
          // The rules read the selected text, but a suggestion is placed by base paragraph: deleted or added paragraphs shift the count.
          const placed = buildParagraphs(baseLetter(e).paragraphs, e.suggestions, v.decisions).paragraphs;
          fresh = ruleSuggestions(doc, inputs, generation).flatMap((s) => {
            const slot = placed[s.paragraph]?.slot;
            return slot === null || slot === undefined ? [] : [{ ...s, paragraph: slot }];
          });
        }
        // What's decided stays; what isn't is replaced; a rejected wording isn't offered again.
        const shownNow = v.shown.map((id) => e.suggestions.find((s) => s.id === id)!);
        const decided = shownNow.filter((s) => v.decisions[s.id]);
        const added = fresh.filter((s) => !decided.some((d) => d.paragraph === s.paragraph && d.proposed === s.proposed));
        const shown = [...decided.map((s) => s.id), ...added.map((s) => s.id)];
        const next: LetterEdits = { ...e, generation, suggestions: [...e.suggestions, ...added], withheld, note: usedAi ? null : "These come from our rules, because the writing tool isn't available." };
        const moved = applyLetterMove(next, inputs, { action: "suggest", label: usedAi ? "New suggestions" : "Suggestions from our rules", shown, decisions: v.decisions }, nowIso());
        if ("error" in moved) return { error: moved.error };
        return { score: syncLetter(p, moved.edits) };
      });
      if (out.error) return { status: "failed", value: out.error === NOT_IMPROVED ? { error: NOT_IMPROVED } : out, errorCode: out.error === NOT_IMPROVED ? "provider" : "input", countFailure: out.error === NOT_IMPROVED };
      return { status: "completed", value: { id: reportId, ai: usedAi }, resultId: reportId };
    },
  );
}
