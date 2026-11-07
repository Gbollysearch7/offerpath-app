import type { Metadata } from "next";
import Link from "next/link";
import { StudentShell } from "@/components/StudentShell";
import { Eyebrow, fmtDate } from "@/components/ui";
import { ACCESS_ACTION_LABEL, nextStepWith, REFERRAL_STATUS_LABEL } from "@/lib/institution/labels";
import { requireStudent } from "@/lib/session";
import { ReferralAnswer } from "./ReferralAnswer";

export const metadata: Metadata = { title: "Your careers service" };

const card = "flex flex-col gap-3 rounded-3xl bg-white px-6 py-[22px]";

export default async function CareersServicePage() {
  const { repo, profile } = await requireStudent();
  const [view, casework, notes] = await Promise.all([repo.myInstitution(), repo.myCasework(), repo.myAdviserNotes()]);
  await repo.markCaseworkSeen();
  const since = casework.seenAt ?? "";
  const isNew = (at: string) => at > since;
  const withdrawn = new Set(casework.disagreements.filter((d) => d.kind === "withdrawal").map((d) => d.withdrawsId));
  const name = view?.brandName || view?.universityName || profile.universityName || "Your careers service";
  const NewTag = ({ at }: { at: string }) => (isNew(at) ? <span className="ml-2 rounded-full bg-mist px-2 py-[3px] align-[2px] font-mono text-[10px] text-brand">NEW</span> : null);

  return (
    <StudentShell profile={profile} active={null}>
      <main id="main" className="mx-auto flex max-w-[860px] flex-col gap-5 px-4 pt-7 pb-14 sm:px-7">
        <div>
          <h1 className="m-0 text-[36px] font-normal leading-[1.1] tracking-[-1.6px] sm:text-[44px]" style={view?.brandColour ? { color: view.brandColour } : undefined}>
            {name}
          </h1>
          <p className="mt-2 mb-0 max-w-[720px] whitespace-pre-line text-[15px] leading-relaxed text-muted">{view?.welcome || "Support from your university's careers team, and what they have added for you."}</p>
          <p className="mt-2 mb-0 text-[13px] text-subtle">Your Readiness Score is worked out the same way for every student at every university. Nothing on this page changes it.</p>
        </div>

        <section aria-labelledby="who-h" className={card}>
          <Eyebrow id="who-h">WHO CAN SEE WHAT</Eyebrow>
          <p className="m-0 text-[15px] leading-relaxed">
            {profile.shareProgress
              ? "You share your progress, so your careers team can see your scores, leave notes and suggest referrals. They can't read your CV text, cover letters, tailored CVs or LinkedIn review."
              : "You aren't sharing your progress. Careers staff can't open your page, see your scores or act on anything below. What's already here stays for you to read."}
          </p>
          <Link href="/privacy" className="text-sm">
            Change what you share
          </Link>
        </section>

        <section aria-labelledby="ref-h" className={card}>
          <Eyebrow id="ref-h">REFERRALS</Eyebrow>
          {casework.referrals.length === 0 && <p className="m-0 text-sm text-muted">No referrals. If an adviser suggests one, you decide whether to accept it.</p>}
          {casework.referrals.map((r) => (
            <article key={r.id} className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
              <h2 className="m-0 text-[17px] font-normal">
                {r.target}
                <NewTag at={r.updatedAt} />
              </h2>
              <p className="m-0 whitespace-pre-line text-[15px] leading-relaxed">{r.reason}</p>
              <dl className="m-0 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[150px_1fr]">
                <dt className="text-subtle">Status</dt>
                <dd className="m-0">{REFERRAL_STATUS_LABEL[r.status]}</dd>
                <dt className="text-subtle">Suggested by</dt>
                <dd className="m-0">{r.createdBy} on {fmtDate(r.createdAt)}</dd>
                <dt className="text-subtle">Looked after by</dt>
                <dd className="m-0">{r.owner ?? "Nobody at the moment"}</dd>
                <dt className="text-subtle">Next step is with</dt>
                <dd className="m-0">{r.status === "proposed" ? "You" : nextStepWith(r)}</dd>
              </dl>
              {r.status === "proposed" && <ReferralAnswer id={r.id} target={r.target} />}
            </article>
          ))}
        </section>

        <section aria-labelledby="dis-h" className={card}>
          <Eyebrow id="dis-h">WHERE AN ADVISER SEES IT DIFFERENTLY</Eyebrow>
          {casework.disagreements.filter((d) => d.kind === "disagreement").length === 0 && <p className="m-0 text-sm text-muted">Nothing recorded.</p>}
          {casework.disagreements
            .filter((d) => d.kind === "disagreement")
            .map((d) => (
              <article key={d.id} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
                <p className="m-0 text-[15px] font-medium">
                  {d.targetKind === "score" ? "The automated score" : (d.judgment.name ?? "Part of a report")}: automated result {d.judgment.score ?? "none"}
                  <NewTag at={d.createdAt} />
                </p>
                <p className="mt-1 mb-0 whitespace-pre-line text-[15px] leading-relaxed">{d.rationale}</p>
                <p className="mt-1 mb-0 text-[13px] text-subtle">
                  {d.author} · {fmtDate(d.createdAt)}
                  {withdrawn.has(d.id) && " · later withdrawn by your careers team"}. <Link href={`/reviews/${d.reportId}`}>See the report</Link>. The automated result hasn&apos;t changed.
                </p>
              </article>
            ))}
        </section>

        <section aria-labelledby="notes-h" className={card}>
          <Eyebrow id="notes-h">ADVISER NOTES</Eyebrow>
          {notes.length === 0 && <p className="m-0 text-sm text-muted">No notes yet.</p>}
          {notes.map((n) => (
            <article key={n.id} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
              <p className="m-0 whitespace-pre-line text-[15px] leading-relaxed">{n.note}</p>
              <p className="mt-1 mb-0 text-[13px] text-subtle">
                {n.author} · {fmtDate(n.createdAt)}
              </p>
            </article>
          ))}
        </section>

        {view && view.resources.length > 0 && (
          <section aria-labelledby="res-h" className={card}>
            <Eyebrow id="res-h">RESOURCES FOR YOU</Eyebrow>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {view.resources.map((r) => (
                <li key={r.id}>
                  <a href={r.url} rel="noopener noreferrer" className="text-[15px]">
                    {r.title}
                  </a>
                  {r.description && <p className="mt-0.5 mb-0 text-sm text-muted">{r.description}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {view && view.contacts.length > 0 && (
          <section aria-labelledby="con-h" className={card}>
            <Eyebrow id="con-h">CONTACT YOUR SERVICE</Eyebrow>
            {view.contacts.map((c) => (
              <article key={c.id} className="border-t border-line pt-3 text-sm first:border-t-0 first:pt-0">
                <h2 className="m-0 text-[17px] font-normal">{c.label}</h2>
                {c.purpose && <p className="mt-0.5 mb-1 text-muted">{c.purpose}</p>}
                <p className="m-0 flex flex-wrap gap-x-4 gap-y-1">
                  {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                  {c.phone && <span>{c.phone}</span>}
                  {c.url && <a href={c.url} rel="noopener noreferrer">Website</a>}
                  {c.hours && <span className="text-subtle">{c.hours}</span>}
                </p>
              </article>
            ))}
          </section>
        )}

        <section aria-labelledby="log-h" className={card}>
          <Eyebrow id="log-h">WHEN CAREERS STAFF OPENED YOUR RECORD</Eyebrow>
          {casework.access.length === 0 && <p className="m-0 text-sm text-muted">Nothing logged yet.</p>}
          {casework.access.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
              {casework.access.slice(0, 50).map((a, i) => (
                <li key={`${a.at}-${i}`}>
                  {fmtDate(a.at)}: {a.actor}, {ACCESS_ACTION_LABEL[a.action].toLowerCase()}
                </li>
              ))}
            </ul>
          )}
          <p className="m-0 text-[13px] text-subtle">Kept for 24 months. It also appears in &quot;Download my data&quot;.</p>
        </section>
      </main>
    </StudentShell>
  );
}
