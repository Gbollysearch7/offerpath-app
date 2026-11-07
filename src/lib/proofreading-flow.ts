import "server-only";
import { ChoiceNotFoundError, dismissedIds } from "@/lib/analysis/proofreading/choices";
import { proofreadCv } from "@/lib/analysis/proofreading/run";
import { ReportConflictError, type Repo } from "@/lib/repo/types";
import type { CvReviewPayload, ProofreadingLanguage } from "@/lib/types";

// A student's choices about proofreading (OP-008). The server actions in src/app/actions/proofreading.ts wrap these
// with the session, rate limits and revalidation; the tests call them directly against both repositories.
//
// Dismissing and reopening write only to the student's own history. Changing language rewrites only
// `payload.proofreading`, on purpose and on the student's request. Neither sends a score.

export const NOT_FOUND = "We couldn't find that suggestion.";
const NOT_RECHECKED = "We couldn't check your CV in that English just now, so your results haven't changed. Try again in a few minutes.";
const CHANGED_ELSEWHERE = "This report changed in another tab or window, so your results haven't changed yet. Reload and choose the language again.";
const WRITE_TRIES = 4;

export type FlowResult = { error?: string };

const notFoundAsError = async (run: () => Promise<void>): Promise<FlowResult> => {
  try {
    await run();
    return {};
  } catch (e) {
    if (e instanceof ChoiceNotFoundError) return { error: NOT_FOUND };
    throw e;
  }
};

async function setDismissed(repo: Repo, reportId: string, findingId: string, dismissed: boolean): Promise<FlowResult> {
  const report = await repo.getReport<CvReviewPayload>(reportId);
  const version = report?.row.type === "cv_review" ? report.payload.proofreading?.documentVersion : undefined;
  if (!version) return { error: NOT_FOUND };
  // A double click or a second tab: already in that state, so the history gets no second entry.
  if (dismissedIds(await repo.proofreadingChoices(version), version).has(findingId) === dismissed) return {};
  return notFoundAsError(async () => {
    await repo.recordProofreadingChoice({ reportId, kind: dismissed ? "dismiss" : "reopen", findingId });
  });
}

export const dismissFlow = (repo: Repo, reportId: string, findingId: string) => setDismissed(repo, reportId, findingId, true);
export const reopenFlow = (repo: Repo, reportId: string, findingId: string) => setDismissed(repo, reportId, findingId, false);

/**
 * Checks this CV again in the chosen English and remembers the choice for the next ones. The score, the analysis and
 * the text aren't touched: the core score stays the same for the same CV whichever English a student picks. A run that
 * fails changes nothing and records nothing, so a working result is never swapped for "couldn't run".
 */
export async function languageFlow(repo: Repo, reportId: string, language: ProofreadingLanguage): Promise<FlowResult> {
  const report = await repo.getReport<CvReviewPayload>(reportId);
  if (report?.row.type !== "cv_review" || !report.payload.proofreading) return { error: NOT_FOUND };
  const { payload } = report;
  const current = payload.proofreading!;
  const sameReport = current.language === language && current.status !== "unavailable";
  if (sameReport && (await repo.proofreadingLanguagePreference()) === language) return {};
  const next = sameReport ? current : await proofreadCv(payload.text, process.env, language);
  if (next.status === "unavailable") return { error: NOT_RECHECKED };
  let lost = false;
  const out = await notFoundAsError(async () => {
    // The choice first: if the save below fails the student's decision is still on record, and repeating it finishes the job.
    await repo.recordProofreadingChoice({ reportId, kind: "language", language });
    if (!sameReport) lost = !(await saveProofreading(repo, reportId, next));
  });
  return lost ? { error: CHANGED_ELSEWHERE } : out;
}

/**
 * Puts a new proofreading result on what is saved now, as one step. Checking takes time and a line can be saved meanwhile,
 * so the payload read before the check is never written back. False when another writer kept getting there first.
 */
async function saveProofreading(repo: Repo, reportId: string, next: NonNullable<CvReviewPayload["proofreading"]>): Promise<boolean> {
  for (let i = 0; i < WRITE_TRIES; i++) {
    const now = await repo.getReport<CvReviewPayload>(reportId);
    if (now?.row.type !== "cv_review") throw new ChoiceNotFoundError();
    // The text never changes under a report, but a result for other words must not be saved over it if it ever did.
    if (now.payload.proofreading?.documentVersion !== next.documentVersion) return false;
    const before = now.payload.editRevision ?? null;
    try {
      await repo.updateReport(reportId, { payload: { ...now.payload, proofreading: next, editRevision: (before ?? 0) + 1 } }, { ifRevision: before });
      return true;
    } catch (error) {
      if (!(error instanceof ReportConflictError)) throw error;
    }
  }
  return false;
}
