import { createHash } from "node:crypto";
import { scoreCoverage, type CoverageStatus } from "@/lib/analysis/coverage";
import { seriesFields } from "@/lib/analysis/scoring-contract";
import type { AreaKey, CheckKey, CvReviewPayload } from "@/lib/types";
import type { ShareScope } from "./types";

// The one place that decides what leaves the account. It builds a new object field by field from an allowlist: a field
// added to the payload later is not shared until someone adds it here. This reads scores and never changes one.

export interface SharedView {
  scope: ShareScope;
  /** The day only. */
  reviewedOn: string;
  coverage: CoverageStatus;
  /** Null when the score is withheld: too little was assessed for a total to mean anything, as on the student's own report. */
  score: number | null;
  assessedPercent: number;
  areas: { key: AreaKey; score: number }[];
  steps: { check: CheckKey; text: string }[];
  wells: { check: CheckKey; text: string }[];
}

export const SCOPE_INFO: Record<ShareScope, { label: string; includes: string[] }> = {
  score: { label: "Score only", includes: ["Your Readiness Score and its band", "The date of the review", "Whether the score is complete"] },
  areas: { label: "Score and area scores", includes: ["Everything in \"Score only\"", "A score for each area of the review"] },
  advice: { label: "Score, area scores and general advice", includes: ["Everything in \"Score and area scores\"", "Up to three steps to improve, and up to three strengths, in general terms"] },
};

/** True for every scope. Tests hold the shared page to this list. */
export const NEVER_SHARED = ["Your CV text, or any line from it", "Your name, email address or phone number", "Your file name", "Your target sector, stage or university", "Your original file, other reviews or score history", "Adviser notes"];

export function projectReport(payload: CvReviewPayload, createdAt: string, scope: ShareScope): SharedView {
  const a = payload.analysis;
  const coverage = scoreCoverage(seriesFields(payload));
  const withheld = coverage.status === "withheld";
  const wide = scope !== "score" && !withheld;
  const advice = scope === "advice";
  // Sector fit isn't part of the score, and its advice is about the sector the student is aiming for.
  const inScore = <T extends { check: CheckKey }>(xs: T[]) => xs.filter((x) => x.check !== "sector").map((x) => ({ check: x.check, text: (x as T & { text: string }).text }));
  return {
    scope,
    reviewedOn: createdAt.slice(0, 10),
    coverage: coverage.status,
    score: withheld ? null : a.score,
    assessedPercent: Math.round(coverage.assessedShare * 100),
    areas: wide ? a.areas.filter((x) => x.key !== "sector").map((x) => ({ key: x.key, score: x.score })) : [],
    steps: advice ? inScore(a.steps) : [],
    wells: advice ? inScore(a.wells) : [],
  };
}

/**
 * Fingerprint of what a link shows and of the text behind it. It is stored at activation and compared on every request,
 * so a recipient sees exactly what the student previewed or nothing at all. It is never sent to a recipient.
 */
export function viewDigest(view: SharedView, payload: Pick<CvReviewPayload, "text">): string {
  const document = createHash("sha256").update(payload.text).digest("hex");
  return createHash("sha256").update(JSON.stringify({ version: 1, view, document })).digest("hex");
}
