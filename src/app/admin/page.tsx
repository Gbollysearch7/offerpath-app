import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav } from "@/components/AdminNav";
import { SiteFooter } from "@/components/SiteFooter";
import { Eyebrow } from "@/components/ui";
import { findPeriod, listPeriods } from "@/lib/periods";
import { requireAdmin } from "@/lib/session";
import { PeriodSelect } from "./PeriodSelect";

export const metadata: Metadata = { title: "Careers dashboard" };

const fmtN = (n: number | null) => (n === null ? "–" : n.toLocaleString("en-GB"));

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { repo, profile } = await requireAdmin();
  const period = findPeriod((await searchParams).period);
  const o = await repo.adminOverview({ from: period.from, to: period.to });
  const k = o.kpis;
  const kpis = [
    { l: "Active students", v: fmtN(k.activeStudents), d: `+${k.newThisMonth} new ${period.key === "all" ? "this month" : "this period"}`, c: "text-brand" },
    { l: "Average score", v: fmtN(k.avgScore), d: k.avgFirstScore !== null ? `Up from ${k.avgFirstScore}` : "No scores yet", c: "text-brand" },
    { l: "Average improvement", v: k.avgImprovement !== null ? `${k.avgImprovement >= 0 ? "+" : ""}${k.avgImprovement}` : "–", d: "Per student", c: "text-muted" },
    { l: "CVs reviewed", v: fmtN(k.cvsReviewed), d: `${k.perStudent} per student`, c: "text-muted" },
    { l: "Applications tracked", v: fmtN(k.appsTracked), d: period.label, c: "text-muted" },
    { l: "May need a hand", v: fmtN(k.needHand), d: "See list", c: "text-black" },
  ];
  const weekly = o.weekly.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  const vals = weekly.map((p) => p.v);
  const lo = Math.floor((Math.min(...vals, 60) - 5) / 10) * 10;
  const hi = Math.ceil(Math.max(...vals, 80) / 10) * 10;
  const x = (i: number) => 60 + (i * 469) / Math.max(1, o.weekly.length - 1);
  const y = (v: number) => 190 - ((v - lo) / (hi - lo)) * 170;
  const pts = weekly.map((p) => `${x(p.i).toFixed(0)},${y(p.v).toFixed(0)}`);
  const last = weekly[weekly.length - 1];
  const ticks = [hi, hi - 10, hi - 20].filter((t) => t > lo);

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-black lg:flex-row">
      <AdminNav active="dashboard" university={o.universityName} name={profile.fullName} title="Head of Careers" />
      <main id="main" className="flex min-w-0 max-w-[1180px] flex-1 flex-col gap-5 px-4 pt-7 pb-14 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            {o.sample && <p className="m-0 font-mono text-xs text-brand">SAMPLE DATA · FICTIONAL UNIVERSITY</p>}
            <h1 className="mt-1.5 mb-0 text-[44px] font-normal leading-[1.1] tracking-[-1.98px]">Dashboard</h1>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <PeriodSelect periods={listPeriods()} current={period.key} />
            <a href="/admin/export" className="inline-flex min-h-11 items-center rounded-full bg-black px-[18px] text-sm font-medium text-white no-underline hover:bg-ink-2 hover:text-white">
              Export CSV
            </a>
          </div>
        </div>

        <div className="flex flex-wrap gap-3.5">
          {kpis.map((kp) => (
            <div key={kp.l} className="flex-[1_1_160px] rounded-[20px] bg-white px-[18px] py-4">
              <p className="m-0 text-[13px] text-subtle">{kp.l}</p>
              <p className="mt-1.5 mb-0 text-[32px] tracking-[-0.05em]">{kp.v}</p>
              <p className={`mt-0.5 mb-0 text-xs ${kp.c}`}>{kp.d}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-stretch gap-5">
          <section aria-labelledby="tr-h" className="min-w-0 flex-[999_1_460px] rounded-3xl bg-white px-6 py-[22px]">
            <Eyebrow id="tr-h" className="mb-2.5">
              AVERAGE READINESS SCORE BY WEEK
            </Eyebrow>
            {weekly.length < 2 ? (
              <p className="m-0 text-sm text-muted">Not enough data yet. Weeks with fewer than five students are hidden.</p>
            ) : (
              <svg viewBox="0 0 560 220" width="100%" height="220" role="img" aria-label={`Average score rose from ${weekly[0].v} in week ${weekly[0].i + 1} to ${last.v} in week ${last.i + 1}`}>
                {ticks.map((t) => (
                  <g key={t}>
                    <line x1="36" y1={y(t)} x2="550" y2={y(t)} stroke="#EEF2EF" />
                    <text x="28" y={y(t) + 4} fontSize="11" fill="#5C6B66" textAnchor="end" fontFamily="var(--font-geist-mono)">
                      {t}
                    </text>
                  </g>
                ))}
                <line x1="36" y1="190" x2="550" y2="190" stroke="#DCE3DE" />
                <path d={`M${pts.join(" L")} L${x(last.i)} 190 L${x(weekly[0].i)} 190 Z`} fill="#DCE6DF" opacity="0.6" />
                <polyline points={pts.join(" ")} fill="none" stroke="#36604E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx={x(last.i)} cy={y(last.v)} r="5" fill="#36604E" />
                <text x={x(last.i)} y={y(last.v) - 14} fontSize="12" textAnchor="middle" fontFamily="var(--font-geist-mono)">
                  {last.v}
                </text>
                {[0, Math.floor((o.weekly.length - 1) / 2), o.weekly.length - 1].map((i) => (
                  <text key={i} x={x(i)} y="210" fontSize="11" fill="#5C6B66" textAnchor="middle">
                    Wk {i + 1}
                  </text>
                ))}
              </svg>
            )}
          </section>
          <section aria-labelledby="bd-h" className="flex min-w-0 flex-[1_1_320px] flex-col gap-3.5 rounded-3xl bg-white px-6 py-[22px]">
            <Eyebrow id="bd-h">STUDENTS BY SCORE BAND</Eyebrow>
            {o.bands ? (
              <>
                <div role="img" aria-label={`Needs work ${o.bands.needs} percent, getting there ${o.bands.getting} percent, strong ${o.bands.strong} percent, interview-ready ${o.bands.ready} percent`} className="flex h-[18px] overflow-hidden rounded-full">
                  <span className="bg-mist" style={{ flex: o.bands.needs }} />
                  <span className="bg-mint" style={{ flex: o.bands.getting }} />
                  <span className="bg-sage" style={{ flex: o.bands.strong }} />
                  <span className="bg-brand" style={{ flex: o.bands.ready }} />
                </div>
                {[
                  ["Needs work", o.bands.needs, "#E6EDE8"],
                  ["Getting there", o.bands.getting, "#DCE6DF"],
                  ["Strong", o.bands.strong, "#8FB3A1"],
                  ["Interview-ready", o.bands.ready, "#36604E"],
                ].map(([n, p, c]) => (
                  <div key={n as string} className="flex items-center gap-2.5 text-sm">
                    <span className="h-3 w-3 rounded border border-edge" style={{ background: c as string }} />
                    <span className="flex-1">{n}</span>
                    <span className="font-mono text-[13px]">{p}%</span>
                  </div>
                ))}
              </>
            ) : (
              <p className="m-0 text-sm text-muted">Shown once five or more students have a score.</p>
            )}
          </section>
        </div>

        <div className="flex flex-wrap items-stretch gap-5">
          <section aria-labelledby="fac-h" className="flex min-w-0 flex-[1_1_360px] flex-col gap-3 rounded-3xl bg-white px-6 py-[22px]">
            <Eyebrow id="fac-h" className="mb-1">
              BY FACULTY · AVG SCORE AND IMPROVEMENT
            </Eyebrow>
            {o.faculties.length === 0 && <p className="m-0 text-sm text-muted">No faculty has five or more students with scores yet.</p>}
            {o.faculties.map((f) => (
              <div key={f.name} className="grid grid-cols-[120px_minmax(0,1fr)_30px_40px] items-center gap-2.5 text-sm">
                <span className="text-muted">{f.name}</span>
                <span className="h-2.5 rounded-full bg-line">
                  <span className="block h-2.5 rounded-full bg-brand" style={{ width: `${f.avg}%` }} />
                </span>
                <span className="text-right font-mono text-[13px]">{f.avg}</span>
                <span className="text-right font-mono text-xs text-brand">
                  {f.improvement >= 0 ? "+" : ""}
                  {f.improvement}
                </span>
              </div>
            ))}
          </section>
          <section aria-labelledby="hi-h" className="flex min-w-0 flex-[1_1_320px] flex-col gap-3.5 rounded-3xl bg-white px-6 py-[22px]">
            <Eyebrow id="hi-h">HOME VS INTERNATIONAL</Eyebrow>
            {o.homeIntl.length === 0 && <p className="m-0 text-sm text-muted">Shown once each group has five or more students.</p>}
            {o.homeIntl.map((h) => {
              const mx = Math.max(h.home, h.intl) * 1.15 || 1;
              return (
                <div key={h.metric}>
                  <p className="mt-0 mb-1.5 text-sm">{h.metric}</p>
                  {[
                    ["Home", h.home, "#000000"],
                    ["International", h.intl, "#8FB3A1"],
                  ].map(([label, v, c]) => (
                    <div key={label as string} className="mb-1 grid grid-cols-[96px_minmax(0,1fr)_40px] items-center gap-2 text-[13px] text-muted">
                      <span>{label}</span>
                      <span className="h-2 rounded-full bg-line">
                        <span className="block h-2 rounded-full" style={{ width: `${Math.round(((v as number) / mx) * 100)}%`, background: c as string }} />
                      </span>
                      <span className="text-right font-mono">{v}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </section>
        </div>

        <div className="flex flex-wrap items-stretch gap-5">
          <section aria-labelledby="nh-h" className="flex min-w-0 flex-[999_1_460px] flex-col gap-2 rounded-3xl bg-white px-6 py-[22px]">
            <div className="flex items-center justify-between">
              <Eyebrow id="nh-h">MAY NEED A HAND · {k.needHand} STUDENTS</Eyebrow>
              <Link href="/admin/students?f=needs" className="text-sm">
                See all
              </Link>
            </div>
            {o.needs.map((n) => (
              <div key={n.why} className="flex items-center gap-3 border-t border-line py-3 text-sm">
                <span className="w-8 text-right font-mono text-[13px]">{n.count}</span>
                <span className="flex-1">{n.why}</span>
                <span className="text-[13px] text-subtle">{n.hint}</span>
              </div>
            ))}
          </section>
          <section className="flex min-w-0 flex-[1_1_300px] flex-col gap-2.5 rounded-3xl bg-mist px-6 py-[22px]">
            <p className="m-0 text-lg tracking-[-0.03em]">Graduate Outcomes and TEF</p>
            <p className="m-0 text-sm leading-[1.55] text-body">Download engagement and progress data formatted to support your Graduate Outcomes and TEF evidence.</p>
            <a href={`/admin/export?pack=tef&period=${period.key}`} className="mt-auto inline-flex min-h-[42px] items-center self-start rounded-full bg-white px-4 text-sm text-black no-underline hover:text-black">
              Build report
            </a>
          </section>
        </div>
        <p className="m-0 text-[13px] text-subtle">Groups with fewer than five students are hidden to protect privacy. Scores are AI-assisted guidance and can be overridden by advisers.</p>
      <SiteFooter />
      </main>
    </div>
  );
}
