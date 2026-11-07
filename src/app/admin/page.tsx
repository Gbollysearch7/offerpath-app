import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav } from "@/components/AdminNav";
import { SiteFooter } from "@/components/SiteFooter";
import { Eyebrow } from "@/components/ui";
import { bandLegend } from "@/lib/analysis/labels";
import { dateRangeLabel, HIDDEN, publishedFigures, scoreFigures, showFigure, STATEMENTS, type PublishedFigure } from "@/lib/analytics/definitions";
import type { Figure } from "@/lib/analytics/types";
import { findPeriod, listPeriods } from "@/lib/periods";
import { requireAdmin } from "@/lib/session";
import { PeriodSelect } from "./PeriodSelect";

export const metadata: Metadata = { title: "Careers dashboard" };

const NEED_LABEL: Record<string, string> = {
  "No CV yet": "Signed up over 3 weeks ago, no CV reviewed",
  "Not improving": "Score not moving after 3 comparable reviews",
  "Deadline soon": "Tracked deadline in 7 days, score under 50",
  Inactive: "Inactive for 30 days",
};

const num = (v: Figure) => (v === null ? HIDDEN : v.toLocaleString("en-GB"));

function FigureCard({ f }: { f: PublishedFigure }) {
  return (
    <section aria-label={f.name} className="flex min-w-0 flex-[1_1_300px] flex-col gap-2 rounded-[20px] bg-white px-[18px] py-4">
      <h3 className="m-0 text-[15px] font-medium">{f.name}</h3>
      <p className="m-0 text-[28px] tracking-[-0.04em]">{showFigure(f.value)}</p>
      <p className="m-0 text-[13px] text-muted">
        {f.denominator !== null ? `out of about ${f.denominator.toLocaleString("en-GB")}` : f.denominatorLabel.startsWith("None") ? "No denominator" : "Denominator hidden"}
        {f.percent !== null && `, roughly ${f.percent}%`}
      </p>
      <dl className="m-0 mt-1 flex flex-col gap-1.5 border-t border-line pt-2.5 text-[13px] leading-[1.45]">
        {(
          [
            ["What it counts", f.definition],
            ["Out of", f.denominatorLabel],
            ["Dates", f.dateRange],
            ["Left out", f.exclusions],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="inline font-medium">{k}: </dt>
            <dd className="m-0 inline text-muted">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { repo, profile } = await requireAdmin();
  const period = findPeriod((await searchParams).period);
  const a = await repo.adminAnalytics(period.key);
  const figures = publishedFigures(a);
  const scores = a.scores;
  const legend = bandLegend();
  const dimensions = [...new Set(a.breakdowns.map((r) => r.dimension))].filter((d) => d !== "All students");
  const statements = [STATEMENTS.population, STATEMENTS.employment, STATEMENTS.causal, STATEMENTS.privacy, STATEMENTS.rounding];

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-black lg:flex-row">
      <AdminNav active="dashboard" university={a.universityName} name={profile.fullName} title="Head of Careers" />
      <main id="main" className="flex min-w-0 max-w-[1180px] flex-1 flex-col gap-5 px-4 pt-7 pb-14 sm:px-8">
        {a.sample && (
          <p className="m-0 rounded-2xl bg-black px-4 py-3 text-sm font-medium text-white">
            <span className="font-mono">SAMPLE DATA.</span> {STATEMENTS.sample}
          </p>
        )}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="m-0 text-[36px] font-normal leading-[1.1] tracking-[-1.6px] sm:text-[44px] sm:tracking-[-1.98px]">Dashboard</h1>
            <p className="mt-1.5 mb-0 text-sm text-muted">{period.label}. {dateRangeLabel(a.period)}.</p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <PeriodSelect periods={listPeriods()} current={period.key} />
            <a href={`/admin/export?period=${encodeURIComponent(period.key)}`} className="inline-flex min-h-11 items-center rounded-full bg-black px-[18px] text-sm font-medium text-white no-underline hover:bg-ink-2 hover:text-white">
              Download these figures
            </a>
          </div>
        </div>

        <section aria-labelledby="read-h" className="rounded-3xl bg-mist px-6 py-[22px]">
          <h2 id="read-h" className="m-0 text-lg font-normal tracking-[-0.03em]">How to read these figures</h2>
          <ul className="mt-2.5 mb-0 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-[1.55] text-body">
            {statements.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>

        {a.withheld && (
          <p className="m-0 rounded-2xl bg-white px-4 py-3 text-sm">
            {STATEMENTS.withheld}{" "}
            <Link href="/admin?period=all">Show all time</Link>
          </p>
        )}

        <section aria-labelledby="use-h" className="flex flex-col gap-3.5">
          <h2 id="use-h" className="m-0 text-[22px] font-normal tracking-[-0.04em]">How the service is being used</h2>
          <div className="flex flex-wrap items-stretch gap-3.5">
            {figures.slice(0, 8).map((f) => (
              <FigureCard key={f.key} f={f} />
            ))}
          </div>
        </section>

        <section aria-labelledby="sc-h" className="flex flex-col gap-3.5">
          <h2 id="sc-h" className="m-0 text-[22px] font-normal tracking-[-0.04em]">Scores, within one version set</h2>
          <p className="m-0 text-sm leading-[1.55] text-muted">
            {STATEMENTS.versions} {scores?.versionSet ? <>Version set shown: <span className="font-mono text-xs break-all">{scores.versionSet}</span>.</> : "Too few students are in any version set to show one."}
          </p>
          <div className="flex flex-wrap items-stretch gap-3.5">
            {scoreFigures(a).map((f) => (
              <FigureCard key={f.key} f={f} />
            ))}
            <section aria-labelledby="bd-h" className="flex min-w-0 flex-[1_1_300px] flex-col gap-2.5 rounded-[20px] bg-white px-[18px] py-4">
              <Eyebrow id="bd-h">LATEST SCORE, BY BAND</Eyebrow>
              {legend.map((b) => (
                <div key={b.key} className="flex items-center justify-between gap-2.5 text-sm">
                  <span>
                    {b.label} <span className="text-subtle">{b.min}{b.max >= 100 ? "+" : `–${b.max}`}</span>
                  </span>
                  <span className="font-mono text-[13px]">{num(scores?.bands[b.key] ?? null)}</span>
                </div>
              ))}
              <p className="m-0 text-[13px] text-subtle">Students, rounded, in the version set above.</p>
            </section>
          </div>
        </section>

        <section aria-labelledby="tr-h" className="flex flex-col gap-3.5">
          <h2 id="tr-h" className="m-0 text-[22px] font-normal tracking-[-0.04em]">What students say about their applications</h2>
          <p className="m-0 text-sm leading-[1.55] text-muted">{STATEMENTS.employment}</p>
          <div className="flex flex-wrap items-stretch gap-3.5">
            {figures.slice(8).map((f) => (
              <FigureCard key={f.key} f={f} />
            ))}
          </div>
        </section>

        {dimensions.map((d, i) => (
          <section key={d} aria-labelledby={`dim-${i}`} className="rounded-3xl bg-white px-5 pt-4 pb-3">
            <h2 id={`dim-${i}`} className="m-0 text-lg font-normal tracking-[-0.03em]">By {d.toLowerCase()}</h2>
            <p className="mt-1 mb-2 text-[13px] text-muted">One breakdown at a time, never combined. Same dates, students and definitions as above. Rounded, so rows may not add up.</p>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`Figures by ${d.toLowerCase()}, scrollable`}>
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr>
                    {[d, "Students", "Reviews", "Useful edits", "Repeat use", "Referrals", "Tracking", "Average score"].map((t, c) => (
                      <th key={t} scope="col" className={`border-b border-line px-2 py-2.5 font-mono text-[11px] font-normal text-subtle ${c === 0 ? "text-left" : "text-right"}`}>
                        {t.toUpperCase()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {a.breakdowns.filter((r) => r.dimension === d).map((r) =>
                    r.hidden ? (
                      <tr key="hidden">
                        <th scope="row" colSpan={8} className="border-b border-line px-2 py-2.5 text-left font-normal text-muted">
                          Other groups are combined, not named and hidden, because one or more is too small.
                        </th>
                      </tr>
                    ) : (
                      <tr key={r.group}>
                        <th scope="row" className="border-b border-line px-2 py-2.5 text-left font-normal">{r.group}</th>
                        {[r.students, r.completed, r.usefulEdits, r.repeatUse, r.referred, r.tracked, r.average].map((v, c) => (
                          <td key={c} className={`border-b border-line px-2 py-2.5 text-right font-mono text-[13px] ${v === null ? "text-subtle" : ""}`}>{num(v)}</td>
                        ))}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        <div className="flex flex-wrap items-stretch gap-5">
          <section aria-labelledby="nh-h" className="flex min-w-0 flex-[999_1_460px] flex-col gap-2 rounded-3xl bg-white px-6 py-[22px]">
            <div className="flex items-center justify-between gap-3">
              <Eyebrow id="nh-h">MAY NEED A HAND, TODAY · {num(a.needs?.total ?? null)} STUDENTS</Eyebrow>
              <Link href="/admin/students?f=needs" className="text-sm">See the list</Link>
            </div>
            <p className="m-0 text-[13px] text-muted">Out of students sharing their progress. Today&apos;s position, not the chosen period. A prompt to offer help, based on activity, not a judgement of anyone.</p>
            {a.needs?.rows.map((n) => (
              <div key={n.flag} className="flex items-center gap-3 border-t border-line py-3 text-sm">
                <span className="min-w-14 text-right font-mono text-[13px]">{num(n.count)}</span>
                <span className="flex-1">{NEED_LABEL[n.flag] ?? n.flag}</span>
              </div>
            ))}
          </section>
          <section aria-labelledby="tef-h" className="flex min-w-0 flex-[1_1_300px] flex-col gap-2.5 rounded-3xl bg-mist px-6 py-[22px]">
            <h2 id="tef-h" className="m-0 text-lg font-normal tracking-[-0.03em]">Graduate Outcomes and TEF</h2>
            <p className="m-0 text-sm leading-[1.55] text-body">The same figures as this page, for this period, with their definitions. Context about how a service was used. It is not Graduate Outcomes data and not evidence of employment.</p>
            <a href={`/admin/export?pack=tef&period=${encodeURIComponent(period.key)}`} className="mt-auto inline-flex min-h-[42px] items-center self-start rounded-full bg-white px-4 text-sm text-black no-underline hover:text-black">
              Download the pack
            </a>
          </section>
        </div>
        <p className="m-0 text-[13px] text-subtle">Scores are AI-assisted guidance. Advisers can add a note to a student&apos;s report or record that they disagree with it, and the student sees both alongside their score; the score itself can&apos;t be changed.</p>
        <SiteFooter />
      </main>
    </div>
  );
}
