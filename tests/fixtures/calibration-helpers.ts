import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDataset, type Dataset, type Manifest } from "../../scripts/calibration/dataset";
import { readAllTexts, rulesPredictor, type Predictor } from "../../scripts/calibration/engine";
import { createSplit } from "../../scripts/calibration/split";
import { buildSyntheticDataset } from "../../scripts/calibration/synthetic";

// Temporary copies of the invented dataset for tests. Everything lives under the OS temp folder and goes when the
// test process ends. Nothing here is real data, and no provider is reachable.

delete process.env.ANTHROPIC_API_KEY;

const made: string[] = [];
process.on("exit", () => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

export function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "offerpath-calibration-"));
  made.push(d);
  return d;
}

let base: Promise<string> | null = null;

/** A fresh, writable copy of the synthetic dataset, not yet split. */
export async function syntheticCopy(): Promise<string> {
  base ??= (async () => {
    const d = tempDir();
    await buildSyntheticDataset(d);
    return d;
  })();
  const copy = tempDir();
  cpSync(await base, copy, { recursive: true });
  return copy;
}

export const textsOf = async (ds: Dataset) => new Map([...(await readAllTexts(ds))].map(([id, t]) => [id, t.text]));

export async function syntheticSplit(): Promise<string> {
  const dir = await syntheticCopy();
  const ds = loadDataset(dir);
  createSplit(ds, await textsOf(ds));
  return dir;
}

export function editManifest(dir: string, edit: (m: Manifest) => void) {
  const path = join(dir, "manifest.json");
  const m = JSON.parse(readFileSync(path, "utf8")) as Manifest;
  edit(m);
  writeFileSync(path, JSON.stringify(m, null, 2));
}

/** The rule engine under another version name: what a tuned engine looks like to the tool. */
export const renamed = (identity: string, inner: Predictor = rulesPredictor()): Predictor => async (d, t) => ({ ...(await inner(d, t)), identity });

/** The rule engine with its numbers moved but its version name unchanged: an edit without a bump. */
export const silentlyChanged = (inner: Predictor = rulesPredictor()): Predictor => async (d, t) => {
  const p = await inner(d, t);
  return { ...p, score: Math.max(0, p.score - 7) };
};
