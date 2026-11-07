import type { ConfirmedFact, CoverLetterPayload, CvReviewPayload, LetterDocument, LetterEdits, LetterParagraph, LetterSuggestion, LetterVersion, SavedCheck, TailorDecision } from "@/lib/types";
import { documentVersion } from "./findings";
import { checkLetterText, isGreeting, isSignoff, letterInventory, toSavedIssues, type LetterFactContext } from "./letter-check";
import { LETTER_REVIEW_VERSION } from "./letter-content";
import { assessLetter, letterReviewAssessment, letterSummary, placeholdersIn, readLetter, type LetterInput } from "./letter-review";
import { paragraphsToText } from "./letter";
import { US_SPELLINGS } from "./lexicon";
import { baseDocument, cvFacts } from "./tailor-edits";
import { wordDiff, type DiffPart } from "./word-diff";

// OP-016, OP-017: suggestions on a cover letter, the student's decisions and the versions they make. Pure, and the same model as
// tailor-edits.ts: a suggestion changes nothing until it's kept; each decision builds a real document and assesses it as written, so
// a displayed result can't be for different words. An old report (no `edits`) has none of this and stays exactly as it was saved.

export const MAX_LETTER_DOCUMENTS = 30;
export const LETTER_VERSION_LIMIT = "You've made a lot of versions of this letter. Use “Check as a new letter” to keep going.";
export type LetterEditResult = { edits: LetterEdits; changed: boolean } | { error: string };

export type LetterInputs = Omit<LetterInput, "letterText">;

const kept = (d: TailorDecision | undefined): d is TailorDecision & { text: string } => !!d && d.status !== "rejected" && d.text !== null;
export const currentLetterVersion = (e: LetterEdits): LetterVersion => e.versions.find((v) => v.id === e.current)!;
export const letterDocumentOf = (e: LetterEdits, v: Pick<LetterVersion, "documentVersion" | "scoringVersion">): LetterDocument => e.documents.find((d) => d.documentVersion === v.documentVersion && d.scoringVersion === v.scoringVersion)!;
export const baseLetter = (e: LetterEdits): LetterDocument => e.documents.find((d) => d.documentVersion === e.base)!;

/** What the assessment of any version of this letter compares with. */
export function inputsFor(p: Pick<CoverLetterPayload, "jobTitle" | "employer" | "jobText" | "notes" | "addressee" | "signer" | "review">, cv: Pick<CvReviewPayload, "text" | "analysis"> | null, extraFacts: ConfirmedFact[] = []): LetterInputs {
  const limit = p.review?.context.limit;
  return {
    jobTitle: p.jobTitle,
    employer: p.employer,
    jobText: p.jobText,
    notes: p.notes,
    addressee: p.addressee,
    name: p.signer ?? null,
    cvText: cv ? baseDocument(cv).text : "",
    facts: [...(cv ? cvFacts(cv) : []), ...extraFacts],
    format: p.review?.context.format ?? "letter",
    wordLimit: limit?.source === "student" ? limit.amount : null,
  };
}

export const factContext = (i: LetterInputs): LetterFactContext => ({ employer: i.employer, jobTitle: i.jobTitle, addressee: i.addressee ?? null, jobText: i.jobText, notes: i.notes, name: i.name });

const makeDocument = (i: LetterInputs, paragraphs: LetterParagraph[], text: string): LetterDocument => ({ documentVersion: documentVersion(text), scoringVersion: LETTER_REVIEW_VERSION, text, paragraphs, review: assessLetter({ ...i, letterText: text }) });

/** The first version: nothing decided. `exactText` keeps an uploaded letter byte for byte, so its hash is the hash of what was sent. */
export function startLetterEdits(i: LetterInputs, paragraphs: LetterParagraph[], header: string, at: string, extra: { exactText?: string; withheld?: LetterEdits["withheld"]; claims?: LetterEdits["aiClaims"]; note?: string | null } = {}): LetterEdits {
  const text = extra.exactText ?? paragraphsToText(paragraphs, header);
  const doc = makeDocument(i, paragraphs, text);
  const suggestions = ruleSuggestions(doc, i, 1);
  return {
    generation: 1,
    header,
    base: doc.documentVersion,
    suggestions,
    documents: [doc],
    versions: [{ id: "v1", n: 1, at, action: "start", label: header ? "First draft" : "Your letter as you sent it", documentVersion: doc.documentVersion, scoringVersion: doc.scoringVersion, shown: suggestions.map((s) => s.id), decisions: {} }],
    current: "v1",
    undoStack: [],
    withheld: extra.withheld ?? [],
    aiClaims: extra.claims ?? [],
    note: extra.note ?? null,
  };
}

const PASS: SavedCheck = { validator: "rules", verdict: "pass", issues: [], used: [], questions: [] };

export const saveLetterCheck = (c: ReturnType<typeof checkLetterText>): SavedCheck => ({ validator: c.validator, verdict: c.verdict === "confirm" ? "confirm" : "pass", issues: toSavedIssues(c), used: c.used.map((u) => ({ kind: u.kind, value: u.value, heading: u.heading, ...(u.student ? { student: true } : {}) })), questions: c.questions });

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * What the rules can offer without any model. Each one points at a passage or says what's absent. Blanks ask for what only the
 * student knows, and examples come word for word from a line in their CV.
 */
export function ruleSuggestions(doc: LetterDocument, i: LetterInputs, generation: number): LetterSuggestion[] {
  const out: LetterSuggestion[] = [];
  const paragraphs = doc.paragraphs;
  const where = (passage: string) => paragraphs.findIndex((p) => p.text.includes(passage));
  const body = paragraphs.map((p, n) => ({ p, n })).filter(({ p }) => !isGreeting(p.text) && !isSignoff(p.text) && p.text.split(/\s+/).length > 8);
  const lastBody = body[body.length - 1]?.n ?? Math.max(0, paragraphs.length - 2);
  const r = doc.review;
  const add = (kind: LetterSuggestion["kind"], paragraph: number, before: string, proposed: string, reason: string, area: LetterSuggestion["area"]) => {
    if (paragraph < 0) return;
    out.push({ id: `g${generation}-r${out.length}`, kind, paragraph, before, proposed, origin: "rule", reason, area, generation, check: PASS });
  };
  const m = r.motivation;
  const reasonBlank = "[your specific reason, and where you found it]";
  if (m.verdict === "generic" || (m.verdict === "information_missing" && m.quote)) {
    const q = m.quote!.quote;
    const at = where(q);
    add("replace", at, q, `I want to join ${i.employer} because ${reasonBlank}.`, m.verdict === "generic" ? "This sentence could go to any employer. Only you can give the reason, so we've left a blank." : "We only have the employer's name, so we can't suggest a reason. We've left a blank, and we won't add facts about the employer.", "employer_motivation");
  } else if (m.verdict === "absent" || m.verdict === "information_missing") {
    add("insert", lastBody, "", `I want to join ${i.employer} because ${reasonBlank}.`, "The letter doesn't say why this employer. Only you can give the reason, so we've left a blank.", "employer_motivation");
  }
  for (const q of r.requirements.filter((x) => x.level === "mentioned" && x.cv.level === "explicit" && x.letter && x.cv.refs[0]).slice(0, 3)) {
    const line = q.cv.refs[0].quote.replace(/\.$/, "");
    const passage = q.letter!.quote;
    const at = where(passage);
    if (/\bI\b/.test(line) || !/^[A-Z][a-z]+(ed|t|n|d)\b/.test(line)) continue;
    add("replace", at, passage, `${passage.replace(/\s+$/, "")} For example, I ${lowerFirst(line)}.`, `This names ${q.label} without saying what you did with it. Your CV shows it: “${q.cv.refs[0].quote}”.`, q.soft ? "soft_skills" : "hard_skills");
  }
  const signoff = readLetter(doc.text).signoff?.text.trim().replace(/,$/, "");
  const greeting = readLetter(doc.text).greeting?.text ?? "";
  if (signoff && greeting) {
    const sir = /\b(sir|madam|whom it may concern)\b/i.test(greeting);
    if (!sir && /faithfully/i.test(signoff)) add("replace", where(signoff), signoff, "Yours sincerely", "Optional. UK guidance often pairs “Yours sincerely” with a name or “Dear Hiring Manager”. Conventions vary.", "mechanics");
    if (sir && /sincerely/i.test(signoff)) add("replace", where(signoff), signoff, "Yours faithfully", "Optional. UK guidance often pairs “Yours faithfully” with “Dear Sir or Madam”. Conventions vary.", "mechanics");
  }
  for (const w of Object.keys(US_SPELLINGS)) {
    const found = new RegExp(`\\b${w}\\b`, "i").exec(doc.text)?.[0];
    if (found) add("replace", where(found), found, /^[A-Z]/.test(found) ? US_SPELLINGS[w].charAt(0).toUpperCase() + US_SPELLINGS[w].slice(1) : US_SPELLINGS[w], "Optional: the UK spelling, for a UK application.", "mechanics");
  }
  return out;
}

/** The paragraphs these decisions make, from the base. `slot` is the base position, which is what an edit refers to; null for an inserted paragraph. */
export function buildParagraphs(base: LetterParagraph[], suggestions: LetterSuggestion[], decisions: Record<string, TailorDecision>): { paragraphs: (LetterParagraph & { slot: number | null; insertedBy?: string })[]; missing: LetterSuggestion[] } {
  const now: (LetterParagraph & { slot: number | null } | null)[] = base.map((p, slot) => ({ text: p.text, src: [...p.src], slot }));
  const inserts = new Map<number, (LetterParagraph & { slot: null; insertedBy: string })[]>();
  const missing: LetterSuggestion[] = [];
  for (const s of suggestions) {
    const d = decisions[s.id];
    if (!kept(d)) continue;
    const cell = now[s.paragraph];
    const tag = d.status === "edited" || s.origin === "student" ? "YOU EDITED" : s.origin === "ai" ? "AI SUGGESTION, ACCEPTED" : "SUGGESTION, ACCEPTED";
    if (s.kind === "insert") inserts.set(s.paragraph, [...(inserts.get(s.paragraph) ?? []), { text: d.text, src: [tag], slot: null, insertedBy: s.id }]);
    else if (!cell) missing.push(s);
    else if (s.kind === "delete") now[s.paragraph] = null;
    else if (s.kind === "own") now[s.paragraph] = { ...cell, text: d.text, src: [...new Set([...cell.src, tag])] };
    else if (!cell.text.includes(s.before)) missing.push(s);
    else now[s.paragraph] = { ...cell, text: cell.text.replace(s.before, () => d.text), src: [...new Set([...cell.src, tag])] };
  }
  const paragraphs = now.flatMap((c, i) => [...(c ? [c] : []), ...(inserts.get(i) ?? [])]);
  return { paragraphs, missing };
}

export interface LetterMove {
  action: LetterVersion["action"];
  label: string;
  decisions: Record<string, TailorDecision>;
  shown: string[];
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Makes the version for a move: builds its document, assesses it, selects it. Nothing changes if the words and decisions are the same. */
export function applyLetterMove(edits: LetterEdits, i: LetterInputs, move: LetterMove, at: string): LetterEditResult {
  const cur = currentLetterVersion(edits);
  const base = baseLetter(edits);
  const anything = Object.values(move.decisions).some(kept);
  const built = buildParagraphs(base.paragraphs, edits.suggestions, move.decisions);
  if (built.missing.length) return { error: `We couldn't find “${built.missing[0].before.slice(0, 80)}” in this paragraph any more, so nothing was saved. Undo your later edit first, or reload.` };
  if (anything && built.paragraphs.filter((p) => !isGreeting(p.text) && !isSignoff(p.text)).length === 0) return { error: "A letter can't be left with nothing in it." };
  const paragraphs = built.paragraphs.map((p) => ({ text: p.text, src: p.src }));
  const text = anything ? [edits.header, ...paragraphs.map((p) => p.text)].filter(Boolean).join("\n\n") : base.text;
  const version = documentVersion(text);
  if (version === cur.documentVersion && sameJson(move.shown, cur.shown) && sameJson(move.decisions, cur.decisions)) return { edits, changed: false };
  let documents = edits.documents;
  let doc = documents.find((d) => d.documentVersion === version && d.scoringVersion === LETTER_REVIEW_VERSION);
  if (!doc) {
    if (documents.length >= MAX_LETTER_DOCUMENTS) return { error: LETTER_VERSION_LIMIT };
    // Assessed with what these decisions establish, so a fact stands only as long as the decision that made it.
    doc = makeDocument({ ...i, facts: [...(i.facts ?? []), ...letterVersionFacts({ decisions: move.decisions })] }, paragraphs, text);
    documents = [...documents, doc];
  }
  const n = edits.versions.reduce((m, v) => Math.max(m, v.n), 0) + 1;
  const next: LetterVersion = { id: `v${n}`, n, at, action: move.action, label: move.label, documentVersion: version, scoringVersion: doc.scoringVersion, shown: move.shown, decisions: move.decisions };
  return { edits: { ...edits, documents, versions: [...edits.versions, next], current: next.id, undoStack: [...edits.undoStack, cur.id] }, changed: true };
}

export function undoLetter(e: LetterEdits): LetterEditResult {
  const to = e.undoStack[e.undoStack.length - 1];
  if (!to) return { error: "There's nothing to undo." };
  return { edits: { ...e, current: to, undoStack: e.undoStack.slice(0, -1) }, changed: true };
}

export function restoreLetter(e: LetterEdits, id: string): LetterEditResult {
  if (!e.versions.some((v) => v.id === id)) return { error: "We couldn't find that version." };
  if (e.current === id) return { edits: e, changed: false };
  return { edits: { ...e, current: id, undoStack: [...e.undoStack, e.current] }, changed: true };
}

export const letterVersionFacts = (v: Pick<LetterVersion, "decisions">): ConfirmedFact[] => Object.values(v.decisions).flatMap((d) => (kept(d) ? d.facts : []));

/** The payload's own fields, from the selected version: the only place they're written once edits exist. Returns the row's score. */
export function syncLetter(p: CoverLetterPayload, edits: LetterEdits): number | null {
  const doc = letterDocumentOf(edits, currentLetterVersion(edits));
  const r = doc.review;
  p.edits = edits;
  p.letterText = doc.text;
  p.paragraphs = doc.paragraphs;
  Object.assign(p, derivedFields(doc.text, r));
  return r.score;
}

/** The older fields a report has always carried, so anything reading them sees this assessment and no other. */
export function derivedFields(text: string, r: LetterDocument["review"]) {
  return {
    review: r,
    checks: r.areas.map((a) => ({ ok: a.status === "passed" || a.status === "not_applicable", t: a.label, d: a.explanation })),
    keywordsUsed: [...new Set(r.requirements.flatMap((q) => (q.letter && q.term && q.level !== "absent" && text.toLowerCase().includes(q.term.toLowerCase()) ? [q.term] : [])))],
    keywordsMissing: r.requirements.filter((q) => q.level === "absent" && q.counted).map((q) => q.label),
    words: r.length.words,
    paras: readLetter(text).body.length,
    summary: letterSummary(r),
    assessment: letterReviewAssessment(r),
  };
}

/* ---------- Downloads ---------- */

export interface ReadinessItem {
  kind: "placeholder" | "name" | "claim";
  text: string;
}

export type LetterExport = { kind: "unknown-version" } | { kind: "review"; documentVersion: string; items: ReadinessItem[] } | { kind: "ready"; text: string; documentVersion: string; versionN: number | null };

/** What a download contains: the selected version, or the one asked for, and never one with gaps not yet looked at. */
export function letterExport(p: CoverLetterPayload, versionId?: string | null): LetterExport {
  const retained = (d: string) => (p.retainedPlaceholders ?? []).some((r) => r.documentVersion === d);
  const e = p.edits;
  if (!e) {
    if (versionId) return { kind: "unknown-version" };
    const dv = documentVersion(p.letterText);
    const items = placeholdersIn(p.letterText).map((text): ReadinessItem => ({ kind: "placeholder", text }));
    return items.length && !retained(dv) ? { kind: "review", documentVersion: dv, items } : { kind: "ready", text: p.letterText, documentVersion: dv, versionN: null };
  }
  const v = versionId ? e.versions.find((x) => x.id === versionId) : currentLetterVersion(e);
  if (!v) return { kind: "unknown-version" };
  const doc = letterDocumentOf(e, v);
  const items: ReadinessItem[] = doc.review.placeholders.map((text) => ({ kind: "placeholder", text }));
  const { expected, found } = doc.review.signedName;
  if (expected && found && expected.toLowerCase() !== found.toLowerCase()) items.push({ kind: "name", text: `It's signed “${found}”, but your CV says “${expected}”.` });
  for (const c of e.aiClaims) if (doc.paragraphs.some((x) => x.text === c.text)) for (const i of c.issues) items.push({ kind: "claim", text: i.message });
  return items.length && !retained(doc.documentVersion) ? { kind: "review", documentVersion: doc.documentVersion, items } : { kind: "ready", text: doc.text, documentVersion: doc.documentVersion, versionN: v.n };
}

/* ---------- What the page shows ---------- */

export interface LetterSuggestionView {
  id: string;
  kind: LetterSuggestion["kind"];
  paragraph: number;
  where: string;
  status: "pending" | "accepted" | "edited" | "rejected";
  origin: LetterSuggestion["origin"];
  proposed: string;
  text: string | null;
  reason: string;
  diff: DiffPart[];
  check: SavedCheck;
  /** The passage has gone, because a later edit changed it. */
  unplaceable: boolean;
}

export interface LetterView {
  revision: number | null;
  versionN: number;
  documentVersion: string;
  paragraphs: { slot: number | null; text: string; src: string[]; insertedBy: string | null }[];
  header: string;
  suggestions: LetterSuggestionView[];
  versions: { id: string; n: number; at: string; label: string; score: number | null; current: boolean; sameMethod: boolean }[];
  canUndo: boolean;
  /** Why the assessment on screen may not hold for today's CV or method. */
  stale: "cv-changed" | "cv-deleted" | "older-method" | null;
  firstScore: number | null;
  withheld: LetterEdits["withheld"];
  note: string | null;
  download: { ready: boolean; items: ReadinessItem[] };
}

export function letterView(p: CoverLetterPayload, cv: Pick<CvReviewPayload, "text" | "analysis"> | null): LetterView | null {
  const e = p.edits;
  if (!e) return null;
  const v = currentLetterVersion(e);
  const doc = letterDocumentOf(e, v);
  const base = baseLetter(e);
  const built = buildParagraphs(base.paragraphs, e.suggestions, v.decisions);
  const scoreOf = (x: LetterVersion) => letterDocumentOf(e, x).review.score;
  const stale = doc.scoringVersion !== LETTER_REVIEW_VERSION ? "older-method" : p.cvReportId && !cv ? "cv-deleted" : cv && doc.review.cvVersion !== documentVersion(baseDocument(cv).text) ? "cv-changed" : null;
  const suggestions = v.shown.map((id): LetterSuggestionView => {
    const s = e.suggestions.find((x) => x.id === id)!;
    const d = v.decisions[id];
    const open = !kept(d) && d?.status !== "rejected";
    const trial = open && s.kind === "replace" ? buildParagraphs(base.paragraphs, e.suggestions, { ...v.decisions, [id]: { status: "accepted", text: s.proposed, confirmed: [], facts: [], at: "" } }).missing.some((x) => x.id === id) : false;
    const before = s.kind === "own" || s.kind === "delete" ? base.paragraphs[s.paragraph]?.text ?? "" : s.before;
    const after = s.kind === "delete" ? "" : (kept(d) ? d.text : s.proposed);
    return { id, kind: s.kind, paragraph: s.paragraph, where: `Paragraph ${s.paragraph + 1}`, status: d?.status ?? "pending", origin: s.origin, proposed: s.proposed, text: kept(d) ? d.text : null, reason: s.reason, diff: wordDiff(before, after), check: s.check, unplaceable: trial };
  });
  const out = letterExport(p);
  return {
    revision: p.editRevision ?? null,
    versionN: v.n,
    documentVersion: doc.documentVersion,
    paragraphs: built.paragraphs.map((x) => ({ slot: x.slot, text: x.text, src: x.src, insertedBy: x.insertedBy ?? null })),
    header: e.header,
    suggestions,
    versions: e.versions.map((x) => ({ id: x.id, n: x.n, at: x.at, label: x.label, score: scoreOf(x), current: x.id === e.current, sameMethod: x.scoringVersion === v.scoringVersion })).reverse(),
    canUndo: e.undoStack.length > 0,
    stale,
    firstScore: letterDocumentOf(e, e.versions[0]).review.score,
    withheld: e.withheld,
    note: e.note,
    download: out.kind === "review" ? { ready: false, items: out.items } : { ready: true, items: [] },
  };
}

export { letterInventory };
