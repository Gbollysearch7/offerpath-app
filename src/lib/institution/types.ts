// Institution configuration and adviser casework (OP-021): the shapes both repositories return.
// Nothing in this folder is imported by a scorer, and a test keeps it that way (tests/institution-config.test.ts).

export type AdviserScope = "assigned" | "all";

export interface InstitutionContact {
  id: string;
  label: string;
  purpose: string;
  email: string | null;
  phone: string | null;
  url: string | null;
  hours: string | null;
}

export interface InstitutionResource {
  id: string;
  title: string;
  url: string;
  description: string;
  groupId: string | null;
  active: boolean;
}

export interface ProgrammeGroup {
  id: string;
  name: string;
  faculties: string[];
  courses: string[];
}

/** What a careers admin configures. There is no field here a scorer could read, and the input schemas refuse extras. */
export interface InstitutionConfig {
  universityName: string;
  brandName: string | null;
  brandColour: string | null;
  welcome: string | null;
  adviserScope: AdviserScope;
  /** `universities.report_sharing_enabled`: an admin can stop it; only the operator can start it. */
  reportSharing: boolean;
  contacts: InstitutionContact[];
  resources: InstitutionResource[];
  groups: ProgrammeGroup[];
}

/** What a student at the university sees: their resources only, and no policy, group or team detail. */
export interface InstitutionView {
  universityId: string;
  universityName: string;
  brandName: string | null;
  brandColour: string | null;
  welcome: string | null;
  updatedAt: string | null;
  contacts: InstitutionContact[];
  resources: Pick<InstitutionResource, "id" | "title" | "url" | "description">[];
}

export interface AdviserTeam {
  advisers: { id: string; email: string; name: string; groupIds: string[] }[];
  pending: { email: string; invitedAt: string }[];
}

export interface SettingsInput {
  brandName: string | null;
  brandColour: string | null;
  welcome: string | null;
  adviserScope: AdviserScope;
}
export type ContactInput = Omit<InstitutionContact, "id"> & { id?: string | null };
export type ResourceInput = Omit<InstitutionResource, "id"> & { id?: string | null };
export type GroupInput = Omit<ProgrammeGroup, "id"> & { id?: string | null };

/* ---------- casework ---------- */

export type DisagreementTarget = "score" | "area" | "check";
export const REFERRAL_STATUSES = ["proposed", "accepted", "in_progress", "closed", "declined", "withdrawn"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export interface Disagreement {
  id: string;
  reportId: string;
  author: string;
  authorRole: string;
  kind: "disagreement" | "withdrawal";
  withdrawsId: string | null;
  targetKind: DisagreementTarget;
  targetKey: string;
  /** What the automated judgment said when this was written. Read from the report by the database, not supplied. */
  judgment: { score?: number | null; name?: string; reportScore?: number | null; reportDate?: string };
  rationale: string;
  createdAt: string;
}

export interface ReferralEvent {
  actor: string;
  actorKind: "student" | "staff";
  from: ReferralStatus | null;
  to: ReferralStatus;
  fromOwner: string | null;
  toOwner: string | null;
  note: string | null;
  at: string;
}

export interface Referral {
  id: string;
  reportId: string | null;
  target: string;
  reason: string;
  status: ReferralStatus;
  ownerId?: string | null;
  owner: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  events: ReferralEvent[];
}

export interface CaseworkQueueItem {
  id: string;
  studentKey: string;
  studentNumber: string;
  target: string;
  reason: string;
  status: ReferralStatus;
  owner: string | null;
  ownerGone: boolean;
  mine: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CaseworkQueue {
  /** Open referrals whose student has stopped sharing. A count only: revoked consent means no names. */
  hidden: number;
  referrals: CaseworkQueueItem[];
}

export interface AccessLogEntry {
  at: string;
  actor: string;
  actorRole: string;
  action: AccessAction;
  outcome: "granted" | "denied";
  student: string | null;
  studentGone: boolean;
  detail: Record<string, unknown>;
}

export type AccessAction = "view_student" | "open_cv" | "add_note" | "record_disagreement" | "withdraw_disagreement" | "create_referral" | "update_referral" | "export_students" | "export_outcomes" | "export_access_log" | "change_configuration" | "change_role";

export type ExportKind = "export_students" | "export_outcomes" | "export_access_log";

export interface MyCasework {
  seenAt: string | null;
  disagreements: Disagreement[];
  referrals: Referral[];
  access: { at: string; actor: string; actorRole: string; action: AccessAction }[];
}

export interface StaffOption {
  id: string;
  name: string;
  role: string;
}

export interface DisagreementInput {
  reportId: string;
  targetKind: DisagreementTarget;
  targetKey: string;
  rationale: string;
}
export interface ReferralInput {
  studentKey: string;
  reportId: string | null;
  contactId: string | null;
  target: string;
  reason: string;
  ownerId: string | null;
}
export interface ReferralUpdate {
  id: string;
  status: ReferralStatus | null;
  ownerId: string | null;
  note: string | null;
}

/** Added to `Repo`. Every method runs under the signed-in user's own session and is enforced again by the database. */
export interface InstitutionRepo {
  institutionConfig(): Promise<InstitutionConfig>;
  saveInstitutionSettings(input: SettingsInput): Promise<void>;
  stopReportSharing(): Promise<void>;
  saveInstitutionContact(input: ContactInput): Promise<string>;
  deleteInstitutionContact(id: string): Promise<void>;
  saveInstitutionResource(input: ResourceInput): Promise<string>;
  deleteInstitutionResource(id: string): Promise<void>;
  saveProgrammeGroup(input: GroupInput): Promise<string>;
  deleteProgrammeGroup(id: string): Promise<void>;
  adviserTeam(): Promise<AdviserTeam>;
  /** Returns "granted" | "invited" | "removed". */
  setAdviser(email: string, adviser: boolean): Promise<string>;
  setAdviserGroups(adviserId: string, groupIds: string[]): Promise<void>;
  /** Null when there is nothing to show, including before the migration is applied. */
  myInstitution(): Promise<InstitutionView | null>;

  /** Null if this person can't act on that report or student. The refusal is logged by the database. */
  adminRecordDisagreement(input: DisagreementInput): Promise<string | null>;
  adminWithdrawDisagreement(id: string, reason: string): Promise<string | null>;
  adminCreateReferral(input: ReferralInput): Promise<string | null>;
  adminUpdateReferral(input: ReferralUpdate): Promise<boolean>;
  adminCasework(): Promise<CaseworkQueue>;
  adminAccessLog(page?: { limit?: number; offset?: number }): Promise<AccessLogEntry[]>;
  /** Written before an export is built; if it throws, there is no file. */
  adminRecordExport(kind: ExportKind, rows: number, detail?: Record<string, unknown>): Promise<void>;

  /** Empty before the migration is applied. */
  myCasework(): Promise<MyCasework>;
  myCaseworkUnseen(): Promise<number>;
  markCaseworkSeen(): Promise<void>;
  /** False if it isn't theirs or isn't waiting for them. */
  respondToReferral(id: string, accept: boolean): Promise<boolean>;
}
