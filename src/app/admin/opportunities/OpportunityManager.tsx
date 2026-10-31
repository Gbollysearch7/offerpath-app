"use client";

import { useRef, useState, useTransition } from "react";
import { deleteOpportunity, importOpportunities, saveOpportunity } from "@/app/actions/admin";
import { FormError } from "@/components/client";
import { cx } from "@/components/ui";
import type { Opportunity, OpportunityInput } from "@/lib/types";

const TYPES = ["Graduate scheme", "Internship", "Placement", "Spring week"] as const;
const field = "min-h-11 rounded-[12px] border border-edge bg-white px-3 text-[15px] font-normal text-black";
const fmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const blank = (today: string): OpportunityInput => ({ role: "", org: "", location: "", type: "Graduate scheme", sector: "Finance and banking", sponsorsVisa: false, closesOn: today, description: "", url: "" });

export function OpportunityManager({ opps, sectors, today }: { opps: Opportunity[]; sectors: string[]; today: string }) {
  const [editing, setEditing] = useState<OpportunityInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const own = opps.filter((o) => o.own);
  const shared = opps.filter((o) => !o.own);

  const run = (fn: () => Promise<{ error?: string }>, done: string, after?: () => void) =>
    start(async () => {
      setError(null);
      setStatus(null);
      const res = await fn();
      if (res.error) setError(res.error);
      else {
        setStatus(done);
        after?.();
      }
    });

  const set = <K extends keyof OpportunityInput>(k: K, v: OpportunityInput[K]) => setEditing((e) => (e ? { ...e, [k]: v } : e));

  return (
    <>
      <div className="flex flex-wrap gap-2.5">
        <button type="button" onClick={() => setEditing(blank(today))} className="min-h-11 rounded-full border-0 bg-black px-[18px] text-sm font-medium text-white hover:bg-ink-2">
          Add an opportunity
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          aria-label="Opportunities CSV file"
          className="sr-only-abs"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const text = await f.text();
            start(async () => {
              setError(null);
              const res = await importOpportunities(text);
              if (res.error) setError(res.error);
              else setStatus(`${res.saved} imported${res.skipped?.length ? `, ${res.skipped.length} skipped (${res.skipped.slice(0, 3).map((s) => `row ${s.row}`).join(", ")}: missing role, employer or closing date)` : ""}.`);
            });
            e.target.value = "";
          }}
        />
        <button type="button" disabled={pending} onClick={() => fileRef.current?.click()} className="min-h-11 rounded-full border border-edge bg-white px-[18px] text-sm text-black hover:bg-paper disabled:opacity-60">
          Import from CSV
        </button>
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent("role,employer,location,type,sector,visa sponsorship,closing date,link,description\nGraduate Analyst,Example Ltd,Leeds,Graduate scheme,Finance and banking,yes,30/11/2026,https://example.com/jobs/1,Two-year rotational programme.")}`} download="offerpath-opportunities-example.csv" className="inline-flex min-h-11 items-center text-sm">
          Example CSV
        </a>
      </div>
      <FormError message={error} />
      {status && (
        <p role="status" className="m-0 text-sm text-brand">
          {status}
        </p>
      )}

      {editing && (
        <form
          aria-label={editing.id ? "Edit opportunity" : "Add opportunity"}
          className="flex flex-col gap-4 rounded-3xl bg-white px-6 py-[22px]"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveOpportunity(editing), editing.id ? "Opportunity updated." : "Opportunity added.", () => setEditing(null));
          }}
        >
          <h2 className="m-0 text-xl font-normal tracking-[-0.03em]">{editing.id ? "Edit opportunity" : "Add an opportunity"}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Role
              <input required value={editing.role} onChange={(e) => set("role", e.target.value)} className={field} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Employer
              <input required value={editing.org} onChange={(e) => set("org", e.target.value)} className={field} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Location
              <input required value={editing.location} onChange={(e) => set("location", e.target.value)} className={field} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Closing date
              <input required type="date" value={editing.closesOn} onChange={(e) => set("closesOn", e.target.value)} className={field} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Type
              <select value={editing.type} onChange={(e) => set("type", e.target.value as OpportunityInput["type"])} className={field}>
                {TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Sector
              <select value={editing.sector} onChange={(e) => set("sector", e.target.value)} className={field}>
                {sectors.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
              Link to apply <span className="font-normal text-subtle">Optional</span>
              <input type="url" value={editing.url ?? ""} onChange={(e) => set("url", e.target.value)} placeholder="https://" className={field} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
              Description <span className="font-normal text-subtle">Used when students tailor their CV to this role</span>
              <textarea rows={5} value={editing.description} onChange={(e) => set("description", e.target.value)} className="resize-y rounded-[12px] border border-edge p-3 text-[15px] font-normal" />
            </label>
          </div>
          <label className="flex items-center gap-2.5 text-sm">
            <input type="checkbox" checked={editing.sponsorsVisa} onChange={(e) => set("sponsorsVisa", e.target.checked)} className="h-[18px] w-[18px] accent-brand" />
            Sponsors Skilled Worker visas
          </label>
          <div className="flex gap-2.5">
            <button type="submit" disabled={pending} className="min-h-11 rounded-full border-0 bg-black px-[18px] text-sm font-medium text-white hover:bg-ink-2 disabled:opacity-60">
              {pending ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="min-h-11 rounded-full border border-edge bg-white px-[18px] text-sm text-black">
              Cancel
            </button>
          </div>
        </form>
      )}

      {[
        ["YOUR UNIVERSITY'S LISTINGS", own, true],
        ["SHARED LISTINGS", shared, false],
      ].map(([label, list, editable]) => (
        <section key={label as string} className="rounded-3xl bg-white px-6 py-[22px]">
          <h2 className="mt-0 mb-2 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
            {label as string} · {(list as Opportunity[]).length}
          </h2>
          {(list as Opportunity[]).length === 0 && <p className="m-0 border-t border-line py-3 text-sm text-muted">{editable ? "None yet. Add one, or import a CSV." : "None."}</p>}
          {(list as Opportunity[]).map((o) => (
            <div key={o.id} className="flex flex-wrap items-center gap-3 border-t border-line py-3">
              <span className="min-w-[240px] flex-1">
                <span className="block text-[15px]">{o.role}</span>
                <span className="block text-[13px] text-subtle">
                  {o.org} · {o.location} · {o.type} · closes {fmt(o.closesOn)}
                  {o.closesOn < today && <span className="ml-1.5 rounded-full bg-black px-2 py-0.5 text-[11px] text-white">Closed</span>}
                </span>
              </span>
              {editable ? (
                <span className="flex gap-2">
                  <button type="button" onClick={() => setEditing({ ...o, url: o.url ?? "" })} className={cx("min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper")} aria-label={`Edit ${o.role}`}>
                    Edit
                  </button>
                  <button type="button" disabled={pending} onClick={() => run(() => deleteOpportunity(o.id), "Opportunity removed.")} className="min-h-10 rounded-full border-0 bg-transparent px-3 text-sm text-muted hover:text-black" aria-label={`Remove ${o.role}`}>
                    Remove
                  </button>
                </span>
              ) : (
                <span className="text-[13px] text-subtle">Shared</span>
              )}
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
