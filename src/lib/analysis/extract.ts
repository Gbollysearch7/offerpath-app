import "server-only";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { log } from "@/lib/log";

/** Bump when the way text is read out of a file changes: reading order, Word conversion, what counts as a page. */
export const EXTRACTOR_VERSION = "extractor-2026-11-05.1";

export type DocumentFormat = "pdf" | "docx";

/**
 * Why a file could not be read. `unsupported`: the file is not something we can read as text (a scan, a
 * protected or corrupt file, the wrong type). `rejected`: the file is outside a processing limit. Neither is
 * a verdict on the CV: no score exists for a file that produced one of these.
 */
export type ExtractKind = "unsupported" | "rejected";
export type ExtractCode =
  | "unsupported_type"
  | "not_pdf"
  | "not_docx"
  | "password"
  | "image_only"
  | "too_little_text"
  | "unreadable"
  | "empty"
  | "too_large"
  | "too_many_pages"
  | "too_much_text"
  | "too_complex"
  | "timeout"
  | "zip_too_large"
  | "zip_too_many_entries";

/** What the student is told. Every string is safe to show; none echoes the file's contents. */
export interface ReadOutcome {
  kind: ExtractKind;
  code: ExtractCode;
  message: string;
  detail: string;
  alternatives: string[];
}

export class ExtractError extends Error {
  constructor(
    readonly kind: ExtractKind,
    readonly code: ExtractCode,
    message: string,
    readonly detail: string,
    readonly alternatives: string[] = [],
  ) {
    super(message);
  }
  outcome(): ReadOutcome {
    return { kind: this.kind, code: this.code, message: this.message, detail: this.detail, alternatives: this.alternatives };
  }
}

const EXPORT_PDF = "Open the original in Word or Google Docs and export it as a PDF: the text stays selectable.";
const RETYPE = "If you only have a scan or a photo, retype it into one of our CV templates and upload that.";
const JUST_CV = "Upload just your CV, ideally two pages, without a cover letter or certificates.";

const unsupported = (code: ExtractCode, message: string, detail: string, alternatives: string[] = []) => new ExtractError("unsupported", code, message, detail, alternatives);
const rejected = (code: ExtractCode, message: string, detail: string, alternatives: string[] = []) => new ExtractError("rejected", code, message, detail, alternatives);

/* ---------- limits ---------- */

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
/** A two-page CV is around 5,000-12,000 characters. Anything far beyond that isn't a CV. */
export const MAX_TEXT_CHARS = 40_000;
/** Fewer non-space characters than this and nothing fair can be said about the CV. */
export const MIN_TEXT_CHARS = 150;
export const MAX_PDF_PAGES = 10;
/** Text objects on one PDF page. A dense page has a few thousand; far more is a pathological or hostile file. */
export const MAX_TEXT_ITEMS_PER_PAGE = 20_000;
export const MAX_DOCX_UNCOMPRESSED = 20 * 1024 * 1024;
/** Parts inside the .docx zip. A document has a few dozen; hundreds of images is still well under this. */
export const MAX_DOCX_ENTRIES = 1000;
export const PARSE_TIMEOUT_MS = 20_000;
const WORKER_HEAP_MB = 256;
/**
 * How far the server's memory may grow while one file is read. The heap cap above doesn't count typed arrays, and a
 * PDF's decompressed streams are typed arrays: a 1 MB PDF can inflate to gigabytes under a 256 MB heap cap. Measured
 * from outside the worker, so it holds whichever PDF filter or Word part is being expanded.
 */
export const MAX_PARSE_MEMORY_GROWTH_MB = 512;
const MEMORY_POLL_MS = 50;

/** The processing limits, in one place for the report and the tests. */
export const LIMITS = { MAX_UPLOAD_BYTES, MAX_TEXT_CHARS, MIN_TEXT_CHARS, MAX_PDF_PAGES, MAX_TEXT_ITEMS_PER_PAGE, MAX_DOCX_UNCOMPRESSED, MAX_DOCX_ENTRIES, PARSE_TIMEOUT_MS, WORKER_HEAP_MB, MAX_PARSE_MEMORY_GROWTH_MB } as const;

/* ---------- what extraction observes about the file ---------- */

/** Layout facts read from a PDF while its text was put in reading order. Counts, never text. */
export interface PdfSignals {
  pageCount: number;
  /** 1-based pages with no text at all: an image, or blank. */
  textless: number[];
  /** Pages read as two columns (left column, then right). */
  columnPages: number;
  /** Rows starting with a lone letter or digit in a different font: a bullet glyph from a symbol font that decoded to that character. */
  symbolMarkers: number;
  /** Rows made of three or more separate runs of text: table cells, or tab-separated columns. */
  tableRows: number;
  textItems: number;
}

/** Structural facts from a Word file's XML. Word has no pages until it is opened, so none of these is a page count. */
export interface DocxSignals {
  tables: number;
  /** Explicit page breaks the author inserted (w:br type="page"). */
  explicitBreaks: number;
  /** Page breaks Word cached from its last layout (w:lastRenderedPageBreak). A hint from another machine's rendering, not a measurement. */
  renderedBreaks: number;
  images: number;
}

export interface ExtractedDocument {
  /** The text the scorer sees. Byte for byte what `extractText` has always returned for the same file. */
  text: string;
  format: DocumentFormat;
  /** EXTRACTOR_VERSION of the code that read it. */
  extractor: string;
  /** PDF: each page's text as read, in order. Null for Word files, which have no pages until rendered. */
  pages: string[] | null;
  /** PDF: character offset in `text` where each page starts (page 1 at 0). Null for Word files. */
  pageStarts: number[] | null;
  pdf: PdfSignals | null;
  docx: DocxSignals | null;
}

/**
 * Rebuilds a PDF's text in reading order from where each piece sits on the page. Some PDF makers draw all
 * headings first and the bullets afterwards, so the raw order separates jobs from their bullets. Pages laid
 * out in two columns keep the raw order instead, because sorting by height would interleave the columns.
 * Returns the text page by page plus layout signals (counts only). The text is unchanged from before the
 * signals existed. Plain JavaScript in a string, because it runs inside the parsing worker (and is compiled
 * once for the in-process fallback); a stringified function could pick up bundler helpers that don't exist there.
 */
const READING_ORDER_SOURCE = `async function readingOrder(pdf, maxItems) {
  // Groups pieces of text into rows by height, left to right within a row, and records where each run of text
  // starts (a new run begins after a gap far wider than a word space). \`stats\`, when given, collects layout counts.
  function toRows(glyphs, stats) {
    const sorted = [...glyphs].sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const g of sorted) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(row.y - g.y) <= Math.max(2, g.h * 0.4)) row.items.push(g);
      else rows.push({ y: g.y, items: [g] });
    }
    const starts = [];
    const lines = rows.map((row) => {
      row.items.sort((a, b) => a.x - b.x);
      let line = "";
      let end = null;
      let runs = 0;
      for (const g of row.items) {
        if (end === null || g.x - end > g.h * 1.5) {
          starts.push(g.x);
          runs++;
        }
        if (end !== null) {
          const gap = g.x - end;
          if (gap > g.h * 0.15 && !/\\s$/.test(line) && !/^\\s/.test(g.s)) line += " ";
        }
        line += g.s;
        end = g.x + g.w;
      }
      if (stats) {
        if (runs >= 3) stats.tableRows++;
        // A lone letter or digit in a different font at the start of a row is a bullet drawn with a symbol
        // font (Wingdings, ZapfDingbats) whose glyph decoded to that character. The text keeps the character.
        const first = row.items[0];
        const next = row.items.find((g) => g !== first && g.s.trim().length > 1);
        if (first && next && first.s.trim().length === 1 && /[A-Za-z0-9]/.test(first.s.trim()) && first.f !== next.f) stats.symbolMarkers++;
      }
      return line.trim();
    });
    return { lines, rows: rows.length, starts };
  }

  const pages = [];
  const signals = { pageCount: pdf.numPages, textless: [], columnPages: 0, symbolMarkers: 0, tableRows: 0, textItems: 0 };
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const width = page.view[2] - page.view[0];
    const content = await page.getTextContent();
    if (maxItems && content.items.length > maxItems) throw Object.assign(new Error("too many text items on page " + n), { code: "complex" });
    signals.textItems += content.items.length;
    const glyphs = [];
    for (const it of content.items) {
      if (typeof it.str === "string" && it.str.trim()) glyphs.push({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || it.height || 10, f: it.fontName });
    }
    if (!glyphs.length) signals.textless.push(n);
    let stats = { tableRows: 0, symbolMarkers: 0 };
    const all = toRows(glyphs, stats);
    let lines = all.lines;
    // Two columns: many runs of text start at the same point well right of the margin (right-aligned dates
    // and centred headings start at varying points). Read the left column, then the right.
    const left = Math.min(...glyphs.map((g) => g.x));
    const inner = all.starts.filter((x) => x > left + width * 0.2 && x < left + width * 0.75);
    if (all.rows && inner.length / all.rows > 0.3) {
      const counts = new Map();
      for (const x of inner) counts.set(Math.round(x / 10), (counts.get(Math.round(x / 10)) || 0) + 1);
      const [bucket, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
      if (count / inner.length >= 0.5) {
        const gutter = bucket * 10 - 6;
        // Rows that span both columns are not table rows, so the layout counts come from each column on its own.
        stats = { tableRows: 0, symbolMarkers: 0 };
        const l = toRows(glyphs.filter((g) => g.x < gutter), stats).lines;
        const r = toRows(glyphs.filter((g) => g.x >= gutter), stats).lines;
        // The column with the name and contact details goes first.
        const contact = (ls) => ls.slice(0, 6).some((x) => /@/.test(x));
        lines = contact(r) && !contact(l) ? r.concat(l) : l.concat(r);
        signals.columnPages++;
      }
    }
    signals.tableRows += stats.tableRows;
    signals.symbolMarkers += stats.symbolMarkers;
    pages.push(lines.join("\\n"));
  }
  return { pages, signals };
}`;

type ReadingOrder = (pdf: unknown, maxItems?: number) => Promise<{ pages: string[]; signals: PdfSignals }>;
let compiled: ReadingOrder | null = null;
/** The same reading-order code, for the in-process fallback and tests: the pages as read and the layout signals. */
export function pdfReadingOrder(pdf: unknown, maxItems = MAX_TEXT_ITEMS_PER_PAGE): Promise<{ pages: string[]; signals: PdfSignals }> {
  compiled ??= new Function(`return (${READING_ORDER_SOURCE})`)() as ReadingOrder;
  return compiled(pdf, maxItems);
}
/** The whole document's text in reading order, pages joined by a newline. */
export async function pdfReadingOrderText(pdf: unknown): Promise<string> {
  return (await pdfReadingOrder(pdf)).pages.join("\n");
}

/**
 * Word text via mammoth's HTML, not its raw text: raw text drops list bullets and the tab before right-aligned
 * dates, so bulleted CVs read as plain paragraphs and "Analyst" ran into "2024 – 2025". List items come back as
 * "• " lines. Plain JavaScript in a string for the same reason as READING_ORDER_SOURCE.
 */
const DOCX_SOURCE = `async function docxText(mammoth, buffer) {
  const noImages = mammoth.images.imgElement(() => Promise.resolve({ src: "" }));
  const html = (await mammoth.convertToHtml({ buffer }, { convertImage: noImages })).value;
  return html
    .replace(/<li[^>]*>/g, "\\n• ")
    .replace(/<br\\s*\\/?>|<\\/(p|li|h[1-6]|tr)>/g, "\\n")
    .replace(/<\\/t[dh]>/g, "\\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|#(\\d+));/g, (m, name, code) => code ? String.fromCharCode(Number(code)) : { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" }[name])
    .replace(/\\n{3,}/g, "\\n\\n");
}`;

let docxCompiled: ((mammoth: unknown, buffer: Buffer) => Promise<string>) | undefined;
const docxText = (mammoth: unknown, buffer: Buffer) => (docxCompiled ??= new Function(`return (${DOCX_SOURCE})`)())(mammoth, buffer);

// Parsing runs in a separate worker thread with its own memory cap and a time limit, so a hostile
// file can't exhaust the server's memory or block other requests.
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
${READING_ORDER_SOURCE}
${DOCX_SOURCE}
(async () => {
  try {
    const { kind, bytes, paths, maxPages, maxChars, maxItems } = workerData;
    if (kind === "pdf") {
      const unpdf = require(paths.unpdf);
      const pdf = await unpdf.getDocumentProxy(new Uint8Array(bytes));
      if (pdf.numPages > maxPages) return parentPort.postMessage({ error: "pages", pageCount: pdf.numPages });
      const { pages, signals } = await readingOrder(pdf, maxItems);
      const text = pages.join("\\n");
      // Over the text limit the file is refused, so only the cut text travels back.
      if (text.length > maxChars) return parentPort.postMessage({ text: text.slice(0, maxChars + 1) });
      return parentPort.postMessage({ text, pages, pdf: signals });
    }
    const mammoth = require(paths.mammoth);
    const text = await docxText(mammoth, Buffer.from(bytes));
    parentPort.postMessage({ text: text.slice(0, maxChars + 1) });
  } catch (e) {
    parentPort.postMessage(e && e.code === "complex" ? { error: "complex" } : { error: "parse", message: String((e && e.message) || e) });
  }
})();
`;

type WorkerResult = { text?: string; pages?: string[]; pdf?: PdfSignals; error?: "pages" | "parse" | "complex"; pageCount?: number; message?: string };

function libraryPaths(): { unpdf: string; mammoth: string } | null {
  try {
    // Loaded at runtime so the bundler doesn't try (and warn) to analyse a dynamic require.
    const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
    const req = createRequire(join(process.cwd(), "package.json"));
    return { unpdf: req.resolve("unpdf"), mammoth: req.resolve("mammoth") };
  } catch {
    return null;
  }
}

/** No worker could be started at all. The only case that may fall back to parsing in process. */
class WorkerStartError extends Error {}

/** Exported, with its source as a parameter, so the tests can run a misbehaving worker through the same limits. */
export function parseInWorker(kind: DocumentFormat, bytes: Uint8Array, paths: { unpdf: string; mammoth: string }, source: string = WORKER_SOURCE): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(source, {
        eval: true,
        // Captured, never read: libraries print warnings that quote the file (pdf.js names its fonts), and those mustn't reach the logs.
        stdout: true,
        stderr: true,
        workerData: { kind, bytes, paths, maxPages: MAX_PDF_PAGES, maxChars: MAX_TEXT_CHARS, maxItems: MAX_TEXT_ITEMS_PER_PAGE },
        resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB, maxYoungGenerationSizeMb: 32 },
      });
    } catch (e) {
      reject(new WorkerStartError(e instanceof Error ? e.message : "worker failed to start"));
      return;
    }
    let settled = false;
    const finish = (then: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(watchdog);
      void worker.terminate();
      then();
    };
    const timer = setTimeout(() => {
      finish(() => reject(rejected("timeout", "That file took too long to read. Try saving it again as a PDF.", `Reading stopped after ${PARSE_TIMEOUT_MS / 1000} seconds. Nothing was scored.`, [EXPORT_PDF])));
    }, PARSE_TIMEOUT_MS);
    const baseline = process.memoryUsage().rss;
    const watchdog = setInterval(() => {
      if (process.memoryUsage().rss - baseline > MAX_PARSE_MEMORY_GROWTH_MB * 1024 * 1024) finish(() => reject(tooComplex()));
    }, MEMORY_POLL_MS);
    worker.once("message", (m: WorkerResult) => finish(() => resolve(m)));
    // A file that kills its worker is refused here. It must never be retried on the server's main thread, which has no limits at all.
    worker.once("error", (e) => finish(() => reject(/OUT_OF_MEMORY/.test(String((e as NodeJS.ErrnoException).code)) ? tooComplex() : unreadableFile(kind))));
    worker.once("exit", () => finish(() => reject(unreadableFile(kind))));
  });
}

const unreadableFile = (kind: DocumentFormat) =>
  kind === "pdf"
    ? unsupported("unreadable", "We couldn't read that PDF. Try exporting it again from Word or Google Docs.", "The file is damaged or uses features our PDF reader doesn't support. Nothing was scored.", [EXPORT_PDF])
    : unsupported("unreadable", "We couldn't read that Word file. Try saving it as a PDF.", "The file is damaged or isn't a Word document. Nothing was scored.", [EXPORT_PDF]);

const tooComplex = () => rejected("too_complex", "That file is too complex to read. Try saving it as a simpler PDF.", "Reading it needed more memory or more text objects than we allow for a CV. Nothing was scored.", [EXPORT_PDF, JUST_CV]);

/** In-process fallback, used only if a worker can't be started. Same size and page caps apply. */
async function parseInProcess(kind: DocumentFormat, bytes: Uint8Array): Promise<WorkerResult> {
  try {
    if (kind === "pdf") {
      const { getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(bytes);
      if (pdf.numPages > MAX_PDF_PAGES) return { error: "pages", pageCount: pdf.numPages };
      const { pages, signals } = await pdfReadingOrder(pdf);
      const text = pages.join("\n");
      return text.length > MAX_TEXT_CHARS ? { text: text.slice(0, MAX_TEXT_CHARS + 1) } : { text, pages, pdf: signals };
    }
    const mammoth = await import("mammoth");
    return { text: (await docxText(mammoth, Buffer.from(bytes))).slice(0, MAX_TEXT_CHARS + 1) };
  } catch (e) {
    if ((e as { code?: string })?.code === "complex") return { error: "complex" };
    return { error: "parse", message: e instanceof Error ? e.message : String(e) };
  }
}

/* ---------- the file itself ---------- */

/** What the first bytes say the file is, whatever its name claims. */
function sniff(bytes: Uint8Array): "pdf" | "zip" | "ole" | "unknown" {
  // A PDF header may sit after a little junk; the spec allows it within the first 1,024 bytes.
  if (Buffer.from(bytes.subarray(0, 1024)).toString("latin1").includes("%PDF-")) return "pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "zip";
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return "ole";
  return "unknown";
}

function checkType(bytes: Uint8Array, fileName: string): DocumentFormat {
  const lower = fileName.toLowerCase();
  const kind: DocumentFormat | null = lower.endsWith(".pdf") ? "pdf" : lower.endsWith(".docx") ? "docx" : null;
  if (!kind) {
    const old = lower.endsWith(".doc") ? "That's an older Word (.doc) file. " : "";
    throw unsupported("unsupported_type", "Upload a PDF or Word (.docx) file.", `${old}We read PDF and Word (.docx) files. Other formats need exporting first.`, [EXPORT_PDF]);
  }
  const actual = sniff(bytes);
  if (kind === "pdf" && actual !== "pdf") {
    const what = actual === "zip" ? "It is a zip-based file, probably a Word document." : actual === "ole" ? "It is an older Word (.doc) file." : "Its contents don't start the way a PDF does.";
    throw unsupported("not_pdf", "That file isn't a PDF inside, even though its name ends in .pdf.", `${what} A PDF reader couldn't open it, so nothing was scored.`, [EXPORT_PDF]);
  }
  if (kind === "docx" && actual !== "zip") {
    const what = actual === "pdf" ? "It is actually a PDF." : actual === "ole" ? "It is an older Word (.doc) file, which we don't read." : "Its contents don't start the way a Word document does.";
    throw unsupported("not_docx", "That file isn't a Word document inside, even though its name ends in .docx.", `${what} Nothing was scored.`, actual === "pdf" ? ["Rename it to end in .pdf and upload it again."] : [EXPORT_PDF]);
  }
  return kind;
}

/**
 * Inflates one zip entry, stopping at `limit` bytes of output. The sizes in a zip's directory are whatever the file
 * says they are, so they can't be the only check: a forged entry can claim 1 KB and inflate to 1,000 times its
 * compressed size, on the server's main thread, before the worker and its limits come into it.
 */
interface ZipStream {
  on(event: "data", fn: (chunk: Uint8Array) => void): ZipStream;
  on(event: "error" | "end", fn: () => void): ZipStream;
  pause(): unknown;
  resume(): unknown;
}
function readBounded(entry: import("jszip").JSZipObject, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let done = false;
    const stream = (entry as unknown as { internalStream(type: "uint8array"): ZipStream }).internalStream("uint8array");
    stream
      .on("data", (chunk) => {
        if (done) return;
        total += chunk.length;
        if (total > limit) {
          done = true;
          stream.pause();
          reject(rejected("zip_too_large", "That Word file is unusually large inside. Save it as a PDF and try again.", "Its contents would expand to far more than a CV, so we stopped unpacking it. Nothing was scored.", [EXPORT_PDF]));
          return;
        }
        chunks.push(chunk);
      })
      .on("error", () => {
        if (done) return;
        done = true;
        // JSZip reports a mismatch between the claimed and the real size here: the archive is lying or damaged.
        reject(unsupported("unreadable", "We couldn't read that Word file. Try saving it as a PDF.", "The file's internal structure is damaged or isn't a Word document.", [EXPORT_PDF]));
      })
      .on("end", () => {
        if (done) return;
        done = true;
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
    stream.resume();
  });
}

/** Looks inside a .docx before anything is inflated: refuses zip bombs and over-stuffed archives, reads structural facts. */
async function inspectDocx(bytes: Uint8Array): Promise<DocxSignals> {
  const JSZip = (await import("jszip")).default;
  let zip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw unsupported("unreadable", "We couldn't read that Word file. Try saving it as a PDF.", "The file's internal structure is damaged or isn't a Word document.", [EXPORT_PDF]);
  }
  let total = 0;
  let entries = 0;
  zip.forEach((_, f) => {
    entries++;
    total += (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  });
  if (entries > MAX_DOCX_ENTRIES) throw rejected("zip_too_many_entries", "That Word file has far more parts inside than a document needs. Save it as a PDF and try again.", `It holds ${entries} internal files; a CV needs a few dozen at most. Nothing was scored.`, [EXPORT_PDF]);
  if (total > MAX_DOCX_UNCOMPRESSED) throw rejected("zip_too_large", "That Word file is unusually large inside. Save it as a PDF and try again.", "Its contents would expand to far more than a CV, so we didn't unpack it. Nothing was scored.", [EXPORT_PDF]);
  const main = zip.file("word/document.xml");
  if (!main) throw unsupported("not_docx", "That file isn't a Word document inside, even though its name ends in .docx.", "It is a zip archive without a Word document in it. Nothing was scored.", [EXPORT_PDF]);
  const xml = await readBounded(main, MAX_DOCX_UNCOMPRESSED);
  const count = (re: RegExp) => (xml.match(re) ?? []).length;
  return { tables: count(/<w:tbl>/g), explicitBreaks: count(/<w:br\b[^>]*w:type="page"/g), renderedBreaks: count(/<w:lastRenderedPageBreak\b/g), images: count(/<w:drawing>|<w:pict\b/g) };
}

/** Character offset in `text` where each page begins, allowing for the NUL removal and trim applied to the joined pages. */
function pageStartsIn(pages: string[], text: string): number[] {
  const clean = pages.map((p) => p.replace(/\u0000/g, ""));
  const joined = clean.join("\n");
  const lead = joined.length - joined.trimStart().length;
  const starts: number[] = [];
  let offset = 0;
  for (const p of clean) {
    starts.push(Math.min(text.length, Math.max(0, offset - lead)));
    offset += p.length + 1;
  }
  return starts;
}

/**
 * Reads an uploaded PDF or Word file: the text the scorer will see, plus where its pages begin and what the
 * layout looked like. Throws ExtractError, with a message safe to show, when the file can't be read as text
 * (`unsupported`) or is outside a processing limit (`rejected`). A file that throws is never scored.
 */
export async function extractDocument(bytes: Uint8Array, fileName: string): Promise<ExtractedDocument> {
  if (bytes.byteLength === 0) throw rejected("empty", "That file is empty.", "It has no contents to read.", [EXPORT_PDF]);
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw rejected("too_large", "That file is over 2 MB. Try saving a smaller PDF.", "A CV exported as a PDF is usually well under 1 MB. Large files are mostly images, which we can't read anyway.", [EXPORT_PDF, JUST_CV]);
  const kind = checkType(bytes, fileName);
  const docx = kind === "docx" ? await inspectDocx(bytes) : null;

  const paths = libraryPaths();
  let result: WorkerResult;
  try {
    result = paths ? await parseInWorker(kind, bytes, paths) : await parseInProcess(kind, bytes);
  } catch (e) {
    if (!(e instanceof WorkerStartError)) throw e;
    log("warn", "extract-worker-unavailable", { error: e });
    result = await parseInProcess(kind, bytes);
  }

  if (result.error === "pages") throw rejected("too_many_pages", `That PDF has ${result.pageCount} pages. Upload just your CV, ideally two pages.`, `We read up to ${MAX_PDF_PAGES} pages. Nothing was scored.`, [JUST_CV]);
  if (result.error === "complex") throw tooComplex();
  if (result.error === "parse") {
    if (/password/i.test(result.message ?? "")) throw unsupported("password", "That PDF is password protected. Remove the password and upload it again.", "We can't read protected files and don't try to break the protection. Nothing was scored.", ["In your PDF reader, save a copy without a password, then upload the copy."]);
    throw kind === "pdf"
      ? unsupported("unreadable", "We couldn't read that PDF. Try exporting it again from Word or Google Docs.", "The file is damaged or uses features our PDF reader doesn't support. Nothing was scored.", [EXPORT_PDF])
      : unsupported("unreadable", "We couldn't read that Word file. Try saving it as a PDF.", "The file is damaged or isn't a Word document. Nothing was scored.", [EXPORT_PDF]);
  }
  const raw = result.text ?? "";
  // The worker cuts at MAX_TEXT_CHARS + 1, and trimming can take that one character back off, so check before trimming.
  if (raw.length > MAX_TEXT_CHARS) throw rejected("too_much_text", "That file has far more text than a CV. Upload just your CV, ideally two pages.", `We read up to ${MAX_TEXT_CHARS.toLocaleString("en-GB")} characters, several times a two-page CV. Nothing was scored.`, [JUST_CV]);
  const text = raw.replace(/\u0000/g, "").trim();
  const pdf = result.pdf ?? null;
  if (pdf && pdf.pageCount === 0) throw unsupported("unreadable", "We couldn't read that PDF. Try exporting it again from Word or Google Docs.", "It has no pages. Nothing was scored.", [EXPORT_PDF]);

  const dense = text.replace(/\s/g, "").length;
  if (dense < MIN_TEXT_CHARS) {
    if (pdf && pdf.textless.length === pdf.pageCount) {
      throw unsupported("image_only", "We couldn't find any text in that PDF.", `${pdf.pageCount === 1 ? "Its page is" : `All ${pdf.pageCount} pages are`} a picture (a scan or a photo) or blank, so there is no text to assess. Offerpath doesn't read scanned images, and it hasn't scored this file.`, [EXPORT_PDF, RETYPE]);
    }
    if (docx && docx.images > 0 && dense === 0) {
      throw unsupported("image_only", "We couldn't find any text in that Word file.", "It holds pictures but no text, so there is nothing to assess. Offerpath doesn't read scanned images, and it hasn't scored this file.", [EXPORT_PDF, RETYPE]);
    }
    throw unsupported("too_little_text", "We couldn't find much text in that file.", `Fewer than ${MIN_TEXT_CHARS} characters came out, which isn't enough to say anything fair about a CV. If your CV is a scan or a photo, its text isn't selectable. Nothing was scored.`, [EXPORT_PDF, RETYPE]);
  }
  const pages = result.pages ?? null;
  return { text, format: kind, extractor: EXTRACTOR_VERSION, pages, pageStarts: pages ? pageStartsIn(pages, text) : null, pdf, docx };
}

/** Pulls plain text from an uploaded PDF or Word file. Throws ExtractError with a message safe to show. */
export async function extractText(bytes: Uint8Array, fileName: string): Promise<string> {
  return (await extractDocument(bytes, fileName)).text;
}
