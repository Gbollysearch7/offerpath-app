import { BAND_LABELS } from "@/lib/analysis/labels";
import { dateRangeLabel, HIDDEN, publishedFigures, scoreFigures, STATEMENTS } from "./definitions";
import type { Figure, PublishedAnalytics } from "./types";

const cell = (v: Figure) => (v === null ? HIDDEN : v);

/** The whole file comes from what was published, so it can hold nothing the screen doesn't, and says the same about it. */
export function analyticsCsvRows(a: PublishedAnalytics, opts: { title: string; periodLabel: string; generated: string; note?: string }): unknown[][] {
  const head: unknown[][] = [
    ...(a.sample ? [[`SAMPLE DATA. ${STATEMENTS.sample}`]] : []),
    [opts.title],
    ["University", a.universityName],
    ["Period", opts.periodLabel],
    ["Date range", dateRangeLabel(a.period)],
    ["Generated", opts.generated],
    ["Publication rules", a.rules],
    ...(opts.note ? [["Use", opts.note]] : []),
    ["Who this covers", STATEMENTS.population],
    ["What this is not", STATEMENTS.employment],
    ["Causes", STATEMENTS.causal],
    ["Scores", STATEMENTS.versions],
    ["Privacy", STATEMENTS.privacy],
    ["Rounding", STATEMENTS.rounding],
    [],
  ];
  if (a.withheld) {
    head.push(["Withheld", STATEMENTS.withheld], []);
  }
  const figures: unknown[][] = [
    ["Measure", "Students (rounded)", "Out of (rounded)", "Percent of the rounded figures", "Denominator", "Definition", "Date range", "Exclusions"],
    ...publishedFigures(a).map((f) => [f.name, cell(f.value), cell(f.denominator), f.percent === null ? "" : f.percent, f.denominatorLabel, f.definition, f.dateRange, f.exclusions]),
    ...scoreFigures(a).map((f) => [f.name, cell(f.value), cell(f.denominator), f.percent === null ? "" : f.percent, f.denominatorLabel, f.definition, f.dateRange, f.exclusions]),
  ];
  const s = a.scores;
  const scores: unknown[][] = s
    ? [
        [],
        ["Scoring version set", s.versionSet ?? HIDDEN],
        ...(["low", "mid", "high", "top"] as const).map((b) => [`Latest score: ${BAND_LABELS[b]}`, cell(s.bands[b])]),
      ]
    : [];
  const breakdown: unknown[][] = a.breakdowns.length
    ? [
        [],
        ["Breakdown", "Group", "Students", "Completed reviews", "Useful edits", "Repeat use", "Reviewed by end of period", "Adviser referrals", "Tracking applications", "Reporting an interview", "Reporting an offer", "Average latest score, one version set"],
        ...a.breakdowns.map((r) =>
          r.hidden
            ? [r.dimension, "Other groups, combined and not named", HIDDEN, HIDDEN, HIDDEN, HIDDEN, HIDDEN, HIDDEN, HIDDEN, HIDDEN, HIDDEN, HIDDEN]
            : [r.dimension, r.group, cell(r.students), cell(r.completed), cell(r.usefulEdits), cell(r.repeatUse), cell(r.reviewed), cell(r.referred), cell(r.tracked), cell(r.interview), cell(r.offer), cell(r.average)],
        ),
      ]
    : [];
  return [...head, ...figures, ...scores, ...breakdown];
}
