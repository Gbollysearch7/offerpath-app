import "server-only";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

export class ExtractError extends Error {}

/**
 * Rebuilds a PDF's text in reading order from where each piece sits on the page. Some PDF makers draw all
 * headings first and the bullets afterwards, so the raw order separates jobs from their bullets. Pages laid
 * out in two columns keep the raw order instead, because sorting by height would interleave the columns.
 * Plain JavaScript in a string, because it runs inside the parsing worker (and is compiled once for the
 * in-process fallback); a stringified function could pick up bundler helpers that don't exist there.
 */
const READING_ORDER_SOURCE = `async function readingOrder(pdf) {
  // Groups pieces of text into rows by height, left to right within a row, and records where each run of text
  // starts (a new run begins after a gap far wider than a word space).
  function toRows(glyphs) {
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
      for (const g of row.items) {
        if (end === null || g.x - end > g.h * 1.5) starts.push(g.x);
        if (end !== null) {
          const gap = g.x - end;
          if (gap > g.h * 0.15 && !/\\s$/.test(line) && !/^\\s/.test(g.s)) line += " ";
        }
        line += g.s;
        end = g.x + g.w;
      }
      return line.trim();
    });
    return { lines, rows: rows.length, starts };
  }

  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const width = page.view[2] - page.view[0];
    const content = await page.getTextContent();
    const glyphs = [];
    for (const it of content.items) {
      if (typeof it.str === "string" && it.str.trim()) glyphs.push({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || it.height || 10 });
    }
    const all = toRows(glyphs);
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
        const l = toRows(glyphs.filter((g) => g.x < gutter)).lines;
        const r = toRows(glyphs.filter((g) => g.x >= gutter)).lines;
        // The column with the name and contact details goes first.
        const contact = (ls) => ls.slice(0, 6).some((x) => /@/.test(x));
        lines = contact(r) && !contact(l) ? r.concat(l) : l.concat(r);
      }
    }
    pages.push(lines.join("\\n"));
  }
  return pages.join("\\n");
}`;

type ReadingOrder = (pdf: unknown) => Promise<string>;
let compiled: ReadingOrder | null = null;
/** The same reading-order code, for the in-process fallback and tests. */
export function pdfReadingOrderText(pdf: unknown): Promise<string> {
  compiled ??= new Function(`return (${READING_ORDER_SOURCE})`)() as ReadingOrder;
  return compiled(pdf);
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

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
/** A two-page CV is around 5,000-12,000 characters. Anything far beyond that isn't a CV. */
export const MAX_TEXT_CHARS = 40_000;
const MAX_PDF_PAGES = 10;
const MAX_DOCX_UNCOMPRESSED = 20 * 1024 * 1024;
const PARSE_TIMEOUT_MS = 20_000;
const WORKER_HEAP_MB = 256;

// Parsing runs in a separate worker thread with its own memory cap and a time limit, so a hostile
// file can't exhaust the server's memory or block other requests.
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
${READING_ORDER_SOURCE}
${DOCX_SOURCE}
(async () => {
  try {
    const { kind, bytes, paths, maxPages, maxChars } = workerData;
    let text = "";
    if (kind === "pdf") {
      const unpdf = require(paths.unpdf);
      const pdf = await unpdf.getDocumentProxy(new Uint8Array(bytes));
      if (pdf.numPages > maxPages) return parentPort.postMessage({ error: "pages", pages: pdf.numPages });
      text = await readingOrder(pdf);
    } else {
      const mammoth = require(paths.mammoth);
      text = await docxText(mammoth, Buffer.from(bytes));
    }
    parentPort.postMessage({ text: text.slice(0, maxChars + 1) });
  } catch (e) {
    parentPort.postMessage({ error: "parse", message: String((e && e.message) || e) });
  }
})();
`;

type WorkerResult = { text?: string; error?: "pages" | "parse"; pages?: number; message?: string };

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

function parseInWorker(kind: "pdf" | "docx", bytes: Uint8Array, paths: { unpdf: string; mammoth: string }): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { kind, bytes, paths, maxPages: MAX_PDF_PAGES, maxChars: MAX_TEXT_CHARS },
      resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB, maxYoungGenerationSizeMb: 32 },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new ExtractError("That file took too long to read. Try saving it again as a PDF."));
    }, PARSE_TIMEOUT_MS);
    worker.once("message", (m: WorkerResult) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(m);
    });
    worker.once("error", (e) => {
      clearTimeout(timer);
      reject(/OUT_OF_MEMORY/.test(String((e as NodeJS.ErrnoException).code)) ? new ExtractError("That file is too complex to read. Try saving it as a simpler PDF.") : e);
    });
  });
}

/** In-process fallback, used only if a worker can't be started. Same size and page caps apply. */
async function parseInProcess(kind: "pdf" | "docx", bytes: Uint8Array): Promise<WorkerResult> {
  try {
    if (kind === "pdf") {
      const { getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(bytes);
      if (pdf.numPages > MAX_PDF_PAGES) return { error: "pages", pages: pdf.numPages };
      return { text: await pdfReadingOrderText(pdf) };
    }
    const mammoth = await import("mammoth");
    return { text: await docxText(mammoth, Buffer.from(bytes)) };
  } catch (e) {
    return { error: "parse", message: e instanceof Error ? e.message : String(e) };
  }
}

async function checkDocxSize(bytes: Uint8Array) {
  // Refuse zip bombs before anything is inflated: check declared uncompressed sizes first.
  const JSZip = (await import("jszip")).default;
  let zip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new ExtractError("We couldn't read that Word file. Try saving it as a PDF.");
  }
  let total = 0;
  zip.forEach((_, f) => {
    total += (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  });
  if (total > MAX_DOCX_UNCOMPRESSED) throw new ExtractError("That Word file is unusually large inside. Save it as a PDF and try again.");
}

/** Pulls plain text from an uploaded PDF or Word file. Throws ExtractError with a message safe to show. */
export async function extractText(bytes: Uint8Array, fileName: string): Promise<string> {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new ExtractError("That file is over 2 MB. Try saving a smaller PDF.");
  const lower = fileName.toLowerCase();
  const kind = lower.endsWith(".pdf") ? "pdf" : lower.endsWith(".docx") ? "docx" : null;
  if (!kind) throw new ExtractError("Upload a PDF or Word (.docx) file.");
  if (kind === "docx") await checkDocxSize(bytes);

  const paths = libraryPaths();
  let result: WorkerResult;
  try {
    result = paths ? await parseInWorker(kind, bytes, paths) : await parseInProcess(kind, bytes);
  } catch (e) {
    if (e instanceof ExtractError) throw e;
    console.warn("[extract] worker unavailable, parsing in process", e);
    result = await parseInProcess(kind, bytes);
  }

  if (result.error === "pages") throw new ExtractError(`That PDF has ${result.pages} pages. Upload just your CV, ideally two pages.`);
  if (result.error === "parse") {
    if (/password/i.test(result.message ?? "")) throw new ExtractError("That PDF is password protected. Remove the password and upload it again.");
    throw new ExtractError(kind === "pdf" ? "We couldn't read that PDF. Try exporting it again from Word or Google Docs." : "We couldn't read that Word file. Try saving it as a PDF.");
  }
  const text = (result.text ?? "").replace(/\u0000/g, "").trim();
  // The worker cuts at MAX_TEXT_CHARS + 1, and trimming can take that one character back off, so check before trimming.
  if ((result.text ?? "").length > MAX_TEXT_CHARS) throw new ExtractError("That file has far more text than a CV. Upload just your CV, ideally two pages.");
  if (text.replace(/\s/g, "").length < 150) {
    throw new ExtractError("We couldn't find much text. If your CV is a scan or a photo, export it as a PDF with selectable text.");
  }
  return text;
}
