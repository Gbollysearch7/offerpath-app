// Shared domain types. The Supabase schema (supabase/migrations) stores these shapes,
// with analysis results kept as jsonb in reports.payload. Every payload carries `payloadVersion`;
// `src/lib/report-schema.ts` validates payloads on write and adapts older ones on read.

export type Stage = "first" | "penultimate" | "final" | "graduate";
export type Role = "student" | "admin";
export type FeeStatus = "home" | "international";

export interface Profile {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  universityId: string | null;
  universityName: string | null;
  stage: Stage | null;
  sectors: string[];
  visaSponsorship: boolean;
  deadlineReminders: boolean;
  shareProgress: boolean;
  adviserCanViewCv: boolean;
  onboarded: boolean;
  course: string | null;
  yearOfStudy: string | null;
  feeStatus: FeeStatus | null;
  faculty: string | null;
  studentNumber: string | null;
}

export type ReportType = "cv_review" | "tailor" | "cover_letter";

export const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  cv_review: "CV review",
  tailor: "Tailor to a job",
  cover_letter: "Cover letter",
};

export interface ReportRow {
  id: string;
  type: ReportType;
  title: string;
  score: number | null;
  createdAt: string;
  /** The CV source version this report scored (OP-006). Absent or null when none was recorded. */
  sourceId?: string | null;
  /** CV reviews in a list: the score's series (null: not comparable with anything) and coverage. See coverage.ts. */
  scoring?: { series: string | null; coverage: "complete" | "incomplete" | "withheld" };
}

/* ---------- CV analysis ---------- */

/** The versions of everything that turned text into a score, recorded with the score. See scoring-contract.ts. */
export interface ScoringRecord {
  /** All the fields below but `coreFingerprint`, joined. Scores compare only within one identity. */
  identity: string;
  method: "ai" | "rules";
  rubric: string;
  parser: string;
  lexicon: string;
  normaliser: string;
  /** Null for the rule engine, which has no prompt and no model. */
  judgePrompt: string | null;
  model: string | null;
  /** Hash of the identity and normalised text. Equal core fingerprints mean the same content under the same rules. */
  coreFingerprint: string;
}

export type AreaKey = "impact" | "clarity" | "structure" | "sector" | "spelling" | "length";

export type CheckKey =
  | "quant"
  | "verbs"
  | "accomp"
  | "repeat"
  | "filler"
  | "buzz"
  | "passive"
  | "sections"
  | "ats"
  | "contact"
  | "sector"
  | "spell"
  | "grammar"
  | "length"
  | "bulletlen"
  | "bullets";

export interface CheckResult {
  key: CheckKey;
  area: AreaKey;
  name: string;
  score: number; // 0-10
  summary: string; // short line, e.g. "3 of 16 bullets have a number"
  detail: string; // a sentence for the check page
  stat: { value: string; label: string };
  affected: number[]; // indexes into lines
  progress?: { have: number; total: number; target: number };
  extras?: string[]; // e.g. missing keywords, US spellings found
}

export interface AreaResult {
  key: AreaKey;
  name: string;
  score: number; // 0-100
  what: string;
  checks: CheckResult[];
}

export interface LineIssue {
  ok: boolean;
  t: string;
}

export interface LineResult {
  where: string; // e.g. "EXPERIENCE · EVENTS OFFICER, ECONOMICS SOCIETY"
  short: string; // e.g. "EXPERIENCE 1"
  text: string;
  score: number; // 1-10
  cols: { name: string; items: LineIssue[] }[];
  rewrite: string;
  /** True when Claude wrote the current rewrite (the first suggestion is rule-based). */
  aiRewrite?: boolean;
  accepted?: string;
  /** How the saved version was checked (OP-015): the rule version, and what the student confirmed as true. */
  acceptedCheck?: { validator: string; confirmed: string[] };
}

export interface CvAnalysis {
  score: number;
  areas: AreaResult[];
  lines: LineResult[];
  steps: { check: CheckKey; text: string; area: string; gain: number }[];
  wells: { check: CheckKey; text: string; area: string }[];
  meta: {
    words: number;
    pages: number;
    bullets: number;
    sections: string[];
    name: string | null;
    email: string | null;
    phone: string | null;
    /** Who judged the bullets: Claude Haiku ("ai") or the rule engine. */
    method?: "ai" | "rules";
    judge?: string;
    rubric?: string;
    /** Hash of the normalised text + sector + rubric + method. Same rubric, same parser and word lists: equal fingerprints mean equal scores. */
    fingerprint?: string;
    /** Absent on reports made before OP-010. */
    scoring?: ScoringRecord;
    judgments?: { result: string; verb: string; kind: string; relevance: string }[];
  };
}

/* ---------- Findings: one shape for every assessment ---------- */

/** Shape of every saved report payload. Payloads without a `payloadVersion` were saved before 5 November 2026 (v0). */
export const PAYLOAD_VERSION = 1;

/**
 * A boolean can't tell an assessed success from a skipped check, so every finding has one of these:
 * passed: assessed, nothing to fix. needs_attention: assessed, something to fix. not_applicable: the
 * document had nothing for this check to assess. unavailable: the check could not run (for example a
 * provider failed). uncertain: the check ran but its result is not reliable enough to act on.
 */
export type FindingStatus = "passed" | "needs_attention" | "not_applicable" | "unavailable" | "uncertain";
/** How much the finding matters. `info` covers passed checks and anything that doesn't move the score. */
export type FindingSeverity = "high" | "medium" | "low" | "info";

export const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
  passed: "Passed",
  needs_attention: "Needs attention",
  not_applicable: "Not applicable",
  unavailable: "Unavailable",
  uncertain: "Uncertain",
};

export interface EvidenceRef {
  /** sha256 of the document text the block and offsets belong to. */
  documentVersion: string;
  /** Stable block id in that document: "doc" for the whole text, "line:3" for analysis.lines[3]. */
  block: string;
  /** Character offsets inside the block, valid only for this documentVersion. Null when not recorded. */
  range: { start: number; end: number } | null;
  /** The referenced text itself, so the evidence stays readable if offsets ever go stale. */
  quote: string;
}

export interface Finding {
  /** Stable within one assessment: the check key for CV findings, the check title's slug for letters. */
  id: string;
  check: string;
  status: FindingStatus;
  severity: FindingSeverity;
  /** 0 to 1. Null when no calibrated confidence exists for this kind of finding. */
  confidence: number | null;
  /** Who produced the underlying judgment. Null when a historical record didn't say. */
  method: "rules" | "ai" | null;
  explanation: string;
  action: string | null;
  evidence: EvidenceRef[];
}

export interface Assessment {
  /** sha256 of the text that was assessed. */
  documentVersion: string;
  /** Null means the version was not recorded, never that there wasn't one. */
  versions: { parser: string | null; rubric: string | null; model: string | null; dictionary: string | null };
  /** engine: recorded when the report was made. legacy: derived on read from a report saved before findings existed. */
  origin: "engine" | "legacy";
  /** What this assessment cannot say, in the student's words. */
  limits: string[];
  findings: Finding[];
}

/* ---------- Proofreading: reported beside the score, never part of it ---------- */

export type ProofreadingCategory = "spelling" | "grammar" | "punctuation" | "regional";
export type ProofreadingLanguage = "en-GB" | "en-US";

/** One point the proofreader raises. Never "passed": a clean run is the absence of findings plus its coverage. */
export interface ProofreadingFinding extends Omit<Finding, "status"> {
  status: "needs_attention";
  category: ProofreadingCategory;
  /** The rule behind it, stable enough for a later dismissal to refer to. */
  rule: string;
  /** Replacements offered to the student. None is ever applied automatically. */
  suggestions: string[];
}

/** What was actually looked at for one category. `not_assessed` says nothing either way about the text. */
export interface ProofreadingCoverage {
  status: "assessed" | "partial" | "not_assessed";
  note: string;
}

/**
 * The saved result of one proofreading run. complete: the provider finished what it covers (see `coverage`,
 * which can still say a category wasn't assessed). partial: some of it didn't finish or was dropped.
 * unavailable: it didn't run, so nothing was assessed.
 */
export interface ProofreadingReport {
  status: "complete" | "partial" | "unavailable";
  provider: string;
  /** Null when the run didn't get as far as an engine, or the provider has no such thing. */
  engine: string | null;
  dictionary: string | null;
  terminology: string | null;
  language: ProofreadingLanguage;
  /** sha256 of the text that was checked. */
  documentVersion: string;
  coverage: Record<ProofreadingCategory, ProofreadingCoverage>;
  stats: { wordsChecked: number; wordsSkipped: number };
  limits: string[];
  findings: ProofreadingFinding[];
}

/* ---------- Document metadata: how the text was read out of the file ---------- */

export type DocumentFormat = "pdf" | "docx";

/** One point in a date range. `month` is null when only the year was given. */
export interface DatePoint {
  year: number;
  month: number | null;
}

/** A date or date range read from a role heading. `end` is "present" for Present/Current/Now/Ongoing, null for a single date. */
export interface DateRange {
  raw: string;
  start: DatePoint | null;
  end: DatePoint | "present" | null;
}

/**
 * Things extraction noticed that could make the text differ from the document the student sees. Each code has
 * a fixed weight in `src/lib/analysis/document.ts`; the weights add up to the confidence deduction.
 */
export const EXTRACTION_WARNING_CODES = [
  "pages_without_text",
  "two_column_layout",
  "symbol_font_markers",
  "table_layout",
  "repeated_header_footer",
  "letter_spaced_text",
  "unusual_characters",
  "no_sections_recognised",
  "unrecognised_headings",
  "no_bullets_found",
] as const;
export type ExtractionWarningCode = (typeof EXTRACTION_WARNING_CODES)[number];

export interface ExtractionWarning {
  code: ExtractionWarningCode;
  /** caution: likely to have changed what was assessed. info: worth knowing, unlikely to matter. */
  severity: "caution" | "info";
  /** One sentence for the student. */
  message: string;
  /** What it means for the assessment and what fixes it. */
  detail: string;
  /** How many times it happened, when counting makes sense. */
  count: number | null;
  /** The lines or headings concerned, as written in the document. */
  items: string[];
}

export type ConfidenceBand = "high" | "medium" | "low";

export interface PageInfo {
  /** Pages counted in the file itself. Only a PDF has this. Null means not measured, never zero. */
  measured: number | null;
  /** The word-count estimate (450 words a page): the same number `analysis.meta.pages` shows. */
  estimated: number;
  /** Which of the two a reader should quote. A Word file is never "measured": it has no pages until it is opened. */
  provenance: "measured" | "estimated";
  /** PDF: character offset in the saved text where each page starts, page 1 at 0. Empty when not measured. */
  starts: number[];
  /** PDF: 1-based pages with no text at all (an image or blank). Empty when not measured. */
  withoutText: number[];
  /** Word: explicit page breaks in the document. Structural information, not a page count. Null for PDFs. */
  explicitBreaks: number | null;
}

/* ---------- Source versions: where a CV's text came from ---------- */

export type SourceKind = "upload" | "correction" | "paste";

/** The kinds of block the editable content is cut into, from the structure the parser read. */
export type ContentBlockKind = "heading" | "role" | "bullet" | "line";

/** One editable piece of a CV's text: a heading, a role line, a bullet (rebuilt from its lines) or any other line. */
export interface ContentBlock {
  /** Stable within one document version: `b<n>` in document order. */
  id: string;
  kind: ContentBlockKind;
  section: string;
  /** Where the block sits, in the words the line editor uses: "EXPERIENCE · DATA ANALYST". */
  where: string;
  /** The text without any bullet marker. */
  text: string;
}

/** One block the student changed when correcting a version. `after` is empty when the block was removed. */
export interface SourceChange {
  block: string;
  kind: ContentBlockKind;
  where: string;
  before: string;
  after: string;
}

/** Why an uploaded file could not be read as text, as recorded with a retained original. */
export interface SourceOutcome {
  kind: "unsupported" | "rejected";
  code: string;
  message: string;
}

/**
 * How the text of a version came to be. `upload`: read from the student's file. `correction`: the student
 * edited the blocks of a parent version; `changes` lists every block that differs. `paste`: the student typed or
 * pasted the text, with the unreadable original kept beside it when there was one. The upload is never changed.
 */
export type DocumentSource =
  | { kind: "upload"; format: DocumentFormat; bytes: number; sha256: string }
  | { kind: "correction"; parentDocumentVersion: string; correctedAt: string; by: "student"; changes: SourceChange[] }
  | { kind: "paste"; pastedAt: string; by: "student"; original: { fileName: string; format: DocumentFormat | null; bytes: number; sha256: string; outcome: SourceOutcome | null } | null };

/**
 * A saved version of a CV's text, as the repositories return it. Versions are immutable; a correction is a new
 * version whose `parentId` names the one it was made from. `reportId` is the report that scored this version, or
 * null while it waits for the student's review.
 */
export interface CvSource {
  id: string;
  parentId: string | null;
  kind: SourceKind;
  fileName: string;
  text: string;
  /** sha256 of `text`. */
  documentVersion: string;
  /** Null only for a retained file that could not be read (its `outcome` says why). */
  document: DocumentMeta | null;
  outcome: SourceOutcome | null;
  /** Where the uploaded file is kept, when there is one; null in demo mode (bytes held in memory) and for text versions. */
  storagePath: string | null;
  hasFile: boolean;
  reportId: string | null;
  createdAt: string;
}

/**
 * How a CV's text was produced and how far it can be trusted. Saved beside the text so a report can say which
 * numbers were measured and which estimated, and so a low-confidence extraction can be shown for correction
 * (OP-006). Reports saved before this existed have no `document`: read that as "not recorded", not as high confidence.
 */
export interface DocumentMeta {
  source: DocumentSource;
  /** sha256 of the saved text: the same value as `assessment.documentVersion`. */
  documentVersion: string;
  extraction: {
    extractor: string;
    parser: string;
    pages: PageInfo;
    warnings: ExtractionWarning[];
    /** 1 minus the warning weights, clamped to 0..1. A heuristic, not a calibrated probability. */
    confidence: { score: number; band: ConfidenceBand };
  };
  /** The structure the parser read, by this `extraction.parser` version. Counts and headings, not the text. */
  structure: {
    sections: { key: string; heading: string | null; bullets: number }[];
    roles: { section: string; heading: string; dates: DateRange | null; bullets: number }[];
    bullets: number;
    /** Bullets rebuilt from more than one line. */
    wrappedBullets: number;
    unrecognisedHeadings: string[];
  };
}

export interface CvReviewPayload {
  payloadVersion: typeof PAYLOAD_VERSION;
  fileName: string;
  sector: string;
  stage: string;
  text: string;
  storagePath?: string | null;
  analysis: CvAnalysis;
  /** Absent on reports made before extraction metadata was recorded, and on demo seeds built from text. */
  document?: DocumentMeta;
  assessment: Assessment;
  /** An institution's own guidance, beside the common score and never part of it. Nothing writes this yet (OP-021). */
  institutionalGuidance?: InstitutionalGuidance;
  /** Absent on reports made before proofreading existed, which means not assessed, never passed. */
  proofreading?: ProofreadingReport;
}

/**
 * Guidance an institution adds for its own students. It has no score field on purpose, and it sits outside `analysis`
 * so that no score, band, finding or fingerprint can depend on it. Two students at different institutions with the
 * same CV get the same analysis and may see different guidance.
 */
export interface InstitutionalGuidance {
  kind: "institutional_guidance";
  /** Shown as written, so the reader can tell whose advice this is. */
  label: string;
  institutionId: string;
  version: string;
  notes: { title: string; text: string }[];
}

/* ---------- Tailoring ---------- */

export interface KeywordHit {
  w: string;
  n: number; // occurrences in ad
  must: boolean;
  where: string; // best place in CV
  soft: boolean;
  inCv: boolean;
}

export interface JdBlock {
  isH: boolean;
  text?: string;
  segs?: { t: string; kind: "plain" | "found" | "missing" }[];
}

/* ---------- Job requirements and evidence coverage (OP-012, OP-013) ---------- */

/** essential/desirable: the advert says so. contextual: part of the work, not stated as needed. uncertain: the advert doesn't settle it. */
export type RequirementCategory = "essential" | "desirable" | "contextual" | "uncertain";
export type RequirementKind = "skill" | "tool" | "qualification" | "experience" | "location" | "eligibility";
/** explicit: named in what the student did. contextual: related or transferable, not named. weak: named only in a list. */
export type EvidenceLevel = "explicit" | "contextual" | "weak" | "none" | "not_assessed";
export type CoverageStatus = "scored" | "limited" | "insufficient";

export interface JobRequirement {
  id: string;
  label: string;
  kind: RequirementKind;
  category: RequirementCategory;
  /** Any one of these satisfies the requirement: "Terraform or Pulumi" is one requirement with two terms. */
  terms: string[];
  /** Other spellings the advert itself gave, such as the K8s in "Kubernetes (K8s)". */
  aliases: string[];
  /** The advert accepts something similar: "Power BI or similar tools". */
  orEquivalent: boolean;
  soft: boolean;
  /** Prominence only. Never decides the category. */
  occurrences: number;
  /** Why it has this category, in the student's words. */
  reason: string;
  /** The advert's own wording, with its position in the advert. */
  source: EvidenceRef;
  method: "rules" | "ai";
  /** False for conditions a CV can't settle, such as the right to work. Never counted in coverage. */
  assessable: boolean;
}

/** Something the advert says candidates don't need: "no experience necessary". */
export interface NotRequiredItem {
  label: string;
  terms: string[];
  source: EvidenceRef;
}

export interface JobMatchRequirement extends JobRequirement {
  evidence: { level: EvidenceLevel; matchedTerm: string | null; refs: EvidenceRef[]; note: string };
}

export interface JobMatch {
  /** JOB_SCORING_VERSION of the code that made it. A report without a jobMatch predates versioned job scoring. */
  version: string;
  method: "rules" | "rules+ai";
  adapter: "not_used" | "applied" | "failed";
  advertVersion: string;
  cvVersion: string;
  requirements: JobMatchRequirement[];
  notRequired: NotRequiredItem[];
  coverage: {
    status: CoverageStatus;
    /** Null when the advert doesn't support a percentage. */
    score: number | null;
    explanation: string;
    earned: number;
    possible: number;
    assessed: { essential: number; desirable: number };
    notCounted: { contextual: number; uncertain: number; toConfirm: number };
  };
  /** Essential requirements with no evidence found. Shown separately from the number, always. */
  essentialGaps: string[];
  /** Essential requirements with only weak or related evidence. */
  essentialThin: string[];
  /** Essential conditions the student has to check themselves. */
  toConfirm: string[];
}

export interface TailorPayload {
  payloadVersion: typeof PAYLOAD_VERSION;
  cvReportId: string;
  cvFileName: string;
  jobTitle: string;
  employer: string;
  jobUrl: string | null;
  jobText: string;
  deadline: string | null;
  keywords: KeywordHit[];
  /** Null when the advert doesn't support a percentage. Reports without a jobMatch hold the old scale's number. */
  matchNow: number | null;
  /** Null until measured from an actual tailored CV. Reports without a jobMatch hold the old estimate. */
  matchTailored: number | null;
  jd: JdBlock[];
  added: string[];
  tailored: { where: string; before: string; after: string; keywords?: string[] }[] | null;
  /** Set when Claude tailored the CV: a profile for the top, skills to list, keywords left out because the CV doesn't show them, and the whole CV with the changes made. */
  summary?: string | null;
  skillsToAdd?: string[];
  notEvidenced?: string[];
  tailoredCv?: string | null;
  aiTailored?: boolean;
  /** Absent on reports made before versioned job scoring: those keep their saved numbers and say so. */
  jobMatch?: JobMatch;
  assessment?: Assessment;
}

/* ---------- Cover letters ---------- */

export interface LetterCheck {
  ok: boolean;
  t: string;
  d: string;
}

export interface LetterParagraph {
  text: string;
  src: string[];
}

export interface CoverLetterPayload {
  payloadVersion: typeof PAYLOAD_VERSION;
  mode: "review" | "draft";
  jobTitle: string;
  employer: string;
  jobText: string;
  tailorReportId: string | null;
  cvReportId: string | null;
  cvFileName: string | null;
  addressee: string | null;
  notes: string | null;
  letterText: string; // full plain text
  paragraphs: LetterParagraph[]; // draft paragraphs with sources
  checks: LetterCheck[];
  keywordsUsed: string[];
  keywordsMissing: string[];
  words: number;
  paras: number;
  summary: string;
  saved: boolean;
  aiAssisted: boolean;
  assessment: Assessment;
}

/* ---------- Opportunities ---------- */

export type OppType = "Graduate scheme" | "Internship" | "Placement" | "Spring week";
export type AppStatus = "saved" | "applied" | "tests" | "interview" | "offer";

export const APP_STATUS_LABEL: Record<AppStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  tests: "Online tests",
  interview: "Interview",
  offer: "Offer",
};

export interface Opportunity {
  id: string;
  role: string;
  org: string;
  location: string;
  type: OppType;
  sector: string;
  sponsorsVisa: boolean;
  closesOn: string; // ISO date
  description: string;
  url?: string | null;
  /** True when the opportunity belongs to the viewer's university (careers admins can edit it). */
  own?: boolean;
}

export type OpportunityInput = Omit<Opportunity, "id" | "own"> & { id?: string };

export interface Application {
  id: string;
  opportunityId: string | null;
  role: string;
  org: string;
  status: AppStatus;
  closesOn: string | null;
  updatedAt: string;
}
