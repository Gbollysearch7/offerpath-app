import "server-only";
import { dismissedIds } from "@/lib/analysis/proofreading/choices";
import { log } from "@/lib/log";
import type { Repo } from "@/lib/repo/types";
import type { CoverLetterPayload, TailorPayload } from "@/lib/types";
import { nextActions, type DismissedAction, type NextAction } from "./next-actions";
import { ARTEFACT_KIND_FOR, DISMISS_REASONS, LinkConflictError, LinkRefusedError, type ArtefactDownload, type ArtefactKind, type DismissReason, type DownloadFormat } from "./types";
import { buildWorkspace, sameRole, type Workspace } from "./workspace";

// OP-019: the logic behind the dashboard's actions, on top of the repository, so the tests call exactly what the actions call.
// Every result either did what was asked or says what didn't happen. A conflict changes nothing and tells the student to reload.

export type LinkFlowResult = { error?: string; applicationId?: string };

/** How many reports the dashboard reads in full. A student with more still sees them all in the reports table. */
export const WORKSPACE_WINDOW = 40;

export const CONFLICT = "This application changed in another tab, so nothing was replaced. Reload the page to see what it holds now.";
const NOT_FOUND = "We couldn't find that. Reload the page and try again.";
const ACTION_GONE = "That recommendation has gone, because what it was about has changed. Reload the page.";
const SAVE_FAILED = "That wasn't saved. Try again.";

export interface LoadedWorkspace {
  workspace: Workspace;
  actions: NextAction[];
  dismissed: DismissedAction[];
  candidates: NextAction[];
  downloads: ArtefactDownload[];
}

/** Reads what the workspace needs: the newest reports, what links name, and what those name in turn. `extraIds` adds reports a table page shows. */
export async function loadWorkspace(repo: Repo, opts: { today: string; extraIds?: string[] }): Promise<LoadedWorkspace> {
  const [applications, links, downloads, sources, choices, counts] = await Promise.all([repo.applications(), repo.applicationLinks(), repo.artefactDownloads(), repo.listSources(), repo.actionChoices(), repo.counts()]);
  const first = await repo.workspaceReports({ limit: WORKSPACE_WINDOW, ids: [...links.map((l) => l.reportId), ...(opts.extraIds ?? [])] });
  const have = new Set(first.map((r) => r.row.id));
  const named = first.flatMap((r) => {
    const p = r.payload as Partial<Pick<TailorPayload, "cvReportId"> & Pick<CoverLetterPayload, "tailorReportId">> | null;
    return [p?.cvReportId, p?.tailorReportId].filter((x): x is string => !!x && !have.has(x));
  });
  const second = named.length ? await repo.workspaceReports({ ids: named }) : [];
  // A tailored CV named by a letter names a CV of its own.
  const haveNow = new Set([...have, ...second.map((r) => r.row.id)]);
  const third = second.flatMap((r) => {
    const id = (r.payload as Partial<TailorPayload> | null)?.cvReportId;
    return id && !haveNow.has(id) ? [id] : [];
  });
  const reports = [...first, ...second, ...(third.length ? await repo.workspaceReports({ ids: third }) : [])];
  const workspace = buildWorkspace({
    applications,
    links,
    reports,
    downloads,
    sources: sources.map((s) => ({ id: s.id, parentId: s.parentId, kind: s.kind, fileName: s.fileName, documentVersion: s.documentVersion, reportId: s.reportId, createdAt: s.createdAt, readable: !!s.document })),
    truncated: counts.reports > reports.length,
  });
  const version = workspace.latestCv?.assessedVersion ?? undefined;
  const dismissedFindings = version ? dismissedIds(await repo.proofreadingChoices(version), version) : new Set<string>();
  const { actions, dismissed, candidates } = nextActions(workspace, { today: opts.today, choices, dismissedFindings });
  return { workspace, actions, dismissed, candidates, downloads };
}

/** Conflicts and refusals become what the student reads. Anything else is a real failure and carries on to the error page's logging. */
function explain(e: unknown): LinkFlowResult {
  if (e instanceof LinkConflictError) return { error: CONFLICT };
  if (e instanceof LinkRefusedError) return { error: NOT_FOUND };
  throw e;
}

export async function linkFlow(repo: Repo, input: { applicationId: string; reportId: string; ifCurrent: string | null }): Promise<LinkFlowResult> {
  try {
    await repo.setApplicationLink({ ...input, documentVersion: null });
    return { applicationId: input.applicationId };
  } catch (e) {
    return explain(e);
  }
}

export async function unlinkFlow(repo: Repo, input: { applicationId: string; kind: ArtefactKind; ifCurrent: string }): Promise<LinkFlowResult> {
  try {
    await repo.removeApplicationLink(input);
    return { applicationId: input.applicationId };
  } catch (e) {
    return explain(e);
  }
}

/**
 * Keeps the exact version showing for this application, or goes back to following the latest. `seen` is the version the
 * student was looking at: the server keeps that one, or refuses, so a newer version made in another tab is never kept by accident.
 */
export async function keepVersionFlow(repo: Repo, input: { applicationId: string; reportId: string; kind: ArtefactKind; seen: string | null; ifCurrent: string | null }): Promise<LinkFlowResult> {
  const { workspace } = await loadWorkspace(repo, { today: new Date().toISOString().slice(0, 10), extraIds: [input.reportId] });
  const artefact = workspace.all.find((a) => a.reportId === input.reportId);
  if (!artefact || ARTEFACT_KIND_FOR[artefact.type] !== input.kind) return { error: NOT_FOUND };
  if (input.seen !== null && artefact.latest !== input.seen) return { error: CONFLICT };
  try {
    await repo.setApplicationLink({ applicationId: input.applicationId, reportId: input.reportId, documentVersion: input.seen, ifCurrent: input.ifCurrent });
    return { applicationId: input.applicationId };
  } catch (e) {
    return explain(e);
  }
}

/** Tracks the role a tailored CV or letter was made for, then puts that document on it. Repeating this finds the same application. */
export async function trackRoleFlow(repo: Repo, reportId: string): Promise<LinkFlowResult> {
  const report = await repo.getReport<TailorPayload | CoverLetterPayload>(reportId);
  if (!report || (report.row.type !== "tailor" && report.row.type !== "cover_letter")) return { error: NOT_FOUND };
  const p = report.payload;
  const role = (p.jobTitle ?? "").trim();
  const org = (p.employer ?? "").trim();
  if (!role || !org) return { error: "This document doesn't name a role to track." };
  const deadline = "deadline" in p && p.deadline && /^\d{4}-\d{2}-\d{2}/.test(p.deadline) ? p.deadline.slice(0, 10) : null;
  const existing = (await repo.applications()).find((a) => sameRole({ role, org }, a));
  const application = existing ?? (await repo.trackRole({ reportId, role, org, closesOn: deadline }));
  const kind = ARTEFACT_KIND_FOR[report.row.type]!;
  const held = (await repo.applicationLinks()).find((l) => l.applicationId === application.id && l.kind === kind);
  // Anything already on the application stays. This document is listed beside it for the student to choose.
  if (!held) {
    try {
      await repo.setApplicationLink({ applicationId: application.id, reportId, documentVersion: null, ifCurrent: null });
    } catch (e) {
      if (!(e instanceof LinkConflictError)) throw e;
    }
  }
  return { applicationId: application.id };
}

/** A tailored CV made from a tracked listing goes on that application when the slot is free. It can't fail the report it follows. */
export async function linkNewReport(repo: Repo, opportunityId: string, reportId: string): Promise<void> {
  try {
    const application = (await repo.applications()).find((a) => a.opportunityId === opportunityId);
    if (application) await repo.setApplicationLink({ applicationId: application.id, reportId, documentVersion: null, ifCurrent: null });
  } catch (e) {
    if (!(e instanceof LinkConflictError)) log("error", "application-autolink-failed", { error: e, reportId });
  }
}

export async function dismissActionFlow(repo: Repo, key: string, reason: string): Promise<{ error?: string }> {
  if (!DISMISS_REASONS.includes(reason as DismissReason)) return { error: "Choose a reason." };
  const { candidates, dismissed } = await loadWorkspace(repo, { today: new Date().toISOString().slice(0, 10) });
  // A second tab, or a double click: it's already dismissed, and a repeat adds nothing to the history.
  if (dismissed.some((d) => d.key === key)) return {};
  // Only what we'd actually recommend can be stored, so the history can't be filled with anything else.
  if (!candidates.some((a) => a.key === key)) return { error: ACTION_GONE };
  try {
    await repo.recordActionChoice({ actionKey: key, kind: "dismiss", reason: reason as DismissReason });
    return {};
  } catch (e) {
    log("error", "action-dismiss-failed", { error: e });
    return { error: SAVE_FAILED };
  }
}

export async function reopenActionFlow(repo: Repo, key: string): Promise<{ error?: string }> {
  const history = await repo.actionChoices();
  const latest = history.filter((c) => c.actionKey === key).at(-1);
  if (!latest) return { error: ACTION_GONE };
  if (latest.kind === "reopen") return {};
  try {
    await repo.recordActionChoice({ actionKey: key, kind: "reopen", reason: null });
    return {};
  } catch (e) {
    log("error", "action-reopen-failed", { error: e });
    return { error: SAVE_FAILED };
  }
}

/** Notes that a file was handed over. It never stops the download: losing this record only means the dashboard says "download again". */
export async function noteDownload(repo: Repo, input: { reportId: string; documentVersion: string; format: DownloadFormat }): Promise<void> {
  try {
    await repo.recordDownload(input);
  } catch (e) {
    log("error", "download-record-failed", { error: e, reportId: input.reportId });
  }
}
