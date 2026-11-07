import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudentShell } from "@/components/StudentShell";
import { fmtShort } from "@/components/ui";
import { requireStudent } from "@/lib/session";
import { editView, presentTailor } from "@/lib/analysis/tailor-edits";
import type { CvReviewPayload, TailorPayload } from "@/lib/types";
import { TailorView } from "./TailorView";

// Server actions on this page can call Claude; allow up to 60 seconds.
export const maxDuration = 60;

export const metadata: Metadata = { title: "Tailor to a job" };

export default async function TailorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ auto?: string }> }) {
  const { id } = await params;
  const auto = (await searchParams).auto === "1";
  const { repo, profile } = await requireStudent();
  const r = await repo.getReport<TailorPayload>(id);
  if (!r || r.row.type !== "tailor") notFound();
  const p = r.payload;
  const cv = await repo.getReport<CvReviewPayload>(p.cvReportId);
  // Worked out here so the browser gets the summary, not every saved document. Reading the page changes nothing.
  const view = editView(p, cv?.payload ?? null);
  const forPage = { ...presentTailor(p), edits: undefined };
  return (
    <StudentShell profile={profile} active="tailor">
      <TailorView id={id} p={forPage} view={view} auto={auto && !p.tailored && !p.edits} subtitle={`Compared with ${p.cvFileName}${p.deadline ? ` · deadline ${fmtShort(p.deadline)}` : ""}`} />
    </StudentShell>
  );
}
