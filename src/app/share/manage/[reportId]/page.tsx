import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StudentShell } from "@/components/StudentShell";
import { shareOptions, shareStatuses } from "@/lib/sharing/flow";
import { NEVER_SHARED } from "@/lib/sharing/projection";
import { requireStudent } from "@/lib/session";
import type { CvReviewPayload } from "@/lib/types";
import { LinkList } from "../../LinkList";
import { ShareForm } from "../../ShareForm";

export const metadata: Metadata = { title: "Share a summary", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ManageReportSharing({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const { repo, profile } = await requireStudent();
  if (!(await repo.sharingEnabled())) notFound();
  const report = await repo.getReport<CvReviewPayload>(reportId);
  if (!report || report.row.type !== "cv_review") notFound();
  const [links, latest] = await Promise.all([repo.shareLinks(), repo.latestReport("cv_review")]);
  const own = links.filter((l) => l.reportId === reportId);
  const statuses = await shareStatuses(repo, own);
  return (
    <StudentShell profile={profile} active="review">
      <main id="main" className="mx-auto flex max-w-[760px] flex-col gap-5 px-4 pt-6 pb-14 sm:px-7">
        <div className="flex flex-col gap-2 px-1">
          <h1 className="m-0 text-[34px] font-normal leading-[1.1] tracking-[-1.5px]">Share a summary</h1>
          <p className="m-0 text-[15px] leading-normal text-muted [overflow-wrap:anywhere]">From your review of {report.payload.fileName}. The person you send it to won&apos;t see that name.</p>
          {latest && latest.row.id !== reportId && <p className="m-0 text-[15px] leading-normal text-black" data-share-older>You have a newer review. A link made here shares this older one.</p>}
          <p className="m-0 text-sm">
            <Link href={`/reviews/${reportId}`} className="text-muted">Back to this review</Link> · <Link href="/share/manage" className="text-muted">All your shared links</Link>
          </p>
        </div>
        <ShareForm reportId={reportId} options={shareOptions(report.payload, report.row.createdAt)} neverShared={NEVER_SHARED} />
        <section aria-labelledby="links-h" className="flex flex-col gap-3 rounded-3xl bg-white px-[26px] py-6">
          <h2 id="links-h" className="m-0 text-xl font-normal tracking-[-0.03em]">Links for this review</h2>
          <LinkList links={own} statuses={statuses} />
        </section>
      </main>
    </StudentShell>
  );
}
