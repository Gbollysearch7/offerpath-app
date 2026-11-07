// What a careers admin receives: rounded, hidden where the rules say so, and never a student. Null always means hidden.

export type Figure = number | null;

export interface AnalyticsPeriod {
  key: string;
  from: string | null;
  to: string | null;
  /** Figures run up to, but not including, this moment: the start of today, or the end of the period if earlier. */
  through: string;
}

export interface AnalyticsMetrics {
  students: Figure;
  activated: Figure;
  completed: Figure;
  versions: Figure;
  usefulEdits: Figure;
  repeatUse: Figure;
  reviewed: Figure;
  referred: Figure;
  referralsAccepted: Figure;
  tracked: Figure;
  interview: Figure;
  offer: Figure;
}

export interface AnalyticsScores {
  /** The one scoring version set these figures come from. Null when too few students are in any set. */
  versionSet: string | null;
  students: Figure;
  /** Students with reviews only under other versions, left out rather than compared. */
  setAside: Figure;
  average: Figure;
  comparable: Figure;
  improved10: Figure;
  bands: { low: Figure; mid: Figure; high: Figure; top: Figure };
}

export type BreakdownRow =
  | { dimension: string; group: null; hidden: true }
  | {
      dimension: string;
      group: string;
      hidden: false;
      students: Figure;
      completed: Figure;
      usefulEdits: Figure;
      repeatUse: Figure;
      reviewed: Figure;
      referred: Figure;
      tracked: Figure;
      interview: Figure;
      offer: Figure;
      average: Figure;
    };

export interface PublishedAnalytics {
  universityName: string;
  sample: boolean;
  rules: string;
  period: AnalyticsPeriod;
  /** Subtracting this period from one around it would isolate a few students, so only all time is available. */
  withheld: boolean;
  invited: Figure;
  accounts: Figure;
  sharing: Figure;
  metrics: AnalyticsMetrics | null;
  excluded: { duplicates: Figure; incomplete: Figure; failed: Figure; noRecord: Figure } | null;
  scores: AnalyticsScores | null;
  breakdowns: BreakdownRow[];
  needs: { total: Figure; rows: { flag: string; count: Figure }[] } | null;
}
