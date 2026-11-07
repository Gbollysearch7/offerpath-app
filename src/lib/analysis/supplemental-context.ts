import type { EvidenceRef, Finding, FindingStatus } from "@/lib/types";
import { normaliseText } from "./fingerprint";
import { BULLET_RE, parseCv, type ParsedCv } from "./parse";

// What the supplemental checks (OP-009) share: one reading of a CV, and one way of writing a finding.
//
// The supplemental checks are read-only observers. They parse the same normalised text the scorer sees, and
// nothing in cv.ts, rubric.ts or the fingerprint imports them, so they can't move a score. Their findings sit
// beside the core findings in `assessment.findings`, with ids under the `supplemental.` prefix.

export const SUPPLEMENTAL_KEYS = [
  "supplemental.date_order",
  "supplemental.pronouns",
  "supplemental.consistency_dates",
  "supplemental.consistency_punctuation",
  "supplemental.consistency_bullets",
  "supplemental.consistency_headings",
  "supplemental.consistency_visual",
] as const;

export type SupplementalKey = (typeof SUPPLEMENTAL_KEYS)[number];

/** Most evidence lines one supplemental finding quotes; the explanation still gives the full count. */
export const MAX_EVIDENCE = 8;

export interface CvReading {
  /** The normalised text: the "doc" evidence block, and what the parser and scorer read. */
  doc: string;
  documentVersion: string;
  parsed: ParsedCv;
  lines: string[];
  /**
   * The line as extracted, before normalisation turned every bullet glyph into • and every dash into a hyphen,
   * index for index with `lines`. Null when the two can't be matched up, and then presentation that only the raw
   * text shows (bullet glyphs, which dash) is said not to have been assessed rather than reported as consistent.
   */
  rawLines: string[] | null;
  /** The index into `parsed.structure.sections` of the heading a line sits under. */
  spanAt: (line: number) => number;
  sectionAt: (line: number) => string;
  isHeading: (line: number) => boolean;
  isRole: (line: number) => boolean;
  isBullet: (line: number) => boolean;
  /** The evidence reference for a whole line, or null if its place in the text can't be established. */
  ref: (line: number) => EvidenceRef | null;
}

export function readCv(rawText: string, documentVersion: string): CvReading {
  const doc = normaliseText(rawText);
  const parsed = parseCv(doc);
  const lines = parsed.lines;

  const starts: number[] = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.length + 1;
  }
  const located = lines.join("\n") === doc;

  const pairs = rawText.split(/\r\n?|\n/).map((raw) => ({ raw, norm: normaliseText(raw) })).filter((p) => p.norm);
  const rawLines = pairs.length === lines.length && pairs.every((p, i) => p.norm === lines[i]) ? pairs.map((p) => p.raw.trim()) : null;

  const spans = parsed.structure.sections;
  const spanAt = (line: number) => {
    let found = 0;
    for (let i = 0; i < spans.length && spans[i].line <= line; i++) found = i;
    return found;
  };
  const headings = new Set(spans.filter((s) => s.heading !== null).map((s) => s.line));
  const roles = new Set(parsed.structure.roles.map((r) => r.line));

  return {
    doc,
    documentVersion,
    parsed,
    lines,
    rawLines,
    spanAt,
    sectionAt: (line) => spans[spanAt(line)].key,
    isHeading: (line) => headings.has(line),
    isRole: (line) => roles.has(line),
    isBullet: (line) => BULLET_RE.test(lines[line]),
    ref: (line) => (located && lines[line] ? { documentVersion, block: "doc", range: { start: starts[line], end: starts[line] + lines[line].length }, quote: lines[line] } : null),
  };
}

/** Evidence for some lines, in document order, each once, capped. */
export function evidenceFor(cv: CvReading, lineIndexes: number[]): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  for (const i of [...new Set(lineIndexes)].sort((a, b) => a - b)) {
    if (out.length >= MAX_EVIDENCE) break;
    const r = cv.ref(i);
    if (r) out.push(r);
  }
  return out;
}

/**
 * A supplemental finding. Severity is always `info` (the schema's word for anything that doesn't move the score)
 * and confidence is null: these are uncalibrated rules, and no adviser has validated them.
 */
export function supplementalFinding(id: SupplementalKey, status: FindingStatus, explanation: string, action: string | null = null, evidence: EvidenceRef[] = []): Finding {
  return { id, check: id, status, severity: "info", confidence: null, method: "rules", explanation, action, evidence };
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const listWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** A line shortened to fit in a sentence. */
export const shortLine = (s: string, max = 70) => {
  const t = s.replace(/^•\s*/, "").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};
