"use client";

import { useRef, useState, useTransition } from "react";
import { importStudents } from "@/app/actions/admin";
import { FormError } from "@/components/client";
import { parseCsv } from "@/lib/csv";
import type { ImportResult } from "@/lib/repo/types";

const EXAMPLE = `email,student_number,course,year_of_study,faculty,fee_status
jordan.reed@northfield.ac.uk,2104821,Economics,Year 3,Social sciences,home
amira.khan@northfield.ac.uk,2209134,Law,Year 3,Social sciences,international`;

export function ImportForm({ domain }: { domain: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const preview = text ? parseCsv(text, 6) : [];

  const onFile = async (f: File | undefined) => {
    setError(null);
    setResult(null);
    if (!f) return;
    if (f.size > 3_000_000) return setError("That file is too large. Split it into files of up to 5,000 students.");
    setFileName(f.name);
    setText(await f.text());
  };

  const submit = () =>
    start(async () => {
      setError(null);
      setResult(null);
      const res = await importStudents(text);
      if (res.error) setError(res.error);
      else {
        setResult(res.result ?? null);
        setColumns(res.columns ?? []);
      }
    });

  return (
    <>
      <section aria-labelledby="up-h" className="flex flex-col gap-4 rounded-3xl bg-white px-6 py-[22px]">
        <h2 id="up-h" className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
          1 · CHOOSE A CSV FILE
        </h2>
        <p className="m-0 text-sm leading-normal text-muted">
          One row per student with a header row. Only <span className="font-medium text-black">email</span> is required, and it must be an @{domain || "your-university"} address. Recognised columns: email, student number, course, year, faculty, fee status (home or international).
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept=".csv,text/csv" aria-label="Student records CSV file" className="sr-only-abs" onChange={(e) => onFile(e.target.files?.[0])} />
          <button type="button" onClick={() => fileRef.current?.click()} className="min-h-11 rounded-full border-0 bg-black px-[18px] text-sm font-medium text-white hover:bg-ink-2">
            Choose CSV file
          </button>
          <span className="text-sm text-muted">{fileName ?? "No file chosen"}</span>
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(EXAMPLE)}`} download="offerpath-student-records-example.csv" className="text-sm">
            Download an example file
          </a>
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-muted">Or paste CSV text</summary>
          <label className="mt-2 flex flex-col gap-1.5 text-sm">
            <span className="sr-only-abs">CSV text</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={EXAMPLE} className="resize-y rounded-[14px] border border-edge p-3 font-mono text-xs" />
          </label>
        </details>
      </section>

      {preview.length > 0 && (
        <section aria-labelledby="pv-h" className="flex flex-col gap-3 rounded-3xl bg-white px-6 py-[22px]">
          <h2 id="pv-h" className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
            2 · CHECK THE FIRST ROWS
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (i === 0 ? <th key={j} className="border-b border-line px-2 py-2 text-left font-mono text-[11px] font-normal text-subtle">{c}</th> : <td key={j} className="border-b border-line px-2 py-2">{c}</td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <FormError message={error} />
          <button type="button" disabled={pending} onClick={submit} className="min-h-11 self-start rounded-full border-0 bg-black px-[18px] text-sm font-medium text-white hover:bg-ink-2 disabled:opacity-60">
            {pending ? "Importing…" : "Import records"}
          </button>
        </section>
      )}
      {!preview.length && <FormError message={error} />}

      {result && (
        <section role="status" className="flex flex-col gap-2 rounded-3xl bg-mist px-6 py-[22px]">
          <p className="m-0 text-lg tracking-[-0.02em]">
            {result.saved} {result.saved === 1 ? "record" : "records"} saved
          </p>
          <p className="m-0 text-sm text-body">
            Applied to {result.appliedToAccounts} existing {result.appliedToAccounts === 1 ? "account" : "accounts"}; the rest will apply when those students sign up. Columns used: {columns.join(", ")}.
          </p>
          {result.skipped.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer">
                {result.skipped.length} {result.skipped.length === 1 ? "row" : "rows"} skipped
              </summary>
              <ul className="mt-2 mb-0 pl-5">
                {result.skipped.slice(0, 50).map((s) => (
                  <li key={s.row}>
                    Row {s.row}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </>
  );
}
