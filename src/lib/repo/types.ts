import type { AnalysisJob, ChargeResult, ClaimResult, JobFinish, Workflow } from "@/lib/analysis/job-state";
import type { ActionChoice, ApplicationLink, ApplicationLinkInput, ArtefactDownload, ArtefactKind, DismissReason, DownloadFormat, WorkspaceReport } from "@/lib/applications/types";
import type { ProofreadingChoice, ProofreadingChoiceInput } from "@/lib/analysis/proofreading/choices";
import type { PublishedAnalytics } from "@/lib/analytics/types";
import type { Disagreement, InstitutionRepo, Referral, StaffOption } from "@/lib/institution/types";
import type { PracticeAnswer, PracticeAnswerInput } from "@/lib/practice-types";
import type { ShareLinkInput, ShareLinkRecord } from "@/lib/sharing/types";
import type { AppStatus, Application, CvSource, DocumentMeta, Opportunity, OpportunityInput, ProofreadingLanguage, Profile, ReportRow, ReportType, SourceKind, SourceOutcome } from "@/lib/types";

export type { ProofreadingChoice, ProofreadingChoiceInput } from "@/lib/analysis/proofreading/choices";

export interface StudentRecordInput {
  email: string;
  student_number?: string;
  course?: string;
  year_of_study?: string;
  faculty?: string;
  fee_status?: string;
}

export interface ImportResult {
  saved: number;
  appliedToAccounts: number;
  skipped: { row: number; reason: string }[];
}

export interface AdminTeam {
  admins: { email: string; name: string; you: boolean }[];
  pending: { email: string; invitedAt: string }[];
}

export type AiKind = "line_rewrite" | "letter" | "cv_score" | "tailor" | "linkedin" | "practice";
/** Daily per-student limits on AI calls. Each call reserves its slot first (atomic count), then runs. */
export const AI_LIMITS: Record<AiKind, number> = { line_rewrite: 25, letter: 10, cv_score: 20, tailor: 10, linkedin: 10, practice: 20 };
/**
 * OP-025: a failed attempt gives its use back, so the limit above counts what students received. Failures that reached
 * the provider still cost money, so they have their own daily limit; past it the provider isn't called for that student.
 */
export const AI_FAILED_LIMITS: Record<AiKind, number> = { line_rewrite: 25, letter: 10, cv_score: 20, tailor: 10, linkedin: 10, practice: 20 };

/**
 * A report as the app reads it. `payload` is always in the current shape (`PAYLOAD_VERSION` in
 * `src/lib/types.ts`): `src/lib/report-schema.ts` validates every payload before a repository writes it
 * and adapts older saved payloads when a repository reads them. Both repositories use the same two
 * functions, so a payload that one accepts the other accepts, and a historical record reads the same way
 * in both.
 */
export interface StoredReport<P = unknown> {
  row: ReportRow;
  payload: P;
}

/**
 * A new version of a CV's text (OP-006). `idempotencyKey` is the client's key for one attempt: the same key from
 * the same user returns the version already saved instead of a second one, however many times the request lands.
 * The same key with different text or a different parent is refused with SourceConflictError rather than
 * returning a version whose text the student did not send. A correction or paste whose text equals an existing
 * child of the same parent also returns that child.
 */
export interface SourceInput {
  kind: SourceKind;
  /** The version this one was made from. Must be the same user's; null for an upload or a paste with no file. */
  parentId: string | null;
  fileName: string;
  text: string;
  /** Validated with `checkDocument` before anything is written. Null only for a retained file that could not be read. */
  document: DocumentMeta | null;
  outcome: SourceOutcome | null;
  file?: { bytes: Uint8Array; name: string; contentType: string };
  idempotencyKey: string | null;
}

/** The report changed after it was read (another tab, a second request). Nothing was saved. */
export class ReportConflictError extends Error {
  constructor() {
    super("report changed since it was read");
  }
}

/** An attempt key was reused for different content. Nothing was saved. */
export class SourceConflictError extends Error {
  constructor() {
    super("idempotency key already used for a different version");
  }
}

/** The saved version answers this attempt only if it is the same content from the same parent. */
export const sameAttempt = (saved: { documentVersion: string; parentId: string | null; kind: string }, input: { documentVersion: string; parentId: string | null; kind: string }) =>
  saved.documentVersion === input.documentVersion && saved.parentId === input.parentId && saved.kind === input.kind;

export interface StudentQuery {
  filter?: "all" | "needs" | "home" | "international";
  search?: string;
  faculty?: string;
  limit?: number;
  offset?: number;
}

export interface StudentPage {
  total: number;
  counts: { all: number; needs: number; home: number; international: number };
  faculties: string[];
  rows: AdminStudent[];
}

export interface AdviserNote {
  id: string;
  reportId: string;
  author: string;
  note: string;
  createdAt: string;
}

export interface StudentDetail {
  key: string;
  studentNumber: string;
  name: string;
  course: string | null;
  year: string | null;
  faculty: string | null;
  feeStatus: string | null;
  stage: string | null;
  sectors: string[];
  cvSharing: boolean;
  lastActive: string;
  reports: { id: string; title: string; score: number | null; createdAt: string; areas: { key: string; name: string; score: number; checks?: { key: string; name: string; score: number }[] | null }[] | null; hasFile: boolean }[];
  notes: AdviserNote[];
  /** Absent before the OP-021 migration is applied. */
  disagreements?: Disagreement[];
  referrals?: Referral[];
  staff?: StaffOption[];
}

export interface AdminStudent {
  key?: string;
  id: string;
  course: string;
  year: string;
  status: string;
  faculty: string;
  score: number | null;
  change: number | null;
  lastActive: string;
  flag: string;
}

/** Everything the app reads and writes, scoped to the signed-in user. */
export interface Repo extends InstitutionRepo {
  mode: "demo" | "supabase";
  userId: string;
  profile(): Promise<Profile>;
  updateProfile(patch: Partial<Omit<Profile, "id" | "email" | "role">>): Promise<void>;

  listReports(opts: { type?: ReportType; q?: string; offset?: number; limit?: number }): Promise<{ rows: ReportRow[]; total: number }>;
  /** The signed-in user's report, adapted to the current payload shape; null if it isn't theirs. Throws PayloadError if the saved record can't be read. */
  getReport<P>(id: string): Promise<StoredReport<P> | null>;
  latestReport<P>(type: ReportType): Promise<StoredReport<P> | null>;
  /**
   * Validates the payload for `type` first and throws PayloadError instead of saving an invalid one. `source` names
   * the CV version a review scored: it must be the user's, and a version is scored at most once, so a second call
   * for the same source returns the report that already exists instead of making another.
   */
  createReport<P>(input: { type: ReportType; title: string; score: number | null; payload: P; source?: { id: string; storagePath: string | null } }): Promise<string>;
  /** Same validation as createReport, against the stored report's own type. Throws if the report isn't the user's. */
  /**
   * With `ifRevision`, the write happens only if the saved payload's `editRevision` is still that value (null: not set yet),
   * as one atomic step, and throws ReportConflictError otherwise. Without it the write is unconditional.
   */
  updateReport<P>(id: string, patch: { title?: string; score?: number | null; payload?: P }, options?: { ifRevision: number | null }): Promise<void>;

  opportunities(): Promise<Opportunity[]>;
  applications(): Promise<Application[]>;
  track(opportunityId: string): Promise<void>;
  untrack(opportunityId: string): Promise<void>;
  setApplicationStatus(applicationId: string, status: AppStatus): Promise<void>;

  /** OP-019. The newest `limit` reports and those named by `ids`, the user's own only. A record that can't be read comes back with a null payload rather than throwing. */
  workspaceReports(opts: { limit?: number; ids?: string[] }): Promise<WorkspaceReport[]>;
  applicationLinks(): Promise<ApplicationLink[]>;
  /** Puts a report on one of the user's applications. Throws LinkRefusedError for anything not theirs or not linkable, and LinkConflictError if `ifCurrent` no longer holds. */
  setApplicationLink(input: ApplicationLinkInput): Promise<ApplicationLink>;
  /** Takes a report off an application. Already gone is fine; holding a different report throws LinkConflictError. The report itself is untouched. */
  removeApplicationLink(input: { applicationId: string; kind: ArtefactKind; ifCurrent: string }): Promise<void>;
  /** An application for a role that came from a report rather than a listing. The same report again returns the same application. */
  trackRole(input: { reportId: string; role: string; org: string; closesOn: string | null }): Promise<Application>;
  /** Stops tracking by application id, which also covers roles with no listing. Links go with it; reports stay. */
  removeApplication(applicationId: string): Promise<void>;
  /** Notes that a version was sent. A repeat of the same version moves `lastAt` and adds nothing. */
  recordDownload(input: { reportId: string; documentVersion: string; format: DownloadFormat }): Promise<void>;
  artefactDownloads(): Promise<ArtefactDownload[]>;
  /** The user's dismissals and reopenings, oldest first. */
  actionChoices(): Promise<ActionChoice[]>;
  recordActionChoice(input: { actionKey: string; kind: "dismiss" | "reopen"; reason: DismissReason | null }): Promise<ActionChoice>;

  /** OP-023. The signed-in student's saved interview practice, newest first. There is no way to ask for anyone else's: no staff method reads these. */
  practiceAnswers(opts?: { attemptKey?: string; applicationId?: string }): Promise<PracticeAnswer[]>;
  /** Refuses a bad shape, or an application or report that isn't the student's, with PracticeRefusedError. The same attempt key returns the answer already saved. */
  savePracticeAnswer(input: PracticeAnswerInput): Promise<PracticeAnswer>;
  /** True if it was the student's. Someone else's behaves as one that doesn't exist. */
  deletePracticeAnswer(id: string): Promise<boolean>;

  /** Saves a document version (immutable once written) and the file it came from, if any. See SourceInput for idempotency. */
  createSource(input: SourceInput): Promise<CvSource>;
  /** The signed-in user's version, or null if it isn't theirs. */
  getSource(id: string): Promise<CvSource | null>;
  /** Every version the signed-in user has, newest first. */
  listSources(): Promise<CvSource[]>;
  /** The uploaded file behind one of the user's versions; null if it isn't theirs or has no file. */
  sourceFile(id: string): Promise<{ name: string; bytes: Uint8Array; contentType: string } | null>;

  /** The signed-in user's proofreading choices, oldest first: for one document, or all of them. Never anyone else's. */
  proofreadingChoices(documentVersion?: string): Promise<ProofreadingChoice[]>;
  /**
   * Appends a choice to the user's history. The report is read with the user's own session and everything saved is
   * taken from it, so a report that isn't theirs, or a finding it doesn't hold, throws ChoiceNotFoundError and saves nothing.
   */
  recordProofreadingChoice(input: ProofreadingChoiceInput): Promise<ProofreadingChoice>;
  /** The English the user last chose, or null if they never have. */
  proofreadingLanguagePreference(): Promise<ProofreadingLanguage | null>;

  aiUsedToday(kind: AiKind): Promise<number>;
  /** Atomically adds one use for today and returns the new count. */
  bumpAi(kind: AiKind): Promise<number>;

  /**
   * OP-025. The one way a job starts: a repeat of finished work replays it, a repeat of running work waits, and a
   * concurrency limit leaves it unstarted. `freshSeconds`: how long finished work answers a repeat; null is for ever.
   */
  claimJob(input: { workflow: Workflow; key: string; freshSeconds: number | null }): Promise<ClaimResult>;
  /** Takes one use for a running job, at most once, never past `limit`. It stays held until the job fails. */
  chargeJob(job: { id: string; attempt: number }, kind: AiKind, limit: number, failedLimit: number): Promise<ChargeResult>;
  /** Ends an attempt and gives back its use if asked, in one step. False if this attempt no longer holds the job. */
  finishJob(job: { id: string; attempt: number }, finish: JobFinish): Promise<boolean>;
  getJob(id: string): Promise<AnalysisJob | null>;

  /** OP-020. The institution setting for this student's university. False when it can't be read: sharing fails closed. */
  sharingEnabled(): Promise<boolean>;
  /** Refuses a report that isn't the student's own CV review, or if the student's university has sharing off. */
  createShareLink(input: ShareLinkInput): Promise<string>;
  /** The signed-in student's links and their access logs, newest first. Never a token or its hash. */
  shareLinks(): Promise<ShareLinkRecord[]>;
  /** True if the link is the student's. A link that belongs to someone else behaves as one that doesn't exist. */
  revokeShareLink(id: string): Promise<boolean>;

  counts(): Promise<{ cvs: number; reports: number; letters: number; linkedin: number; applications: number }>;
  exportFiles(): Promise<{ name: string; bytes: Uint8Array }[]>;
  deleteAccount(): Promise<void>;

  /** The published figures for one named reporting period: rounded and hidden by the rules in src/lib/analytics/rules.ts. */
  adminAnalytics(periodKey: string): Promise<PublishedAnalytics>;
  adminStudents(query?: StudentQuery): Promise<StudentPage>;
  adminUniversity(): Promise<{ name: string; domain: string }>;
  importStudentRecords(rows: StudentRecordInput[]): Promise<ImportResult>;
  adminTeam(): Promise<AdminTeam>;
  /** Grants or removes careers-admin access; returns "granted" | "invited" | "removed". */
  setAdminRole(email: string, admin: boolean): Promise<string>;
  /** Shared opportunities plus the admin's university's own (marked own: true). */
  adminOpportunities(): Promise<Opportunity[]>;
  saveOpportunity(o: OpportunityInput): Promise<string>;
  adminStudentDetail(key: string): Promise<StudentDetail | null>;
  adminAddNote(reportId: string, note: string): Promise<void>;
  /** A short-lived download link, only if the student opted in to adviser CV access. */
  adminCvLink(reportId: string): Promise<string | null>;
  /** Notes advisers left on the signed-in student's reports. */
  myAdviserNotes(): Promise<AdviserNote[]>;
  deleteOpportunity(id: string): Promise<void>;
}
