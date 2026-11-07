import JSZip from "jszip";
import { parseCsv, rowsToObjects } from "@/lib/csv";
import { cleanSection, SECTION_LIMIT } from "./linkedin-input";
import { LINKEDIN_SECTIONS, type LinkedinSectionKey } from "@/lib/linkedin-types";

// OP-018: the one supported export: the CSV files in the data archive a student requests from LinkedIn themselves,
// uploaded as the ZIP or as individual CSVs. The file list and column names below are written from LinkedIn's documented
// archive and have not been tested against a current real archive; a file with other columns is refused or reported
// rather than guessed at.
//
// An archive holds much more than a profile: messages, connections, addresses, dates of birth, ad data. Only the
// allow-listed files are opened and only the allow-listed columns are read. The upload itself is never stored.

export const MAX_EXPORT_BYTES = 2 * 1024 * 1024;
export const MAX_FILES = 12;
const MAX_ZIP_ENTRIES = 2_000;
/** Real size of one CSV once inflated, whatever the archive claims. */
const MAX_CSV_BYTES = 1024 * 1024;

type Parsed = { heading: (r: Record<string, string>) => string; body: (r: Record<string, string>) => string };

const dates = (r: Record<string, string>) => [r.start, r.end].filter(Boolean).join(" - ");
const joined = (...parts: (string | undefined)[]) => parts.map((p) => p?.trim()).filter(Boolean).join(", ");
const bullets = (s: string | undefined) =>
  (s ?? "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^[•\-*–]/.test(l) ? l : `• ${l}`))
    .join("\n");

/** Each file we read, the columns we read from it, and where its text goes. Every other column is never read. */
const FILES: Record<string, { section: LinkedinSectionKey; label?: string; columns: Record<string, string[]>; render: Parsed }> = {
  positions: {
    section: "experience",
    columns: { title: ["title"], org: ["company name", "company"], text: ["description"], location: ["location"], start: ["started on"], end: ["finished on"] },
    render: { heading: (r) => `${joined(r.title && r.org ? `${r.title} at ${r.org}` : r.title || r.org, dates(r))}`, body: (r) => bullets(r.text) },
  },
  education: {
    section: "education",
    columns: { school: ["school name"], degree: ["degree name"], start: ["start date"], end: ["end date"], text: ["notes"], activities: ["activities"] },
    render: { heading: (r) => joined(r.degree, r.school, dates(r)), body: (r) => [r.text, r.activities].filter(Boolean).join("\n") },
  },
  skills: { section: "skills", columns: { name: ["name"] }, render: { heading: (r) => r.name ?? "", body: () => "" } },
  certifications: { section: "other", label: "Certifications", columns: { name: ["name"], authority: ["authority"], start: ["started on"], end: ["finished on"] }, render: { heading: (r) => joined(r.name, r.authority, dates(r)), body: () => "" } },
  projects: { section: "other", label: "Projects", columns: { title: ["title"], text: ["description"], start: ["started on"], end: ["finished on"] }, render: { heading: (r) => joined(r.title, dates(r)), body: (r) => r.text ?? "" } },
  volunteering: { section: "other", label: "Volunteering", columns: { role: ["role"], org: ["company name", "organization", "organisation"], text: ["description"], start: ["started on"], end: ["finished on"] }, render: { heading: (r) => joined(r.role, r.org, dates(r)), body: (r) => r.text ?? "" } },
  honors: { section: "other", label: "Awards", columns: { title: ["title"], text: ["description"], issued: ["issued on"] }, render: { heading: (r) => joined(r.title, r.issued), body: (r) => r.text ?? "" } },
  languages: { section: "other", label: "Languages", columns: { name: ["name"], level: ["proficiency"] }, render: { heading: (r) => joined(r.name, r.level), body: () => "" } },
};
/** Profile.csv holds an address, a date of birth and more. Only these two columns are ever read from it. */
const PROFILE_COLUMNS = { headline: ["headline"], summary: ["summary"] };

export interface ExportResult {
  sections: Record<LinkedinSectionKey, string>;
  files: string[];
  skippedFiles: number;
}

export class ExportError extends Error {}

const baseName = (path: string) => (path.split(/[\\/]/).pop() ?? "").toLowerCase();
const kindOf = (name: string) => name.replace(/\.csv$/, "");

interface ZipStream {
  on(event: string, fn: (chunk: Uint8Array) => void): ZipStream;
  resume(): void;
  pause(): void;
}

/** Inflates one entry and stops at the limit, however large the archive says the entry is. */
function readBounded(entry: JSZip.JSZipObject, limit: number): Promise<string> {
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
          reject(new ExportError("A file in that archive is far larger than a profile should be. Upload just Profile.csv, Positions.csv, Education.csv and Skills.csv."));
          return;
        }
        chunks.push(chunk);
      })
      .on("error", () => {
        if (done) return;
        done = true;
        reject(new ExportError("We couldn't read that archive. Try uploading the CSV files on their own."));
      })
      .on("end", () => {
        if (done) return;
        done = true;
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
    stream.resume();
  });
}

/** Some exports start with notes above the columns, so the header is looked for in the first few rows. */
function table<K extends string>(text: string, columns: Record<K, string[]>): Partial<Record<K, string>>[] | null {
  const rows = parseCsv(text, 2_000);
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const { records, matched } = rowsToObjects(rows.slice(i), columns);
    if (matched.length) return records;
  }
  return null;
}

function read(name: string, text: string, into: Record<LinkedinSectionKey, string[]>): boolean {
  const kind = kindOf(name);
  if (kind === "profile") {
    const rows = table(text, PROFILE_COLUMNS);
    if (!rows) return false;
    if (rows[0]?.headline) into.headline.push(rows[0].headline);
    if (rows[0]?.summary) into.about.push(rows[0].summary);
    return true;
  }
  const file = FILES[kind];
  if (!file) return false;
  const rows = table(text, file.columns as Record<string, string[]>);
  if (!rows) return false;
  const blocks = rows.map((r) => [file.render.heading(r as Record<string, string>), file.render.body(r as Record<string, string>)].filter(Boolean).join("\n")).filter(Boolean);
  if (blocks.length) {
    const joinWith = file.section === "skills" ? ", " : "\n";
    const body = blocks.join(joinWith);
    into[file.section].push(file.label ? `${file.label}\n${body}` : body);
  }
  return true;
}

const known = (name: string) => name.endsWith(".csv") && (kindOf(name) === "profile" || kindOf(name) in FILES);

/** Reads what the student uploaded: one ZIP, or CSVs. Throws ExportError with a message written for the student. */
export async function readLinkedinExport(uploads: { name: string; bytes: Uint8Array }[]): Promise<ExportResult> {
  if (!uploads.length) throw new ExportError("Choose your LinkedIn export to upload.");
  if (uploads.length > MAX_FILES) throw new ExportError(`Upload at most ${MAX_FILES} files.`);
  if (uploads.reduce((n, u) => n + u.bytes.length, 0) > MAX_EXPORT_BYTES) throw new ExportError("That's over 2 MB. A full archive can be large: upload just Profile.csv, Positions.csv, Education.csv and Skills.csv instead.");
  const into = Object.fromEntries(LINKEDIN_SECTIONS.map((k) => [k, [] as string[]])) as Record<LinkedinSectionKey, string[]>;
  const files: string[] = [];
  let skippedFiles = 0;

  const take = (name: string, text: string) => {
    if (read(name, text, into)) files.push(name);
    else throw new ExportError(`${name} doesn't have the columns we expect, so we can't read it. Paste that section instead.`);
  };

  for (const upload of uploads) {
    const name = baseName(upload.name);
    if (name.endsWith(".csv")) {
      if (upload.bytes.length > MAX_CSV_BYTES) throw new ExportError(`${name} is larger than a profile should be.`);
      if (known(name)) take(name, Buffer.from(upload.bytes).toString("utf8"));
      else skippedFiles++;
      continue;
    }
    if (!name.endsWith(".zip")) throw new ExportError(`We can read LinkedIn's CSV data export, as the ZIP or as CSV files. We can't read ${name.endsWith(".pdf") ? "a profile PDF" : "that file"}: paste your sections instead.`);
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(upload.bytes);
    } catch {
      throw new ExportError("That file isn't a ZIP we can read. Try uploading the CSV files on their own.");
    }
    const entries = Object.values(zip.files);
    if (entries.length > MAX_ZIP_ENTRIES) throw new ExportError("That archive has too many files. Upload just Profile.csv, Positions.csv, Education.csv and Skills.csv.");
    for (const entry of entries) {
      if (entry.dir) continue;
      const entryName = baseName(entry.name);
      // Anything not on the list isn't opened: messages and connections stay compressed and are forgotten with the upload.
      if (!known(entryName)) {
        skippedFiles++;
        continue;
      }
      take(entryName, await readBounded(entry, MAX_CSV_BYTES));
    }
  }

  if (!files.length) throw new ExportError("We didn't find any profile files we recognise (such as Profile.csv or Positions.csv). Paste your sections instead.");
  const sections = {} as Record<LinkedinSectionKey, string>;
  for (const key of LINKEDIN_SECTIONS) {
    const text = cleanSection(into[key].join("\n\n"));
    if (text.length > SECTION_LIMIT[key]) throw new ExportError(`The ${key} part of your export is longer than we can read. Paste a shorter version instead.`);
    sections[key] = text;
  }
  return { sections, files, skippedFiles };
}
