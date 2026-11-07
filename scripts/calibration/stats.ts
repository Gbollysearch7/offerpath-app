import { createHash } from "node:crypto";

// Statistics for calibration reports. Pure and deterministic: a report built twice from the same inputs is the same.
// Nothing here knows about Offerpath, and known-answer tests live in tests/calibration-stats.test.ts.

export const mean = (x: number[]): number => x.reduce((a, b) => a + b, 0) / x.length;

export const median = (x: number[]): number => {
  const s = [...x].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function pearson(x: number[], y: number[]): number | null {
  if (x.length < 2) return null;
  const mx = mean(x);
  const my = mean(y);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  // No spread means agreement is undefined. Null, never 0 or 1: a constant score must not read as a result.
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

export function ranks(v: number[]): number[] {
  const sorted = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(v.length);
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1][0] === sorted[i][0]) j++;
    for (let k = i; k <= j; k++) r[sorted[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

export const spearman = (x: number[], y: number[]): number | null => pearson(ranks(x), ranks(y));

/** Kendall's tau-b, which corrects for ties. Null when either side has no spread. */
export function kendallTauB(x: number[], y: number[]): number | null {
  let concordant = 0, discordant = 0, tiedX = 0, tiedY = 0;
  const n = x.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = Math.sign(x[i] - x[j]);
      const b = Math.sign(y[i] - y[j]);
      if (a === 0) tiedX++;
      if (b === 0) tiedY++;
      if (a * b > 0) concordant++;
      else if (a * b < 0) discordant++;
    }
  }
  const pairs = (n * (n - 1)) / 2;
  const denom = Math.sqrt((pairs - tiedX) * (pairs - tiedY));
  return denom ? (concordant - discordant) / denom : null;
}

/** Weighted Cohen's kappa over categories 0..k-1. Null when expected disagreement is zero (one category only). */
export function weightedKappa(a: number[], b: number[], k: number, weighting: "linear" | "quadratic" = "linear"): number | null {
  if (!a.length) return null;
  const w = (i: number, j: number) => (weighting === "linear" ? Math.abs(i - j) / (k - 1) : ((i - j) / (k - 1)) ** 2);
  const pa = new Array<number>(k).fill(0);
  const pb = new Array<number>(k).fill(0);
  let observed = 0;
  for (let i = 0; i < a.length; i++) {
    pa[a[i]]++;
    pb[b[i]]++;
    observed += w(a[i], b[i]);
  }
  observed /= a.length;
  let expected = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) expected += w(i, j) * (pa[i] / a.length) * (pb[j] / a.length);
  return expected ? 1 - observed / expected : null;
}

/**
 * Krippendorff's alpha. `units` holds one array per document, one entry per reviewer, null where a reviewer did not
 * mark it, so missing marks are handled rather than dropped. Null when there is nothing to compare.
 */
export function krippendorffAlpha(units: (number | null)[][], metric: "interval" | "ordinal" | "nominal" = "interval"): number | null {
  const rated = units.map((u) => u.filter((v): v is number => v !== null)).filter((u) => u.length >= 2);
  const total = rated.reduce((s, u) => s + u.length, 0);
  if (total < 2) return null;
  const freq = new Map<number, number>();
  for (const u of rated) for (const v of u) freq.set(v, (freq.get(v) ?? 0) + 1);
  const values = [...freq.keys()].sort((a, b) => a - b);
  const delta = (c: number, k: number): number => {
    if (metric === "nominal") return c === k ? 0 : 1;
    if (metric === "interval") return (c - k) ** 2;
    if (c === k) return 0;
    const [lo, hi] = c < k ? [c, k] : [k, c];
    const between = values.filter((v) => v >= lo && v <= hi).reduce((s, v) => s + freq.get(v)!, 0);
    return (between - (freq.get(lo)! + freq.get(hi)!) / 2) ** 2;
  };
  let observed = 0;
  for (const u of rated) {
    let unit = 0;
    for (let i = 0; i < u.length; i++) for (let j = 0; j < u.length; j++) if (i !== j) unit += delta(u[i], u[j]);
    observed += unit / (u.length - 1);
  }
  let expected = 0;
  for (const c of values) for (const k of values) if (c !== k) expected += freq.get(c)! * freq.get(k)! * delta(c, k);
  expected /= total - 1;
  return expected ? 1 - observed / expected : null;
}

/** Wilson score interval for a proportion, at 95%. Stays honest at 0 of n, where a percentile bootstrap collapses to a point. */
export function wilson(successes: number, n: number, z = 1.959964): [number, number] | null {
  if (n === 0) return null;
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** A small seeded generator (mulberry32). Seeded from a string so a report can name its seed. */
export function seededRandom(seed: string): () => number {
  let s = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BootstrapResult {
  ci: [number, number] | null;
  replicates: number;
  /** Resamples in which the statistic was undefined (for example, every resampled score was equal). */
  undefinedReplicates: number;
}

/**
 * Percentile bootstrap that resamples whole groups, never single rows. Variants of one CV are not independent, so
 * resampling them one at a time would make the interval look narrower than the data can support.
 */
export function clusterBootstrap<T>(rows: T[], groupOf: (r: T) => string, stat: (rows: T[]) => number | null, seed: string, iterations: number): BootstrapResult {
  const byGroup = new Map<string, T[]>();
  for (const r of rows) {
    const g = groupOf(r);
    const list = byGroup.get(g);
    if (list) list.push(r);
    else byGroup.set(g, [r]);
  }
  const groups = [...byGroup.keys()].sort();
  if (groups.length < 2) return { ci: null, replicates: 0, undefinedReplicates: 0 };
  const random = seededRandom(seed);
  const values: number[] = [];
  let undefinedReplicates = 0;
  for (let i = 0; i < iterations; i++) {
    const sample: T[] = [];
    for (let g = 0; g < groups.length; g++) sample.push(...byGroup.get(groups[Math.floor(random() * groups.length)])!);
    const v = stat(sample);
    if (v === null || !Number.isFinite(v)) undefinedReplicates++;
    else values.push(v);
  }
  if (values.length < iterations / 2) return { ci: null, replicates: values.length, undefinedReplicates };
  values.sort((a, b) => a - b);
  const at = (q: number) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
  return { ci: [at(0.025), at(0.975)], replicates: values.length, undefinedReplicates };
}

/** The wider of two intervals. Either can be missing. */
export function envelope(a: [number, number] | null, b: [number, number] | null): [number, number] | null {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
}
