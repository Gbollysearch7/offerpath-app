import type { Metadata } from "next";
import Link from "next/link";
import { StudentShell } from "@/components/StudentShell";
import { cx, PageTitle, pill } from "@/components/ui";
import { APTITUDE_SETS } from "@/lib/practice";
import { requireStudent } from "@/lib/session";
import { AptitudeQuiz } from "./AptitudeQuiz";

export const metadata: Metadata = { title: "Aptitude tests" };

type SetKey = keyof typeof APTITUDE_SETS;

export default async function AptitudePage({ searchParams }: { searchParams: Promise<{ set?: string }> }) {
  const { profile } = await requireStudent();
  const sp = await searchParams;
  const keys = Object.keys(APTITUDE_SETS) as SetKey[];
  const key = keys.find((k) => k === sp.set) ?? "numerical";
  const set = APTITUDE_SETS[key];
  return (
    <StudentShell profile={profile} active="practice">
      <main id="main" className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-8 pb-16 sm:px-7">
        <PageTitle kicker="PRACTICE" title="Aptitude tests" sub="Short practice sets like the ones employers use. Nothing is saved." />
        <nav aria-label="Test type" className="flex flex-wrap gap-2">
          {keys.map((k) => (
            <Link key={k} href={`/practice/aptitude?set=${k}`} aria-current={k === key ? "page" : undefined} className={cx(pill(k === key), "inline-flex items-center no-underline", k === key ? "hover:text-white" : "hover:text-black")}>
              {APTITUDE_SETS[k].title}
            </Link>
          ))}
        </nav>
        <AptitudeQuiz key={key} title={set.title} intro={set.intro} minutes={set.minutes} questions={set.questions} />
      </main>
    </StudentShell>
  );
}
