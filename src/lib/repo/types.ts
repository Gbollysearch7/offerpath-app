import type { AppStatus, Application, CvSource, DocumentMeta, Opportunity, OpportunityInput, Profile, ReportRow, ReportType, SourceKind, SourceOutcome } from "@/lib/types";

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

export type AiKind = "line_rewrite" | "letter" | "cv_score" | "tailor";
/** Daily per-student limits on AI calls. Each call reserves its slot first (atomic count), then runs. */
export const AI_LIMITS: Record<AiKind, number> = { line_rewrite: 25, letter: 10, cv_score: 20, tailor: 10 };

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

/** An attempt key was reused for different content. Nothing was saved. */
export class SourceConflictError extends Error {
  constructor() {
    super("idempotency key already used for a different version");
  }
}

/** The saved version answers this attempt only if it is the same content from the same parent. */
export const sameAttempt = (saved: { documentVersion: string; parentId: string | null; kind: string }, input: { documentVersion: string; parentId: string | null; kind: string }) =>
  saved.documentVersion === input.documentVersion && saved.parentId === input.parentId && saved.kind === input.kind;

export interface AdminOverview {
  universityName: string;
  sample: boolean;
  kpis: { activeStudents: number; newThisMonth: number; avgScore: number | null; avgFirstScore: number | null; avgImprovement: number | null; cvsReviewed: number; perStudent: number; appsTracked: number; needHand: number };
  weekly: (number | null)[];
  bands: { needs: number; getting: number; strong: number; ready: number } | null;
  faculties: { name: string; avg: number; improvement: number | null }[];
  homeIntl: { metric: string; home: number; intl: number }[];
  needs: { count: number; why: string; hint: string }[];
}

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

export type OutcomeRow =
  | { dimension: string; group: string; suppressed: true }
  | { dimension: string; group: string; suppressed?: false; students: number; uploadedCv: number; reuploaded: number; improved10: number; strongOrBetter: number; trackedApplications: number; reachedInterview: number; receivedOffer: number; avgScore: number | null; avgImprovement: number | null };

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
  reports: { id: string; title: string; score: number | null; createdAt: string; areas: { key: string; name: string; score: number }[] | null; hasFile: boolean }[];
  notes: AdviserNote[];
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
export interface Repo {
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
  updateReport<P>(id: string, patch: { title?: string; score?: number | null; payload?: P }): Promise<void>;

  opportunities(): Promise<Opportunity[]>;
  applications(): Promise<Application[]>;
  track(opportunityId: string): Promise<void>;
  untrack(opportunityId: string): Promise<void>;
  setApplicationStatus(applicationId: string, status: AppStatus): Promise<void>;

  /** Saves a document version (immutable once written) and the file it came from, if any. See SourceInput for idempotency. */
  createSource(input: SourceInput): Promise<CvSource>;
  /** The signed-in user's version, or null if it isn't theirs. */
  getSource(id: string): Promise<CvSource | null>;
  /** Every version the signed-in user has, newest first. */
  listSources(): Promise<CvSource[]>;
  /** The uploaded file behind one of the user's versions; null if it isn't theirs or has no file. */
  sourceFile(id: string): Promise<{ name: string; bytes: Uint8Array; contentType: string } | null>;

  aiUsedToday(kind: AiKind): Promise<number>;
  /** Atomically adds one use for today and returns the new count. */
  bumpAi(kind: AiKind): Promise<number>;

  counts(): Promise<{ cvs: number; reports: number; letters: number; applications: number }>;
  exportFiles(): Promise<{ name: string; bytes: Uint8Array }[]>;
  deleteAccount(): Promise<void>;

  adminOverview(period?: { from: string | null; to: string | null }): Promise<AdminOverview>;
  adminStudents(query?: StudentQuery): Promise<StudentPage>;
  adminOutcomesPack(period?: { from: string | null; to: string | null }): Promise<OutcomeRow[]>;
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
