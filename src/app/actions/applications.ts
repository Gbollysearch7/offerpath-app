"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dismissActionFlow, keepVersionFlow, linkFlow, reopenActionFlow, trackRoleFlow, unlinkFlow, type LinkFlowResult } from "@/lib/applications/flow";
import { hit, TOO_MANY } from "@/lib/rate-limit";
import type { Repo } from "@/lib/repo/types";
import { getRepo } from "@/lib/session";

// OP-019. Each action works out who is asking from the session, never from what the page sent, and refuses anything else.

const EXPIRED = "Your session has expired. Sign in again, then come back to this page. Nothing here was changed.";
const INVALID = "We couldn't find that. Reload the page and try again.";

const Id = z.string().min(1).max(80);
const Kind = z.enum(["cv", "tailor", "letter"]);
const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const ActionKey = z.string().min(1).max(240).regex(/^[a-z-]+(:[A-Za-z0-9_.-]+)*$/);

async function guarded<T extends { error?: string }>(repo: Repo | null, fn: (repo: Repo) => Promise<T>): Promise<T | { error: string }> {
  if (!repo) return { error: EXPIRED };
  if (!(await hit("applicationChoicePerUser", repo.userId))) return { error: TOO_MANY };
  const out = await fn(repo);
  if (!out.error) {
    revalidatePath("/dashboard");
    revalidatePath("/opportunities");
  }
  return out;
}

export async function linkArtefact(applicationId: string, reportId: string, ifCurrent: string | null): Promise<LinkFlowResult> {
  const input = z.object({ applicationId: Id, reportId: Id, ifCurrent: Id.nullable() }).safeParse({ applicationId, reportId, ifCurrent });
  if (!input.success) return { error: INVALID };
  return guarded(await getRepo(), (repo) => linkFlow(repo, input.data));
}

export async function unlinkArtefact(applicationId: string, kind: string, ifCurrent: string): Promise<LinkFlowResult> {
  const input = z.object({ applicationId: Id, kind: Kind, ifCurrent: Id }).safeParse({ applicationId, kind, ifCurrent });
  if (!input.success) return { error: INVALID };
  return guarded(await getRepo(), (repo) => unlinkFlow(repo, input.data));
}

export async function keepVersion(applicationId: string, reportId: string, kind: string, seen: string | null, ifCurrent: string | null): Promise<LinkFlowResult> {
  const input = z.object({ applicationId: Id, reportId: Id, kind: Kind, seen: Hash.nullable(), ifCurrent: Id.nullable() }).safeParse({ applicationId, reportId, kind, seen, ifCurrent });
  if (!input.success) return { error: INVALID };
  return guarded(await getRepo(), (repo) => keepVersionFlow(repo, input.data));
}

export async function trackRole(reportId: string): Promise<LinkFlowResult> {
  const id = Id.safeParse(reportId);
  if (!id.success) return { error: INVALID };
  return guarded(await getRepo(), (repo) => trackRoleFlow(repo, id.data));
}

export async function stopTracking(applicationId: string): Promise<{ error?: string }> {
  const id = Id.safeParse(applicationId);
  if (!id.success) return { error: INVALID };
  return guarded(await getRepo(), async (repo) => {
    await repo.removeApplication(id.data);
    return {};
  });
}

export async function dismissAction(key: string, reason: string): Promise<{ error?: string }> {
  const k = ActionKey.safeParse(key);
  if (!k.success) return { error: INVALID };
  return guarded(await getRepo(), (repo) => dismissActionFlow(repo, k.data, z.string().max(20).catch("").parse(reason)));
}

export async function reopenAction(key: string): Promise<{ error?: string }> {
  const k = ActionKey.safeParse(key);
  if (!k.success) return { error: INVALID };
  return guarded(await getRepo(), (repo) => reopenActionFlow(repo, k.data));
}
