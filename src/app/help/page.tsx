import type { Metadata } from "next";
import Link from "next/link";
import { StudentShell } from "@/components/StudentShell";
import { requireStudent } from "@/lib/session";

export const metadata: Metadata = { title: "Help" };

const FAQ = [
  ["How is my Readiness Score worked out?", "We check your CV against 16 checks. Five areas make up the score: impact, clarity, structure, spelling and length. Each check is out of 10 and each area out of 100, and the score weights impact and length most, because recruiters notice them first. Sector fit, how well your CV matches the sector you pick, is shown separately and never changes your score. The same CV always gets the same score."],
  ["Do I need to get 100?", "No. A score of 75 or more is strong. Take the advice that fits the roles you want and ignore the rest. If you think a score is wrong, talk to your careers adviser."],
  ["Will the rewrites make things up?", "No. Suggested rewrites only use what's already in your CV. Where a number would help, we leave a [placeholder] for you to fill in with the real figure."],
  ["Why can't my file be read?", "Scanned or photographed CVs don't contain text we can read. Export your CV from Word or Google Docs as a PDF, keep it under 2 MB, and remove any password."],
  ["Who can see my CV?", "Only you. If you choose to share your progress, your careers service can see your scores and activity next to your student number, but not your CV. Reports they export leave out any group smaller than five."],
];

export default async function HelpPage() {
  const { profile } = await requireStudent();
  return (
    <StudentShell profile={profile} active="dashboard">
      <main id="main" className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-10 pb-16 sm:px-7">
        <h1 className="m-0 text-[34px] font-normal leading-[1.1] tracking-[-1.5px] sm:text-[44px] sm:tracking-[-1.98px]">Help</h1>
        <section className="rounded-3xl bg-white px-[26px] py-3">
          {FAQ.map(([q, a], i) => (
            <details key={q} className={i < FAQ.length - 1 ? "border-b border-line py-4" : "py-4"}>
              <summary className="cursor-pointer text-base">{q}</summary>
              <p className="mt-2.5 mb-0 text-[15px] leading-relaxed text-body">{a}</p>
            </details>
          ))}
        </section>
        <p className="m-0 text-sm text-muted">
          Still stuck? Contact your university careers service, or see <Link href="/privacy">Privacy and my data</Link>.
        </p>
      </main>
    </StudentShell>
  );
}
