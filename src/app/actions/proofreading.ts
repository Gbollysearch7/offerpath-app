"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MAX_FINDING_ID_CHARS } from "@/lib/analysis/proofreading/choices";
import { dismissFlow, languageFlow, reopenFlow, type FlowResult } from "@/lib/proofreading-flow";
import { hit, TOO_MANY } from "@/lib/rate-limit";
import type { Repo } from "@/lib/repo/types";
import { getRepo } from "@/lib/session";

const EXPIRED = "Your session has expired. Sign in again.";
const NOT_VALID = "We couldn't find that suggestion.";
const ReportId = z.string().min(1).max(80);
const FindingId = z.string().min(1).max(MAX_FINDING_ID_CHARS);
const Language = z.enum(["en-GB", "en-US"]);

function refresh(reportId: string) {
  revalidatePath(`/reviews/${reportId}`);
  revalidatePath(`/reviews/${reportId}/checks/spell`);
}

async function findingChoice(repo: Repo, reportId: unknown, findingId: unknown, flow: typeof dismissFlow): Promise<FlowResult> {
  const report = ReportId.safeParse(reportId);
  const finding = FindingId.safeParse(findingId);
  if (!report.success || !finding.success) return { error: NOT_VALID };
  if (!(await hit("proofreadingChoicePerUser", repo.userId))) return { error: TOO_MANY };
  const r = await flow(repo, report.data, finding.data);
  if (!r.error) refresh(report.data);
  return r;
}

/** Sets one suggestion aside on this document, for this student. No score, list or other account changes. */
export async function dismissFinding(reportId: string, findingId: string): Promise<FlowResult> {
  const repo = await getRepo();
  if (!repo) return { error: EXPIRED };
  return findingChoice(repo, reportId, findingId, dismissFlow);
}

export async function reopenFinding(reportId: string, findingId: string): Promise<FlowResult> {
  const repo = await getRepo();
  if (!repo) return { error: EXPIRED };
  return findingChoice(repo, reportId, findingId, reopenFlow);
}

/** Checks this CV again in the chosen English and uses it for the student's next CVs. The score doesn't change. */
export async function setProofreadingLanguage(reportId: string, language: string): Promise<FlowResult> {
  const repo = await getRepo();
  if (!repo) return { error: EXPIRED };
  const report = ReportId.safeParse(reportId);
  const choice = Language.safeParse(language);
  if (!report.success || !choice.success) return { error: NOT_VALID };
  if (!(await hit("proofreadingRecheckPerUser", repo.userId))) return { error: TOO_MANY };
  const r = await languageFlow(repo, report.data, choice.data);
  if (!r.error) refresh(report.data);
  return r;
}
