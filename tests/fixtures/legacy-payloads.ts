// Synthetic reports in the shape saved before 5 November 2026 (v0): no `payloadVersion`, no
// `assessment`, and the check wording of the time. The adapter in `src/lib/report-schema.ts` has to
// read these without touching a number and without inventing what they never recorded.
import { analyseCv, findCheck } from "@/lib/analysis/cv";
import { highlightJob, jobKeywords, matchScores } from "@/lib/analysis/job";
import { DEMO_CVS, SAMPLE_OPPORTUNITIES } from "@/lib/seed-data";
import { letterAssessment } from "@/lib/analysis/findings";
import { reviewLetter } from "@/lib/analysis/letter";
import { PAYLOAD_VERSION, type CoverLetterPayload, type CvReviewPayload, type TailorPayload } from "@/lib/types";
import { AUDIT_MISSPELLED_CV, AUDIT_SECTOR } from "./audit";

/** Strips the fields v0 did not have. */
export function v0<P extends { payloadVersion: unknown; assessment?: unknown }>(p: P): Omit<P, "payloadVersion" | "assessment"> {
  const copy: Partial<P> = { ...p };
  delete copy.payloadVersion;
  delete copy.assessment;
  return copy as Omit<P, "payloadVersion" | "assessment">;
}

/**
 * The misspelled audit CV as a report saved under the pre-OP-002 wording: "Spelling / UK spelling
 * throughout / No US spellings found." The scores are what the engine gave; the words are the old ones.
 */
export const LEGACY_CV_OLD_WORDING: Omit<CvReviewPayload, "payloadVersion" | "assessment"> = (() => {
  const analysis = analyseCv(AUDIT_MISSPELLED_CV, AUDIT_SECTOR);
  delete analysis.meta.scoring; // Recorded since OP-010.
  const spell = findCheck(analysis, "spell")!;
  Object.assign(spell, { name: "Spelling", summary: "UK spelling throughout", detail: "No US spellings found.", stat: { value: "0", label: "US spellings" } });
  const grammar = findCheck(analysis, "grammar")!;
  Object.assign(grammar, { name: "Grammar", summary: "No issues", detail: "No grammar issues found." });
  return { fileName: "old_cv.pdf", sector: AUDIT_SECTOR, stage: "Final year, graduate roles", text: AUDIT_MISSPELLED_CV, storagePath: null, analysis };
})();

/**
 * A no-bullet CV saved before the 26 October fix, when line-based checks defaulted to 10/10 with nothing to
 * assess. Totals are left exactly as such a row would hold them: the adapter must never recompute them.
 */
export const LEGACY_CV_NO_BULLETS_ALL_TENS: Omit<CvReviewPayload, "payloadVersion" | "assessment"> = (() => {
  const text = "Alex Example\nalex@example.com\nEXPERIENCE\nAnalyst at Example Ltd\nEDUCATION\nBSc Computing\nSKILLS\nExcel";
  const analysis = analyseCv(text, AUDIT_SECTOR);
  delete analysis.meta.scoring; // Recorded since OP-010.
  for (const key of ["accomp", "repeat", "filler", "buzz", "passive", "grammar", "bulletlen"] as const) {
    Object.assign(findCheck(analysis, key)!, { score: 10, summary: "No issues", detail: "No issues found." });
  }
  // Very early rows did not record how the bullets were judged.
  delete analysis.meta.method;
  delete analysis.meta.judge;
  delete analysis.meta.judgments;
  return { fileName: "older_cv.pdf", sector: AUDIT_SECTOR, stage: "Final year, graduate roles", text, storagePath: null, analysis };
})();

const northbank = SAMPLE_OPPORTUNITIES[0];

/** The fields a letter report had when `reviewLetter` made it: no `review`, no versions. Not from a builder, which now writes the current method. */
export function oldLetterFields(letterText: string, jobText: string, cvText = ""): Omit<CoverLetterPayload, "payloadVersion" | "assessment"> & { score: number } {
  const r = reviewLetter(letterText, jobText, northbank.org, cvText);
  return {
    score: r.score,
    mode: "review",
    jobTitle: northbank.role,
    employer: northbank.org,
    jobText,
    tailorReportId: null,
    cvReportId: null,
    cvFileName: null,
    addressee: null,
    notes: null,
    letterText,
    paragraphs: letterText.split(/\n\s*\n/).map((t) => ({ text: t.trim(), src: [] })).filter((p) => p.text),
    checks: r.checks,
    keywordsUsed: r.keywordsUsed,
    keywordsMissing: r.keywordsMissing,
    words: r.words,
    paras: r.paras,
    summary: r.summary,
    saved: true,
    aiAssisted: false,
  };
}

/** A report saved under the current payload version, before versioned letter scoring. */
export function oldLetterPayload(letterText: string, jobText: string, cvText = ""): { payload: CoverLetterPayload; score: number } {
  const { score, ...fields } = oldLetterFields(letterText, jobText, cvText);
  return { score, payload: { payloadVersion: PAYLOAD_VERSION, ...fields, assessment: letterAssessment(fields) } };
}

export function legacyLetter(jobText: string): Omit<CoverLetterPayload, "payloadVersion" | "assessment"> {
  const letter = "Dear Hiring Manager,\n\nI am applying for the role. " + "I built a tracker in Excel that cut reporting time by 20% for a team of six. ".repeat(6) + "\n\nYours sincerely,\nAlex Example";
  const fields: Partial<ReturnType<typeof oldLetterFields>> = oldLetterFields(letter, jobText);
  delete fields.score;
  return fields as Omit<CoverLetterPayload, "payloadVersion" | "assessment">;
}

// Built from the keyword match such reports were saved with, not from `buildTailorPayload`, which now writes the current version.
export const LEGACY_TAILOR: Omit<TailorPayload, "payloadVersion" | "assessment"> = (() => {
  const keywords = jobKeywords(northbank.description, DEMO_CVS[3].text);
  const m = matchScores(keywords);
  return {
    cvReportId: "11111111-1111-4111-8111-111111111111",
    cvFileName: DEMO_CVS[3].fileName,
    jobTitle: northbank.role,
    employer: northbank.org,
    jobUrl: null,
    jobText: northbank.description,
    deadline: northbank.closesOn,
    keywords,
    matchNow: m.now,
    matchTailored: m.tailored,
    jd: highlightJob(northbank.description, keywords),
    added: [],
    tailored: null,
  };
})();
