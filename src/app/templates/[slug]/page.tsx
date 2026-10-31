import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CvPreview } from "@/components/CvPreview";
import { StudentShell } from "@/components/StudentShell";
import { myCvBlocks } from "@/lib/cv-blocks";
import { themeBySlug } from "@/lib/cv-themes";
import { templateBlocks } from "@/lib/documents";
import { requireStudent } from "@/lib/session";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return { title: `${themeBySlug((await params).slug)?.name ?? "CV"} template` };
}

export default async function TemplatePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ with?: string }> }) {
  const theme = themeBySlug((await params).slug);
  if (!theme) notFound();
  const { repo, profile } = await requireStudent();
  const mine = (await searchParams).with === "mine" ? await myCvBlocks(repo) : null;
  const blocks = mine ?? templateBlocks(theme);
  const q = mine ? "&with=mine" : "";
  const label = `${theme.name} template${mine ? " with your CV" : ""}, full page`;

  return (
    <StudentShell profile={profile} active="templates">
      <main id="main" className="mx-auto flex max-w-[1120px] flex-col gap-5 px-4 pt-6 pb-14 sm:px-7">
        <div className="flex flex-wrap items-end justify-between gap-4 px-1 pt-2">
          <div className="min-w-0">
            <Link href={`/templates${mine ? "?with=mine" : ""}`} className="font-mono text-xs no-underline">
              ← ALL TEMPLATES
            </Link>
            <h1 className="mt-1.5 mb-0 text-[34px] font-normal leading-[1.1] tracking-[-1.5px] sm:text-[44px] sm:tracking-[-1.98px]">{theme.name}</h1>
            <p className="mt-2 mb-0 max-w-[560px] text-[15px] text-muted">{theme.best}</p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Link href={`/templates/${theme.slug}${mine ? "" : "?with=mine"}`} className="inline-flex min-h-11 items-center rounded-full border border-edge bg-white px-[18px] text-sm text-black no-underline hover:bg-paper hover:text-black">
              {mine ? "Show the example" : "Show with my CV"}
            </Link>
            <a href={`/api/templates/${theme.slug}?format=docx${q}`} className="inline-flex min-h-11 items-center rounded-full bg-black px-[18px] text-sm font-medium text-white no-underline hover:bg-ink-2 hover:text-white">
              Download Word
            </a>
            <a href={`/api/templates/${theme.slug}?format=pdf${q}`} className="inline-flex min-h-11 items-center rounded-full border border-edge bg-white px-[18px] text-sm text-black no-underline hover:bg-paper hover:text-black">
              Download PDF
            </a>
          </div>
        </div>
        <div className="flex justify-center rounded-3xl bg-canvas px-3 py-6 sm:py-8">
          <div className="hidden sm:block">
            <CvPreview blocks={blocks} theme={theme} scale={0.95} clip={false} label={label} />
          </div>
          <div className="sm:hidden">
            <CvPreview blocks={blocks} theme={theme} scale={0.42} clip={false} label={label} />
          </div>
        </div>
        <p className="m-0 px-1 text-sm text-muted">The preview shows how the layout flows; Word and PDF split it into A4 pages. {mine ? "Your CV is laid out from the text we read from your file, so check every line before you send it." : "Keep the layout, then replace every detail with your own."}</p>
      </main>
    </StudentShell>
  );
}
