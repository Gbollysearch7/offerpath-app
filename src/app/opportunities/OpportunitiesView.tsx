"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { moveApplication, trackOpportunity } from "@/app/actions/tailor";
import { announce, focusSoon, onTabListKey } from "@/components/a11y";
import { FormError, Switch } from "@/components/client";
import { cx, pill } from "@/components/ui";
import { SECTORS } from "@/lib/analysis/lexicon";
import { APP_STATUS_LABEL, type Application, type AppStatus, type Opportunity } from "@/lib/types";

const TYPES = ["All", "Graduate scheme", "Internship", "Placement", "Spring week"] as const;
const COLS: AppStatus[] = ["saved", "applied", "tests", "interview", "offer"];
const fmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const days = (d: string, today: string) => Math.round((new Date(d).getTime() - new Date(today).getTime()) / 864e5);

export function OpportunitiesView({ opps, apps, defaultSector, defaultVisa, today }: { opps: Opportunity[]; apps: Application[]; defaultSector: string; defaultVisa: boolean; today: string }) {
  const [tab, setTab] = useState(0);
  const [type, setType] = useState<(typeof TYPES)[number]>("All");
  const [sector, setSector] = useState(defaultSector);
  const [visa, setVisa] = useState(defaultVisa);
  const [soon, setSoon] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Asks before stopping: an application can hold links to documents, and they don't come back by themselves.
  const [stopping, setStopping] = useState<string | null>(null);

  const tracked = new Set(apps.map((a) => a.opportunityId));
  const list = useMemo(
    () =>
      opps
        .filter((o) => days(o.closesOn, today) >= 0)
        .filter((o) => (type === "All" || o.type === type) && (sector === "All sectors" || o.sector === sector) && (!visa || o.sponsorsVisa) && (!soon || days(o.closesOn, today) <= 30))
        .sort((a, b) => a.closesOn.localeCompare(b.closesOn)),
    [opps, type, sector, visa, soon, today],
  );

  const act = (fn: () => Promise<{ error?: string }>, said?: string) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error);
      else if (said) announce(said);
    });
  // A moved card is redrawn in its new column, so its control is a new element. Focus follows it there.
  const moved = useRef<string | null>(null);
  useEffect(() => {
    if (moved.current) document.getElementById(`move-${moved.current}`)?.focus();
    moved.current = null;
  }, [apps]);

  return (
    <main id="main" className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 pt-6 pb-14 sm:px-7">
      <div className="flex flex-wrap items-end justify-between gap-4 px-1 pt-2 pb-1">
        <div>
          <h1 className="m-0 text-[34px] font-normal leading-[1.1] tracking-[-1.5px] sm:text-[44px] sm:tracking-[-1.98px]">Opportunities</h1>
          <p className="mt-2 mb-0 text-[15px] text-muted">UK graduate schemes, spring weeks, placements and internships, with deadlines and reminders.</p>
        </div>
        <div role="tablist" aria-label="View" onKeyDown={onTabListKey} className="flex gap-1 rounded-full bg-white p-1">
          {["Browse", `My applications · ${apps.length}`].map((label, i) => (
            <button key={label} type="button" role="tab" id={`opp-tab-${i}`} aria-selected={tab === i} tabIndex={tab === i ? 0 : -1} aria-controls="opp-panel" onClick={() => setTab(i)} className={cx("min-h-10 rounded-full border-0 px-[18px] text-sm", tab === i ? "bg-black text-white" : "bg-transparent text-muted")}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <FormError message={error} />

      {tab === 0 ? (
        <div id="opp-panel" role="tabpanel" aria-labelledby="opp-tab-0" className="flex flex-wrap items-start gap-5">
          <aside aria-label="Filters" className="flex w-full flex-col gap-[18px] rounded-3xl bg-white p-[22px] lg:max-w-[280px] lg:flex-[1_1_260px]">
            <div>
              <p className="mt-0 mb-2.5 font-mono text-[11px] text-subtle">TYPE</p>
              <div className="flex flex-wrap gap-2">
                {TYPES.map((t) => (
                  <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)} className={pill(type === t, "sm")}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mt-0 mb-2.5 font-mono text-[11px] text-subtle">SECTOR</p>
              <label>
                <span className="sr-only-abs">Sector</span>
                <select value={sector} onChange={(e) => setSector(e.target.value)} className="min-h-11 w-full rounded-xl border border-edge bg-white px-3 text-sm">
                  <option>All sectors</option>
                  {SECTORS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-3 border-t border-line pt-4">
              <div className="flex-1">
                <p className="m-0 text-[15px]">Visa sponsorship</p>
                <p className="mt-0.5 mb-0 text-xs text-subtle">Only show roles that sponsor</p>
              </div>
              <Switch on={visa} onChange={setVisa} label="Visa sponsorship only" />
            </div>
            <div className="flex items-center gap-3">
              <p className="m-0 flex-1 text-[15px]">Closing in 30 days</p>
              <Switch on={soon} onChange={setSoon} label="Closing in 30 days" />
            </div>
            <p className="m-0 text-xs leading-normal text-subtle">Sponsorship information is general guidance, not legal advice. Always check with the employer.</p>
          </aside>

          <section aria-label="Results" className="flex min-w-0 flex-[999_1_600px] flex-col gap-3">
            <p className="mx-1 my-0 text-sm text-muted" aria-live="polite">
              {list.length} {list.length === 1 ? "opportunity" : "opportunities"} · sorted by deadline
            </p>
            {list.length === 0 && <p className="m-0 rounded-[22px] bg-white p-6 text-[15px] text-muted">No roles match these filters. Try another sector or switch off “Closing in 30 days”.</p>}
            {list.map((o) => {
              const tr = tracked.has(o.id);
              const d = days(o.closesOn, today);
              return (
                <article key={o.id} className="flex flex-wrap items-center gap-x-5 gap-y-3.5 rounded-[22px] bg-white px-[22px] py-5">
                  <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-canvas text-[17px] font-medium">
                    {o.org.charAt(0)}
                  </span>
                  <div className="min-w-0 flex-[1_1_280px]">
                    <h2 className="m-0 text-lg font-normal tracking-[-0.03em]">{o.role}</h2>
                    <p className="mt-[3px] mb-0 text-sm text-muted">
                      {o.org} · {o.location}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-canvas px-[9px] py-1 font-mono text-[11px] text-muted">{o.type.toUpperCase()}</span>
                      {o.sponsorsVisa && <span className="rounded-full bg-mint px-[9px] py-1 font-mono text-[11px] text-brand">SPONSORS VISAS</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="m-0 text-xs text-subtle">Closes</p>
                    <p className={cx("mt-0.5 mb-0 text-base", d <= 21 ? "text-black" : "text-muted")}>{fmt(o.closesOn)}</p>
                  </div>
                  <div className="flex gap-2">
                    {o.url && (
                      <a href={o.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-[42px] items-center rounded-full border border-edge bg-white px-4 text-sm text-black no-underline hover:bg-paper hover:text-black">
                        Apply<span className="sr-only-abs"> (opens in a new tab)</span>
                      </a>
                    )}
                    {tr && (
                      <Link href={`/tailor?opp=${o.id}`} className="inline-flex min-h-[42px] items-center rounded-full border border-edge bg-white px-4 text-sm text-black no-underline hover:bg-paper hover:text-black">
                        Tailor CV
                      </Link>
                    )}
                    <button
                      id={`track-${o.id}`}
                      type="button"
                      disabled={pending}
                      aria-pressed={tr}
                      aria-expanded={tr ? stopping === o.id : undefined}
                      onClick={() => (tr ? setStopping(stopping === o.id ? null : o.id) : act(() => trackOpportunity(o.id, true), `Tracking ${o.role} at ${o.org}.`))}
                      className={cx("min-h-[42px] rounded-full px-[18px] text-sm", tr ? "border border-brand bg-okbg text-brand" : "border-0 bg-black text-white hover:bg-ink-2")}>
                      {tr ? "Tracking" : "Track"}
                      <span className="sr-only-abs"> {o.role} at {o.org}</span>
                    </button>
                  </div>
                  {tr && stopping === o.id && (
                    <div className="flex w-full flex-wrap items-center gap-2 text-[13px] text-muted">
                      <span id={`stop-q-${o.id}`} className="min-w-0 flex-[1_1_240px]">Stop tracking this role? Your documents stay in My reports, but this application&apos;s status and its links to them go.</span>
                      <button type="button" disabled={pending} onClick={() => { setStopping(null); act(() => trackOpportunity(o.id, false), `Stopped tracking ${o.role} at ${o.org}.`); focusSoon(`track-${o.id}`); }} className="min-h-[38px] rounded-full border border-edge bg-white px-3.5 text-[13px] text-black">
                        Stop tracking
                      </button>
                      <button type="button" autoFocus aria-describedby={`stop-q-${o.id}`} onClick={() => { setStopping(null); focusSoon(`track-${o.id}`); }} className="min-h-[38px] rounded-full border border-edge bg-white px-3.5 text-[13px] text-black">
                        Keep it
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        </div>
      ) : (
        <div id="opp-panel" role="tabpanel" aria-labelledby="opp-tab-1" className="flex gap-3.5 overflow-x-auto pb-2">
          {COLS.map((col) => {
            const cards = apps.filter((a) => a.status === col);
            return (
              <section key={col} aria-labelledby={`col-${col}`} className="flex min-h-[420px] flex-[0_0_260px] flex-col gap-2.5 rounded-[22px] bg-white p-4">
                <div className="flex items-center justify-between px-1">
                  <h2 id={`col-${col}`} className="m-0 text-base font-medium">
                    {APP_STATUS_LABEL[col]}
                  </h2>
                  <span className="font-mono text-xs text-subtle">{cards.length}</span>
                </div>
                {cards.length === 0 && <p className="m-0 px-1 text-[13px] text-subtle">Nothing here yet.</p>}
                {cards.map((k) => {
                  const d = k.closesOn ? days(k.closesOn, today) : null;
                  const note = col === "saved" && k.closesOn ? `CLOSES ${fmt(k.closesOn).toUpperCase()}` : `UPDATED ${fmt(k.updatedAt).toUpperCase()}`;
                  return (
                    <div key={k.id} className="rounded-2xl bg-canvas p-3.5">
                      <p className="m-0 text-[15px]">{k.role}</p>
                      <p className="mt-[3px] mb-0 text-[13px] text-muted">{k.org}</p>
                      <p className={cx("mt-2.5 mb-2 font-mono text-[11px]", col === "saved" && d !== null && d <= 7 ? "text-black" : col === "interview" ? "text-brand" : "text-muted")}>{note}</p>
                      <label className="flex items-center gap-2 text-xs text-muted">
                        Move <span className="sr-only-abs">{k.role} at {k.org} </span>to
                        <select id={`move-${k.id}`} value={k.status} disabled={pending} onChange={(e) => { const to = e.target.value as (typeof COLS)[number]; moved.current = k.id; act(() => moveApplication(k.id, to), `${k.role} moved to ${APP_STATUS_LABEL[to]}.`); }} className="min-h-8 flex-1 rounded-lg border border-edge bg-white px-2 text-xs text-black">
                          {COLS.map((c) => (
                            <option key={c} value={c}>
                              {APP_STATUS_LABEL[c]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
