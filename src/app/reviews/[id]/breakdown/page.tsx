import type { Metadata } from "next";
import Link from "next/link";
import { ResultsSidebar } from "@/components/ResultsSidebar";
import { StudentShell, WithSidebar } from "@/components/StudentShell";
import { Arrow, Bar, checkBadge, cx, PageTitle } from "@/components/ui";
import { loadCvReview } from "../../load";

export const metadata: Metadata = { title: "Score breakdown" };

export default async function BreakdownPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, a } = await loadCvReview(id);
  return (
    <StudentShell profile={profile} active="review">
      <WithSidebar sidebar={<ResultsSidebar reviewId={id} areas={a.areas} active="breakdown" />}>
        <PageTitle title="Score breakdown" sub={`How your ${a.score} is made up. Each area is out of 100, each check out of 10.`} />
        <div className="flex flex-wrap gap-5">
          {a.areas.map((ar) => (
            <section key={ar.key} aria-labelledby={`area-${ar.key}`} className="flex min-w-0 flex-[1_1_380px] flex-col gap-3 rounded-3xl bg-white px-6 py-[22px]">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id={`area-${ar.key}`} className="m-0 text-[22px] font-normal tracking-[-0.04em]">
                  {ar.name}
                </h2>
                <p className="m-0 text-[30px] tracking-[-0.05em]">{ar.score}</p>
              </div>
              <Bar pct={ar.score} height={6} color={ar.score >= 75 ? "#36604E" : "#8FB3A1"} />
              <p className="m-0 text-sm leading-normal text-muted">{ar.what}</p>
              <div className="flex flex-col">
                {ar.checks.map((k) => (
                  <Link key={k.key} href={`/reviews/${id}/checks/${k.key}`} className="flex items-center gap-3 border-t border-line py-3 text-black no-underline hover:text-brand">
                    <span className={cx("inline-flex h-[26px] min-w-[34px] items-center justify-center rounded-full px-2 font-mono text-xs", checkBadge(k.score))}>
                      <span className="sr-only-abs">Score </span>
                      {k.score}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px]">{k.name}</span>
                      <span className="mt-0.5 block text-[13px] text-subtle">{k.summary}</span>
                    </span>
                    <Arrow color="#5C6B66" />
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
        <section id="how" aria-labelledby="how-h" className="flex flex-col gap-4 rounded-3xl bg-white px-6 py-[22px]">
          <h2 id="how-h" className="m-0 text-[22px] font-normal tracking-[-0.04em]">
            How your score is calculated
          </h2>
          <p className="m-0 text-[15px] leading-relaxed text-body">
            {a.meta.method === "ai"
              ? "Claude Haiku reads each bullet point and answers four fixed questions about it. It never gives a number. Your score is then calculated from those answers and from exact checks (contact details, sections, spelling, length), using the same formula for every student."
              : "Each bullet point is checked against four fixed questions using our rule engine, alongside exact checks (contact details, sections, spelling, length). Your score is calculated from those answers using the same formula for every student."}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="text-left">
                  {["QUESTION", "ANSWERS", "FEEDS"].map((h) => (
                    <th key={h} className="border-b border-line px-2 py-2 font-mono text-[11px] font-normal text-subtle">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["Does it show a measurable result?", "measured · partly · no", "Quantifying impact"],
                  ["How strong is the opening verb?", "strong · ok · weak", "Action verbs"],
                  ["Achievement or duty?", "achievement · duty", "Accomplishments"],
                  ["Relevant to your target sector?", "high · some · none", "Sector keywords (half), with keyword matches (half)"],
                ].map(([q, ans, feeds]) => (
                  <tr key={q}>
                    <td className="border-b border-line px-2 py-3">{q}</td>
                    <td className="border-b border-line px-2 py-3 text-muted">{ans}</td>
                    <td className="border-b border-line px-2 py-3 text-muted">{feeds}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm leading-normal text-body">
            <li>
              <span className="font-medium text-black">Same CV, same score.</span> The answers for each bullet are saved. Upload the same CV again, even re-exported, and you get exactly the same score.
            </li>
            <li>
              <span className="font-medium text-black">Only your changes move it.</span> When you edit your CV, only the bullets you changed are read again. Everything else keeps its answers.
            </li>
            <li>
              <span className="font-medium text-black">Area weights.</span> Impact 30%, Length and formatting 23.5%, Clarity 17.5%, Structure 17.5%, Spelling and grammar 11.5%. Sector fit is shown next to your score but isn&apos;t part of it, so picking a different sector never changes your score.
            </li>
          </ul>
          <p className="m-0 font-mono text-[11px] text-subtle">
            {a.meta.rubric ?? "rubric v1"} · {a.meta.judge ?? "rules"}
          </p>
        </section>
      </WithSidebar>
    </StudentShell>
  );
}
