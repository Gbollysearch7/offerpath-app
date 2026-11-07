import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadDataset } from "../scripts/calibration/dataset";
import { rulesPredictor } from "../scripts/calibration/engine";
import { CalibrationRefusal, ILLUSTRATIVE_BANNER, ILLUSTRATIVE_DEMO_MARKS, matchesDemoCv, SYNTHETIC_BANNER } from "../scripts/calibration/evidence";
import { EXIT, runCli } from "../scripts/calibration/cli";
import { renderReport } from "../scripts/calibration/report";
import { assertUsable, evaluate, freezeDataset, insideRepoAndNotIgnored, realDataProblems } from "../scripts/calibration/run";
import { readAllTexts } from "../scripts/calibration/engine";
import { syntheticThresholds } from "../scripts/calibration/synthetic";
import { DEMO_CVS } from "@/lib/seed-data";
import { editManifest, syntheticCopy, syntheticSplit, tempDir } from "./fixtures/calibration-helpers";

const capture = async (argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, (l) => out.push(l), (l) => err.push(l));
  return { code, out: out.join("\n"), err: err.join("\n") };
};

/** A dataset made of the demo CVs and demo marks, labelled however the test wants. */
function demoDataset(kind: string, edit: (text: string) => string = (t) => t): string {
  const dir = tempDir();
  writeFileSync(join(dir, "reviewers.csv"), "reviewer_id,role,independent_of_offerpath\nADV-1,careers adviser,yes\n");
  const documents = DEMO_CVS.map((c, i) => {
    const file = `demo-${i}.txt`;
    writeFileSync(join(dir, file), edit(c.text));
    return { id: `demo-${i}`, file, group: `g${i}`, discipline: "Economics", career_stage: "finalist", document_style: "one-column", writing_strength: "medium", variant_kind: "original", variant_of: null, consent_ref: "c", anonymisation_reviewed_by: "x" };
  });
  writeFileSync(join(dir, "adviser-marks.csv"), `document_id,reviewer_id,overall_mark,impact,clarity,structure,spelling,length,saw_offerpath_output,marked_at,notes\n${documents.map((d, i) => `${d.id},ADV-1,${ILLUSTRATIVE_DEMO_MARKS[i]},,,,,,no,2026-11-07,`).join("\n")}\n`);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ schema: "offerpath-calibration-dataset/1", name: "from-demo", version: "1", kind, documents }));
  return dir;
}

test("DEMO: a dataset marked illustrative is refused as validation at every step", async () => {
  const dir = demoDataset("illustrative");
  for (const argv of [["validate", "--dir", dir], ["split", "--dir", dir], ["evaluate", "--dir", dir, "--split", "development"], ["evaluate", "--dir", dir, "--split", "heldout", "--open-heldout"], ["marking-sheets", "--dir", dir], ["rewrite-sheets", "--dir", dir], ["findings-sheets", "--dir", dir, "--split", "development"]]) {
    const r = await capture(argv);
    assert.equal(r.code, EXIT.refused, argv.join(" "));
    assert.match(r.err, /[Ii]llustrative demo/);
  }
  const ds = loadDataset(dir);
  await assert.rejects(evaluate(ds, { split: "heldout", openHeldout: true, predictor: rulesPredictor() }), CalibrationRefusal);
  await assert.rejects(freezeDataset(ds, syntheticThresholds(), rulesPredictor()), CalibrationRefusal);
});

test("DEMO: the illustrative label alone is enough, whatever text the documents hold", async () => {
  const dir = await syntheticCopy();
  editManifest(dir, (m) => {
    m.kind = "illustrative";
  });
  const r = await capture(["validate", "--dir", dir]);
  assert.equal(r.code, EXIT.refused);
  assert.match(r.err, /marked illustrative/);
});

test("DEMO: demo CVs and marks relabelled as real are recognised by their text and refused", async () => {
  const dir = demoDataset("real");
  const r = await capture(["validate", "--dir", dir]);
  assert.equal(r.code, EXIT.refused);
  assert.match(r.err, /matches the demo CV Jordan_Reed_CV_v3\.pdf/);
  const lightly = demoDataset("real", (t) => t.replace(/Jordan Reed/g, "Sam Hill").replace(/jordan\.reed@email\.com/g, "candidate.x@example.invalid"));
  assert.equal((await capture(["validate", "--dir", lightly])).code, EXIT.refused);
  assert.equal((await capture(["split", "--dir", lightly])).code, EXIT.refused);
});

test("DEMO: demo CVs labelled synthetic are refused too, so the isolation doesn't depend on a label", async () => {
  const r = await capture(["validate", "--dir", demoDataset("synthetic")]);
  assert.equal(r.code, EXIT.refused);
  assert.match(r.err, /whatever its dataset is labelled/);
  assert.equal(matchesDemoCv("An unrelated CV about something else entirely, with no shared wording at all in it."), null);
});

test("DEMO: --demo stands alone. Combined with anything that looks like a real run, it is refused", async () => {
  for (const argv of [["--demo", "--split", "heldout"], ["--demo", "--dir", "calibration"], ["--demo", "--ai"], ["evaluate", "--demo", "--dir", "x", "--split", "heldout"], ["--demo", "--open-heldout"]]) {
    const r = await capture(argv);
    assert.equal(r.code, EXIT.refused, argv.join(" "));
    assert.match(r.err, /can't be combined/);
  }
});

test("DEMO: --demo says what it is on its first and last lines, and shows no statistic or gate", async () => {
  const r = await capture(["--demo"]);
  assert.equal(r.code, EXIT.ok);
  const lines = r.out.trim().split("\n");
  assert.ok(lines[0].includes(ILLUSTRATIVE_BANNER));
  assert.ok(lines[lines.length - 1].includes(ILLUSTRATIVE_BANNER));
  assert.doesNotMatch(r.out, /spearman|pearson|correlation|mean absolute|\bmae\b|same band/i);
  assert.match(r.out, /one independent group/);
  for (const row of lines.filter((l) => /^\| Jordan/.test(l))) assert.match(row, /ILLUSTRATIVE/);
});

test("DEMO: the illustrative marks live in one file, and no calibration code but the demo path reads them", () => {
  const dir = "scripts/calibration";
  for (const f of readdirSync(dir)) {
    const src = readFileSync(join(dir, f), "utf8");
    if (f === "evidence.ts") assert.match(src, /\[48, 57, 69, 80\]/);
    else assert.doesNotMatch(src, /48, 57, 69, 80/, f);
    if (f !== "evidence.ts") assert.doesNotMatch(src, /ILLUSTRATIVE_DEMO_MARKS/, f);
    if (f !== "evidence.ts" && f !== "cli.ts") assert.doesNotMatch(src, /illustrativeDemoItems/, f);
  }
  assert.doesNotMatch(readFileSync("scripts/calibrate.ts", "utf8"), /48, 57/);
});

test("the end-to-end process: --demo with --split heldout exits 3 and a plain --demo exits 0", () => {
  const run = (...a: string[]) => spawnSync("npx", ["tsx", "--tsconfig", "tsconfig.json", "scripts/calibrate.ts", ...a], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "--conditions=react-server", ANTHROPIC_API_KEY: "" } });
  const refused = run("--demo", "--split", "heldout");
  assert.equal(refused.status, 3, refused.stderr);
  const plain = run("--demo");
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /ILLUSTRATIVE DEMO MARKS, NOT VALIDATION/);
});

test("the old one-shot forms are gone: --dir alone and adviser_scores.csv are refused and point to the runbook", async () => {
  const r = await capture(["--dir", "calibration"]);
  assert.equal(r.code, EXIT.refused);
  const dir = tempDir();
  writeFileSync(join(dir, "adviser_scores.csv"), "file,score\na.pdf,60\n");
  const old = await capture(["validate", "--dir", dir]);
  assert.equal(old.code, EXIT.refused);
  assert.match(old.err, /CALIBRATION_RUNBOOK/);
});

test("SYNTHETIC: relabelling the synthetic dataset as real is refused, and the report can't claim otherwise", async () => {
  const dir = await syntheticCopy();
  editManifest(dir, (m) => {
    m.kind = "real";
  });
  const ds = loadDataset(dir);
  const texts = await readAllTexts(ds);
  const problems = await realDataProblems(ds, texts);
  assert.ok(problems.some((p) => /synthetic fixture/.test(p)));
  assert.ok(problems.some((p) => /synthetic reviewer/.test(p)));
  assert.ok(problems.some((p) => /not independent/.test(p)));
  await assert.rejects(assertUsable(ds, texts), CalibrationRefusal);
});

test("SYNTHETIC: the output says SYNTHETIC, NOT VALIDATION first, last, on every result row, and lists the open human gates", async () => {
  const dir = await syntheticSplit();
  const ds = loadDataset(dir);
  await freezeDataset(ds, syntheticThresholds(), rulesPredictor());
  const report = await evaluate(ds, { split: "heldout", openHeldout: true, predictor: rulesPredictor(), iterations: 50 });
  assert.equal(report.evidence_status, SYNTHETIC_BANNER);
  assert.equal(report.validation_evidence, false);
  const md = renderReport(report);
  const lines = md.trim().split("\n");
  assert.ok(lines[0].includes(SYNTHETIC_BANNER));
  assert.ok(lines[lines.length - 1].includes(SYNTHETIC_BANNER));
  const rows = lines.filter((l) => l.startsWith("| ") && !/^\| (Result|Metric|Document) \|/.test(l));
  assert.ok(rows.length > 50);
  for (const row of rows) assert.ok(row.endsWith("| SYNTHETIC |"), row);
  for (const gate of ["Recruit qualified", "consented, anonymised", "Agree thresholds"]) assert.ok(md.includes(gate), gate);
  assert.match(md, /No figure below says anything about Offerpath's accuracy/);
});

test("SYNTHETIC: the CLI proof run prints the label and the open gates, and writes its reports", async () => {
  const dir = tempDir();
  const r = await capture(["synthetic", "--out", dir]);
  assert.equal(r.code, EXIT.ok, r.err);
  assert.ok(r.out.startsWith(SYNTHETIC_BANNER));
  assert.match(r.out, /remain open human gates/);
  assert.match(r.out, /says nothing about Offerpath/);
  const files = readdirSync(join(dir, "reports"));
  assert.equal(files.filter((f) => f.startsWith("heldout-")).length, 2);
  assert.equal(files.filter((f) => f.startsWith("development-")).length, 2);
});

test("a development report is labelled as such whatever the data, and never as validation", async () => {
  const dir = await syntheticSplit();
  const report = await evaluate(loadDataset(dir), { split: "development", predictor: rulesPredictor(), iterations: 20 });
  assert.equal(report.outcome, "NOT_ASSESSED");
  assert.deepEqual(report.gates, []);
  assert.equal(report.validation_evidence, false);
  assert.match(renderReport(report), /never evidence of accuracy/);
});

test("reports identify sample, versions and uncertainty", async () => {
  const dir = await syntheticSplit();
  const r = await evaluate(loadDataset(dir), { split: "development", predictor: rulesPredictor(), iterations: 50 });
  assert.equal(r.dataset.name, "synthetic-proof");
  assert.equal(r.dataset.version, "1");
  assert.match(r.dataset.data_hash, /^[0-9a-f]{64}$/);
  assert.ok(r.sample.documents > r.sample.independent_groups, "variants aren't independent, and the sample says so");
  assert.match(r.versions.engine_identity, /^rules\|rubric-[^|]+\|parser-[^|]+\|lexicon-[^|]+\|normaliser-[^|]+\|-\|-$/);
  assert.match(r.versions.extractor, /^extractor-/);
  assert.match(r.versions.coverage_policy, /^coverage-/);
  const mae = r.metrics.overall["score.mae"];
  assert.ok(mae.ci && mae.ci[0] <= mae.value! && mae.value! <= mae.ci[1]);
  assert.ok(mae.n_groups > 0 && mae.n >= mae.n_groups);
});

test("the same inputs give the same report, apart from its clock", async () => {
  const dir = await syntheticSplit();
  const ds = loadDataset(dir);
  const a = await evaluate(ds, { split: "development", predictor: rulesPredictor(), iterations: 100, now: "2026-01-01T00:00:00Z" });
  const b = await evaluate(ds, { split: "development", predictor: rulesPredictor(), iterations: 100, now: "2027-06-06T06:06:06Z" });
  assert.equal(a.report_hash, b.report_hash);
  assert.notEqual(a.generated_at, b.generated_at);
});

test("the whole synthetic proof gives the same held-out report hash when run twice", async () => {
  const hashOf = async () => {
    const r = await capture(["synthetic", "--out", tempDir()]);
    return /Report hash: ([0-9a-f]{64})/.exec(r.out)?.[1];
  };
  const first = await hashOf();
  assert.ok(first);
  assert.equal(await hashOf(), first);
});

test("real data can't sit where git could commit it", () => {
  assert.equal(insideRepoAndNotIgnored("docs"), true);
  assert.equal(insideRepoAndNotIgnored("calibration"), false);
  assert.equal(insideRepoAndNotIgnored(tempDir()), false);
});

test("the paid path can't be reached by accident", async () => {
  const dir = await syntheticSplit();
  const noFlag = await capture(["evaluate", "--dir", dir, "--split", "development", "--ai"]);
  assert.equal(noFlag.code, EXIT.refused);
  assert.match(noFlag.err, /paid provider/);
  const noKey = await capture(["evaluate", "--dir", dir, "--split", "development", "--ai", "--allow-paid-provider"]);
  assert.equal(noKey.code, EXIT.refused);
  assert.match(noKey.err, /ANTHROPIC_API_KEY/);
});
