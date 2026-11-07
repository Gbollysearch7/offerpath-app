import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { toCsv, parseCsv } from "@/lib/csv";
import { EXIT, runCli } from "../scripts/calibration/cli";
import { SHEETS } from "../scripts/calibration/dataset";
import { INTAKE_COLUMNS } from "../scripts/calibration/sheets";
import { editManifest, tempDir } from "./fixtures/calibration-helpers";
import { REQUIRED_GATES } from "../scripts/calibration/gates";

// The runbook's commands in order, on the branch for real data. The CVs and marks here are invented and live in a
// temporary folder: this proves the steps connect and what they refuse. Its six groups can't reach "met", by design,
// and the test asserts that. It produces no finding about Offerpath.

const run = async (...argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, (l) => out.push(l), (l) => err.push(l));
  return { code, out: out.join("\n"), err: err.join("\n") };
};

function rawCv(i: number) {
  const t = `token${i}`;
  return `Riley Tester${String.fromCharCode(65 + i)}
riley${i}@student.example.ac.uk | 07912 34567${i} | linkedin.com/in/riley-${i}

EDUCATION
BSc Testing, Example Place ${i}, 2022 – 2025

EXPERIENCE
Assistant, Sample Firm ${i} | Sep 2023 – Jun 2025
• Reviewed ${t} monthly ${t} supplier ${t} invoices ${t} for ${t} the ${t} accounts ${t} team.
• Built ${t} a ${t} simple ${t} tracker ${t} for ${t} weekly ${t} stock ${t} checks.
• Led ${t} two ${t} training ${t} sessions ${t} on ${t} the ${t} new ${t} system.

SKILLS
Excel, SQL, ${t}
`;
}

test("the whole real-data route connects, and a small dataset comes out inconclusive and unvalidated", async () => {
  const root = tempDir();
  const raw = join(root, "raw");
  const dir = join(root, "dataset");
  mkdirSync(raw);
  const rows: string[][] = [];
  for (let i = 0; i < 6; i++) {
    writeFileSync(join(raw, `cv${i}.txt`), rawCv(i));
    rows.push([`cv${i}.txt`, `person-${i}`, "Testing", "finalist", "one-column", "medium", "original", "", `CONSENT-${i}`, `Riley Tester${String.fromCharCode(65 + i)}`]);
  }
  const intake = join(root, "intake.csv");
  writeFileSync(intake, toCsv([[...INTAKE_COLUMNS], ...rows]));

  const anon = await run("anonymise", "--intake", intake, "--raw", raw, "--out", dir, "--key-out", join(root, "steward", "key.json"), "--name", "route-test", "--version", "1");
  assert.equal(anon.code, EXIT.ok, anon.err);
  assert.match(anon.out, /does not make them anonymous/);

  assert.equal((await run("validate", "--dir", dir)).code, EXIT.input, "not signed off yet");
  editManifest(dir, (m) => m.documents.forEach((d) => (d.anonymisation_reviewed_by = "RT")));
  writeFileSync(join(dir, SHEETS.reviewers.file), `${SHEETS.reviewers.columns.join(",")}\nADV-1,careers adviser,yes\nADV-2,careers adviser,yes\n`);

  const check = await run("validate", "--dir", dir);
  assert.equal(check.code, EXIT.ok, check.err);
  assert.match(check.out, /at least 30 groups/);
  assert.match(check.out, /can't verify/);

  assert.equal((await run("split", "--dir", dir)).code, EXIT.ok);
  assert.equal((await run("marking-sheets", "--dir", dir)).code, EXIT.ok);
  assert.equal((await run("findings-sheets", "--dir", dir, "--split", "development")).code, EXIT.refused, "blind marks first");

  for (const reviewer of ["ADV-1", "ADV-2"]) {
    const sheet = join(dir, "sheets", `marks-${reviewer}.csv`);
    const [head, ...body] = parseCsv(readFileSync(sheet, "utf8"));
    const filled = body.map((r, i) => r.map((c, k) => (head[k] === "overall_mark" ? String(50 + i * 5) : head[k] === "saw_offerpath_output" ? "no" : head[k] === "marked_at" ? "2027-01-10" : c)));
    writeFileSync(sheet, toCsv([head, ...filled]));
    const imported = await run("import", "--dir", dir, "--sheet", "marks", "--file", sheet);
    assert.equal(imported.code, EXIT.ok, imported.err);
  }

  const dev = await run("evaluate", "--dir", dir, "--split", "development");
  assert.equal(dev.code, EXIT.ok, dev.err);
  assert.match(dev.out, /^# DEVELOPMENT DATA, NOT VALIDATION/);
  assert.equal((await run("findings-sheets", "--dir", dir, "--split", "development")).code, EXIT.ok);
  assert.equal((await run("findings-sheets", "--dir", dir, "--split", "heldout")).code, EXIT.refused, "freeze first");
  assert.equal((await run("evaluate", "--dir", dir, "--split", "heldout", "--open-heldout")).code, EXIT.refused, "no frozen thresholds yet");

  const template = JSON.parse(readFileSync("docs/calibration/thresholds.template.json", "utf8"));
  const blank = join(root, "blank.json");
  writeFileSync(blank, JSON.stringify({ ...template, dataset: "route-test", dataset_version: "1" }));
  const refused = await run("freeze", "--dir", dir, "--thresholds", blank);
  assert.equal(refused.code, EXIT.refused);
  assert.match(refused.err, /threshold is blank/);

  const filled = join(root, "thresholds.json");
  writeFileSync(filled, JSON.stringify({
    ...template,
    dataset: "route-test",
    dataset_version: "1",
    minimum_heldout_groups: 2,
    minimum_subgroup_groups: 1,
    agreed_by: [{ name: "Test Partner", role: "pilot_partner", date: "2027-01-05" }, { name: "Test Founder", role: "founder", date: "2027-01-05" }],
    gates: REQUIRED_GATES.map((g) => ({ ...g, threshold: 0.5, why: "invented for this test" })),
  }));
  const frozen = await run("freeze", "--dir", dir, "--thresholds", filled);
  assert.equal(frozen.code, EXIT.ok, frozen.err);
  assert.match(frozen.out, /Send that hash to the pilot partner/);

  assert.equal((await run("evaluate", "--dir", dir, "--split", "heldout")).code, EXIT.refused, "the explicit step is required");
  const held = await run("evaluate", "--dir", dir, "--split", "heldout", "--open-heldout");
  assert.equal(held.code, EXIT.thresholds, "anything but met is a non-zero exit");
  assert.match(held.out, /^# HELD-OUT RESULT ON HUMAN-ATTESTED DATA, NOT YET ACCEPTED AS VALIDATION/);
  assert.match(held.out, /Only 6 independent CV groups/);

  const name = readdirSync(join(dir, "reports")).find((f) => f.startsWith("heldout-") && f.endsWith(".json"))!;
  const report = JSON.parse(readFileSync(join(dir, "reports", name), "utf8"));
  assert.notEqual(report.outcome, "MET");
  assert.equal(report.validation_evidence, "pending_human_acceptance", "never simply true: only people can accept it");
  assert.match(report.human_gates.join(), /cannot check that they are true/);
});
