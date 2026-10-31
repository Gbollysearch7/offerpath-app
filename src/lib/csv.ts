/** One CSV cell, safe to open in Excel or LibreOffice. */
export const csvCell = (v: unknown) => {
  // Strip control characters (a bare CR starts a new row in Excel), neutralise formulas, quote separators.
  const s = (v === null || v === undefined ? "" : String(v)).replace(/[\u0000-\u001f\u007f]+/g, " ");
  const safe = /^[\s]*[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\n");

/** Parses CSV text (quoted fields, escaped quotes, CRLF) into rows of cells. */
export function parseCsv(text: string, maxRows = 10_000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
      if (rows.length > maxRows) break;
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows.slice(0, maxRows + 1);
}

/** Turns CSV rows into objects using the header row, matching each field to a list of accepted header names. */
export function rowsToObjects<K extends string>(rows: string[][], fields: Record<K, string[]>): { records: Partial<Record<K, string>>[]; matched: K[] } {
  const [header = [], ...body] = rows;
  const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const index = {} as Record<K, number>;
  for (const [key, names] of Object.entries(fields) as [K, string[]][]) {
    index[key] = header.findIndex((h) => names.includes(norm(h)));
  }
  const matched = (Object.keys(index) as K[]).filter((k) => index[k] >= 0);
  const records = body.map((r) => Object.fromEntries(matched.map((k) => [k, (r[index[k]] ?? "").trim()])) as Partial<Record<K, string>>);
  return { records, matched };
}
