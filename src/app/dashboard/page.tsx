import type { Metadata } from "next";
import Link from "next/link";
import { StudentShell } from "@/components/StudentShell";
import { btn, cx, fmtDate, pill, SearchIcon } from "@/components/ui";
import { presentedScore } from "@/lib/analysis/coverage";
import { bandLabel } from "@/lib/analysis/labels";
import { comparableScores } from "@/lib/analysis/scoring-contract";
import { requireStudent } from "@/lib/session";
import { REPORT_TYPE_LABEL, type ReportRow, type ReportType } from "@/lib/types";
import { ShareButton } from "./ShareButton";

export const metadata: Metadata = { title: "My reports" };

const PAGE = 7;
const FILTERS: [ReportType | "all", string][] = [["all", "All"], ["cv_review", "CV review"], ["tailor", "Tailor to a job"], ["cover_letter", "Cover letter"]];

const ICONS = {
  review: "M7 3.5h7l4 4v13H7zM10 12h5M10 16h3.5",
  tailor: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  letters: "M3.5 6.5h17v11h-17zM3.5 7l8.5 6 8.5-6",
  opps: "M4.5 6h15v14h-15zM4.5 10h15M8.5 3.5V7M15.5 3.5V7",
  templates: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
};

function hrefFor(r: ReportRow) {
  return r.type === "cv_review" ? `/reviews/${r.id}` : r.type === "tailor" ? `/tailor/${r.id}` : `/letters/${r.id}`;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ type?: string; q?: string; page?: string }> }) {
  const { repo, profile } = await requireStudent();
  const sp = await searchParams;
  const type = FILTERS.some(([k]) => k === sp.type) && sp.type !== "all" ? (sp.type as ReportType) : undefined;
  const q = (sp.q ?? "").slice(0, 80);
  const page = Math.max(1, Number(sp.page) || 1);

  const [list, cvHistory, apps, counts, tailors, letters] = await Promise.all([
    repo.listReports({ type, q: q || undefined, offset: (page - 1) * PAGE, limit: PAGE }),
    repo.listReports({ type: "cv_review", limit: 2 }),
    repo.applications(),
    repo.counts(),
    repo.listReports({ type: "tailor", limit: 1 }),
    repo.listReports({ type: "cover_letter", limit: 1 }),
  ]);
  const latest = cvHistory.rows[0];
  const prev = cvHistory.rows[1];
  // A change is only a change within one scoring series; a rule change or incomplete reading is not progress.
  const latestScore = latest ? presentedScore(latest) : null;
  const delta = latestScore != null && prev?.score != null && comparableScores(latest?.scoring?.series, prev.scoring?.series) ? latestScore - prev.score : null;

  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 864e5);
  const dueThisWeek = apps.filter((a) => a.closesOn && a.status === "saved" && new Date(a.closesOn) >= new Date(now.toDateString()) && new Date(a.closesOn) <= weekAhead).sort((a, b) => a.closesOn!.localeCompare(b.closesOn!));
  const nextDue = dueThisWeek[0]?.closesOn ? new Date(dueThisWeek[0].closesOn).toLocaleDateString("en-GB", { weekday: "short" }) : null;

  const tools = [
    { label: "CV review", href: "/upload", icon: ICONS.review, done: counts.cvs > 0 },
    { label: "Tailor to a job", href: "/tailor", icon: ICONS.tailor, done: tailors.total > 0 },
    { label: "Cover letters", href: "/letters", icon: ICONS.letters, done: letters.total > 0 },
    { label: "Opportunities", href: "/opportunities", icon: ICONS.opps, done: apps.length > 0 },
    { label: "CV templates", href: "/templates", icon: ICONS.templates, done: false },
  ];
  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { type: sp.type, q: q || undefined, page: String(page), ...patch };
    Object.entries(merged).forEach(([k, v]) => v !== undefined && v !== "" && !(k === "page" && v === "1") && !(k === "type" && v === "all") && p.set(k, String(v)));
    const s = p.toString();
    return s ? `/dashboard?${s}` : "/dashboard";
  };
  const pages = Math.max(1, Math.ceil(list.total / PAGE));

  return (
    <StudentShell profile={profile} active="dashboard">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 pt-6 pb-14 sm:px-7 lg:flex-row lg:items-start">
        <nav aria-label="Tools" className="flex w-full flex-col gap-0.5 rounded-3xl bg-white px-3.5 pt-[18px] pb-[22px] lg:max-w-[280px] lg:flex-[1_1_260px]">
          <p className="mx-2.5 mt-1 mb-2.5 font-mono text-[11px] tracking-[0.04em] text-subtle">TOOLS</p>
          {tools.map((t) => (
            <Link key={t.label} href={t.href} className="flex min-h-[42px] items-center gap-3 rounded-xl px-2.5 text-sm text-ink-2 no-underline hover:bg-canvas hover:text-black">
              <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-canvas">
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                  <path d={t.icon} fill="none" stroke="#36604E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="flex-1">{t.label}</span>
              {t.done && (
                <svg width="16" height="16" viewBox="0 0 22 22" role="img" aria-label="Used">
                  <path d="M5 11.3l3.6 3.6 8-8.2" fill="none" stroke="#36604E" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </Link>
          ))}
          <div className="m-2.5 h-px bg-line" />
          <p className="mx-2.5 mt-1 mb-2 font-mono text-[11px] tracking-[0.04em] text-subtle">COMING LATER</p>
          {["Interview practice", "Aptitude tests", "Role roadmaps"].map((l) => (
            <span key={l} className="flex min-h-9 items-center px-2.5 text-sm text-subtle">
              {l}
            </span>
          ))}
          <div className="m-2.5 h-px bg-line" />
          <p className="mx-2.5 mt-1 mb-2 font-mono text-[11px] tracking-[0.04em] text-subtle">ACCOUNT</p>
          <Link href="/dashboard" aria-current="page" className="flex min-h-[38px] items-center rounded-xl bg-black px-2.5 text-sm text-white no-underline hover:text-white">
            My reports
          </Link>
          <Link href="/privacy" className="flex min-h-[38px] items-center rounded-xl px-2.5 text-sm text-ink-2 no-underline hover:bg-canvas hover:text-black">
            Privacy and my data
          </Link>
          <Link href="/help" className="flex min-h-[38px] items-center rounded-xl px-2.5 text-sm text-ink-2 no-underline hover:bg-canvas hover:text-black">
            Help
          </Link>
        </nav>

        <main id="main" className="flex min-w-0 flex-[999_1_640px] flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-4 px-1 pt-2 pb-1">
            <div>
              <h1 className="m-0 text-[34px] font-normal leading-[1.1] tracking-[-1.5px] sm:text-[44px] sm:tracking-[-1.98px]">My reports</h1>
              <p className="mt-2 mb-0 text-[15px] text-muted">Every review you&apos;ve run, newest first.</p>
            </div>
            <ShareButton shared={profile.shareProgress} />
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="flex-[1_1_220px] rounded-[22px] bg-white px-5 py-[18px]">
              <p className="m-0 text-[13px] text-subtle">Latest CV score</p>
              <p className="mt-1.5 mb-0 text-[34px] tracking-[-0.05em]">
                {latestScore ?? "–"}{" "}
                {latestScore != null && (
                  <span className="text-sm tracking-normal text-brand">
                    {bandLabel(latestScore)}
                    {delta !== null && delta !== 0 && ` · ${delta > 0 ? "+" : ""}${delta}`}
                  </span>
                )}
              </p>
            </div>
            <div className="flex-[1_1_220px] rounded-[22px] bg-white px-5 py-[18px]">
              <p className="m-0 text-[13px] text-subtle">Applications tracked</p>
              <p className="mt-1.5 mb-0 text-[34px] tracking-[-0.05em]">{apps.length}</p>
            </div>
            <div className="flex-[1_1_220px] rounded-[22px] bg-white px-5 py-[18px]">
              <p className="m-0 text-[13px] text-subtle">Deadlines this week</p>
              <p className="mt-1.5 mb-0 text-[34px] tracking-[-0.05em]">
                {dueThisWeek.length} {nextDue && <span className="text-sm tracking-normal text-muted">next on {nextDue}</span>}
              </p>
            </div>
          </div>

          <section aria-labelledby="rep-h" className="flex flex-col gap-4 rounded-3xl bg-white px-4 py-[22px] sm:px-6">
            <h2 id="rep-h" className="sr-only-abs">
              Reports
            </h2>
            <div className="flex flex-wrap items-center gap-2.5">
              {FILTERS.map(([k, label]) => (
                <Link key={k} href={qs({ type: k, page: 1 })} aria-current={(type ?? "all") === k ? "true" : undefined} className={cx(pill((type ?? "all") === k), "inline-flex items-center no-underline", (type ?? "all") === k ? "hover:text-white" : "hover:text-black")}>
                  {label}
                </Link>
              ))}
              <form action="/dashboard" className="w-full sm:ml-auto sm:w-auto">
                {type && <input type="hidden" name="type" value={type} />}
                <label className="flex min-h-10 min-w-[220px] items-center gap-2 rounded-full bg-canvas px-3.5">
                  <SearchIcon />
                  <span className="sr-only-abs">Search reports</span>
                  <input type="search" name="q" defaultValue={q} placeholder="Search files and scores" className="flex-1 border-0 bg-transparent text-sm outline-none" />
                </label>
              </form>
            </div>

            {list.rows.length === 0 ? (
              <div className="flex flex-col items-start gap-3 rounded-2xl bg-canvas p-6">
                <p className="m-0 text-lg tracking-[-0.02em]">{q || type ? "No reports match." : "No reports yet."}</p>
                <p className="m-0 text-sm text-muted">{q || type ? "Try a different filter or search." : "Upload your CV to get your first Readiness Score."}</p>
                {!q && !type && (
                  <Link href="/upload" className={btn.primary}>
                    Upload my CV
                  </Link>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] border-collapse text-sm">
                  <thead>
                    <tr className="text-left">
                      {["FILE", "TYPE", "DATE"].map((h) => (
                        <th key={h} className="border-b border-line px-2 py-2.5 font-mono text-[11px] font-normal text-subtle">
                          {h}
                        </th>
                      ))}
                      <th className="border-b border-line px-2 py-2.5 text-right font-mono text-[11px] font-normal text-subtle">SCORE</th>
                      <th className="border-b border-line px-2 py-2.5">
                        <span className="sr-only-abs">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="border-b border-line px-2 py-3.5">{r.title}</td>
                        <td className="border-b border-line px-2 py-3.5">
                          <span className="rounded-full bg-canvas px-2.5 py-1 text-xs text-ink-2">{REPORT_TYPE_LABEL[r.type]}</span>
                        </td>
                        <td className="border-b border-line px-2 py-3.5 text-muted">{fmtDate(r.createdAt)}</td>
                        <td className="border-b border-line px-2 py-3.5 text-right">
                          <span className="font-mono">{presentedScore(r) ?? "–"}</span>
                          {presentedScore(r) != null && r.type !== "tailor" && <span className="ml-1.5 text-xs text-subtle">{bandLabel(r.score!)}</span>}
                          {r.scoring?.coverage === "incomplete" && <span className="ml-1.5 text-xs text-subtle">Incomplete</span>}
                        </td>
                        <td className="border-b border-line px-2 py-3.5 text-right">
                          <Link href={hrefFor(r)} className="inline-flex min-h-[34px] items-center rounded-full border border-edge px-3.5 text-[13px] text-black no-underline hover:bg-paper hover:text-black" aria-label={`Open ${r.title}`}>
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center justify-between text-[13px] text-subtle">
              <span>
                Showing {list.rows.length} of {list.total} {list.total === 1 ? "report" : "reports"}
              </span>
              <span className="flex gap-1.5">
                {page > 1 ? (
                  <Link href={qs({ page: page - 1 })} className="inline-flex min-h-[34px] items-center rounded-full border border-edge bg-white px-3 text-[13px] text-black no-underline hover:text-black">
                    Previous
                  </Link>
                ) : (
                  <span aria-disabled="true" className="inline-flex min-h-[34px] items-center rounded-full border border-edge bg-white px-3 text-[13px] text-subtle opacity-60">
                    Previous
                  </span>
                )}
                {page < pages ? (
                  <Link href={qs({ page: page + 1 })} className="inline-flex min-h-[34px] items-center rounded-full bg-black px-3 text-[13px] text-white no-underline hover:text-white">
                    Next
                  </Link>
                ) : (
                  <span aria-disabled="true" className="inline-flex min-h-[34px] items-center rounded-full bg-black px-3 text-[13px] text-white opacity-40">
                    Next
                  </span>
                )}
              </span>
            </div>
          </section>
        </main>
      </div>
    </StudentShell>
  );
}
