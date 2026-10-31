"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { aiDraftLetter, aiEnabled } from "@/lib/ai";
import { extractText, ExtractError } from "@/lib/analysis/extract";
import { paragraphsToText, reviewLetter } from "@/lib/analysis/letter";
import { AI_LIMITS } from "@/lib/repo/types";
import type { Repo } from "@/lib/repo/types";
import { buildLetterDraftPayload, buildLetterReviewPayload, letterHeader, stageLabel } from "@/lib/services";
import { hit, TOO_MANY } from "@/lib/rate-limit";
import { getRepo } from "@/lib/session";
import type { CoverLetterPayload, CvReviewPayload, TailorPayload } from "@/lib/types";

type Result = { id?: string; error?: string };

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

  let paragraphs = null;
  // Over the daily limit, the student still gets a rule-based draft; only AI use is capped.
  if (aiEnabled() && (await repo.bumpAi("letter")) <= AI_LIMITS.letter) {
    paragraphs = await aiDraftLetter({ name: signName(profile, cv), jobTitle: job.jobTitle, employer: job.employer, jobText: job.jobText, cvText: cv.payload.text, addressee, notes });
  }
  const { payload, score } = buildLetterDraftPayload({
    paragraphs,
    name: signName(profile, cv),
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
  return { id };
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
  const { payload, score } = buildLetterReviewPayload({ letterText: text.slice(0, 12000), ...job, cvReportId: cv?.row.id ?? null, cvFileName: cv?.payload.fileName ?? null, cvText: cv?.payload.text ?? "" });
  const id = await repo.createReport({ type: "cover_letter", title: `${job.employer} cover letter`, score, payload });
  revalidatePath("/dashboard");
  return { id };
}

/** "Write an improved version": drafts a new letter from the CV, the ad and the current letter. */
export async function improveLetter(reportId: string): Promise<Result> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  if (!(await hit("aiWritePerUser", repo.userId))) return { error: TOO_MANY };
  const r = await repo.getReport<CoverLetterPayload>(reportId);
  if (!r) return { error: "We couldn't find that letter." };
  if ((await repo.bumpAi("letter")) > AI_LIMITS.letter) return { error: "You've used all your letter rewrites for today. They reset at midnight." };
  const cv = r.payload.cvReportId ? await repo.getReport<CvReviewPayload>(r.payload.cvReportId) : await repo.latestReport<CvReviewPayload>("cv_review");
  if (!cv) return { error: "Upload a CV first. We only use facts from your CV." };
  const profile = await repo.profile();
  const greeting = r.payload.letterText.match(/^dear\s+(.+?),/im)?.[1] ?? null;
  const addressee = greeting && !/hiring manager/i.test(greeting) ? greeting : null;
  const why = r.payload.letterText.split(/\n\s*\n/).find((p) => /(drawn to|appeals|because|particularly)/i.test(p)) ?? null;
  const paragraphs = await aiDraftLetter({ name: signName(profile, cv), jobTitle: r.payload.jobTitle, employer: r.payload.employer, jobText: r.payload.jobText, cvText: cv.payload.text, addressee, notes: null, existingLetter: r.payload.letterText });
  const { payload, score } = buildLetterDraftPayload({
    paragraphs,
    name: signName(profile, cv),
    email: cv.payload.analysis.meta.email ?? profile.email,
    phone: cv.payload.analysis.meta.phone,
    jobTitle: r.payload.jobTitle,
    employer: r.payload.employer,
    jobText: r.payload.jobText,
    tailorReportId: r.payload.tailorReportId,
    cvReportId: cv.row.id,
    cvFileName: cv.payload.fileName,
    cvPayload: cv.payload,
    addressee,
    notes: why,
    stageLabel: stageLabel(profile.stage, profile.course),
  });
  const id = await repo.createReport({ type: "cover_letter", title: `${r.payload.employer} cover letter (improved)`, score, payload });
  revalidatePath("/dashboard");
  return { id };
}

const EditSchema = z.object({ index: z.number().int().min(0), text: z.string().trim().min(1).max(3000) });

export async function editParagraph(reportId: string, index: number, text: string): Promise<{ error?: string }> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  const v = EditSchema.safeParse({ index, text });
  if (!v.success) return { error: "A paragraph can't be empty." };
  const r = await repo.getReport<CoverLetterPayload>(reportId);
  if (!r || !r.payload.paragraphs[index]) return { error: "We couldn't find that paragraph." };
  const p = r.payload;
  p.paragraphs[index] = { text: v.data.text, src: [...new Set([...p.paragraphs[index].src, "YOU EDITED"])] };
  return saveRecomputed(repo, reportId, p);
}

export async function deleteParagraph(reportId: string, index: number): Promise<{ error?: string }> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  const r = await repo.getReport<CoverLetterPayload>(reportId);
  if (!r || !r.payload.paragraphs[index]) return { error: "We couldn't find that paragraph." };
  r.payload.paragraphs.splice(index, 1);
  return saveRecomputed(repo, reportId, r.payload);
}

async function saveRecomputed(repo: Repo, reportId: string, p: CoverLetterPayload) {
  const profile = await repo.profile();
  const cv = p.cvReportId ? await repo.getReport<CvReviewPayload>(p.cvReportId) : null;
  const header = letterHeader(signName(profile, cv), cv?.payload.analysis.meta.email ?? profile.email, cv?.payload.analysis.meta.phone ?? null);
  p.letterText = paragraphsToText(p.paragraphs, header);
  const rv = reviewLetter(p.letterText, p.jobText, p.employer, cv?.payload.text ?? "");
  Object.assign(p, { checks: rv.checks, keywordsUsed: rv.keywordsUsed, keywordsMissing: rv.keywordsMissing, words: rv.words, paras: rv.paras, summary: rv.summary });
  await repo.updateReport(reportId, { payload: p, score: rv.score });
  revalidatePath(`/letters/${reportId}`);
  return {};
}

export async function saveLetter(reportId: string): Promise<{ error?: string }> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  const r = await repo.getReport<CoverLetterPayload>(reportId);
  if (!r) return { error: "We couldn't find that letter." };
  r.payload.saved = true;
  await repo.updateReport(reportId, { payload: r.payload });
  revalidatePath(`/letters/${reportId}`);
  revalidatePath("/dashboard");
  return {};
}

/** Turns a draft into a full review so the student sees the core checks view. */
export async function reviewDraft(reportId: string): Promise<Result> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  const r = await repo.getReport<CoverLetterPayload>(reportId);
  if (!r) return { error: "We couldn't find that letter." };
  const cv = r.payload.cvReportId ? await repo.getReport<CvReviewPayload>(r.payload.cvReportId) : null;
  const { payload, score } = buildLetterReviewPayload({ letterText: r.payload.letterText, jobTitle: r.payload.jobTitle, employer: r.payload.employer, jobText: r.payload.jobText, tailorReportId: r.payload.tailorReportId, cvReportId: r.payload.cvReportId, cvFileName: r.payload.cvFileName, cvText: cv?.payload.text ?? "" });
  const id = await repo.createReport({ type: "cover_letter", title: `${r.payload.employer} cover letter review`, score, payload });
  revalidatePath("/dashboard");
  return { id };
}
