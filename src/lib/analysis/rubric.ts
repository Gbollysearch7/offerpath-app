// Every number that decides a score lives here, so the rubric can be tuned in one place
// (for example after calibrating against careers advisers' marks with `npm run calibrate`).
//
// IMPORTANT: change RUBRIC_VERSION whenever you change anything in this file. Reports already saved keep
// their scores; new uploads get fresh judgments under the new version instead of mixing old and new.

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

/** Score bands shown to students. */
export const BANDS = [
  { min: 90, label: "Interview-ready" },
  { min: 75, label: "Strong" },
  { min: 50, label: "Getting there" },
  { min: 0, label: "Needs work" },
] as const;
