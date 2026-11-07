import type { Assessment, ConfirmedFact, ProofreadingReport } from "@/lib/types";

// OP-018: the saved shape of a LinkedIn profile review. Everything here is what the student pasted or exported, what
// the rules said about it, and what the student decided. Nothing here came from LinkedIn itself: Offerpath doesn't open
// profiles, and saving a version here changes nothing on LinkedIn.

export const LINKEDIN_SECTIONS = ["headline", "about", "experience", "education", "skills", "other"] as const;
export type LinkedinSectionKey = (typeof LINKEDIN_SECTIONS)[number];

export const LINKEDIN_SECTION_LABEL: Record<LinkedinSectionKey, string> = {
  headline: "Headline",
  about: "About",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  other: "Other details",
};

/** One saved state of a section. Append-only: undo moves `current` back and never rewrites a version. */
export interface LinkedinVersion {
  id: string;
  n: number;
  at: string;
  action: "start" | "typed" | "accepted";
  label: string;
  text: string;
  /** sha256 of `text`. */
  documentVersion: string;
  /** The suggestions this text has taken in, so undoing a version puts them back on offer. */
  accepted: string[];
  /** Check keys the student ticked to save this version. */
  confirmed: string[];
  /** What the student said was true, carried by this version; undoing the version withdraws it. */
  facts: ConfirmedFact[];
}

export interface LinkedinSuggestion {
  id: string;
  /** The line or sentence it replaces; null when it replaces the whole section. */
  before: string | null;
  /** The replacement. Empty only when the suggestion is to remove `before`. */
  after: string;
  why: string;
  method: "rules" | "ai";
  /** The text it was made for. A whole-section suggestion is only on offer against exactly this text. */
  basedOn: string;
  at: string;
}

/** Feedback for one exact text. Kept by its hash, so what's shown can always say which words it describes. */
export interface LinkedinSectionAssessment {
  at: string;
  assessment: Assessment;
  /** Null for an empty section: there were no words to check. */
  proofreading: ProofreadingReport | null;
}

/** Same meaning as OP-008's proofreading choices, for one section's text. */
export interface LinkedinChoice {
  documentVersion: string;
  kind: "dismiss" | "reopen";
  findingId: string;
  quote: string;
  actor: "student";
  at: string;
}

export interface LinkedinSection {
  key: LinkedinSectionKey;
  versions: LinkedinVersion[];
  current: string;
  undoStack: string[];
  suggestions: LinkedinSuggestion[];
  rejected: { suggestionId: string; at: string }[];
  /** Why suggestions were not offered, never their text. */
  withheld: string[];
  assessments: LinkedinSectionAssessment[];
  choices: LinkedinChoice[];
}

export interface LinkedinSource {
  method: "paste" | "export";
  /** Names of the export files read. Their contents beyond the allow-listed columns are never kept. */
  files: string[];
  /** Files in an export that were recognised as not used, by kind only. */
  skippedFiles: number;
  /** Sections holding nothing but a link: we didn't open it and it isn't kept. */
  linksIgnored: LinkedinSectionKey[];
}

export interface LinkedinPayload {
  payloadVersion: 1;
  source: LinkedinSource;
  /** The student's own stated direction. Never evidence that they hold a role. */
  aim: string | null;
  /** The CV compared with, if the student chose one. The text is read from that report and isn't copied here. */
  cv: { reportId: string; fileName: string; documentVersion: string } | null;
  sections: LinkedinSection[];
  aiAssisted: boolean;
  editRevision?: number;
  attempts?: string[];
}
