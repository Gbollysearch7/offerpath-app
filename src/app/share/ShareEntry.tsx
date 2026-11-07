import Link from "next/link";
import type { Repo } from "@/lib/repo/types";

/**
 * The way in from a report. Shown when the student's university allows sharing, or when they already have links, so they
 * can still see and revoke those after sharing is switched off. Sharing must never stop a report from opening.
 */
export async function ShareEntry({ repo, reportId }: { repo: Repo; reportId: string }) {
  const [enabled, links] = await Promise.all([repo.sharingEnabled().catch(() => false), repo.shareLinks().catch(() => [])]);
  if (!enabled && links.length === 0) return null;
  return (
    <p className="mt-2 mb-0 text-[13px] text-muted" data-share-entry>
      {enabled ? (
        <Link href={`/share/manage/${reportId}`} className="text-muted">
          Share a limited summary of this review
        </Link>
      ) : (
        <Link href="/share/manage" className="text-muted">
          Manage your shared links
        </Link>
      )}
    </p>
  );
}
