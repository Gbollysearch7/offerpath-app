import type { ConfirmedFact } from "@/lib/types";
import { parseCv } from "./parse";

// OP-015: what a CV actually says, tied to the entry that says it. A rewrite is checked against this inventory
// (rewrite-check.ts), so "the number exists somewhere in the CV" is never enough: a figure belongs to a line in an
// entry, and an entry is one role, project or section. Pure text analysis: no model, no network, no scoring. Nothing
// in the scoring path imports this file.

export type ClaimKind = "figure" | "date" | "entity" | "qualification" | "responsibility";

export interface Claim {
  /** Stable within an inventory: `<entry>:<line or head>:<kind>:<normalised value>`. */
  id: string;
  kind: ClaimKind;
  /** As written in the CV. */
  value: string;
  /** Comparable form: "2400|£", "2024", "hubspot", "support". */
  normal: string;
  entryId: string;
  /** Index into CvEntry.lines, or null when it comes from the entry's heading or surrounding text. */
  line: number | null;
  quote: string;
  /** Set when the claim comes from the student's confirmation rather than the CV's text. */
  student?: boolean;
}

export interface CvEntry {
  id: string;
  /** Normalised section key from the parser. */
  section: string;
  /** The role heading(s) as written, or the section name. Instruction-like text is removed. */
  heading: string;
  /** Heading lines and the text around the bullets: the entry's own context. */
  context: string;
  /** Bullet texts with instruction-like sentences removed. */
  lines: string[];
  /** Parser bullet index of each line, or null for a bullet the scorer does not use. */
  bulletIndex: (number | null)[];
  /** The bullet as written, before instruction-like sentences were removed: how a report's line is matched to it. */
  rawLines: string[];
  /** True when the entry is a role or project heading; false for a whole section (skills, education, no headings). */
  isRole: boolean;
  claims: Claim[];
  /** What the student confirmed for this entry: the words, so a later check can recognise them. */
  factValues: string[];
}

export interface ClaimInventory {
  entries: CvEntry[];
  /** Lines the parser scored, in order: the same order as CvAnalysis.lines. */
  bullets: { entryId: string; line: number; text: string; raw: string }[];
  /** How many sentences read like instructions to software rather than experience, and so gave no claims. */
  instructionSentences: number;
  /** Student-confirmed facts this inventory was built with. Never read from the CV's text. */
  facts: ConfirmedFact[];
}

/* ---------- Normalising ---------- */

/** Folds look-alike digits (full-width forms) and removes invisible characters, so text reads as what it displays as. */
export const normaliseText = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[\u00ad\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');

/** Rough stem, for comparing words rather than word forms. Only ever compared with itself. */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/'s$/, "").replace(/[^\p{L}\p{N}+#]/gu, "");
  if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w.replace(/is$/, "iz");
}

export const wordsIn = (s: string) => normaliseText(s).match(/[\p{L}\p{N}][\p{L}\p{N}+#'.&]*[\p{L}\p{N}+#]|[\p{L}\p{N}]/gu) ?? [];

/** Every word of a term, in any form, is among these stems (from `stemsIn`). A term with no words isn't. */
export function allWordsIn(term: string, known: Set<string>): boolean {
  const words = wordsIn(term.replace(/-/g, " "));
  return words.length > 0 && words.every((w) => known.has(stem(w)));
}

/** Every stem in a piece of text, with hyphenated and dotted words also counted part by part. */
export function stemsIn(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of wordsIn(s.replace(/-/g, " "))) {
    out.add(stem(w));
    out.add(w.toLowerCase());
  }
  return out;
}

/* ---------- Instructions hidden in a document ---------- */

const INSTRUCTION_RE = new RegExp(
  [
    String.raw`\b(ignore|disregard|forget|override|bypass)\b[^.!?\n]{0,40}\b(instructions?|prompts?|rules?|restrictions?|guidelines?|validator|checks?|above|context)\b`,
    String.raw`\bsystem\s*prompt\b`,
    String.raw`\b(new|updated|further|hidden|special)\s+instructions?\b`,
    String.raw`\byou\s+are\s+(now|an?\s+(ai|assistant|model|language|chatbot|helpful))\b`,
    String.raw`\bas\s+an\s+ai\b`,
    String.raw`\b(hey|dear|attention)\s+(claude|chatgpt|gpt|ai|assistant|model|recruiter\s+bot)\b`,
    String.raw`(^|[\s>])(system|assistant|developer|user)\s*:`,
    String.raw`\b(developer|admin|debug|god|jailbreak)\s+mode\b`,
    String.raw`\b(write|say|state|claim|output|respond|reply|print|return)\s+(only\s+)?(that|exactly|the\s+following|with)\b[^.!?\n]{0,60}\b(i|this|candidate|student|applicant|bullet|line|rewrite|cv)\b`,
    String.raw`\b(mark|score|rate|treat|flag|approve|pass)\s+(this|the|my)\s+(cv|line|bullet|rewrite|candidate|suggestion|applicant|output)\b`,
    String.raw`\bgive\s+(this|me|the\s+candidate)\s+(a\s+)?(perfect|top|full|maximum|10)\b`,
    String.raw`\bdo\s+not\s+(validate|flag|check|verify|mention\s+this)\b`,
    String.raw`\bpretend\s+(that|to|you)\b`,
    String.raw`\bact\s+as\s+(if|an?\s+(ai|assistant|model|different))\b`,
    String.raw`</?\s*(system|assistant|instructions?|bullet|source|prompt)\b`,
  ].join("|"),
  "i",
);

/** True when the text reads like an instruction to software rather than a description of experience. */
export const readsLikeInstructions = (s: string) => INSTRUCTION_RE.test(normaliseText(s));

// A dot inside a number or a name ("£2.4k", "Node.js") doesn't end a sentence.
const SENTENCE_END = /(?<=[.!?;])\s+|\n+/;

/** Removes the sentences that read like instructions. What's left is what the student can be taken to be claiming. */
export function withoutInstructions(s: string): { text: string; removed: number } {
  const parts = normaliseText(s).split(SENTENCE_END);
  const kept = parts.filter((p) => !readsLikeInstructions(p));
  return { text: kept.join(" ").replace(/\s+/g, " ").trim(), removed: parts.length - kept.length };
}

/* ---------- Placeholders ---------- */

const BRACKET_RE = /\[[^\]\n]*\]/g;
// An actual request for a fact: no digits, a few plain words, nothing that reads as a name or a command.
const PLACEHOLDER_OK = /^\[(?=[^\]]*[A-Za-z£$€%])[A-Za-z£$€%+/,.\- ]{1,40}\]$/;

export const bracketsIn = (s: string) => s.match(BRACKET_RE) ?? [];

export function isPlaceholder(bracket: string): boolean {
  if (!PLACEHOLDER_OK.test(bracket) || readsLikeInstructions(bracket)) return false;
  const inner = bracket.slice(1, -1);
  if (inner.split(/\s+/).filter(Boolean).length > 6) return false;
  // A tool, a qualification or a leading role in brackets is a claim wearing a placeholder's clothes.
  if (toolsIn(inner).length || qualificationsIn(inner).length || leadWordsIn(inner).length) return false;
  // X, Y, N and Z stand for the missing value; any other capital would be a name smuggled into a placeholder.
  return !/(^|[\s/,+-])(?![XYNZ]\b)[A-Z][A-Za-z]/.test(inner.replace(/^e\.g\./i, ""));
}

/** Text with bracketed placeholders blanked to spaces of the same length, so offsets still line up with the original. */
export const blankBrackets = (s: string) => s.replace(BRACKET_RE, (m) => " ".repeat(m.length));

/* ---------- Figures and dates ---------- */

export interface FoundFigure {
  kind: "figure" | "date";
  /** Comparable numeric value, or a vague/multiplier label such as "x2" or "hundreds". */
  value: string;
  /** "£", "$", "€", "%", or "" for a bare count. */
  unit: "" | "£" | "$" | "€" | "%";
  /** The stem of the word being counted ("student" in "12 students"), when one follows. */
  noun: string | null;
  raw: string;
  start: number;
  end: number;
  /** True for words like "hundreds of": a size without a value. */
  vague?: boolean;
  /** True for "doubled" and the like: a verb, so a placeholder can't simply stand in for it. */
  verb?: boolean;
}

const UNITS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALE: Record<string, number> = { hundred: 100, thousand: 1_000, million: 1_000_000, billion: 1_000_000_000, k: 1_000, m: 1_000_000, bn: 1_000_000_000 };
const NUMBER_WORD = `(?:${[...Object.keys(UNITS), ...Object.keys(TENS), "hundred", "thousand", "million", "billion", "dozen"].join("|")})`;
const WORD_NUMBER_RE = new RegExp(`\\b(a\\s+)?${NUMBER_WORD}(?:[\\s-]+(?:and\\s+)?${NUMBER_WORD})*\\b`, "gi");
const DIGIT_RE = /(?<![\p{L}\p{N}.,])([£$€])?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s?(k|m|bn|thousand|million|billion)\b)?(?:(st|nd|rd|th)\b|(x)\b)?(\s?(?:%|per\s?cent\b))?(\+)?(?![\p{L}\p{N}])/giu;
const MULTIPLIER_RE = /\b(doubl(?:ed|ing|e)|tripl(?:ed|ing|e)|quadrupl(?:ed|ing|e)|halv(?:ed|ing|e))\b/gi;
const VAGUE_RE = /\b(dozens|scores|hundreds|thousands|millions|billions)(\s+of)?\b/gi;
const MULTIPLIER: Record<string, string> = { doubl: "x2", tripl: "x3", quadrupl: "x4", halv: "x0.5" };

function wordsToNumber(raw: string): number | null {
  let total = 0;
  let current = 0;
  for (const t of raw.toLowerCase().replace(/-/g, " ").split(/\s+/).filter((x) => x !== "and" && x !== "a")) {
    if (t === "dozen") current = (current || 1) * 12;
    else if (t in UNITS) current += UNITS[t];
    else if (t in TENS) current += TENS[t];
    else if (t === "hundred") current = (current || 1) * 100;
    else if (t in SCALE) {
      total += (current || 1) * SCALE[t];
      current = 0;
    } else return null;
  }
  return total + current;
}

const round = (n: number) => String(Math.round(n * 1_000_000) / 1_000_000);

function nounAfter(text: string, end: number): string | null {
  const m = text.slice(end).match(/^[\s-]*(?:more\s+|new\s+|extra\s+|additional\s+|other\s+)?([A-Za-z][A-Za-z]+)/);
  if (!m) return null;
  const word = m[1].toLowerCase();
  if (/^(of|to|and|or|in|on|at|for|by|from|with|the|a|an|per|across|over|under|than|as|is|was|were|who|which|that|while|within|during|into|through|via|up|out|down|each|every|between)$/.test(word)) return null;
  return stem(word);
}

/** Every number-like claim in the text. Placeholders are not figures; pass text through as written and they are blanked. */
export function figuresIn(raw: string): FoundFigure[] {
  const text = blankBrackets(normaliseText(raw));
  const out: FoundFigure[] = [];
  const taken: [number, number][] = [];
  const free = (a: number, b: number) => !taken.some(([x, y]) => a < y && b > x);
  const add = (f: FoundFigure) => {
    if (!free(f.start, f.end)) return;
    taken.push([f.start, f.end]);
    out.push(f);
  };
  for (const m of text.matchAll(DIGIT_RE)) {
    const [whole, cur, int, dec, scale, ordinal, times, pct, plus] = m;
    void ordinal;
    void plus;
    const start = m.index + (whole.length - whole.trimStart().length);
    const end = m.index + whole.length;
    let n = Number(int.replace(/,/g, "") + (dec ?? ""));
    if (scale) n *= SCALE[scale.toLowerCase()];
    const unit = cur ? (cur as "£" | "$" | "€") : pct ? "%" : "";
    const isYear = !cur && !pct && !scale && !dec && !times && !int.includes(",") && /^(19|20)\d{2}$/.test(int);
    add({ kind: isYear ? "date" : "figure", value: times ? `x${round(n)}` : round(n), unit, noun: nounAfter(text, end), raw: whole.trim(), start, end });
  }
  for (const m of text.matchAll(WORD_NUMBER_RE)) {
    const whole = m[0];
    // "one" alone is too often not a count ("one of the", "one-page"). "a" alone before a scale word still counts.
    if (/^one$/i.test(whole)) continue;
    const n = wordsToNumber(whole);
    if (n !== null) add({ kind: "figure", value: round(n), unit: /^\s*(per\s?cent|%)/i.test(text.slice(m.index + whole.length)) ? "%" : "", noun: nounAfter(text, m.index + whole.length), raw: whole, start: m.index, end: m.index + whole.length });
  }
  for (const m of text.matchAll(MULTIPLIER_RE)) {
    const key = Object.keys(MULTIPLIER).find((k) => m[1].toLowerCase().startsWith(k))!;
    add({ kind: "figure", value: MULTIPLIER[key], unit: "", noun: null, raw: m[0], start: m.index, end: m.index + m[0].length, verb: true });
  }
  for (const m of text.matchAll(VAGUE_RE)) {
    add({ kind: "figure", value: m[1].toLowerCase(), unit: "", noun: null, raw: m[0], start: m.index, end: m.index + m[0].length, vague: true });
  }
  return out.sort((a, b) => a.start - b.start);
}

export const MONTHS = /^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)$/i;

/* ---------- Names, tools and qualifications ---------- */

/** Tools a student might plausibly be credited with, matched in any letter case. Not a full list: a tool outside it is caught only when written with capitals. */
export const KNOWN_TOOLS = [
  "excel", "powerpoint", "sql", "mysql", "postgresql", "python", "javascript", "typescript", "java", "matlab", "stata", "spss", "tableau", "power bi", "looker", "salesforce", "hubspot", "mailchimp", "brevo", "marketo", "figma", "photoshop", "illustrator", "indesign", "canva", "jira", "confluence", "trello", "asana", "github", "git", "aws", "azure", "gcp", "kubernetes", "terraform", "docker", "react", "wordpress", "shopify", "sap", "oracle", "xero", "sage", "quickbooks", "bloomberg", "google analytics", "google ads", "meta ads", "semrush", "ahrefs", "autocad", "solidworks",
];

/** Words that claim a qualification, status or award, matched in any letter case. */
export const QUALIFICATION_TERMS = [
  "bsc", "ba", "msc", "ma", "mba", "phd", "pgce", "llb", "llm", "meng", "beng", "degree", "diploma", "a-level", "a-levels", "gcse", "gcses", "cfa", "acca", "aca", "cima", "cipd", "cim", "prince2", "pmp", "certified", "certification", "certificate", "accredited", "accreditation", "chartered", "licensed", "qualified", "fellowship", "scholarship", "first-class", "distinction", "dean's list", "award", "awards", "awarded", "award-winning", "prize", "bursary",
];

const phraseIn = (haystack: string, phrase: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${phrase.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`, "iu").test(haystack);

export const toolsIn = (s: string) => KNOWN_TOOLS.filter((t) => phraseIn(s, t));
export const qualificationsIn = (s: string) => QUALIFICATION_TERMS.filter((t) => phraseIn(s, t));

export interface FoundName {
  raw: string;
  /** The word is the first in the sentence, so its capital proves nothing unless it is an acronym or a brand spelling. */
  initial: boolean;
  /** Written like an acronym or a brand ("SQL", "GA4", "HubSpot"), which doesn't depend on position. */
  distinctive: boolean;
}

/** Capitalised words, acronyms and brand spellings, one word at a time. Letter case is the only signal: there is no named-entity model here. */
export function namesIn(raw: string): FoundName[] {
  const text = blankBrackets(normaliseText(raw));
  const out: FoundName[] = [];
  const re = /[\p{L}\p{N}][\p{L}\p{N}+#&.'-]*[\p{L}\p{N}+#]|[\p{L}]/gu;
  let prevEnd = -1;
  let afterBreak = true;
  for (const m of text.matchAll(re)) {
    const gap = text.slice(prevEnd < 0 ? 0 : prevEnd, m.index);
    const start = prevEnd < 0 || /[.!?:;]\s*$/.test(gap) || /^\s*[(–—-]\s*$/.test(gap);
    afterBreak = start;
    prevEnd = m.index + m[0].length;
    for (const part of m[0].split("-").filter(Boolean)) {
      const distinctive = /^[A-Z]{2,}[\d+#]*s?$/.test(part) || /\p{Ll}\p{Lu}/u.test(part) || /^\p{Lu}[\p{L}]*\d|^\d+\p{Lu}/u.test(part) || /^[\p{L}]*[+#]+$/u.test(part);
      const capital = /^\p{Lu}/u.test(part);
      if ((!capital && !distinctive) || part.length === 1) continue;
      if (/^\d/.test(part) && !distinctive) continue;
      out.push({ raw: part.replace(/'s$/, ""), initial: afterBreak && part === m[0].split("-")[0], distinctive });
    }
  }
  return out;
}

/* ---------- Level of responsibility ---------- */

/** 0 assisted, 1 shared, 2 did it, 3 led it. */
export type ResponsibilityLevel = 0 | 1 | 2 | 3;

const ASSIST_RE = /^(help|helped|helping|helps|assist|assisted|assisting|assists|support|supported|supporting|supports|shadow|shadowed|shadowing|observe|observed|observing|aid|aided|aiding|participate|participated|participating|attend|attended|attending|involved|volunteer|volunteered|volunteering)$/i;
const SHARED_RE = /^(contribute|contributed|contributing|contributes|collaborate|collaborated|collaborating|collaborates|coordinate|coordinated|coordinating|coordinates|co|jointly|partner|partnered|partnering|enabled|enable|enabling|facilitate|facilitated|facilitating|worked|work|working|took|take|taking|joined|join|provided)$/i;
const LEAD_WORDS = ["led", "lead", "leads", "leading", "managed", "manage", "manages", "managing", "headed", "directed", "directing", "oversaw", "oversee", "oversees", "overseeing", "overseen", "spearheaded", "spearheading", "supervised", "supervise", "supervising", "chaired", "chair", "chairing", "captained", "captain", "founded", "pioneered", "pioneering", "championed", "drove", "orchestrated", "architected", "commanded", "ownership", "owned", "leadership", "responsible", "in charge"];
// "managed by", "student-led", "led by" name someone else as the one in charge.
const NOT_THE_STUDENT = /\b(led|managed|run|directed|supervised|overseen|headed|chaired)\s+by\b|\b[\p{L}]+-led\b|\bin\s+a\s+team\s+led\b/giu;

export const leadWordsIn = (s: string): string[] => {
  const text = normaliseText(s).replace(NOT_THE_STUDENT, " ");
  return LEAD_WORDS.filter((w) => phraseIn(text, w));
};

// Said anywhere in the sentence, this keeps a do-word from claiming the work alone.
const SHARING_RE = /\b(jointly|alongside|as\s+part\s+of|part\s+of\s+a|in\s+a\s+(team|group)|with\s+(the|a|my|other)\s+(team|committee|group|manager|colleagues?|others?)\b|together\s+with|team\s+of|co-[a-z]+|shared)\b/i;
export const saysItWasShared = (s: string) => SHARING_RE.test(normaliseText(s));

export const openingWord = (s: string) => wordsIn(blankBrackets(s).replace(/-/g, " "))[0] ?? "";

/** The level of involvement a line claims: its strongest leading word, otherwise its opening verb. */
export function responsibilityOf(line: string): ResponsibilityLevel {
  if (leadWordsIn(line).length) return 3;
  const first = openingWord(line);
  if (ASSIST_RE.test(first)) return 0;
  if (SHARED_RE.test(first)) return 1;
  return 2;
}

export const opensWithSharedVerb = (s: string) => {
  const first = openingWord(s);
  return ASSIST_RE.test(first) || SHARED_RE.test(first);
};

/* ---------- The inventory ---------- */

const FACT_CLAIM_KIND: Record<ConfirmedFact["kind"], ClaimKind> = { figure: "figure", date: "date", entity: "entity", qualification: "qualification", responsibility: "responsibility", outcome: "responsibility", statement: "responsibility" };

/** The words a confirmation vouches for. A whole sentence only when what was confirmed was the sentence. */
export const factWords = (f: ConfirmedFact) => (f.kind === "statement" ? f.quote : f.value);

const quoted = (s: string) => (s.length > 160 ? `${s.slice(0, 157)}…` : s);

function claimsOf(text: string, entryId: string, line: number | null): Claim[] {
  const at = line === null ? "head" : `l${line}`;
  const out = new Map<string, Claim>();
  const add = (kind: ClaimKind, value: string, normal: string) => {
    const id = `${entryId}:${at}:${kind}:${normal}`;
    if (!out.has(id)) out.set(id, { id, kind, value, normal, entryId, line, quote: quoted(text) });
  };
  for (const f of figuresIn(text)) add(f.kind, f.raw, f.kind === "date" ? f.value : `${f.value}|${f.unit}`);
  for (const n of namesIn(text)) if (!n.initial || n.distinctive) add(MONTHS.test(n.raw) ? "date" : "entity", n.raw, n.raw.toLowerCase());
  for (const t of toolsIn(text)) add("entity", t, t);
  for (const q of qualificationsIn(text)) add("qualification", q, q);
  if (line !== null) {
    const level = responsibilityOf(text);
    add("responsibility", openingWord(text), ["assisted", "shared", "did", "led"][level]);
  }
  return [...out.values()];
}

const SECTION_NAMES: Record<string, string> = { header: "Contact details", summary: "Profile", skills: "Skills", education: "Education", experience: "Experience", projects: "Projects", activities: "Activities", achievements: "Achievements", interests: "Interests" };

/** Builds the inventory from CV text. Deterministic: the same text gives the same inventory. */
export function buildClaimInventory(cvText: string, facts: ConfirmedFact[] = []): ClaimInventory {
  const parsed = parseCv(normaliseText(cvText));
  const { lines, structure } = parsed;
  let instructionSentences = 0;
  const clean = (s: string) => {
    const r = withoutInstructions(s);
    instructionSentences += r.removed;
    return r.text;
  };

  // Every line of the CV belongs to one span: a section start or a role heading, whichever is nearest above it.
  const marks = [
    ...structure.sections.map((s) => ({ line: s.line, section: s.key, role: false, heading: s.heading })),
    ...structure.roles.map((r) => ({ line: r.line, section: r.section, role: true, heading: r.heading })),
  ].sort((a, b) => a.line - b.line || Number(a.role) - Number(b.role));

  type Span = { section: string; role: boolean; headings: string[]; from: number; to: number };
  const spans: Span[] = [];
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const to = i + 1 < marks.length ? marks[i + 1].line : lines.length;
    const last = spans[spans.length - 1];
    // "Events Officer" then "Economics Society, 2023 – 2024" with nothing between: two heading lines of one entry.
    if (m.role && last?.role && last.section === m.section && last.to === m.line && last.to - last.from === last.headings.length) {
      last.headings.push(m.heading ?? "");
      last.to = to;
      continue;
    }
    spans.push({ section: m.section, role: m.role, headings: m.heading ? [m.heading] : [], from: m.line, to });
  }

  const taken = new Set<number>();
  const spanOfLine = (n: number) => spans.findIndex((s) => n >= s.from && n < s.to);
  const perSpan = new Map<number, { text: string; bullet: number | null; range: [number, number] }[]>();
  const push = (span: number, item: { text: string; bullet: number | null; range: [number, number] }) => perSpan.set(span, [...(perSpan.get(span) ?? []), item]);
  // Scored bullets, in scored order. The bullets the parser keeps out of scoring (education, skills) stay in the context text.
  for (const b of parsed.bullets) {
    const span = spanOfLine(b.lines[0]);
    if (span >= 0) push(span, { text: b.text, bullet: b.index, range: b.lines });
    for (let l = b.lines[0]; l <= b.lines[1]; l++) taken.add(l);
  }

  const entries: CvEntry[] = spans.map((s, i) => {
    const id = `e${i}`;
    const items = perSpan.get(i) ?? [];
    const contextLines: string[] = [];
    for (let l = s.from; l < s.to; l++) if (!taken.has(l)) contextLines.push(lines[l]);
    const heading = clean(s.headings.join(", ")) || SECTION_NAMES[s.section] || s.section;
    const context = contextLines.map((c) => clean(c)).filter(Boolean).join("\n");
    const cleanLines = items.map((it) => clean(it.text));
    const claims = [...claimsOf(context, id, null), ...cleanLines.flatMap((t, n) => claimsOf(t, id, n))];
    return { id, section: s.section, heading, context, lines: cleanLines, rawLines: items.map((it) => it.text), bulletIndex: items.map((it) => it.bullet), isRole: s.role, claims, factValues: [] as string[] };
  });

  const bullets: ClaimInventory["bullets"] = [];
  entries.forEach((e) =>
    e.bulletIndex.forEach((b, line) => {
      if (b !== null) bullets[b] = { entryId: e.id, line, text: e.lines[line], raw: e.rawLines[line] };
    }),
  );
  for (const f of facts) {
    const e = entries.find((x) => x.id === f.entryId);
    if (!e) continue;
    e.factValues.push(factWords(f));
    const line = f.lineText === null ? null : e.rawLines.indexOf(f.lineText);
    e.claims.push({ id: `${e.id}:fact:${f.id}`, kind: FACT_CLAIM_KIND[f.kind], value: f.value, normal: f.value.toLowerCase(), entryId: e.id, line: line !== null && line >= 0 ? line : null, quote: quoted(f.quote), student: true });
  }
  return { entries, bullets, instructionSentences, facts };
}
