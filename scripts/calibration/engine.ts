import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { analyseCv } from "@/lib/analysis/cv";
import { scoreCoverage, type CoverageStatus } from "@/lib/analysis/coverage";
import { documentMeta } from "@/lib/analysis/document";
import { EXTRACTOR_VERSION, extractDocument } from "@/lib/analysis/extract";
import { cvAssessment } from "@/lib/analysis/findings";
import { AI_JUDGE_CONFIG } from "@/lib/analysis/judgment";
import { memoryStore, scoreCvWith, type JudgeFn, type JudgmentStore, type StoredJudgment } from "@/lib/scoring-core";
import type { CvAnalysis } from "@/lib/types";
import { sha, type Dataset, type DocumentEntry } from "./dataset";

// Reads the engine and never changes it. A predictor turns a document into what the app would say about it.

export const DEFAULT_SECTOR = "Finance and banking";

export interface PredictedFinding {
  /** `${document}:${check}`, which is what the adviser's review sheet refers to. */
  id: string;
  check: string;
  severity: "high" | "medium" | "low" | "info";
  explanation: string;
  action: string | null;
  quotes: string[];
}

export interface Prediction {
  documentId: string;
  score: number;
  coverage: CoverageStatus;
  areas: Record<string, number>;
  findings: PredictedFinding[];
  identity: string;
}

export interface DocumentText {
  text: string;
  /** Extraction confidence. Null for plain text, which isn't extracted. */
  band: "high" | "medium" | "low" | null;
}

export type Predictor = (doc: DocumentEntry, input: DocumentText) => Promise<Prediction> | Prediction;

export async function readDocumentText(dir: string, doc: DocumentEntry): Promise<DocumentText> {
  const path = join(dir, doc.file);
  if (!existsSync(path)) throw new Error(`Missing document: ${doc.file}`);
  const bytes = new Uint8Array(readFileSync(path));
  if (extname(doc.file).toLowerCase() === ".txt") return { text: Buffer.from(bytes).toString("utf8"), band: null };
  const extracted = await extractDocument(bytes, doc.file);
  return { text: extracted.text, band: documentMeta(extracted, bytes).extraction.confidence.band };
}

export async function readAllTexts(ds: Dataset): Promise<Map<string, DocumentText>> {
  const out = new Map<string, DocumentText>();
  for (const d of ds.documents) out.set(d.id, await readDocumentText(ds.dir, d));
  return out;
}

export function predictionFrom(doc: DocumentEntry, input: DocumentText, a: CvAnalysis): Prediction {
  const identity = a.meta.scoring?.identity;
  if (!identity) throw new Error("The engine returned no scoring identity, so a report could not say what it measured.");
  const findings = cvAssessment(a, input.text).findings
    .filter((f) => f.status === "needs_attention")
    .map((f): PredictedFinding => ({ id: `${doc.id}:${f.check}`, check: f.check, severity: f.severity, explanation: f.explanation, action: f.action, quotes: f.evidence.map((e) => e.quote).slice(0, 5) }));
  return {
    documentId: doc.id,
    score: a.score,
    coverage: scoreCoverage({ bullets: a.meta.bullets, band: input.band }).status,
    areas: Object.fromEntries(a.areas.map((x) => [x.key, x.score])),
    findings,
    identity,
  };
}

/** The deterministic rule engine, with no provider and no network. */
export const rulesPredictor = (sector = DEFAULT_SECTOR): Predictor => (doc, input) => predictionFrom(doc, input, analyseCv(input.text, sector));

/** The judged path. `judge` is injected, so tests exercise it without a provider; only the CLI can pass the real one. */
export const judgedPredictor = (judge: JudgeFn, judgeName: string, sector = DEFAULT_SECTOR, store: JudgmentStore = memoryStore()): Predictor => {
  return async (doc, input) => predictionFrom(doc, input, (await scoreCvWith(input.text, sector, { method: "ai", store, judge, judgeName, quorum: AI_JUDGE_CONFIG.quorum })).analysis);
};

/**
 * Verdicts kept on disk, first write wins, as the product's cache behaves. Without it a judged score would change
 * between runs, a freeze could never be matched, and every repeat would pay for the same judgments again.
 */
export function fileJudgmentStore(path: string): JudgmentStore {
  const load = (): Record<string, StoredJudgment> => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {});
  return {
    async get(keys) {
      const all = load();
      return new Map(keys.filter((k) => k in all).map((k) => [k, all[k]]));
    },
    async putIfAbsent(entries) {
      const all = load();
      for (const e of entries) if (!(e.key in all)) all[e.key] = e.judgment;
      writeFileSync(path, JSON.stringify(all));
    },
  };
}

export async function predictAll(docs: DocumentEntry[], texts: Map<string, DocumentText>, predictor: Predictor): Promise<Map<string, Prediction>> {
  const out = new Map<string, Prediction>();
  for (const d of docs) out.set(d.id, await predictor(d, texts.get(d.id)!));
  return out;
}

/** One identity per report, or the numbers in it don't mean one thing. */
export function singleIdentity(preds: Map<string, Prediction>): string {
  const ids = new Set([...preds.values()].map((p) => p.identity));
  if (ids.size > 1) throw new Error(`Scores came from ${ids.size} engine versions, which can't be reported together: ${[...ids].join(", ")}`);
  return [...ids][0] ?? "none";
}

/**
 * A digest of the development scores. A freeze records it and a held-out look recomputes it, so an engine edited
 * without a version bump can't pass as the engine that was frozen.
 */
export const scoresDigest = (preds: Map<string, Prediction>) => sha([...preds.values()].sort((a, b) => a.documentId.localeCompare(b.documentId)).map((p) => `${p.documentId}=${p.score}/${p.coverage}/${p.findings.map((f) => `${f.check}:${f.severity}`).join(",")}`).join("\n"));

export const extractorVersion = () => EXTRACTOR_VERSION;
