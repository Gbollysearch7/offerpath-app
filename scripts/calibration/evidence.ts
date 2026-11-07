import { DEMO_CVS } from "@/lib/seed-data";
import { normaliseText } from "@/lib/analysis/fingerprint";

// What a calibration result is allowed to call itself. Every report, table row and exit message reads from here.

export type DatasetKind = "real" | "synthetic" | "illustrative";

export const TOOL_VERSION = "calibration-tool-2026-11-07.1";

export const SYNTHETIC_BANNER = "SYNTHETIC, NOT VALIDATION";
export const ILLUSTRATIVE_BANNER = "ILLUSTRATIVE DEMO MARKS, NOT VALIDATION";
export const DEVELOPMENT_BANNER = "DEVELOPMENT DATA, NOT VALIDATION";

export const HUMAN_GATES = [
  "Recruit qualified, independent careers advisers (human gate: this tool cannot do it).",
  "Obtain consented, anonymised applications: at least 30 independent CV groups (human gate).",
  "Agree thresholds with the pilot partner before anyone inspects held-out results (human gate).",
] as const;

/** Refused because accepting it would pass something off as evidence it is not. Exit code 3. */
export class CalibrationRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalibrationRefusal";
  }
}

/**
 * The illustrative marks that `--demo` has always used. Made up so the report's layout can be seen without real data.
 * They live here, in one place, and nothing writes them into a dataset. The demo CVs are also four versions of one
 * person's CV: one independent group, however many rows they fill.
 */
export const ILLUSTRATIVE_DEMO_MARKS: readonly number[] = Object.freeze([48, 57, 69, 80]);

export const illustrativeDemoItems = () => DEMO_CVS.map((c, i) => ({ id: c.fileName, text: c.text, mark: ILLUSTRATIVE_DEMO_MARKS[i] }));

const SHINGLE = 5;

/** Word 5-grams of normalised text: stable across re-exports, and insensitive to moved sections. */
export function shingles(text: string): Set<string> {
  const words = normaliseText(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE <= words.length; i++) out.add(words.slice(i, i + SHINGLE).join(" "));
  return out;
}

/** Share of the smaller text's shingles found in the other. A shortened variant still scores high against its original. */
export function overlap(a: Set<string>, b: Set<string>): number {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  if (!small.size) return 0;
  let hit = 0;
  for (const s of small) if (big.has(s)) hit++;
  return hit / small.size;
}

export const NEAR_DUPLICATE_AT = 0.5;

/** Demo CVs relabelled as real, whole or lightly edited. A `kind` field alone is only a claim, so check the text. */
export function matchesDemoCv(text: string): string | null {
  const s = shingles(text);
  for (const c of DEMO_CVS) if (overlap(s, shingles(c.text)) >= NEAR_DUPLICATE_AT) return c.fileName;
  return null;
}
