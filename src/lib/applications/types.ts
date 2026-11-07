import type { Application, ReportRow, ReportType } from "@/lib/types";

// OP-019: how a role connects to the documents made for it. Types only, safe in client components and the repositories.
// Nothing here holds document text: a version is named by its sha256, and a link belongs to the student who made it.

export type ArtefactKind = "cv" | "tailor" | "letter";

/** What can sit on an application. A LinkedIn profile isn't written for one role, so it has no slot. Interview practice has many answers to an application, so it names the application itself (OP-023, `practice_answers`). */
export const ARTEFACT_KIND_FOR: Partial<Record<ReportType, ArtefactKind>> = { cv_review: "cv", tailor: "tailor", cover_letter: "letter" };

export interface ApplicationLink {
  id: string;
  applicationId: string;
  reportId: string;
  kind: ArtefactKind;
  /** The exact version the student chose to keep for this application. Null: this application follows the report's latest version. */
  documentVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationLinkInput {
  applicationId: string;
  reportId: string;
  documentVersion: string | null;
  /**
   * The report the caller believes holds this slot now (null: empty). When given, the write happens only if that is
   * still true, and throws LinkConflictError otherwise, so a second tab can't silently replace what the first linked.
   * Omitted only for the first link made when a report is created, which never replaces anything.
   */
  ifCurrent?: string | null;
}

export type DownloadFormat = "docx" | "pdf" | "txt" | "original";

/** One document version a student has been sent, however many times. The server handed over the file; it can't know the file arrived. */
export interface ArtefactDownload {
  reportId: string;
  documentVersion: string;
  format: DownloadFormat;
  firstAt: string;
  lastAt: string;
}

export const DISMISS_REASONS = ["done", "not_relevant", "disagree", "later"] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];
export const DISMISS_REASON_LABEL: Record<DismissReason, string> = {
  done: "I've already done this",
  not_relevant: "It doesn't apply to me",
  disagree: "I don't think it's right",
  later: "Not now, remind me in a week",
};

/** One entry in a student's append-only history of dismissing and bringing back recommendations. Keys hold ids and hashes, never document text. */
export interface ActionChoice {
  id: string;
  actionKey: string;
  kind: "dismiss" | "reopen";
  reason: DismissReason | null;
  createdAt: string;
}

/** A report as the workspace reads it. `payload` is null when the saved record can't be read: it is still listed, never hidden. */
export interface WorkspaceReport {
  row: ReportRow;
  payload: unknown | null;
}

export type { Application };

/** The slot already holds something else (another tab, a second request). Nothing was saved. */
export class LinkConflictError extends Error {
  constructor() {
    super("application link changed since it was read");
  }
}

/** The application or report isn't the signed-in student's, or the report can't sit on an application. Nothing was saved. */
export class LinkRefusedError extends Error {
  constructor() {
    super("that can't be linked");
  }
}
