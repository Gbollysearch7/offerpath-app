import type { Metadata } from "next";
import Link from "next/link";
import { deleteAccount } from "@/app/actions/account";
import { setAdviserCvSharing, setDeadlineReminders, setShareProgress } from "@/app/actions/cv";
import { featureFlags } from "@/lib/env";
import { SavedSwitch, Switch } from "@/components/client";
import { StudentShell } from "@/components/StudentShell";
import { Eyebrow } from "@/components/ui";
import { requireStudent } from "@/lib/session";

export const metadata: Metadata = { title: "Privacy and my data" };

export default async function PrivacyPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { repo, profile } = await requireStudent();
  const counts = await repo.counts();
  const adviserCv = featureFlags.adviserCvAccess();
  const confirmError = (await searchParams).error === "confirm";
  const held = [
    { n: counts.cvs, t: "CVs uploaded" },
    { n: counts.reports, t: "Reports saved" },
    { n: counts.letters, t: "Cover letters" },
    { n: counts.applications, t: "Tracked applications" },
  ];

  return (
    <StudentShell profile={profile} active="dashboard">
      <main id="main" className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-10 pb-16 sm:px-7">
        <div>
          <h1 className="m-0 text-[34px] font-normal leading-[1.1] tracking-[-1.5px] sm:text-[44px] sm:tracking-[-1.98px]">Privacy and my data</h1>
          <p className="mt-2.5 mb-0 text-base text-muted">You&apos;re in control. Here&apos;s what we hold, who can see it, and how to take it with you.</p>
        </div>

        <section aria-labelledby="w-h" className="flex flex-col gap-2.5 rounded-3xl bg-white px-[26px] py-6">
          <Eyebrow id="w-h">WHO LOOKS AFTER YOUR DATA</Eyebrow>
          <p className="m-0 text-base leading-relaxed">
            The <span className="font-medium">{profile.universityName ?? "your university"}</span> controls your data. Offerpath processes it on their behalf under UK GDPR. Your files and account are stored in the UK or EU. When AI feedback is on, the text of your CV, job ads and letters is sent to Anthropic to generate it; Anthropic doesn&apos;t use it to train its models.
          </p>
          <Link href="/legal/privacy" className="text-sm">
            Read the full privacy notice
          </Link>
        </section>

        <section aria-labelledby="h-h" className="flex flex-col gap-3.5 rounded-3xl bg-white px-[26px] py-6">
          <Eyebrow id="h-h">WHAT WE HOLD</Eyebrow>
          <div className="flex flex-wrap gap-3">
            {held.map((h) => (
              <div key={h.t} className="flex-[1_1_160px] rounded-2xl bg-canvas px-4 py-3.5">
                <p className="m-0 text-[28px] tracking-[-0.05em]">{h.n}</p>
                <p className="mt-0.5 mb-0 text-[13px] text-muted">{h.t}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="s-h" className="rounded-3xl bg-white px-[26px] py-3">
          <Eyebrow id="s-h" className="mt-3 mb-1">
            SHARING
          </Eyebrow>
          <div className="flex items-center gap-5 border-b border-line py-[18px]">
            <div className="flex-1">
              <p className="m-0 text-base">Share progress with my careers service</p>
              <p className="mt-1 mb-0 text-sm leading-[1.45] text-muted">Your careers team can see your scores and activity next to your student number, so they can offer help. Never your CV.</p>
            </div>
            <SavedSwitch initial={profile.shareProgress} label="Share progress with my careers service" save={setShareProgress} />
          </div>
          <div className="flex items-center gap-5 border-b border-line py-[18px]">
            <div className="flex-1">
              <p className="m-0 text-base">Deadline reminders by email</p>
              <p className="mt-1 mb-0 text-sm leading-[1.45] text-muted">One email a week before each tracked deadline.</p>
            </div>
            <SavedSwitch initial={profile.deadlineReminders} label="Deadline reminders by email" save={setDeadlineReminders} />
          </div>
          <div className="flex items-center gap-5 border-b border-line py-[18px]">
            <div className="flex-1">
              <p className="m-0 text-base">
                Let my adviser view my CV {!adviserCv && <span className="ml-1.5 rounded-full bg-canvas px-2 py-[3px] align-[2px] font-mono text-[10px] text-muted">COMING SOON</span>}
              </p>
              <p className="mt-1 mb-0 text-sm leading-[1.45] text-muted">{adviserCv ? "Careers advisers at your university can open your CVs to help you. Every time they do is logged. Switch off any time." : "Advisers can open your CV only if you switch this on. Launching after a legal review."}</p>
            </div>
            {adviserCv ? <SavedSwitch initial={profile.adviserCanViewCv} label="Let my adviser view my CV" save={setAdviserCvSharing} /> : <Switch on={false} disabled label="Let my adviser view my CV (coming soon)" />}
          </div>
          <p className="mt-3.5 mb-3 text-[13px] text-subtle">Reports your careers service exports always leave out groups smaller than five.</p>
        </section>

        <section aria-labelledby="a-h" className="rounded-3xl bg-mist px-[26px] py-[22px]">
          <h2 id="a-h" className="m-0 text-[17px] font-medium">
            About AI scores
          </h2>
          <p className="mt-1.5 mb-0 text-[15px] leading-relaxed text-body">Your Readiness Score is guidance, not a verdict, and it&apos;s worked out the same way for every student. If you disagree with it, talk to your careers adviser. Suggested rewrites only use facts from your own CV.</p>
        </section>

        <section aria-labelledby="d-h" className="flex flex-wrap items-start gap-5 rounded-3xl bg-white px-[26px] py-6">
          <div className="flex-[1_1_360px]">
            <h2 id="d-h" className="m-0 text-xl font-normal tracking-[-0.03em]">
              Take your data or delete it
            </h2>
            <p className="mt-1.5 mb-0 text-sm leading-[1.55] text-muted">Download everything as a ZIP of your CVs, reports and letters. Deleting your account removes it all straight away and can&apos;t be undone.</p>
          </div>
          <div className="flex flex-col gap-3">
            <a href="/api/export" className="inline-flex min-h-[46px] items-center justify-center rounded-full bg-black px-5 text-sm font-medium text-white no-underline hover:bg-ink-2 hover:text-white">
              Download my data
            </a>
            <details className="rounded-2xl border border-edge p-3" open={confirmError}>
              <summary className="cursor-pointer text-sm">Delete my account</summary>
              <form action={deleteAccount} className="mt-3 flex flex-col gap-2">
                <label className="flex flex-col gap-1.5 text-[13px] text-muted">
                  Type DELETE to confirm
                  <input name="confirm" autoComplete="off" aria-invalid={confirmError} className="min-h-10 rounded-xl border border-edge px-3 text-sm text-black" />
                </label>
                {confirmError && (
                  <p role="alert" className="m-0 text-[13px] text-black">
                    Type DELETE in capitals to confirm.
                  </p>
                )}
                <button type="submit" className="min-h-[42px] rounded-full border border-black bg-white px-5 text-sm text-black hover:bg-black hover:text-white">
                  Delete everything
                </button>
              </form>
            </details>
          </div>
        </section>
      </main>
    </StudentShell>
  );
}
