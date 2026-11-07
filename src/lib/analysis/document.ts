import { createHash } from "node:crypto";
import type { ConfidenceBand, DocumentFormat, DocumentMeta, DocumentSource, ExtractionWarning, ExtractionWarningCode, PageInfo } from "@/lib/types";
import type { ExtractedDocument } from "./extract";
import { normaliseText, sha256 } from "./fingerprint";
import { parseCv, PARSER_VERSION, type ParsedCv } from "./parse";

// Turns what extraction observed about a file, and what the parser read from its text, into the document
// metadata saved with a CV report: measured or estimated pages, warnings, a confidence figure and the
// structure. Nothing here changes the text or a score; it describes how far the text can be trusted.

/** Mirrors the estimate in `analyseCv` ("about N pages at 450 words a page"), so the two numbers always agree. */
export const WORDS_PER_PAGE = 450;
export const estimatePages = (words: number) => Math.max(1, Math.round(words / WORDS_PER_PAGE));

/** A CV with at least this many readable words is a whole CV; a text-less page beside it is probably blank overflow, not a missing scan. */
const WHOLE_CV_WORDS = 300;

/**
 * What each warning takes off a confidence of 1. Heuristic weights chosen so that one layout quirk leaves
 * the band high, a defect that changes what was assessed drops it to medium, and two or more drop it to low.
 * `pages_without_text` is 0.6 when little text was read and 0.05 (information only) when a whole CV was.
 */
export const WARNING_WEIGHT: Record<ExtractionWarningCode, number> = {
  pages_without_text: 0.6,
  two_column_layout: 0.15,
  symbol_font_markers: 0.3,
  table_layout: 0.25,
  repeated_header_footer: 0.1,
  letter_spaced_text: 0.05,
  unusual_characters: 0.2,
  no_sections_recognised: 0.3,
  unrecognised_headings: 0.1, // per heading, up to 0.3
  no_bullets_found: 0.25,
};

export const BAND_FLOOR: Record<ConfidenceBand, number> = { high: 0.8, medium: 0.5, low: 0 };

export function confidenceBand(score: number): ConfidenceBand {
  return score >= BAND_FLOOR.high ? "high" : score >= BAND_FLOOR.medium ? "medium" : "low";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function warning(code: ExtractionWarningCode, weight: number, message: string, detail: string, count: number | null = null, items: string[] = []): ExtractionWarning & { weight: number } {
  return { code, severity: weight >= 0.1 ? "caution" : "info", message, detail, count, items, weight };
}

/* ---------- warnings from the file ---------- */

const UNUSUAL_RE = /[-�\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const LETTER_SPACED_RE = /^\s*(?:\S\s){3,}\S\s*$/;

/** Lines at the top or bottom of every page, with digits generalised, so "Page 1 of 2" and "Page 2 of 2" match. */
export function repeatedEdgeLines(pages: string[]): string[] {
  if (pages.length < 2) return [];
  const edge = (p: string) => {
    const ls = p.split("\n").map((l) => l.trim()).filter(Boolean);
    return [...ls.slice(0, 2), ...ls.slice(-2)];
  };
  const key = (l: string) => l.replace(/\d+/g, "#");
  const sets = pages.slice(1).map((p) => new Set(edge(p).map(key)));
  const out: string[] = [];
  for (const line of edge(pages[0])) {
    const k = key(line);
    if (k.replace(/[^\p{L}]/gu, "").length >= 3 && sets.every((s) => s.has(k)) && !out.includes(k)) out.push(k);
  }
  return out;
}

const tableWarning = (count: number) => warning("table_layout", WARNING_WEIGHT.table_layout, "Part of your CV is laid out as a table.", "Table cells come out one per line, so a role and its dates can end up on separate lines, and bullets inside a table may lose their place.", count);

function fileWarnings(doc: ExtractedDocument, words: number): (ExtractionWarning & { weight: number })[] {
  const out: (ExtractionWarning & { weight: number })[] = [];
  const pdf = doc.pdf;
  if (pdf) {
    if (pdf.textless.length) {
      const whole = words >= WHOLE_CV_WORDS;
      const pages = pdf.textless.map(String);
      out.push(
        warning(
          "pages_without_text",
          whole ? 0.05 : WARNING_WEIGHT.pages_without_text,
          `${pdf.textless.length === 1 ? `Page ${pages[0]}` : `Pages ${list(pages)}`} of your PDF ${pdf.textless.length === 1 ? "has" : "have"} no text we can read.`,
          whole
            ? "It is probably a blank page at the end of your CV, or an image. Only the text we could read was assessed."
            : "It may be a scan or a photo. We can only assess the text we could read, so this score covers part of your CV, not all of it.",
          pdf.textless.length,
        ),
      );
    }
    if (pdf.columnPages) {
      out.push(warning("two_column_layout", WARNING_WEIGHT.two_column_layout, "Your CV is laid out in two columns.", "We read the main column first, then the side column, so check that nothing from one column has ended up in the other.", pdf.columnPages));
    }
    if (pdf.symbolMarkers >= 2) {
      out.push(
        warning(
          "symbol_font_markers",
          WARNING_WEIGHT.symbol_font_markers,
          `${plural(pdf.symbolMarkers, "line")} start with a symbol our reader turned into a letter or digit.`,
          "Bullet points drawn with a symbol font (Wingdings, for example) don't come through as bullets, so those lines may not have been assessed as bullet points. Exporting from Word with standard bullets fixes this.",
          pdf.symbolMarkers,
        ),
      );
    }
    if (pdf.tableRows >= 2) out.push(tableWarning(pdf.tableRows));
    if (doc.pages) {
      const repeated = repeatedEdgeLines(doc.pages);
      if (repeated.length) {
        out.push(warning("repeated_header_footer", WARNING_WEIGHT.repeated_header_footer, "The same header or footer appears on every page.", "Those lines were read as part of your CV's text, so the word count includes them and a role's bullets can be split around them.", repeated.length, repeated));
      }
    }
  }
  if (doc.docx?.tables) out.push(tableWarning(doc.docx.tables));
  return [...out, ...stringWarnings(doc.text)];
}

/** Warnings read from the characters of the text alone, so they apply to typed and corrected text as well as to files. */
function stringWarnings(text: string): (ExtractionWarning & { weight: number })[] {
  const out: (ExtractionWarning & { weight: number })[] = [];
  const spaced = text.split("\n").filter((l) => LETTER_SPACED_RE.test(l)).length;
  if (spaced) {
    out.push(warning("letter_spaced_text", WARNING_WEIGHT.letter_spaced_text, `${plural(spaced, "line was", "lines were")} typed with spaces between the letters.`, "We rejoined them to recognise the section names. Nothing to fix unless a section below is missing.", spaced));
  }
  const unusual = (text.match(UNUSUAL_RE) ?? []).length;
  if (unusual >= 3) {
    out.push(warning("unusual_characters", WARNING_WEIGHT.unusual_characters, `${plural(unusual, "character")} in your file didn't translate into readable text.`, "A font without a text map produces these. The affected words may have been assessed as misspellings or missed entirely. Exporting again from Word or Google Docs usually fixes it.", unusual));
  }
  return out;
}

/* ---------- warnings and structure from the text ---------- */

function textWarnings(parsed: ParsedCv): (ExtractionWarning & { weight: number })[] {
  const out: (ExtractionWarning & { weight: number })[] = [];
  if (parsed.sections.length === 0) {
    out.push(warning("no_sections_recognised", WARNING_WEIGHT.no_sections_recognised, "We didn't recognise any section headings.", "Headings such as Education, Experience and Skills tell us where each part begins. Without them, bullets can't be grouped under roles and the structure checks have little to work with."));
  }
  const unknown = parsed.structure.unrecognisedHeadings;
  if (unknown.length) {
    const shown = unknown.slice(0, 4).map((h) => h.charAt(0) + h.slice(1).toLowerCase());
    out.push(
      warning(
        "unrecognised_headings",
        Math.min(0.3, WARNING_WEIGHT.unrecognised_headings * unknown.length),
        `${plural(unknown.length, "heading isn't one", "headings aren't ones")} we know: ${list(shown)}${unknown.length > 4 ? " and more" : ""}.`,
        "Lines under them were read as part of the section above, so roles and bullets there may be grouped under the wrong heading.",
        unknown.length,
        unknown,
      ),
    );
  }
  if (parsed.bullets.length === 0) {
    out.push(warning("no_bullets_found", WARNING_WEIGHT.no_bullets_found, "We found no bullet points.", "Nine checks assess bullet points, so with none found they scored 0 rather than passing. If your CV has bullets, the file may not have carried them through."));
  }
  return out;
}

/** Repeated page headers and footers are read as role lines by the parser; the structure attributes their bullets to the real role above. */
function structureOf(parsed: ParsedCv, repeated: string[]): DocumentMeta["structure"] {
  const key = (l: string) => normaliseText(l).replace(/\d+/g, "#");
  const rep = repeated.map(key);
  const drop = parsed.structure.roles.map((r) => rep.includes(key(r.heading)));
  const realRole = (i: number | null): number | null => {
    while (i !== null && drop[i]) i = i > 0 && parsed.structure.roles[i - 1].section === parsed.structure.roles[i].section ? i - 1 : null;
    return i;
  };
  const roleOf = parsed.bullets.map((b) => realRole(b.roleIndex));
  const spans = parsed.structure.sections;
  const sections = spans.map((s, i) => {
    const end = spans[i + 1]?.line ?? Number.MAX_SAFE_INTEGER;
    return { key: s.key, heading: s.heading, bullets: parsed.bullets.filter((b) => b.lines[0] >= s.line && b.lines[0] < end).length };
  });
  const roles = parsed.structure.roles.flatMap((r, i) => (drop[i] ? [] : [{ section: r.section, heading: r.heading, dates: r.dates, bullets: roleOf.filter((x) => x === i).length }]));
  return { sections, roles, bullets: parsed.bullets.length, wrappedBullets: parsed.bullets.filter((b) => b.lines[1] > b.lines[0]).length, unrecognisedHeadings: [...parsed.structure.unrecognisedHeadings] };
}

/* ---------- the record ---------- */

export function pageInfo(doc: ExtractedDocument, words: number): PageInfo {
  const estimated = estimatePages(words);
  if (doc.pdf && doc.pageStarts) {
    return { measured: doc.pdf.pageCount, estimated, provenance: "measured", starts: doc.pageStarts, withoutText: [...doc.pdf.textless], explicitBreaks: null };
  }
  return { measured: null, estimated, provenance: "estimated", starts: [], withoutText: [], explicitBreaks: doc.docx?.explicitBreaks ?? null };
}

/**
 * The document metadata for a CV read from an uploaded file. The parser runs on the same normalised text the
 * scorer sees, so the structure recorded here is the one the scores came from.
 */
export function documentMeta(doc: ExtractedDocument, bytes: Uint8Array): DocumentMeta {
  const parsed = parseCv(normaliseText(doc.text));
  const weighted = [...fileWarnings(doc, parsed.words), ...textWarnings(parsed)];
  const repeated = weighted.find((w) => w.code === "repeated_header_footer")?.items ?? [];
  return {
    source: { kind: "upload", format: doc.format, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") },
    documentVersion: sha256(doc.text),
    extraction: { extractor: doc.extractor, parser: PARSER_VERSION, pages: pageInfo(doc, parsed.words), ...assess(weighted) },
    structure: structureOf(parsed, repeated),
  };
}

/** Recorded as the extractor of a version whose text the student typed or corrected: no file was read for it. */
export const TEXT_EXTRACTOR = "student-text";

/**
 * The document metadata for a version whose text came from the student (a correction or a paste), not a file.
 * There is no file to measure, so pages are estimated and only the warnings that can be read from the text itself
 * apply; the confidence says how far the parser could structure what the student wrote.
 */
export function documentMetaForText(text: string, source: Exclude<DocumentSource, { kind: "upload" }>): DocumentMeta {
  const parsed = parseCv(normaliseText(text));
  const weighted = [...stringWarnings(text), ...textWarnings(parsed)];
  return {
    source,
    documentVersion: sha256(text),
    extraction: {
      extractor: TEXT_EXTRACTOR,
      parser: PARSER_VERSION,
      pages: { measured: null, estimated: estimatePages(parsed.words), provenance: "estimated", starts: [], withoutText: [], explicitBreaks: null },
      ...assess(weighted),
    },
    structure: structureOf(parsed, []),
  };
}

function assess(weighted: (ExtractionWarning & { weight: number })[]): Pick<DocumentMeta["extraction"], "warnings" | "confidence"> {
  const score = Math.round(Math.max(0, Math.min(1, 1 - weighted.reduce((sum, w) => sum + w.weight, 0))) * 100) / 100;
  return { warnings: weighted.map((w) => ({ code: w.code, severity: w.severity, message: w.message, detail: w.detail, count: w.count, items: w.items })), confidence: { score, band: confidenceBand(score) } };
}

/** What the upload screen shows straight after a file is read. No CV text beyond the warnings' own items. */
export interface ReadingSummary {
  /** The file's format for an upload; null for text the student typed or corrected. */
  format: DocumentFormat | null;
  confidence: DocumentMeta["extraction"]["confidence"];
  pages: Pick<PageInfo, "measured" | "estimated" | "provenance">;
  warnings: Pick<ExtractionWarning, "code" | "severity" | "message" | "detail">[];
}

export function readingSummary(d: DocumentMeta): ReadingSummary {
  const { measured, estimated, provenance } = d.extraction.pages;
  return { format: d.source.kind === "upload" ? d.source.format : null, confidence: d.extraction.confidence, pages: { measured, estimated, provenance }, warnings: d.extraction.warnings.map(({ code, severity, message, detail }) => ({ code, severity, message, detail })) };
}
