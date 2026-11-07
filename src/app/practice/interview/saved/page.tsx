import type { Metadata } from "next";
import Link from "next/link";
import { StudentShell } from "@/components/StudentShell";
import { fmtDate, PageTitle } from "@/components/ui";
import { requireStudent } from "@/lib/session";
import { FeedbackView } from "../FeedbackView";
import { DeleteAnswer } from "./DeleteAnswer";

export const metadata: Metadata = { title: "Saved answers" };

export default async function SavedAnswersPage() {
  const { profile, repo } = await requireStudent();
  const answers = await repo.practiceAnswers();
  return (
    <StudentShell profile={profile} active="practice">
      <main id="main" className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-8 pb-16 sm:px-7">
        <PageTitle kicker="PRACTICE" title="Your saved answers" sub="Only you can see these. Careers staff can't. They're included when you download your data, and go when you delete them or your account." />
        <Link href="/practice/interview" className="w-fit text-sm text-black">
          Back to interview practice
        </Link>
        {answers.length === 0 && <p className="m-0 rounded-3xl bg-white p-6 text-[15px] text-body">Nothing saved yet. Answers you get feedback on appear here.</p>}
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {answers.map((a) => (
            <li key={a.id} className="flex flex-col gap-3 rounded-3xl bg-white p-6">
              <p className="m-0 font-mono text-xs text-subtle">
                {fmtDate(a.createdAt).toUpperCase()} · {a.mode === "general" ? "GENERAL PRACTICE" : (a.roleLabel ?? "").toUpperCase()}
                {a.mode === "application" && !a.applicationId ? " · NO LONGER TRACKED" : ""}
              </p>
              <h2 className="m-0 text-[18px] font-normal leading-snug tracking-[-0.03em] [overflow-wrap:anywhere]">{a.question.q}</h2>
              {a.documentLabel && <p className="m-0 text-sm text-muted [overflow-wrap:anywhere]">Based on: {a.documentLabel}</p>}
              <details className="text-[15px]">
                <summary className="min-h-7 cursor-pointer text-sm text-black">
                  Your answer and its feedback<span className="sr-only-abs">: {a.question.q}</span>
                </summary>
                <div className="mt-3 flex flex-col gap-3">
                  <p className="m-0 whitespace-pre-wrap text-body [overflow-wrap:anywhere]">{a.answer}</p>
                  <FeedbackView feedback={a.feedback} />
                </div>
              </details>
              <DeleteAnswer id={a.id} name={a.question.q} />
            </li>
          ))}
        </ul>
      </main>
    </StudentShell>
  );
}
