import { percentOf, ROUND_TO, MIN_FOR_RATE, MIN_GROUP } from "./rules";
import type { Figure, PublishedAnalytics } from "./types";

// OP-022: what each number means, stated once and used by the dashboard and by every file, so they can't say different things.

export const HIDDEN = "Hidden";

export const STATEMENTS = {
  sample: "Every figure here is made up, for a fictional university. It says nothing about any real student or service.",
  population:
    "Everything below the sharing figure counts only students who chose to share their progress. They may not represent all your students: people who choose to use a careers tool, or to share with a careers team, can differ from those who don't.",
  employment: "An improved score is not evidence of employment. Offerpath doesn't know who got a job. Interviews and offers here are only what students typed into their own tracker, and nobody has checked them.",
  causal: "None of this shows that Offerpath caused anything. Comparing students who chose to engage with those who didn't can't establish that.",
  versions: "Scores are compared only within one scoring version set. Scores made under other versions are set aside, not averaged in.",
  privacy: `To stop a person being identified, by subtracting one figure from another as well as directly: counts are rounded to the nearest ${ROUND_TO}. A group of fewer than ${MIN_GROUP} is hidden without its name, along with the next smallest if needed. A count within a group is hidden unless at least ${MIN_GROUP} students are on each side of it. Averages and percentages need ${MIN_FOR_RATE} students. Dates are fixed terms and years, and there are no filters.`,
  rounding: `Because of rounding, figures may not add up, and small changes in a number may not be real changes.`,
  withheld: "This period is hidden because subtracting it from a term or year around it would isolate fewer than five students. All time is available. It covers the same activity, and more of it.",
} as const;

export interface PublishedFigure {
  key: string;
  name: string;
  value: Figure;
  /** What the value is out of. Null: there is no denominator, or it is hidden; `denominatorLabel` says which. */
  denominator: Figure;
  denominatorLabel: string;
  percent: number | null;
  definition: string;
  dateRange: string;
  exclusions: string;
}

const utcDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** The range a figure really covers. `through` is exclusive, so the last day shown is the day before it. */
export function dateRangeLabel(period: PublishedAnalytics["period"]): string {
  const last = utcDay(new Date(new Date(period.through).getTime() - 86_400_000).toISOString());
  if (period.from && new Date(period.from).getTime() >= new Date(period.through).getTime()) return `This period hasn't started: ${utcDay(period.from)} onwards`;
  return `${period.from ? utcDay(period.from) : "The first record"} to ${last}, in UTC. Today isn't included`;
}

export const showFigure = (v: Figure) => (v === null ? HIDDEN : `About ${v.toLocaleString("en-GB")}`);
const inline = (v: Figure) => (v === null ? "hidden" : `about ${v.toLocaleString("en-GB")}`);

const TODAY = "Today, not the chosen period: a record doesn't say when it was first imported.";
const STUDENTS_OUT_OF = "Students sharing their progress who had an account by the end of the period";

/** The six measures the blueprint separates, and the self-reported tracker figures, as the screen and files show them. */
export function publishedFigures(a: PublishedAnalytics): PublishedFigure[] {
  const range = dateRangeLabel(a.period);
  const m = a.metrics;
  const x = a.excluded;
  const figure = (f: Omit<PublishedFigure, "percent" | "dateRange"> & { dateRange?: string }): PublishedFigure => ({ ...f, dateRange: f.dateRange ?? range, percent: percentOf(f.value, f.denominator) });
  const inPeriod = (v: Figure | undefined) => v ?? null;
  return [
    figure({
      key: "invited",
      name: "Invitations",
      value: a.invited,
      denominator: null,
      denominatorLabel: "None. This is where the count starts.",
      definition: "Student records your team has imported. Offerpath sends no invitations itself, so this counts who could have been invited, not who was contacted or who received anything.",
      dateRange: TODAY,
      exclusions: "Staff. Students who signed up without an imported record.",
    }),
    figure({
      key: "activated",
      name: "Activation",
      value: inPeriod(m?.activated),
      denominator: a.invited,
      denominatorLabel: "Imported student records, as they stand today",
      definition: "Students with an imported record who confirmed an account in this period. Includes students who don't share their progress, as a number only.",
      exclusions: `Unconfirmed sign-ups, staff and deleted accounts. Accounts with no matching record: ${inline(x?.noRecord ?? null)}.`,
    }),
    figure({
      key: "sharing",
      name: "Sharing their progress",
      value: a.sharing,
      denominator: a.accounts,
      denominatorLabel: "Confirmed student accounts, as they stand today",
      definition: "Confirmed student accounts that have chosen to share with your careers team. Every figure below counts only these students. Anyone who stops sharing leaves every figure, including past periods.",
      dateRange: "Today, not the chosen period: sharing is a choice as it stands now.",
      exclusions: "Unconfirmed sign-ups, staff and deleted accounts.",
    }),
    figure({
      key: "completed",
      name: "Completed reviews",
      value: inPeriod(m?.completed),
      denominator: inPeriod(m?.students),
      denominatorLabel: STUDENTS_OUT_OF,
      definition: `Students with at least one CV reviewed for the first time in this period, scored and fully assessed. That was ${inline(m?.versions ?? null)} different CV versions.`,
      exclusions: `Resubmissions of text already reviewed, even as a different file: ${inline(x?.duplicates ?? null)}. No score, no bullets to judge or a low-confidence reading: ${inline(x?.incomplete ?? null)}. Failed analyses, which save no result: ${inline(x?.failed ?? null)}. Failures are kept for a limited time, so older periods can undercount them. Cover letters, tailored CVs and LinkedIn aren't reviews here.`,
    }),
    figure({
      key: "usefulEdits",
      name: "Useful edits",
      value: inPeriod(m?.usefulEdits),
      denominator: inPeriod(m?.students),
      denominatorLabel: STUDENTS_OUT_OF,
      definition: "Students who, in this period, made an edit they still keep: a CV line saved, a correction to how their CV was read, a change kept in a tailored CV or letter, or a new version of a LinkedIn section. It shows a student acted on something, not that the edit was right or helped.",
      exclusions: "Suggestions rejected, undone or never acted on.",
    }),
    figure({
      key: "repeatUse",
      name: "Repeat use",
      value: inPeriod(m?.repeatUse),
      denominator: inPeriod(m?.reviewed),
      denominatorLabel: "Sharing students with a completed review by the end of the period",
      definition: "Students who had a further, different CV version reviewed in this period, after an earlier one.",
      exclusions: "Resubmitting the same text. A first review. Reviews that weren't completed.",
    }),
    figure({
      key: "referred",
      name: "Adviser referrals",
      value: inPeriod(m?.referred),
      denominator: inPeriod(m?.students),
      denominatorLabel: STUDENTS_OUT_OF,
      definition: "Students an adviser referred somewhere in this period, whatever the student decided.",
      exclusions: "Referrals staff withdrew. Students who have stopped sharing.",
    }),
    figure({
      key: "referralsAccepted",
      name: "Referrals accepted",
      value: inPeriod(m?.referralsAccepted),
      denominator: inPeriod(m?.referred),
      denominatorLabel: "Students with a referral in this period",
      definition: "Of those, students who have accepted a referral, as things stand today.",
      exclusions: "Declined, unanswered and withdrawn referrals. Students who have stopped sharing.",
    }),
    figure({
      key: "tracked",
      name: "Tracking applications",
      value: inPeriod(m?.tracked),
      denominator: inPeriod(m?.students),
      denominatorLabel: STUDENTS_OUT_OF,
      definition: "Students who added at least one role to their own tracker in this period, including roles they only saved. Self-reported.",
      exclusions: "Roles added in other periods.",
    }),
    figure({
      key: "interview",
      name: "Reporting an interview",
      value: inPeriod(m?.interview),
      denominator: inPeriod(m?.students),
      denominatorLabel: STUDENTS_OUT_OF,
      definition: "Students who marked a role added in this period as interview or offer. Self-reported and unchecked. Not an employment outcome.",
      exclusions: "Anything a student didn't record, which is most things. Students who don't track applications count as not reporting one.",
    }),
    figure({
      key: "offer",
      name: "Reporting an offer",
      value: inPeriod(m?.offer),
      denominator: inPeriod(m?.students),
      denominatorLabel: STUDENTS_OUT_OF,
      definition: "Students who marked a role added in this period as offer. Self-reported and unchecked. Not an employment outcome, and not evidence of Offerpath's effect.",
      exclusions: "Anything a student didn't record, which is most things. Students who don't track applications count as not reporting one.",
    }),
  ];
}

export function scoreFigures(a: PublishedAnalytics): PublishedFigure[] {
  const s = a.scores;
  const range = dateRangeLabel(a.period);
  const set = "Reports under other scoring versions, reports in no version set, and incomplete assessments.";
  return [
    {
      key: "average",
      name: "Average latest score",
      value: s?.average ?? null,
      denominator: s?.students ?? null,
      denominatorLabel: "Sharing students with a completed review in this version set, in this period",
      percent: null,
      definition: "The mean of each student's latest score in this version set. A review score, not a measure of how employable anyone is.",
      dateRange: range,
      exclusions: `${set} Students set aside because their reviews were under other versions: ${inline(s?.setAside ?? null)}.`,
    },
    {
      key: "improved10",
      name: "Improved by 10 or more",
      value: s?.improved10 ?? null,
      denominator: s?.comparable ?? null,
      denominatorLabel: "Those students with two or more different CV versions in this version set",
      percent: percentOf(s?.improved10 ?? null, s?.comparable ?? null),
      definition: "Students whose latest score is at least 10 above their first, on different text, in this version set. An improved score is not evidence of employment.",
      dateRange: range,
      exclusions: `${set} Resubmissions of the same text.`,
    },
  ];
}
