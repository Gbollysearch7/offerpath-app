import { z } from "zod";
import type { Repo } from "@/lib/repo/types";
import type { CvReviewPayload } from "@/lib/types";
import { log } from "@/lib/log";
import { projectReport, SCOPE_INFO, viewDigest } from "./projection";
import { renderSharedFragment } from "./render";
import { hashShareToken, newShareToken, sharePath } from "./token";
import { SHARE_EXPIRY_DAYS, SHARE_SCOPES, type ShareLinkRecord, type ShareScope } from "./types";

export type ShareStatus = "active" | "expired" | "revoked" | "report_changed" | "paused";

export const STATUS_LABEL: Record<ShareStatus, string> = {
  active: "Active",
  expired: "Expired",
  revoked: "Switched off",
  report_changed: "Stopped: the report changed after you shared it",
  paused: "Paused: your university has sharing switched off",
};

export const NOT_AVAILABLE = "We couldn't create that link.";
export const CHANGED = "This report changed after you opened this page. Check the preview again.";

const Input = z.object({ reportId: z.uuid(), scope: z.enum(SHARE_SCOPES), expiryDays: z.union(SHARE_EXPIRY_DAYS.map((d) => z.literal(d)) as [z.ZodLiteral<number>, z.ZodLiteral<number>, z.ZodLiteral<number>]), previewDigest: z.string().regex(/^[0-9a-f]{64}$/) });

export interface ShareOption {
  scope: ShareScope;
  label: string;
  includes: string[];
  html: string;
  digest: string;
}

/** One entry per scope: what it includes, the exact page a recipient would get, and the fingerprint that ties activation to it. */
export const shareOptions = (payload: CvReviewPayload, createdAt: string): ShareOption[] =>
  SHARE_SCOPES.map((scope) => {
    const view = projectReport(payload, createdAt, scope);
    return { scope, ...SCOPE_INFO[scope], html: renderSharedFragment(view), digest: viewDigest(view, payload) };
  });

/**
 * Makes a link for one of the student's own CV reviews. The token is returned here once and is never stored or logged.
 * The scope comes from a fixed list and is recomputed from the report, so a tampered form can only pick a listed scope of
 * the student's own report, and activation fails unless the report still matches the preview the student saw.
 */
export async function createShareFlow(repo: Repo, input: unknown): Promise<{ path: string; expiresAt: string } | { error: string }> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { error: NOT_AVAILABLE };
  const { reportId, scope, expiryDays, previewDigest } = parsed.data;
  if (!(await repo.sharingEnabled())) return { error: NOT_AVAILABLE };
  const report = await repo.getReport<CvReviewPayload>(reportId);
  if (!report || report.row.type !== "cv_review") return { error: NOT_AVAILABLE };
  const contentDigest = viewDigest(projectReport(report.payload, report.row.createdAt, scope), report.payload);
  if (contentDigest !== previewDigest) return { error: CHANGED };
  const token = newShareToken();
  const expiresAt = new Date(Date.now() + expiryDays * 864e5).toISOString();
  try {
    await repo.createShareLink({ reportId, tokenHash: hashShareToken(token), scope, contentDigest, expiresAt });
  } catch (e) {
    log("error", "share-create-failed", { error: e });
    return { error: NOT_AVAILABLE };
  }
  return { path: sharePath(token), expiresAt };
}

export async function revokeShareFlow(repo: Repo, linkId: unknown): Promise<{ ok: true } | { error: string }> {
  const id = z.uuid().safeParse(linkId);
  if (!id.success || !(await repo.revokeShareLink(id.data))) return { error: "We couldn't find that link." };
  return { ok: true };
}

/** What a student is told about a link. A link is live only if every one of these checks passes, as in the public route. */
export async function shareStatuses(repo: Repo, links: ShareLinkRecord[]): Promise<Map<string, ShareStatus>> {
  const enabled = await repo.sharingEnabled();
  const out = new Map<string, ShareStatus>();
  for (const link of links) {
    let status: ShareStatus = link.revokedAt ? "revoked" : new Date(link.expiresAt).getTime() <= Date.now() ? "expired" : enabled ? "active" : "paused";
    if (status === "active") {
      const report = await repo.getReport<CvReviewPayload>(link.reportId).catch(() => null);
      if (!report || viewDigest(projectReport(report.payload, report.row.createdAt, link.scope), report.payload) !== link.contentDigest) status = "report_changed";
    }
    out.set(link.id, status);
  }
  return out;
}

/** The portable record of a student's links for "Download my data". No token, hash or fingerprint. */
export const exportShareLinks = (links: ShareLinkRecord[]) => links.map(({ id, reportId, scope, createdAt, expiresAt, revokedAt, accesses }) => ({ id, reportId, scope, createdAt, expiresAt, revokedAt, opened: accesses }));
