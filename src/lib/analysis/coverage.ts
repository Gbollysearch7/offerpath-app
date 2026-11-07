import type { CheckKey } from "@/lib/types";
import { CHECK_META, CHECK_ORDER } from "./cv";
import { NEEDS_BULLETS } from "./findings";
import { AREA_WEIGHTS } from "./rubric";
import { comparableScores, scoreSeries, type SeriesFields } from "./scoring-contract";

// What a composite score does when part of it was not assessed. This never changes the number: it decides whether
// the number is shown, whether it is marked, and whether it may be compared. Scores are never rescaled to the part
// that was assessed, because that would make a tiny assessment look like a comprehensive one.
//
//   complete    every weighted check was assessed on a reading we had no serious doubt about.
//   incomplete  some of it was not assessed, or a low-confidence reading was scored. The number is shown and marked.
//   withheld    under WITHHOLD_BELOW of the weight was assessed. The number stays stored and is not presented as a score.
//
// Neither of the last two is ever compared with another score. A failed provider is not a coverage state: when the
// judge fails, scoring fails and no report exists (scoring-core.ts), so nothing unassessed can reach a total that way.
// Sector fit has no weight and spelling is the narrow check its label says, so full proofreading (OP-007) has to report
// its own availability beside the score. If it ever carries weight, that is a RUBRIC_VERSION bump and an entry here.

export const COVERAGE_POLICY_VERSION = "coverage-2026-11-06.1";
export const WITHHOLD_BELOW = 0.6;

export type CoverageStatus = "complete" | "incomplete" | "withheld";

export interface ScoreCoverage {
  policy: string;
  status: CoverageStatus;
  /** Share of the score's weight that was assessed, 0 to 1. */
  assessedShare: number;
  notAssessed: CheckKey[];
  readingLimited: boolean;
}

/** A check's share of the composite: its area's weight, split equally between the area's checks. */
function checkShare(key: CheckKey): number {
  const area = CHECK_META[key].area;
  return AREA_WEIGHTS[area] / CHECK_ORDER.filter((k) => CHECK_META[k].area === area).length;
}

export function scoreCoverage(facts: Pick<SeriesFields, "bullets" | "band">): ScoreCoverage {
  const notAssessed = facts.bullets === 0 ? CHECK_ORDER.filter((k) => NEEDS_BULLETS.has(k)) : [];
  const assessedShare = Math.round((1 - notAssessed.reduce((s, k) => s + checkShare(k), 0)) * 1000) / 1000;
  const readingLimited = facts.band === "low";
  const status: CoverageStatus = assessedShare < WITHHOLD_BELOW ? "withheld" : notAssessed.length || readingLimited ? "incomplete" : "complete";
  return { policy: COVERAGE_POLICY_VERSION, status, assessedShare, notAssessed, readingLimited };
}

/** What a row in a list needs to know about its score, from the same fields whichever repository read them. */
export const scoreContext = (f: SeriesFields) => ({ series: scoreSeries(f), coverage: scoreCoverage(f).status });

/**
 * The reviews a report's score may be charted and compared against: saved scores up to and including it, in the same
 * series, oldest first. `setAside` counts earlier reviews left out because the two scores don't compare.
 */
export function comparableHistory<R extends { id: string; score: number | null; createdAt: string; scoring?: { series: string | null } }>(rows: R[], id: string, series: string | null): { rows: R[]; setAside: number } {
  const ordered = rows.filter((r) => r.score != null).sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  const upTo = ordered.slice(0, ordered.findIndex((r) => r.id === id) + 1 || ordered.length);
  const kept = upTo.filter((r) => r.id === id || comparableScores(r.scoring?.series, series));
  return { rows: kept, setAside: upTo.length - kept.length };
}

/** A saved score with its coverage applied, for lists: null when it is not to be presented as a score. */
export const presentedScore = (r: { score: number | null; scoring?: { coverage: CoverageStatus } }): number | null => (r.scoring?.coverage === "withheld" ? null : r.score);
