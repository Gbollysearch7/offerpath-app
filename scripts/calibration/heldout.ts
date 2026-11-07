import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha, type Dataset } from "./dataset";
import { CalibrationRefusal } from "./evidence";
import { thresholdProblems, type Thresholds } from "./gates";
import { SPLIT_FILE } from "./split";

// The rules that keep held-out data untouched. Thresholds and the engine are frozen first. Opening the data is written
// to a ledger before any held-out score exists. After that, only an exact repeat is allowed: a different engine,
// different thresholds or different data would be tuning against results somebody has already seen.
//
// This holds on an honest machine. Someone with the files could delete them, which is why the runbook has the frozen
// hash lodged with the pilot partner before opening. The check below only catches a ledger removed while reports remain.

export const FREEZE_FILE = "prereg.lock.json";
export const LEDGER_FILE = "heldout-ledger.jsonl";
export const REPORTS_DIR = "reports";

export interface Freeze {
  schema: "offerpath-calibration-freeze/1";
  frozen_at: string;
  thresholds: Thresholds;
  thresholds_hash: string;
  documents_hash: string;
  split_hash: string;
  engine_identity: string;
  extractor_version: string;
  development_scores_digest: string;
  /** Hashes of freezes replaced before anyone opened the data. Allowed, and left visible. */
  replaced: string[];
}

export interface LedgerEntry {
  seq: number;
  at: string;
  engine_identity: string;
  thresholds_hash: string;
  data_hash: string;
  prev: string;
  hash: string;
}

const entryHash = (e: Omit<LedgerEntry, "hash">) => sha(JSON.stringify([e.seq, e.at, e.engine_identity, e.thresholds_hash, e.data_hash, e.prev]));
export const thresholdsHash = (t: Thresholds) => sha(JSON.stringify(t));

export function readLedger(dir: string): LedgerEntry[] {
  const path = join(dir, LEDGER_FILE);
  const reports = join(dir, REPORTS_DIR);
  if (!existsSync(path)) {
    if (existsSync(reports) && readdirSync(reports).some((f) => f.startsWith("heldout-"))) throw new CalibrationRefusal(`A held-out report exists but ${LEDGER_FILE} is gone. The record of who opened this data can't be rebuilt, so treat the held-out set as spent.`);
    return [];
  }
  const entries = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LedgerEntry);
  entries.forEach((e, i) => {
    const prev = i ? entries[i - 1].hash : "start";
    if (e.prev !== prev || e.seq !== i + 1 || entryHash(e) !== e.hash) throw new CalibrationRefusal(`${LEDGER_FILE} was altered at entry ${i + 1}. Treat the held-out set as spent.`);
  });
  return entries;
}

export function readFreeze(dir: string): Freeze | null {
  const path = join(dir, FREEZE_FILE);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Freeze) : null;
}

export function writeFreeze(ds: Dataset, t: Thresholds, engine: { identity: string; extractor: string; digest: string }, now: string): Freeze {
  if (ds.manifest.kind === "illustrative") throw new CalibrationRefusal("Illustrative demo marks can't be pre-registered as validation.");
  const problems = thresholdProblems(t, ds.manifest);
  if (problems.length) throw new CalibrationRefusal(`Thresholds refused:\n  ${problems.join("\n  ")}`);
  if (readLedger(ds.dir).length) throw new CalibrationRefusal("Held-out data has already been opened. Thresholds and the engine can't be frozen again on it: it is no longer untouched. Use a new dataset with new held-out CVs.");
  const previous = readFreeze(ds.dir);
  const freeze: Freeze = {
    schema: "offerpath-calibration-freeze/1",
    frozen_at: now,
    thresholds: t,
    thresholds_hash: thresholdsHash(t),
    documents_hash: ds.documentsHash,
    split_hash: sha(readFileSync(join(ds.dir, SPLIT_FILE))),
    engine_identity: engine.identity,
    extractor_version: engine.extractor,
    development_scores_digest: engine.digest,
    replaced: previous ? [...previous.replaced, sha(JSON.stringify(previous))] : [],
  };
  writeFileSync(join(ds.dir, FREEZE_FILE), `${JSON.stringify(freeze, null, 2)}\n`);
  return freeze;
}

export type LookKind = "first" | "repeat";

/** Whether this look at held-out data is allowed. Refuses anything except a first look or an exact repeat of it. */
export function assessLook(ledger: LedgerEntry[], look: { engine_identity: string; thresholds_hash: string; data_hash: string }): LookKind {
  if (!ledger.length) return "first";
  const first = ledger[0];
  if (first.engine_identity !== look.engine_identity) throw new CalibrationRefusal(`HELD-OUT SPENT. It was opened on ${first.at} under engine ${first.engine_identity}, and this is ${look.engine_identity}. Anything changed after seeing those results was tuned on them, so this data can't test it. Evaluate the change on a new dataset with new held-out CVs.`);
  if (first.thresholds_hash !== look.thresholds_hash) throw new CalibrationRefusal(`HELD-OUT SPENT. It was opened on ${first.at} under different thresholds. Moving a threshold after seeing results is not allowed.`);
  if (first.data_hash !== look.data_hash) throw new CalibrationRefusal(`HELD-OUT SPENT. It was opened on ${first.at} on different data. Marks or documents changed after results were seen. The first report stands, with this recorded as a limitation.`);
  return "repeat";
}

export function appendLook(dir: string, ledger: LedgerEntry[], look: { engine_identity: string; thresholds_hash: string; data_hash: string }, at: string): LedgerEntry {
  const body = { seq: ledger.length + 1, at, ...look, prev: ledger.length ? ledger[ledger.length - 1].hash : "start" };
  const entry = { ...body, hash: entryHash(body) };
  appendFileSync(join(dir, LEDGER_FILE), `${JSON.stringify(entry)}\n`);
  return entry;
}
