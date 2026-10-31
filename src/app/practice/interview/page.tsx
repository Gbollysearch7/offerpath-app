import type { Metadata } from "next";
import { StudentShell } from "@/components/StudentShell";
import { PageTitle } from "@/components/ui";
import { INTERVIEW_SECTORS, interviewQuestions } from "@/lib/practice";
import { requireStudent } from "@/lib/session";
import { InterviewPractice } from "./InterviewPractice";

export const metadata: Metadata = { title: "Interview practice" };

export default async function InterviewPage({ searchParams }: { searchParams: Promise<{ sector?: string }> }) {
  const { profile } = await requireStudent();
  const sp = await searchParams;
  const sector = INTERVIEW_SECTORS.find((s) => s === sp.sector) ?? profile.sectors.find((s) => INTERVIEW_SECTORS.includes(s)) ?? "";
  return (
    <StudentShell profile={profile} active="practice">
      <main id="main" className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-8 pb-16 sm:px-7">
        <PageTitle kicker="PRACTICE" title="Interview practice" sub="Write your answer as you'd say it. Feedback checks structure, not content, and nothing is saved." />
        <form action="/practice/interview" className="flex flex-wrap items-center gap-2.5">
          <label htmlFor="sector" className="text-sm text-muted">
            Sector
          </label>
          <select id="sector" name="sector" defaultValue={sector} className="min-h-11 rounded-full border border-edge bg-white px-3.5 text-sm">
            <option value="">General questions only</option>
            {INTERVIEW_SECTORS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button type="submit" className="min-h-11 rounded-full border-0 bg-black px-[18px] text-sm font-medium text-white hover:bg-ink-2">
            Show questions
          </button>
        </form>
        <InterviewPractice key={sector} questions={interviewQuestions(sector)} />
      </main>
    </StudentShell>
  );
}
