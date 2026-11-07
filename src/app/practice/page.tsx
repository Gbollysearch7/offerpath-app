import type { Metadata } from "next";
import Link from "next/link";
import { StudentShell } from "@/components/StudentShell";
import { Arrow, PageTitle } from "@/components/ui";
import { requireStudent } from "@/lib/session";

export const metadata: Metadata = { title: "Practice" };

const TOOLS = [
  ["/practice/interview", "Interview practice", "Answer typical interview questions, or questions built from your CV and a role you're tracking, in writing. Feedback covers what's in your answer as well as its shape."],
  ["/practice/aptitude", "Aptitude tests", "Timed numerical, verbal and logical practice sets, with worked answers."],
  ["/practice/roadmap", "Role roadmaps", "What to do and when, year by year, for the sector you're aiming at."],
] as const;

export default async function PracticePage() {
  const { profile } = await requireStudent();
  return (
    <StudentShell profile={profile} active="practice">
      <main id="main" className="mx-auto flex max-w-[1100px] flex-col gap-5 px-4 pt-8 pb-16 sm:px-7">
        <PageTitle kicker="PRACTICE" title="Get ready for the next stage" sub="Practise for interviews and tests, and plan your applications." />
        <div className="grid gap-4 md:grid-cols-3">
          {TOOLS.map(([href, title, body]) => (
            <Link key={href} href={href} className="group flex flex-col gap-2 rounded-3xl bg-white p-6 text-black no-underline hover:text-black hover:shadow-md">
              <h2 className="m-0 text-[22px] font-normal tracking-[-0.04em]">{title}</h2>
              <p className="m-0 flex-1 text-[15px] leading-relaxed text-muted">{body}</p>
              <span className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium">
                Start <Arrow />
              </span>
            </Link>
          ))}
        </div>
      </main>
    </StudentShell>
  );
}
