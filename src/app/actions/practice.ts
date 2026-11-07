"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { aiEnabled, aiPracticeFeedback } from "@/lib/ai";
import { approveVersionFlow, deleteAnswerFlow, submitPracticeFlow, type SubmitResult } from "@/lib/practice-flow";
import { ANSWER_MAX } from "@/lib/practice-types";
import { hit, TOO_MANY } from "@/lib/rate-limit";
import { getRepo } from "@/lib/session";

// OP-023. Each action works out who is asking from the session, never from what the page sent. A saved answer is the student's
// alone: nothing here, or anywhere else, takes a student's id from a staff member and reads their practice.

const EXPIRED = "Your session has expired. Sign in again, then come back to this page. Nothing here was changed, and your answer is still on the page.";
const INVALID = "We couldn't do that. Reload the page and try again.";

const Id = z.string().min(1).max(80);
const Submit = z.object({ applicationId: Id.nullable(), sector: z.string().max(80), objective: z.string().max(20), questionId: z.string().min(1).max(200), answer: z.string().max(ANSWER_MAX * 2), attemptKey: z.string().regex(/^[\w-]{16,64}$/) });

export async function submitPracticeAnswer(input: unknown): Promise<SubmitResult> {
  const parsed = Submit.safeParse(input);
  if (!parsed.success) return { error: INVALID };
  const repo = await getRepo();
  if (!repo) return { error: EXPIRED };
  if (!(await hit("practiceAnswerPerUser", repo.userId))) return { error: TOO_MANY };
  const out = await submitPracticeFlow(repo, parsed.data, aiEnabled() ? aiPracticeFeedback : null);
  if (out.saved) {
    revalidatePath("/practice/interview/saved");
    revalidatePath("/dashboard");
  }
  return out;
}

export async function approvePracticeVersion(applicationId: string, reportId: string, kind: string, seen: string, ifCurrent: string | null): Promise<{ error?: string }> {
  const input = z.object({ applicationId: Id, reportId: Id, kind: z.enum(["cv", "tailor"]), seen: z.string().regex(/^[0-9a-f]{64}$/), ifCurrent: Id.nullable() }).safeParse({ applicationId, reportId, kind, seen, ifCurrent });
  if (!input.success) return { error: INVALID };
  const repo = await getRepo();
  if (!repo) return { error: EXPIRED };
  if (!(await hit("applicationChoicePerUser", repo.userId))) return { error: TOO_MANY };
  const out = await approveVersionFlow(repo, input.data);
  if (!out.error) {
    revalidatePath("/practice/interview");
    revalidatePath("/dashboard");
  }
  return { error: out.error };
}

export async function deletePracticeAnswer(id: string): Promise<{ error?: string }> {
  const input = Id.safeParse(id);
  if (!input.success) return { error: INVALID };
  const repo = await getRepo();
  if (!repo) return { error: EXPIRED };
  if (!(await hit("applicationChoicePerUser", repo.userId))) return { error: TOO_MANY };
  const out = await deleteAnswerFlow(repo, input.data);
  if (!out.error) {
    revalidatePath("/practice/interview/saved");
    revalidatePath("/dashboard");
  }
  return out;
}
