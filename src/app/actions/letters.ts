"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { aiDraftLetter, aiEnabled } from "@/lib/ai";
import { runAnalysisJob } from "@/lib/analysis-job";
import { sha256 } from "@/lib/analysis/fingerprint";
import { JOB_POLICY } from "@/lib/analysis/job-state";
import { extractText, ExtractError } from "@/lib/analysis/extract";
import type { CheckedDraft } from "@/lib/analysis/letter-check";
import { baseDocument } from "@/lib/analysis/tailor-edits";
import { acceptClearLetterFlow, decideLetterFlow, deleteParagraphFlow, generateDraft, improveLetterFlow, ownParagraphFlow, recheckLetterFlow, rejectLetterFlow, reopenLetterFlow, restoreLetterFlow, retainLetterFlow, saveLetterFlow, undoLetterFlow, type LetterAttempt, type LetterFlowResult, type LetterProvider } from "@/lib/letter-flow";
import type { Repo } from "@/lib/repo/types";
import { buildLetterDraftPayload, buildLetterReviewPayload, stageLabel } from "@/lib/services";
import { hit, TOO_MANY } from "@/lib/rate-limit";
import { getRepo } from "@/lib/session";
import type { CvReviewPayload, TailorPayload } from "@/lib/types";

const letterProvider: LetterProvider = (input) => aiDraftLetter(input);

/** Where the text is going, from the form. A word limit the advert states is read from the advert. */
function contextFrom(formData: FormData): { format: "letter" | "statement"; wordLimit: number | null } {
  const limit = Number(String(formData.get("wordLimit") ?? "").trim());
  return { format: formData.get("format") === "statement" ? "statement" : "letter", wordLimit: Number.isInteger(limit) && limit >= 20 && limit <= 5000 ? limit : null };
}

/** `notice`: the report was made, but a part of it couldn't be, and the student should know why. */
type Result = { id?: string; error?: string; notice?: "ai_unavailable" | "quota" };

/** The client's key for one attempt, tied to what was sent. With none (an old tab), a repeat is what arrives soon after with the same content. */
const ClientKey = z.string().regex(/^[\w-]{16,64}$/);
function attemptKey(formData: FormData, content: unknown[]): { key: string; freshSeconds: number | null } {
  const hash = sha256(JSON.stringify(content));
  const client = ClientKey.safeParse(formData.get("key"));
  return client.success ? { key: `${hash}:${client.data}`, freshSeconds: null } : { key: hash, freshSeconds: JOB_POLICY.repeatWindowSeconds };
}
const replayReport = async (job: { resultId: string | null }): Promise<Result | null> => (job.resultId ? { id: job.resultId } : null);
const refuse = (error: string): Result => ({ error });

/** Errors whose message is written for the student and safe to show. */
class JobInputError extends Error {}

async function resolveJob(repo: Repo, formData: FormData) {
  const tailorId = String(formData.get("tailorReportId") ?? "");
  if (tailorId && tailorId !== "new") {
    const t = await repo.getReport<TailorPayload>(tailorId);
    if (!t) throw new JobInputError("We couldn't find that job.");
    return { jobTitle: t.payload.jobTitle, employer: t.payload.employer, jobText: t.payload.jobText, tailorReportId: t.row.id, cvReportId: t.payload.cvReportId };
  }
  const jobText = String(formData.get("jobText") ?? "").trim().slice(0, 15000);
  const jobTitle = String(formData.get("jobTitle") ?? "").trim().slice(0, 120);
  const employer = String(formData.get("employer") ?? "").trim().slice(0, 80);
  if (!jobTitle || !employer) throw new JobInputError("Add the job title and employer.");
  return { jobTitle, employer, jobText, tailorReportId: null, cvReportId: null };
}

/** The name to sign with: the one on the CV, since the account name may only be guessed from an email address. */
function signName(profile: { fullName: string }, cv: { payload: CvReviewPayload } | null | undefined): string {
  return cv?.payload.analysis.meta.name || profile.fullName;
}

export async function createLetterDraft(formData: FormData): Promise<Result> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  if (!(await hit("aiWritePerUser", repo.userId))) return { error: TOO_MANY };
  let job;
  try {
    job = await resolveJob(repo, formData);
  } catch (e) {
    return { error: e instanceof JobInputError ? e.message : "Something went wrong. Try again." };
  }
  const cvId = String(formData.get("cvReportId") ?? "") || job.cvReportId;
  const cv = cvId ? await repo.getReport<CvReviewPayload>(cvId) : await repo.latestReport<CvReviewPayload>("cv_review");
  if (!cv) return { error: "Upload a CV first. We write your letter from it." };
  const addressee = String(formData.get("addressee") ?? "").trim().slice(0, 120) || null;
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 1000) || null;
  const profile = await repo.profile();

  return runAnalysisJob<Result>(
    repo,
    { workflow: "letter_draft", ...attemptKey(formData, [job, cv.row.id, addressee, notes]), replay: replayReport, refuse },
    async (run) => {
      let checked: CheckedDraft | null = null;
      let notice: Result["notice"];
      const name = signName(profile, cv);
      // Over the daily limit, the student still gets a rule-based draft; only AI use is capped.
      if (aiEnabled()) {
        const charge = await run.charge("letter");
        if (charge.allowed) {
          // Generated text is only ever used once it has been through the fact check.
          checked = await generateDraft(letterProvider, { name, jobTitle: job.jobTitle, employer: job.employer, jobText: job.jobText, cvText: baseDocument(cv.payload).text, addressee, notes }, cv.payload);
          if (!checked) notice = "ai_unavailable";
        } else {
          notice = "quota";
        }
      }
      const { payload, score } = buildLetterDraftPayload({
        paragraphs: checked?.paragraphs ?? null,
        withheld: checked?.withheld,
        claims: checked?.claims,
        name,
        email: cv.payload.analysis.meta.email ?? profile.email,
        phone: cv.payload.analysis.meta.phone,
        ...job,
        cvReportId: cv.row.id,
        cvFileName: cv.payload.fileName,
        cvPayload: cv.payload,
        addressee,
        notes,
        stageLabel: stageLabel(profile.stage, profile.course),
      });
      const id = await repo.createReport({ type: "cover_letter", title: `${job.employer} cover letter`, score, payload });
      revalidatePath("/dashboard");
      // The draft stands; the AI part of it wasn't delivered, so that use goes back.
      return notice ? { status: "partial", value: { id, notice }, resultId: id, errorCode: notice === "quota" ? "quota" : "provider", release: notice === "ai_unavailable" } : { status: "completed", value: { id }, resultId: id };
    },
  );
}

export async function createLetterReview(formData: FormData): Promise<Result> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  if (!(await hit("aiWritePerUser", repo.userId))) return { error: TOO_MANY };
  let job;
  try {
    job = await resolveJob(repo, formData);
  } catch (e) {
    return { error: e instanceof JobInputError ? e.message : "Something went wrong. Try again." };
  }
  let text = String(formData.get("letterText") ?? "").trim();
  const file = formData.get("file");
  if (!text && file instanceof File && file.size > 0) {
    try {
      text = await extractText(new Uint8Array(await file.arrayBuffer()), file.name);
    } catch (e) {
      return { error: e instanceof ExtractError ? e.message : "We couldn't read that file." };
    }
  }
  if (text.split(/\s+/).length < 40) return { error: "Upload your letter or paste at least a paragraph." };
  const cv = job.cvReportId ? await repo.getReport<CvReviewPayload>(job.cvReportId) : await repo.latestReport<CvReviewPayload>("cv_review");
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 1000) || null;
  const context = contextFrom(formData);
  return runAnalysisJob<Result>(repo, { workflow: "letter_review", ...attemptKey(formData, [job, text, notes, context]), replay: replayReport, refuse }, async () => {
    const profile = await repo.profile();
    const { payload, score } = buildLetterReviewPayload({ letterText: text.slice(0, 12000), ...job, cvReportId: cv?.row.id ?? null, cvFileName: cv?.payload.fileName ?? null, cvPayload: cv?.payload ?? null, notes, name: signName(profile, cv), ...context });
    const id = await repo.createReport({ type: "cover_letter", title: `${job.employer} cover letter`, score, payload });
    revalidatePath("/dashboard");
    return { status: "completed", value: { id }, resultId: id };
  });
}

/** "Suggest improvements": suggestions on this report, paragraph by paragraph. Nothing changes until the student keeps one. */
export async function improveLetter(reportId: string, attempt?: LetterAttempt): Promise<Result> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  if (!(await hit("aiWritePerUser", repo.userId))) return { error: TOO_MANY };
  const parsed = Attempt_.safeParse(attempt ?? {});
  const out = await improveLetterFlow(repo, reportId, aiEnabled() ? letterProvider : null, parsed.success ? parsed.data : {});
  if (out.error) return { error: out.error };
  revalidatePath(`/letters/${reportId}`);
  return { id: out.id ?? reportId };
}

type Done = { error?: string; conflict?: boolean; check?: { issues: { severity: string; key: string; message: string }[] } };

const NO_SESSION: Done = { error: "Your session has expired. Sign in again." };
const Attempt_ = z.object({ key: ClientKey.optional(), revision: z.number().int().nullable().optional() });

/** Runs one change to a letter on the signed-in student's repository, which can only reach their reports. */
async function change(reportId: string, attempt: unknown, run: (a: LetterAttempt) => Promise<LetterFlowResult>): Promise<Done> {
  const parsed = Attempt_.safeParse(attempt ?? {});
  if (!parsed.success) return { error: "Something went wrong. Reload and try again." };
  const out = await run(parsed.data);
  if (!out.error) {
    revalidatePath(`/letters/${reportId}`);
    revalidatePath("/dashboard");
  }
  return out.check ? { error: out.error, conflict: out.conflict, check: { issues: out.check.issues.map((i) => ({ severity: i.severity, key: i.key, message: i.message })) } } : { error: out.error, conflict: out.conflict };
}

const Keys = z.array(z.string().max(200)).max(30);

export async function decideLetterSuggestion(reportId: string, input: { suggestionId: string; text: string | null; confirmed: string[] }, attempt?: LetterAttempt): Promise<Done> {
  const repo = await getRepo();
  if (!repo) return NO_SESSION;
  const v = z.object({ suggestionId: z.string().max(40), text: z.string().max(3000).nullable(), confirmed: Keys }).safeParse(input);
  if (!v.success) return { error: "Something went wrong. Reload and try again." };
  return change(reportId, attempt, (a) => decideLetterFlow(repo, reportId, v.data, a));
}

export async function acceptClearLetterSuggestions(reportId: string, attempt?: LetterAttempt): Promise<Done> {
  const repo = await getRepo();
  if (!repo) return NO_SESSION;
  return change(reportId, attempt, (a) => acceptClearLetterFlow(repo, reportId, a));
}

export async function rejectLetterSuggestion(reportId: string, suggestionId: string, attempt?: LetterAttempt): Promise<Done> {
  const repo = await getRepo();
  if (!repo) return NO_SESSION;
  return change(reportId, attempt, (a) => rejectLetterFlow(repo, reportId, String(suggestionId).slice(0, 40), a));
}

export async function reopenLetterSuggestion(reportId: string, suggestionId: string, attempt?: LetterAttempt): Promise<Done> {
  const repo = await getRepo();
  if (!repo) return NO_SESSION;
  return change(reportId, attempt, (a) => reopenLetterFlow(repo, reportId, String(suggestionId).slice(0, 40), a));
}

const EditSchema = z.object({ index: z.number().int().min(0), text: z.string().trim().min(1).max(3000), confirmed: Keys });

export async function editParagraph(reportId: string, index: number, text: string, confirmed: string[] = [], attempt?: LetterAttempt): Promise<Done> {
  const repo = await getRepo();
  if (!repo) return NO_SESSION;
  const v = EditSchema.safeParse({ index, text, confirmed });
  if (!v.success) return { error: "A paragraph can't be empty." };
  return change(reportId, attempt, (a) => ownParagraphFlow(repo, reportId, { paragraph: v.data.index, text: v.data.text, confirmed: v.data.confirmed }, a));
}

export async function deleteParagraph(reportId: string, index: number, attempt?: LetterAttempt): Promise<Done> {
  const repo = await getRepo();
  if (!repo) return NO_SESSION;
  if (!Number.isInteger(index) || index < 0) return { error: "We couldn't find that paragraph." };
  return change(reportId, attempt, (a) => deleteParagraphFlow(repo, reportId, index, a));
}

export async function undoLetterEdit(reportId: string, attempt?: LetterAttempt): Promise<Done> {
  const repo = await getRepo();
  if (!repo) return NO_SESSION;
  return change(reportId, attempt, (a) => undoLetterFlow(repo, reportId, a));
}

export async function restoreLetterVersion(reportId: string, versionId: string, attempt?: LetterAttempt): Promise<Done> {
  const repo = await getRepo();
  if (!repo) return NO_SESSION;
  return change(reportId, attempt, (a) => restoreLetterFlow(repo, reportId, String(versionId).slice(0, 12), a));
}

export async function retainLetterGaps(reportId: string, attempt?: LetterAttempt): Promise<Done> {
  const repo = await getRepo();
  if (!repo) return NO_SESSION;
  return change(reportId, attempt, (a) => retainLetterFlow(repo, reportId, a));
}

export async function saveLetter(reportId: string): Promise<{ error?: string }> {
  const repo = await getRepo();
  if (!repo) return NO_SESSION;
  return change(reportId, {}, (a) => saveLetterFlow(repo, reportId, a));
}

/** The selected text as a new report, assessed today. How an old report gets edited, and how a letter is compared with a CV that has changed. */
export async function reviewDraft(reportId: string): Promise<Result> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  const out = await recheckLetterFlow(repo, reportId);
  if (out.error || !out.id) return { error: out.error ?? "Something went wrong. Try again." };
  revalidatePath("/dashboard");
  return { id: out.id };
}
