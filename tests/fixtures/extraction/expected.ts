// The structure a reader expects from each synthetic extraction fixture (OP-005). These are written by hand
// from the documents as designed in scripts/make-extraction-fixtures.ts, not copied from the parser's
// output, so `tests/extract.test.ts` compares extraction with the document rather than with itself.
//
// Where the parser is known to fall short of the document, the expectation says so in `notes` and asserts the
// warning that discloses it, not the defective reading.
//
// `score` is the Readiness Score under the current versions and `scoreBefore` the one under the versions before the
// 2026-11-07 bump (parser-2026-11-05.1, lexicon-2026-11-05.1); docs/CLAUDE_REPORT_PARSER_BUMP.md explains every move.
// `gate` is what the student sees first: the review screen, the reading beside the score, or straight to the report.
import type { ConfidenceBand, DateRange, DocumentFormat, ExtractionWarningCode } from "@/lib/types";

const present = (year: number, month: number): DateRange => ({ raw: "", start: { year, month }, end: "present" });
const range = (y1: number, m1: number | null, y2: number, m2: number | null): DateRange => ({ raw: "", start: { year: y1, month: m1 }, end: { year: y2, month: m2 } });
const year = (y: number): DateRange => ({ raw: "", start: { year: y, month: null }, end: null });

export interface ExpectedRole {
  /** Matches the role heading as the structure records it. */
  heading: RegExp;
  /** The dates on that line; `raw` is not compared. Null when the line carries no date. */
  dates: DateRange | null;
  /** Bullets that belong to this role. */
  bullets: number;
}

export interface ExpectedExtraction {
  format: DocumentFormat;
  /** What this fixture reproduces and, where relevant, the limitation it discloses. */
  notes: string;
  textStartsWith: string;
  /** Section keys the parser should find, in order, without the implicit header. */
  sections: string[];
  /** Roles in document order. Null when the fixture's point is that roles cannot be read faithfully. */
  roles: ExpectedRole[] | null;
  bullets: number;
  wrappedBullets: number;
  pages: { measured: number | null; estimated: number; withoutText: number[]; explicitBreaks: number | null };
  /** Exactly these warning codes, in any order. */
  warnings: ExtractionWarningCode[];
  confidence: { score: number; band: ConfidenceBand };
  unrecognisedHeadings: string[];
  score: number;
  scoreBefore: number;
  gate: "review" | "reading-then-report" | "report";
}

const dataAnalyst: ExpectedRole = { heading: /^Data Analyst, Example Ltd/, dates: present(2024, 6), bullets: 2 };
const researchIntern: ExpectedRole = { heading: /^Research Intern, Fenwick Systems/, dates: range(2023, 9, 2023, 12), bullets: 2 };

export const EXPECTED: Record<string, ExpectedExtraction> = {
  "single-column.pdf": {
    format: "pdf",
    notes: "The plain case: one column, right-aligned dates in three formats (month-year to Present, month-name range, bare year), bullets under three roles.",
    textStartsWith: "Alex Example\n",
    sections: ["education", "experience", "projects", "skills"],
    roles: [dataAnalyst, researchIntern, { heading: /^Budget tracker app/, dates: year(2023), bullets: 1 }],
    bullets: 5,
    wrappedBullets: 0,
    pages: { measured: 1, estimated: 1, withoutText: [], explicitBreaks: null },
    warnings: [],
    confidence: { score: 1, band: "high" },
    unrecognisedHeadings: [],
    score: 88,
    scoreBefore: 88,
    gate: "report",
  },
  "two-column.pdf": {
    format: "pdf",
    notes: "A sidebar of skills and languages beside the main column, on one line grid. The main column (name and contact) must be read first and whole, then the sidebar, whose two headings (SKILLS, LANGUAGES) both normalise to the skills section.",
    textStartsWith: "Alex Example\n",
    sections: ["experience", "education", "skills", "skills"],
    roles: [{ ...dataAnalyst, bullets: 3 }],
    bullets: 3,
    wrappedBullets: 0,
    pages: { measured: 1, estimated: 1, withoutText: [], explicitBreaks: null },
    warnings: ["two_column_layout"],
    confidence: { score: 0.85, band: "high" },
    unrecognisedHeadings: [],
    score: 82,
    scoreBefore: 82,
    gate: "reading-then-report",
  },
  "wrapped-bullets.pdf": {
    format: "pdf",
    notes: "Three bullets stored as two lines each, breaking mid-sentence. Each must come back as one bullet with the full sentence.",
    textStartsWith: "Alex Example\n",
    sections: ["experience", "education", "skills"],
    roles: [{ ...dataAnalyst, bullets: 3 }],
    bullets: 3,
    wrappedBullets: 3,
    pages: { measured: 1, estimated: 1, withoutText: [], explicitBreaks: null },
    warnings: [],
    confidence: { score: 1, band: "high" },
    unrecognisedHeadings: [],
    score: 87,
    scoreBefore: 87,
    gate: "report",
  },
  "letter-spaced-headings.pdf": {
    format: "pdf",
    notes: "Headings drawn one letter at a time (P R O F I L E, W O R K  E X P E R I E N C E). All four must still be recognised as sections.",
    textStartsWith: "Alex Example\n",
    sections: ["summary", "education", "experience", "skills"],
    roles: [{ ...dataAnalyst, bullets: 3 }],
    bullets: 3,
    wrappedBullets: 0,
    pages: { measured: 1, estimated: 1, withoutText: [], explicitBreaks: null },
    warnings: ["letter_spaced_text"],
    confidence: { score: 0.95, band: "high" },
    unrecognisedHeadings: [],
    score: 85,
    scoreBefore: 85,
    gate: "report",
  },
  "repeated-header.pdf": {
    format: "pdf",
    notes: "Two pages with the same header line and a 'Page n of 2' footer. Page two opens with the rest of the first role's bullets, so the repeated header sits between a role and its bullets. The parser must not read the header or footer as roles, so the first role keeps all four bullets. Both stay in the scored text (the word count includes them), which the warning notes as information.",
    textStartsWith: "Alex Example — Curriculum Vitae\nAlex Example\n",
    sections: ["education", "experience", "skills"],
    roles: [{ ...dataAnalyst, bullets: 4 }, researchIntern],
    bullets: 6,
    wrappedBullets: 0,
    pages: { measured: 2, estimated: 1, withoutText: [], explicitBreaks: null },
    warnings: ["repeated_header_footer"],
    confidence: { score: 0.95, band: "high" },
    unrecognisedHeadings: [],
    score: 90,
    scoreBefore: 90,
    gate: "report",
  },
  "symbol-bullets.pdf": {
    format: "pdf",
    notes: "Bullets marked with a ZapfDingbats tick, which text extraction turns into the digit 3, and body text in Courier. The same glyph in a different font starts four rows, so each is written as a bullet point and all four are assessed. The warning remains as information.",
    textStartsWith: "Alex Example\n",
    sections: ["experience", "education", "skills"],
    roles: [{ ...dataAnalyst, bullets: 4 }],
    bullets: 4,
    wrappedBullets: 0,
    pages: { measured: 1, estimated: 1, withoutText: [], explicitBreaks: null },
    warnings: ["symbol_font_markers"],
    confidence: { score: 0.95, band: "high" },
    unrecognisedHeadings: [],
    score: 87,
    scoreBefore: 22,
    gate: "report",
  },
  "academic.pdf": {
    format: "pdf",
    notes: "An academic CV: Research experience, Publications, Teaching, Conferences and talks, with dates as Oct 2021 – present, 2019 – 2021, 03/2018 – 09/2018 and Autumn 2022. All four are recognised, so each section holds its own lines. Research and Teaching hold dated roles; Conferences and talks holds one bullet with no role.",
    textStartsWith: "Dr Sam Sample\n",
    sections: ["education", "experience", "achievements", "experience", "achievements", "skills"],
    roles: [
      { heading: /^Research Assistant, Genome Lab/, dates: range(2018, 3, 2018, 9), bullets: 2 },
      { heading: /^Teaching Assistant, Introduction to Programming/, dates: year(2022), bullets: 1 },
    ],
    bullets: 4,
    wrappedBullets: 0,
    pages: { measured: 1, estimated: 1, withoutText: [], explicitBreaks: null },
    warnings: [],
    confidence: { score: 1, band: "high" },
    unrecognisedHeadings: [],
    score: 85,
    scoreBefore: 83,
    gate: "report",
  },
  "mixed-scan.pdf": {
    format: "pdf",
    notes: "Page one has a short CV as text; page two is an image. The score covers page one only, and the metadata must say so: the measured page count is 2, page 2 has no text, confidence is low.",
    textStartsWith: "Alex Example\n",
    sections: ["experience"],
    roles: [dataAnalyst],
    bullets: 2,
    wrappedBullets: 0,
    pages: { measured: 2, estimated: 1, withoutText: [2], explicitBreaks: null },
    warnings: ["pages_without_text"],
    confidence: { score: 0.4, band: "low" },
    unrecognisedHeadings: [],
    score: 80,
    scoreBefore: 80,
    gate: "review",
  },
  "blank-trailing-page.pdf": {
    format: "pdf",
    notes: "A whole CV (over 300 words) that overflows onto an empty second page. Measured 2 pages, estimated 1: the two numbers differ and the record says which is which. The empty page is noted, not treated as a missing scan.",
    textStartsWith: "Alex Example\n",
    sections: ["summary", "education", "experience", "activities", "skills"],
    roles: [
      { ...dataAnalyst, bullets: 6 },
      { ...researchIntern, bullets: 6 },
      { heading: /^President, Data Society/, dates: range(2022, null, 2024, null), bullets: 6 },
    ],
    bullets: 18,
    wrappedBullets: 0,
    pages: { measured: 2, estimated: 1, withoutText: [2], explicitBreaks: null },
    warnings: ["pages_without_text"],
    confidence: { score: 0.95, band: "high" },
    unrecognisedHeadings: [],
    score: 100,
    scoreBefore: 100,
    gate: "report",
  },
  "table.docx": {
    format: "docx",
    notes: "A Word CV with roles and dates in a two-column table, an explicit page break and tab-aligned dates. Word has no pages until it is opened, so the page count is estimated, never measured, and the explicit break is recorded as structure. Each row with one date cell keeps its role and dates on one line, so both roles carry their dates and their bullets; the table warning remains as information.",
    textStartsWith: "Alex Example\n",
    sections: ["experience", "education", "skills"],
    roles: [
      { ...dataAnalyst, bullets: 2 },
      { heading: /^Research Intern, Fenwick Systems/, dates: range(2023, 9, 2023, 12), bullets: 2 },
    ],
    bullets: 4,
    wrappedBullets: 0,
    pages: { measured: null, estimated: 1, withoutText: [], explicitBreaks: 1 },
    warnings: ["table_layout"],
    confidence: { score: 0.95, band: "high" },
    unrecognisedHeadings: [],
    score: 87,
    scoreBefore: 87,
    gate: "report",
  },
  "lost-bullets.pdf": {
    format: "pdf",
    notes: "Bullets flattened into body text: every line starts with a 3 in the same font as the rest of the line. Nothing in the file shows these were bullets, so they stay as read and the student is asked to check.",
    textStartsWith: "Alex Example\n",
    sections: ["experience", "education", "skills"],
    roles: [{ ...dataAnalyst, bullets: 0 }],
    bullets: 0,
    wrappedBullets: 0,
    pages: { measured: 1, estimated: 1, withoutText: [], explicitBreaks: null },
    warnings: ["no_bullets_found"],
    confidence: { score: 0.75, band: "medium" },
    unrecognisedHeadings: [],
    score: 22,
    scoreBefore: 22,
    gate: "review",
  },
  "unknown-headings.pdf": {
    format: "pdf",
    notes: "Three headings the lexicon doesn't know. Lines under them are read as part of the section above, which the warning discloses, so the student checks the reading first.",
    textStartsWith: "Alex Example\n",
    sections: ["experience", "education", "skills"],
    roles: null,
    bullets: 4,
    wrappedBullets: 0,
    pages: { measured: 1, estimated: 1, withoutText: [], explicitBreaks: null },
    warnings: ["unrecognised_headings"],
    confidence: { score: 0.7, band: "medium" },
    unrecognisedHeadings: ["MILITARY SERVICE", "PATENTS", "EXHIBITIONS"],
    score: 86,
    scoreBefore: 86,
    gate: "review",
  },
  "table-undated.docx": {
    format: "docx",
    notes: "A Word table with no date in it. Nothing shows that the table kept roles and bullets together, so the table warning stays a caution and the student checks the reading first.",
    textStartsWith: "Alex Example\n",
    sections: ["experience", "education", "skills"],
    roles: null,
    bullets: 1,
    wrappedBullets: 0,
    pages: { measured: null, estimated: 1, withoutText: [], explicitBreaks: 0 },
    warnings: ["table_layout"],
    confidence: { score: 0.75, band: "medium" },
    unrecognisedHeadings: [],
    score: 82,
    scoreBefore: 82,
    gate: "review",
  },
};

/** Fixtures that must not produce a score at all. */
export const EXPECTED_OUTCOMES: Record<string, { kind: "unsupported" | "rejected"; code: string; notes: string }> = {
  "scan.pdf": { kind: "unsupported", code: "image_only", notes: "One page holding only an image: an image-only scan. No text, no score, an explanation and alternatives." },
  "scan.docx": { kind: "unsupported", code: "image_only", notes: "A Word file holding only a picture: the same outcome for the Word path." },
};
