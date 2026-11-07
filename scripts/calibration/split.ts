import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { documentBytesHash, sha, type Dataset, type DocumentEntry } from "./dataset";
import { CalibrationRefusal, NEAR_DUPLICATE_AT, overlap, shingles } from "./evidence";

// The development / held-out split. It works on whole groups, reads no marks and no scores, and takes its seed from
// the documents, so nobody can try seeds until a flattering split turns up. Once written it does not change.

export type SplitName = "development" | "heldout";

export const SPLIT_FILE = "split.lock.json";
const DEFAULT_HELDOUT_SHARE = 0.4;

export interface SplitLock {
  schema: "offerpath-calibration-split/1";
  dataset: string;
  documents_hash: string;
  seed: string;
  heldout_share: number;
  groups: Record<string, SplitName>;
  /** The bytes each document had when the split was made. */
  document_hashes: Record<string, string>;
}

export interface SplitInput {
  id: string;
  group: string;
  discipline: string;
  text: string;
}

export interface NearDuplicate {
  a: string;
  b: string;
  overlap: number;
}

/** Pairs of documents in different groups that share too much wording: variants somebody labelled as different CVs. */
export function nearDuplicatesAcrossGroups(docs: SplitInput[], confirmed: { a: string; b: string }[] = []): NearDuplicate[] {
  const known = new Set(confirmed.flatMap((c) => [`${c.a}|${c.b}`, `${c.b}|${c.a}`]));
  const sets = docs.map((d) => shingles(d.text));
  const out: NearDuplicate[] = [];
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      if (docs[i].group === docs[j].group || known.has(`${docs[i].id}|${docs[j].id}`)) continue;
      const o = overlap(sets[i], sets[j]);
      if (o >= NEAR_DUPLICATE_AT) out.push({ a: docs[i].id, b: docs[j].id, overlap: Math.round(o * 1000) / 1000 });
    }
  }
  return out;
}

/** Assigns whole groups, balanced within each discipline. Given the same documents it gives the same answer. */
export function assignGroups(docs: Pick<SplitInput, "group" | "discipline">[], seed: string, heldoutShare = DEFAULT_HELDOUT_SHARE): Record<string, SplitName> {
  const stratumOf = new Map<string, string>();
  for (const d of [...docs].sort((a, b) => a.group.localeCompare(b.group) || a.discipline.localeCompare(b.discipline))) if (!stratumOf.has(d.group)) stratumOf.set(d.group, d.discipline);
  const strata = new Map<string, string[]>();
  for (const [g, s] of stratumOf) strata.set(s, [...(strata.get(s) ?? []), g]);
  const groups: Record<string, SplitName> = {};
  for (const [stratum, members] of [...strata].sort((a, b) => a[0].localeCompare(b[0]))) {
    const order = [...members].sort((a, b) => sha(`${seed}|${stratum}|${a}`).localeCompare(sha(`${seed}|${stratum}|${b}`)));
    // A discipline with two or more groups contributes to both sides, so held-out covers what development saw.
    const heldout = order.length < 2 ? 0 : Math.max(1, Math.min(order.length - 1, Math.round(order.length * heldoutShare)));
    order.forEach((g, i) => (groups[g] = i < heldout ? "heldout" : "development"));
  }
  return groups;
}

/** Every leak the lock can be checked for. An empty list is the only passing answer. */
export function leakageProblems(docs: DocumentEntry[], groups: Record<string, SplitName>, texts?: Map<string, string>, confirmed: { a: string; b: string }[] = []): string[] {
  const problems: string[] = [];
  const seen = new Map<string, Set<SplitName>>();
  const byId = new Map(docs.map((d) => [d.id, d]));
  for (const d of docs) {
    const side = groups[d.group];
    if (!side) problems.push(`Document ${d.id} is in group ${d.group}, which the split doesn't know.`);
    else seen.set(d.group, (seen.get(d.group) ?? new Set()).add(side));
    if (d.variant_of) {
      const base = byId.get(d.variant_of);
      if (base && groups[base.group] !== side) problems.push(`Document ${d.id} is a variant of ${base.id}, on the other side of the split.`);
    }
  }
  for (const [g, sides] of seen) if (sides.size > 1) problems.push(`Group ${g} is on both sides of the split.`);
  if (texts) {
    const inputs = docs.map((d) => ({ id: d.id, group: d.group, discipline: d.discipline, text: texts.get(d.id) ?? "" }));
    for (const n of nearDuplicatesAcrossGroups(inputs, confirmed)) {
      const x = byId.get(n.a)!, y = byId.get(n.b)!;
      if (groups[x.group] !== groups[y.group]) problems.push(`Documents ${n.a} and ${n.b} share ${Math.round(n.overlap * 100)}% of their wording and sit on opposite sides of the split.`);
    }
  }
  return problems;
}

export function createSplit(ds: Dataset, texts: Map<string, string>, heldoutShare = DEFAULT_HELDOUT_SHARE): SplitLock {
  const path = join(ds.dir, SPLIT_FILE);
  if (existsSync(path)) throw new CalibrationRefusal(`${SPLIT_FILE} already exists and a split is never redone. Collect new documents as a new dataset version in a new folder.`);
  const inputs = ds.documents.map((d) => ({ id: d.id, group: d.group, discipline: d.discipline, text: texts.get(d.id) ?? "" }));
  const near = nearDuplicatesAcrossGroups(inputs, ds.manifest.confirmed_distinct);
  if (near.length) {
    throw new CalibrationRefusal(`These documents look like variants of one CV but are in different groups, so a split could leak:\n  ${near.map((n) => `${n.a} and ${n.b} (${Math.round(n.overlap * 100)}% shared wording)`).join("\n  ")}\nPut them in one group. If a person has checked they are different people, list the pair under confirmed_distinct with a reason.`);
  }
  const seed = ds.documentsHash;
  const groups = assignGroups(ds.documents, seed, heldoutShare);
  const problems = leakageProblems(ds.documents, groups, texts, ds.manifest.confirmed_distinct);
  if (problems.length) throw new CalibrationRefusal(`Split refused:\n  ${problems.join("\n  ")}`);
  const lock: SplitLock = {
    schema: "offerpath-calibration-split/1",
    dataset: `${ds.manifest.name}@${ds.manifest.version}`,
    documents_hash: ds.documentsHash,
    seed,
    heldout_share: heldoutShare,
    groups,
    document_hashes: Object.fromEntries(ds.documents.map((d) => [d.id, documentBytesHash(ds.dir, d)])),
  };
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
  return lock;
}

/** Reads the lock and checks the dataset still is what was split. A withdrawn group may go; nothing may be added or changed. */
export function readSplit(ds: Dataset, texts?: Map<string, string>): SplitLock {
  const path = join(ds.dir, SPLIT_FILE);
  if (!existsSync(path)) throw new CalibrationRefusal(`No ${SPLIT_FILE} yet. Run: npm run calibrate -- split --dir ${ds.dir}`);
  const lock = JSON.parse(readFileSync(path, "utf8")) as SplitLock;
  const problems: string[] = [];
  for (const d of ds.documents) {
    const locked = lock.document_hashes[d.id];
    if (!locked) problems.push(`Document ${d.id} was added after the split.`);
    else if (locked !== documentBytesHash(ds.dir, d)) problems.push(`Document ${d.id} changed after the split.`);
  }
  // Assignments come only from the documents and their seed, so a hand-edited side or a moved group shows here. A
  // withdrawal changes the inputs legitimately, and then the per-document and leakage checks are what remains.
  if (!ds.manifest.withdrawn_groups.length) {
    if (lock.documents_hash !== ds.documentsHash) problems.push("Documents or their groups changed after the split.");
    const expected = assignGroups(ds.documents, lock.seed, lock.heldout_share);
    if (Object.keys(expected).some((g) => expected[g] !== lock.groups[g])) problems.push(`${SPLIT_FILE} doesn't hold the split these documents produce. It may have been edited by hand.`);
  }
  problems.push(...leakageProblems(ds.documents, lock.groups, texts, ds.manifest.confirmed_distinct));
  if (problems.length) throw new CalibrationRefusal(`The dataset no longer matches ${SPLIT_FILE}:\n  ${problems.join("\n  ")}`);
  return lock;
}

export const docsInSplit = (docs: DocumentEntry[], lock: SplitLock, split: SplitName) => docs.filter((d) => lock.groups[d.group] === split);
