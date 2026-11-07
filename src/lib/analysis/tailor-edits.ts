import type { ConfirmedFact, CvReviewPayload, EvidenceLevel, JobMatch, LineResult, RequirementInterpretation, SavedCheck, TailorDecision, TailorDocument, TailorEdits, TailorPayload, TailorSuggestion, TailorVersion } from "@/lib/types";
import { bracketsIn, buildClaimInventory, type ClaimInventory } from "./claims";
import { documentVersion } from "./findings";
import { JOB_SCORING_VERSION, remeasure } from "./job-match";
import { checkProfile, checkRewrite, checkSkill, forTypedText, type RewriteCheck } from "./rewrite-check";
import { advertTerms, buildTailoredDocument, withSavedLines, type LineEdit } from "./tailor";
import { wordDiff, type DiffPart } from "./word-diff";

// OP-014, OP-016: suggestions, the student's decisions and the versions they make. Pure. A suggestion changes nothing until
// the student keeps it; keeping or dropping one makes a new version whose document is built from the decisions and measured
// as written, so a displayed result can't be for different words. `jobMatch` on the payload stays the original assessment.

/** Distinct documents kept per report. Each holds a whole CV and its assessment. */
export const MAX_DOCUMENTS = 30;
export const VERSION_LIMIT = "You've made a lot of versions of this tailoring. Start a new one from “Change job ad” to keep going.";

/** Model-written terms saved before they were checked against the advert: what a page may show of them. Changes nothing saved. */
export function presentTailor<T extends Pick<TailorPayload, "jobText" | "notEvidenced" | "tailored">>(p: T): T {
  return {
    ...p,
    notEvidenced: p.notEvidenced && advertTerms(p.notEvidenced, p.jobText),
    tailored: p.tailored?.map((t) => ("keywords" in t && t.keywords ? { ...t, keywords: advertTerms(t.keywords, p.jobText) } : t)) ?? p.tailored,
  } as T;
}

export type EditResult = { edits: TailorEdits; changed: boolean } | { error: string };

const kept = (d: TailorDecision | undefined): d is TailorDecision & { text: string } => !!d && d.status !== "rejected" && !!d.text;

export const currentVersion = (e: TailorEdits): TailorVersion => e.versions.find((v) => v.id === e.current)!;
export const documentOf = (e: TailorEdits, v: Pick<TailorVersion, "documentVersion" | "scoringVersion">): TailorDocument => e.documents.find((d) => d.documentVersion === v.documentVersion && d.match.version === v.scoringVersion)!;
const baseTextOf = (e: TailorEdits, v: TailorVersion): string => e.documents.find((d) => d.documentVersion === v.baseVersion)!.text;

/** The CV the decisions apply to: as uploaded, plus any lines saved in the review. */
export function baseDocument(cv: Pick<CvReviewPayload, "text" | "analysis">): { text: string; version: string } {
  // Laid out as any built document is, so "nothing kept" hashes to this same version and a whitespace change can't look like an edit.
  const text = buildTailoredDocument(withSavedLines(cv.text, cv.analysis.lines), { summary: "", replacements: [], skills: [] }).text;
  return { text, version: documentVersion(text) };
}

/** The first version: nothing decided. An assessment of the CV as it stood, not of anything tailored. */
export function startEdits(seed: JobMatch, jobText: string, baseText: string, at: string): TailorEdits {
  const version = documentVersion(baseText);
  const match = seed.cvVersion === version ? seed : remeasure(seed, jobText, baseText);
  return {
    generation: 0,
    suggestions: [],
    documents: [{ documentVersion: version, text: baseText, match }],
    versions: [{ id: "v1", n: 1, at, action: "start", label: "Your CV before tailoring", documentVersion: version, scoringVersion: match.version, baseVersion: version, shown: [], decisions: {} }],
    current: "v1",
    undoStack: [],
    withheld: [],
    prompts: [],
    note: null,
  };
}

/** The document these decisions make, from the base. `missing` names decisions that couldn't be placed. */
export function buildDocument(baseText: string, suggestions: TailorSuggestion[], decisions: Record<string, TailorDecision>): { text: string; missing: TailorSuggestion[] } {
  const replacements = new Map<string, { edit: LineEdit; owners: TailorSuggestion[] }>();
  let summary = "";
  const skills: string[] = [];
  const slot = (s: TailorSuggestion) => {
    const key = `${s.before}\u0000${s.occurrence}`;
    if (!replacements.has(key)) replacements.set(key, { edit: { from: s.before, occurrence: s.occurrence, add: [] }, owners: [] });
    const r = replacements.get(key)!;
    r.owners.push(s);
    return r.edit;
  };
  for (const s of suggestions) {
    const d = decisions[s.id];
    if (!kept(d)) continue;
    if (s.kind === "bullet") slot(s).to = d.text;
    else if (s.kind === "new-line") slot(s).add!.push(d.text);
    else if (s.kind === "summary") summary = d.text;
    else skills.push(d.text);
  }
  const edits = [...replacements.values()];
  const built = buildTailoredDocument(baseText, { summary, replacements: edits.map((e) => e.edit), skills });
  const missing = edits.filter((e) => built.missing.includes(e.edit)).flatMap((e) => e.owners);
  return { text: built.text, missing };
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

interface Move {
  action: TailorVersion["action"];
  label: string;
  decisions: Record<string, TailorDecision>;
  shown: string[];
  baseVersion?: string;
}

/** Makes the version for a move: builds its document, measures it, selects it. Nothing changes if the words and decisions are the same. */
export function applyMove(edits: TailorEdits, seed: JobMatch, jobText: string, move: Move, at: string): EditResult {
  const cur = currentVersion(edits);
  const baseVersion = move.baseVersion ?? cur.baseVersion;
  const base = edits.documents.find((d) => d.documentVersion === baseVersion);
  if (!base) return { error: "We couldn't find the CV this version is based on." };
  const built = buildDocument(base.text, edits.suggestions, move.decisions);
  if (built.missing.length) return { error: `We couldn't find this line in your CV to change it: “${built.missing[0].before.slice(0, 80)}”. Nothing was saved.` };
  const flat = squash(built.text);
  for (const [id, d] of Object.entries(move.decisions)) if (kept(d) && !flat.includes(squash(d.text))) return { error: `We couldn't put “${d.text.slice(0, 80)}” into your CV, so nothing was saved (${id}).` };
  const version = documentVersion(built.text);
  const same = version === cur.documentVersion && baseVersion === cur.baseVersion && JSON.stringify(move.shown) === JSON.stringify(cur.shown) && sameDecisions(move.decisions, cur.decisions);
  if (same) return { edits, changed: false };
  let documents = edits.documents;
  let doc = documents.find((d) => d.documentVersion === version && d.match.version === JOB_SCORING_VERSION);
  if (!doc) {
    if (documents.length >= MAX_DOCUMENTS) return { error: VERSION_LIMIT };
    doc = { documentVersion: version, text: built.text, match: remeasure(seed, jobText, built.text) };
    documents = [...documents, doc];
  }
  const n = edits.versions.reduce((m, v) => Math.max(m, v.n), 0) + 1;
  const next: TailorVersion = { id: `v${n}`, n, at, action: move.action, label: move.label, documentVersion: version, scoringVersion: doc.match.version, baseVersion, shown: move.shown, decisions: move.decisions };
  return { edits: { ...edits, documents, versions: [...edits.versions, next], current: next.id, undoStack: [...edits.undoStack, cur.id] }, changed: true };
}

const decisionKey = (d: TailorDecision) => JSON.stringify([d.status, d.text, [...d.confirmed].sort()]);
function sameDecisions(a: Record<string, TailorDecision>, b: Record<string, TailorDecision>) {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && decisionKey(a[k]) === decisionKey(b[k]));
}

/** Goes back to the version selected before the last move. */
export function undo(edits: TailorEdits): EditResult {
  const to = edits.undoStack[edits.undoStack.length - 1];
  if (!to) return { error: "There's nothing to undo." };
  return { edits: { ...edits, current: to, undoStack: edits.undoStack.slice(0, -1) }, changed: true };
}

/** Selects an earlier version. Undo returns to the one selected now. */
export function restore(edits: TailorEdits, id: string): EditResult {
  if (!edits.versions.some((v) => v.id === id)) return { error: "We couldn't find that version." };
  if (edits.current === id) return { edits, changed: false };
  return { edits: { ...edits, current: id, undoStack: [...edits.undoStack, edits.current] }, changed: true };
}

/** The payload's own fields, from the selected version: the only place they're written once edits exist. */
export function syncPayload(p: TailorPayload, edits: TailorEdits): void {
  const v = currentVersion(edits);
  const doc = documentOf(edits, v);
  const revised = v.documentVersion !== v.baseVersion;
  const shown = v.shown.map((id) => edits.suggestions.find((s) => s.id === id)!);
  const after = (s: TailorSuggestion) => v.decisions[s.id]?.text ?? s.proposed;
  const open = shown.filter((s) => v.decisions[s.id]?.status !== "rejected");
  const bullets = open.filter((s) => s.kind === "bullet" || s.kind === "new-line");
  p.edits = edits;
  p.tailoredCv = revised ? doc.text : null;
  p.matchTailored = revised ? doc.match.coverage.score : null;
  p.tailored = bullets.length ? bullets.map((s) => ({ where: s.where, before: s.before, after: after(s), keywords: s.keywords })) : edits.prompts.length ? edits.prompts : null;
  p.summary = open.find((s) => s.kind === "summary") ? after(open.find((s) => s.kind === "summary")!) : null;
  p.skillsToAdd = open.filter((s) => s.kind === "skill").map(after);
  p.aiTailored = shown.some((s) => s.origin === "ai");
}

/* ---------- Facts ---------- */

/** What the student has confirmed in a CV review, for as long as the saved line that established it stands. */
export const cvFacts = (cv: Pick<CvReviewPayload, "analysis">): ConfirmedFact[] => cv.analysis.lines.flatMap((l) => (l.accepted ? (l.acceptedCheck?.facts ?? []) : []));

/** Facts from the selected version's kept decisions. Undoing the decision withdraws them. */
export const versionFacts = (v: Pick<TailorVersion, "decisions">): ConfirmedFact[] => Object.values(v.decisions).flatMap((d) => (kept(d) ? d.facts : []));

export const saveCheck = (c: RewriteCheck): SavedCheck => ({
  validator: c.validator,
  verdict: c.verdict === "confirm" ? "confirm" : "pass",
  issues: c.issues.filter((i) => i.severity !== "block").map((i) => ({ code: i.code, severity: i.severity === "note" ? "note" : "confirm", found: i.found, key: i.key, message: i.message, ...(i.from ? { from: i.from } : {}) })),
  used: c.used.map((u) => ({ kind: u.kind, value: u.value, heading: u.heading, ...(u.student ? { student: true } : {}) })),
  questions: c.questions,
});

/** Checks text for a suggestion's slot against the inventory as it stands now. Text the student typed gets the typed rules. */
export function checkFor(inv: ClaimInventory, s: Pick<TailorSuggestion, "kind" | "lineIndex" | "before" | "entryId">, lines: Pick<LineResult, "text">[], text: string, typed: boolean): RewriteCheck {
  const raw =
    s.kind === "summary"
      ? checkProfile(inv, text)
      : s.kind === "skill"
        ? checkSkill(inv, text)
        : s.kind === "new-line"
          ? checkRewrite(inv, { index: -1, text: "", entryId: s.entryId ?? "" }, text)
          : checkRewrite(inv, { index: s.lineIndex!, text: s.before, locate: lines[s.lineIndex!]?.text }, text);
  return typed ? forTypedText(raw) : raw;
}

/* ---------- Placeholders ---------- */

/** Brackets in a document that weren't already in the student's own CV: blanks still to fill. */
export function unresolvedPlaceholders(text: string, baseText: string): string[] {
  const own: string[] = [...bracketsIn(baseText)];
  const out: string[] = [];
  for (const b of bracketsIn(text)) {
    const at = own.indexOf(b);
    if (at >= 0) own.splice(at, 1);
    else out.push(b);
  }
  return out;
}

export type TailorExport =
  | { kind: "none" }
  | { kind: "unknown-version" }
  | { kind: "placeholders"; documentVersion: string; placeholders: string[] }
  | { kind: "ready"; text: string; documentVersion: string; versionN: number | null };

/** What a download contains: the selected version, or the one asked for, and never one with blanks not yet reviewed. */
export function tailoredExport(p: TailorPayload, versionId?: string | null): TailorExport {
  const retained = (d: string) => (p.retainedPlaceholders ?? []).some((r) => r.documentVersion === d);
  const e = p.edits;
  if (!e) {
    if (versionId) return { kind: "unknown-version" };
    if (!p.tailoredCv) return { kind: "none" };
    const dv = documentVersion(p.tailoredCv);
    const open = bracketsIn(p.tailoredCv);
    return open.length && !retained(dv) ? { kind: "placeholders", documentVersion: dv, placeholders: open } : { kind: "ready", text: p.tailoredCv, documentVersion: dv, versionN: null };
  }
  const v = versionId ? e.versions.find((x) => x.id === versionId) : currentVersion(e);
  if (!v) return { kind: "unknown-version" };
  if (v.documentVersion === v.baseVersion) return { kind: "none" };
  const doc = documentOf(e, v);
  const open = unresolvedPlaceholders(doc.text, baseTextOf(e, v));
  if (open.length && !retained(doc.documentVersion)) return { kind: "placeholders", documentVersion: doc.documentVersion, placeholders: open };
  return { kind: "ready", text: doc.text, documentVersion: doc.documentVersion, versionN: v.n };
}

/* ---------- What the page shows ---------- */

export interface SuggestionView {
  id: string;
  kind: TailorSuggestion["kind"];
  where: string;
  before: string;
  proposed: string;
  /** The words kept, when kept. */
  text: string | null;
  status: "pending" | "accepted" | "edited" | "rejected";
  origin: TailorSuggestion["origin"];
  keywords: string[];
  note: string | null;
  diff: DiffPart[];
  /** Checked against the CV and the student's confirmations as they are now. Null when the CV has been deleted. */
  check: SavedCheck | null;
  /** The generated words no longer pass, so they can't be kept as they are. */
  blocked: string | null;
  /** Measured on a copy with only this one added. Not saved, and only ever labelled as hypothetical. */
  preview: { score: number | null; gains: string[] } | null;
}

export interface MatchSummary {
  documentVersion: string;
  score: number | null;
  status: JobMatch["coverage"]["status"];
  explanation: string;
  essentialGaps: string[];
  essentialThin: string[];
  /** Assessed under a different method than the current one. */
  olderMethod: boolean;
}

export interface EditView {
  revision: number | null;
  versionId: string;
  versionN: number;
  versionLabel: string;
  isRevised: boolean;
  before: MatchSummary;
  after: MatchSummary | null;
  changes: { label: string; from: EvidenceLevel; to: EvidenceLevel }[];
  suggestions: SuggestionView[];
  withheld: TailorEdits["withheld"];
  prompts: TailorEdits["prompts"];
  note: string | null;
  history: { id: string; n: number; at: string; label: string; score: number | null; documentVersion: string; current: boolean; revised: boolean }[];
  undoLabel: string | null;
  stale: { code: "base-changed" | "cv-deleted" | "older-method"; message: string }[];
  placeholders: { items: string[]; retained: boolean };
  text: string | null;
  /** For the student's own edits. */
  lines: { index: number; where: string; text: string }[];
  entries: { entryId: string; heading: string; anchor: number }[];
  facts: { value: string; heading: string | null; how: string; at: string }[];
}

const summarise = (m: JobMatch): MatchSummary => ({ documentVersion: m.cvVersion, score: m.coverage.score, status: m.coverage.status, explanation: m.coverage.explanation, essentialGaps: m.essentialGaps, essentialThin: m.essentialThin, olderMethod: m.version !== JOB_SCORING_VERSION });

export const interpretationsNow = (p: Pick<TailorPayload, "interpretations">): RequirementInterpretation[] => (p.interpretations ?? []).filter((i) => !i.withdrawnAt);

/** Entries a student can add a line under: those with a scored line to place it after. */
export function addableEntries(cv: Pick<CvReviewPayload, "text" | "analysis">, inv: ClaimInventory) {
  return inv.entries.flatMap((e) => {
    const anchors = e.bulletIndex.filter((b): b is number => b !== null && !!cv.analysis.lines[b]);
    return anchors.length ? [{ entryId: e.id, heading: e.heading, anchor: anchors[anchors.length - 1] }] : [];
  });
}

export function editView(p: TailorPayload, cv: Pick<CvReviewPayload, "text" | "analysis"> | null): EditView | null {
  const e = p.edits;
  if (!e || !p.jobMatch) return null;
  const v = currentVersion(e);
  const doc = documentOf(e, v);
  const revised = v.documentVersion !== v.baseVersion;
  const facts = [...(cv ? cvFacts(cv) : []), ...versionFacts(v)];
  const inv = cv ? buildClaimInventory(cv.text, facts) : null;
  const lines = cv?.analysis.lines ?? [];
  const base = e.documents.find((d) => d.documentVersion === v.baseVersion)!;
  const currentText = doc.text;

  const suggestions = v.shown.map((id): SuggestionView => {
    const s = e.suggestions.find((x) => x.id === id)!;
    const d = v.decisions[id];
    const words = d?.text ?? s.proposed;
    const fresh = inv && !kept(d) ? checkFor(inv, s, lines, s.proposed, s.origin === "student") : null;
    const pending = !d;
    let preview: SuggestionView["preview"] = null;
    if (pending && fresh && fresh.verdict !== "block") {
      const trial = buildDocument(base.text, e.suggestions, { ...v.decisions, [id]: { status: "accepted", text: s.proposed, confirmed: [], facts: [], at: "" } });
      if (!trial.missing.length) {
        const m = remeasure(p.jobMatch!, p.jobText, trial.text);
        const gained = m.requirements.filter((r) => {
          const was = doc.match.requirements.find((x) => x.id === r.id);
          return was && was.evidence.level !== r.evidence.level;
        });
        preview = { score: m.coverage.score, gains: gained.map((r) => r.label) };
      }
    }
    return {
      id,
      kind: s.kind,
      where: s.where,
      before: s.before,
      proposed: s.proposed,
      text: kept(d) ? d.text : null,
      status: d?.status ?? "pending",
      origin: s.origin,
      keywords: s.origin === "ai" ? advertTerms(s.keywords, p.jobText) : s.keywords,
      note: s.note,
      diff: wordDiff(s.before, words),
      check: fresh ? (fresh.verdict === "block" ? null : saveCheck(fresh)) : kept(d) ? null : s.check,
      blocked: fresh?.verdict === "block" ? fresh.issues.find((i) => i.severity === "block")?.message ?? "This no longer passes our check." : null,
      preview,
    };
  });

  const stale: EditView["stale"] = [];
  if (!cv) stale.push({ code: "cv-deleted", message: "The CV this came from has been deleted. What's here is what was measured at the time, and it can't be tailored further." });
  else if (baseDocument(cv).version !== v.baseVersion) stale.push({ code: "base-changed", message: "You've saved changes to lines of this CV since this version was made. They aren't in this document or its result. Choose “Tailor again” to include them." });
  if (doc.match.version !== JOB_SCORING_VERSION) stale.push({ code: "older-method", message: "This version was measured with an earlier method, so its number may not compare with a new one." });

  const placeholders = revised ? unresolvedPlaceholders(currentText, base.text) : [];
  const originalMatch = p.jobMatch;
  const to = e.undoStack[e.undoStack.length - 1];
  return {
    revision: p.editRevision ?? null,
    versionId: v.id,
    versionN: v.n,
    versionLabel: v.label,
    isRevised: revised,
    before: summarise(originalMatch),
    after: revised ? summarise(doc.match) : null,
    changes: revised
      ? doc.match.requirements.flatMap((r) => {
          const was = originalMatch.requirements.find((x) => x.id === r.id);
          return was && was.evidence.level !== r.evidence.level ? [{ label: r.label, from: was.evidence.level, to: r.evidence.level }] : [];
        })
      : [],
    suggestions,
    withheld: e.withheld,
    prompts: e.prompts,
    note: e.note,
    history: [...e.versions].reverse().map((x) => {
      const d = documentOf(e, x);
      return { id: x.id, n: x.n, at: x.at, label: x.label, score: d.match.coverage.score, documentVersion: x.documentVersion, current: x.id === v.id, revised: x.documentVersion !== x.baseVersion };
    }),
    undoLabel: to ? (e.versions.find((x) => x.id === to)?.label ?? null) : null,
    stale,
    placeholders: { items: placeholders, retained: (p.retainedPlaceholders ?? []).some((r) => r.documentVersion === v.documentVersion) },
    text: revised ? currentText : null,
    lines: lines.map((l, index) => ({ index, where: l.where, text: l.accepted ?? l.text })),
    entries: inv && cv ? addableEntries(cv, inv) : [],
    facts: facts.map((f) => ({ value: f.value, heading: f.entryHeading, how: f.provenance.how, at: f.provenance.at })),
  };
}
