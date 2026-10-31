import type { Metadata } from "next";
import { StudentShell } from "@/components/StudentShell";
import { requireStudent } from "@/lib/session";
import { LetterStart } from "./LetterStart";

// Server actions on this page can call Claude; allow up to 60 seconds.
export const maxDuration = 60;

export const metadata: Metadata = { title: "Cover letters" };

export default async function LettersPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { repo, profile } = await requireStudent();
  const [tailors, cvs] = await Promise.all([repo.listReports({ type: "tailor", limit: 30 }), repo.listReports({ type: "cv_review", limit: 20 })]);
  const mode = (await searchParams).mode === "review" ? 1 : 0;
  return (
    <StudentShell profile={profile} active="letters">
      <LetterStart initialMode={mode} jobs={tailors.rows.map((t) => ({ id: t.id, label: t.title }))} cvs={cvs.rows.map((c) => ({ id: c.id, label: c.title }))} />
    </StudentShell>
  );
}
