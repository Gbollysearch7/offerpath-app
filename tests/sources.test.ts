// OP-006: students correct an uncertain reading before it is scored. Versions are immutable, a correction is a
// new version with provenance, what is scored is exactly that version's text, a repeated request never makes a
// second version or report, and nobody but the owner can read, download, correct or score a version.
//
// Every test runs the same flow (src/lib/cv-flow.ts, the logic behind the server actions) against both
// repositories: the demo store, and the Supabase repository over the in-memory PostgREST fake that models the
// migration's unique indexes and ownership triggers. Row-level security itself is tested in supabase/tests.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { applyEdits, assembleContent, contentBlocks } from "@/lib/analysis/content";
import { analyseCv } from "@/lib/analysis/cv";
import { documentMetaForText, TEXT_EXTRACTOR } from "@/lib/analysis/document";
import { extractDocument } from "@/lib/analysis/extract";
import { STAGES } from "@/lib/analysis/lexicon";
import { correctFlow, NOT_FOUND, pasteFlow, scoreFlow, uploadFlow } from "@/lib/cv-flow";
import { demoRepo } from "@/lib/repo/demo";
import { supabaseRepo } from "@/lib/repo/supabase";
import type { Repo } from "@/lib/repo/types";
import { checkDocument, PayloadError } from "@/lib/report-schema";
import { DEMO_CVS } from "@/lib/seed-data";
import { lineage } from "@/lib/sources";
import type { CvReviewPayload } from "@/lib/types";
import { fakeSupabase } from "./fixtures/fake-supabase";

// The rule engine scores in tests, as in demo mode: no model is called.
delete process.env.ANTHROPIC_API_KEY;

const SECTOR = "Technology";
const STAGE = STAGES[0];
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/extraction", name)));
const key = () => `t-${crypto.randomUUID()}`;
const json = (x: unknown) => JSON.stringify(x);

/** Two students on each repository. The Supabase pair share one fake database, as two accounts share one project. */
function pairs(): { name: string; a: Repo; b: Repo; fake?: ReturnType<typeof fakeSupabase> }[] {
  const fake = fakeSupabase();
  const [ua, ub] = [crypto.randomUUID(), crypto.randomUUID()];
  return [
    { name: "demo", a: demoRepo(`student-${crypto.randomUUID()}`, "student"), b: demoRepo(`student-${crypto.randomUUID()}`, "student") },
    { name: "supabase", a: supabaseRepo(fake.client, ua, () => fake.client), b: supabaseRepo(fake.client, ub, () => fake.client), fake },
  ];
}

const cvCount = async (repo: Repo) => (await repo.listReports({ type: "cv_review" })).total;
const upload = (repo: Repo, file: string, k = key()) => uploadFlow(repo, { bytes: fixture(file), fileName: file, sector: SECTOR, stage: STAGE, key: k });

/** Uploads a fixture that needs review and returns the held version. */
async function held(repo: Repo, file = "symbol-bullets.pdf") {
  const r = await upload(repo, file);
  assert.equal(r.kind, "review", `${file} is held for review`);
  if (r.kind !== "review") throw new Error("unreachable");
  return r.review;
}

/** The student's fix for symbol-bullets.pdf: the four lines whose tick decoded to "3" become bullet points again. */
function bulletFix(blocks: { id: string; text: string }[]) {
  return blocks.filter((b) => /^3 /.test(b.text)).map((b) => ({ id: b.id, text: `• ${b.text.slice(2)}` }));
}

test("a reading below high confidence is held for the student's check: nothing is scored until they act", async () => {
  for (const { name, a } of pairs()) {
    const before = await cvCount(a);
    for (const file of ["symbol-bullets.pdf", "mixed-scan.pdf", "academic.pdf", "table.docx"]) {
      const review = await held(a, file);
      const source = await a.getSource(review.sourceId);
      assert.ok(source && source.kind === "upload" && source.reportId === null && source.hasFile, `${name} ${file}: saved as an unscored upload`);
      assert.notEqual(review.reading.confidence.band, "high", `${name} ${file}`);
      assert.equal(assembleContent(review.blocks), assembleContent(contentBlocks(source.text)), `${name} ${file}: the review shows the version's own blocks`);
    }
    assert.equal(await cvCount(a), before, `${name}: no report was made for any held reading`);
    // A high reading is scored at once; a caution at high confidence is shown beside the score, not instead of it.
    const clean = await upload(a, "single-column.pdf");
    assert.ok(clean.kind === "scored" && !clean.showReading, `${name}: a clean reading goes straight to the report`);
    const twoCol = await upload(a, "two-column.pdf");
    assert.ok(twoCol.kind === "scored" && twoCol.showReading, `${name}: two columns (0.85, high, one caution) is scored and the reading shown first`);
  }
});

test("corrected text is exactly what is assessed, and the report points at the corrected version", async () => {
  for (const { name, a } of pairs()) {
    const review = await held(a);
    const upload = (await a.getSource(review.sourceId))!;
    const edits = bulletFix(review.blocks);
    assert.equal(edits.length, 4, "the fixture has four symbol-font lines");
    const r = await correctFlow(a, { sourceId: review.sourceId, blocks: edits, sector: SECTOR, stage: STAGE, key: key() });
    assert.ok("id" in r && r.changed === true, `${name}: ${json(r)}`);
    if (!("id" in r)) continue;
    const version = (await a.getSource(r.sourceId))!;
    const report = (await a.getReport<CvReviewPayload>(r.id))!;
    const expected = assembleContent(applyEdits(contentBlocks(upload.text), edits));
    const p = report.payload;
    // Byte for byte: the version's text, the text the report saved, and the text the edits stand for.
    assert.equal(version.text, expected, `${name}: the version holds the corrected text`);
    assert.equal(p.text, version.text, `${name}: the report saved exactly the version's text`);
    assert.ok(Buffer.from(p.text, "utf8").equals(Buffer.from(expected, "utf8")), `${name}: byte-identical`);
    // ...and that is the text that was scored: the analysis is analyseCv of it, nothing else.
    assert.equal(json(p.analysis), json(analyseCv(version.text, SECTOR)), `${name}: the analysis is of the corrected text`);
    assert.equal(p.analysis.meta.bullets, 4, `${name}: the four restored bullets were assessed`);
    for (const e of edits) assert.ok(p.analysis.lines.some((l) => l.text === e.text.slice(2)), `${name}: "${e.text.slice(2, 30)}…" was scored as a line`);
    // The hashes all name the same version.
    assert.equal(version.documentVersion, sha(version.text));
    assert.equal(p.document!.documentVersion, version.documentVersion, `${name}: document metadata names the scored version`);
    assert.equal(p.assessment.documentVersion, version.documentVersion, `${name}: findings name the scored version`);
    assert.equal(report.row.sourceId, version.id, `${name}: the report row links the version`);
    assert.equal(version.reportId, r.id);
    // Provenance: derived from which version, when, by whom, what changed.
    const src = p.document!.source;
    assert.ok(src.kind === "correction", `${name}: kind`);
    if (src.kind !== "correction") continue;
    assert.equal(version.parentId, upload.id, `${name}: parent link`);
    assert.equal(src.parentDocumentVersion, upload.documentVersion, `${name}: parent version hash`);
    assert.equal(src.by, "student");
    assert.ok(Math.abs(Date.parse(src.correctedAt) - Date.now()) < 60_000, `${name}: correctedAt is now`);
    assert.deepEqual(
      src.changes.map((c) => [c.block, c.kind, c.before, c.after]),
      edits.map((e) => [e.id, "line", review.blocks.find((b) => b.id === e.id)!.text, e.text]),
      `${name}: every changed block, before and after`,
    );
    assert.equal(p.document!.extraction.extractor, TEXT_EXTRACTOR, `${name}: no file was read for a correction`);
    assert.equal(p.document!.extraction.pages.provenance, "estimated", `${name}: typed text has no pages to count`);
    assert.equal(p.fileName, "symbol-bullets.pdf (corrected)");
    // The corrected text reads better than the file did, and says so on its own terms.
    assert.ok(p.document!.extraction.confidence.score > upload.document!.extraction.confidence.score, `${name}: the correction's reading is more confident`);
  }
});

test("the original upload stays as it was and its owner can still read and download it", async () => {
  for (const { name, a, fake } of pairs()) {
    const review = await held(a);
    const before = json(await a.getSource(review.sourceId));
    const rowBefore = fake ? json(fake.sources.find((s) => s.id === review.sourceId)) : null;
    const r = await correctFlow(a, { sourceId: review.sourceId, blocks: bulletFix(review.blocks), sector: SECTOR, stage: STAGE, key: key() });
    assert.ok("id" in r);
    if (!("id" in r)) continue;
    // A second correction made from the first one, so the lineage has three versions.
    const second = await correctFlow(a, { sourceId: r.sourceId, blocks: [{ id: "b0", text: "Alex Q. Example" }], sector: SECTOR, stage: STAGE, key: key() });
    assert.ok("id" in second && second.id !== r.id, `${name}: a correction of a correction is its own version and report`);
    if (!("id" in second)) continue;
    const original = (await a.getSource(review.sourceId))!;
    assert.equal(json(original), before, `${name}: the upload version is unchanged by its corrections`);
    if (fake) assert.equal(json(fake.sources.find((s) => s.id === review.sourceId)), rowBefore, `${name}: the stored row is untouched`);
    const file = await a.sourceFile(original.id);
    assert.ok(file, `${name}: the original file is retrievable`);
    assert.equal(sha(file!.bytes), sha(fixture("symbol-bullets.pdf")), `${name}: byte for byte the uploaded file`);
    assert.equal(sha(file!.bytes), original.document!.source.kind === "upload" ? original.document!.source.sha256 : "", `${name}: and the hash recorded when it was read`);
    assert.equal(await a.sourceFile(r.sourceId), null, `${name}: a correction has no file of its own`);
    const chain = lineage(await a.listSources(), second.sourceId);
    assert.deepEqual(chain.map((v) => v.id), [original.id, r.sourceId, second.sourceId], `${name}: the lineage runs upload → correction → correction`);
    assert.deepEqual(chain.map((v) => v.kind), ["upload", "correction", "correction"]);
    // Each report says which version it scored.
    assert.equal((await a.getReport(r.id))!.row.sourceId, r.sourceId);
    assert.equal((await a.getReport(second.id))!.row.sourceId, second.sourceId);
  }
});

test("a refresh, a double click or a retry never makes a second version or report", async () => {
  for (const { name, a } of pairs()) {
    const sources = async () => (await a.listSources()).length;
    // Upload: the same attempt key sent twice, in turn and at once.
    const k = key();
    const first = await upload(a, "symbol-bullets.pdf", k);
    const again = await upload(a, "symbol-bullets.pdf", k);
    assert.ok(first.kind === "review" && again.kind === "review" && first.review.sourceId === again.review.sourceId, `${name}: same key, same version`);
    const k2 = key();
    const both = await Promise.all([upload(a, "single-column.pdf", k2), upload(a, "single-column.pdf", k2)]);
    assert.ok(both[0].kind === "scored" && both[1].kind === "scored" && both[0].sourceId === both[1].sourceId && both[0].id === both[1].id, `${name}: a double click is one version and one report`);
    const afterUploads = await sources();
    const reportsAfterUploads = await cvCount(a);
    assert.equal(afterUploads, 2, `${name}: two uploads, two versions`);

    // Correction: same key twice; then a new key after a refresh lost it, with the same edits; then three at once.
    const blocks = bulletFix(first.kind === "review" ? first.review.blocks : []);
    const input = { sourceId: first.kind === "review" ? first.review.sourceId : "", blocks, sector: SECTOR, stage: STAGE };
    const c1 = await correctFlow(a, { ...input, key: "attempt-one-0000" });
    const c2 = await correctFlow(a, { ...input, key: "attempt-one-0000" });
    const c3 = await correctFlow(a, { ...input, key: key() });
    const many = await Promise.all([1, 2, 3].map(() => correctFlow(a, { ...input, key: key() })));
    const ids = new Set([c1, c2, c3, ...many].map((c) => ("id" in c ? `${c.sourceId}/${c.id}` : c.error)));
    assert.equal(ids.size, 1, `${name}: one corrected version and one report: ${[...ids]}`);
    assert.equal(await sources(), afterUploads + 1, `${name}: exactly one new version`);
    assert.equal(await cvCount(a), reportsAfterUploads + 1, `${name}: exactly one new report`);

    // Scoring a held version as it is, twice.
    const academic = await held(a, "academic.pdf");
    const s1 = await scoreFlow(a, academic.sourceId, SECTOR, STAGE);
    const s2 = await scoreFlow(a, academic.sourceId, SECTOR, STAGE);
    assert.ok("id" in s1 && "id" in s2 && s1.id === s2.id, `${name}: one report for a version scored twice`);

    // A reused key with different text is refused rather than answered with the earlier version.
    const conflict = await correctFlow(a, { ...input, blocks: [{ id: "b0", text: "Someone Else" }], key: "attempt-one-0000" });
    assert.ok("error" in conflict && /different text/.test(conflict.error), `${name}: ${json(conflict)}`);

    // Paste: the same attempt twice keeps one copy of the scan, one typed version and one report.
    const before = await sources();
    const pk = key();
    const typed = DEMO_CVS[3].text;
    const p1 = await pasteFlow(a, { text: typed, original: { bytes: fixture("scan.pdf"), fileName: "scan.pdf" }, sector: SECTOR, stage: STAGE, key: pk });
    const p2 = await pasteFlow(a, { text: typed, original: { bytes: fixture("scan.pdf"), fileName: "scan.pdf" }, sector: SECTOR, stage: STAGE, key: pk });
    assert.ok("id" in p1 && "id" in p2 && p1.id === p2.id && p1.sourceId === p2.sourceId, `${name}: paste retried is one report`);
    assert.equal(await sources(), before + 2, `${name}: the scan and the typed text, once each`);
  }
});

test("a retry after a failed save finishes the same attempt instead of starting another", async () => {
  for (const { name, a } of pairs()) {
    const review = await held(a);
    // The report write fails once, after the corrected version was saved (a dropped connection, a timeout).
    let fail = true;
    const flaky: Repo = {
      ...a,
      async createReport(input) {
        if (fail) {
          fail = false;
          throw new Error("connection reset");
        }
        return a.createReport(input);
      },
    };
    const input = { sourceId: review.sourceId, blocks: bulletFix(review.blocks), sector: SECTOR, stage: STAGE, key: key() };
    await assert.rejects(correctFlow(flaky, input), /connection reset/);
    const versions = (await a.listSources()).length;
    const reportsBefore = await cvCount(a);
    const retry = await correctFlow(flaky, input);
    assert.ok("id" in retry, `${name}: the retry succeeds`);
    assert.equal((await a.listSources()).length, versions, `${name}: the retry reused the saved version`);
    assert.equal(await cvCount(a), reportsBefore + 1, `${name}: and made the one report it was missing`);
    const again = await correctFlow(flaky, input);
    assert.ok("id" in again && "id" in retry && again.id === retry.id, `${name}: a further retry returns that report`);
  }
});

test("another student can't read, download, correct, score or descend from someone else's version", async () => {
  for (const { name, a, b, fake } of pairs()) {
    const review = await held(a);
    const corrected = await correctFlow(a, { sourceId: review.sourceId, blocks: bulletFix(review.blocks), sector: SECTOR, stage: STAGE, key: key() });
    assert.ok("id" in corrected);
    if (!("id" in corrected)) continue;
    const aSources = json(await a.listSources());
    const aReports = await cvCount(a);
    const rowsBefore = fake ? json(fake.sources) : null;
    for (const id of [review.sourceId, corrected.sourceId]) {
      assert.equal(await b.getSource(id), null, `${name}: B can't read A's version by id`);
      assert.equal(await b.sourceFile(id), null, `${name}: B can't download A's file by id`);
      assert.deepEqual(await scoreFlow(b, id, SECTOR, STAGE), { error: NOT_FOUND }, `${name}: B can't score A's version`);
      const r = await correctFlow(b, { sourceId: id, blocks: [{ id: "b0", text: "Mallory" }], sector: SECTOR, stage: STAGE, key: key() });
      assert.deepEqual(r, { error: NOT_FOUND }, `${name}: B can't submit a correction against A's version`);
      // Straight at the repository, past the flow: a version descended from A's, or a report scoring A's.
      const text = "Mallory\n" + DEMO_CVS[0].text;
      const document = documentMetaForText(text, { kind: "correction", parentDocumentVersion: "0".repeat(64), correctedAt: new Date().toISOString(), by: "student", changes: [{ block: "b0", kind: "line", where: "TOP OF CV", before: "x", after: "Mallory" }] });
      await assert.rejects(b.createSource({ kind: "correction", parentId: id, fileName: "x", text, document, outcome: null, idempotencyKey: key() }), /not found/i, `${name}: B can't descend from A's version`);
    }
    const stolen = (await a.getReport<CvReviewPayload>(corrected.id))!.payload;
    await assert.rejects(b.createReport({ type: "cv_review", title: "x", score: 1, payload: stolen, source: { id: corrected.sourceId, storagePath: null } }), /not found/i, `${name}: B can't attach a report to A's version`);
    assert.equal(await b.getReport(corrected.id), null, `${name}: nor read A's report`);
    assert.equal((await b.listSources()).length, 0, `${name}: B lists none of A's versions`);
    assert.equal(json(await a.listSources()), aSources, `${name}: A's versions are untouched`);
    assert.equal(await cvCount(a), aReports, `${name}: A's reports are untouched`);
    if (fake) assert.equal(json(fake.sources), rowsBefore, `${name}: no row was written`);
  }
});

test("an unreadable scan gets a usable path: typed text, scored, with the scan kept as the original", async () => {
  for (const { name, a } of pairs()) {
    const scan = await upload(a, "scan.pdf");
    assert.ok(scan.kind === "outcome" && scan.outcome.code === "image_only", `${name}: the scan is an outcome`);
    assert.equal((await a.listSources()).length, 0, `${name}: nothing is saved for an outcome on its own`);
    const typed = `${DEMO_CVS[2].text}\r\n\r\n\r\n`;
    const r = await pasteFlow(a, { text: typed, original: { bytes: fixture("scan.pdf"), fileName: "scan.pdf" }, sector: SECTOR, stage: STAGE, key: key() });
    assert.ok("id" in r, `${name}: ${json(r)}`);
    if (!("id" in r)) continue;
    const version = (await a.getSource(r.sourceId))!;
    const kept = (await a.getSource(version.parentId!))!;
    const p = (await a.getReport<CvReviewPayload>(r.id))!.payload;
    // What is scored is the typed text (line endings normalised, trailing blank lines trimmed), and nothing else.
    assert.equal(version.text, DEMO_CVS[2].text.trim());
    assert.equal(p.text, version.text, `${name}: the report saved exactly the typed version`);
    assert.equal(json(p.analysis), json(analyseCv(version.text, SECTOR)), `${name}: scored on the typed text`);
    assert.equal(p.assessment.documentVersion, sha(version.text));
    // The scan is the immutable parent, unreadable, with why; it is never scored.
    assert.ok(kept.kind === "upload" && kept.document === null && kept.text === "" && kept.outcome?.code === "image_only" && kept.hasFile, `${name}: ${json(kept)}`);
    assert.equal(sha((await a.sourceFile(kept.id))!.bytes), sha(fixture("scan.pdf")), `${name}: the scan is retrievable as uploaded`);
    assert.ok("error" in (await scoreFlow(a, kept.id, SECTOR, STAGE)), `${name}: a scan is never scored`);
    assert.ok("error" in (await correctFlow(a, { sourceId: kept.id, blocks: [], sector: SECTOR, stage: STAGE, key: key() })), `${name}: nor corrected`);
    const src = p.document!.source;
    assert.ok(src.kind === "paste" && src.by === "student" && src.original?.sha256 === sha(fixture("scan.pdf")) && src.original.outcome?.code === "image_only", `${name}: provenance names the scan`);
    // Typed text with no file at all is a version of its own.
    const bare = await pasteFlow(a, { text: DEMO_CVS[1].text, original: null, sector: SECTOR, stage: STAGE, key: key() });
    assert.ok("id" in bare);
    if ("id" in bare) assert.equal((await a.getSource(bare.sourceId))!.parentId, null);
    // Too little to assess fairly is refused before anything is saved.
    const count = (await a.listSources()).length;
    assert.ok("error" in (await pasteFlow(a, { text: "Alex Example", original: null, sector: SECTOR, stage: STAGE, key: key() })));
    assert.equal((await a.listSources()).length, count);
  }
});

test("blocks round-trip: unedited text reads and scores the same, and no edit makes no new version", async () => {
  const texts: [string, string][] = DEMO_CVS.map((c) => [`demo v${c.version}`, c.text]);
  for (const f of ["single-column.pdf", "two-column.pdf", "wrapped-bullets.pdf", "letter-spaced-headings.pdf", "repeated-header.pdf", "symbol-bullets.pdf", "academic.pdf", "mixed-scan.pdf", "blank-trailing-page.pdf", "table.docx"]) {
    texts.push([f, (await extractDocument(fixture(f), f)).text]);
  }
  for (const [n, text] of texts) {
    const before = analyseCv(text, SECTOR);
    const after = analyseCv(assembleContent(contentBlocks(text)), SECTOR);
    assert.deepEqual([after.score, after.meta.bullets, after.meta.words, after.lines.map((l) => l.text)], [before.score, before.meta.bullets, before.meta.words, before.lines.map((l) => l.text)], `${n}: re-assembled blocks score the same`);
  }
  for (const { name, a } of pairs()) {
    const review = await held(a, "academic.pdf");
    const versions = (await a.listSources()).length;
    // Fields sent back unchanged (or with only spacing changed) are no correction: the version as read is scored.
    const r = await correctFlow(a, { sourceId: review.sourceId, blocks: review.blocks.map((b) => ({ id: b.id, text: ` ${b.text}  ` })), sector: SECTOR, stage: STAGE, key: key() });
    assert.ok("id" in r && r.changed === false && r.sourceId === review.sourceId, `${name}: ${json(r)}`);
    assert.equal((await a.listSources()).length, versions, `${name}: no version was made`);
    // A block id from another version is refused as stale.
    const stale = await correctFlow(a, { sourceId: review.sourceId, blocks: [{ id: "b9999", text: "x" }], sector: SECTOR, stage: STAGE, key: key() });
    assert.ok("error" in stale && /changed since/.test(stale.error));
  }
});

test("version metadata is checked before it is saved: provenance has to fit the text and its kind", async () => {
  const text = DEMO_CVS[3].text;
  const source = { kind: "correction" as const, parentDocumentVersion: sha("parent"), correctedAt: "2026-11-05T10:00:00.000Z", by: "student" as const, changes: [{ block: "b3", kind: "bullet" as const, where: "EXPERIENCE", before: "a", after: "b" }] };
  const good = documentMetaForText(text, source);
  assert.equal(json(checkDocument(good, text)), json(good));
  const bad: [string, (d: typeof good) => void, RegExp][] = [
    ["a correction identical to its parent", (d) => (d.source as typeof source).parentDocumentVersion = d.documentVersion, /same text as the version it was made from/],
    ["a correction with no changes", (d) => ((d.source as typeof source).changes = []), /changes/],
    ["a correction claiming measured pages", (d) => Object.assign(d.extraction.pages, { measured: 2, provenance: "measured", starts: [0, 10] }), /no file to count pages/],
    ["by someone other than the student", (d) => ((d.source as unknown as { by: string }).by = "adviser"), /by/],
    ["a paste with a malformed file hash", (d) => (d.source = { kind: "paste", pastedAt: "2026-11-05T10:00:00.000Z", by: "student", original: { fileName: "scan.pdf", format: "pdf", bytes: 10, sha256: "nope", outcome: null } }), /sha256/],
    ["metadata for different text", (d) => (d.documentVersion = sha("other")), /different text/],
  ];
  for (const [why, edit, re] of bad) {
    const d = structuredClone(good);
    edit(d);
    assert.throws(() => checkDocument(d, text), (e: unknown) => e instanceof PayloadError && re.test(e.message), why);
  }
  // Both repositories run the same check before writing, and write nothing when it fails.
  for (const { name, a } of pairs()) {
    const d = structuredClone(good);
    d.documentVersion = sha("other");
    await assert.rejects(a.createSource({ kind: "paste", parentId: null, fileName: "x", text, document: d, outcome: null, idempotencyKey: key() }), PayloadError, name);
    assert.equal((await a.listSources()).length, 0, `${name}: nothing saved`);
  }
});

test("a lineage lists each version after its parent even when two saves share a timestamp", () => {
  const at = "2026-11-05T10:00:00.000Z";
  const v = (id: string, parentId: string | null, createdAt = at) => ({ id, parentId, createdAt }) as unknown as Parameters<typeof lineage>[0][number];
  // Ids chosen so that sorting by (time, id) alone would put every child before its parent.
  const all = [v("z-upload", null), v("m-first", "z-upload"), v("a-second", "m-first"), v("b-sibling", "z-upload", "2026-11-05T10:00:01.000Z"), v("other", null)];
  assert.deepEqual(lineage(all, "a-second").map((s) => s.id), ["z-upload", "m-first", "a-second", "b-sibling"]);
  assert.deepEqual(lineage(all, "other").map((s) => s.id), ["other"]);
  assert.deepEqual(lineage(all, "missing"), []);
});
