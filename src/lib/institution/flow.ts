import type { Repo } from "@/lib/repo/types";
import { isStaff } from "./permissions";
import { ContactSchema, DisagreementSchema, GroupSchema, ReferralSchema, ReferralUpdateSchema, ResourceSchema, SettingsSchema, UUID } from "./schema";
import type { ContactInput, GroupInput, ReferralStatus, ResourceInput, SettingsInput } from "./types";

// The action boundary: role, then validation, then the repository, which the database checks again. A hidden button is
// not an access control, so every action comes through here whatever the page showed. Errors are written for people and
// never carry a database message.

export type Result<T = object> = Partial<T> & { error?: string };

const ADMINS_ONLY = "Only careers admins can do this.";
const STAFF_ONLY = "Only careers staff can do this.";
const NOT_AVAILABLE = "You don't have access to that student or record.";
const FAILED = "That didn't save. Try again.";
const SAFE = /not at your university|already a careers admin|at least one careers admin/;

async function admin<T>(repo: Repo, fn: () => Promise<T>): Promise<T | { error: string }> {
  if ((await repo.profile()).role !== "admin") return { error: ADMINS_ONLY };
  return attempt(fn);
}
async function staff<T>(repo: Repo, fn: () => Promise<T>): Promise<T | { error: string }> {
  if (!isStaff((await repo.profile()).role)) return { error: STAFF_ONLY };
  return attempt(fn);
}
async function attempt<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (SAFE.test(m)) return { error: m };
    if (/group has resources/.test(m)) return { error: "Move or remove the resources in this group first." };
    if (/duplicate key|unique/.test(m)) return { error: "That name is already in use." };
    if (/isn't possible from here/.test(m)) return { error: "That step isn't possible from here." };
    if (/can't take this on/.test(m)) return { error: "That person can't see this student, so they can't take this on." };
    if (/unknown part of the report|report not found|contact not found|not found/.test(m)) return { error: NOT_AVAILABLE };
    if (/already withdrawn/.test(m)) return { error: "This has already been withdrawn." };
    return { error: FAILED };
  }
}

function done<T>(r: T | { error: string }): Result;
function done<T, O extends object>(r: T | { error: string }, map: (v: T) => O): Result<O>;
function done<T, O extends object>(r: T | { error: string }, map?: (v: T) => O): Result<O> {
  if (r !== null && typeof r === "object" && "error" in r) return { error: (r as { error: string }).error } as Result<O>;
  return (map ? { ...map(r as T) } : {}) as Result<O>;
}

/* ---------- configuration: careers admins ---------- */

export async function saveSettingsFlow(repo: Repo, input: SettingsInput): Promise<Result<object>> {
  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the fields. A brand colour must be a dark enough #RRGGBB to read on white (contrast 4.5:1 or more)." };
  return done(await admin(repo, () => repo.saveInstitutionSettings(parsed.data as SettingsInput)));
}

export async function stopSharingFlow(repo: Repo): Promise<Result<object>> {
  return done(await admin(repo, () => repo.stopReportSharing()));
}

export async function saveContactFlow(repo: Repo, input: ContactInput): Promise<Result<{ id: string }>> {
  const parsed = ContactSchema.safeParse(input);
  if (!parsed.success) return { error: "A contact needs a name and at least one way to reach it. Web addresses must start with https://." };
  const r = await admin(repo, () => repo.saveInstitutionContact(parsed.data as ContactInput));
  return done(r, (id) => ({ id }));
}

export async function deleteContactFlow(repo: Repo, id: string): Promise<Result<object>> {
  if (!UUID.safeParse(id).success) return { error: NOT_AVAILABLE };
  return done(await admin(repo, () => repo.deleteInstitutionContact(id)));
}

export async function saveResourceFlow(repo: Repo, input: ResourceInput): Promise<Result<{ id: string }>> {
  const parsed = ResourceSchema.safeParse(input);
  if (!parsed.success) return { error: "A resource needs a title and a web address starting with https://." };
  const r = await admin(repo, () => repo.saveInstitutionResource(parsed.data));
  return done(r, (id) => ({ id }));
}

export async function deleteResourceFlow(repo: Repo, id: string): Promise<Result<object>> {
  if (!UUID.safeParse(id).success) return { error: NOT_AVAILABLE };
  return done(await admin(repo, () => repo.deleteInstitutionResource(id)));
}

export async function saveGroupFlow(repo: Repo, input: GroupInput): Promise<Result<{ id: string }>> {
  const parsed = GroupSchema.safeParse(input);
  if (!parsed.success) return { error: "A group needs a name and at least one faculty or course, spelled as in your imported records." };
  const r = await admin(repo, () => repo.saveProgrammeGroup(parsed.data));
  return done(r, (id) => ({ id }));
}

export async function deleteGroupFlow(repo: Repo, id: string): Promise<Result<object>> {
  if (!UUID.safeParse(id).success) return { error: NOT_AVAILABLE };
  return done(await admin(repo, () => repo.deleteProgrammeGroup(id)));
}

export async function setAdviserFlow(repo: Repo, email: string, adviser: boolean): Promise<Result<{ status: string }>> {
  const r = await admin(repo, () => repo.setAdviser(email.trim().toLowerCase(), adviser));
  return done(r, (status) => ({ status }));
}

export async function setAdviserGroupsFlow(repo: Repo, adviserId: string, groupIds: string[]): Promise<Result<object>> {
  if (!UUID.safeParse(adviserId).success || !groupIds.every((g) => UUID.safeParse(g).success)) return { error: NOT_AVAILABLE };
  return done(await admin(repo, () => repo.setAdviserGroups(adviserId, groupIds)));
}

/* ---------- casework: careers staff, within what the database lets them see ---------- */

export async function addNoteFlow(repo: Repo, reportId: string, note: string): Promise<Result<object>> {
  const text = note.trim();
  if (text.length < 2 || text.length > 2000) return { error: "Write a note between 2 and 2,000 characters." };
  return done(await staff(repo, () => repo.adminAddNote(reportId, text)));
}

export async function recordDisagreementFlow(repo: Repo, input: { reportId: string; targetKind: string; targetKey: string; rationale: string }): Promise<Result<{ id: string }>> {
  const parsed = DisagreementSchema.safeParse(input);
  if (!parsed.success) return { error: "Say which part of the feedback you mean, and why, in at least 10 characters." };
  const r = await staff(repo, () => repo.adminRecordDisagreement(parsed.data));
  if (r === null) return { error: NOT_AVAILABLE };
  return done(r, (id) => ({ id }));
}

export async function withdrawDisagreementFlow(repo: Repo, id: string, reason: string): Promise<Result<{ id: string }>> {
  if (!UUID.safeParse(id).success) return { error: NOT_AVAILABLE };
  if (reason.trim().length < 10 || reason.length > 2000) return { error: "Say why, in at least 10 characters." };
  const r = await staff(repo, () => repo.adminWithdrawDisagreement(id, reason.trim()));
  if (r === null) return { error: NOT_AVAILABLE };
  return done(r, (rid) => ({ id: rid }));
}

export async function createReferralFlow(repo: Repo, input: { studentKey: string; reportId: string | null; contactId: string | null; target: string; reason: string; ownerId: string | null }): Promise<Result<{ id: string }>> {
  const parsed = ReferralSchema.safeParse(input);
  if (!parsed.success || (!parsed.data.contactId && parsed.data.target.length < 2)) return { error: "Say who you are referring to and why, in at least 10 characters." };
  const r = await staff(repo, () => repo.adminCreateReferral(parsed.data));
  if (r === null) return { error: NOT_AVAILABLE };
  return done(r, (id) => ({ id }));
}

export async function updateReferralFlow(repo: Repo, input: { id: string; status: ReferralStatus | null; ownerId: string | null; note: string | null }): Promise<Result<object>> {
  const parsed = ReferralUpdateSchema.safeParse(input);
  if (!parsed.success) return { error: "That step isn't possible from here." };
  const r = await staff(repo, () => repo.adminUpdateReferral(parsed.data));
  if (r === false) return { error: NOT_AVAILABLE };
  return done(r);
}

/* ---------- the student's own answer ---------- */

export async function respondToReferralFlow(repo: Repo, id: string, accept: boolean): Promise<Result<object>> {
  if (!UUID.safeParse(id).success) return { error: "That referral isn't waiting for an answer." };
  const r = await attempt(() => repo.respondToReferral(id, accept));
  if (r === false) return { error: "That referral isn't waiting for an answer." };
  return done(r);
}
