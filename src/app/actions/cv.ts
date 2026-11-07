"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { aiEnabled, aiRewriteLine } from "@/lib/ai";
import { friendlyFailure } from "@/lib/analysis-job";
import { MAX_BLOCK_CHARS, MAX_CONTENT_BLOCKS } from "@/lib/analysis/content";
import type { ReadingSummary } from "@/lib/analysis/document";
import { MAX_UPLOAD_BYTES, type ReadOutcome } from "@/lib/analysis/extract";
import { SECTORS, STAGES } from "@/lib/analysis/lexicon";
import { correctFlow, pasteFlow, scoreFlow, uploadFlow, type ScoreFlowResult, type SourceReview, type UploadFlowResult } from "@/lib/cv-flow";
import { featureFlags } from "@/lib/env";
import { hit, TOO_MANY } from "@/lib/rate-limit";
import { getRepo } from "@/lib/session";
import { acceptRewriteFlow, rewriteLineFlow, undoAcceptFlow, type RewriteResult } from "@/lib/rewrite-flow";
import type { RewriteCheck } from "@/lib/analysis/rewrite-check";
import type { ContentBlock } from "@/lib/types";

export type { ContentBlock, ReadingSummary, ReadOutcome, SourceReview };

const EXPIRED = "Your session has expired. Sign in again.";
const PICK = "Pick a target sector and stage.";
const Sector = z.enum(SECTORS);
const Stage = z.enum(STAGES);
/**
 * The client's key for one attempt, reused on retry so the server can tell a repeat from a new request. At most 64
 * characters: the paste flow keeps the unreadable original under `<key>:original`, and the column allows 80.
 */
const Key = z.string().regex(/^[\w-]{16,64}$/);
const SourceId = z.string().min(1).max(80);
const Blocks = z.array(z.strictObject({ id: z.string().regex(/^b\d{1,5}$/), text: z.string().max(MAX_BLOCK_CHARS) })).max(MAX_CONTENT_BLOCKS);

/**
 * `id` (with `sourceId`, `reading`): the CV was read and scored; `showReading` asks for the reading to be shown before
 * the score. `review`: the CV was read but not scored, because the reading needs the student's eyes first. `outcome`:
 * the file could not be read as text or is outside a processing limit; nothing was scored or saved. `error`: anything
 * else that stopped the upload.
 */
export type UploadResult = { id?: string; sourceId?: string; reading?: ReadingSummary; showReading?: boolean; review?: SourceReview; outcome?: ReadOutcome; error?: string };

export async function uploadCv(formData: FormData): Promise<UploadResult> {
  const repo = await getRepo();
  if (!repo) return { error: EXPIRED };
  const file = formData.get("file");
  const sector = Sector.safeParse(formData.get("sector"));
  const stage = Stage.safeParse(formData.get("stage"));
  const key = Key.safeParse(formData.get("key"));
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a PDF or Word file to upload." };
  if (!(await hit("uploadPerUser", repo.userId))) return { error: TOO_MANY };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "That file is over 2 MB. Try saving a smaller PDF." };
  if (!sector.success || !stage.success) return { error: PICK };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const r = await friendlyFailure<UploadFlowResult>(() => uploadFlow(repo, { bytes, fileName: file.name.slice(0, 120), sector: sector.data, stage: stage.data, key: key.success ? key.data : crypto.randomUUID() }), (error) => ({ kind: "error", error }));
  if (r.kind === "outcome") return { outcome: r.outcome };
  if (r.kind === "error") return { error: r.error };
  if (r.kind === "review") return { review: r.review };
  revalidatePath("/dashboard");
  return { id: r.id, sourceId: r.sourceId, reading: r.reading, showReading: r.showReading };
}

export type ScoreResult = { id?: string; sourceId?: string; error?: string };

/** Scores a version the student has reviewed, as it was read. */
export async function scoreVersion(input: { sourceId: string; sector: string; stage: string }): Promise<ScoreResult> {
  const repo = await getRepo();
  if (!repo) return { error: EXPIRED };
  const p = z.object({ sourceId: SourceId, sector: Sector, stage: Stage }).safeParse(input);
  if (!p.success) return { error: PICK };
  if (!(await hit("uploadPerUser", repo.userId))) return { error: TOO_MANY };
  const r = await friendlyFailure<ScoreFlowResult>(() => scoreFlow(repo, p.data.sourceId, p.data.sector, p.data.stage), (error) => ({ error }));
  if ("error" in r) return { error: r.error };
  revalidatePath("/dashboard");
  return r;
}

/** Saves the student's corrections to a version's blocks as a new version with provenance, and scores that. */
export async function correctVersion(input: { sourceId: string; blocks: { id: string; text: string }[]; sector: string; stage: string; key: string }): Promise<ScoreResult & { changed?: boolean }> {
  const repo = await getRepo();
  if (!repo) return { error: EXPIRED };
  const p = z.object({ sourceId: SourceId, blocks: Blocks, sector: Sector, stage: Stage, key: Key }).safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.path[0] === "blocks" ? `Check the text: a line is too long (over ${MAX_BLOCK_CHARS} characters) or the page is out of date.` : PICK };
  if (!(await hit("uploadPerUser", repo.userId))) return { error: TOO_MANY };
  const r = await friendlyFailure<ScoreFlowResult & { changed?: boolean }>(() => correctFlow(repo, p.data), (error) => ({ error }));
  if ("error" in r) return { error: r.error };
  revalidatePath("/dashboard");
  return r;
}

/** Text the student typed or pasted instead of an unreadable file; the file, if re-sent, is kept as the original. */
export async function pasteCv(formData: FormData): Promise<ScoreResult> {
  const repo = await getRepo();
  if (!repo) return { error: EXPIRED };
  const text = formData.get("text");
  const sector = Sector.safeParse(formData.get("sector"));
  const stage = Stage.safeParse(formData.get("stage"));
  const key = Key.safeParse(formData.get("key"));
  const file = formData.get("file");
  if (typeof text !== "string" || !text.trim()) return { error: "Paste or type your CV text first." };
  if (!sector.success || !stage.success) return { error: PICK };
  if (!(await hit("uploadPerUser", repo.userId))) return { error: TOO_MANY };
  const original = file instanceof File && file.size > 0 && file.size <= MAX_UPLOAD_BYTES ? { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name.slice(0, 120) } : null;
  const r = await friendlyFailure<ScoreFlowResult>(() => pasteFlow(repo, { text: text.slice(0, 60_000), original, sector: sector.data, stage: stage.data, key: key.success ? key.data : crypto.randomUUID() }), (error) => ({ error }));
  if ("error" in r) return { error: r.error };
  revalidatePath("/dashboard");
  return r;
}

export async function rewriteLine(reportId: string, index: number, variant: number): Promise<RewriteResult> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  return friendlyFailure<RewriteResult>(() => rewriteLineFlow(repo, reportId, index, variant, aiEnabled() ? aiRewriteLine : null), (error) => ({ error }), "We couldn't save that. Your line hasn't changed. Try again.");
}

export async function acceptRewrite(reportId: string, index: number, text: string | null, confirmed: string[] = [], options: { typed?: boolean; expected?: string | null } = {}): Promise<{ error?: string; check?: RewriteCheck; conflict?: boolean }> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  const opts = z.object({ typed: z.boolean().optional(), expected: z.string().max(2_000).nullable().optional() }).catch({}).parse(options);
  const r = await acceptRewriteFlow(repo, reportId, index, text, z.array(z.string().max(200)).max(50).catch([]).parse(confirmed), opts);
  if (r.error) return r;
  revalidatePath(`/reviews/${reportId}/lines`);
  return { check: r.check };
}

export async function undoAccepted(reportId: string, index: number, expected?: string | null): Promise<{ error?: string; conflict?: boolean; accepted?: string | null }> {
  const repo = await getRepo();
  if (!repo) return { error: "Your session has expired. Sign in again." };
  const r = await undoAcceptFlow(repo, reportId, index, z.string().max(2_000).nullable().optional().catch(undefined).parse(expected));
  if (!r.error) revalidatePath(`/reviews/${reportId}/lines`);
  return r;
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
