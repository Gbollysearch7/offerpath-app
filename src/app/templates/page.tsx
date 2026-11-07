import type { Metadata } from "next";
import Link from "next/link";
import { CvPreview } from "@/components/CvPreview";
import { StudentShell } from "@/components/StudentShell";
import { cx, pill } from "@/components/ui";
import { myCvBlocks } from "@/lib/cv-blocks";
import { CV_THEMES } from "@/lib/cv-themes";
import { templateBlocks } from "@/lib/documents";
import { requireStudent } from "@/lib/session";

export const metadata: Metadata = { title: "CV templates" };

const FILTERS = [
  ["all", "All"],
  ["one", "One page"],
  ["two", "Two pages"],
  ["skills", "Skills first"],
  ["serif", "Serif"],
  ["colour", "With colour"],
] as const;

const link = (f: string, mine: boolean) => {
  const q = new URLSearchParams();
  if (f !== "all") q.set("f", f);
  if (mine) q.set("with", "mine");
  return q.size ? `/templates?${q}` : "/templates";
};

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ f?: string; with?: string }> }) {
  const { repo, profile } = await requireStudent();
  const sp = await searchParams;
  const f = FILTERS.some(([k]) => k === sp.f) ? sp.f! : "all";
  const mine = sp.with === "mine" ? await myCvBlocks(repo) : null;
  const list = CV_THEMES.filter((t) => f === "all" || (t.tags as string[]).includes(f));
  const q = mine ? "&with=mine" : "";

  return (
    <StudentShell profile={profile} active="templates">
      <main id="main" className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 pt-6 pb-14 sm:px-7">
        <div className="flex flex-wrap items-end justify-between gap-4 px-1 pt-2 pb-1">
          <div>
            <h1 className="m-0 text-[34px] font-normal leading-[1.1] tracking-[-1.5px] sm:text-[44px] sm:tracking-[-1.98px]">CV templates</h1>
            <p className="mt-2 mb-0 text-[15px] text-muted">{CV_THEMES.length} designs. All use one column and real text, which gives screening software the best chance of reading your CV, though no layout can guarantee how a particular employer&apos;s system will read it. Download as Word or PDF.</p>
          </div>
          <div role="group" aria-label="Fill templates with" className="flex gap-1 rounded-full bg-white p-1">
            <Link href={link(f, false)} aria-current={!mine ? "true" : undefined} className={cx("inline-flex min-h-10 items-center rounded-full px-4 text-sm no-underline", !mine ? "bg-black text-white hover:text-white" : "text-muted hover:text-black")}>
              Example CVs
            </Link>
            <Link href={link(f, true)} aria-current={mine ? "true" : undefined} className={cx("inline-flex min-h-10 items-center rounded-full px-4 text-sm no-underline", mine ? "bg-black text-white hover:text-white" : "text-muted hover:text-black")}>
              My CV
            </Link>
          </div>
        </div>
        {sp.with === "mine" && !mine && (
          <p role="status" className="m-0 rounded-2xl bg-white px-5 py-4 text-[15px]">
            Upload a CV first and we&apos;ll show it in every template. <Link href="/upload">Upload my CV</Link>
          </p>
        )}
        <nav aria-label="Filter templates" className="flex flex-wrap gap-2">
          {FILTERS.map(([k, label]) => (
            <Link key={k} href={link(k, !!mine)} aria-current={f === k ? "true" : undefined} className={cx(pill(f === k), "inline-flex items-center no-underline", f === k ? "hover:text-white" : "hover:text-black")}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-5">
          {list.map((t) => (
            <article key={t.slug} className="flex min-w-0 flex-col gap-3.5 rounded-3xl bg-white p-[18px]">
              {/* The thumbnail is a mouse shortcut; the name below is the accessible link (its text matches what's on screen). */}
              <Link href={`/templates/${t.slug}${mine ? "?with=mine" : ""}`} aria-hidden="true" tabIndex={-1} className="flex h-[300px] justify-center overflow-hidden rounded-2xl bg-canvas pt-5 no-underline">
                <CvPreview blocks={mine ?? templateBlocks(t)} theme={t} scale={0.3} label={`${t.name} template${mine ? " with your CV" : ""}`} />
              </Link>
              <div className="flex items-baseline justify-between gap-2.5">
                <h2 className="m-0 text-xl font-normal tracking-[-0.04em]">
                  <Link href={`/templates/${t.slug}${mine ? "?with=mine" : ""}`} className="text-black no-underline hover:underline">
                    {t.name}
                    <span className="sr-only-abs"> template preview</span>
                  </Link>
                </h2>
                <span className="rounded-full bg-mint px-[9px] py-1 font-mono text-[11px] text-brand">ONE COLUMN</span>
              </div>
              <p className="m-0 text-sm leading-normal text-muted">{t.best}</p>
              <div className="mt-auto flex gap-2">
                <a href={`/api/templates/${t.slug}?format=docx${q}`} aria-label={`Download ${t.name} as Word`} className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full bg-black text-sm text-white no-underline hover:bg-ink-2 hover:text-white">
                  Word
                </a>
                <a href={`/api/templates/${t.slug}?format=pdf${q}`} aria-label={`Download ${t.name} as PDF`} className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-edge bg-white text-sm text-black no-underline hover:bg-paper hover:text-black">
                  PDF
                </a>
              </div>
            </article>
          ))}
        </div>
      </main>
    </StudentShell>
  );
}
