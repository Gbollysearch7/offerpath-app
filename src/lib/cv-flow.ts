import "server-only";
import { aiEnabled } from "@/lib/ai";
import { applyEdits, assembleContent, contentBlocks, contentChanges, MAX_BLOCK_CHARS } from "@/lib/analysis/content";
import { documentMeta, documentMetaForText, readingSummary, type ReadingSummary } from "@/lib/analysis/document";
import { extractDocument, ExtractError, LIMITS, type ReadOutcome } from "@/lib/analysis/extract";
import { AI_LIMITS, SourceConflictError, type Repo, type SourceInput } from "@/lib/repo/types";
import { scoreCv, ScoringUnavailableError } from "@/lib/scoring";
import { proofreadCv } from "@/lib/analysis/proofreading/run";
import { buildCvPayload } from "@/lib/services";
import type { ContentBlock, CvSource, DocumentMeta, DocumentSource } from "@/lib/types";

// The CV review flow (OP-006): upload, review, correct, paste, score. Every step works on document versions the
// repository keeps immutable, and every step can be repeated with the same key without a second version or a
// second report. The server actions in src/app/actions/cv.ts wrap these with the session, rate limits and
// revalidation; the tests call them directly against both repositories.

/** What the student sees before a score when a reading needs their eyes: the reading, and the text cut into editable blocks. */
export interface SourceReview {
  sourceId: string;
  fileName: string;
  reading: ReadingSummary;
  blocks: ContentBlock[];
  /** The report that already scored this version, if any (a correction made from a scored report). */
  reportId: string | null;
}

export type UploadFlowResult =
  /** Read and scored. `showReading` asks the client to show how the file was read before the score (a caution at high confidence). */
  | { kind: "scored"; id: string; sourceId: string; reading: ReadingSummary; showReading: boolean }
  /** Read but not scored: the confidence is below high, so the student reviews the text first. */
  | { kind: "review"; review: SourceReview }
  /** Could not be read as text or is outside a limit; nothing was saved. */
  | { kind: "outcome"; outcome: ReadOutcome }
  | { kind: "error"; error: string };

export type ScoreFlowResult = { id: string; sourceId: string } | { error: string };

export const NOT_FOUND = "We couldn't find that document.";
const STALE = "The text has changed since this page was loaded. Reload the page and try again.";
const CONFLICT = "This attempt was already saved with different text. Reload the page and try again.";
const TOO_LITTLE = `That's not enough text to assess fairly. Paste your whole CV: at least ${LIMITS.MIN_TEXT_CHARS} characters.`;
const TOO_MUCH = `That's far more text than a CV. Keep it to your CV, ideally two pages (up to ${LIMITS.MAX_TEXT_CHARS.toLocaleString("en-GB")} characters).`;

/**
 * A reading below high confidence is shown to the student before anything is scored: `medium` means a defect that
 * changed what would be assessed, `low` more than one. A `high` reading with a caution (one layout quirk, such as
 * two columns) is scored and the caution shown beside the score, with the same correction path available.
 */
export const reviewBeforeScoring = (d: DocumentMeta) => d.extraction.confidence.band !== "high";
export const showReadingAfterScoring = (d: DocumentMeta) => !reviewBeforeScoring(d) && d.extraction.warnings.some((w) => w.severity === "caution");

export function sourceReview(source: CvSource & { document: DocumentMeta }): SourceReview {
  return { sourceId: source.id, fileName: source.fileName, reading: readingSummary(source.document), blocks: contentBlocks(source.text), reportId: source.reportId };
}

const dense = (text: string) => text.replace(/\s/g, "").length;
/** What a database text column can hold: no NUL characters and no broken surrogate pairs. Everything else is left exactly as typed. */
const storableText = (text: string) => text.replace(/\u0000/g, "").toWellFormed();
/**
 * A file name as the browser sent it is whatever the client chose. Keeps the last path segment, without control
 * characters or the invisible ones that make "cv\u202Efdp.exe" display as "cvexe.pdf". An ordinary name comes through unchanged.
 */
export const cleanFileName = (name: string) =>
  storableText(name)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .split(/[\\/]/)
    .pop()!
    .trim()
    .slice(0, 120);
/** Only a file that at least claims and starts like a PDF or Word document is kept as a student's original; anything else isn't a CV file. */
const NOT_A_CV_FILE = new Set(["unsupported_type", "not_pdf", "not_docx", "empty", "too_large"]);
const contentType = (name: string) => (/\.pdf$/i.test(name) ? "application/pdf" : /\.docx$/i.test(name) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/octet-stream");

/** Scores one version and saves the report that references it. A version already scored returns its report. */
async function scoreVersion(repo: Repo, source: CvSource & { document: DocumentMeta }, sector: string, stage: string): Promise<ScoreFlowResult> {
  if (source.reportId) return { id: source.reportId, sourceId: source.id };
  if (aiEnabled() && (await repo.bumpAi("cv_score")) > AI_LIMITS.cv_score) return { error: `You've scored ${AI_LIMITS.cv_score} CVs today. You can score more tomorrow.` };
  let scored;
  try {
    scored = await scoreCv(source.text, sector);
  } catch (e) {
    return { error: e instanceof ScoringUnavailableError ? e.message : "Something went wrong scoring your CV. Try again." };
  }
  // The text handed to the scorer is the version's text, byte for byte; the payload saves that same text and a
  // document record whose version hash is of it, and `toStored` refuses the report if any of the three disagree.
  const payload = buildCvPayload({ fileName: source.fileName, text: source.text, sector, stage, storagePath: source.storagePath, analysis: scored.analysis, document: source.document });
  // Beside the score, not part of it: runs after scoring, on the same text, and can't fail the report.
  payload.proofreading = await proofreadCv(source.text);
  const id = await repo.createReport({ type: "cv_review", title: source.fileName, score: payload.analysis.score, payload, source: { id: source.id, storagePath: source.storagePath } });
  return { id, sourceId: source.id };
}

const readable = (s: CvSource | null): s is CvSource & { document: DocumentMeta } => !!s?.document;

/** Saves a version; a reused attempt key with different content is refused (nothing saved) and reported, not thrown. */
async function save(repo: Repo, input: SourceInput): Promise<CvSource | { conflict: true }> {
  try {
    return await repo.createSource(input);
  } catch (e) {
    if (e instanceof SourceConflictError) return { conflict: true };
    throw e;
  }
}
const conflicted = (s: CvSource | { conflict: true }): s is { conflict: true } => "conflict" in s;

/** Upload: read the file, keep it as an immutable version, then score it or hold it for the student's review. */
export async function uploadFlow(repo: Repo, rawInput: { bytes: Uint8Array; fileName: string; sector: string; stage: string; key: string }): Promise<UploadFlowResult> {
  const input = { ...rawInput, fileName: cleanFileName(rawInput.fileName) };
  let doc;
  try {
    doc = await extractDocument(input.bytes, input.fileName);
  } catch (e) {
    // An unreadable or over-limit file is an outcome, not a score: nothing is saved and nothing downstream runs.
    return e instanceof ExtractError ? { kind: "outcome", outcome: e.outcome() } : { kind: "error", error: "Something went wrong reading your file. Try again." };
  }
  const document = documentMeta(doc, input.bytes);
  const source = await save(repo, { kind: "upload", parentId: null, fileName: input.fileName, text: doc.text, document, outcome: null, file: { bytes: input.bytes, name: input.fileName, contentType: contentType(input.fileName) }, idempotencyKey: input.key });
  if (conflicted(source)) return { kind: "error", error: CONFLICT };
  if (!readable(source)) return { kind: "error", error: "Something went wrong saving your file. Try again." };
  if (source.reportId) return { kind: "scored", id: source.reportId, sourceId: source.id, reading: readingSummary(document), showReading: showReadingAfterScoring(document) };
  if (reviewBeforeScoring(document)) return { kind: "review", review: sourceReview(source) };
  const scored = await scoreVersion(repo, source, input.sector, input.stage);
  return "error" in scored ? { kind: "error", error: scored.error } : { kind: "scored", id: scored.id, sourceId: source.id, reading: readingSummary(document), showReading: showReadingAfterScoring(document) };
}

/** Score a version as it was read, after the student has looked at it. */
export async function scoreFlow(repo: Repo, sourceId: string, sector: string, stage: string): Promise<ScoreFlowResult> {
  const source = await repo.getSource(sourceId);
  if (!source) return { error: NOT_FOUND };
  if (!readable(source)) return { error: "That file couldn't be read as text, so it can't be scored. Type or paste your CV text instead." };
  return scoreVersion(repo, source, sector, stage);
}

/** The student's edits to a version's blocks become a new version with provenance, which is then scored. */
export async function correctFlow(repo: Repo, input: { sourceId: string; blocks: { id: string; text: string }[]; sector: string; stage: string; key: string }): Promise<ScoreFlowResult & { changed?: boolean }> {
  const parent = await repo.getSource(input.sourceId);
  if (!parent) return { error: NOT_FOUND };
  if (!readable(parent)) return { error: "That file couldn't be read as text, so there is nothing to correct. Type or paste your CV text instead." };
  const parentBlocks = contentBlocks(parent.text);
  const ids = new Set(parentBlocks.map((b) => b.id));
  if (input.blocks.some((b) => !ids.has(b.id))) return { error: STALE };
  if (input.blocks.some((b) => b.text.length > MAX_BLOCK_CHARS)) return { error: `One line is longer than ${MAX_BLOCK_CHARS} characters. Split it into two.` };
  const changes = contentChanges(parentBlocks, input.blocks);
  // Nothing changed: there is no new version to make, so the version the student reviewed is scored as it is.
  if (!changes.length) return { ...(await scoreVersion(repo, parent, input.sector, input.stage)), changed: false };
  const text = storableText(assembleContent(applyEdits(parentBlocks, input.blocks)));
  if (dense(text) < LIMITS.MIN_TEXT_CHARS) return { error: TOO_LITTLE };
  if (text.length > LIMITS.MAX_TEXT_CHARS) return { error: TOO_MUCH };
  const source: Extract<DocumentSource, { kind: "correction" }> = { kind: "correction", parentDocumentVersion: parent.documentVersion, correctedAt: new Date().toISOString(), by: "student", changes };
  const version = await save(repo, { kind: "correction", parentId: parent.id, fileName: correctedName(parent.fileName), text, document: documentMetaForText(text, source), outcome: null, idempotencyKey: input.key });
  if (conflicted(version)) return { error: CONFLICT };
  if (!readable(version)) return { error: "Something went wrong saving your corrections. Try again." };
  return { ...(await scoreVersion(repo, version, input.sector, input.stage)), changed: true };
}

/** "cv.pdf" -> "cv.pdf (corrected)"; a correction of a correction keeps one suffix. */
export const correctedName = (name: string) => (/\(corrected\)$/.test(name) ? name : `${name} (corrected)`.slice(0, 120));

/**
 * Text the student typed or pasted, for a file that could not be read (a scan). The unreadable original is kept
 * beside it as the immutable parent, with why it could not be read, so the lineage shows where the text came from.
 */
export async function pasteFlow(repo: Repo, input: { text: string; original: { bytes: Uint8Array; fileName: string } | null; sector: string; stage: string; key: string }): Promise<ScoreFlowResult> {
  const text = storableText(input.text).replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (dense(text) < LIMITS.MIN_TEXT_CHARS) return { error: TOO_LITTLE };
  if (text.length > LIMITS.MAX_TEXT_CHARS) return { error: TOO_MUCH };
  let parent: CvSource | null = null;
  let keptBytes: Uint8Array | null = null;
  if (input.original) {
    const { bytes } = input.original;
    const fileName = cleanFileName(input.original.fileName);
    let doc = null;
    let outcome: ReadOutcome | null = null;
    try {
      doc = await extractDocument(bytes, fileName);
    } catch (e) {
      if (!(e instanceof ExtractError)) throw e;
      outcome = e.outcome();
    }
    // The text still goes ahead; only a file that isn't a PDF or Word document at all is left out of storage.
    if (!outcome || !NOT_A_CV_FILE.has(outcome.code)) {
      keptBytes = bytes;
      const kept = await save(repo, {
      kind: "upload",
      parentId: null,
      fileName,
      text: doc?.text ?? "",
      document: doc ? documentMeta(doc, bytes) : null,
      outcome: outcome ? { kind: outcome.kind, code: outcome.code, message: outcome.message } : null,
      file: { bytes, name: fileName, contentType: contentType(fileName) },
      idempotencyKey: `${input.key}:original`,
      });
      if (conflicted(kept)) return { error: CONFLICT };
      parent = kept;
    }
  }
  const original = parent
    ? { fileName: parent.fileName, format: parent.document?.source.kind === "upload" ? parent.document.source.format : /\.pdf$/i.test(parent.fileName) ? ("pdf" as const) : /\.docx$/i.test(parent.fileName) ? ("docx" as const) : null, bytes: keptBytes!.byteLength, sha256: await fileSha(keptBytes!), outcome: parent.outcome }
    : null;
  const source: Extract<DocumentSource, { kind: "paste" }> = { kind: "paste", pastedAt: new Date().toISOString(), by: "student", original };
  const version = await save(repo, { kind: "paste", parentId: parent?.id ?? null, fileName: parent ? `${parent.fileName} (typed)`.slice(0, 120) : "Pasted CV text", text, document: documentMetaForText(text, source), outcome: null, idempotencyKey: input.key });
  if (conflicted(version)) return { error: CONFLICT };
  if (!readable(version)) return { error: "Something went wrong saving your text. Try again." };
  return scoreVersion(repo, version, input.sector, input.stage);
}

async function fileSha(bytes: Uint8Array): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}
