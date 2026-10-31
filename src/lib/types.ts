// Shared domain types. The Supabase schema (supabase/migrations) stores these shapes,
// with analysis results kept as jsonb in reports.payload.

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
}

/* ---------- CV analysis ---------- */

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
    /** Hash of the normalised text + sector + rubric. Equal fingerprints always mean equal scores. */
    fingerprint?: string;
    judgments?: { result: string; verb: string; kind: string; relevance: string }[];
  };
}

export interface CvReviewPayload {
  fileName: string;
  sector: string;
  stage: string;
  text: string;
  storagePath?: string | null;
  analysis: CvAnalysis;
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

export interface TailorPayload {
  cvReportId: string;
  cvFileName: string;
  jobTitle: string;
  employer: string;
  jobUrl: string | null;
  jobText: string;
  deadline: string | null;
  keywords: KeywordHit[];
  matchNow: number;
  matchTailored: number;
  jd: JdBlock[];
  added: string[];
  tailored: { where: string; before: string; after: string; keywords?: string[] }[] | null;
  /** Set when Claude tailored the CV: a profile for the top, skills to list, keywords left out because the CV doesn't show them, and the whole CV with the changes made. */
  summary?: string | null;
  skillsToAdd?: string[];
  notEvidenced?: string[];
  tailoredCv?: string | null;
  aiTailored?: boolean;
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
