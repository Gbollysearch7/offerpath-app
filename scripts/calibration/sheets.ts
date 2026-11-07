import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { analyseCv } from "@/lib/analysis/cv";
import { extractText } from "@/lib/analysis/extract";
import { parseCsv, toCsv } from "@/lib/csv";
import { anonymiseText, type PiiHit } from "./anonymise";
import { ImportError, loadDataset, MANIFEST_SCHEMA, sha, SHEETS, type Dataset, type DocumentEntry, type Manifest, type VariantKind } from "./dataset";
import { DEFAULT_SECTOR, predictAll, readAllTexts, type Predictor } from "./engine";
import { CalibrationRefusal } from "./evidence";
import { readFreeze, readLedger } from "./heldout";
import { docsInSplit, readSplit, type SplitName } from "./split";

// The paper trail around advisers: blind sheets out, marks back in, and the first step of anonymisation.
// Sheets never carry a score. Findings go out only after that adviser's blind marks are in.

const SHEETS_DIR = "sheets";

/** A stable order that differs per adviser, so nobody reads a variant straight after its original by default. */
const orderFor = <T extends { id: string }>(docs: T[], reviewer: string) => [...docs].sort((a, b) => sha(`${reviewer}|${a.id}`).localeCompare(sha(`${reviewer}|${b.id}`)));

function writeSheet(dir: string, name: string, columns: readonly string[], rows: string[][]): string {
  const folder = join(dir, SHEETS_DIR);
  mkdirSync(folder, { recursive: true });
  const path = join(folder, name);
  writeFileSync(path, `${toCsv([[...columns], ...rows])}\n`);
  return path;
}

const needsMarks = (d: DocumentEntry) => !d.variant_kind.startsWith("adversarial_");

/** One blank blind sheet per adviser. It holds document ids and nothing the app produced. */
export function writeMarkingSheets(ds: Dataset): string[] {
  if (!ds.reviewers.length) throw new CalibrationRefusal(`List the advisers in ${SHEETS.reviewers.file} first.`);
  const docs = ds.documents.filter(needsMarks);
  return ds.reviewers.map((r) => writeSheet(ds.dir, `marks-${r.reviewer_id}.csv`, SHEETS.marks.columns, orderFor(docs, r.reviewer_id).map((d) => SHEETS.marks.columns.map((c) => (c === "document_id" ? d.id : c === "reviewer_id" ? r.reviewer_id : "")))));
}

/**
 * Findings to review, with no score. Refused until that adviser's blind marks for these documents are in. Held-out
 * findings also wait for the freeze: reviews of findings from an engine that later changes would be wasted.
 */
export async function writeFindingSheets(ds: Dataset, split: SplitName, predictor: Predictor): Promise<string[]> {
  const texts = await readAllTexts(ds);
  const lock = readSplit(ds, new Map([...texts].map(([id, t]) => [id, t.text])));
  if (split === "heldout" && !readFreeze(ds.dir)) throw new CalibrationRefusal("Freeze the engine and thresholds before sending held-out findings to advisers.");
  const docs = docsInSplit(ds.documents, lock, split).filter((d) => d.variant_kind === "original" || d.variant_kind === "revision");
  const missing = ds.reviewers.flatMap((r) => {
    const n = docs.filter((d) => !ds.marks.some((m) => m.document_id === d.id && m.reviewer_id === r.reviewer_id)).length;
    return n ? [`${r.reviewer_id} has ${n} blind marks still to return`] : [];
  });
  if (missing.length) throw new CalibrationRefusal(`Findings stay hidden until blind marks are in, so they can't influence the marks:\n  ${missing.join("\n  ")}`);
  const predictions = await predictAll(docs, texts, predictor);
  return ds.reviewers.map((r) => {
    const rows = orderFor(docs, r.reviewer_id).flatMap((d) => (predictions.get(d.id)?.findings ?? []).map((f) => SHEETS.findingReviews.columns.map((c) => ({ finding_id: f.id, document_id: d.id, reviewer_id: r.reviewer_id, what_the_app_said: [f.explanation, f.action].filter(Boolean).join(" "), evidence: f.quotes.join(" / ") } as Record<string, string>)[c] ?? "")));
    return writeSheet(ds.dir, `findings-${split}-${r.reviewer_id}.csv`, SHEETS.findingReviews.columns, rows);
  });
}

export function writeRewriteSheets(ds: Dataset): string[] {
  if (!ds.rewriteItems.length) throw new CalibrationRefusal(`Add the rewrites to review in ${SHEETS.rewriteItems.file} first.`);
  return ds.reviewers.map((r) => {
    const items = orderFor(ds.rewriteItems.map((i) => ({ ...i, id: i.rewrite_id })), r.reviewer_id);
    return writeSheet(ds.dir, `rewrites-${r.reviewer_id}.csv`, SHEETS.rewriteReviews.columns, items.map((i) => SHEETS.rewriteReviews.columns.map((c) => ({ rewrite_id: i.rewrite_id, reviewer_id: r.reviewer_id, source_line: i.source_line, rewrite: i.rewrite } as Record<string, string>)[c] ?? "")));
  });
}

const IMPORTS = {
  marks: { sheet: SHEETS.marks, filled: "overall_mark" },
  findings: { sheet: SHEETS.findingReviews, filled: "verdict" },
  missed: { sheet: SHEETS.missedIssues, filled: "severity" },
  rewrites: { sheet: SHEETS.rewriteReviews, filled: "factual_fidelity" },
} as const;
export type ImportKind = keyof typeof IMPORTS;

/**
 * Adds a returned adviser sheet to the dataset. All or nothing: the whole dataset is re-validated with the new rows, and
 * on any problem the old file is put back. Rows the adviser left blank are counted and reported, not guessed at.
 */
export function importSheet(dir: string, kind: ImportKind, file: string): { added: number; leftBlank: number } {
  const spec = IMPORTS[kind];
  if (!spec) throw new ImportError([`Unknown sheet type "${kind}". Use one of ${Object.keys(IMPORTS).join(", ")}.`]);
  if (readLedger(dir).length) throw new CalibrationRefusal("Held-out data has been opened, so marks can't be added to this dataset version. Later marks belong in a new version, with new held-out CVs.");
  const [header, ...rows] = parseCsv(readFileSync(file, "utf8"), 100_000);
  const names = (header ?? []).map((h) => h.trim().toLowerCase());
  const missing = spec.sheet.columns.filter((c) => !names.includes(c));
  if (missing.length) throw new ImportError([`${file}: wrong columns. Missing: ${missing.join(", ")}.`]);
  const filledAt = names.indexOf(spec.filled);
  const filled = rows.filter((r) => (r[filledAt] ?? "").trim() !== "");
  const ordered = filled.map((r) => spec.sheet.columns.map((c) => r[names.indexOf(c)] ?? ""));
  const target = join(dir, spec.sheet.file);
  const before = existsSync(target) ? readFileSync(target, "utf8") : null;
  const existing = before ? parseCsv(before, 100_000).slice(1) : [];
  writeFileSync(target, `${toCsv([[...spec.sheet.columns], ...existing, ...ordered])}\n`);
  try {
    loadDataset(dir);
  } catch (e) {
    if (before === null) writeFileSync(target, `${toCsv([[...spec.sheet.columns]])}\n`);
    else writeFileSync(target, before);
    throw e;
  }
  return { added: filled.length, leftBlank: rows.length - filled.length };
}

/* ---------- Anonymisation intake ---------- */

export const INTAKE_COLUMNS = ["source_file", "group_label", "discipline", "career_stage", "document_style", "writing_strength", "variant_kind", "variant_of_source", "consent_ref", "known_names"] as const;

export interface AnonymiseLogRow { document_id: string; line: number | ""; category: string; action: "replaced" | "person must review" | "score changed by"; value: number | ""; }

const inside = (child: string, parent: string) => {
  const r = relative(resolve(parent), resolve(child));
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};

/**
 * Step one of anonymising: the steward's intake sheet and raw files in, cleaned text and a skeleton manifest out. The
 * key linking documents to people goes elsewhere, for honouring withdrawals, and must not sit with the dataset. The
 * result does not load as real data until a person has signed each document off in `anonymisation_reviewed_by`.
 */
export async function anonymiseIntake(opts: { intake: string; raw: string; out: string; keyOut: string; name: string; version: string; sector?: string }): Promise<{ documents: number; flagged: number; scoreChanges: number; log: string }> {
  if (inside(opts.keyOut, opts.out)) throw new CalibrationRefusal("The key file links documents to people. It can't be stored inside the dataset folder.");
  if (inside(opts.out, opts.raw)) throw new CalibrationRefusal("The dataset folder can't sit inside the folder of raw CVs.");
  if (existsSync(join(opts.out, "manifest.json"))) throw new CalibrationRefusal(`${opts.out} already holds a dataset.`);
  const [header, ...rows] = parseCsv(readFileSync(opts.intake, "utf8"));
  const names = (header ?? []).map((h) => h.trim().toLowerCase());
  const missing = INTAKE_COLUMNS.filter((c) => !names.includes(c));
  if (missing.length) throw new ImportError([`${opts.intake}: missing columns: ${missing.join(", ")}.`]);
  const records = rows.map((r) => Object.fromEntries(INTAKE_COLUMNS.map((c) => [c, (r[names.indexOf(c)] ?? "").trim()])) as Record<(typeof INTAKE_COLUMNS)[number], string>);
  const problems = records.flatMap((r, i) => [
    ...(r.source_file && existsSync(join(opts.raw, r.source_file)) ? [] : [`intake row ${i + 2}: raw file not found.`]),
    ...(r.consent_ref ? [] : [`intake row ${i + 2}: consent_ref is required. No consent record, no use.`]),
    ...(r.group_label ? [] : [`intake row ${i + 2}: group_label is required. Give every CV from one person the same label.`]),
  ]);
  if (problems.length) throw new ImportError(problems);

  mkdirSync(join(opts.out, "documents"), { recursive: true });
  const groupIds = new Map<string, string>();
  const docIds = new Map(records.map((r) => [r.source_file, randomBytes(4).toString("hex")]));
  const log: AnonymiseLogRow[] = [];
  const documents: DocumentEntry[] = [];
  const sector = opts.sector ?? DEFAULT_SECTOR;
  for (const r of records) {
    const id = docIds.get(r.source_file)!;
    const bytes = readFileSync(join(opts.raw, r.source_file));
    const text = extname(r.source_file).toLowerCase() === ".txt" ? bytes.toString("utf8") : await extractText(new Uint8Array(bytes), r.source_file);
    const clean = anonymiseText(text, id, r.known_names.split(";"));
    writeFileSync(join(opts.out, "documents", `doc-${id}.txt`), clean.text);
    if (!groupIds.has(r.group_label)) groupIds.set(r.group_label, `grp-${randomBytes(4).toString("hex")}`);
    const entry = (h: PiiHit, action: AnonymiseLogRow["action"]): AnonymiseLogRow => ({ document_id: id, line: h.line, category: h.category, action, value: "" });
    log.push(...clean.replaced.map((h) => entry(h, "replaced")), ...clean.review.map((h) => entry(h, "person must review")));
    // Only the change is recorded, never a score, so this log can't unblind anyone who reads it.
    const change = analyseCv(clean.text, sector).score - analyseCv(text, sector).score;
    if (change !== 0) log.push({ document_id: id, line: "", category: "engine score moved by anonymising", action: "score changed by", value: change });
    documents.push({
      id: `doc-${id}`,
      file: `documents/doc-${id}.txt`,
      group: groupIds.get(r.group_label)!,
      discipline: r.discipline,
      career_stage: r.career_stage,
      document_style: r.document_style,
      writing_strength: r.writing_strength,
      variant_kind: (r.variant_kind || "original") as VariantKind,
      variant_of: r.variant_of_source ? `doc-${docIds.get(r.variant_of_source)}` : null,
      consent_ref: r.consent_ref,
      anonymisation_reviewed_by: "",
    });
  }
  const manifest: Manifest = { schema: MANIFEST_SCHEMA, name: opts.name, version: opts.version, kind: "real", documents, confirmed_distinct: [], withdrawn_groups: [] };
  writeFileSync(join(opts.out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  mkdirSync(dirname(opts.keyOut), { recursive: true });
  writeFileSync(opts.keyOut, `${JSON.stringify({ warning: "Links documents to people. Keep it with the consent records, never with the dataset.", documents: Object.fromEntries(docIds), groups: Object.fromEntries(groupIds) }, null, 2)}\n`);
  const logPath = join(opts.out, "anonymisation-log.csv");
  writeFileSync(logPath, `${toCsv([["document_id", "line", "category", "action", "value"], ...log.map((l) => [l.document_id, l.line, l.category, l.action, l.value])])}\n`);
  return { documents: documents.length, flagged: log.filter((l) => l.action === "person must review").length, scoreChanges: log.filter((l) => l.action === "score changed by").length, log: logPath };
}
