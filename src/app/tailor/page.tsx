import type { Metadata } from "next";
import Link from "next/link";
import { StudentShell } from "@/components/StudentShell";
import { btn, fmtShort } from "@/components/ui";
import { requireStudent } from "@/lib/session";
import { TailorStartForm, TrackedRoleButton } from "./TailorStartForm";

// Server actions on this page can call Claude; allow up to 60 seconds.
export const maxDuration = 60;

export const metadata: Metadata = { title: "Tailor to a job" };

export default async function TailorStartPage({ searchParams }: { searchParams: Promise<{ opp?: string }> }) {
  const { repo, profile } = await requireStudent();
  const [cvs, apps, tailors] = await Promise.all([repo.listReports({ type: "cv_review", limit: 20 }), repo.applications(), repo.listReports({ type: "tailor", limit: 50 })]);
  const preselect = (await searchParams).opp ?? null;
  const roles = apps.filter((a) => a.opportunityId).slice(0, 5);

  return (
    <StudentShell profile={profile} active="tailor">
      <main id="main" className="mx-auto flex max-w-[1120px] flex-wrap items-start gap-6 px-4 pt-12 pb-16 sm:px-7">
        <div className="flex-[1_1_100%]">
          <h1 className="m-0 text-[34px] font-normal leading-[1.1] tracking-[-1.5px] sm:text-[44px] sm:tracking-[-1.98px]">Tailor your CV to a job</h1>
          <p className="mt-2.5 mb-0 text-base text-muted">Paste a job link. We&apos;ll rewrite your profile and most relevant bullets for that role, show your match before and after, and give you the tailored CV to copy.</p>
        </div>
        {cvs.rows.length === 0 ? (
          <section className="flex flex-[1_1_100%] flex-col items-start gap-3 rounded-[28px] bg-white p-7">
            <p className="m-0 text-lg">Upload a CV first</p>
            <p className="m-0 text-sm text-muted">We compare your CV with the job ad, so we need one to start.</p>
            <Link href="/upload" className={btn.primary}>
              Upload my CV
            </Link>
          </section>
        ) : (
          <>
            <TailorStartForm cvs={cvs.rows.map((r) => ({ id: r.id, label: `${r.title} · score ${r.score ?? "–"}` }))} />
            <aside aria-labelledby="t-h" className="flex min-w-0 flex-[1_1_320px] flex-col gap-3 rounded-[28px] bg-white p-6">
              <h2 id="t-h" className="mt-0 mb-1 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
                OR PICK A TRACKED ROLE
              </h2>
              {roles.length === 0 && <p className="m-0 text-sm text-muted">Track roles in Opportunities and they&apos;ll show up here.</p>}
              {roles.map((r) => {
                const done = tailors.rows.find((t) => t.title === `${r.role} · ${r.org}`);
                return done ? (
                  <Link key={r.id} href={`/tailor/${done.id}`} className="flex flex-col gap-1 rounded-2xl bg-canvas px-4 py-3.5 text-black no-underline hover:bg-mist hover:text-black">
                    <span className="text-[15px]">
                      {r.role} · {r.org}
                    </span>
                    <span className="text-[13px] text-muted">{r.closesOn ? `Closes ${fmtShort(r.closesOn)} · ` : ""}already tailored</span>
                  </Link>
                ) : (
                  <TrackedRoleButton key={r.id} opportunityId={r.opportunityId!} title={`${r.role} · ${r.org}`} sub={r.closesOn ? `Closes ${fmtShort(r.closesOn)}` : "No deadline"} highlight={preselect === r.opportunityId} />
                );
              })}
              <Link href="/opportunities" className="mt-1 text-sm">
                Browse opportunities
              </Link>
            </aside>
          </>
        )}
      </main>
    </StudentShell>
  );
}
