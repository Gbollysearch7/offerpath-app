import type { Metadata } from "next";
import { ResultsSidebar } from "@/components/ResultsSidebar";
import { StudentShell, WithSidebar } from "@/components/StudentShell";
import { PageTitle } from "@/components/ui";
import { aiEnabled } from "@/lib/ai";
import { AI_LIMITS } from "@/lib/repo/types";
import { presentLines } from "@/lib/rewrite-flow";
import { loadCvReview } from "../../load";
import { LineEditor } from "./LineEditor";

// Server actions on this page can call Claude; allow up to 60 seconds.
export const maxDuration = 60;

export const metadata: Metadata = { title: "Line by line" };

export default async function LinesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ i?: string }> }) {
  const { id } = await params;
  const { repo, profile, a, report } = await loadCvReview(id);
  const used = await repo.aiUsedToday("line_rewrite");
  const start = Math.min(Math.max(0, Number((await searchParams).i) || 0), Math.max(0, a.lines.length - 1));
  return (
    <StudentShell profile={profile} active="review">
      <WithSidebar narrow sidebar={<ResultsSidebar reviewId={id} areas={a.areas} active="lines" />}>
        {a.lines.length === 0 ? (
          <>
            <PageTitle title="Line by line" sub="Improve your CV one bullet point at a time." />
            <p className="m-0 rounded-3xl bg-white p-6 text-[15px] text-muted">We couldn&apos;t find bullet points in your experience or projects. Use bullet points (•) under each role, then re-score your CV.</p>
          </>
        ) : (
          <LineEditor reviewId={id} lines={presentLines(report.payload)} start={start} left={AI_LIMITS.line_rewrite - used} limit={AI_LIMITS.line_rewrite} ai={aiEnabled()} />
        )}
      </WithSidebar>
    </StudentShell>
  );
}
