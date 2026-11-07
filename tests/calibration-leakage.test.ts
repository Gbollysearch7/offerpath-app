import assert from "node:assert/strict";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ImportError, loadDataset, SHEETS } from "../scripts/calibration/dataset";
import { readAllTexts, rulesPredictor } from "../scripts/calibration/engine";
import { CalibrationRefusal, shingles, overlap } from "../scripts/calibration/evidence";
import { evaluate } from "../scripts/calibration/run";
import { assignGroups, createSplit, docsInSplit, leakageProblems, nearDuplicatesAcrossGroups, readSplit, SPLIT_FILE, type SplitLock } from "../scripts/calibration/split";
import { editManifest, syntheticCopy, syntheticSplit, textsOf } from "./fixtures/calibration-helpers";

const lockOf = (dir: string) => JSON.parse(readFileSync(join(dir, SPLIT_FILE), "utf8")) as SplitLock;

test("LEAKAGE: every group, with all its variants, sits on exactly one side of the split", async () => {
  const dir = await syntheticSplit();
  const ds = loadDataset(dir);
  const lock = lockOf(dir);
  const sides = new Map<string, Set<string>>();
  for (const d of ds.documents) sides.set(d.group, (sides.get(d.group) ?? new Set()).add(lock.groups[d.group]));
  assert.equal(sides.size, 36);
  for (const [g, s] of sides) assert.equal(s.size, 1, `${g} crosses the split`);
  const byId = new Map(ds.documents.map((d) => [d.id, d]));
  const variants = ds.documents.filter((d) => d.variant_of);
  assert.ok(variants.length >= 36, "the fixture must really contain variants");
  for (const v of variants) assert.equal(lock.groups[v.group], lock.groups[byId.get(v.variant_of!)!.group]);
  const dev = new Set(docsInSplit(ds.documents, lock, "development").map((d) => d.id));
  const held = new Set(docsInSplit(ds.documents, lock, "heldout").map((d) => d.id));
  assert.equal(dev.size + held.size, ds.documents.length);
  assert.ok(dev.size && held.size);
  assert.ok(![...dev].some((id) => held.has(id)));
});

test("LEAKAGE: an unlabelled variant placed in its own group is caught, even reordered and lightly edited", async () => {
  const dir = await syntheticCopy();
  const ds = loadDataset(dir);
  const original = ds.documents.find((d) => d.variant_kind === "original")!;
  const text = readFileSync(join(dir, original.file), "utf8");
  // Sections moved, the name changed and one word altered: what a careless intake sheet would call a different CV.
  const sections = text.split("\n\n");
  const disguised = [sections[0].replace("Synthetic Candidate", "Different Person"), ...sections.slice(1).reverse()].join("\n\n").replace("student", "learner");
  writeFileSync(join(dir, "documents", "sneaky.txt"), disguised);
  editManifest(dir, (m) => m.documents.push({ ...original, id: "sneaky", file: "documents/sneaky.txt", group: "looks-like-someone-else", variant_kind: "original", variant_of: null }));
  const reloaded = loadDataset(dir);
  await assert.rejects(async () => createSplit(reloaded, await textsOf(reloaded)), (e: Error) => {
    assert.ok(e instanceof CalibrationRefusal);
    assert.match(e.message, /look like variants of one CV/, "caught before any split is made, whichever sides they would land on");
    assert.match(e.message, /sneaky/);
    assert.match(e.message, new RegExp(original.id));
    return true;
  });
});

test("LEAKAGE: a variant whose group differs from its original can't even be loaded", async () => {
  const dir = await syntheticCopy();
  editManifest(dir, (m) => {
    m.documents.find((d) => d.variant_of)!.group = "elsewhere";
  });
  assert.throws(() => loadDataset(dir), (e: Error) => e instanceof ImportError && /must share its original's group/.test(e.message));
});

test("LEAKAGE: a lock edited to send one group's variant across is refused at evaluation", async () => {
  const dir = await syntheticSplit();
  const ds = loadDataset(dir);
  const lock = lockOf(dir);
  // A second group id, for the variant only, on the other side. The manifest has to change too, so its base must move.
  const v = ds.documents.find((d) => d.variant_kind === "adversarial_keyword_stuffing")!;
  const other = lock.groups[v.group] === "heldout" ? "development" : "heldout";
  lock.groups["split-off"] = other;
  writeFileSync(join(dir, SPLIT_FILE), JSON.stringify(lock));
  editManifest(dir, (m) => {
    const entry = m.documents.find((d) => d.id === v.id)!;
    entry.group = "split-off";
    entry.variant_of = null;
    entry.variant_kind = "original";
  });
  const changed = loadDataset(dir);
  await assert.rejects(evaluate(changed, { split: "development", predictor: rulesPredictor(), iterations: 20 }), (e: Error) => e instanceof CalibrationRefusal && /share \d+% of their wording and sit on opposite sides/.test(e.message));
});

test("leakageProblems names a group that is on both sides, unknown groups and cross-split variants", () => {
  const doc = (id: string, group: string, variant_of: string | null = null) => ({ id, group, variant_of, file: "", discipline: "d", career_stage: "c", document_style: "s", writing_strength: "w", variant_kind: "original" as const, consent_ref: "", anonymisation_reviewed_by: "" });
  assert.deepEqual(leakageProblems([doc("a", "g1"), doc("b", "g1", "a")], { g1: "heldout" }), []);
  assert.match(leakageProblems([doc("a", "g1"), doc("b", "g2", "a")], { g1: "heldout", g2: "development" }).join(), /other side of the split/);
  assert.match(leakageProblems([doc("a", "nope")], {}).join(), /doesn't know/);
});

test("LEAKAGE: swapping a group to the other side by hand is refused, even though groups stay whole", async () => {
  const dir = await syntheticSplit();
  const lock = lockOf(dir);
  const [g] = Object.keys(lock.groups);
  lock.groups[g] = lock.groups[g] === "heldout" ? "development" : "heldout";
  writeFileSync(join(dir, SPLIT_FILE), JSON.stringify(lock));
  assert.throws(() => readSplit(loadDataset(dir)), /edited by hand/);
});

test("the lock holds: redoing a split, editing a document and adding one after splitting are all refused", async () => {
  const dir = await syntheticSplit();
  const ds = loadDataset(dir);
  await assert.rejects(async () => createSplit(ds, await textsOf(ds)), (e: Error) => e instanceof CalibrationRefusal && /never redone/.test(e.message));

  const doc = ds.documents[0];
  appendFileSync(join(dir, doc.file), "\nAn edit after the split.\n");
  assert.throws(() => readSplit(loadDataset(dir)), (e: Error) => e instanceof CalibrationRefusal && /changed after the split/.test(e.message));

  const dir2 = await syntheticSplit();
  const original = loadDataset(dir2).documents[0];
  writeFileSync(join(dir2, "documents", "late.txt"), "A completely different late document with its own words in it for the test.");
  editManifest(dir2, (m) => m.documents.push({ ...original, id: "late", file: "documents/late.txt", group: "late-group", variant_kind: "original", variant_of: null }));
  assert.throws(() => readSplit(loadDataset(dir2)), (e: Error) => e instanceof CalibrationRefusal && /added after the split/.test(e.message));
});

test("the split reads no marks and has no chosen seed: changing marks leaves it identical, and it is reproducible", async () => {
  const a = await syntheticCopy();
  const b = await syntheticCopy();
  writeFileSync(join(b, SHEETS.marks.file), `${SHEETS.marks.columns.join(",")}\n`);
  const [da, db] = [loadDataset(a), loadDataset(b)];
  const la = createSplit(da, await textsOf(da));
  const lb = createSplit(db, await textsOf(db));
  assert.deepEqual(la.groups, lb.groups);
  assert.equal(la.seed, da.documentsHash, "the seed comes from the documents, so seeds can't be tried until a split looks good");
});

test("each discipline with two or more groups lands on both sides, and a lone group stays in development", () => {
  const docs = ["a", "b", "c", "d", "e"].map((g) => ({ group: g, discipline: "Law" })).concat({ group: "lone", discipline: "Music" });
  const g = assignGroups(docs, "seed", 0.4);
  assert.equal(g.lone, "development");
  assert.equal(["a", "b", "c", "d", "e"].filter((x) => g[x] === "heldout").length, 2);
});

test("near-duplicate detection doesn't accuse unrelated CVs, and a person's confirmed pair is respected", async () => {
  const dir = await syntheticCopy();
  const ds = loadDataset(dir);
  const texts = await textsOf(ds);
  const inputs = ds.documents.map((d) => ({ id: d.id, group: d.group, discipline: d.discipline, text: texts.get(d.id)! }));
  assert.deepEqual(nearDuplicatesAcrossGroups(inputs), [], "36 separate synthetic people must not look like one");
  const same = "one two three four five six seven eight nine ten eleven twelve";
  assert.equal(overlap(shingles(same), shingles(`${same} thirteen`)), 1);
  const pair = [{ id: "x", group: "g1", discipline: "d", text: same }, { id: "y", group: "g2", discipline: "d", text: same }];
  assert.equal(nearDuplicatesAcrossGroups(pair).length, 1);
  assert.equal(nearDuplicatesAcrossGroups(pair, [{ a: "y", b: "x" }]).length, 0);
});

test("LEAKAGE: changing every held-out mark and review leaves every development figure identical", async () => {
  const a = await syntheticSplit();
  const ds = loadDataset(a);
  const lock = lockOf(a);
  const held = new Set(docsInSplit(ds.documents, lock, "heldout").map((d) => d.id));
  const before = await evaluate(ds, { split: "development", predictor: rulesPredictor(), iterations: 100, now: "2026-11-07T00:00:00Z" });

  for (const [spec, idColumn] of [[SHEETS.marks, 0], [SHEETS.findingReviews, 1]] as const) {
    const path = join(a, spec.file);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    const changed = lines.map((line, i) => {
      const cells = line.split(",");
      if (i === 0 || !held.has(cells[idColumn])) return line;
      if (spec === SHEETS.marks) cells[2] = "1";
      return cells.join(",");
    }).filter((line, i) => spec === SHEETS.marks || i === 0 || !held.has(line.split(",")[idColumn]));
    writeFileSync(path, `${changed.join("\n")}\n`);
  }
  const mutated = loadDataset(a);
  assert.notEqual(mutated.dataHash, ds.dataHash, "the mutation must really have changed the dataset");
  const after = await evaluate(mutated, { split: "development", predictor: rulesPredictor(), iterations: 100, now: "2026-11-07T00:00:00Z" });
  assert.deepEqual(after.metrics, before.metrics);
  assert.deepEqual(after.documents, before.documents);
});

test("a development run never scores a held-out document", async () => {
  const dir = await syntheticSplit();
  const ds = loadDataset(dir);
  const held = new Set(docsInSplit(ds.documents, lockOf(dir), "heldout").map((d) => d.id));
  const seen: string[] = [];
  const inner = rulesPredictor();
  await evaluate(ds, { split: "development", iterations: 20, predictor: (d, t) => { seen.push(d.id); return inner(d, t); } });
  assert.ok(seen.length > 0);
  assert.deepEqual(seen.filter((id) => held.has(id)), []);
});

test("a withdrawn group disappears from every figure while the rest of the split stands", async () => {
  const dir = await syntheticSplit();
  const ds = loadDataset(dir);
  const group = ds.documents[0].group;
  editManifest(dir, (m) => m.withdrawn_groups.push(group));
  const after = loadDataset(dir);
  assert.ok(!after.documents.some((d) => d.group === group));
  assert.ok(!after.marks.some((m) => ds.documents.find((d) => d.id === m.document_id)?.group === group));
  assert.ok(readSplit(after, new Map([...(await readAllTexts(after))].map(([id, t]) => [id, t.text]))));
});
