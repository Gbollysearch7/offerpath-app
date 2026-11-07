"use server";

import { revalidatePath } from "next/cache";
import { hit, TOO_MANY } from "@/lib/rate-limit";
import { createShareFlow, revokeShareFlow } from "@/lib/sharing/flow";
import { getRepo } from "@/lib/session";

const EXPIRED = "Your session has expired. Sign in again.";

/** Creates a link. The token is in this reply and nowhere else, so the student is told to copy it now. */
export async function createShareLink(input: { reportId: string; scope: string; expiryDays: number; previewDigest: string }) {
  const repo = await getRepo();
  if (!repo) return { error: EXPIRED };
  if (!(await hit("shareCreatePerUser", repo.userId))) return { error: TOO_MANY };
  const r = await createShareFlow(repo, input);
  if (!("error" in r)) revalidatePath("/share/manage", "layout");
  return r;
}

/** Takes effect on the link's next request: the public route reads the database every time. */
export async function revokeShareLink(linkId: string) {
  const repo = await getRepo();
  if (!repo) return { error: EXPIRED };
  const r = await revokeShareFlow(repo, linkId);
  if (!("error" in r)) revalidatePath("/share/manage", "layout");
  return r;
}
