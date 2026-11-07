import type { Metadata } from "next";
import Link from "next/link";
import { StudentShell } from "@/components/StudentShell";
import { btn, PageTitle } from "@/components/ui";
import { INTERVIEW_SECTORS } from "@/lib/practice";
import { questionsFor, resolveGrounding } from "@/lib/practice-flow";
import { generalQuestions } from "@/lib/practice-questions";
import { OBJECTIVE_LABEL, PRACTICE_OBJECTIVES, type PracticeObjective } from "@/lib/practice-types";
import { requireStudent } from "@/lib/session";
import { ApproveVersion } from "./ApproveVersion";
import { InterviewPractice } from "./InterviewPractice";

export const metadata: Metadata = { title: "Interview practice" };
export const maxDuration = 60;

const LIMITS = "Written answers only: nothing is recorded, and nothing here judges your accent, appearance or personality, or how employable you are. It's practice, not a personal coach, and it doesn't predict interview results.";
const selectClass = "min-h-11 max-w-full rounded-full border border-edge bg-white px-3.5 text-sm";
const submitClass = "min-h-11 rounded-full border-0 bg-black px-[18px] text-sm font-medium text-white hover:bg-ink-2";

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-white p-6">
      <h2 className="m-0 text-[20px] font-normal tracking-[-0.03em] [overflow-wrap:anywhere]">{title}</h2>
      {children}
    </section>
  );
}

export default async function InterviewPage({ searchParams }: { searchParams: Promise<{ sector?: string; application?: string; objective?: string }> }) {
  const { profile, repo } = await requireStudent();
  const sp = await searchParams;
  const applications = await repo.applications();
  const footer = (
    <p className="m-0 text-sm text-muted">
      {LIMITS}{" "}
      <Link href="/practice/interview/saved" className="text-black">
        Your saved answers
      </Link>
    </p>
  );

  if (sp.application) {
    const g = await resolveGrounding(repo, sp.application);
    const objective: PracticeObjective = PRACTICE_OBJECTIVES.find((o) => o === sp.objective) ?? "all";
    const roleName = g.state === "not-found" ? "" : `${g.application.role} at ${g.application.org}`;
    const questions = g.state === "ready" ? questionsFor(g.questions, objective) : [];
    return (
      <StudentShell profile={profile} active="practice">
        <main id="main" className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-8 pb-16 sm:px-7">
          <PageTitle kicker="PRACTICE" title={g.state === "not-found" ? "Interview practice" : `Practice for ${roleName}`} sub="Questions built by rules from the CV version you choose and this role's advert. Each one says why it's there." />
          <Link href="/practice/interview" className="w-fit text-sm text-black">
            General practice instead
          </Link>
          {g.state === "not-found" && (
            <Panel title="We couldn't find that application">
              <p className="m-0 text-[15px] text-body">It may have stopped being tracked. General practice is still available.</p>
            </Panel>
          )}
          {g.state === "no-cv" && (
            <Panel title="There's no CV on this application yet">
              <p className="m-0 text-[15px] text-body">Questions for a role come from your CV and its advert, so this needs a CV first. You can add one from your dashboard, or use general practice.</p>
              <Link href="/dashboard" className={`${btn.secondary} w-fit`}>
                Go to your applications
              </Link>
            </Panel>
          )}
          {g.state === "unapproved" && (
            <Panel title="Which CV are you using for this role?">
              <p className="m-0 text-[15px] text-body">Questions come from the exact version you choose. Choosing one also keeps it on this application, and you can change it from your dashboard.</p>
              {g.note && <p className="m-0 text-sm text-black">{g.note}</p>}
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {g.candidates.map((c) => (
                  <li key={c.reportId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-canvas p-4">
                    <span className="min-w-0 flex-[1_1_220px] text-[15px] [overflow-wrap:anywhere]">
                      {c.label}
                      {c.blocked && <span className="block text-sm text-muted">{c.blocked} You can do that from the tailoring page.</span>}
                    </span>
                    {c.version && <ApproveVersion applicationId={g.application.id} reportId={c.reportId} kind={c.kind} version={c.version} holder={c.holder} label={c.label} />}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {g.state === "ready" && (
            <>
              <div className="flex flex-col gap-1 rounded-3xl bg-white p-6 text-sm text-body">
                <p className="m-0 [overflow-wrap:anywhere]">
                  <span className="font-medium text-black">Based on:</span> {g.document.label}
                  {g.advert ? (g.advert.from === "tailor" ? ", and the advert you tailored it to." : ", and this role's listing.") : "."}
                </p>
                {g.document.note && <p className="m-0">{g.document.note}</p>}
                {!g.match && <p className="m-0">{g.advert ? "We couldn't read any requirements from the advert," : "We don't have an advert for this role,"} so these questions come from your CV and the role&apos;s title only. Tailoring your CV to the advert adds questions about its requirements.</p>}
              </div>
              <form action="/practice/interview" className="flex flex-wrap items-center gap-2.5">
                <input type="hidden" name="application" value={g.application.id} />
                <label htmlFor="objective" className="text-sm text-muted">
                  What do you want to practise?
                </label>
                <select id="objective" name="objective" defaultValue={objective} className={selectClass}>
                  {PRACTICE_OBJECTIVES.map((o) => (
                    <option key={o} value={o}>
                      {OBJECTIVE_LABEL[o]}
                    </option>
                  ))}
                </select>
                <button type="submit" className={submitClass}>
                  Show questions
                </button>
              </form>
              {questions.length > 0 ? (
                <InterviewPractice key={`${g.document.version}:${objective}`} questions={questions} applicationId={g.application.id} sector="" objective={objective} />
              ) : (
                <Panel title="Nothing for that choice">
                  <p className="m-0 text-[15px] text-body">We don&apos;t have any questions of that kind for this CV and advert. Choose another option above.</p>
                </Panel>
              )}
            </>
          )}
          {footer}
        </main>
      </StudentShell>
    );
  }

  const sector = INTERVIEW_SECTORS.find((s) => s === sp.sector) ?? profile.sectors.find((s) => INTERVIEW_SECTORS.includes(s)) ?? "";
  return (
    <StudentShell profile={profile} active="practice">
      <main id="main" className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-8 pb-16 sm:px-7">
        <PageTitle kicker="PRACTICE" title="Interview practice" sub="Write your answer as you'd say it. Feedback looks at what's in your answer as well as its shape." />
        {applications.length > 0 && (
          <Panel title="Practise for a role you're tracking">
            <p className="m-0 text-[15px] text-body">Questions come from the CV version you choose and the role&apos;s advert, and your answers stay with that application.</p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {applications.map((a) => (
                <li key={a.id}>
                  <Link href={`/practice/interview?application=${encodeURIComponent(a.id)}`} className="inline-flex min-h-11 items-center text-[15px] text-black [overflow-wrap:anywhere]">
                    {a.role} at {a.org}
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        <h2 className="m-0 text-[20px] font-normal tracking-[-0.03em]">General practice</h2>
        <p className="m-0 -mt-3 text-[15px] text-body">Typical questions, not based on your CV or a particular role. You don&apos;t need an application for these.</p>
        <form action="/practice/interview" className="flex flex-wrap items-center gap-2.5">
          <label htmlFor="sector" className="text-sm text-muted">
            Sector
          </label>
          <select id="sector" name="sector" defaultValue={sector} className={selectClass}>
            <option value="">General questions only</option>
            {INTERVIEW_SECTORS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button type="submit" className={submitClass}>
            Show questions
          </button>
        </form>
        <InterviewPractice key={sector} questions={generalQuestions(sector)} applicationId={null} sector={sector} objective="all" />
        {footer}
      </main>
    </StudentShell>
  );
}
