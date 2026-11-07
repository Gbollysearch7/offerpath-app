import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import JSZip from "jszip";
import { COVERAGE_POLICY_VERSION } from "@/lib/analysis/coverage";
import { scanPii } from "./anonymise";
import { groupCount, sha, type Dataset, type DocumentEntry } from "./dataset";
import { extractorVersion, predictAll, readAllTexts, scoresDigest, singleIdentity, type DocumentText, type Predictor } from "./engine";
import { CalibrationRefusal, DEVELOPMENT_BANNER, HUMAN_GATES, matchesDemoCv, SYNTHETIC_BANNER, TOOL_VERSION } from "./evidence";
import { evaluateGates, runOutcome, type GateResult, type RunOutcome, type Thresholds } from "./gates";
import { appendLook, assessLook, readFreeze, readLedger, REPORTS_DIR, thresholdsHash, writeFreeze, type Freeze, type LookKind } from "./heldout";
import { computeMetrics, documentTable, type DocumentRow, type EvalContext, type MetricBundle } from "./metrics";
import { docsInSplit, readSplit, SPLIT_FILE, type SplitName } from "./split";

// Validation and the evaluation pipeline. Reports are data (`Report`); report.ts turns them into words.

/** The blueprint's minimum. "That number supports a first investigation, not proof of universal accuracy." */
export const BLUEPRINT_MINIMUM_GROUPS = 30;
export const MINIMUM_REVIEWERS_PER_DOCUMENT = 2;
export const SYNTHETIC_REVIEWER_PREFIX = "SYNTH-";
export const SYNTHETIC_MARKER = /synthetic candidate/i;
const DEFAULT_ITERATIONS = 2000;

const textMap = (texts: Map<string, DocumentText>) => new Map([...texts].map(([id, t]) => [id, t.text]));

/** Author and editor names survive in file metadata after the visible text has been cleaned. */
export async function documentMetadataProblems(path: string): Promise<string[]> {
  const ext = extname(path).toLowerCase();
  if (ext === ".docx") {
    const zip = await JSZip.loadAsync(await readFile(path));
    const core = (await zip.file("docProps/core.xml")?.async("string")) ?? "";
    const named = [...core.matchAll(/<(dc:creator|cp:lastModifiedBy)>([^<]+)</g)].map((m) => m[1]);
    return named.map((n) => `Word metadata field ${n} is filled in.`);
  }
  if (ext === ".pdf") {
    const raw = (await readFile(path)).toString("latin1");
    // Readable only when the metadata isn't compressed, so the checklist still has a person look at file properties.
    return /\/Author\s*\((?!\s*\))/.test(raw) ? ["PDF metadata field Author is filled in."] : [];
  }
  return [];
}

/** Real data must stay out of the repository. `git check-ignore` exits 1 for a tracked-able path inside the repo. */
export function insideRepoAndNotIgnored(dir: string): boolean {
  const r = spawnSync("git", ["check-ignore", "-q", join(resolve(dir), "manifest.json")], { cwd: dir, stdio: "ignore" });
  return r.status === 1;
}

/**
 * Everything that must be true before data can be called real. These are refusals, not warnings. The tool can catch
 * relabelled fixtures and obvious leftovers; it can't verify consent or independence, so those stay human attestations.
 */
export async function realDataProblems(ds: Dataset, texts: Map<string, DocumentText>): Promise<string[]> {
  const p: string[] = [];
  for (const d of ds.documents) {
    const t = texts.get(d.id)?.text ?? "";
    if (SYNTHETIC_MARKER.test(t)) p.push(`Document ${d.id} is a synthetic fixture. It can't be real data.`);
    for (const hit of scanPii(t)) p.push(`Document ${d.id} line ${hit.line}: possible ${hit.category} left in.`);
    for (const m of await documentMetadataProblems(join(ds.dir, d.file))) p.push(`Document ${d.id}: ${m}`);
  }
  for (const r of ds.reviewers) {
    if (r.reviewer_id.startsWith(SYNTHETIC_REVIEWER_PREFIX)) p.push(`Reviewer ${r.reviewer_id} is a synthetic reviewer.`);
    if (!r.independent_of_offerpath) p.push(`Reviewer ${r.reviewer_id} is not independent of Offerpath, so their marks can't count.`);
  }
  if (insideRepoAndNotIgnored(ds.dir)) p.push(`${ds.dir} is inside the repository and not git-ignored. Real CVs must never be committable. Use a folder under calibration/.`);
  return p;
}

/** Reasons held-out results couldn't count, whatever they show. Not refusals: the report states them and stays inconclusive. */
export function evidenceBlockers(ds: Dataset, heldout: DocumentEntry[]): string[] {
  const out: string[] = [];
  if (groupCount(ds.documents) < BLUEPRINT_MINIMUM_GROUPS) out.push(`Only ${groupCount(ds.documents)} independent CV groups in the dataset. The blueprint asks for at least ${BLUEPRINT_MINIMUM_GROUPS}, even for a first investigation.`);
  const under = heldout.filter((d) => d.variant_kind === "original" || d.variant_kind === "revision").filter((d) => ds.marks.filter((m) => m.document_id === d.id).length < MINIMUM_REVIEWERS_PER_DOCUMENT);
  if (under.length) out.push(`${under.length} held-out documents have fewer than ${MINIMUM_REVIEWERS_PER_DOCUMENT} adviser marks.`);
  return out;
}

const refuseIllustrative = (ds: Dataset) => {
  if (ds.manifest.kind === "illustrative") throw new CalibrationRefusal(`${ds.manifest.name} is marked illustrative. Illustrative demo marks are refused as calibration or validation evidence.`);
};

export async function assertUsable(ds: Dataset, texts: Map<string, DocumentText>) {
  refuseIllustrative(ds);
  // Whatever the dataset calls itself. A kind field is only a claim, so demo material is recognised by its text.
  for (const d of ds.documents) {
    const demo = matchesDemoCv(texts.get(d.id)?.text ?? "");
    if (demo) throw new CalibrationRefusal(`Document ${d.id} matches the demo CV ${demo}. Illustrative demo material is refused as calibration or validation evidence, whatever its dataset is labelled.`);
  }
  if (ds.manifest.kind === "real") {
    const problems = await realDataProblems(ds, texts);
    if (problems.length) throw new CalibrationRefusal(`Refused as real data, ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n  ${problems.slice(0, 40).join("\n  ")}`);
  }
}

export interface EvaluateOptions {
  split: SplitName;
  predictor: Predictor;
  /** The deliberate step that opens held-out data. Without it, nothing about those documents is scored. */
  openHeldout?: boolean;
  now?: string;
  iterations?: number;
}

export interface Report {
  schema: "offerpath-calibration-report/1";
  evidence_status: string;
  validation_evidence: false | "pending_human_acceptance";
  generated_at: string;
  dataset: { name: string; version: string; kind: string; data_hash: string; documents_hash: string };
  split: SplitName;
  look: LookKind | null;
  sample: { documents: number; independent_groups: number; reviewers: number; adviser_marks: number; findings_raised: number; rewrite_items: number; withheld_scores: number; incomplete_scores: number; disagreement_flags: number; stale_finding_reviews: number; by_variant: Record<string, number>; by_discipline: Record<string, number>; withdrawn_groups: number };
  versions: { engine_identity: string; extractor: string; coverage_policy: string; tool: string; bootstrap_iterations: number; bootstrap_seed: string; confidence_level: 0.95 };
  human_gates: string[];
  freeze: { frozen_at: string; thresholds_hash: string; agreed_by: Thresholds["agreed_by"]; replaced_before_opening: number } | null;
  outcome: RunOutcome | "NOT_ASSESSED";
  blockers: string[];
  gates: GateResult[];
  metrics: MetricBundle;
  documents: DocumentRow[];
  report_hash: string;
}

const counts = (xs: string[]) => {
  const out: Record<string, number> = {};
  for (const x of [...xs].sort()) out[x] = (out[x] ?? 0) + 1;
  return out;
};

export const evidenceLabel = (kind: string, split: SplitName): string =>
  kind === "synthetic" ? SYNTHETIC_BANNER : split === "development" ? DEVELOPMENT_BANNER : "HELD-OUT RESULT ON HUMAN-ATTESTED DATA, NOT YET ACCEPTED AS VALIDATION";

/** The report's own hash leaves out the clocks, so two runs on the same inputs can be shown to be the same. */
export function hashReport(r: Omit<Report, "report_hash"> & { report_hash?: string }): string {
  return sha(JSON.stringify({ ...r, generated_at: undefined, report_hash: undefined, freeze: r.freeze && { ...r.freeze, frozen_at: undefined } }));
}

export function contextFor(ds: Dataset, docs: DocumentEntry[], predictions: EvalContext["predictions"], texts: Map<string, DocumentText>, iterations: number): EvalContext {
  // Rows outside the slice are removed here, before any metric can see them.
  const ids = new Set(docs.map((d) => d.id));
  const items = ds.rewriteItems.filter((i) => ids.has(i.document_id));
  const itemIds = new Set(items.map((i) => i.rewrite_id));
  return {
    documents: docs,
    predictions,
    texts,
    marks: ds.marks.filter((m) => ids.has(m.document_id)),
    findingReviews: ds.findingReviews.filter((r) => ids.has(r.document_id)),
    missedIssues: ds.missedIssues.filter((r) => ids.has(r.document_id)),
    rewriteItems: items,
    rewriteReviews: ds.rewriteReviews.filter((r) => itemIds.has(r.rewrite_id)),
    seed: ds.documentsHash,
    iterations,
  };
}

/** Scores development documents, from which tuning may learn. Used by evaluation and by a freeze. */
async function developmentState(ds: Dataset, texts: Map<string, DocumentText>, predictor: Predictor) {
  const lock = readSplit(ds, textMap(texts));
  const development = docsInSplit(ds.documents, lock, "development");
  const predictions = await predictAll(development, texts, predictor);
  return { lock, development, predictions, identity: singleIdentity(predictions), digest: scoresDigest(predictions) };
}

export async function freezeDataset(ds: Dataset, thresholds: Thresholds, predictor: Predictor, now = new Date().toISOString()): Promise<Freeze> {
  const texts = await readAllTexts(ds);
  await assertUsable(ds, texts);
  const dev = await developmentState(ds, texts, predictor);
  return writeFreeze(ds, thresholds, { identity: dev.identity, extractor: extractorVersion(), digest: dev.digest }, now);
}

export async function evaluate(ds: Dataset, opts: EvaluateOptions): Promise<Report> {
  refuseIllustrative(ds);
  const texts = await readAllTexts(ds);
  await assertUsable(ds, texts);
  const now = opts.now ?? new Date().toISOString();
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  const dev = await developmentState(ds, texts, opts.predictor);

  let look: LookKind | null = null;
  let freeze: Freeze | null = null;
  if (opts.split === "heldout") {
    if (!opts.openHeldout) throw new CalibrationRefusal("Held-out data stays closed without --open-heldout. Read docs/CALIBRATION_RUNBOOK.md first: it can be opened for one engine version only.");
    freeze = readFreeze(ds.dir);
    if (!freeze) throw new CalibrationRefusal("No frozen thresholds. Agree them with the pilot partner and run freeze before opening held-out data.");
    if (freeze.documents_hash !== ds.documentsHash || freeze.split_hash !== sha(readFileSync(join(ds.dir, SPLIT_FILE)))) throw new CalibrationRefusal("The documents or the split changed after the freeze.");
    if (freeze.engine_identity !== dev.identity) throw new CalibrationRefusal(`The engine is ${dev.identity}, but ${freeze.engine_identity} was frozen. Run freeze again if held-out data has not been opened.`);
    if (freeze.development_scores_digest !== dev.digest || freeze.extractor_version !== extractorVersion()) throw new CalibrationRefusal("The engine now scores development documents differently from when it was frozen, under the same version names. Something changed without a version bump. Find it before opening held-out data.");
    const entry = { engine_identity: dev.identity, thresholds_hash: thresholdsHash(freeze.thresholds), data_hash: ds.dataHash };
    const ledger = readLedger(ds.dir);
    look = assessLook(ledger, entry);
    // Written before the first held-out score exists, so a crash can't leave an unrecorded look.
    if (look === "first") appendLook(ds.dir, ledger, entry, now);
  }

  const docs = opts.split === "development" ? dev.development : docsInSplit(ds.documents, dev.lock, "heldout");
  const predictions = opts.split === "development" ? dev.predictions : await predictAll(docs, texts, opts.predictor);
  const identity = singleIdentity(predictions);
  const ctx = contextFor(ds, docs, predictions, texts, iterations);
  const metrics = computeMetrics(ctx);
  const rows = documentTable(ctx);
  const gates = freeze ? evaluateGates(freeze.thresholds, metrics) : [];
  // Reviews of findings this engine no longer raises can't count for or against it, and that shouldn't pass unnoticed.
  const raised = new Set([...predictions.values()].flatMap((p) => p.findings.map((f) => f.id)));
  const stale = ctx.findingReviews.filter((r) => !raised.has(r.finding_id)).length;
  const blockers = freeze ? [...evidenceBlockers(ds, docs), ...(stale ? [`${stale} finding reviews refer to findings this engine doesn't raise, so they were reviewed under a different engine.`] : [])] : [];
  const outcome = freeze ? runOutcome(gates, blockers) : "NOT_ASSESSED";
  const evidence_status = evidenceLabel(ds.manifest.kind, opts.split);

  const body: Omit<Report, "report_hash"> = {
    schema: "offerpath-calibration-report/1",
    evidence_status,
    validation_evidence: ds.manifest.kind === "real" && opts.split === "heldout" ? "pending_human_acceptance" : false,
    generated_at: now,
    dataset: { name: ds.manifest.name, version: ds.manifest.version, kind: ds.manifest.kind, data_hash: ds.dataHash, documents_hash: ds.documentsHash },
    split: opts.split,
    look,
    sample: {
      documents: docs.length,
      independent_groups: groupCount(docs),
      reviewers: new Set(ctx.marks.map((m) => m.reviewer_id)).size,
      adviser_marks: ctx.marks.length,
      findings_raised: [...predictions.values()].reduce((s, p) => s + p.findings.length, 0),
      rewrite_items: ctx.rewriteItems.length,
      withheld_scores: rows.filter((r) => r.coverage === "withheld").length,
      incomplete_scores: rows.filter((r) => r.coverage === "incomplete").length,
      disagreement_flags: rows.filter((r) => r.disagreement_flag).length,
      stale_finding_reviews: stale,
      by_variant: counts(docs.map((d) => d.variant_kind)),
      by_discipline: counts(docs.map((d) => d.discipline)),
      withdrawn_groups: ds.manifest.withdrawn_groups.length,
    },
    versions: { engine_identity: identity, extractor: extractorVersion(), coverage_policy: COVERAGE_POLICY_VERSION, tool: TOOL_VERSION, bootstrap_iterations: iterations, bootstrap_seed: ctx.seed, confidence_level: 0.95 },
    human_gates: ds.manifest.kind === "real"
      ? ["Recruitment, consent, anonymisation and blinding are recorded by people in this dataset. This tool checks the records. It cannot check that they are true."]
      : [...HUMAN_GATES],
    freeze: freeze && { frozen_at: freeze.frozen_at, thresholds_hash: freeze.thresholds_hash, agreed_by: freeze.thresholds.agreed_by, replaced_before_opening: freeze.replaced.length },
    outcome,
    blockers,
    gates,
    metrics,
    documents: rows,
  };
  return { ...body, report_hash: hashReport(body) };
}

export function reportBaseName(r: Report): string {
  return `${r.split}-${sha(r.versions.engine_identity).slice(0, 10)}-${r.dataset.data_hash.slice(0, 10)}`;
}

export function saveReport(ds: Dataset, r: Report, markdown: string): { json: string; md: string } {
  const folder = join(ds.dir, REPORTS_DIR);
  mkdirSync(folder, { recursive: true });
  const base = join(folder, reportBaseName(r));
  writeFileSync(`${base}.json`, `${JSON.stringify(r, null, 2)}\n`);
  writeFileSync(`${base}.md`, markdown);
  return { json: `${base}.json`, md: `${base}.md` };
}
