import type { AppStatus, Application, Opportunity, OpportunityInput, Profile, ReportRow, ReportType } from "@/lib/types";

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

export interface StoredReport<P = unknown> {
  row: ReportRow;
  payload: P;
}

export interface AdminOverview {
  universityName: string;
  sample: boolean;
  kpis: { activeStudents: number; newThisMonth: number; avgScore: number | null; avgFirstScore: number | null; avgImprovement: number | null; cvsReviewed: number; perStudent: number; appsTracked: number; needHand: number };
  weekly: (number | null)[];
  bands: { needs: number; getting: number; strong: number; ready: number } | null;
  faculties: { name: string; avg: number; improvement: number }[];
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
  getReport<P>(id: string): Promise<StoredReport<P> | null>;
  latestReport<P>(type: ReportType): Promise<StoredReport<P> | null>;
  createReport<P>(input: { type: ReportType; title: string; score: number | null; payload: P; file?: { bytes: Uint8Array; name: string; contentType: string } }): Promise<string>;
  updateReport<P>(id: string, patch: { title?: string; score?: number | null; payload?: P }): Promise<void>;

  opportunities(): Promise<Opportunity[]>;
  applications(): Promise<Application[]>;
  track(opportunityId: string): Promise<void>;
  untrack(opportunityId: string): Promise<void>;
  setApplicationStatus(applicationId: string, status: AppStatus): Promise<void>;

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
