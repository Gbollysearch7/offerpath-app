import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { Eyebrow, fmtDate } from "@/components/ui";
import { nextStepWith, REFERRAL_STATUS_LABEL } from "@/lib/institution/labels";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Referrals" };

export default async function CaseworkPage() {
  const { repo, profile } = await requireStaff();
  const [uni, queue] = await Promise.all([repo.adminUniversity(), repo.adminCasework()]);
  const isAdmin = profile.role === "admin";
  return (
    <AdminShell profile={profile} university={uni.name} active="casework" title="Referrals" intro={isAdmin ? "Every open referral at your university, and who has the next step." : "Open referrals you own, and who has the next step."}>
      <section aria-labelledby="open-h" className="flex flex-col gap-1 rounded-3xl bg-white px-6 py-[22px]">
        <Eyebrow id="open-h">OPEN · {queue.referrals.length}</Eyebrow>
        {queue.referrals.length === 0 && <p className="m-0 text-sm text-muted">Nothing open.</p>}
        {queue.referrals.map((r) => (
          <article key={r.id} className="flex flex-col gap-1 border-t border-line py-3 first:border-t-0">
            <p className="m-0 text-[15px]">
              <Link href={`/admin/students/${r.studentKey}`}>Student {r.studentNumber}</Link> → {r.target}
            </p>
            <p className="m-0 text-sm text-muted">{r.reason}</p>
            <p className="m-0 text-[13px] text-subtle">
              {REFERRAL_STATUS_LABEL[r.status]} · owner: {r.ownerGone ? "nobody, give it an owner" : r.mine ? "you" : r.owner} · next step with {nextStepWith(r)} · updated {fmtDate(r.updatedAt)}
            </p>
          </article>
        ))}
        {queue.hidden > 0 && <p className="m-0 border-t border-line pt-3 text-sm text-muted">{queue.hidden === 1 ? "1 more referral is" : `${queue.hidden} more referrals are`} hidden because the student isn&apos;t sharing with you at the moment.</p>}
      </section>
    </AdminShell>
  );
}
