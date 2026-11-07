import type { DatePoint, Finding } from "@/lib/types";
import { parseDateRange } from "./parse";
import { evidenceFor, listWords, plural, shortLine, supplementalFinding, type CvReading } from "./supplemental-context";

// Reverse-chronological ordering (OP-009). A supplemental finding: it explains an ordering and quotes the
// entries, and never reorders anything or moves a score. No clock is read, so the same text always gets the same
// finding.
//
// The rules, in the order they matter:
// - Sections are compared separately, and so is each occurrence of a heading. Work and study are never compared,
//   so studying while working can't be read as a mistake.
// - Only a later-listed entry that lies wholly after an entry above it is an ordering issue. Ranges that overlap
//   are allowed in any order, and that also covers an employer's range with its nested roles inside it.
// - A date we can't read completely makes the finding uncertain rather than wrong.

const MONTH_WORD = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const MONTH_NUMBER: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const monthNumber = (word: string) => MONTH_NUMBER[word.slice(0, 3).toLowerCase()];

const DASH = "(?:-|–|—|to|until)";
// "June - Aug 2023": the year is only written once.
const SHARED_YEAR_RE = new RegExp(`\\b(${MONTH_WORD})\\.?\\s*${DASH}\\s*(${MONTH_WORD})\\.?\\s+((?:19|20)\\d{2})\\b`, "i");
// "2021-23", "2021/22".
const SHORT_END_RE = /\b((?:19|20)\d{2})\s*[-–—/]\s*(\d{2})\b(?![/\d])/;
// "June - August": months and no year at all.
const NO_YEAR_RE = new RegExp(`\\b(?:${MONTH_WORD})\\.?\\s*${DASH}\\s*(?:${MONTH_WORD})\\b`, "i");
// "Jun '21", "Sep 21": a two-digit year we won't guess at.
const SHORT_YEAR_RE = new RegExp(`\\b(?:${MONTH_WORD})\\.?\\s+'?\\d{2}\\b(?!\\d)`, "i");

export type DateProblem = "no_end" | "no_year" | "backwards";

export interface ReadDates {
  raw: string;
  start: DatePoint | null;
  /** The same point as `start` for a single date. */
  end: DatePoint | "present" | null;
  single: boolean;
  problem: DateProblem | null;
}

/**
 * A role line's dates. Starts from the parser's `parseDateRange` and adds what ordering needs on top of it: a year
 * written once ("June - Aug 2023"), a short end year ("2021-23"), and an unfinished range ("Jan 2022 -"). Null when the
 * line has no date at all.
 */
export function readDates(line: string): ReadDates | null {
  const text = line.slice(0, 300);
  const shared = text.match(SHARED_YEAR_RE);
  if (shared) {
    const endMonth = monthNumber(shared[2]);
    const startMonth = monthNumber(shared[1]);
    const year = Number(shared[3]);
    // "Nov - Feb 2023" crosses a new year.
    return { raw: shared[0], start: { year: startMonth > endMonth ? year - 1 : year, month: startMonth }, end: { year, month: endMonth }, single: false, problem: null };
  }
  const parsed = parseDateRange(text);
  if (!parsed) return NO_YEAR_RE.test(text) || SHORT_YEAR_RE.test(text) ? { raw: (text.match(NO_YEAR_RE) ?? text.match(SHORT_YEAR_RE))![0], start: null, end: null, single: false, problem: "no_year" } : null;

  const { start, end } = parsed;

  if (parsed.end !== null) return { raw: parsed.raw, start, end, single: false, problem: start && end && end !== "present" && comparePoints(end, start) === -1 ? "backwards" : null };

  // A single date, unless it is the start of something longer.
  const short = text.match(SHORT_END_RE);
  if (short && start && short[1] === String(start.year)) {
    const endYear = Math.floor(start.year / 100) * 100 + Number(short[2]);
    if (endYear > start.year) return { raw: short[0], start, end: { year: endYear, month: null }, single: false, problem: null };
  }
  const after = text.slice(text.indexOf(parsed.raw) + parsed.raw.length);
  if (/^\s*(?:-|–|—|to|until)\s*(?:$|[|,·(])/i.test(after)) return { raw: parsed.raw, start, end: null, single: false, problem: "no_end" };
  return { raw: parsed.raw, start, end: start, single: true, problem: null };
}

const PRESENT: DatePoint = { year: 9999, month: 12 };
const endPoint = (end: DatePoint | "present") => (end === "present" ? PRESENT : end);

/** -1, 0 or 1. Null when a year-only date and a month in that same year can't be put in order. */
export function comparePoints(a: DatePoint, b: DatePoint): -1 | 0 | 1 | null {
  if (a.year !== b.year) return a.year < b.year ? -1 : 1;
  if (a.month === null && b.month === null) return 0;
  if (a.month === null || b.month === null) return null;
  return a.month === b.month ? 0 : a.month < b.month ? -1 : 1;
}

type DatedEntry = ReadDates & { start: DatePoint; end: DatePoint | "present" };

export type Relation = "fine" | "overlap" | "out_of_order" | "unknown";

/** How an entry listed lower down relates to one listed above it. */
export function relation(above: Pick<DatedEntry, "start" | "end">, below: Pick<DatedEntry, "start" | "end">): Relation {
  const aboveEnd = endPoint(above.end);
  const belowEnd = endPoint(below.end);
  const gap = comparePoints(below.start, aboveEnd);
  if (gap === null) return "unknown";
  if (gap < 0) return comparePoints(belowEnd, above.start) === -1 ? "fine" : "overlap";
  // The lower one starts as the upper one ends, or after it: out of order if it is later in any way.
  const laterEnd = comparePoints(belowEnd, aboveEnd);
  const laterStart = comparePoints(below.start, above.start);
  if (laterEnd === 1 || laterStart === 1) return "out_of_order";
  return laterEnd === null && laterStart === null ? "unknown" : "fine";
}

/** Sections in which order means anything. Awards, skills and interests aren't lists of periods of time. */
const ORDERED_SECTIONS = new Set(["experience", "education", "projects", "activities"]);
/** Sections where every entry is expected to have dates; an undated project is ordinary. */
const DATES_EXPECTED = new Set(["experience", "education"]);
/** A bound on the comparison below, which is quadratic per section. No real CV is near it. */
const MAX_ENTRIES = 120;

export interface Entry extends ReadDates {
  line: number;
  text: string;
  span: number;
  section: string;
  heading: string;
}

export interface EntryGroup {
  span: number;
  section: string;
  heading: string;
  entries: Entry[];
  /** Entries in the section that should have dates and have none, as line indexes. */
  undated: number[];
  /** Non-bullet lines in the section that aren't dates, so an education section with no dates at all can be noticed. */
  lines: number;
}

const headingName = (section: string, heading: string | null) => (heading ? heading.replace(/[:|_*#]+/g, " ").replace(/\s+/g, " ").trim() : section.charAt(0).toUpperCase() + section.slice(1));

/** The dated entries of each section occurrence, in the order they are listed, using the structure the parser recorded. */
export function entryGroups(cv: CvReading): EntryGroup[] {
  const { sections, roles } = cv.parsed.structure;
  const groups: EntryGroup[] = [];
  sections.forEach((s, span) => {
    if (!ORDERED_SECTIONS.has(s.key)) return;
    const end = sections[span + 1]?.line ?? cv.lines.length;
    const heading = headingName(s.key, s.heading);
    const group: EntryGroup = { span, section: s.key, heading, entries: [], undated: [], lines: 0 };
    const add = (line: number) => {
      const d = readDates(cv.lines[line]);
      if (d && group.entries.length < MAX_ENTRIES) group.entries.push({ ...d, line, text: cv.lines[line], span, section: s.key, heading });
      return !!d;
    };

    if (s.key === "education") {
      // Education isn't a section the parser records roles for, so its entries are read from the lines: not bullets, and not sentences.
      for (let l = s.line + (s.heading ? 1 : 0); l < end; l++) {
        if (cv.isBullet(l)) continue;
        group.lines++;
        const text = cv.lines[l];
        if (!(/[.!?]$/.test(text) && text.split(/\s+/).length > 14)) add(l);
      }
    } else {
      const inSpan = roles.map((r, i) => ({ r, i })).filter(({ r }) => r.line >= s.line && r.line < end);
      const repeatKey = (t: string) => t.replace(/\d+/g, "#");
      // A page header or footer is read as a role line (see document.ts), and it repeats anywhere in the text.
      const counts = new Map<string, number>();
      for (const l of cv.lines) counts.set(repeatKey(l), (counts.get(repeatKey(l)) ?? 0) + 1);
      inSpan.forEach(({ r, i }, at) => {
        group.lines++;
        if (add(r.line) || !DATES_EXPECTED.has(s.key)) return;
        // A heading with no date of its own is undated only if it has its own bullets and isn't the title or employer beside a date line.
        const hasBullets = cv.parsed.bullets.some((b) => b.roleIndex === i) || (at + 1 < inSpan.length ? hasBulletBetween(cv, r.line, inSpan[at + 1].r.line) : hasBulletBetween(cv, r.line, end));
        const prev = inSpan[at - 1]?.r;
        const besideDate = !!prev && prev.line === r.line - 1 && !!readDates(prev.heading);
        const pageFurniture = /\bpage\s+\d/i.test(r.heading) || (counts.get(repeatKey(r.heading)) ?? 0) > 1;
        if (hasBullets && !besideDate && !pageFurniture) group.undated.push(r.line);
      });
    }
    groups.push(group);
  });
  return groups;
}

function hasBulletBetween(cv: CvReading, from: number, to: number): boolean {
  for (let l = from + 1; l < to; l++) if (cv.isBullet(l)) return true;
  return false;
}

const isDated = (e: Entry): e is Entry & DatedEntry => e.problem === null && e.start !== null && e.end !== null;

const PROBLEM_WORDS: Record<DateProblem, string> = {
  no_end: "has a start date and no end date",
  no_year: "has no full year",
  backwards: "ends before it starts",
};

const quoteEntry = (e: { text: string }) => `"${shortLine(e.text)}"`;

/** The ordering finding for a CV. */
export function dateOrderFinding(cv: CvReading): Finding {
  const id = "supplemental.date_order";
  const groups = entryGroups(cv);
  if (!groups.length) return supplementalFinding(id, "not_applicable", "We found no Experience, Education, Projects or Activities section, so there was nothing to put in order.");

  const issues: { group: EntryGroup; above: Entry; below: Entry }[] = [];
  const unsure: Entry[] = [];
  let compared = 0;
  let overlaps = 0;
  const oldestFirst: EntryGroup[] = [];

  for (const g of groups) {
    const dated = g.entries.filter(isDated);
    let adjacent = 0;
    let adjacentOut = 0;
    for (let j = 1; j < dated.length; j++) {
      compared++;
      adjacent++;
      const direct = relation(dated[j - 1], dated[j]);
      if (direct === "out_of_order") adjacentOut++;
      if (direct === "overlap") overlaps++;
      // The nearest entry above that this one is out of order with. Looking past the adjacent entry catches an
      // entry below a long-running job that overlaps both: A 2020-21, Job 2010-24, B 2022-23.
      let found: Entry | null = null;
      let unknown = false;
      for (let i = j - 1; i >= 0 && !found; i--) {
        const r = relation(dated[i], dated[j]);
        if (r === "out_of_order") found = dated[i];
        else if (r === "unknown") unknown = true;
      }
      if (found) issues.push({ group: g, above: found, below: dated[j] });
      else if (unknown) unsure.push(dated[j]);
    }
    if (adjacent >= 2 && adjacentOut === adjacent) oldestFirst.push(g);
  }

  const incomplete = groups.flatMap((g) => g.entries.filter((e) => e.problem !== null));
  const undated = groups.flatMap((g) => g.undated);
  const noDates = groups.filter((g) => DATES_EXPECTED.has(g.section) && g.lines > 0 && g.entries.length === 0 && !g.undated.length);
  const openPoints = [...incomplete.map((e) => e.line), ...undated, ...unsure.map((e) => e.line)];
  const incompleteSentence = [
    ...incomplete.slice(0, 3).map((e) => `${quoteEntry(e)} ${PROBLEM_WORDS[e.problem!]}`),
    ...undated.slice(0, 3).map((l) => `${quoteEntry({ text: cv.lines[l] })} has no date we could read`),
    ...unsure.slice(0, 2).map((e) => `${quoteEntry(e)} gives only a year or only a month where the entry above it differs, so the two can't be put in order`),
    ...noDates.slice(0, 2).map((g) => `we could read no dates in ${g.heading}`),
  ];

  if (issues.length) {
    const named = oldestFirst.length ? `${listWords(oldestFirst.map((g) => g.heading))} ${oldestFirst.length === 1 ? "runs" : "run"} oldest first. ` : "";
    const pairs = issues.slice(0, 3).map(({ group, above, below }) => `In ${group.heading}, ${quoteEntry(above)} is listed above ${quoteEntry(below)}, which is more recent.`);
    const more = issues.length > 3 ? ` ${plural(issues.length - 3, "other entry", "other entries")} ${issues.length === 4 ? "is" : "are"} out of order in the same way.` : "";
    const also = incompleteSentence.length ? ` Also, ${incompleteSentence.join("; ")}.` : "";
    return supplementalFinding(id, "needs_attention", `${named}${pairs.join(" ")}${more} UK CVs usually put the most recent entry first in each section, so recruiters see it first.${also}`, "If most recent first is what you want, move the more recent entries up. We haven't changed the order of your CV.", evidenceFor(cv, [...issues.flatMap((i) => [i.above.line, i.below.line]), ...openPoints]));
  }

  if (incompleteSentence.length) {
    return supplementalFinding(id, "uncertain", `We can't say whether everything is in order: ${incompleteSentence.join("; ")}. This isn't an error, only something we couldn't confirm from the text.`, "Give each entry a start and an end, such as \"Sep 2023 - Jun 2024\" or \"2023 - Present\", and we can check the order.", evidenceFor(cv, openPoints));
  }

  if (!compared) return supplementalFinding(id, "not_applicable", "No section has two dated entries, so there was no order to check.");

  const covered = groups.filter((g) => g.entries.length >= 2).map((g) => g.heading);
  return supplementalFinding(id, "passed", `${listWords(covered)} ${covered.length === 1 ? "runs" : "run"} most recent first, as far as the dates show.${overlaps ? ` ${overlaps === 1 ? "One pair of entries overlaps" : `${overlaps} pairs of entries overlap`}, which is fine: people often hold two roles at once, and an employer's dates can contain the roles within it.` : ""} Work and study are compared separately, so studying while working is never counted against you.`);
}
