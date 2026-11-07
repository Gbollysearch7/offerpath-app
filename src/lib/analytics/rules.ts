// OP-022: the publication rules, in TypeScript for demo mode and for reading a published file. The real ones are SQL functions
// in supabase/migrations/20261108090000_institutional_analytics.sql, because a careers admin can call the database directly.
// tests/fixtures/analytics-publication-cases.json holds the answers both must give.

export const PUBLICATION_RULES = "analytics-publication-1";
export const MIN_GROUP = 5;
export const ROUND_TO = 5;
/** An average or a percentage on fewer students than this is too close to being one person's figure. */
export const MIN_FOR_RATE = 25;

export const roundCount = (n: number) => Math.round(n / ROUND_TO) * ROUND_TO;

/** A number of students. Hidden under 5. */
export const publishCount = (n: number): number | null => (n >= MIN_GROUP ? roundCount(n) : null);

/** Students within a group: at least 5 on each side, or nothing. */
export const publishPart = (n: number, of: number): number | null => (n >= MIN_GROUP && of - n >= MIN_GROUP ? roundCount(n) : null);

/** Things rather than students. Five reports can be one person's, so it needs 5 students behind it. */
export const publishEvents = (events: number, students: number): number | null => (students >= MIN_GROUP ? roundCount(events) : null);

export const publishAverage = (avg: number | null, n: number): number | null => (avg !== null && n >= MIN_FOR_RATE ? Math.round(avg) : null);

/**
 * Which groups of one breakdown to hide. Under 5 is hidden. If what's hidden totals under 5, then the total minus the rest
 * would still isolate it, so the next smallest goes too. Smallest first, then by name in byte order, as the SQL does.
 */
export function hiddenGroups(sizes: Record<string, number>): string[] {
  const order = Object.entries(sizes).sort(([a, x], [b, y]) => x - y || (a < b ? -1 : a > b ? 1 : 0));
  const hidden: string[] = [];
  let sum = 0;
  for (const [g, n] of order) {
    if (n < MIN_GROUP || (sum > 0 && sum < MIN_GROUP)) {
      hidden.push(g);
      sum += n;
    }
  }
  return hidden;
}

/** A percentage of two published figures, never of the exact ones, so it can't be worked backwards. */
export const percentOf = (n: number | null, of: number | null): number | null => (n === null || of === null || of < MIN_FOR_RATE ? null : Math.round((100 * n) / of));
