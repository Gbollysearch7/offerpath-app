import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudentShell } from "@/components/StudentShell";
import { aiEnabled } from "@/lib/ai";
import { AI_LIMITS } from "@/lib/repo/types";
import { requireStudent } from "@/lib/session";
import { letterExport, letterView } from "@/lib/analysis/letter-edits";
import { LEGACY_LETTER_NOTE } from "@/lib/analysis/letter-content";
import type { CoverLetterPayload, CvReviewPayload } from "@/lib/types";
import { LetterDraftView } from "./LetterDraftView";
import { LetterReviewView } from "./LetterReviewView";
import { LetterWorkspace } from "./LetterWorkspace";

// Server actions on this page can call Claude; allow up to 60 seconds.
export const maxDuration = 60;

export const metadata: Metadata = { title: "Cover letter" };

const NOTICES: Record<string, string> = {
  ai_unavailable: "The writing tool wasn't available, so we built this draft from your CV and the job ad using our rules. It didn't count against today's limit. You can start again in a few minutes for an AI-written draft.",
  quota: `You've used today's ${AI_LIMITS.letter} AI drafts, so we built this one from your CV and the job ad using our rules. They reset at midnight.`,
};

export default async function LetterPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const { id } = await params;
  const notice = NOTICES[(await searchParams).notice ?? ""];
  const { repo, profile } = await requireStudent();
  const r = await repo.getReport<CoverLetterPayload>(id);
  if (!r || r.row.type !== "cover_letter") notFound();
  const used = await repo.aiUsedToday("letter");
  const cv = r.payload.cvReportId ? await repo.getReport<CvReviewPayload>(r.payload.cvReportId) : null;
  const view = letterView(r.payload, cv?.payload ?? null);
  const downloadable = letterExport(r.payload).kind === "ready";
  return (
    <StudentShell profile={profile} active="letters">
      {notice && (
        <p role="status" className="mx-auto mt-6 mb-0 max-w-[960px] rounded-2xl bg-white px-5 py-4 text-sm leading-[1.55] text-body">
          {notice}
        </p>
      )}
      {view && r.payload.review ? (
        <LetterWorkspace id={id} p={r.payload} view={view} review={r.payload.review} left={AI_LIMITS.letter - used} limit={AI_LIMITS.letter} ai={aiEnabled()} />
      ) : (
        // A report from before versioned letter scoring: shown as it was saved, with what that number can and can't say.
        <>
          <p role="note" className="mx-auto mt-6 mb-0 max-w-[960px] rounded-2xl bg-white px-5 py-4 text-sm leading-[1.55] text-body">
            {LEGACY_LETTER_NOTE}
          </p>
          {r.payload.mode === "draft" ? <LetterDraftView id={id} p={r.payload} downloadable={downloadable} /> : <LetterReviewView id={id} p={r.payload} score={r.row.score} downloadable={downloadable} />}
        </>
      )}
    </StudentShell>
  );
}
