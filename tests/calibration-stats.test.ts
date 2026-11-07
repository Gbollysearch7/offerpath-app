import assert from "node:assert/strict";
import { test } from "node:test";
import { clusterBootstrap, envelope, kendallTauB, krippendorffAlpha, mean, pearson, seededRandom, spearman, weightedKappa, wilson } from "../scripts/calibration/stats";

// Known answers. Each is worked by hand in a comment or comes from the cited publication, not from running this code.

const near = (a: number | null, b: number, eps = 0.0005) => assert.ok(a !== null && Math.abs(a - b) <= eps, `${a} should be about ${b}`);

test("Krippendorff's alpha reproduces the published worked example at all three levels", () => {
  // Krippendorff, "Computing Krippendorff's Alpha-Reliability" (2011): four observers, twelve units, with gaps.
  // Published: nominal 0.743, ordinal 0.815, interval 0.849.
  const _ = null;
  const observers = [
    [1, 2, 3, 3, 2, 1, 4, 1, 2, _, _, _],
    [1, 2, 3, 3, 2, 2, 4, 1, 2, 5, _, 3],
    [_, 3, 3, 3, 2, 3, 4, 2, 2, 5, 1, _],
    [1, 2, 3, 3, 2, 4, 4, 1, 2, 5, 1, _],
  ];
  const units = observers[0].map((__, u) => observers.map((o) => o[u]));
  near(krippendorffAlpha(units, "nominal"), 0.743);
  near(krippendorffAlpha(units, "ordinal"), 0.815);
  near(krippendorffAlpha(units, "interval"), 0.849);
});

test("Krippendorff's alpha: perfect agreement is 1, and nothing to compare is null", () => {
  assert.equal(krippendorffAlpha([[1, 1], [2, 2], [3, 3]]), 1);
  assert.equal(krippendorffAlpha([[1, null], [null, 2]]), null);
  assert.equal(krippendorffAlpha([[5, 5], [5, 5]]), null, "no spread at all says nothing about agreement");
});

test("Spearman handles ties by average rank, and a constant series is undefined rather than zero", () => {
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1);
  // Ranks of [1,2,2,3] are [1,2.5,2.5,4], and they correlate with [1,2,3,4] at sqrt(0.9) = 0.9487.
  near(spearman([1, 2, 2, 3], [1, 2, 3, 4]), 0.9487);
  assert.equal(pearson([3, 3, 3], [1, 2, 3]), null);
  assert.equal(spearman([3, 3, 3], [1, 2, 3]), null);
});

test("Kendall's tau-b, worked by hand", () => {
  // 5 concordant, 1 discordant of 6 pairs: 4/6.
  near(kendallTauB([1, 2, 3, 4], [1, 3, 2, 4]), 0.6667);
  // 4 concordant, one tie on each side: 4 / sqrt(5*5).
  near(kendallTauB([1, 2, 2, 3], [1, 2, 3, 3]), 0.8);
  assert.equal(kendallTauB([1, 1], [1, 2]), null);
});

test("linear weighted kappa, worked by hand", () => {
  // Observed weighted disagreement 1.5/6 = 0.25; expected 0.41667; kappa = 1 - 0.25/0.41667 = 0.4.
  near(weightedKappa([0, 0, 1, 1, 2, 2], [0, 1, 1, 1, 2, 0], 3), 0.4);
  assert.equal(weightedKappa([1, 1], [1, 1], 3), null, "one category only: chance agreement is total, so kappa is undefined");
  assert.equal(weightedKappa([], [], 3), null);
});

test("Wilson interval matches published values and stays open at 0 of n", () => {
  const a = wilson(8, 10)!;
  near(a[0], 0.4902);
  near(a[1], 0.9433);
  const z = wilson(0, 10)!;
  assert.equal(z[0], 0);
  near(z[1], 0.2775);
  assert.equal(wilson(0, 0), null);
});

test("the bootstrap resamples whole groups, so clustered rows get a wider interval than independent ones", () => {
  // Ten values, each repeated five times. Treating the 50 rows as independent would overstate certainty.
  const rows = Array.from({ length: 10 }, (_, g) => Array.from({ length: 5 }, () => ({ g: `g${g}`, v: g * 10 }))).flat();
  const stat = (rs: typeof rows) => mean(rs.map((r) => r.v));
  const grouped = clusterBootstrap(rows, (r) => r.g, stat, "seed", 2000).ci!;
  const naive = clusterBootstrap(rows.map((r, i) => ({ ...r, g: `row${i}` })), (r) => r.g, stat, "seed", 2000).ci!;
  assert.ok(grouped[1] - grouped[0] > 1.5 * (naive[1] - naive[0]), `grouped ${grouped} should be much wider than ${naive}`);
});

test("the bootstrap is deterministic for a seed, and says when it has too little to work with", () => {
  const rows = Array.from({ length: 30 }, (_, v) => ({ g: `g${v}`, v: v * v }));
  const run = (seed: string) => clusterBootstrap(rows, (r) => r.g, (rs) => mean(rs.map((r) => r.v)), seed, 500).ci;
  assert.deepEqual(run("a"), run("a"));
  assert.notDeepEqual(run("a"), run("b"));
  assert.equal(clusterBootstrap([{ g: "only", v: 1 }, { g: "only", v: 2 }], (r) => r.g, () => 1, "s", 100).ci, null, "one group has no between-group variation to resample");
  const mostlyUndefined = clusterBootstrap(rows, (r) => r.g, () => null, "s", 100);
  assert.equal(mostlyUndefined.ci, null);
  assert.equal(mostlyUndefined.undefinedReplicates, 100);
});

test("the seeded generator repeats and an interval envelope takes the wider bounds", () => {
  const a = seededRandom("x");
  const b = seededRandom("x");
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.deepEqual(envelope([0.2, 0.5], [0.1, 0.4]), [0.1, 0.5]);
  assert.deepEqual(envelope(null, [0.1, 0.4]), [0.1, 0.4]);
});
