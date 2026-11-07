import "server-only";
import { JOB_POLICY, type AnalysisJob, type JobResult, type JobUsage, type Workflow } from "@/lib/analysis/job-state";
import { alert, log } from "@/lib/log";
import { newMeter, withProviderScope, type ProviderMeter } from "@/lib/provider";
import { AI_FAILED_LIMITS, AI_LIMITS, type AiKind, type Repo } from "@/lib/repo/types";

// OP-025: runs one piece of analysis as a recoverable job. A repeat click, a second tab or a retry finds the job and
// gets its result, or waits for it, instead of doing and paying for the work twice. Quota is reserved when the work
// starts and given back if it produces nothing, in the same database step that ends the job. If a server run is killed
// at its time limit, its lease expires and the next request (or the daily sweep) marks it failed and gives the use back.
//
// There is no background worker: `work` runs in the request that asked, within the budget in job-state.ts.

export const MESSAGES = {
  stillWorking: "We're still working on this from your last click. Give it a minute, then try again. It won't count twice against today's limit.",
  busyYou: "You already have a few things running. Wait for them to finish, then try again. Nothing has been lost.",
  busyAll: "We're very busy right now. Try again in a minute. Nothing has been lost.",
  rest: "This hasn't worked after a few tries, so we're giving it a rest. Try again in five minutes. Nothing you've saved has changed, and it didn't count against today's limit.",
  failedCap: "We've had too many problems with this today, so we've paused it for you. You can try again tomorrow. Nothing you've saved has changed.",
  expired: "Your session has expired. Sign in again, then try again. Nothing you've saved has changed.",
  otherFailed: "That attempt didn't finish. Nothing you've saved has changed. Try again.",
  generic: "Something went wrong. Nothing you've saved has changed. Try again.",
} as const;

export interface JobCharge {
  allowed: boolean;
  used: number;
  reason?: "limit" | "failed_cap";
}

export interface JobContext {
  /** Takes one use of today's limit for this job, at most once. Call it only once it's sure the provider will be asked. */
  charge(kind: AiKind): Promise<JobCharge>;
  meter: ProviderMeter;
}

export interface JobWork<T> {
  status: "completed" | "partial" | "failed";
  value: T;
  resultId?: string | null;
  result?: JobResult | null;
  errorCode?: string | null;
  /** Give the use back. Defaults to true for failed work, false otherwise. */
  release?: boolean;
  /** Counts towards the failures that make this work rest. Defaults to true for failed work. Refusing a student's input isn't a failure. */
  countFailure?: boolean;
}

export interface JobSpec<T> {
  workflow: Workflow;
  key: string;
  /** How long finished work answers a repeat. Null: for ever (a CV version is scored once). Keys with no client attempt in them use the repeat window. */
  freshSeconds: number | null;
  /** When the request started, if time was already spent on it (reading the file). */
  startedAt?: number;
  /** The finished job's answer to a repeat, or null if it can no longer be given. */
  replay(job: AnalysisJob): Promise<T | null>;
  /** The student-facing shape of a message. */
  refuse(message: string, code: string): T;
  /**
   * Throw an unexpected failure to the caller after recording it, instead of `refuse`. An expired session is never
   * thrown: it always comes back as `refuse`. The actions wrap these flows in `friendlyFailure`, so a student never sees a throw.
   */
  rethrow?: boolean;
}

/** PostgREST's codes for an expired token, and bump_ai_usage's own refusal. Job state is written with the service role, so it still gets recorded. */
export function isSessionExpired(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  if (code === "PGRST301" || code === "PGRST302" || code === "PGRST303") return true;
  return /jwt expired|not signed in/i.test((e as Error)?.message ?? "");
}

/** What an action says if a flow throws: the job has already recorded the failure and given the use back. */
export async function friendlyFailure<T>(fn: () => Promise<T>, refuse: (message: string) => T, generic: string = MESSAGES.generic): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    log("error", "analysis-action-failed", { error: e });
    return refuse(isSessionExpired(e) ? MESSAGES.expired : generic);
  }
}

const usageOf = (meter: ProviderMeter, startedAt: number): JobUsage => ({ calls: meter.calls, retries: meter.retries, input: meter.input, output: meter.output, costMicros: meter.costMicros, costComplete: meter.costComplete, latencyMs: Math.round(Date.now() - startedAt) });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runAnalysisJob<T>(repo: Repo, spec: JobSpec<T>, work: (ctx: JobContext) => Promise<JobWork<T>>): Promise<T> {
  const startedAt = spec.startedAt ?? Date.now();
  const meter = newMeter();
  let held: { id: string; attempt: number } | null = null;
  try {
    const claim = await repo.claimJob({ workflow: spec.workflow, key: spec.key, freshSeconds: spec.freshSeconds });
    if (claim.outcome !== "claimed") {
      log("info", "analysis-job-not-run", { workflow: spec.workflow, job: claim.job.id, outcome: claim.outcome, scope: claim.scope });
      return await notRun(repo, spec, claim.outcome, claim.job, claim.scope);
    }
    held = { id: claim.job.id, attempt: claim.job.attempts };
  } catch (e) {
    // The job store being unavailable (a migration not yet applied, a database blip) shouldn't stop the analysis itself:
    // the report's own unique index still stops a duplicate. The price is no repeat protection or refunds until it's back.
    void alert("analysis-jobs-unavailable", "Analysis job tracking is unavailable; running without it. Check that the analysis_jobs migration is applied.", { error: e });
    held = null;
  }

  const job = held;
  const ctx: JobContext = {
    meter,
    async charge(kind) {
      if (job) {
        try {
          return await repo.chargeJob(job, kind, AI_LIMITS[kind], AI_FAILED_LIMITS[kind]);
        } catch (e) {
          if (isSessionExpired(e)) throw e;
          log("warn", "analysis-job-charge-unavailable", { job: job.id, error: e });
        }
      }
      const used = await repo.bumpAi(kind);
      return used > AI_LIMITS[kind] ? { allowed: false, used, reason: "limit" as const } : { allowed: true, used };
    },
  };

  let done: JobWork<T>;
  let thrown: { error: unknown } | null = null;
  try {
    done = await withProviderScope(meter, startedAt, () => work(ctx));
  } catch (error) {
    thrown = { error };
    const expired = isSessionExpired(error);
    done = { status: "failed", value: spec.refuse(expired ? MESSAGES.expired : MESSAGES.generic, expired ? "session_expired" : "internal"), errorCode: expired ? "session_expired" : "internal", countFailure: !expired };
    if (!expired) log("error", "analysis-job-failed", { workflow: spec.workflow, job: job?.id, error });
  }

  const failed = done.status === "failed";
  const usage = usageOf(meter, startedAt);
  if (job) {
    try {
      const held = await repo.finishJob(job, { status: done.status, resultId: done.resultId ?? null, result: done.result ?? null, errorCode: done.errorCode ?? null, release: done.release ?? failed, countFailure: done.countFailure ?? failed, usage });
      if (!held) log("warn", "analysis-job-lost-lease", { workflow: spec.workflow, job: job.id });
    } catch (e) {
      // The work's result stands. Left running, the job's lease expires and the sweep settles it.
      log("error", "analysis-job-finish-failed", { workflow: spec.workflow, job: job.id, error: e });
    }
  }
  log(failed ? "warn" : "info", "analysis-job", { workflow: spec.workflow, job: job?.id, status: done.status, errorCode: done.errorCode, attempt: job?.attempt, ms: usage.latencyMs, calls: usage.calls, retries: usage.retries, inputUnits: usage.input, outputUnits: usage.output, costMicros: usage.costMicros, costComplete: usage.costComplete, failures: meter.failures });
  if (thrown && spec.rethrow && !isSessionExpired(thrown.error)) throw thrown.error;
  return done.value;
}

async function notRun<T>(repo: Repo, spec: JobSpec<T>, outcome: "replay" | "in_progress" | "busy" | "cooling_down", job: AnalysisJob, scope?: "user" | "global"): Promise<T> {
  if (outcome === "busy") return spec.refuse(scope === "global" ? MESSAGES.busyAll : MESSAGES.busyYou, "busy");
  if (outcome === "cooling_down") return spec.refuse(MESSAGES.rest, "cooling_down");
  if (outcome === "replay") return (await spec.replay(job)) ?? spec.refuse(MESSAGES.generic, "replay_gone");
  // Running elsewhere: wait for it and give the same answer, for as long as this run can afford to.
  const until = Date.now() + JOB_POLICY.waitForRunningMs;
  while (Date.now() < until) {
    await sleep(JOB_POLICY.waitPollMs);
    const now = await repo.getJob(job.id);
    if (now?.status === "completed" || now?.status === "partial") return (await spec.replay(now)) ?? spec.refuse(MESSAGES.generic, "replay_gone");
    if (now?.status === "failed") return spec.refuse(MESSAGES.otherFailed, "other_failed");
  }
  return spec.refuse(MESSAGES.stillWorking, "in_progress");
}
