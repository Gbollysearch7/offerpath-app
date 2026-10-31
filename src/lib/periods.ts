// Reporting periods for the careers dashboard, following the UK academic year (September to August).

export interface Period {
  key: string;
  label: string;
  from: string | null; // ISO date, inclusive
  to: string | null; // ISO date, exclusive
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function listPeriods(now = new Date()): Period[] {
  const y = now.getUTCFullYear();
  const start = now.getUTCMonth() >= 8 ? y : y - 1; // academic year starts in September
  const ay = (s: number) => `${s}–${String((s + 1) % 100).padStart(2, "0")}`;
  return [
    { key: `autumn-${start}`, label: `Autumn term ${start}`, from: iso(start, 9, 1), to: iso(start + 1, 1, 1) },
    { key: `spring-${start + 1}`, label: `Spring term ${start + 1}`, from: iso(start + 1, 1, 1), to: iso(start + 1, 4, 16) },
    { key: `summer-${start + 1}`, label: `Summer term ${start + 1}`, from: iso(start + 1, 4, 16), to: iso(start + 1, 9, 1) },
    { key: `year-${start}`, label: `Academic year ${ay(start)}`, from: iso(start, 9, 1), to: iso(start + 1, 9, 1) },
    { key: `year-${start - 1}`, label: `Academic year ${ay(start - 1)}`, from: iso(start - 1, 9, 1), to: iso(start, 9, 1) },
    { key: "all", label: "All time", from: null, to: null },
  ];
}

export function findPeriod(key: string | undefined, now = new Date()): Period {
  const all = listPeriods(now);
  return all.find((p) => p.key === key) ?? all[0];
}
