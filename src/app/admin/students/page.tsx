import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { cx, pill, SearchIcon } from "@/components/ui";
import type { StudentQuery } from "@/lib/repo/types";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Students" };

const PAGE = 25;
const FILTERS: [NonNullable<StudentQuery["filter"]>, string][] = [["all", "All students"], ["needs", "May need a hand"], ["home", "Home"], ["international", "International"]];

export default async function AdminStudentsPage({ searchParams }: { searchParams: Promise<{ f?: string; q?: string; faculty?: string; page?: string }> }) {
  const { repo, profile } = await requireAdmin();
  const sp = await searchParams;
  const filter = FILTERS.find(([k]) => k === sp.f)?.[0] ?? "all";
  const search = (sp.q ?? "").slice(0, 80);
  const faculty = (sp.faculty ?? "").slice(0, 120);
  const page = Math.max(1, Number(sp.page) || 1);
  const [o, data] = await Promise.all([repo.adminOverview(), repo.adminStudents({ filter, search, faculty, limit: PAGE, offset: (page - 1) * PAGE })]);
  const pages = Math.max(1, Math.ceil(data.total / PAGE));
  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { f: filter === "all" ? undefined : filter, q: search || undefined, faculty: faculty || undefined, page: page > 1 ? page : undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "" && !(k === "page" && Number(v) <= 1)) p.set(k, String(v));
    const s = p.toString();
    return s ? `/admin/students?${s}` : "/admin/students";
  };

  return (
    <AdminShell profile={profile} university={o.universityName} active="students" title="Students" intro={o.sample ? "Sample data for a fictional university." : "Students who have chosen to share their progress with your careers team."}>
      <form action="/admin/students" className="flex flex-wrap items-end gap-3">
        {filter !== "all" && <input type="hidden" name="f" value={filter} />}
        <label className="flex min-h-11 min-w-[260px] flex-1 items-center gap-2 rounded-full bg-white px-4">
          <SearchIcon />
          <span className="sr-only-abs">Search by student ID or course</span>
          <input type="search" name="q" defaultValue={search} placeholder="Search student ID or course" className="flex-1 border-0 bg-transparent text-sm outline-none" />
        </label>
        <label>
          <span className="sr-only-abs">Faculty</span>
          <select name="faculty" defaultValue={faculty} className="min-h-11 rounded-full border border-edge bg-white px-3.5 text-sm">
            <option value="">All faculties</option>
            {data.faculties.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="min-h-11 rounded-full border-0 bg-black px-[18px] text-sm font-medium text-white hover:bg-ink-2">
          Apply
        </button>
      </form>

      <nav aria-label="Filter students" className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([k, label]) => (
          <Link key={k} href={qs({ f: k === "all" ? undefined : k, page: 1 })} aria-current={filter === k ? "true" : undefined} className={cx(pill(filter === k), "inline-flex items-center no-underline", filter === k ? "hover:text-white" : "hover:text-black")}>
            {label} <span className="ml-1 font-mono text-xs opacity-75">{data.counts[k]}</span>
          </Link>
        ))}
      </nav>

      <section aria-label="Student list" className="rounded-3xl bg-white px-5 pt-2 pb-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="text-left">
                {[["STUDENT ID", "left"], ["COURSE", "left"], ["YEAR", "left"], ["STATUS", "left"], ["SCORE", "right"], ["CHANGE", "right"], ["LAST ACTIVE", "left"], ["FLAG", "left"]].map(([t, a]) => (
                  <th key={t} className={`border-b border-line px-2 py-3.5 font-mono text-[11px] font-normal text-subtle ${a === "right" ? "text-right" : "text-left"}`}>
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-6 text-center text-muted">
                    No students match.
                  </td>
                </tr>
              )}
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="border-b border-line px-2 py-3.5 font-mono text-[13px]">
                    {r.key ? (
                      <Link href={`/admin/students/${r.key}`} aria-label={`Open student ${r.id}`}>
                        {r.id}
                      </Link>
                    ) : (
                      r.id
                    )}
                  </td>
                  <td className="border-b border-line px-2 py-3.5">{r.course}</td>
                  <td className="border-b border-line px-2 py-3.5 text-muted">{r.year}</td>
                  <td className="border-b border-line px-2 py-3.5 text-muted">{r.status}</td>
                  <td className="border-b border-line px-2 py-3.5 text-right font-mono">{r.score ?? "–"}</td>
                  <td className={`border-b border-line px-2 py-3.5 text-right font-mono ${r.change && r.change > 0 ? "text-brand" : "text-muted"}`}>{r.change === null ? "–" : `${r.change > 0 ? "+" : ""}${r.change}`}</td>
                  <td className="border-b border-line px-2 py-3.5 text-muted">{r.lastActive}</td>
                  <td className="border-b border-line px-2 py-3.5">{r.flag && <span className="rounded-full bg-black px-2.5 py-1 text-xs text-white">{r.flag}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-2 text-[13px] text-subtle">
          <span>
            Showing {data.rows.length ? (page - 1) * PAGE + 1 : 0}–{(page - 1) * PAGE + data.rows.length} of {data.total}
          </span>
          <span className="flex items-center gap-1.5">
            {page > 1 && (
              <Link href={qs({ page: page - 1 })} className="inline-flex min-h-[34px] items-center rounded-full border border-edge bg-white px-3 text-black no-underline hover:text-black">
                Previous
              </Link>
            )}
            <span className="px-2">
              Page {page} of {pages}
            </span>
            {page < pages && (
              <Link href={qs({ page: page + 1 })} className="inline-flex min-h-[34px] items-center rounded-full bg-black px-3 text-white no-underline hover:text-white">
                Next
              </Link>
            )}
          </span>
        </div>
        <p className="mx-2 mt-3 mb-0 text-[13px] text-subtle">Open a student to see their history and leave a note they&apos;ll see.</p>
      </section>

      <section id="export" aria-labelledby="ex-h" className="rounded-3xl bg-white px-6 py-[22px]">
        <form action="/admin/export" className="flex flex-wrap items-center gap-5">
          <input type="hidden" name="filter" value={filter} />
          <input type="hidden" name="faculty" value={faculty} />
          <input type="hidden" name="q" value={search} />
          <div className="min-w-0 flex-[1_1_380px]">
            <h2 id="ex-h" className="m-0 text-[22px] font-normal tracking-[-0.04em]">
              Export
            </h2>
            <p className="mt-1.5 mb-0 text-sm leading-[1.55] text-muted">Download this view as CSV. A view of fewer than five students can&apos;t be exported.</p>
            <div className="mt-3.5 flex flex-wrap gap-3.5 text-sm">
              {[["scores", "Scores by area"], ["activity", "Activity"]].map(([n, l]) => (
                <label key={n} className="flex items-center gap-2">
                  <input type="checkbox" name="cols" value={n} defaultChecked className="h-[18px] w-[18px] accent-brand" />
                  {l}
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <a href="/admin/export?pack=tef" className="inline-flex min-h-[46px] items-center rounded-full border border-edge bg-white px-5 text-sm text-black no-underline hover:bg-paper hover:text-black">
              Graduate Outcomes and TEF pack
            </a>
            <button type="submit" className="min-h-[46px] rounded-full border-0 bg-black px-5 text-sm font-medium text-white hover:bg-ink-2">
              Download CSV
            </button>
          </div>
        </form>
      </section>
    </AdminShell>
  );
}
