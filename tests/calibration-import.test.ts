import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import JSZip from "jszip";
import { analyseCv } from "@/lib/analysis/cv";
import { parseCsv } from "@/lib/csv";
import { anonymiseText, scanPii } from "../scripts/calibration/anonymise";
import { ImportError, loadDataset, SHEETS } from "../scripts/calibration/dataset";
import { readAllTexts, rulesPredictor } from "../scripts/calibration/engine";
import { CalibrationRefusal } from "../scripts/calibration/evidence";
import { compareOp015, OP015_COLUMNS, writeOp015Pack } from "../scripts/calibration/op015";
import { documentMetadataProblems, freezeDataset, realDataProblems } from "../scripts/calibration/run";
import { anonymiseIntake, importSheet, INTAKE_COLUMNS, writeFindingSheets, writeMarkingSheets, writeRewriteSheets } from "../scripts/calibration/sheets";
import { syntheticThresholds } from "../scripts/calibration/synthetic";
import { editManifest, syntheticCopy, syntheticSplit, tempDir } from "./fixtures/calibration-helpers";

function sheetLines(dir: string, spec: { file: string }) {
  return readFileSync(join(dir, spec.file), "utf8").trim().split("\n");
}

const withRow = (dir: string, spec: { file: string }, row: string) => writeFileSync(join(dir, spec.file), `${sheetLines(dir, spec).join("\n")}\n${row}\n`);

test("the blank templates carry exactly the columns the importer reads", () => {
  const pairs = [["reviewers", SHEETS.reviewers], ["adviser-marks", SHEETS.marks], ["finding-reviews", SHEETS.findingReviews], ["missed-issues", SHEETS.missedIssues], ["rewrite-items", SHEETS.rewriteItems], ["rewrite-reviews", SHEETS.rewriteReviews]] as const;
  for (const [name, spec] of pairs) assert.equal(readFileSync(`docs/calibration/${name}.template.csv`, "utf8").trim(), spec.columns.join(","), name);
  assert.equal(readFileSync("docs/calibration/intake.template.csv", "utf8").trim(), INTAKE_COLUMNS.join(","));
});

test("IMPORT: a mark made after seeing the app is refused, naming the row", async () => {
  const dir = await syntheticCopy();
  const lines = sheetLines(dir, SHEETS.marks);
  writeFileSync(join(dir, SHEETS.marks.file), `${[lines[0], lines[1].replace(",no,", ",yes,"), ...lines.slice(2)].join("\n")}\n`);
  assert.throws(() => loadDataset(dir), (e: Error) => e instanceof ImportError && /adviser-marks\.csv row 2: saw_offerpath_output must be "no"/.test(e.message));
});

test("IMPORT: bad rows stop the import and every one is listed. Nothing is skipped quietly", async () => {
  const dir = await syntheticCopy();
  const doc = loadDataset(dir).documents[0].id;
  const row = (d: string, r: string, mark: string, date = "2027-01-01") => `${d},${r},${mark},,,,,,no,${date},`;
  for (const bad of [row(doc, "SYNTH-A", "50"), row("ghost", "SYNTH-A", "50"), row(doc, "NOBODY", "50"), row(doc, "SYNTH-B", "101"), row(doc, "SYNTH-C", "abc"), row(doc, "SYNTH-A", "", "31/01/2027")]) withRow(dir, SHEETS.marks, bad);
  assert.throws(() => loadDataset(dir), (e: unknown) => {
    assert.ok(e instanceof ImportError);
    const all = e.problems.join("\n");
    for (const re of [/already marked/, /unknown document_id "ghost"/, /reviewer "NOBODY"/, /from 0 to 100, got "101"/, /got "abc"/, /a date such as/]) assert.match(all, re);
    return true;
  });
});

test("IMPORT: wrong columns are refused rather than guessed", async () => {
  const dir = await syntheticCopy();
  writeFileSync(join(dir, SHEETS.marks.file), "file,score\na.pdf,60\n");
  assert.throws(() => loadDataset(dir), /wrong columns\.[\s\S]*Missing: document_id/);
});

test("IMPORT: a finding reviewed before the adviser's blind mark is refused", async () => {
  const dir = await syntheticCopy();
  const lines = sheetLines(dir, SHEETS.findingReviews);
  writeFileSync(join(dir, SHEETS.findingReviews.file), `${[lines[0], lines[1].replace(/2026-11-07/, "2020-01-01"), ...lines.slice(2)].join("\n")}\n`);
  assert.throws(() => loadDataset(dir), /reviewed before this adviser's blind mark/);
});

test("IMPORT: an email in a note is refused, without repeating it", async () => {
  const dir = await syntheticCopy();
  const lines = sheetLines(dir, SHEETS.marks);
  writeFileSync(join(dir, SHEETS.marks.file), `${[lines[0], `${lines[1].replace(/,$/, ",this is amara@example.ac.uk")}`, ...lines.slice(2)].join("\n")}\n`);
  assert.throws(() => loadDataset(dir), (e: Error) => /seems to hold personal data \(email\)/.test(e.message) && !e.message.includes("amara@"));
});

test("IMPORT: any change to a mark changes the dataset hash", async () => {
  const dir = await syntheticCopy();
  const before = loadDataset(dir).dataHash;
  const lines = sheetLines(dir, SHEETS.marks);
  const cells = lines[1].split(",");
  cells[2] = String(Number(cells[2]) === 50 ? 51 : 50);
  writeFileSync(join(dir, SHEETS.marks.file), `${[lines[0], cells.join(","), ...lines.slice(2)].join("\n")}\n`);
  assert.notEqual(loadDataset(dir).dataHash, before);
});

test("importing a returned sheet: filled rows go in, blanks are counted, and a bad sheet leaves the old file untouched", async () => {
  const dir = await syntheticCopy();
  const ds = loadDataset(dir);
  const fresh = ds.documents.filter((d) => d.variant_kind.startsWith("adversarial_")).slice(0, 3).map((d) => d.id);
  const returned = join(tempDir(), "back.csv");
  const head = SHEETS.marks.columns.join(",");
  writeFileSync(returned, `${head}\n${fresh[0]},SYNTH-A,61,,,,,,no,2027-01-01,\n${fresh[1]},SYNTH-A,,,,,,,,,\n`);
  const before = ds.marks.length;
  assert.deepEqual(importSheet(dir, "marks", returned), { added: 1, leftBlank: 1 });
  assert.equal(loadDataset(dir).marks.length, before + 1);

  const snapshot = readFileSync(join(dir, SHEETS.marks.file), "utf8");
  writeFileSync(returned, `${head}\n${fresh[2]},SYNTH-A,999,,,,,,no,2027-01-01,\n`);
  assert.throws(() => importSheet(dir, "marks", returned), /from 0 to 100/);
  assert.equal(readFileSync(join(dir, SHEETS.marks.file), "utf8"), snapshot, "all or nothing");
});

test("BLIND: a marking sheet holds document ids and blanks, with no score anywhere, in an order that differs per adviser", async () => {
  const dir = await syntheticCopy();
  const paths = writeMarkingSheets(loadDataset(dir));
  assert.equal(paths.length, 3);
  const [a, b] = paths.map((p) => parseCsv(readFileSync(p, "utf8"), 100_000));
  assert.deepEqual(a[0], [...SHEETS.marks.columns] as string[]);
  const col = (n: string) => a[0].indexOf(n);
  for (const r of a.slice(1)) for (const c of ["overall_mark", "impact", "clarity", "saw_offerpath_output", "marked_at"]) assert.equal(r[col(c)], "");
  assert.ok(!a[0].some((c) => /score|offerpath$/i.test(c)));
  assert.notDeepEqual(a.slice(1).map((r) => r[0]), b.slice(1).map((r) => r[0]));
  assert.ok(!a.slice(1).some((r) => /-x$/.test(r[0])), "adversarial variants aren't sent to advisers to mark");
});

test("BLIND: findings stay hidden until that adviser's marks are in, and held-out findings until the freeze", async () => {
  const dir = await syntheticSplit();
  await assert.rejects(writeFindingSheets(loadDataset(dir), "heldout", rulesPredictor()), /Freeze the engine/);
  const lines = sheetLines(dir, SHEETS.marks);
  writeFileSync(join(dir, SHEETS.marks.file), `${lines.filter((l) => !l.includes(",SYNTH-B,")).join("\n")}\n`);
  writeFileSync(join(dir, SHEETS.findingReviews.file), `${sheetLines(dir, SHEETS.findingReviews).filter((l) => !l.includes(",SYNTH-B,")).join("\n")}\n`);
  await assert.rejects(writeFindingSheets(loadDataset(dir), "development", rulesPredictor()), (e: Error) => e instanceof CalibrationRefusal && /SYNTH-B has \d+ blind marks still to return/.test(e.message));
});

test("BLIND: a findings sheet has what the app said and no score", async () => {
  const dir = await syntheticSplit();
  const ds = loadDataset(dir);
  const [path] = await writeFindingSheets(ds, "development", rulesPredictor());
  const [head, ...rows] = parseCsv(readFileSync(path, "utf8"), 100_000);
  assert.deepEqual(head, [...SHEETS.findingReviews.columns] as string[]);
  assert.ok(rows.length > 0);
  assert.ok(!head.some((c) => /score|mark/i.test(c)));
  const said = head.indexOf("what_the_app_said");
  assert.ok(rows.every((r) => r[said]?.length > 0));
  for (const c of ["verdict", "severity", "reviewed_at"]) assert.ok(rows.every((r) => !r[head.indexOf(c)]), c);
  assert.ok(!rows.some((r) => /readiness score|overall score/i.test(r[said])), "no finding quotes the composite");
});

test("a rewrite sheet shows the original and the rewrite, and leaves the judgments blank", async () => {
  const dir = await syntheticCopy();
  const [path] = writeRewriteSheets(loadDataset(dir));
  const [head, ...rows] = parseCsv(readFileSync(path, "utf8"), 100_000);
  assert.ok(rows.every((r) => r[head.indexOf("source_line")] && r[head.indexOf("rewrite")] && !r[head.indexOf("factual_fidelity")]));
});

const RAW_CV = `Amara Okafor
amara.okafor@student.example.ac.uk | 07912 345678 | linkedin.com/in/amara-okafor-1234 | github.com/amaraok
12 Rose Street, Leeds, LS1 4AB
Date of birth: 3 March 2003

PROFILE
Economics student. Amara enjoys working with data. National Insurance: AB 12 34 56 C. Student ID: 20456712.

EDUCATION
BSc Economics, University of Leeds, 2022 – 2025

EXPERIENCE
Events Officer, Economics Society | Sep 2023 – Jun 2024
• Supported the committee with 12 careers events for 400 students.
• Raised £2,400 for a student-led charity week, beating the target by 20%.
• Worked with Dr Helen Marsh on a long-running survey of Okafor family businesses.

SKILLS
SQL, Excel, Tableau. Referee: Mr Tom Hale. British citizen. Member of the Islamic Society.
`;

test("ANONYMISE: identifiers go, the work stays, and what was found is logged without repeating it", () => {
  const r = anonymiseText(RAW_CV, "ab12", ["Amara Okafor"]);
  for (const gone of ["Amara", "Okafor", "amara.okafor", "07912", "amara-okafor", "github.com/amaraok", "Rose Street", "LS1 4AB", "3 March 2003", "AB 12 34 56 C", "20456712", "Helen Marsh", "Tom Hale"]) assert.ok(!r.text.includes(gone), `${gone} survived:\n${r.text}`);
  for (const kept of ["Supported the committee with 12 careers events for 400 students.", "£2,400", "BSc Economics", "long-running"]) assert.ok(r.text.includes(kept), kept);
  assert.deepEqual(scanPii(r.text), [], "the tool's own placeholders pass its own scan");
  assert.ok(!JSON.stringify(r.replaced).match(/Amara|07912|Rose/), "the log carries categories and lines only");
  const flagged = r.review.map((h) => h.category);
  for (const c of ["university or school named", "references or referee", "nationality or immigration status", "religion, ethnicity, politics or sexuality"]) assert.ok(flagged.includes(c), c);
});

test("ANONYMISE: a surname that is also a word survives in lower case", () => {
  const r = anonymiseText("Grace Long\n\nWorked long shifts for Long Ltd.\n", "x", []);
  assert.ok(r.text.includes("long shifts"));
  assert.ok(!r.text.includes("Long Ltd"));
});

test("ANONYMISE: replacing contact details doesn't move the engine's score, because placeholders keep their shape", () => {
  const r = anonymiseText(RAW_CV, "ab12", ["Amara Okafor"]);
  assert.equal(analyseCv(r.text, "Finance and banking").score, analyseCv(RAW_CV, "Finance and banking").score);
});

test("ANONYMISE: the scan catches each kind of leftover", () => {
  const cats = (t: string) => scanPii(t).map((h) => h.category);
  assert.deepEqual(cats("mail me at someone@real.co.uk"), ["email"]);
  assert.deepEqual(cats("call 07912 345678"), ["phone"]);
  assert.deepEqual(cats("in LS1 4AB"), ["postcode"]);
  assert.deepEqual(cats("see linkedin.com/in/real-person"), ["LinkedIn link"]);
  assert.deepEqual(cats("candidate.ab@example.invalid 07700 900000 linkedin.com/in/candidate-ab AA1 1AA"), []);
  assert.deepEqual(cats("Raised £2,400 in 2024 for 400 students."), [], "ordinary CV figures aren't identifiers");
});

async function intake() {
  const root = tempDir();
  const raw = join(root, "raw");
  mkdirSync(raw);
  writeFileSync(join(raw, "amara.txt"), RAW_CV);
  writeFileSync(join(raw, "amara-v2.txt"), RAW_CV.replace("12 careers", "14 careers"));
  const path = join(root, "intake.csv");
  writeFileSync(path, `${INTAKE_COLUMNS.join(",")}\namara.txt,person-1,Economics,finalist,one-column,medium,original,,CONSENT-001,Amara Okafor\namara-v2.txt,person-1,Economics,finalist,one-column,medium,revision,amara.txt,CONSENT-002,Amara Okafor\n`);
  return { root, raw, path, out: join(root, "dataset"), key: join(root, "steward", "key.json") };
}

test("ANONYMISE: the workflow writes clean documents, keeps the key apart, and the result can't be used until a person signs it off", async () => {
  const w = await intake();
  const r = await anonymiseIntake({ intake: w.path, raw: w.raw, out: w.out, keyOut: w.key, name: "test", version: "1" });
  assert.equal(r.documents, 2);
  assert.equal(r.scoreChanges, 0);
  assert.ok(r.flagged > 0);
  const manifest = JSON.parse(readFileSync(join(w.out, "manifest.json"), "utf8"));
  assert.equal(manifest.documents[0].group, manifest.documents[1].group, "one person, one group");
  assert.ok(!/person-1|amara/i.test(JSON.stringify(manifest)), "no label or file name from intake survives in the manifest");
  assert.equal(manifest.documents[1].variant_of, manifest.documents[0].id);
  for (const d of manifest.documents) assert.ok(!/Amara|Okafor|07912/.test(readFileSync(join(w.out, d.file), "utf8")));
  assert.ok(!/Amara|Okafor|07912|LS1/.test(readFileSync(r.log, "utf8")), "the log repeats nothing");
  assert.ok(/amara\.txt/.test(readFileSync(w.key, "utf8")), "the key is what links them, for withdrawals");
  assert.ok(!existsSync(join(w.out, "key.json")));

  assert.throws(() => loadDataset(w.out), /anonymisation_reviewed_by is required/);
  editManifest(w.out, (m) => m.documents.forEach((d) => (d.anonymisation_reviewed_by = "AB")));
  const ds = loadDataset(w.out);
  assert.deepEqual(await realDataProblems(ds, await readAllTexts(ds)), []);
});

test("ANONYMISE: the key can't go in the dataset, consent is required, and a dataset isn't overwritten", async () => {
  const w = await intake();
  await assert.rejects(anonymiseIntake({ intake: w.path, raw: w.raw, out: w.out, keyOut: join(w.out, "key.json"), name: "t", version: "1" }), /can't be stored inside the dataset/);
  await assert.rejects(anonymiseIntake({ intake: w.path, raw: w.raw, out: join(w.raw, "in"), keyOut: w.key, name: "t", version: "1" }), /inside the folder of raw CVs/);
  const noConsent = join(w.root, "no-consent.csv");
  writeFileSync(noConsent, readFileSync(w.path, "utf8").replace("CONSENT-001", ""));
  await assert.rejects(anonymiseIntake({ intake: noConsent, raw: w.raw, out: join(w.root, "d2"), keyOut: w.key, name: "t", version: "1" }), /No consent record, no use/);
  await anonymiseIntake({ intake: w.path, raw: w.raw, out: w.out, keyOut: w.key, name: "t", version: "1" });
  await assert.rejects(anonymiseIntake({ intake: w.path, raw: w.raw, out: w.out, keyOut: w.key, name: "t", version: "1" }), /already holds a dataset/);
});

test("ANONYMISE: leftover details and missing sign-off stop real data at validation", async () => {
  const w = await intake();
  await anonymiseIntake({ intake: w.path, raw: w.raw, out: w.out, keyOut: w.key, name: "t", version: "1" });
  editManifest(w.out, (m) => m.documents.forEach((d) => (d.anonymisation_reviewed_by = "AB")));
  const manifest = loadDataset(w.out).documents[0];
  writeFileSync(join(w.out, manifest.file), `${readFileSync(join(w.out, manifest.file), "utf8")}\nContact: leftover@real.co.uk\n`);
  const ds = loadDataset(w.out);
  const problems = await realDataProblems(ds, await readAllTexts(ds));
  assert.ok(problems.some((p) => /possible email left in/.test(p)));
  assert.ok(!problems.join().includes("leftover@"), "the refusal doesn't repeat what it found");
});

test("ANONYMISE: an author left in Word file properties is caught, and an empty one isn't", async () => {
  const dir = tempDir();
  const docx = async (name: string, core: string) => {
    const zip = new JSZip();
    zip.file("docProps/core.xml", core);
    const path = join(dir, name);
    writeFileSync(path, await zip.generateAsync({ type: "nodebuffer" }));
    return path;
  };
  assert.equal((await documentMetadataProblems(await docx("a.docx", "<cp:coreProperties><dc:creator>A Person</dc:creator></cp:coreProperties>"))).length, 1);
  assert.deepEqual(await documentMetadataProblems(await docx("b.docx", "<cp:coreProperties><dc:creator></dc:creator></cp:coreProperties>")), []);
  const pdf = join(dir, "c.pdf");
  writeFileSync(pdf, "%PDF-1.4 /Author (A Person)");
  assert.equal((await documentMetadataProblems(pdf)).length, 1);
});

test("real data needs independent reviewers, a consent reference and no relabelled fixtures", async () => {
  const dir = await syntheticCopy();
  editManifest(dir, (m) => {
    m.kind = "real";
    m.documents[0].consent_ref = "";
  });
  assert.throws(() => loadDataset(dir), /consent_ref is required/);
});

test("a thresholds file for real data is refused at freeze without the partner's name", async () => {
  const dir = await syntheticSplit();
  const t = { ...syntheticThresholds(), gates: syntheticThresholds().gates.slice(1) };
  await assert.rejects(freezeDataset(loadDataset(dir), t, rulesPredictor()), (e: Error) => e instanceof CalibrationRefusal && /required gate missing/.test(e.message));
});

test("OP-015 PACK: the blind sheet holds no author label, and the labels go in a separate file", () => {
  const out = tempDir();
  const pack = writeOp015Pack(out);
  assert.ok(pack.items >= 100, `the OP-015 fixtures hold over a hundred cases: got ${pack.items}`);
  const text = readFileSync(pack.sheet, "utf8");
  const [head, ...rows] = parseCsv(text, 100_000);
  assert.deepEqual(head, [...OP015_COLUMNS] as string[]);
  assert.equal(rows.length, pack.items);
  assert.ok(!/invention|expect|category|author/i.test(head.join()));
  assert.ok(!/invention/i.test(text));
  assert.ok(rows.every((r) => !r[head.indexOf("factual_fidelity")]));
  const ids = rows.map((r) => r[0]);
  assert.deepEqual(ids, [...ids].sort(), "ordered by content hash, so written order can't reveal the label");
  assert.ok(pack.key.includes("DO-NOT-SEND"));
  const labels = JSON.parse(readFileSync(pack.key, "utf8")).labels as Record<string, string>;
  assert.equal(new Set(Object.values(labels)).size, 2);
});

test("OP-015 COMPARE: reviewers decide, disagreement with the author shows, and synthetic reviewers are labelled", () => {
  const out = tempDir();
  const pack = writeOp015Pack(out);
  const labels = JSON.parse(readFileSync(pack.key, "utf8")).labels as Record<string, string>;
  const [head, ...rows] = parseCsv(readFileSync(pack.sheet, "utf8"), 100_000);
  const at = (c: string) => head.indexOf(c);
  const faithful = rows.filter((r) => labels[r[0]] === "faithful");
  const invention = rows.filter((r) => labels[r[0]] === "invention");
  // A synthetic reviewer who agrees with the author, except for flipping one faithful item.
  const fill = (r: string[], v: string) => { const c = [...r]; c[at("reviewer_id")] = "SYNTH-A"; c[at("factual_fidelity")] = v; return c; };
  const sheet = [head, fill(faithful[0], "invented"), ...faithful.slice(1).map((r) => fill(r, "faithful")), ...invention.map((r) => fill(r, "invented"))];
  const result = compareOp015(sheet.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n"));
  assert.match(result.banner, /^SYNTHETIC, NOT VALIDATION/);
  assert.match(result.banner, /NOT VALIDATION OF LIVE REWRITES/);
  assert.equal(result.items_reviewed, rows.length);
  assert.equal(result.author_disagreements.length, 1);
  assert.equal(result.author_disagreements[0].item, faithful[0][0]);
  assert.ok(result.check_missed_inventions.of === invention.length + 1);
  assert.ok(result.check_missed_inventions.ci);
  assert.throws(() => compareOp015("item_id\nx\n"), ImportError);
});
