import type { Metadata } from "next";
import { StudentShell } from "@/components/StudentShell";
import { shareStatuses } from "@/lib/sharing/flow";
import { requireStudent } from "@/lib/session";
import { LinkList } from "../LinkList";

export const metadata: Metadata = { title: "Shared links", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ManageSharing() {
  const { repo, profile } = await requireStudent();
  const [links, reports] = await Promise.all([repo.shareLinks(), repo.listReports({ type: "cv_review", limit: 200 })]);
  const statuses = await shareStatuses(repo, links);
  return (
    <StudentShell profile={profile} active="review">
      <main id="main" className="mx-auto flex max-w-[760px] flex-col gap-5 px-4 pt-6 pb-14 sm:px-7">
        <div className="flex flex-col gap-2 px-1">
          <h1 className="m-0 text-[34px] font-normal leading-[1.1] tracking-[-1.5px]">Shared links</h1>
          <p className="m-0 text-[15px] leading-normal text-muted">Each link shows a limited summary of one review to anyone who has it. Switching one off works straight away.</p>
        </div>
        <section aria-label="Your links" className="rounded-3xl bg-white px-[26px] py-6">
          <LinkList links={links} statuses={statuses} titles={new Map(reports.rows.map((r) => [r.id, r.title]))} />
        </section>
      </main>
    </StudentShell>
  );
}
