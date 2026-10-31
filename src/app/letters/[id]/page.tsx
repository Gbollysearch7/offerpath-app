import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudentShell } from "@/components/StudentShell";
import { aiEnabled } from "@/lib/ai";
import { AI_LIMITS } from "@/lib/repo/types";
import { requireStudent } from "@/lib/session";
import type { CoverLetterPayload } from "@/lib/types";
import { LetterDraftView } from "./LetterDraftView";
import { LetterReviewView } from "./LetterReviewView";

// Server actions on this page can call Claude; allow up to 60 seconds.
export const maxDuration = 60;

export const metadata: Metadata = { title: "Cover letter" };

export default async function LetterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { repo, profile } = await requireStudent();
  const r = await repo.getReport<CoverLetterPayload>(id);
  if (!r || r.row.type !== "cover_letter") notFound();
  const used = await repo.aiUsedToday("letter");
  return (
    <StudentShell profile={profile} active="letters">
      {r.payload.mode === "draft" ? (
        <LetterDraftView id={id} p={r.payload} />
      ) : (
        <LetterReviewView id={id} p={r.payload} score={r.row.score ?? 0} left={AI_LIMITS.letter - used} limit={AI_LIMITS.letter} ai={aiEnabled()} />
      )}
    </StudentShell>
  );
}
