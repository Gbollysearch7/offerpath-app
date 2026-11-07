import assert from "node:assert/strict";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { KIND, RESULT, VERB } from "@/lib/analysis/judgment";
import { loadDataset, SHEETS } from "../scripts/calibration/dataset";
import { fileJudgmentStore, judgedPredictor, readAllTexts, rulesPredictor, type Predictor } from "../scripts/calibration/engine";
import { CalibrationRefusal } from "../scripts/calibration/evidence";
import { evaluateGates, METRIC_DIRECTION, REQUIRED_GATES, runOutcome, thresholdProblems, type Thresholds } from "../scripts/calibration/gates";
import { LEDGER_FILE, readFreeze, readLedger } from "../scripts/calibration/heldout";
import { computeMetrics, type Metric, type MetricBundle } from "../scripts/calibration/metrics";
import { contextFor, evaluate, evidenceBlockers, freezeDataset, saveReport } from "../scripts/calibration/run";
import { renderReport } from "../scripts/calibration/report";
import { importSheet } from "../scripts/calibration/sheets";
import { docsInSplit, readSplit } from "../scripts/calibration/split";
import { syntheticThresholds } from "../scripts/calibration/synthetic";
import { renamed, silentlyChanged, syntheticSplit, tempDir } from "./fixtures/calibration-helpers";

const metric = (value: number | null, ci: [number, number] | null = value === null ? null : [value - 0.01, value + 0.01], n_groups = 20): Metric => ({ value, ci, n: n_groups, n_groups });
const thresholds = (gates: { metric: string; scope: string; threshold: number }[], over: Partial<Thresholds> = {}): Thresholds => ({ schema: "offerpath-thresholds/1", dataset: "d", dataset_version: "1", minimum_heldout_groups: 10, minimum_subgroup_groups: 5, agreed_by: [], gates: gates.map((g) => ({ ...g, why: "test" })), ...over });

test("FAILED THRESHOLDS: one bad gate among many excellent ones fails the run, and no field averages them", () => {
  const overall: MetricBundle["overall"] = {};
  const gates = Object.keys(METRIC_DIRECTION).map((m) => {
    overall[m] = metric(METRIC_DIRECTION[m] === "max" ? 0.01 : 0.99);
    return { metric: m, scope: "overall", threshold: 0.5 };
  });
  const allGood = evaluateGates(thresholds(gates), { overall, subgroups: {} });
  assert.ok(allGood.every((r) => r.outcome === "PASS"));
  assert.equal(runOutcome(allGood), "MET");

  overall["rewrite.fidelity_failure_rate"] = metric(0.9);
  const oneBad = evaluateGates(thresholds(gates), { overall, subgroups: {} });
  assert.equal(oneBad.filter((r) => r.outcome === "FAIL").length, 1);
  assert.equal(oneBad.filter((r) => r.outcome === "PASS").length, gates.length - 1);
  assert.equal(runOutcome(oneBad), "NOT_MET");
  assert.ok(!Object.keys(oneBad[0]).some((k) => /average|composite|total|weighted|overall_score/i.test(k)));
});

test("FAILED THRESHOLDS: a real pipeline run where one discipline is badly wrong fails, though the overall error passes", async () => {
  const dir = await syntheticSplit();
  const ds = loadDataset(dir);
  const texts = await readAllTexts(ds);
  const adviserMean = (id: string) => {
    const marks = ds.marks.filter((m) => m.document_id === id).map((m) => m.overall);
    return marks.length ? marks.reduce((a, b) => a + b, 0) / marks.length : 50;
  };
  const inner = rulesPredictor();
  // Tracks advisers closely everywhere, except Law, where it is 20 points out. Invented, to test the gate logic.
  const predictor: Predictor = async (d, t) => ({ ...(await inner(d, t)), score: Math.round(adviserMean(d.id)) + (d.discipline === "Law" ? 20 : 0) });
  const predictions = new Map(await Promise.all(ds.documents.map(async (d) => [d.id, await predictor(d, texts.get(d.id)!)] as const)));
  const bundle = computeMetrics(contextFor(ds, ds.documents, predictions, texts, 200));
  const results = evaluateGates(thresholds([{ metric: "score.mae", scope: "overall", threshold: 12 }, { metric: "score.mae", scope: "each:discipline", threshold: 12 }], { minimum_subgroup_groups: 3 }), bundle);
  const overall = results.find((r) => r.subgroup === null)!;
  assert.equal(overall.outcome, "PASS", JSON.stringify(overall));
  const law = results.find((r) => r.subgroup === "Law")!;
  assert.equal(law.outcome, "FAIL", JSON.stringify(law));
  assert.equal(runOutcome(results), "NOT_MET");
  assert.ok(results.filter((r) => r.scope === "each:discipline").length === 6, "every discipline gets its own check");
});

test("a pass needs the cautious end of the interval. Thin data is inconclusive, and so is anything unmeasured", () => {
  const gate = [{ metric: "score.mae", scope: "overall", threshold: 10 }];
  const run = (m: Metric | undefined) => evaluateGates(thresholds(gate), { overall: m ? { "score.mae": m } : {}, subgroups: {} })[0];
  assert.equal(run(metric(8, [6, 9.5])).outcome, "PASS");
  assert.equal(run(metric(8, [3, 13])).outcome, "INCONCLUSIVE");
  assert.equal(run(metric(12, [11, 13])).outcome, "FAIL");
  assert.equal(run(metric(12, [5, 19])).outcome, "FAIL", "an estimate that misses is a failure, whatever the interval");
  assert.equal(run(metric(null)).outcome, "INCONCLUSIVE");
  assert.equal(run(undefined).outcome, "INCONCLUSIVE");
  assert.equal(run(metric(8, null)).outcome, "INCONCLUSIVE");
  assert.equal(run(metric(8, [6, 9], 3)).outcome, "INCONCLUSIVE", "under the agreed minimum number of groups");
  assert.equal(runOutcome([run(metric(8, [6, 9]))], ["a blocker"]), "INCONCLUSIVE", "a blocker stops a met result");
  assert.equal(runOutcome([]), "INCONCLUSIVE", "no gates tested is not a pass");
});

test("the direction of a metric is fixed by the tool, so higher error can't be defined as better", () => {
  const r = evaluateGates(thresholds([{ metric: "rank.spearman", scope: "overall", threshold: 0.5 }, { metric: "findings.false_positive_rate", scope: "overall", threshold: 0.5 }]), { overall: { "rank.spearman": metric(0.1), "findings.false_positive_rate": metric(0.9) }, subgroups: {} });
  assert.deepEqual(r.map((x) => [x.direction, x.outcome]), [["at least", "FAIL"], ["at most", "FAIL"]]);
  assert.ok(!("direction" in syntheticThresholds().gates[0]));
});

test("a subgroup gate with no subgroups is inconclusive rather than passing vacuously", () => {
  const r = evaluateGates(thresholds([{ metric: "gaming.rewarded_share", scope: "each:variant_kind", threshold: 0.1 }]), { overall: {}, subgroups: { "each:variant_kind": {} } });
  assert.equal(r[0].outcome, "INCONCLUSIVE");
});

test("the blank template, gaps, missing required gates and unknown metrics are all refused", () => {
  const manifest = { name: "n", version: "1", kind: "real" };
  const template = JSON.parse(readFileSync("docs/calibration/thresholds.template.json", "utf8")) as Thresholds;
  const blank = thresholdProblems({ ...template, dataset: "n", dataset_version: "1" }, manifest);
  assert.ok(blank.some((p) => /minimum_heldout_groups/.test(p)));
  assert.equal(blank.filter((p) => /threshold is blank/.test(p)).length, REQUIRED_GATES.length, "the template proposes no numbers");
  assert.ok(blank.some((p) => /pilot partner/.test(p)));
  assert.ok(blank.some((p) => /founder/.test(p)));

  const ok = { ...syntheticThresholds(), dataset: "n" , dataset_version: "1", agreed_by: [{ name: "A", role: "pilot_partner", date: "2027-01-01" }, { name: "B", role: "founder", date: "2027-01-01" }] };
  assert.deepEqual(thresholdProblems(ok, manifest), []);
  assert.match(thresholdProblems({ ...ok, gates: ok.gates.filter((g) => g.metric !== "rewrite.fidelity_failure_rate") }, manifest).join(), /required gate missing: rewrite\.fidelity_failure_rate/);
  assert.match(thresholdProblems({ ...ok, gates: [...ok.gates, { metric: "score.vibes", scope: "overall", threshold: 1, why: "x" }] }, manifest).join(), /not a metric/);
  assert.match(thresholdProblems({ ...ok, gates: [...ok.gates, ok.gates[0]] }, manifest).join(), /listed twice/);
  assert.match(thresholdProblems({ ...ok, gates: [{ ...ok.gates[0], why: " " }, ...ok.gates.slice(1)] }, manifest).join(), /record why/);
  assert.match(thresholdProblems({ ...ok, dataset: "other" }, manifest).join(), /but the dataset is/);
  assert.match(thresholdProblems({ ...ok, agreed_by: [{ name: "B", role: "founder", date: "2027-01-01" }] }, manifest).join(), /pilot partner/);
});

test("every metric a required gate names has a fixed direction and is really computed", async () => {
  const dir = await syntheticSplit();
  const r = await evaluate(loadDataset(dir), { split: "development", predictor: rulesPredictor(), iterations: 20 });
  for (const g of REQUIRED_GATES) {
    assert.ok(METRIC_DIRECTION[g.metric], g.metric);
    if (g.scope === "overall") assert.ok(r.metrics.overall[g.metric], g.metric);
    else assert.ok(Object.values(r.metrics.subgroups[g.scope]).every((s) => s[g.metric]), `${g.metric} ${g.scope}`);
  }
});

async function frozen() {
  const dir = await syntheticSplit();
  await freezeDataset(loadDataset(dir), syntheticThresholds(), rulesPredictor());
  return dir;
}

const open = (dir: string, predictor: Predictor = rulesPredictor()) => evaluate(loadDataset(dir), { split: "heldout", openHeldout: true, predictor, iterations: 30 });

test("UNTOUCHED: held-out stays closed without the explicit step, and without frozen thresholds", async () => {
  const dir = await syntheticSplit();
  const seen: string[] = [];
  const spy: Predictor = (d, t) => { seen.push(d.id); return rulesPredictor()(d, t); };
  await assert.rejects(open(dir), /No frozen thresholds/);
  await assert.rejects(evaluate(loadDataset(dir), { split: "heldout", predictor: spy }), /--open-heldout/);
  const held = new Set(docsInSplit(loadDataset(dir).documents, readSplit(loadDataset(dir)), "heldout").map((d) => d.id));
  assert.deepEqual(seen.filter((id) => held.has(id)), [], "no held-out document was scored by a refused attempt");
  assert.equal(readLedger(dir).length, 0);
});

test("UNTOUCHED: the look is on the ledger before any held-out score exists", async () => {
  const dir = await frozen();
  const ds = loadDataset(dir);
  const held = new Set(docsInSplit(ds.documents, readSplit(ds), "heldout").map((d) => d.id));
  const inner = rulesPredictor();
  const crashes: Predictor = (d, t) => {
    if (held.has(d.id)) {
      assert.equal(readLedger(dir).length, 1, "recorded before scoring");
      throw new Error("crash during held-out scoring");
    }
    return inner(d, t);
  };
  await assert.rejects(open(dir, crashes), /crash during/);
  assert.equal(readLedger(dir).length, 1);
});

test("UNTOUCHED: after a first look only an exact repeat is allowed, and it is labelled a repeat", async () => {
  const dir = await frozen();
  const first = await open(dir);
  assert.equal(first.look, "first");
  const again = await open(dir);
  assert.equal(again.look, "repeat");
  assert.equal(readLedger(dir).length, 1);
  assert.match(renderReport(again), /exact repeat/);
  assert.deepEqual(again.metrics, first.metrics);
});

test("UNTOUCHED: an engine tuned after the look is refused. The held-out set is spent", async () => {
  const dir = await frozen();
  await open(dir);
  await assert.rejects(freezeDataset(loadDataset(dir), syntheticThresholds(), renamed("rules|tuned-after-look")), (e: Error) => e instanceof CalibrationRefusal && /no longer untouched/.test(e.message));
  await assert.rejects(open(dir, renamed("rules|tuned-after-look")), (e: Error) => e instanceof CalibrationRefusal && /was frozen/.test(e.message));
});

test("UNTOUCHED: a freeze can't be swapped by hand after the look either: ledger checks catch engine and thresholds", async () => {
  const dir = await frozen();
  await open(dir);
  const path = join(dir, "prereg.lock.json");
  const freeze = readFreeze(dir)!;
  // A hand-edited freeze that claims the tuned engine was what was frozen.
  writeFileSync(path, JSON.stringify({ ...freeze, engine_identity: "rules|tuned-after-look" }));
  await assert.rejects(open(dir, renamed("rules|tuned-after-look")), (e: Error) => e instanceof CalibrationRefusal && /HELD-OUT SPENT/.test(e.message));
  // And one with an easier threshold.
  const easier = { ...freeze.thresholds, gates: freeze.thresholds.gates.map((g) => ({ ...g, threshold: g.threshold + 1 })) };
  writeFileSync(path, JSON.stringify({ ...freeze, thresholds: easier }));
  await assert.rejects(open(dir), (e: Error) => e instanceof CalibrationRefusal && /different thresholds/.test(e.message));
});

test("UNTOUCHED: tuning before the look is fine: a new freeze is recorded, and the new engine gets the one look", async () => {
  const dir = await frozen();
  const tuned = renamed("rules|tuned-on-development");
  await assert.rejects(open(dir, tuned), /was frozen/, "an unfrozen engine can't open it");
  const again = await freezeDataset(loadDataset(dir), syntheticThresholds(), tuned);
  assert.equal(again.replaced.length, 1, "the replaced freeze stays visible");
  const r = await open(dir, tuned);
  assert.equal(r.versions.engine_identity, "rules|tuned-on-development");
  assert.equal(r.freeze?.replaced_before_opening, 1);
});

test("UNTOUCHED: an engine changed without a version bump is caught before anything opens", async () => {
  const dir = await frozen();
  await assert.rejects(open(dir, silentlyChanged()), (e: Error) => e instanceof CalibrationRefusal && /without a version bump/.test(e.message));
  assert.equal(readLedger(dir).length, 0);
});

test("UNTOUCHED: marks can't be changed or added after the look", async () => {
  const dir = await frozen();
  await open(dir);
  const marks = join(dir, SHEETS.marks.file);
  const original = readFileSync(marks, "utf8");
  const lines = original.trim().split("\n");
  const cells = lines[1].split(",");
  cells[2] = cells[2] === "1" ? "2" : "1";
  writeFileSync(marks, `${[lines[0], cells.join(","), ...lines.slice(2)].join("\n")}\n`);
  await assert.rejects(open(dir), (e: Error) => e instanceof CalibrationRefusal && /different data/.test(e.message));
  writeFileSync(marks, original);
  const f = join(tempDir(), "late.csv");
  writeFileSync(f, original);
  assert.throws(() => importSheet(dir, "marks", f), /has been opened/);
});

test("UNTOUCHED: an edited ledger is refused, and a deleted one is noticed if reports remain", async () => {
  const dir = await frozen();
  const r = await open(dir);
  saveReport(loadDataset(dir), r, renderReport(r));
  const path = join(dir, LEDGER_FILE);
  const entry = readFileSync(path, "utf8");
  writeFileSync(path, entry.replace(/"engine_identity":"[^"]+"/, '"engine_identity":"rules|forged"'));
  assert.throws(() => readLedger(dir), /altered/);
  writeFileSync(path, entry);
  appendFileSync(path, `${JSON.stringify({ seq: 2, at: "x", engine_identity: "y", thresholds_hash: "z", data_hash: "w", prev: "wrong", hash: "h" })}\n`);
  assert.throws(() => readLedger(dir), /altered/);
  rmSync(path);
  assert.throws(() => readLedger(dir), /is gone/);
});

test("reviews of findings the frozen engine no longer raises are counted and stop a met result", async () => {
  const dir = await frozen();
  const ds = loadDataset(dir);
  const doc = docsInSplit(ds.documents, readSplit(ds), "heldout").find((d) => d.variant_kind === "original")!;
  appendFileSync(join(dir, SHEETS.findingReviews.file), `${doc.id}:retired-check,${doc.id},SYNTH-A,,,not_valid,,2026-11-07,\n`);
  const r = await open(dir);
  assert.equal(r.sample.stale_finding_reviews, 1);
  assert.match(r.blockers.join(), /different engine/);
  assert.notEqual(r.outcome, "MET");
});

test("a dataset under the blueprint's minimum, or with thin marking, can't reach met", async () => {
  const dir = await syntheticSplit();
  const ds = loadDataset(dir);
  const held = docsInSplit(ds.documents, readSplit(ds), "heldout");
  assert.deepEqual(evidenceBlockers(ds, held), [], "36 groups, 3 reviewers: no blocker");
  const few = { ...ds, documents: ds.documents.filter((d) => d.group < "synth-group-010") };
  assert.match(evidenceBlockers(few, []).join(), /Only 10 independent CV groups.*at least 30/);
  const oneMark = { ...ds, marks: ds.marks.filter((m) => m.reviewer_id === "SYNTH-A") };
  assert.match(evidenceBlockers(oneMark, held).join(), /fewer than 2 adviser marks/);
});

test("the judged path runs on an injected judge only, and a file cache makes scores repeat without paying twice", async () => {
  const dir = await syntheticSplit();
  const ds = loadDataset(dir);
  let calls = 0;
  const judge = async (bullets: { id: number; text: string }[]) => {
    calls++;
    return new Map(bullets.map((b) => [b.id, Array.from({ length: 3 }, () => ({ result: RESULT[0], verb: VERB[0], kind: KIND[0], relevance: "high" }))])) as never;
  };
  const cache = join(tempDir(), "judgments.json");
  const predictor = () => judgedPredictor(judge, "fake-judge-for-test", "Finance and banking", fileJudgmentStore(cache));
  const texts = await readAllTexts(ds);
  const doc = ds.documents[0];
  const a = await predictor()(doc, texts.get(doc.id)!);
  assert.match(a.identity, /^ai\|/);
  const before = calls;
  assert.ok(before > 0);
  const b = await predictor()(doc, texts.get(doc.id)!);
  assert.equal(calls, before, "the second run reads the cache");
  assert.equal(a.score, b.score);
});
