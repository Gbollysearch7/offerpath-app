import type { Period } from "@/lib/periods";
import { hiddenGroups, publishAverage, publishCount, publishEvents, publishPart, PUBLICATION_RULES } from "./rules";
import type { BreakdownRow, PublishedAnalytics } from "./types";

// Demo mode's figures for a fictional university. They start as exact made-up events and go through the same rules as real
// data, so the page shows what hiding and rounding look like. Marked sample: true everywhere they appear.

interface Raw {
  n: number;
  completed: number;
  versions: number;
  edits: number;
  repeat: number;
  reviewed: number;
  referred: number;
  accepted: number;
  tracked: number;
  interview: number;
  offer: number;
  duplicates: number;
  incomplete: number;
  failed: number;
  scored: number;
  avg: number;
}

const groupOf = (n: number, avg: number): Raw => {
  const completed = Math.round(n * 0.82);
  return {
    n,
    completed,
    versions: Math.round(completed * 1.9),
    edits: Math.round(n * 0.47),
    repeat: Math.round(completed * 0.44),
    reviewed: Math.round(n * 0.86),
    referred: Math.round(n * 0.11),
    accepted: Math.round(n * 0.07),
    tracked: Math.round(n * 0.58),
    interview: Math.round(n * 0.17),
    offer: Math.round(n * 0.06),
    duplicates: Math.round(n * 0.21),
    incomplete: Math.round(n * 0.04),
    failed: Math.round(n * 0.02),
    scored: Math.round(completed * 0.93),
    avg,
  };
};

const SAMPLE_GROUPS: Record<string, [string, number, number][]> = {
  Faculty: [["Business", 312, 73], ["Engineering", 268, 69], ["Sciences", 244, 71], ["Social sciences", 251, 68], ["Arts and humanities", 158, 66], ["Theology", 3, 70], ["Not set", 4, 62]],
  "Year of study": [["Year 1", 298, 66], ["Year 2", 352, 69], ["Year 3", 468, 72], ["Postgraduate", 120, 74], ["Year 4", 2, 70]],
  "Fee status": [["Home", 868, 71], ["International", 372, 69]],
};

const PERIOD_SHARE = (key: string) => (key.startsWith("autumn") ? 0.55 : key.startsWith("spring") ? 0.3 : key.startsWith("summer") ? 0.15 : key === "all" ? 1 : 0.8);

const scale = (r: Raw, share: number): Raw => {
  const out = { ...r };
  for (const k of Object.keys(r) as (keyof Raw)[]) if (k !== "avg") out[k] = Math.round(r[k] * share);
  return out;
};

const add = (rows: Raw[]): Raw => {
  const sum = (k: keyof Raw) => rows.reduce((t, r) => t + r[k], 0);
  const scored = sum("scored");
  return {
    n: sum("n"), completed: sum("completed"), versions: sum("versions"), edits: sum("edits"), repeat: sum("repeat"), reviewed: sum("reviewed"), referred: sum("referred"), accepted: sum("accepted"),
    tracked: sum("tracked"), interview: sum("interview"), offer: sum("offer"), duplicates: sum("duplicates"), incomplete: sum("incomplete"), failed: sum("failed"), scored,
    avg: rows.reduce((t, r) => t + r.avg * r.scored, 0) / Math.max(scored, 1),
  };
};

const row = (dimension: string, group: string, r: Raw): BreakdownRow => ({
  dimension,
  group,
  hidden: false,
  students: publishCount(r.n),
  completed: publishPart(r.completed, r.n),
  usefulEdits: publishPart(r.edits, r.n),
  repeatUse: publishPart(r.repeat, r.reviewed),
  reviewed: publishCount(r.reviewed),
  referred: publishPart(r.referred, r.n),
  tracked: publishPart(r.tracked, r.n),
  interview: publishPart(r.interview, r.n),
  offer: publishPart(r.offer, r.n),
  average: publishAverage(r.avg, r.scored),
});

export function sampleAnalytics(universityName: string, period: Pick<Period, "key" | "from" | "to">, now = new Date()): PublishedAnalytics {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const through = period.to && new Date(period.to).getTime() < today.getTime() ? new Date(period.to) : today;
  const share = PERIOD_SHARE(period.key);
  const breakdowns: BreakdownRow[] = [];
  let all: Raw | null = null;
  for (const [dimension, groups] of Object.entries(SAMPLE_GROUPS)) {
    const raws = groups.map(([name, n, avg]) => [name, scale(groupOf(n, avg), share)] as const);
    all ??= add(raws.map(([, r]) => r));
    const hidden = hiddenGroups(Object.fromEntries(raws.map(([name, r]) => [name, r.n])));
    breakdowns.push(...raws.filter(([name]) => !hidden.includes(name)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, r]) => row(dimension, name, r)));
    if (hidden.length) breakdowns.push({ dimension, group: null, hidden: true });
  }
  const t = all!;
  breakdowns.unshift(row("All students", "All", t));
  const invited = 2412;
  const accounts = 1604;
  const comparable = Math.round(t.repeat * 1.1);
  const flagged: Record<string, number> = { "No CV yet": 34, "Not improving": 22, "Deadline soon": 18, Inactive: 12 };
  return {
    universityName,
    sample: true,
    rules: PUBLICATION_RULES,
    period: { key: period.key, from: period.from ? new Date(period.from).toISOString() : null, to: period.to ? new Date(period.to).toISOString() : null, through: through.toISOString() },
    withheld: false,
    invited: publishCount(invited),
    accounts: publishCount(accounts),
    sharing: publishPart(1240, accounts),
    metrics: {
      students: publishCount(t.n),
      activated: publishPart(Math.round(1480 * share), invited),
      completed: publishPart(t.completed, t.n),
      versions: publishEvents(t.versions, t.completed),
      usefulEdits: publishPart(t.edits, t.n),
      repeatUse: publishPart(t.repeat, t.reviewed),
      reviewed: publishCount(t.reviewed),
      referred: publishPart(t.referred, t.n),
      referralsAccepted: publishPart(t.accepted, t.referred),
      tracked: publishPart(t.tracked, t.n),
      interview: publishPart(t.interview, t.n),
      offer: publishPart(t.offer, t.n),
    },
    excluded: {
      duplicates: publishEvents(t.duplicates, t.duplicates),
      incomplete: publishEvents(t.incomplete, t.incomplete),
      failed: publishEvents(t.failed, t.failed),
      noRecord: publishCount(Math.round(61 * share)),
    },
    scores: {
      versionSet: "sample|rubric-sample|parser-sample|lexicon-sample|normaliser-sample|-|-",
      students: publishCount(t.scored),
      setAside: publishEvents(Math.round(44 * share), Math.round(44 * share)),
      average: publishAverage(t.avg, t.scored),
      comparable: publishCount(comparable),
      improved10: publishPart(Math.round(comparable * 0.38), comparable),
      bands: {
        low: publishPart(Math.round(t.scored * 0.14), t.scored),
        mid: publishPart(Math.round(t.scored * 0.41), t.scored),
        high: publishPart(Math.round(t.scored * 0.33), t.scored),
        top: publishPart(Math.round(t.scored * 0.12), t.scored),
      },
    },
    breakdowns,
    needs: { total: publishPart(86, 1240), rows: Object.entries(flagged).filter(([f]) => !hiddenGroups(flagged).includes(f)).map(([flag, n]) => ({ flag, count: publishCount(n) })) },
  };
}
