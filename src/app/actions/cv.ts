"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { aiEnabled, aiRewriteLine } from "@/lib/ai";
import { judgmentFromLine, ruleRewrite } from "@/lib/analysis/cv";
import { extractText, ExtractError, MAX_UPLOAD_BYTES } from "@/lib/analysis/extract";
import { SECTORS, STAGES } from "@/lib/analysis/lexicon";
import { AI_LIMITS } from "@/lib/repo/types";
import { scoreCv, ScoringUnavailableError } from "@/lib/scoring";
import { buildCvPayload } from "@/lib/services";
import { featureFlags } from "@/lib/env";
import { hit, TOO_MANY } from "@/lib/rate-limit";
import { getRepo } from "@/lib/session";
import type { CvReviewPayload } from "@/lib/types";

export type UploadResult = { id?: string; error?: string };

export async function uploadCv(formData: FormData): Promise<UploadResult> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  const file = formData.get("file");
  const sector = z.enum(SECTORS).safeParse(formData.get("sector"));
  const stage = z.enum(STAGES).safeParse(formData.get("stage"));
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a PDF or Word file to upload." };
  if (!(await hit("uploadPerUser", repo.userId))) return { error: TOO_MANY };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "That file is over 2 MB. Try saving a smaller PDF." };
  if (!sector.success || !stage.success) return { error: "Pick a target sector and stage." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try {
    text = await extractText(bytes, file.name);
  } catch (e) {
    return { error: e instanceof ExtractError ? e.message : "Something went wrong reading your file. Try again." };
  }
  const name = file.name.slice(0, 120);
  if (aiEnabled() && (await repo.bumpAi("cv_score")) > AI_LIMITS.cv_score) {
    return { error: `You've scored ${AI_LIMITS.cv_score} CVs today. You can score more tomorrow.` };
  }
  let scored;
  try {
    scored = await scoreCv(text, sector.data);
  } catch (e) {
    return { error: e instanceof ScoringUnavailableError ? e.message : "Something went wrong scoring your CV. Try again." };
  }
  const payload = buildCvPayload({ fileName: name, text, sector: sector.data, stage: stage.data, analysis: scored.analysis });
  const id = await repo.createReport({ type: "cv_review", title: name, score: payload.analysis.score, payload, file: { bytes, name, contentType: file.type || "application/octet-stream" } });
  revalidatePath("/dashboard");
  return { id };
}

export async function rewriteLine(reportId: string, index: number, variant: number): Promise<{ rewrite?: string; ai?: boolean; left?: number; error?: string }> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  const report = await repo.getReport<CvReviewPayload>(reportId);
  const line = report?.payload.analysis.lines[index];
  if (!report || !line) return { error: "We couldn't find that line." };
  // Reserve the use first so parallel requests can't go over the limit.
  const used = await repo.bumpAi("line_rewrite");
  if (used > AI_LIMITS.line_rewrite) return { error: "You've used all your rewrites for today. They reset at midnight.", left: 0 };
  const previous = variant > 0 ? line.rewrite : undefined;
  const ai = await aiRewriteLine(line.text, { role: line.where, sector: report.payload.sector, previous });
  const rewrite = ai ?? ruleRewrite(line.text, variant, judgmentFromLine(line));
  report.payload.analysis.lines[index] = { ...line, rewrite, aiRewrite: !!ai };
  await repo.updateReport(reportId, { payload: report.payload });
  return { rewrite, ai: !!ai, left: AI_LIMITS.line_rewrite - used };
}

export async function acceptRewrite(reportId: string, index: number, text: string | null): Promise<{ error?: string }> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  const report = await repo.getReport<CvReviewPayload>(reportId);
  const line = report?.payload.analysis.lines[index];
  if (!report || !line) return { error: "We couldn't find that line." };
  const clean = text ? z.string().trim().min(3).max(400).parse(text) : undefined;
  report.payload.analysis.lines[index] = { ...line, accepted: clean };
  await repo.updateReport(reportId, { payload: report.payload });
  revalidatePath(`/reviews/${reportId}/lines`);
  return {};
}

export async function setShareProgress(on: boolean): Promise<void> {
  const repo = await getRepo();
  if (!repo) throw new Error("Not signed in");
  await repo.updateProfile({ shareProgress: on });
  revalidatePath("/privacy");
  revalidatePath("/dashboard");
}

export async function setDeadlineReminders(on: boolean): Promise<void> {
  const repo = await getRepo();
  if (!repo) throw new Error("Not signed in");
  await repo.updateProfile({ deadlineReminders: on });
  revalidatePath("/privacy");
}

export async function setAdviserCvSharing(on: boolean): Promise<void> {
  const repo = await getRepo();
  if (!repo) throw new Error("Not signed in");
  if (!featureFlags.adviserCvAccess()) throw new Error("Not available yet");
  await repo.updateProfile({ adviserCanViewCv: on });
  revalidatePath("/privacy");
}
