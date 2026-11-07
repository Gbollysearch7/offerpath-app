// Every number that decides a score lives here, so the rubric can be tuned in one place
// (for example after calibrating against careers advisers' marks with `npm run calibrate`).
//
// RUBRIC_VERSION names the scoring rules. Saved reports keep the scores they were given. The judgment
// cache keys (`coreKey` and `relevanceKey` in judgment.ts) and every report fingerprint
// (`meta.fingerprint` in cv.ts) include this string, so a new version means fresh judgments under the
// new rules rather than a mix of old and new.
//
// Change RUBRIC_VERSION when, and only when, something that decides a number or its meaning changes:
//   - any value in this file: AREA_WEIGHTS, LINE_PENALTIES, TARGETS or BAND_THRESHOLDS;
//   - the word lists in lexicon.ts that feed checks and judgments, or JUDGE_SYSTEM in ai.ts.
// Do not change it for wording. The words shown for a band, an area, a check or a finding status live in
// labels.ts (and the check copy in cv.ts and check-content.ts). They are looked up from the stored score
// or key when a report is rendered, exported or emailed; they are never saved as part of a score, never
// part of a fingerprint or cache key, and renaming one does not rerun a single judgment. Moving a band
// threshold is a rubric change, because a saved band would stop meaning what a new one means; renaming
// the band is not. Comments and type-only edits are not rubric changes either.
//
// The version has not changed since 30 October 2026. The 5 November 2026 label work (OP-003) moved the
// band words out of this file and did not bump it, because no number moved.
//
// RUBRIC_VERSION is one part of a scoring contract (OP-010; scoring-contract.ts). The parts, and when to bump each:
//   PARSER_VERSION (parse.ts)            bullets, sections or roles would be cut differently for any input;
//   NORMALISER_VERSION (fingerprint.ts)  normaliseText or bulletKey would return anything different for any input;
//   LEXICON_VERSION (lexicon.ts)         a word list changed;
//   JUDGE_PROMPT_VERSION (judgment.ts)   JUDGE_SYSTEM changed, and always with RUBRIC_VERSION, as the cache key holds
//                                        only the rubric and the model;
//   AI_JUDGE_MODEL (judgment.ts)         a different model judges. It is in the cache key, so no verdict carries over.
// Any bump starts a new scoring series: saved reports keep their numbers, and history stops comparing across it.
// tests/scoring-contract.test.ts freezes what each version covers and fails on a change made without its bump.
//
// Correcting a wrong cached verdict. judgment_cache rows are immutable, and a row is never edited or deleted to fix a
// verdict. Bump RUBRIC_VERSION and say why in this file. Every key changes, so every bullet is judged afresh on next
// use (at normal judging cost); old rows stay under their old keys, old reports keep their scores and fingerprints,
// and new reports start a new series, so the fix never reads as a student's improvement.

export const RUBRIC_VERSION = "rubric-2026-10-30.1";

/**
 * Share of the Readiness Score each area carries. Must add up to 1. The score measures the CV itself,
 * so sector fit carries no weight: it is shown next to the score, and changing the target sector
 * never changes the score.
 */
export const AREA_WEIGHTS = {
  impact: 0.3,
  clarity: 0.175,
  structure: 0.175,
  sector: 0,
  spelling: 0.115,
  length: 0.235,
} as const;

/** Points a single bullet loses from 10 (the line score shown in Line by line). */
export const LINE_PENALTIES = {
  noResult: 3,
  partialResult: 1.5,
  weakVerb: 3,
  duty: 2,
  passive: 2,
  filler: 1,
  badLength: 1,
  noVerb: 1,
} as const;

export const TARGETS = {
  /** Share of bullets that should show a measurable result for full marks. */
  quantifiedShare: 0.5,
  /** Bullet length outside this range (words) counts against Bullet length. */
  bulletWords: { min: 10, max: 30 },
  /** Whole-CV length (words) for full marks on Length: about one to two pages. */
  cvWords: { min: 300, max: 1000 },
  /** Number of bullets in core sections for full marks on Bullet count. */
  bulletCount: { min: 8, max: 24 },
  /** Sector keywords (of the top 12 for the sector) needed for full marks on the keyword half. */
  sectorKeywords: 8,
  /** Average relevance (high = 1, some = 0.5) needed for full marks on the relevance half. */
  relevanceAverage: 0.6,
} as const;

/**
 * Score thresholds for the four bands shown to students, highest first. The keys are stable identifiers
 * for code and tests; the words for each band are `BAND_LABELS` in labels.ts, so a label can change
 * without touching this file or the version.
 */
export const BAND_THRESHOLDS = [
  { min: 90, key: "top" },
  { min: 75, key: "high" },
  { min: 50, key: "mid" },
  { min: 0, key: "low" },
] as const;

export type BandKey = (typeof BAND_THRESHOLDS)[number]["key"];

/** The band a score out of 100 falls in. Arithmetic on the thresholds only; no wording. */
export function bandKey(score: number): BandKey {
  return BAND_THRESHOLDS.find((b) => score >= b.min)?.key ?? "low";
}
