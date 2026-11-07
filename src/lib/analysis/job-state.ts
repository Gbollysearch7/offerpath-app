// OP-025: the explicit states analysis moves through, and the limits it runs under. Pure, so both repositories, the
// database checks and the tests read the same rules. There is no background worker: a job runs inside the server run
// that asked for it, so everything here is sized to Vercel's function limit (`maxDuration` on the pages that use it).

export const JOB_STATES = ["queued", "processing", "completed", "partial", "failed"] as const;
export type JobStatus = (typeof JOB_STATES)[number];

/**
 * queued: recorded, not running (a concurrency limit was full; the student's retry with the same key picks it up).
 * processing: a server run holds it, under a lease. completed: done. partial: done, with part of it unavailable
 * (a rule-based draft because the provider failed, proofreading unavailable). failed: nothing was produced, and
 * whatever was reserved was given back; a retry can start it again.
 */
export const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["processing", "failed"],
  processing: ["completed", "partial", "failed"],
  completed: [],
  partial: [],
  failed: ["processing"],
};
export const canMove = (from: JobStatus, to: JobStatus) => JOB_TRANSITIONS[from].includes(to);

export const WORKFLOWS = ["cv_score", "letter_draft", "letter_review", "letter_improve", "tailor_create", "tailor_version", "line_rewrite"] as const;
/** OP-018. Separate because they arrive in their own migration, not the one that made the table. */
export const LINKEDIN_WORKFLOWS = ["linkedin_create", "linkedin_suggest"] as const;
/** OP-023. Also in its own migration. */
export const PRACTICE_WORKFLOWS = ["practice_feedback"] as const;
export type Workflow = (typeof WORKFLOWS)[number] | (typeof LINKEDIN_WORKFLOWS)[number] | (typeof PRACTICE_WORKFLOWS)[number];

/** The function limit on every page whose actions can call the provider. A test checks each of them says this. */
export const MAX_DURATION_SECONDS = 60;
/** All provider work in a request ends by here, leaving the rest of the function limit to save the result. */
export const ANALYSIS_BUDGET_MS = 50_000;

export const JOB_POLICY = {
  /** Longer than any server run can live, so an expired lease means the run is gone, not slow. */
  leaseSeconds: 90,
  /** Running at once for one student. Repeats of the same work don't count: they wait for it. */
  maxActivePerUser: 3,
  /** Running at once across every student. Soft: counted without a global lock. Set against the provider's rate limits. */
  maxActiveGlobal: 40,
  /** Failures in a row of one piece of work before it rests, and for how long. */
  maxConsecutiveFailures: 3,
  cooldownSeconds: 300,
  /** How long a repeat of work with no client key still counts as a repeat once the first has finished. */
  repeatWindowSeconds: 15,
  /** How long a repeat waits for the run it duplicates before saying it's still going. */
  waitForRunningMs: 20_000,
  waitPollMs: 500,
  /** A queued job nobody came back for. */
  queuedExpirySeconds: 3600,
  /** Job rows are operations data: ids and counts, kept this long. */
  retainDays: 90,
} as const;

export function analysisBudgetMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.ANALYSIS_BUDGET_MS);
  return Number.isFinite(n) && n > 0 ? Math.min(n, ANALYSIS_BUDGET_MS) : ANALYSIS_BUDGET_MS;
}

/** Only this can be stored as a job's result: no document text has anywhere to go. */
export type JobResult = { ai?: boolean };

export interface AnalysisJob {
  id: string;
  workflow: Workflow;
  status: JobStatus;
  attempts: number;
  failures: number;
  consecutiveFailures: number;
  resultId: string | null;
  result: JobResult | null;
  errorCode: string | null;
  charged: boolean;
  finishedAt: string | null;
  createdAt: string;
}

export type ClaimOutcome = "claimed" | "replay" | "in_progress" | "busy" | "cooling_down";

export interface ClaimResult {
  outcome: ClaimOutcome;
  job: AnalysisJob;
  /** For `busy`: whose limit was full. */
  scope?: "user" | "global";
  retryAfterSeconds?: number;
}

export interface ChargeResult {
  allowed: boolean;
  used: number;
  /** limit: today's uses have gone. failed_cap: too many failed attempts today. */
  reason?: "limit" | "failed_cap";
}

/** What one attempt cost. Tokens and estimated money, never content. */
export interface JobUsage {
  calls: number;
  retries: number;
  input: number;
  output: number;
  costMicros: number;
  costComplete: boolean;
  latencyMs: number;
}

export interface JobFinish {
  status: "completed" | "partial" | "failed";
  resultId?: string | null;
  result?: JobResult | null;
  errorCode?: string | null;
  /** Give back the use this job holds. */
  release: boolean;
  /** Count towards the failures that make work rest. A student's quota or input isn't a failure of the work. */
  countFailure: boolean;
  usage: JobUsage;
}
