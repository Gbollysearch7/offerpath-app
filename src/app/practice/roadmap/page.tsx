import type { Metadata } from "next";
import Link from "next/link";
import { StudentShell } from "@/components/StudentShell";
import { cx, PageTitle, pill } from "@/components/ui";
import { ROADMAPS } from "@/lib/practice";
import { requireStudent } from "@/lib/session";

export const metadata: Metadata = { title: "Role roadmaps" };

export default async function RoadmapPage({ searchParams }: { searchParams: Promise<{ sector?: string }> }) {
  const { profile } = await requireStudent();
  const sp = await searchParams;
  const sectors = Object.keys(ROADMAPS);
  const sector = sectors.find((s) => s === sp.sector) ?? profile.sectors.find((s) => sectors.includes(s)) ?? sectors[0];
  const map = ROADMAPS[sector];
  return (
    <StudentShell profile={profile} active="practice">
      <main id="main" className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-8 pb-16 sm:px-7">
        <PageTitle kicker="PRACTICE" title="Role roadmaps" sub="What to do and when. Dates are typical; always check each employer's deadlines." />
        <nav aria-label="Sector" className="flex flex-wrap gap-2">
          {sectors.map((s) => (
            <Link key={s} href={`/practice/roadmap?sector=${encodeURIComponent(s)}`} aria-current={s === sector ? "page" : undefined} className={cx(pill(s === sector), "inline-flex items-center no-underline", s === sector ? "hover:text-white" : "hover:text-black")}>
              {s}
            </Link>
          ))}
        </nav>
        <section aria-labelledby="rm-h" className="rounded-3xl bg-white p-6">
          <h2 id="rm-h" className="m-0 text-[24px] font-normal tracking-[-0.04em]">
            {sector}
          </h2>
          <p className="mt-2 mb-0 text-[15px] leading-relaxed text-body">{map.summary}</p>
          <ol className="mt-5 mb-0 flex list-none flex-col gap-0 p-0">
            {map.steps.map((s, i) => (
              <li key={s.title} className={cx("relative border-l-2 pb-6 pl-6", i === map.steps.length - 1 ? "border-transparent pb-0" : "border-mist")}>
                <span aria-hidden="true" className={cx("absolute top-0.5 -left-[9px] h-4 w-4 rounded-full", profile.stage === s.stage ? "bg-brand" : "bg-mist")} />
                <p className="m-0 font-mono text-xs text-subtle">
                  {s.when.toUpperCase()}
                  {profile.stage === s.stage && <span className="ml-2 text-brand">YOU ARE HERE</span>}
                </p>
                <h3 className="mt-1 mb-2 text-lg font-medium">{s.title}</h3>
                <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-relaxed text-body">
                  {s.items.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </StudentShell>
  );
}
