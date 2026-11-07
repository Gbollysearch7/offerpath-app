import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "@/lib/csv";
import { scanPii } from "./anonymise";
import { CalibrationRefusal, type DatasetKind } from "./evidence";

// A calibration dataset on disk, its import rules and its version. Everything that a report rests on is hashed here.
// Rows are never skipped: a bad row stops the import and names itself, because silently dropped marks change results.

export const MANIFEST_SCHEMA = "offerpath-calibration-dataset/1";

export const VARIANT_KINDS = ["original", "revision", "applied_recommendations", "adversarial_keyword_stuffing", "adversarial_fabricated_metrics", "adversarial_repeated_text", "adversarial_instruction_injection"] as const;
export type VariantKind = (typeof VARIANT_KINDS)[number];

export const STRATA = ["discipline", "career_stage", "document_style", "writing_strength"] as const;
export type Stratum = (typeof STRATA)[number];

export interface DocumentEntry {
  id: string;
  file: string;
  /** Everything from one person, and every variant of one CV, shares a group. The group is the unit of independence. */
  group: string;
  discipline: string;
  career_stage: string;
  document_style: string;
  writing_strength: string;
  variant_kind: VariantKind;
  variant_of: string | null;
  consent_ref: string;
  anonymisation_reviewed_by: string;
}

export interface Manifest {
  schema: string;
  name: string;
  version: string;
  kind: DatasetKind;
  documents: DocumentEntry[];
  /** Pairs a person checked and found to be different people, despite similar wording. */
  confirmed_distinct: { a: string; b: string; reason: string }[];
  withdrawn_groups: string[];
}

export const MARK_AREAS = ["impact", "clarity", "structure", "spelling", "length"] as const;
export type MarkArea = (typeof MARK_AREAS)[number];

export interface Reviewer { reviewer_id: string; role: string; independent_of_offerpath: boolean; }
export interface Mark { document_id: string; reviewer_id: string; overall: number; areas: Partial<Record<MarkArea, number>>; marked_at: string; }
export interface FindingReview { finding_id: string; document_id: string; reviewer_id: string; verdict: "valid" | "not_valid" | "unsure"; severity: "low" | "medium" | "high" | null; reviewed_at: string; }
export interface MissedIssue { document_id: string; reviewer_id: string; severity: "low" | "medium" | "high"; reviewed_at: string; }
export interface RewriteItem { rewrite_id: string; document_id: string; kind: "model_rewrite" | "strong_original" | "adversarial"; source_line: string; rewrite: string; }
export interface RewriteReview { rewrite_id: string; reviewer_id: string; fidelity: "faithful" | "minor_issue" | "invented"; seniority: "preserved" | "inflated" | "deflated"; clarity: number; usefulness: number; unnecessary_change: boolean; reviewed_at: string; }

export interface Dataset {
  dir: string;
  manifest: Manifest;
  documents: DocumentEntry[];
  reviewers: Reviewer[];
  marks: Mark[];
  findingReviews: FindingReview[];
  missedIssues: MissedIssue[];
  rewriteItems: RewriteItem[];
  rewriteReviews: RewriteReview[];
  /** Hash of the documents alone: what the split is locked to, so marks can arrive after splitting. */
  documentsHash: string;
  /** Hash of the manifest, documents and every sheet. Any change to any mark changes it. */
  dataHash: string;
}

export const SHEETS = {
  reviewers: { file: "reviewers.csv", columns: ["reviewer_id", "role", "independent_of_offerpath"] },
  marks: { file: "adviser-marks.csv", columns: ["document_id", "reviewer_id", "overall_mark", ...MARK_AREAS, "saw_offerpath_output", "marked_at", "notes"] },
  findingReviews: { file: "finding-reviews.csv", columns: ["finding_id", "document_id", "reviewer_id", "what_the_app_said", "evidence", "verdict", "severity", "reviewed_at", "notes"] },
  missedIssues: { file: "missed-issues.csv", columns: ["document_id", "reviewer_id", "severity", "description", "reviewed_at"] },
  rewriteItems: { file: "rewrite-items.csv", columns: ["rewrite_id", "document_id", "kind", "source_line", "rewrite"] },
  rewriteReviews: { file: "rewrite-reviews.csv", columns: ["rewrite_id", "reviewer_id", "source_line", "rewrite", "factual_fidelity", "seniority", "clarity", "usefulness", "unnecessary_change", "reviewed_at", "notes"] },
} as const;

export const sha = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/** A failure with every problem listed at once, so an adviser's sheet is corrected in one pass. */
export class ImportError extends Error {
  constructor(public problems: string[]) {
    super(`Import stopped, ${problems.length} problem${problems.length === 1 ? "" : "s"}. No rows were used.\n  ${problems.slice(0, 40).join("\n  ")}${problems.length > 40 ? `\n  and ${problems.length - 40} more` : ""}`);
    this.name = "ImportError";
  }
}

type Row = Record<string, string>;

function readSheet(dir: string, sheet: { file: string; columns: readonly string[] }, problems: string[]): { row: Row; at: string }[] {
  const path = join(dir, sheet.file);
  if (!existsSync(path)) return [];
  const [header, ...rows] = parseCsv(readFileSync(path, "utf8"), 100_000);
  if (!header) return [];
  const names = header.map((h) => h.trim().toLowerCase());
  const missing = sheet.columns.filter((c) => !names.includes(c));
  const extra = names.filter((c) => !sheet.columns.includes(c));
  if (missing.length || extra.length) {
    problems.push(`${sheet.file}: wrong columns.${missing.length ? ` Missing: ${missing.join(", ")}.` : ""}${extra.length ? ` Unexpected: ${extra.join(", ")}.` : ""}`);
    return [];
  }
  return rows.map((r, i) => {
    const row: Row = Object.fromEntries(names.map((n, c) => [n, (r[c] ?? "").trim()]));
    const at = `${sheet.file} row ${i + 2}`;
    // Free text is where a student's or colleague's details slip back in. The category is reported, never the text.
    for (const c of ["notes", "description"]) if (row[c] && scanPii(row[c]).length) problems.push(`${at}: ${c} seems to hold personal data (${scanPii(row[c])[0].category}). Remove it.`);
    return { row, at };
  });
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s));
const yes = (s: string) => /^(?:yes|y|true)$/i.test(s);
const no = (s: string) => /^(?:no|n|false)$/i.test(s);

function mark0to100(raw: string, what: string, at: string, problems: string[]): number {
  const n = Number(raw);
  if (raw === "" || !Number.isFinite(n) || n < 0 || n > 100) {
    problems.push(`${at}: ${what} must be a number from 0 to 100, got "${raw}".`);
    return NaN;
  }
  return n;
}

function oneOf<T extends string>(raw: string, allowed: readonly T[], what: string, at: string, problems: string[]): T {
  if (!allowed.includes(raw as T)) problems.push(`${at}: ${what} must be one of ${allowed.join(", ")}, got "${raw}".`);
  return raw as T;
}

function checkManifest(m: Manifest, dir: string, problems: string[]) {
  if (m.schema !== MANIFEST_SCHEMA) problems.push(`manifest.json: schema must be ${MANIFEST_SCHEMA}.`);
  if (!m.name || !m.version) problems.push("manifest.json: name and version are required.");
  if (!["real", "synthetic", "illustrative"].includes(m.kind)) problems.push(`manifest.json: kind must be real, synthetic or illustrative, got "${m.kind}".`);
  if (!Array.isArray(m.documents) || !m.documents.length) problems.push("manifest.json: no documents listed.");
  const ids = new Set<string>();
  for (const d of m.documents ?? []) {
    const at = `manifest.json document ${d.id ?? "(no id)"}`;
    if (!d.id || ids.has(d.id)) problems.push(`${at}: missing or repeated id.`);
    ids.add(d.id);
    // A withdrawn student's file is deleted, and its entry stays only so the withdrawal shows.
    if (!m.withdrawn_groups.includes(d.group) && (!d.file || !existsSync(join(dir, d.file)))) problems.push(`${at}: file not found (${d.file}).`);
    if (!d.group) problems.push(`${at}: group is required, because it decides what may not cross the split.`);
    for (const s of ["discipline", "career_stage", "document_style", "writing_strength"] as const) if (!d[s]) problems.push(`${at}: ${s} is required.`);
    if (!VARIANT_KINDS.includes(d.variant_kind)) problems.push(`${at}: variant_kind must be one of ${VARIANT_KINDS.join(", ")}.`);
    if (m.kind === "real" && !d.consent_ref) problems.push(`${at}: consent_ref is required for real data.`);
    if (m.kind === "real" && !d.anonymisation_reviewed_by) problems.push(`${at}: anonymisation_reviewed_by is required for real data (a person, after reviewing the document).`);
  }
  const byId = new Map((m.documents ?? []).map((d) => [d.id, d]));
  for (const d of m.documents ?? []) {
    if (d.variant_kind === "original" && d.variant_of) problems.push(`manifest.json document ${d.id}: an original has no variant_of.`);
    if (d.variant_kind !== "original") {
      const base = d.variant_of ? byId.get(d.variant_of) : undefined;
      if (!base) problems.push(`manifest.json document ${d.id}: variant_of must name a listed document.`);
      else if (base.group !== d.group) problems.push(`manifest.json document ${d.id}: a variant must share its original's group (${base.group}), because variants cannot cross the split.`);
    }
  }
}

export function loadDataset(dir: string): Dataset {
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) {
    if (existsSync(join(dir, "adviser_scores.csv"))) throw new CalibrationRefusal(`${dir} uses the old file,score sheet. It averaged advisers away and had no split or versioning, so it is no longer read. See docs/CALIBRATION_RUNBOOK.md.`);
    throw new ImportError([`${manifestPath} not found. See docs/CALIBRATION_RUNBOOK.md.`]);
  }
  const raw = readFileSync(manifestPath, "utf8");
  const manifest = { confirmed_distinct: [], withdrawn_groups: [], ...JSON.parse(raw) } as Manifest;
  const problems: string[] = [];
  checkManifest(manifest, dir, problems);
  if (problems.length) throw new ImportError(problems);

  const withdrawn = new Set(manifest.withdrawn_groups);
  const documents = manifest.documents.filter((d) => !withdrawn.has(d.group));
  const docIds = new Set(documents.map((d) => d.id));
  const withdrawnIds = new Set(manifest.documents.filter((d) => withdrawn.has(d.group)).map((d) => d.id));
  const knownDoc = (id: string, at: string) => {
    if (!docIds.has(id) && !withdrawnIds.has(id)) problems.push(`${at}: unknown document_id "${id}".`);
    return docIds.has(id);
  };

  const reviewers: Reviewer[] = readSheet(dir, SHEETS.reviewers, problems).map(({ row, at }) => {
    if (!row.reviewer_id) problems.push(`${at}: reviewer_id is required.`);
    if (!yes(row.independent_of_offerpath) && !no(row.independent_of_offerpath)) problems.push(`${at}: independent_of_offerpath must be yes or no.`);
    return { reviewer_id: row.reviewer_id, role: row.role, independent_of_offerpath: yes(row.independent_of_offerpath) };
  });
  const reviewerIds = new Set(reviewers.map((r) => r.reviewer_id));
  if (reviewerIds.size !== reviewers.length) problems.push(`${SHEETS.reviewers.file}: a reviewer_id is repeated.`);
  const knownReviewer = (id: string, at: string) => {
    if (!reviewerIds.has(id)) problems.push(`${at}: reviewer "${id}" is not listed in ${SHEETS.reviewers.file}.`);
  };
  const needDate = (s: string, what: string, at: string) => {
    if (!isDate(s)) problems.push(`${at}: ${what} must be a date such as 2027-01-31, got "${s}".`);
  };

  const seenMarks = new Set<string>();
  const marks: Mark[] = [];
  for (const { row, at } of readSheet(dir, SHEETS.marks, problems)) {
    const live = knownDoc(row.document_id, at);
    knownReviewer(row.reviewer_id, at);
    const key = `${row.document_id}|${row.reviewer_id}`;
    if (seenMarks.has(key)) problems.push(`${at}: ${row.reviewer_id} already marked ${row.document_id}. One mark per adviser per document.`);
    seenMarks.add(key);
    if (!no(row.saw_offerpath_output)) problems.push(`${at}: saw_offerpath_output must be "no". A mark made after seeing the app's output is not independent and cannot be used.`);
    needDate(row.marked_at, "marked_at", at);
    const overall = mark0to100(row.overall_mark, "overall_mark", at, problems);
    const areas: Mark["areas"] = {};
    for (const a of MARK_AREAS) if (row[a] !== "") areas[a] = mark0to100(row[a], a, at, problems);
    if (live) marks.push({ document_id: row.document_id, reviewer_id: row.reviewer_id, overall, areas, marked_at: row.marked_at });
  }

  const markDate = new Map(marks.map((m) => [`${m.document_id}|${m.reviewer_id}`, m.marked_at]));
  const afterMarking = (doc: string, reviewer: string, date: string, at: string) => {
    const marked = markDate.get(`${doc}|${reviewer}`);
    if (marked && date.slice(0, 10) < marked.slice(0, 10)) problems.push(`${at}: reviewed before this adviser's blind mark (${marked}). Findings are shown only after the blind mark is in.`);
  };

  const seenReviews = new Set<string>();
  const findingReviews: FindingReview[] = [];
  for (const { row, at } of readSheet(dir, SHEETS.findingReviews, problems)) {
    const live = knownDoc(row.document_id, at);
    knownReviewer(row.reviewer_id, at);
    const key = `${row.finding_id}|${row.reviewer_id}`;
    if (seenReviews.has(key)) problems.push(`${at}: ${row.reviewer_id} already reviewed ${row.finding_id}.`);
    seenReviews.add(key);
    const verdict = oneOf(row.verdict, ["valid", "not_valid", "unsure"] as const, "verdict", at, problems);
    let severity: FindingReview["severity"] = null;
    if (verdict === "valid") severity = oneOf(row.severity, ["low", "medium", "high"] as const, "severity (for a valid finding)", at, problems);
    needDate(row.reviewed_at, "reviewed_at", at);
    afterMarking(row.document_id, row.reviewer_id, row.reviewed_at, at);
    if (live) findingReviews.push({ finding_id: row.finding_id, document_id: row.document_id, reviewer_id: row.reviewer_id, verdict, severity, reviewed_at: row.reviewed_at });
  }

  const missedIssues: MissedIssue[] = [];
  for (const { row, at } of readSheet(dir, SHEETS.missedIssues, problems)) {
    const live = knownDoc(row.document_id, at);
    knownReviewer(row.reviewer_id, at);
    const severity = oneOf(row.severity, ["low", "medium", "high"] as const, "severity", at, problems);
    needDate(row.reviewed_at, "reviewed_at", at);
    if (live) missedIssues.push({ document_id: row.document_id, reviewer_id: row.reviewer_id, severity, reviewed_at: row.reviewed_at });
  }

  const itemIds = new Set<string>();
  const rewriteItems: RewriteItem[] = [];
  for (const { row, at } of readSheet(dir, SHEETS.rewriteItems, problems)) {
    const live = knownDoc(row.document_id, at);
    if (!row.rewrite_id || itemIds.has(row.rewrite_id)) problems.push(`${at}: missing or repeated rewrite_id.`);
    itemIds.add(row.rewrite_id);
    const kind = oneOf(row.kind, ["model_rewrite", "strong_original", "adversarial"] as const, "kind", at, problems);
    if (!row.source_line || !row.rewrite) problems.push(`${at}: source_line and rewrite are required.`);
    if (live) rewriteItems.push({ rewrite_id: row.rewrite_id, document_id: row.document_id, kind, source_line: row.source_line, rewrite: row.rewrite });
  }
  const liveItems = new Set(rewriteItems.map((i) => i.rewrite_id));

  const seenRewrite = new Set<string>();
  const rewriteReviews: RewriteReview[] = [];
  const score1to5 = (raw: string, what: string, at: string) => {
    if (!/^[1-5]$/.test(raw)) problems.push(`${at}: ${what} must be 1 to 5, got "${raw}".`);
    return Number(raw);
  };
  for (const { row, at } of readSheet(dir, SHEETS.rewriteReviews, problems)) {
    if (!itemIds.has(row.rewrite_id)) problems.push(`${at}: unknown rewrite_id "${row.rewrite_id}".`);
    knownReviewer(row.reviewer_id, at);
    const key = `${row.rewrite_id}|${row.reviewer_id}`;
    if (seenRewrite.has(key)) problems.push(`${at}: ${row.reviewer_id} already reviewed ${row.rewrite_id}.`);
    seenRewrite.add(key);
    const fidelity = oneOf(row.factual_fidelity, ["faithful", "minor_issue", "invented"] as const, "factual_fidelity", at, problems);
    const seniority = oneOf(row.seniority, ["preserved", "inflated", "deflated"] as const, "seniority", at, problems);
    const clarity = score1to5(row.clarity, "clarity", at);
    const usefulness = score1to5(row.usefulness, "usefulness", at);
    if (!yes(row.unnecessary_change) && !no(row.unnecessary_change)) problems.push(`${at}: unnecessary_change must be yes or no.`);
    needDate(row.reviewed_at, "reviewed_at", at);
    if (liveItems.has(row.rewrite_id)) rewriteReviews.push({ rewrite_id: row.rewrite_id, reviewer_id: row.reviewer_id, fidelity, seniority, clarity, usefulness, unnecessary_change: yes(row.unnecessary_change), reviewed_at: row.reviewed_at });
  }

  if (problems.length) throw new ImportError(problems);

  const documentsHash = hashDocuments(dir, documents);
  const parts = [sha(raw), documentsHash, ...Object.values(SHEETS).map((s) => (existsSync(join(dir, s.file)) ? sha(readFileSync(join(dir, s.file))) : "-"))];
  return { dir, manifest, documents, reviewers, marks, findingReviews, missedIssues, rewriteItems, rewriteReviews, documentsHash, dataHash: sha(parts.join("|")) };
}

export const documentBytesHash = (dir: string, d: DocumentEntry) => sha(readFileSync(join(dir, d.file)));

/** Hashes ids, groups and bytes together: moving a variant to another group changes this as surely as editing it. */
export function hashDocuments(dir: string, docs: DocumentEntry[]): string {
  return sha([...docs].sort((a, b) => a.id.localeCompare(b.id)).map((d) => `${d.id}|${d.group}|${documentBytesHash(dir, d)}`).join("\n"));
}

/** Files in the documents folder that the manifest doesn't mention, which are usually a forgotten CV. */
export function unlistedFiles(ds: Dataset): string[] {
  const folder = join(ds.dir, "documents");
  if (!existsSync(folder) || !statSync(folder).isDirectory()) return [];
  const listed = new Set(ds.manifest.documents.map((d) => d.file.replace(/^documents\//, "")));
  return readdirSync(folder).filter((f) => !f.startsWith(".") && !listed.has(f));
}

export const groupCount = (docs: DocumentEntry[]) => new Set(docs.map((d) => d.group)).size;
