import type { ConfirmedFact, FactKind } from "@/lib/types";
import {
  blankBrackets,
  factWords,
  bracketsIn,
  buildClaimInventory,
  figuresIn,
  isPlaceholder,
  leadWordsIn,
  MONTHS,
  namesIn,
  normaliseText,
  opensWithSharedVerb,
  qualificationsIn,
  readsLikeInstructions,
  responsibilityOf,
  saysItWasShared,
  stemsIn,
  toolsIn,
  withoutInstructions,
  wordsIn,
  type Claim,
  type ClaimInventory,
  type CvEntry,
  type FoundFigure,
} from "./claims";

// OP-015: checks a suggested rewrite against what the CV says for that entry. It runs on the text of the suggestion and
// nothing else: the model's output has no way to mark itself as checked, and a CV's contents are never read as
// instructions. It is a set of deterministic rules, so it catches what the rules describe and misses what they don't
// (see the batch report): new detail in plain lower-case words, synonyms, and meaning changes without a marker word.

/** Bump when a rule changes: a saved confirmation records which rules it was made under. */
export const REWRITE_CHECK_VERSION = "rewrite-check-2026-11-06.1";

/** The rule engine's whole answer when a line needs no change. Only this exact text gets the no-change treatment. */
export const ALREADY_STRONG = "This line is already strong. No rewrite needed.";

export type IssueCode =
  | "unsupported-figure"
  | "figure-from-other-entry"
  | "figure-from-other-line"
  | "figure-unit-changed"
  | "figure-noun-changed"
  | "vague-quantity"
  | "unsupported-date"
  | "date-from-other-entry"
  | "unsupported-entity"
  | "entity-from-other-entry"
  | "entity-elsewhere-in-cv"
  | "unsupported-qualification"
  | "responsibility-raised"
  | "unsupported-outcome"
  | "scope-inflated"
  | "mostly-new-content"
  | "unrelated"
  | "invalid-placeholder"
  | "not-a-cv-line"
  | "dropped-figure"
  // A statement about the employer that isn't in the advert or the student's notes (cover letters only, letter-check.ts).
  | "unsupported-employer-fact";

/** block: not offered. confirm: offered only once the student says it's true. note: offered, and mentioned. */
export type IssueSeverity = "block" | "confirm" | "note";

export interface RewriteIssue {
  code: IssueCode;
  severity: IssueSeverity;
  /** What the suggestion said, as written. Empty when repeating it would not help. */
  found: string;
  /** Stable for the same finding on the same text: what a confirmation refers to. */
  key: string;
  message: string;
  /** Where the suggestion's text is, for a placeholder repair. */
  span?: [number, number];
  placeholder?: string;
  /** The heading of the entry the figure or name really belongs to. */
  from?: string;
}

export interface RewriteCheck {
  validator: string;
  verdict: "pass" | "confirm" | "block";
  issues: RewriteIssue[];
  /** The source claims this suggestion relies on, each tied to its entry. */
  used: { kind: Claim["kind"]; value: string; entryId: string; heading: string; quote: string; student?: boolean }[];
  /** Focused questions for each placeholder left in the suggestion. */
  questions: string[];
  /** The suggestion says the same as the source, or asks for no change. */
  unchanged: boolean;
  /** The entry the line was matched to, or null when the line couldn't be placed in the CV. */
  entry: { id: string; heading: string } | null;
  /** Part of the source line reads like instructions to software, so it gave no evidence. */
  sourceHadInstructions: boolean;
}

export interface LineRef {
  /** Position in CvAnalysis.lines. */
  index: number;
  /** The line's text in the report: the student's source for this suggestion. */
  text: string;
  /** The text to place it in the CV by, when `text` has since been edited (the tailoring path's accepted text). */
  locate?: string;
  /** For a line the student is adding: the entry it goes under, which has no line of its own to compare with. */
  entryId?: string;
}

interface Evidence {
  entry: CvEntry | null;
  lineNo: number | null;
  /** The line as the student can be taken to claim it: instruction-like sentences removed. */
  line: string;
  /** The line plus what the student confirmed for it: what a suggestion may rely on. */
  claimed: string;
  /** Confirmed facts for this line. */
  facts: ConfirmedFact[];
  /** Nothing to compare level of involvement with, because the student is adding the line or it spans the CV. */
  noLevel?: boolean;
  /** Heading and surrounding text of the same entry. */
  context: string;
  sourceHadInstructions: boolean;
}

function evidenceFor(inv: ClaimInventory, ref: LineRef): Evidence {
  const wanted = normaliseText(ref.locate ?? ref.text).replace(/\s+/g, " ").trim();
  const same = (s: string) => normaliseText(s).replace(/\s+/g, " ").trim() === wanted;
  // The position first, because the same words can appear under two roles; the words if the report predates this parser.
  const bullet = inv.bullets[ref.index] && same(inv.bullets[ref.index].raw) ? inv.bullets[ref.index] : inv.bullets.find((b) => b && same(b.raw));
  const entry = ref.entryId !== undefined ? inv.entries.find((e) => e.id === ref.entryId) ?? null : bullet ? inv.entries.find((e) => e.id === bullet.entryId) ?? null : null;
  const cleaned = withoutInstructions(ref.text);
  const facts = ref.entryId !== undefined ? inv.facts.filter((f) => f.scope === "entry" && f.entryId === ref.entryId) : inv.facts.filter((f) => f.scope === "line" && f.lineText !== null && same(f.lineText) && (f.entryId === (entry?.id ?? null)));
  return {
    entry,
    lineNo: ref.entryId !== undefined ? null : bullet?.line ?? null,
    line: cleaned.text,
    claimed: [cleaned.text, ...facts.map(factWords)].join("\n"),
    facts,
    noLevel: ref.entryId !== undefined,
    context: entry ? `${entry.heading}\n${entry.context}` : "",
    sourceHadInstructions: cleaned.removed > 0,
  };
}

/* ---------- Word lists for the checks ---------- */

// Group present in the source means the outcome isn't new; matched by prefix so every form of the word counts.
const OUTCOME_STARTS = ["increas", "boost", "grew", "grow", "improv", "reduc", "cut(?=s?\\b|ting\\b)", "saved", "saving", "rais", "generated", "generating", "won\\b", "achiev", "exceed", "surpass", "beat", "result", "leading to", "led to", "secured", "securing", "strengthen", "maximis", "maximiz", "optimis", "optimiz", "accelerat", "transform", "enhanc", "revenue"];
const SCOPE_WORDS = ["international", "internationally", "global", "globally", "worldwide", "nationwide", "national", "company-wide", "organisation-wide", "university-wide", "award-winning", "flagship", "senior", "executive", "strategic", "board-level", "cross-functional", "multi-million", "record-breaking", "largest", "best", "top-performing", "first-ever", "single-handedly", "solely", "independently", "personally", "sole", "entire", "enterprise", "high-profile"];
const VAGUE_COUNT_WORDS = ["several", "numerous", "multiple", "many", "various", "countless", "extensive"];
const STOPWORDS = new Set("a an and are as at be been but by for from has have in into is it its of on or our that the their them they this to was we were which while who will with within my i per via across over under through using used use including".split(" "));

const has = (text: string, phrase: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${phrase.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`, "iu").test(text);
const outcomeIn = (text: string, start: string) => new RegExp(`(^|[^\\p{L}\\p{N}])(${start}[\\p{L}]*)`, "iu").exec(text);

const short = (s: string) => (s.length > 40 ? `${s.slice(0, 37)}…` : s);
const whichEntry = (e: CvEntry) => `"${short(e.heading)}"`;

/* ---------- Figures ---------- */

const sameUnit = (a: FoundFigure, b: FoundFigure) => a.unit === b.unit;
const placeholderFor = (f: FoundFigure) => (f.kind === "date" ? "[year]" : f.unit === "%" ? "[X%]" : f.unit ? `[${f.unit}X]` : f.vague ? "[number]" : "[X]");

function checkFigures(rewrite: string, ev: Evidence, inv: ClaimInventory, issues: RewriteIssue[]): FoundFigure[] {
  const lineFigures = figuresIn(ev.claimed);
  const contextFigures = figuresIn(ev.context);
  // A confirmed figure belongs where it was confirmed: elsewhere in the entry it's asked about, and in another role it's refused.
  const own = new Set(ev.facts.map(factWords));
  const otherLines = [...(ev.entry?.lines ?? []).filter((_, n) => n !== ev.lineNo), ...(ev.entry?.factValues ?? []).filter((v) => !own.has(v))].flatMap(figuresIn);
  const others = inv.entries.filter((e) => e !== ev.entry).map((e) => ({ entry: e, figures: [...figuresIn(`${e.heading}\n${e.context}`), ...e.lines.flatMap(figuresIn), ...e.factValues.flatMap(figuresIn)] }));
  const stems = stemsIn(ev.claimed);
  const used: FoundFigure[] = [];

  const push = (code: IssueCode, severity: IssueSeverity, f: FoundFigure, message: string, from?: string, repairable = severity === "block" && !f.verb) =>
    issues.push({ code, severity, found: f.raw, key: `${code}:${f.raw.toLowerCase()}`, message, span: repairable ? [f.start, f.end] : undefined, placeholder: repairable ? placeholderFor(f) : undefined, from });

  for (const f of figuresIn(rewrite)) {
    const here = lineFigures.filter((x) => x.value === f.value);
    const exact = here.find((x) => sameUnit(x, f));
    if (exact) {
      used.push(f);
      // "12 students" to "12 managers": the same number now counts something else.
      if (f.noun && exact.noun && f.noun !== exact.noun && !stems.has(f.noun)) push("figure-noun-changed", "confirm", f, `Your line uses ${exact.raw} to count something else. Is the suggestion's use of it accurate?`);
      continue;
    }
    if (here.length) {
      const was = here[0];
      if (was.unit && f.unit) push("figure-unit-changed", "block", f, `Your line says ${was.raw}, not ${f.raw}.`);
      else push("figure-unit-changed", "confirm", f, `Your line says ${was.raw}, and the suggestion says ${f.raw}. Is that the same figure?`);
      used.push(f);
      continue;
    }
    const inContext = contextFigures.find((x) => x.value === f.value && (sameUnit(x, f) || f.kind === "date"));
    if (inContext) {
      used.push(f);
      continue;
    }
    if (otherLines.some((x) => x.value === f.value && sameUnit(x, f))) {
      push("figure-from-other-line", "confirm", f, `${f.raw} comes from another line under this entry. Does it belong to this one too?`);
      continue;
    }
    const elsewhere = others.find((o) => o.figures.some((x) => x.value === f.value));
    if (f.kind === "date") {
      if (elsewhere) push("date-from-other-entry", "block", f, `${f.raw} belongs to ${whichEntry(elsewhere.entry)}, not this entry.`, elsewhere.entry.heading);
      else push("unsupported-date", "block", f, `Your CV doesn't give the date ${f.raw} for this entry.`);
    } else if (elsewhere) {
      push("figure-from-other-entry", "block", f, `${f.raw} belongs to ${whichEntry(elsewhere.entry)}, not this entry.`, elsewhere.entry.heading, !f.verb);
    } else {
      push(f.vague ? "vague-quantity" : "unsupported-figure", "block", f, `Your CV doesn't give ${f.raw} for this line.`, undefined, !f.verb);
    }
  }

  const text = blankBrackets(normaliseText(rewrite));
  for (const w of VAGUE_COUNT_WORDS) {
    if (has(text, w) && !has(ev.claimed, w) && !has(ev.context, w)) issues.push({ code: "vague-quantity", severity: "confirm", found: w, key: `vague-quantity:${w}`, message: `The suggestion says "${w}", which your line doesn't. Is that accurate?` });
  }

  // A number the source had and the suggestion lost isn't an invention, but the student should know.
  const kept = new Set(figuresIn(rewrite).map((f) => f.value));
  for (const f of figuresIn(ev.line)) {
    if (!kept.has(f.value) && f.kind === "figure" && !bracketsIn(rewrite).length) issues.push({ code: "dropped-figure", severity: "note", found: f.raw, key: `dropped-figure:${f.raw}`, message: `The suggestion leaves out ${f.raw} from your line.` });
  }
  return used;
}

/* ---------- Names, tools and qualifications ---------- */

function checkEntities(rewrite: string, ev: Evidence, inv: ClaimInventory, issues: RewriteIssue[]) {
  const text = blankBrackets(normaliseText(rewrite));
  const ownStems = stemsIn(`${ev.claimed}\n${ev.context}\n${(ev.entry?.lines ?? []).join("\n")}`);
  const known = (w: string) => w.split(/[\s./&'+#-]+/).filter(Boolean).every((p) => ownStems.has(p.toLowerCase()) || ownStems.has(stemsFirst(p)) || (MONTHS.test(p) && ownStems.has(p.slice(0, 3).toLowerCase())));
  const elsewhere = (w: string) => {
    const lower = w.toLowerCase();
    const inHeading = inv.entries.find((e) => e !== ev.entry && e.isRole && stemsIn(e.heading).has(lower));
    if (inHeading) return { entry: inHeading, heading: true };
    const inBody = inv.entries.find((e) => e !== ev.entry && stemsIn(`${e.heading}\n${e.context}\n${e.lines.join("\n")}\n${e.factValues.join("\n")}`).has(lower));
    return inBody ? { entry: inBody, heading: false } : null;
  };
  const seen = new Set<string>();

  const flag = (raw: string, severity: "block" | "confirm", what: "name" | "qualification") => {
    const key = raw.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const parts = key.split(/\s+/);
    const where = elsewhere(parts[parts.length - 1]);
    if (where?.heading) {
      issues.push({ code: "entity-from-other-entry", severity: "block", found: raw, key: `entity-from-other-entry:${key}`, message: `"${raw}" belongs to ${whichEntry(where.entry)}, not this entry.`, from: where.entry.heading });
    } else if (where) {
      issues.push({ code: "entity-elsewhere-in-cv", severity: "confirm", found: raw, key: `entity-elsewhere-in-cv:${key}`, message: `Your CV mentions "${raw}" under ${whichEntry(where.entry)}, but not for this entry. Did you use it here?`, from: where.entry.heading });
    } else if (what === "qualification") {
      issues.push({ code: "unsupported-qualification", severity: "block", found: raw, key: `unsupported-qualification:${key}`, message: `Your CV doesn't mention "${raw}".` });
    } else {
      issues.push({ code: "unsupported-entity", severity, found: raw, key: `unsupported-entity:${key}`, message: severity === "block" ? `Your CV doesn't mention "${raw}" for this entry.` : `"${raw}" isn't in your line. Is it accurate here?` });
    }
  };

  for (const q of qualificationsIn(text)) if (!known(q)) flag(q, "block", "qualification");
  for (const t of toolsIn(text)) if (!known(t)) flag(t, "block", "name");
  for (const n of namesIn(text)) {
    if (known(n.raw)) continue;
    if (MONTHS.test(n.raw)) {
      if (!n.initial) issues.push({ code: "unsupported-date", severity: "block", found: n.raw, key: `unsupported-date:${n.raw.toLowerCase()}`, message: `Your CV doesn't give ${n.raw} as a date for this entry.` });
      continue;
    }
    if (!n.initial || n.distinctive) flag(n.raw, "block", "name");
    else if (!isVerbLike(n.raw)) flag(n.raw, "confirm", "name");
  }
}

const stemsFirst = (w: string) => [...stemsIn(w)][0] ?? w;

// An opening word is expected to be a verb; one that doesn't look like a verb may be a name the capital can't reveal.
const IRREGULAR_VERBS = /^(built|led|lead|ran|run|wrote|write|won|taught|teach|drew|cut|set|made|make|grew|grow|sold|sell|spoke|kept|keep|gave|give|took|take|began|brought|held|hold|met|drove|drive|oversaw|oversee|sought|told|found|chose|went|lent|spent|sent|paid|did|put|read|dealt|jointly|co)$/i;
const isVerbLike = (w: string) => /(ed|ing|ise|ize|ate|ify|en)$/i.test(w) || IRREGULAR_VERBS.test(w) || COMMON_PRESENT.test(w);
const COMMON_PRESENT = /^(analyse|analyze|assist|audit|build|chair|coach|collect|conduct|contribute|create|deliver|design|develop|draft|edit|ensure|evaluate|help|identify|implement|improve|interview|launch|maintain|manage|mentor|monitor|negotiate|organise|organize|plan|prepare|present|produce|provide|publish|raise|recruit|reduce|research|resolve|review|respond|save|schedule|secure|support|test|track|train|translate|tutor|update|work|answer|attend|host)$/i;

/* ---------- Responsibility, outcomes and scope ---------- */

function checkResponsibility(rewrite: string, ev: Evidence, issues: RewriteIssue[]) {
  if (ev.noLevel) return;
  const before = responsibilityOf(ev.line);
  if (before === 3) return;
  const confirmed = ev.facts.filter((f) => f.kind === "responsibility");
  const clean = blankBrackets(normaliseText(rewrite));
  const newLead = leadWordsIn(clean)[0];
  // A confirmed "Organised" doesn't vouch for "Led": leading has to have been what was confirmed.
  if (newLead && confirmed.some((f) => leadWordsIn(f.value).length)) return;
  if (newLead) {
    issues.push({ code: "responsibility-raised", severity: "confirm", found: newLead, key: `responsibility-raised:${newLead}`, message: `The suggestion says "${newLead}", but your line says "${wordsIn(ev.line)[0] ?? "something smaller"}". Did you actually lead this?` });
    return;
  }
  // "Helped organise" to "Organised": the same word, but the help has gone.
  if (before < 2 && !confirmed.length && !opensWithSharedVerb(clean) && !saysItWasShared(clean)) {
    const first = wordsIn(clean)[0] ?? "";
    issues.push({ code: "responsibility-raised", severity: "confirm", found: first, key: `responsibility-raised:${first.toLowerCase()}`, message: `Your line says "${wordsIn(ev.line)[0] ?? "you helped"}", and the suggestion opens with "${first}", as if you did this yourself. Is that accurate?` });
  }
}

function checkOutcomes(rewrite: string, ev: Evidence, issues: RewriteIssue[]) {
  const original = normaliseText(rewrite);
  const text = blankBrackets(original);
  const lower = text.toLowerCase();
  const source = normaliseText(ev.claimed).toLowerCase();
  for (const p of OUTCOME_STARTS) {
    if (outcomeIn(source, p)) continue;
    const m = outcomeIn(lower, p);
    if (!m) continue;
    const at = m.index + m[1].length;
    // Close to a placeholder, the size is being asked for rather than stated.
    const window = original.slice(Math.max(0, at - 30), at + m[2].length + 45);
    if (/\[[^\]]*\]/.test(window)) continue;
    issues.push({ code: "unsupported-outcome", severity: "confirm", found: m[2], key: `unsupported-outcome:${m[2]}`, message: `The suggestion says "${m[2]}", but your line doesn't state that result. Did this happen, and can you back it up?` });
  }
  for (const w of SCOPE_WORDS) {
    if (has(lower, w) && !has(source, w)) issues.push({ code: "scope-inflated", severity: "confirm", found: w, key: `scope-inflated:${w}`, message: `The suggestion says "${w}", which your line doesn't. Is that accurate?` });
  }
}

function contentWords(s: string): string[] {
  return wordsIn(blankBrackets(normaliseText(s)).replace(/-/g, " ")).filter((w) => !STOPWORDS.has(w.toLowerCase()) && /\p{L}/u.test(w));
}

function checkContent(rewrite: string, ev: Evidence, issues: RewriteIssue[]) {
  const words = contentWords(rewrite);
  const source = stemsIn(`${ev.claimed}\n${ev.context}`);
  const isNew = words.filter((w) => !source.has(w.toLowerCase()) && ![...stemsIn(w)].some((s) => source.has(s)));
  const ownWords = contentWords(ev.line);
  if (ownWords.length && words.length >= 3 && isNew.length === words.length) {
    issues.push({ code: "unrelated", severity: "block", found: "", key: "unrelated", message: "This suggestion shares no words with your line, so it may describe something else." });
  } else if (words.length >= 5 && isNew.length / words.length > 0.7) {
    issues.push({ code: "mostly-new-content", severity: "confirm", found: "", key: "mostly-new-content", message: `Most of this suggestion's words aren't in your line, including "${isNew.slice(0, 3).join('", "')}". Does it still describe what you did?` });
  }
}

/* ---------- Shape of the output ---------- */

const MARKUP = /<[a-z!/][^>]*>|```|\{\{|\}\}/i;
const URL_LIKE = /\bhttps?:\/\/|\bwww\.|\b[\w.+-]+@[\w-]+\.[\w.]+/i;
const META = /\b(here(?:'s| is) (?:a|the|your)|rewritten (?:bullet|line|version)|this rewrite|the rewrite|as requested|i cannot|i can't|i'm sorry|validator|passed validation|verified by)\b/i;

function checkShape(rewrite: string, ev: Evidence, issues: RewriteIssue[], maxLength = 400) {
  const bad = (message: string, key: string) => issues.push({ code: "not-a-cv-line", severity: "block", found: "", key: `not-a-cv-line:${key}`, message });
  const n = normaliseText(rewrite);
  if (n.trim().length < 12 || !/\p{L}/u.test(n)) bad("This suggestion is too short to use.", "short");
  if (n.length > maxLength) bad("This suggestion is too long for one line of a CV.", "long");
  if (/[\n\r\t\x00-\x08]/.test(n.trim())) bad("This suggestion isn't a single line.", "lines");
  if (MARKUP.test(blankBrackets(n))) bad("This suggestion contains code or markup rather than a CV line.", "markup");
  if (readsLikeInstructions(n) || META.test(n)) bad("This suggestion talks about the writing process rather than your experience.", "meta");
  const link = URL_LIKE.exec(n);
  if (link && !normaliseText(ev.line).includes(link[0])) bad("This suggestion adds a link or an address that isn't in your line.", "link");
  for (const b of bracketsIn(n)) {
    if (!isPlaceholder(b)) issues.push({ code: "invalid-placeholder", severity: "block", found: b.length > 40 ? "" : b, key: `invalid-placeholder:${b.toLowerCase().slice(0, 40)}`, message: "This suggestion has something in brackets that isn't a clear placeholder for a missing fact.", span: [n.indexOf(b), n.indexOf(b) + b.length], placeholder: /%/.test(b) ? "[X%]" : /£/.test(b) ? "[£X]" : "[X]" });
  }
}

/* ---------- Questions for missing facts ---------- */

export function questionsFor(rewrite: string): string[] {
  const out: string[] = [];
  for (const raw of bracketsIn(normaliseText(rewrite))) {
    if (!isPlaceholder(raw)) continue;
    const p = raw.slice(1, -1).toLowerCase();
    const q = p.includes("%") ? "What was the real percentage change? Leave it out if you don't know it." : /[£$€]/.test(p) ? "What was the real amount? Leave it out if you don't know it." : p.includes("result") ? "What changed because of this work? Say so only if you can back it up." : /year|date|month/.test(p) ? "When was this? Use the date you can show." : /^(number|n|x|y|z)$/.test(p) ? "What's the real number here? Leave it out if you don't know it." : `What should go in place of [${raw.slice(1, -1)}]? Leave it out if you don't know it.`;
    if (!out.includes(q)) out.push(q);
  }
  return out.slice(0, 3);
}

/* ---------- The check ---------- */

const looksSame = (a: string, b: string) => normaliseText(a).replace(/[\s.]+/g, " ").trim().toLowerCase() === normaliseText(b).replace(/[\s.]+/g, " ").trim().toLowerCase();

function usedClaims(rewrite: string, ev: Evidence): RewriteCheck["used"] {
  if (!ev.entry) return [];
  const heading = ev.entry.heading;
  const text = normaliseText(blankBrackets(rewrite)).toLowerCase();
  const figures = new Set(figuresIn(rewrite).map((f) => (f.kind === "date" ? f.value : `${f.value}|${f.unit}`)));
  return ev.entry.claims
    .filter((c) => c.line === ev.lineNo || c.line === null)
    .filter((c) => (c.kind === "figure" || c.kind === "date" ? figures.has(c.normal) : c.kind === "entity" || c.kind === "qualification" ? has(text, c.normal) : false))
    .slice(0, 12)
    .map((c) => ({ kind: c.kind, value: c.value, entryId: c.entryId, heading, quote: c.quote, ...(c.student ? { student: true } : {}) }));
}

/**
 * Checks one suggestion for one line. Runs the same way on any text: a model's output, a rule's output or a saved
 * suggestion from before this check existed. Text the model returns can't affect the result except by what it says.
 */
export function checkRewrite(inv: ClaimInventory, ref: LineRef, rewrite: string): RewriteCheck {
  const ev = evidenceFor(inv, ref);
  const entry = ev.entry ? { id: ev.entry.id, heading: ev.entry.heading } : null;
  const base = { validator: REWRITE_CHECK_VERSION, entry, sourceHadInstructions: ev.sourceHadInstructions };
  const unchanged = rewrite === ALREADY_STRONG || looksSame(rewrite, ref.text);
  if (unchanged) return { ...base, verdict: "pass", issues: [], used: usedClaims(ref.text, ev), questions: [], unchanged: true };

  const issues: RewriteIssue[] = [];
  checkShape(rewrite, ev, issues);
  checkFigures(rewrite, ev, inv, issues);
  checkEntities(rewrite, ev, inv, issues);
  checkResponsibility(rewrite, ev, issues);
  checkOutcomes(rewrite, ev, issues);
  checkContent(rewrite, ev, issues);
  const verdict = issues.some((i) => i.severity === "block") ? "block" : issues.some((i) => i.severity === "confirm") ? "confirm" : "pass";
  return { ...base, verdict, issues, used: usedClaims(rewrite, ev), questions: questionsFor(rewrite), unchanged: false };
}

/**
 * Swaps unsupported figures and dates for placeholders, so a useful sentence can ask for the fact instead of stating
 * one. Returns null when that isn't all that's wrong with it: names and shape problems can't be fixed by a placeholder.
 */
export function withPlaceholders(rewrite: string, check: RewriteCheck): string | null {
  const blocks = check.issues.filter((i) => i.severity === "block");
  if (!blocks.length || blocks.some((i) => !i.span || !i.placeholder)) return null;
  let out = normaliseText(rewrite);
  for (const i of [...blocks].sort((a, b) => b.span![0] - a.span![0])) out = out.slice(0, i.span![0]) + i.placeholder + out.slice(i.span![1]);
  return out.replace(/\s+/g, " ").trim();
}

export const confirmationsNeeded = (check: RewriteCheck) => check.issues.filter((i) => i.severity === "confirm").map((i) => i.key);

/* ---------- For the tailoring path ---------- */

/**
 * Reuse point for tailoring (OP-012/013/014): checks each drafted bullet against its own entry, not just against the
 * numbers on its line. `lines[i].text` is what the draft was written from, `lines[i].locate` the line as first scored.
 */
export function checkTailorBullets(cvText: string, lines: { text: string; locate?: string }[], bullets: { id: number; after: string }[]): { id: number; check: RewriteCheck }[] {
  const inv = buildClaimInventory(cvText);
  return bullets.filter((b) => lines[b.id]).map((b) => ({ id: b.id, check: checkRewrite(inv, { index: b.id, text: lines[b.id].text, locate: lines[b.id].locate }, b.after) }));
}

/* ---------- Text with no single source line ---------- */

const verdictOf = (issues: RewriteIssue[]): RewriteCheck["verdict"] => (issues.some((i) => i.severity === "block") ? "block" : issues.some((i) => i.severity === "confirm") ? "confirm" : "pass");

/**
 * A profile draws on the whole CV, so it is checked against the whole CV and everything the student has confirmed. It can
 * show that a figure or name exists somewhere in the CV; it can't tell which role a sentence in a profile means.
 */
export function checkProfile(inv: ClaimInventory, text: string): RewriteCheck {
  const whole = inv.entries.flatMap((e) => [e.heading, e.context, ...e.lines, ...e.factValues]).join("\n");
  const cvFacts = inv.facts.filter((f) => f.scope === "cv");
  const claimed = [whole, ...cvFacts.map(factWords)].join("\n");
  const ev: Evidence = { entry: null, lineNo: null, line: claimed, claimed, facts: cvFacts, noLevel: false, context: "", sourceHadInstructions: inv.instructionSentences > 0 };
  const issues: RewriteIssue[] = [];
  checkShape(text, ev, issues, 700);
  checkFigures(text, ev, inv, issues);
  checkEntities(text, ev, inv, issues);
  // Strongest level anywhere in the CV: a profile may say "Led" only if some line does, or the student confirmed it.
  if (!leadWordsIn(claimed).length) {
    const lead = leadWordsIn(blankBrackets(normaliseText(text)))[0];
    if (lead) issues.push({ code: "responsibility-raised", severity: "confirm", found: lead, key: `responsibility-raised:${lead}`, message: `The profile says "${lead}", but nothing in your CV says you led anything. Is that accurate?` });
  }
  checkOutcomes(text, ev, issues);
  const kept = issues.filter((i) => i.code !== "dropped-figure");
  return { validator: REWRITE_CHECK_VERSION, verdict: verdictOf(kept), issues: kept, used: [], questions: questionsFor(text), unchanged: false, entry: null, sourceHadInstructions: ev.sourceHadInstructions };
}

/**
 * A skill the CV doesn't name is a new claim however plausible, so it is never added on the model's word: a qualification
 * is refused and anything else waits for the student to say it is true.
 */
export function checkSkill(inv: ClaimInventory, term: string): RewriteCheck {
  const skills = inv.entries.find((e) => e.section === "skills") ?? null;
  const base = { validator: REWRITE_CHECK_VERSION, used: [], questions: [], unchanged: false, entry: skills ? { id: skills.id, heading: skills.heading } : null, sourceHadInstructions: false };
  const confirmedAlready = inv.facts.some((f) => f.scope === "cv" && f.kind === "entity" && f.value.toLowerCase() === term.toLowerCase());
  if (confirmedAlready) return { ...base, verdict: "pass", issues: [] };
  const key = term.toLowerCase();
  if (qualificationsIn(term).length) return { ...base, verdict: "block", issues: [{ code: "unsupported-qualification", severity: "block", found: term, key: `unsupported-qualification:${key}`, message: `Your CV doesn't mention "${term}".` }] };
  return { ...base, verdict: "confirm", issues: [{ code: "unsupported-entity", severity: "confirm", found: term, key: `unsupported-entity:${key}`, message: `Your CV doesn't name "${term}". Have you really used it? Listing it only says you claim it.` }] };
}

/* ---------- Text the student typed, and what they confirm ---------- */

const NOT_CONFIRMABLE: IssueCode[] = ["not-a-cv-line", "invalid-placeholder"];

/**
 * OP-016 decision. A block exists to stop a model asserting what the CV doesn't show. Words the student typed are their
 * own statement and they may know things the CV leaves out, so a factual block becomes a named confirmation they have
 * to tick. Markup, instructions and bracketed claims stay refused. Model text never comes through here.
 */
export function forTypedText(check: RewriteCheck): RewriteCheck {
  const issues = check.issues.map((i): RewriteIssue => (i.severity === "block" && !NOT_CONFIRMABLE.includes(i.code) ? { ...i, severity: "confirm", message: `${i.message} You typed this: tick to confirm it is true and that you can back it up.` } : i));
  return { ...check, issues, verdict: verdictOf(issues) };
}

const FACT_KIND: Partial<Record<IssueCode, FactKind>> = {
  "unsupported-figure": "figure",
  "figure-from-other-entry": "figure",
  "figure-from-other-line": "figure",
  "figure-unit-changed": "figure",
  "vague-quantity": "figure",
  "unsupported-date": "date",
  "date-from-other-entry": "date",
  "unsupported-entity": "entity",
  "entity-from-other-entry": "entity",
  "entity-elsewhere-in-cv": "entity",
  "unsupported-qualification": "qualification",
  "responsibility-raised": "responsibility",
  "unsupported-outcome": "outcome",
  "scope-inflated": "outcome",
  "figure-noun-changed": "statement",
  "mostly-new-content": "statement",
  unrelated: "statement",
};

export interface FactContext {
  idPrefix: string;
  quote: string;
  scope: ConfirmedFact["scope"];
  entryId: string | null;
  entryHeading: string | null;
  lineText: string | null;
  how: ConfirmedFact["provenance"]["how"];
  sourceVersion: string;
  reportId: string;
  at: string;
}

/** What a confirmation establishes, with where it came from. Only what the student actually ticked. */
export function factsFromCheck(check: RewriteCheck, confirmed: string[], ctx: FactContext): ConfirmedFact[] {
  const out: ConfirmedFact[] = [];
  for (const i of check.issues) {
    const kind = FACT_KIND[i.code];
    if (i.severity !== "confirm" || !kind || !confirmed.includes(i.key)) continue;
    out.push({
      id: `${ctx.idPrefix}:${i.key}`,
      kind,
      value: kind === "statement" ? ctx.quote : i.found,
      issue: i.code,
      quote: ctx.quote,
      scope: ctx.scope,
      entryId: ctx.entryId,
      entryHeading: ctx.entryHeading,
      lineText: ctx.lineText,
      provenance: { by: "student", how: ctx.how, sourceVersion: ctx.sourceVersion, validator: check.validator, reportId: ctx.reportId, at: ctx.at },
    });
  }
  return out;
}
