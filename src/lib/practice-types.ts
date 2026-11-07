// OP-023: the shapes interview practice saves and shows. Types and small pure helpers only, safe in client components and
// the repositories. A saved answer is private to the student: no adviser, admin or share link reads one.

/** Bump when a rule in practice-feedback.ts changes: a saved answer keeps the feedback it was given, and says under which rules. */
export const PRACTICE_FEEDBACK_VERSION = "practice-feedback-2026-11-08.1";

export const ANSWER_MIN = 20;
export const ANSWER_MAX = 4000;

export type QuestionKind = "competency" | "motivation" | "commercial" | "technical";

export const PRACTICE_OBJECTIVES = ["all", "essential", "gaps", "cv", "motivation"] as const;
export type PracticeObjective = (typeof PRACTICE_OBJECTIVES)[number];
export const OBJECTIVE_LABEL: Record<PracticeObjective, string> = {
  all: "A mix of everything",
  essential: "What the advert says is essential",
  gaps: "Requirements my CV doesn't show",
  cv: "Backing up what my CV says",
  motivation: "Why this role and employer",
};

/** How the rules look for one part of a question. Each is about the wording of the answer, never whether it is right. */
export type PartCheck = "own_action" | "result" | "reason" | "experience" | "learned" | "topic" | "named" | "terms" | "honest_gap";

export interface PracticePart {
  id: string;
  label: string;
  check: PartCheck;
  /** For `terms` and `honest_gap`: any of these counts. */
  terms?: string[];
}

export interface PracticeGrounds {
  requirement: { id: string; label: string; category: "essential" | "desirable" | "contextual" | "uncertain"; advertQuote: string | null } | null;
  /** A piece of the chosen CV version, word for word. */
  cv: { heading: string | null; quote: string } | null;
  /** True when the advert asks for it and this CV version doesn't show it. */
  gap: boolean;
}

export interface PracticeQuestion {
  id: string;
  q: string;
  kind: QuestionKind;
  tip: string;
  /** Why this question, in the student's terms. Always present: a general question says that it is general. */
  why: string;
  /** Null for general practice: nothing here came from a CV or an advert. */
  grounds: PracticeGrounds | null;
  parts: PracticePart[];
  /** Which practice objective it serves. */
  focus: Exclude<PracticeObjective, "all">[];
}

export type SubstanceLevel = "little" | "some" | "concrete";
export type ContributionLevel = "clear" | "mixed" | "shared" | "unclear" | "not_asked";
export type StructureKey = "situation" | "task" | "action" | "result";

/** Feedback on one answer. There is no overall mark, on purpose: nothing here adds up to a verdict on the student. */
export interface PracticeFeedback {
  version: string;
  method: "rules" | "rules+ai";
  words: number;
  /** Whether the shape of an answer can be seen. Says nothing about whether what's in it is any good. */
  structure: { key: StructureKey; label: string; seen: boolean }[];
  substance: { level: SubstanceLevel; summary: string; details: string[] };
  contribution: { level: ContributionLevel; summary: string; quotes: string[] };
  /** What the question asked, and whether wording that addresses it could be found. */
  parts: { id: string; label: string; seen: boolean; flaggedByModel?: boolean }[];
  unsupported: {
    /** False when no CV version was compared: only claims with nothing behind them in the answer itself are listed. */
    compared: boolean;
    items: { kind: "not_on_cv" | "no_detail"; quote: string; note: string }[];
  };
  clearer: string[];
  /** Checked model comments: each is tied to words the student really wrote. Empty in rules-only mode. */
  modelNotes: { kind: "contribution" | "unsupported" | "clearer"; quote: string; comment: string }[];
  /** Square-bracket blanks still in the answer. */
  blanks: string[];
  /** Sentences that read like instructions to software, which were left out of the assessment. */
  ignoredSentences: number;
}

export interface PracticeAnswerInput {
  attemptKey: string;
  applicationId: string | null;
  mode: "general" | "application";
  /** "Role · Employer", kept so the answer still makes sense after the role stops being tracked. */
  roleLabel: string | null;
  /** The report holding the CV version the questions came from. */
  documentReportId: string | null;
  documentVersion: string | null;
  documentLabel: string | null;
  /** The report the advert came from, when it came from one rather than a listing. */
  advertReportId: string | null;
  advertVersion: string | null;
  objective: PracticeObjective;
  question: PracticeQuestion;
  answer: string;
  feedback: PracticeFeedback;
}

export interface PracticeAnswer extends PracticeAnswerInput {
  id: string;
  createdAt: string;
}

/** An application or report isn't the student's, or the record can't be saved in this shape. Nothing was saved. */
export class PracticeRefusedError extends Error {
  constructor(reason = "that can't be saved") {
    super(reason);
  }
}

export const STRUCTURE_NOTE = "This only shows which parts of an answer we could see. It isn't a mark, and it doesn't mean they're convincing.";

/** What the dashboard says about practice on one application. Takes ids, hashes and dates only, so no answer text reaches it. */
export interface PracticeSummary {
  count: number;
  latestAt: string;
  latestVersion: string | null;
  latestDocumentLabel: string | null;
}

export function summarisePractice(answers: Pick<PracticeAnswer, "applicationId" | "createdAt" | "documentVersion" | "documentLabel">[]): Record<string, PracticeSummary> {
  const out: Record<string, PracticeSummary> = {};
  for (const a of answers) {
    if (!a.applicationId) continue;
    const s = out[a.applicationId];
    if (!s) out[a.applicationId] = { count: 1, latestAt: a.createdAt, latestVersion: a.documentVersion, latestDocumentLabel: a.documentLabel };
    else {
      s.count += 1;
      if (a.createdAt > s.latestAt) Object.assign(s, { latestAt: a.createdAt, latestVersion: a.documentVersion, latestDocumentLabel: a.documentLabel });
    }
  }
  return out;
}
