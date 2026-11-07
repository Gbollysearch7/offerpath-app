// Synthetic fixtures for the two product failures reproduced in the November 2026 audit (OP-001).
//
// Everything here is invented: "Alex Example" is not a real person and "Example Ltd" is not a real
// employer. No student CV, advert or personal data is committed.
//
// These fixtures are deliberately boring. The point is not that they are realistic, it is that the
// misspelled CV differs from the clean one by exactly three substitutions, so anything the engine
// reports differently between the two is caused by those substitutions alone.

/** The clean CV. Scores well; nothing is wrong with its spelling. */
export const AUDIT_CLEAN_CV = [
  "Alex Example",
  "alex@example.com 07700 900123 linkedin.com/in/alex",
  "EDUCATION",
  "Example University 2023 - 2026",
  "BSc Computing",
  "EXPERIENCE",
  "Analyst | Example Ltd | 2025 - Present",
  "• Managed customer relationships and improved team reporting accuracy by 20%.",
  "• Developed financial reports and presented recommendations to 12 colleagues.",
  "SKILLS",
  "Excel SQL Python Communication",
].join("\n");

/** The substitutions that turn the clean CV into the misspelled one, as `[correct, misspelled]`. */
export const AUDIT_SUBSTITUTIONS: readonly (readonly [string, string])[] = [
  ["customer relationships", "custmer relatonships"],
  ["financial", "finanical"],
  ["recommendations", "recomendations"],
];

/** The four misspelled words a proofreading check must catch. Permanent regression cases for OP-007. */
export const AUDIT_MISSPELLED_WORDS = ["custmer", "relatonships", "finanical", "recomendations"] as const;

/** Correctly spelled words that must not be flagged when the misspellings are caught (OP-007 negative cases). */
export const AUDIT_CORRECT_WORDS = ["customer", "relationships", "financial", "recommendations", "colleagues", "reporting"] as const;

/** Applies `AUDIT_SUBSTITUTIONS` to any text, so the variant is derived rather than hand-copied. */
export function misspell(text: string): string {
  return AUDIT_SUBSTITUTIONS.reduce((out, [from, to]) => out.replace(from, to), text);
}

/** The clean CV with four misspellings introduced. Spelling and grammar still scored 10/10 in the audit. */
export const AUDIT_MISSPELLED_CV = misspell(AUDIT_CLEAN_CV);

/** Target sector for both CVs. The core score must not depend on it. */
export const AUDIT_SECTOR = "Technology";

/**
 * The advert from the audit. Kubernetes and Terraform are stated as mandatory; Excel is explicitly
 * desirable and happens to be mentioned twice.
 */
export const AUDIT_ADVERT = "Must have Kubernetes and Terraform. Desirable: Excel. Excel is used for occasional reporting.";

/** What a correct reading of `AUDIT_ADVERT` must produce. */
export const AUDIT_ADVERT_ESSENTIAL = ["Kubernetes", "Terraform"] as const;
export const AUDIT_ADVERT_DESIRABLE = ["Excel"] as const;

/**
 * The CV-side evidence the audit used against that advert: Excel and nothing else. Keeping it to the
 * one term makes the two essential gaps unambiguous.
 */
export const AUDIT_CV_EVIDENCE = "Excel";
