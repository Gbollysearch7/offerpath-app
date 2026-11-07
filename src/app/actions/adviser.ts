"use server";

import { revalidatePath } from "next/cache";
import {
  createReferralFlow,
  deleteContactFlow,
  deleteGroupFlow,
  deleteResourceFlow,
  recordDisagreementFlow,
  respondToReferralFlow,
  saveContactFlow,
  saveGroupFlow,
  saveResourceFlow,
  saveSettingsFlow,
  setAdviserFlow,
  setAdviserGroupsFlow,
  stopSharingFlow,
  updateReferralFlow,
  withdrawDisagreementFlow,
} from "@/lib/institution/flow";
import type { ContactInput, GroupInput, ReferralStatus, ResourceInput, SettingsInput } from "@/lib/institution/types";
import { hit, TOO_MANY } from "@/lib/rate-limit";
import { getRepo } from "@/lib/session";

// Each action is a session check, a rate limit and a flow. The flow checks the role, the database checks everything again.
const EXPIRED = { error: "Your session has expired. Sign in again." };

export async function saveInstitutionSettings(input: SettingsInput) {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  if (!(await hit("adviserWritePerUser", repo.userId))) return { error: TOO_MANY };
  const r = await saveSettingsFlow(repo, input);
  if (!r.error) revalidatePath("/admin/institution");
  return r;
}

export async function stopReportSharing() {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  const r = await stopSharingFlow(repo);
  if (!r.error) revalidatePath("/admin/institution");
  return r;
}

export async function saveInstitutionContact(input: ContactInput) {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  if (!(await hit("adviserWritePerUser", repo.userId))) return { error: TOO_MANY };
  const r = await saveContactFlow(repo, input);
  if (!r.error) revalidatePath("/admin/institution");
  return r;
}

export async function deleteInstitutionContact(id: string) {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  const r = await deleteContactFlow(repo, id);
  if (!r.error) revalidatePath("/admin/institution");
  return r;
}

export async function saveInstitutionResource(input: ResourceInput) {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  if (!(await hit("adviserWritePerUser", repo.userId))) return { error: TOO_MANY };
  const r = await saveResourceFlow(repo, input);
  if (!r.error) revalidatePath("/admin/institution");
  return r;
}

export async function deleteInstitutionResource(id: string) {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  const r = await deleteResourceFlow(repo, id);
  if (!r.error) revalidatePath("/admin/institution");
  return r;
}

export async function saveProgrammeGroup(input: GroupInput) {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  if (!(await hit("adviserWritePerUser", repo.userId))) return { error: TOO_MANY };
  const r = await saveGroupFlow(repo, input);
  if (!r.error) revalidatePath("/admin/institution");
  return r;
}

export async function deleteProgrammeGroup(id: string) {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  const r = await deleteGroupFlow(repo, id);
  if (!r.error) revalidatePath("/admin/institution");
  return r;
}

export async function setAdviser(email: string, adviser: boolean): Promise<{ status?: string; error?: string }> {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  const r = await setAdviserFlow(repo, email, adviser);
  if (!r.error) revalidatePath("/admin/team");
  return r;
}

export async function setAdviserGroups(adviserId: string, groupIds: string[]) {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  const r = await setAdviserGroupsFlow(repo, adviserId, groupIds);
  if (!r.error) revalidatePath("/admin/team");
  return r;
}

export async function recordDisagreement(studentKey: string, input: { reportId: string; targetKind: string; targetKey: string; rationale: string }) {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  if (!(await hit("adviserWritePerUser", repo.userId))) return { error: TOO_MANY };
  const r = await recordDisagreementFlow(repo, input);
  if (!r.error) revalidatePath(`/admin/students/${studentKey}`);
  return r;
}

export async function withdrawDisagreement(studentKey: string, id: string, reason: string) {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  if (!(await hit("adviserWritePerUser", repo.userId))) return { error: TOO_MANY };
  const r = await withdrawDisagreementFlow(repo, id, reason);
  if (!r.error) revalidatePath(`/admin/students/${studentKey}`);
  return r;
}

export async function createReferral(input: { studentKey: string; reportId: string | null; contactId: string | null; target: string; reason: string; ownerId: string | null }) {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  if (!(await hit("adviserWritePerUser", repo.userId))) return { error: TOO_MANY };
  const r = await createReferralFlow(repo, input);
  if (!r.error) revalidatePath(`/admin/students/${input.studentKey}`);
  return r;
}

export async function updateReferral(studentKey: string, input: { id: string; status: ReferralStatus | null; ownerId: string | null; note: string | null }) {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  if (!(await hit("adviserWritePerUser", repo.userId))) return { error: TOO_MANY };
  const r = await updateReferralFlow(repo, input);
  if (!r.error) {
    revalidatePath(`/admin/students/${studentKey}`);
    revalidatePath("/admin/casework");
  }
  return r;
}

export async function answerReferral(id: string, accept: boolean) {
  const repo = await getRepo();
  if (!repo) return EXPIRED;
  if (!(await hit("adviserWritePerUser", repo.userId))) return { error: TOO_MANY };
  const r = await respondToReferralFlow(repo, id, accept);
  if (!r.error) revalidatePath("/careers-service");
  return r;
}
