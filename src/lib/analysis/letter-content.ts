// The cover-letter wording and numbers the report views show. Type imports only, so client components can use it.
// Weights and length bands are product judgments: no adviser has reviewed them and nothing has calibrated them.
import type { LetterAreaKey } from "@/lib/types";

export const LETTER_REVIEW_VERSION = "letter-review-2026-11-07.1";

export const AREA_WEIGHTS: Record<LetterAreaKey, number> = {
  employer_motivation: 20,
  role_motivation: 10,
  hard_skills: 20,
  soft_skills: 10,
  examples: 20,
  cv_consistency: 10,
  structure: 3,
  length: 2,
  clarity: 2,
  mechanics: 3,
};

export const AREA_LABELS: Record<LetterAreaKey, string> = {
  employer_motivation: "Why this employer",
  role_motivation: "Why this role",
  hard_skills: "Technical and subject skills",
  soft_skills: "Interpersonal skills",
  examples: "Relevant examples",
  cv_consistency: "Consistent with your CV",
  structure: "Structure",
  length: "Length for this application",
  clarity: "Clarity",
  mechanics: "Greeting, sign-off and details",
};

/** Below this share of the weight assessed, a number would describe too little of the letter. */
export const MIN_ASSESSED_WEIGHT = 50;

/** The most a letter can show while it has a claim its CV doesn't back, a gap, the wrong name or no specific reason: one below the "Strong" band. */
export const SCORE_CAP = 74;

export const LEGACY_LETTER_NOTE =
  "Limited evidence: this report was made with an earlier version of letter checks. It looked for set phrases and a fixed length, and it didn't compare the letter with your CV. Its score is kept as it was saved and can't be compared with newer letter scores.";

export const SCORE_MEANING = "This describes what we could check in the wording, using rules that no adviser has validated yet. It isn't a prediction of how an employer will respond.";

export const GUIDANCE_NOTE = "Greeting, sign-off and length guidance is general UK practice. Conventions vary between employers, and a careers adviser hasn't reviewed this wording yet.";
