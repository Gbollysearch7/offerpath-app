import type { Finding } from "@/lib/types";
import { BULLET_RE } from "./parse";
import { entryGroups, type Entry } from "./supplemental-dates";
import { evidenceFor, listWords, plural, shortLine, supplementalFinding, type CvReading } from "./supplemental-context";

// Consistency (OP-009): what can actually be observed in text. Each finding says what it compared and shows the
// lines that differ from the rest. Fonts, sizes and alignment aren't in the text at all, so they get a finding of
// their own that says they weren't assessed.

/** The lines of each value of a property, largest group first. */
function tally<T>(items: { value: T; line: number }[]): { value: T; lines: number[] }[] {
  const by = new Map<T, number[]>();
  for (const { value, line } of items) by.set(value, [...(by.get(value) ?? []), line]);
  return [...by.entries()].map(([value, lines]) => ({ value, lines })).sort((a, b) => b.lines.length - a.lines.length);
}

const minorityLines = <T,>(groups: { value: T; lines: number[] }[]) => groups.slice(1).flatMap((g) => g.lines);

/* ---------- dates ---------- */

const LONG_MONTH = /\b(?:january|february|march|april|june|july|august|september|october|november|december)\b/i;
const SHORT_MONTH = /\b(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i;
const NUMERIC_MONTH = /\b\d{1,2}\/(?:19|20)\d{2}\b/;
const YEAR = "(?:19|20)\\d{2}";
const POINT = `(?:[A-Za-z]{3,9}\\.?\\s+${YEAR}|\\d{1,2}\\/${YEAR}|${YEAR})`;
const RAW_RANGE_RE = new RegExp(`${POINT}(\\s*(?:-|–|—|―|‒|‐|‑|−|to|until)\\s*)(?:${POINT}|(present|now|current|ongoing|today|to date|date))`, "i");

type MonthStyle = "written in full" | "shortened" | "in numbers";

function monthStyle(raw: string): MonthStyle | null {
  if (NUMERIC_MONTH.test(raw)) return "in numbers";
  if (LONG_MONTH.test(raw)) return "written in full";
  if (SHORT_MONTH.test(raw)) return "shortened";
  return null; // Year only, or "May", which reads the same both ways.
}

const describeSeparator = (s: string) => {
  const t = s.trim();
  if (/^[a-z]+$/i.test(t)) return `"${t.toLowerCase()}"`;
  const name = t === "–" ? "en dash" : t === "—" ? "em dash" : t === "-" ? "hyphen" : `"${t}"`;
  return `${s === t ? "an unspaced" : "a spaced"} ${name}`;
};

export function dateConsistencyFinding(cv: CvReading): Finding {
  const id = "supplemental.consistency_dates";
  const groups = entryGroups(cv);
  const entries = groups.flatMap((g) => g.entries).filter((e): e is Entry => e.start !== null);
  if (entries.length < 2) return supplementalFinding(id, "not_applicable", "We found fewer than two dates, so there was nothing to compare.");

  const notes: string[] = [];
  const flagged: number[] = [];

  const styles = tally(entries.flatMap((e) => (monthStyle(e.raw) ? [{ value: monthStyle(e.raw)!, line: e.line }] : [])));
  if (styles.length > 1) {
    notes.push(`Months are ${listWords(styles.map((s) => `${s.value} on ${plural(s.lines.length, "line")}`))}.`);
    flagged.push(...minorityLines(styles));
  }

  // Years alone in one section and months in another is normal (education and work often differ), so this is per section.
  for (const g of groups) {
    const dated = g.entries.filter((e) => e.start !== null);
    const yearOnly = dated.filter((e) => e.start!.month === null && (e.end === "present" || e.end === null || e.end.month === null));
    const withMonths = dated.filter((e) => !yearOnly.includes(e));
    if (yearOnly.length && withMonths.length) {
      notes.push(`In ${g.heading}, ${plural(withMonths.length, "entry gives", "entries give")} months and ${yearOnly.length} ${yearOnly.length === 1 ? "gives" : "give"} only years.`);
      flagged.push(...(yearOnly.length <= withMonths.length ? yearOnly : withMonths).map((e) => e.line));
    }
  }

  const endWords = tally(entries.flatMap((e) => {
    const m = e.end === "present" ? e.raw.match(/(present|now|current|ongoing|today|date)\b/i) : null;
    return m ? [{ value: m[1], line: e.line }] : [];
  }));
  if (endWords.length > 1) {
    notes.push(`Current roles end with ${listWords(endWords.map((w) => `"${w.value}"`))}.`);
    flagged.push(...minorityLines(endWords));
  }

  let separatorsRead = true;
  if (cv.rawLines) {
    const seps = tally(entries.flatMap((e) => {
      const m = cv.rawLines![e.line].match(RAW_RANGE_RE);
      return m ? [{ value: m[1].replace(/\s+/g, " "), line: e.line }] : [];
    }));
    if (seps.length > 1) {
      notes.push(`Date ranges are joined with ${listWords(seps.map((s) => describeSeparator(s.value)))}.`);
      flagged.push(...minorityLines(seps));
    }
  } else separatorsRead = false;

  const unread = separatorsRead ? "" : " We couldn't compare the dashes between dates, because the original characters couldn't be matched to the lines.";
  if (notes.length) return supplementalFinding(id, "needs_attention", `${notes.join(" ")}${unread}`, "Pick one way of writing dates and use it throughout. Either is fine, as long as it's the same.", evidenceFor(cv, flagged));
  return supplementalFinding(id, "passed", `Your ${plural(entries.length, "date")} are written the same way, as far as the text shows: months, current-role wording and the marks between dates.${unread}`);
}

/* ---------- punctuation ---------- */

const MIN_BULLETS = 3;
const DOUBLED_RE = /(?<!\.)\.\.(?!\.)|,,|;;|::/;

export function punctuationConsistencyFinding(cv: CvReading): Finding {
  const id = "supplemental.consistency_punctuation";
  const bullets = cv.parsed.bullets;
  if (bullets.length < MIN_BULLETS) return supplementalFinding(id, "not_applicable", `We found ${plural(bullets.length, "bullet point")}, which is too few to compare punctuation.`);
  const stops = bullets.filter((b) => b.text.endsWith("."));
  const bare = bullets.filter((b) => !b.text.endsWith("."));
  const doubled = bullets.filter((b) => DOUBLED_RE.test(b.text));
  const notes: string[] = [];
  const flagged: number[] = [];
  if (stops.length && bare.length) {
    notes.push(`${plural(stops.length, "bullet")} ${stops.length === 1 ? "ends" : "end"} with a full stop and ${bare.length} ${bare.length === 1 ? "doesn't" : "don't"}.`);
    flagged.push(...(stops.length <= bare.length ? stops : bare).map((b) => b.lines[1]));
  }
  if (doubled.length) {
    notes.push(`${plural(doubled.length, "bullet")} ${doubled.length === 1 ? "has" : "have"} doubled punctuation.`);
    flagged.push(...doubled.map((b) => b.lines[0]));
  }
  if (notes.length) return supplementalFinding(id, "needs_attention", notes.join(" "), "Choose whether bullets end with a full stop and apply it to all of them.", evidenceFor(cv, flagged));
  return supplementalFinding(id, "passed", `Your ${plural(bullets.length, "bullet")} end the same way and have no doubled punctuation. This covers punctuation at the ends of bullets, not punctuation inside sentences.`);
}

/* ---------- bullet patterns ---------- */

export function bulletConsistencyFinding(cv: CvReading): Finding {
  const id = "supplemental.consistency_bullets";
  const bullets = cv.parsed.bullets;
  if (bullets.length < MIN_BULLETS) return supplementalFinding(id, "not_applicable", `We found ${plural(bullets.length, "bullet point")}, which is too few to compare their style.`);
  const notes: string[] = [];
  const flagged: number[] = [];

  // Starts with a lowercase word; "iPhone" and "eBay" are spelt that way.
  const starts = tally(bullets.map((b) => ({ value: /^\p{Ll}\p{Lu}/u.test(b.text) ? "name" : /^\p{Ll}/u.test(b.text) ? "lower" : "other", line: b.lines[0] })));
  const lower = starts.find((s) => s.value === "lower");
  if (lower && starts.some((s) => s.value === "other")) {
    notes.push(`${plural(lower.lines.length, "bullet")} ${lower.lines.length === 1 ? "starts" : "start"} with a lowercase letter and the rest with a capital.`);
    flagged.push(...lower.lines);
  }

  let markersRead = false;
  if (cv.rawLines) {
    markersRead = true;
    const rawLines = cv.rawLines;
    const markers = tally(cv.lines.flatMap((_, i) => {
      const m = rawLines[i].match(BULLET_RE);
      return m ? [{ value: /^\d/.test(m[1]) ? "numbers" : m[1], line: i }] : [];
    }));
    if (markers.length > 1) {
      notes.push(`Bullets are marked with ${listWords(markers.map((m) => `${m.value === "numbers" ? "numbers" : `"${m.value}"`} (${m.lines.length})`))}.`);
      flagged.push(...minorityLines(markers));
    }
  }

  const unread = markersRead ? "" : " We couldn't compare bullet symbols, because the original characters couldn't be matched to the lines.";
  if (notes.length) return supplementalFinding(id, "needs_attention", `${notes.join(" ")}${unread} A file's bullet symbols can change when it is read, so check the file itself before changing them.`, "Use one bullet symbol, and start every bullet the same way.", evidenceFor(cv, flagged));
  return supplementalFinding(id, "passed", `Your ${plural(bullets.length, "bullet")} start the same way${markersRead ? " and use one symbol" : ""}, as far as the text shows. Where a line had no symbol in the text, we didn't count that as a difference, because reading a file can lose them.${unread}`);
}

/* ---------- headings ---------- */

const LOWER_WORDS = new Set(["and", "of", "the", "in", "for", "&", "to", "with"]);

function headingCase(raw: string): "capitals" | "Title Case" | "Sentence case" | "lowercase" | null {
  const words = raw.replace(/[:|_*#]+/g, " ").trim().split(/\s+/);
  const letters = words.join("");
  if (!/\p{L}/u.test(letters)) return null;
  if (letters === letters.toUpperCase()) return "capitals";
  if (letters === letters.toLowerCase()) return "lowercase";
  const content = words.slice(1).filter((w) => !LOWER_WORDS.has(w.toLowerCase()));
  // One word ("Skills") or a first word plus only small words ("Skills and") fits either style.
  if (!content.length) return null;
  if (content.every((w) => /^\p{Lu}/u.test(w))) return "Title Case";
  return content.every((w) => /^\p{Ll}/u.test(w)) ? "Sentence case" : null;
}

export function headingConsistencyFinding(cv: CvReading): Finding {
  const id = "supplemental.consistency_headings";
  const headings = cv.parsed.structure.sections.filter((s) => s.heading !== null);
  if (headings.length < 2) return supplementalFinding(id, "not_applicable", `We found ${plural(headings.length, "section heading")}, which is too few to compare.`);
  const notes: string[] = [];
  const flagged: number[] = [];
  const cases = tally(headings.flatMap((h) => {
    const value = headingCase(h.heading!);
    return value ? [{ value, line: h.line }] : [];
  }));
  if (cases.length > 1) {
    notes.push(`Section headings use ${listWords(cases.map((c) => `${c.value} (${listWords(c.lines.slice(0, 3).map((l) => `"${shortLine(cv.lines[l], 30)}"`))})`))}.`);
    flagged.push(...minorityLines(cases));
  }
  const colons = headings.filter((h) => /:\s*$/.test(h.heading!));
  if (colons.length && colons.length < headings.length) {
    notes.push(`${plural(colons.length, "heading")} ${colons.length === 1 ? "ends" : "end"} with a colon and ${headings.length - colons.length} ${headings.length - colons.length === 1 ? "doesn't" : "don't"}.`);
    flagged.push(...(colons.length <= headings.length - colons.length ? colons : headings.filter((h) => !colons.includes(h))).map((h) => h.line));
  }
  if (notes.length) return supplementalFinding(id, "needs_attention", notes.join(" "), "Write every section heading the same way.", evidenceFor(cv, flagged));
  return supplementalFinding(id, "passed", `Your ${plural(headings.length, "section heading")} use the same capitalisation and punctuation. This covers the words of the headings only, not their size or style on the page.`);
}

/* ---------- what text can't show ---------- */

/** Always "not assessed", whatever the format: the checks read text, even for a PDF. No fonts, sizes or positions reach them. */
export function visualConsistencyFinding(): Finding {
  return supplementalFinding(
    "supplemental.consistency_visual",
    "not_applicable",
    "We didn't assess fonts, font sizes, alignment, spacing or colour. These checks read the text of your CV, not how the page looks, so we can't say whether they are consistent.",
    "Check these by eye, or ask your careers adviser to look at the page.",
  );
}
