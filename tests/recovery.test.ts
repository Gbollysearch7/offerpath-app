// OP-025: failure injection on the CV path, through uploadFlow/scoreFlow -> runAnalysisJob -> scoreCv -> callProvider ->
// the real SDK. Only `fetch` is simulated (fixtures/provider-stub.ts).
import { allBest, apiError, capture, hang, message, notJson, outage, provider } from "./fixtures/provider-stub";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { friendlyFailure, MESSAGES, runAnalysisJob } from "@/lib/analysis-job";
import { analysisBudgetMs, ANALYSIS_BUDGET_MS, canMove, JOB_POLICY, JOB_STATES, JOB_TRANSITIONS, MAX_DURATION_SECONDS, WORKFLOWS } from "@/lib/analysis/job-state";
import { AI_JUDGE_CONFIG } from "@/lib/analysis/judgment";
import { pasteFlow, scoreFlow, uploadFlow } from "@/lib/cv-flow";
import { BREAKER_OPEN_MS, BREAKER_THRESHOLD, classifyFailure, estimateCost, MAX_ATTEMPTS, MAX_PARALLEL_CALLS, MIN_RETRY_MS, REQUEST_TIMEOUT_MS, resetProviderState } from "@/lib/provider";
import { demoRepo, type DemoJob } from "@/lib/repo/demo";
import { AI_FAILED_LIMITS, AI_LIMITS, type Repo } from "@/lib/repo/types";
import { AUDIT_CLEAN_CV } from "./fixtures/audit";

type Demo = { users: Record<string, { ai: Record<string, number>; aiFailed?: Record<string, number> }>; jobs?: DemoJob[] };
const g = globalThis as unknown as { __offerpathDemo: Demo; __offerpathJudgments?: Map<string, unknown> };
const bytes = new Uint8Array(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/extraction/single-column.pdf")));
const day = () => new Date().toISOString().slice(0, 10);
const student = () => demoRepo(`student-${crypto.randomUUID()}`, "student");
const upload = (repo: Repo, key = `t-${crypto.randomUUID()}`) => uploadFlow(repo, { bytes, fileName: "single-column.pdf", sector: "Technology", stage: "Final year, graduate roles", key });
const paste = (repo: Repo, marker = crypto.randomUUID()) => pasteFlow(repo, { text: `${AUDIT_CLEAN_CV}\n• Delivered project ${marker} for 12 customers`, original: null, sector: "Technology", stage: "Final year", key: `p-${crypto.randomUUID()}` });
const used = (repo: Repo) => repo.aiUsedToday("cv_score");
const failed = (repo: Repo) => g.__offerpathDemo.users[repo.userId].aiFailed?.[`${day()}:cv_score`] ?? 0;
const cvs = async (repo: Repo) => (await repo.listReports({ type: "cv_review" })).total;
const jobs = (repo: Repo) => (g.__offerpathDemo.jobs ?? []).filter((j) => j.userId === repo.userId);

beforeEach(() => {
  resetProviderState();
  g.__offerpathJudgments?.clear();
  if (g.__offerpathDemo) g.__offerpathDemo.jobs = [];
  provider.calls = 0;
  provider.seen = [];
  delete process.env.ANALYSIS_BUDGET_MS;
});

/** A failed attempt: understandable message, no report, previous results untouched, nothing owed, nothing cached. */
async function assertRecoverableFailure(name: string, reply: typeof outage, opts: { failedCount?: number } = {}) {
  provider.reply = reply;
  const repo = student();
  const before = await cvs(repo);
  const previous = JSON.stringify(await repo.latestReport("cv_review"));
  const r = await upload(repo);
  assert.equal(r.kind, "error", name);
  assert.match((r as { error: string }).error, /couldn't score your CV/, name);
  assert.equal(await cvs(repo), before, `${name}: no report saved`);
  assert.equal(JSON.stringify(await repo.latestReport("cv_review")), previous, `${name}: the previous report survives, byte for byte`);
  assert.equal(await used(repo), 0, `${name}: the use is given back`);
  assert.equal(failed(repo), opts.failedCount ?? 1, `${name}: counted as a failure instead`);
  assert.equal(g.__offerpathJudgments?.size ?? 0, 0, `${name}: nothing published to the shared cache`);
  const [job] = jobs(repo);
  assert.equal(job.status, "failed", name);
  assert.equal(job.charged, false, name);
  // The same version recovers with no new upload, once the provider is back (and any paused calls have resumed).
  resetProviderState();
  provider.reply = allBest;
  const sources = await repo.listSources();
  const again = await scoreFlow(repo, sources[0].id, "Technology", "Final year");
  assert.ok("id" in again, `${name}: retry works: ${JSON.stringify(again)}`);
  assert.equal(await used(repo), 1, `${name}: the retry takes one use`);
  assert.equal(await cvs(repo), before + 1, name);
  assert.equal(jobs(repo).length, 1, `${name}: same job, not a second`);
  assert.equal(jobs(repo)[0].status, "completed", name);
}

test("provider outage (503): no score, bounded calls, use given back, retry recovers", async () => {
  provider.reply = outage;
  const repo = student();
  await upload(repo);
  assert.ok(provider.calls <= AI_JUDGE_CONFIG.votes * MAX_ATTEMPTS, `${provider.calls} calls is more than votes times attempts`);
  assert.ok(provider.calls >= 1);
  resetProviderState();
  await assertRecoverableFailure("outage", outage);
});
test("invalid JSON from the provider recovers the same way", () => assertRecoverableFailure("not json", notJson));
test("schema-breaking output recovers the same way", () => assertRecoverableFailure("schema", ({ model, bullets }) => message(model, JSON.stringify({ judgments: (bullets ?? []).map((b) => ({ id: b.id, result: "excellent", verb: "strong", kind: "achievement", relevance: "high" })) }))));
test("a refusal recovers the same way", () => assertRecoverableFailure("refusal", ({ model }) => message(model, "", "refusal")));
test("cut-off output recovers the same way", () => assertRecoverableFailure("truncated", ({ model }) => message(model, "{", "max_tokens")));
test("an exhausted provider balance recovers the same way, and alerts", async () => {
  const { out } = await capture(() => assertRecoverableFailure("credit", () => apiError(400, "Your credit balance is too low to access the API.")));
  assert.match(out, /alert:ai-budget-exhausted/);
});

test("a hung provider ends inside the budget, with no retry it couldn't finish", async () => {
  process.env.ANALYSIS_BUDGET_MS = "1500";
  const started = Date.now();
  provider.reply = hang;
  const repo = student();
  const r = await upload(repo);
  const took = Date.now() - started;
  assert.equal(r.kind, "error");
  assert.ok(took < 3000, `took ${took}ms`);
  assert.equal(provider.calls, AI_JUDGE_CONFIG.votes, "each vote tried once: a retry needs more time than was left");
  assert.equal(await used(repo), 0);
  assert.equal(jobs(repo)[0].status, "failed");
});

test("the time budget fits Vercel's function limit, and a lease outlasts any server run", () => {
  assert.ok(ANALYSIS_BUDGET_MS + 10_000 <= MAX_DURATION_SECONDS * 1000, "10 seconds left to save the result");
  assert.ok(REQUEST_TIMEOUT_MS <= ANALYSIS_BUDGET_MS);
  assert.ok(REQUEST_TIMEOUT_MS + MIN_RETRY_MS >= ANALYSIS_BUDGET_MS, "after a full timeout no retry can start");
  assert.ok(JOB_POLICY.leaseSeconds > MAX_DURATION_SECONDS, "an expired lease means the run is gone, not slow");
  assert.ok(JOB_POLICY.waitForRunningMs < MAX_DURATION_SECONDS * 1000);
  assert.equal(analysisBudgetMs({ ANALYSIS_BUDGET_MS: "999999" } as unknown as NodeJS.ProcessEnv), ANALYSIS_BUDGET_MS, "configuration can only shorten it");
});

test("every page whose actions can reach the provider declares the function limit", () => {
  const consumers: Record<string, string> = {
    "src/app/upload/page.tsx": "uploadCv, pasteCv, scoreVersion, correctVersion",
    "src/app/reviews/[id]/source/page.tsx": "correctVersion",
    "src/app/reviews/[id]/lines/page.tsx": "rewriteLine",
    "src/app/letters/page.tsx": "createLetterDraft",
    "src/app/letters/[id]/page.tsx": "improveLetter",
    "src/app/tailor/page.tsx": "createTailor",
    "src/app/tailor/[id]/page.tsx": "createTailoredVersion",
  };
  for (const page of Object.keys(consumers)) assert.match(fs.readFileSync(page, "utf8"), new RegExp(`export const maxDuration = ${MAX_DURATION_SECONDS};`), page);
  // And nothing calls the provider outside the wrapper.
  const ai = fs.readFileSync("src/lib/ai.ts", "utf8");
  assert.equal((ai.match(/getClient\(\)\./g) ?? []).length, (ai.match(/callProvider\(\(options\) =>\s+getClient\(\)\./g) ?? []).length);
  assert.match(ai, /maxRetries: 0/, "the SDK's hidden retries are off");
});

test("rate limits: a short Retry-After is honoured and retried; a long one isn't waited for", async () => {
  provider.reply = ({ call, model, bullets, signal }) => (call < AI_JUDGE_CONFIG.votes ? apiError(429, "slow down", { "retry-after": "0" }) : allBest({ call, model, bullets, signal }));
  const repo = student();
  const r = await upload(repo);
  assert.equal(r.kind, "scored", JSON.stringify(r));
  assert.equal(provider.calls, AI_JUDGE_CONFIG.votes * 2, "each vote retried once");

  provider.calls = 0;
  g.__offerpathJudgments?.clear(); // or the second student's bullets are already judged, and nothing is asked
  provider.reply = () => apiError(429, "slow down", { "retry-after": "3600" });
  const other = student();
  assert.equal((await upload(other)).kind, "error");
  assert.equal(provider.calls, AI_JUDGE_CONFIG.votes, "no retry: an hour doesn't fit");
  assert.equal(await used(other), 0);
});

test("a client error isn't retried", async () => {
  provider.reply = () => apiError(400);
  await upload(student());
  assert.equal(provider.calls, AI_JUDGE_CONFIG.votes);
});

test("circuit breaker: after repeated outages the provider isn't called, students aren't charged, and it closes again", async () => {
  provider.reply = outage;
  for (let i = 0; provider.calls < BREAKER_THRESHOLD && i < 5; i++) await upload(student());
  const afterTrip = provider.calls;
  assert.ok(afterTrip >= BREAKER_THRESHOLD);
  const repo = student();
  const started = Date.now();
  const r = await upload(repo);
  assert.equal(r.kind, "error");
  assert.equal(provider.calls, afterTrip, "no call was sent");
  assert.ok(Date.now() - started < 1000, "fails fast instead of making the student wait");
  assert.equal(await used(repo), 0);
  assert.equal(failed(repo), 0, "a call that was never sent doesn't count towards the failure cap");

  const real = Date.now;
  Date.now = () => real() + BREAKER_OPEN_MS + 1;
  try {
    provider.reply = allBest;
    const recovered = student();
    assert.equal((await upload(recovered)).kind, "scored");
    assert.ok(provider.calls > afterTrip);
  } finally {
    Date.now = real;
  }
});

test("repeat clicks: five at once on one version do the work once, take one use, and all get the same report", async () => {
  provider.reply = outage;
  const repo = student();
  await upload(repo);
  const [source] = await repo.listSources();
  const before = await cvs(repo);
  resetProviderState();
  provider.calls = 0;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  provider.reply = async (a) => {
    await gate;
    return allBest(a);
  };
  const clicks = Array.from({ length: 5 }, () => scoreFlow(repo, source.id, "Technology", "Final year"));
  await new Promise((r) => setTimeout(r, 50));
  open();
  const results = await Promise.all(clicks);
  const ids = new Set(results.map((r) => ("id" in r ? r.id : r.error)));
  assert.equal(ids.size, 1, JSON.stringify(results));
  assert.ok([...ids][0]!.length === 36, "a report id, not a message");
  assert.equal(provider.calls, AI_JUDGE_CONFIG.votes, "one attempt's votes");
  assert.equal(await used(repo), 1);
  assert.equal(await cvs(repo), before + 1);
  assert.equal(jobs(repo).length, 1);
});

test("a click after it's finished costs nothing and returns the report", async () => {
  provider.reply = allBest;
  const repo = student();
  const key = `t-${crypto.randomUUID()}`;
  const first = await upload(repo, key);
  const calls = provider.calls;
  const again = await upload(repo, key);
  assert.equal((again as { id: string }).id, (first as { id: string }).id);
  assert.equal(provider.calls, calls);
  assert.equal(await used(repo), 1);
});

test("a repeat that outlives its wait is told it's still going; nothing is called or charged twice", async () => {
  provider.reply = allBest;
  const repo = student();
  const r = await paste(repo);
  const sourceId = (r as { sourceId: string }).sourceId;
  // A held job from another run, still within its lease. The version has no report in this view of it.
  const fresh = await pasteFlow(repo, { text: `${AUDIT_CLEAN_CV}\n• Delivered another thing for 3 teams`, original: null, sector: "Technology", stage: "Final year", key: `p-${crypto.randomUUID()}` });
  assert.ok(sourceId && "id" in fresh);
  provider.reply = hang;
  const held = await uploadHeld(repo);
  const claim = await repo.claimJob({ workflow: "cv_score", key: held, freshSeconds: null });
  assert.equal(claim.outcome, "claimed");
  const real = Date.now;
  let t = real();
  Date.now = () => (t += 5000);
  const calls = provider.calls;
  const before = await used(repo);
  try {
    assert.deepEqual(await scoreFlow(repo, held, "Technology", "Final year"), { error: MESSAGES.stillWorking });
  } finally {
    Date.now = real;
  }
  assert.equal(provider.calls, calls);
  assert.equal(await used(repo), before);
});

/** A version with no report yet: a failed attempt on a new upload, whose job is left failed and free to claim. */
async function uploadHeld(repo: Repo): Promise<string> {
  const reply = provider.reply;
  provider.reply = () => apiError(400);
  const r = await upload(repo);
  provider.reply = reply;
  assert.equal(r.kind, "error");
  return (await repo.listSources()).find((s) => s.fileName === "single-column.pdf" && !s.reportId)!.id;
}

test("orphaned work: a run killed at the function limit is settled by the next request, its use given back once", async () => {
  const repo = student();
  const source = await uploadHeld(repo);
  const claim = await repo.claimJob({ workflow: "cv_score", key: source, freshSeconds: null });
  assert.equal(claim.outcome, "claimed");
  const charge = await repo.chargeJob({ id: claim.job.id, attempt: claim.job.attempts }, "cv_score", AI_LIMITS.cv_score, AI_FAILED_LIMITS.cv_score);
  assert.equal(charge.used, 1, "the run reserved a use, and then its server died");
  const job = jobs(repo).find((j) => j.id === claim.job.id)!;
  job.leaseExpiresAt = Date.now() - 1;

  provider.reply = allBest;
  const r = await scoreFlow(repo, source, "Technology", "Final year");
  assert.ok("id" in r, JSON.stringify(r));
  assert.equal(await used(repo), 1, "given back, then taken once by the run that finished");
  assert.equal(job.status, "completed");
  assert.equal(job.failures, 2, "the provider failure and the killed run are both on record");
});

test("a run whose server died can't finish a job another run has taken over", async () => {
  const repo = student();
  const source = await uploadHeld(repo);
  const first = await repo.claimJob({ workflow: "cv_score", key: source, freshSeconds: null });
  jobs(repo).find((j) => j.id === first.job.id)!.leaseExpiresAt = Date.now() - 1;
  const second = await repo.claimJob({ workflow: "cv_score", key: source, freshSeconds: null });
  assert.equal(second.outcome, "claimed");
  const usage = { calls: 0, retries: 0, input: 0, output: 0, costMicros: 0, costComplete: true, latencyMs: 1 };
  assert.equal(await repo.finishJob({ id: first.job.id, attempt: first.job.attempts }, { status: "completed", release: false, countFailure: false, usage }), false);
  assert.equal(await repo.finishJob({ id: second.job.id, attempt: second.job.attempts }, { status: "completed", release: false, countFailure: false, usage }), true);
});

test("concurrency: past a student's limit the request isn't started or charged, and the same retry then runs", async () => {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  provider.reply = async (a) => {
    await gate;
    return allBest(a);
  };
  const repo = student();
  const running = Array.from({ length: JOB_POLICY.maxActivePerUser }, () => paste(repo));
  await new Promise((r) => setTimeout(r, 300));
  const before = await used(repo);
  const over = await paste(repo);
  assert.deepEqual(over, { error: MESSAGES.busyYou });
  assert.equal(await used(repo), before, "nothing charged");
  const queued = jobs(repo).filter((j) => j.status === "queued");
  assert.equal(queued.length, 1, "the state says so");
  open();
  for (const r of await Promise.all(running)) assert.ok("id" in r, JSON.stringify(r));
  const retry = await scoreFlow(repo, queued[0].key, "Technology", "Final year");
  assert.ok("id" in retry, JSON.stringify(retry));
  assert.equal(queued[0].status, "completed");
});

test("concurrency: at the limit across all students, a student is told to wait, without provider details", async () => {
  provider.reply = allBest;
  const others = Array.from({ length: JOB_POLICY.maxActiveGlobal }, (_, i): DemoJob => ({ id: `other-${i}`, userId: `someone-${i}`, key: "k", workflow: "cv_score", status: "processing", attempts: 1, failures: 0, consecutiveFailures: 0, resultId: null, result: null, errorCode: null, charged: false, finishedAt: null, createdAt: "", leaseExpiresAt: Date.now() + 60_000, chargedKey: null, updatedAt: Date.now(), finishedMs: null }));
  const repo = student();
  await repo.profile();
  (g.__offerpathDemo.jobs ??= []).push(...others);
  const calls = provider.calls;
  assert.deepEqual(await paste(repo), { error: MESSAGES.busyAll });
  assert.equal(provider.calls, calls);
});

test("in-flight calls per instance are capped: a very long CV's chunks queue instead of all leaving at once", async () => {
  let active = 0;
  let peak = 0;
  provider.reply = async (a) => {
    peak = Math.max(peak, ++active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return allBest(a);
  };
  const many = Array.from({ length: 120 }, (_, i) => `• Delivered project number ${i} for ${i + 1} customers in the region`).join("\n");
  const r = await pasteFlow(student(), { text: `${AUDIT_CLEAN_CV}\n${many}`, original: null, sector: "Technology", stage: "Final year", key: `p-${crypto.randomUUID()}` });
  assert.ok("id" in r, JSON.stringify(r));
  assert.ok(provider.calls > MAX_PARALLEL_CALLS, `${provider.calls} calls`);
  assert.ok(peak <= MAX_PARALLEL_CALLS, `peak ${peak}`);
});

test("bounded retries of one piece of work: after three failures in a row it rests, then can run again", async () => {
  provider.reply = outage;
  const repo = student();
  await upload(repo);
  const [source] = await repo.listSources();
  for (let i = 0; i < JOB_POLICY.maxConsecutiveFailures - 1; i++) {
    resetProviderState();
    await scoreFlow(repo, source.id, "Technology", "Final year");
  }
  resetProviderState();
  const calls = provider.calls;
  assert.deepEqual(await scoreFlow(repo, source.id, "Technology", "Final year"), { error: MESSAGES.rest });
  assert.equal(provider.calls, calls, "resting: not called");
  assert.equal(await used(repo), 0, "no quota was ever spent");

  jobs(repo)[0].finishedMs = Date.now() - JOB_POLICY.cooldownSeconds * 1000 - 1;
  provider.reply = allBest;
  assert.ok("id" in (await scoreFlow(repo, source.id, "Technology", "Final year")));
  assert.equal(jobs(repo)[0].consecutiveFailures, 0);
});

test("quota: at the limit the provider isn't called, the message is plain, and the count doesn't climb", async () => {
  provider.reply = allBest;
  const repo = student();
  await repo.profile();
  g.__offerpathDemo.users[repo.userId].ai[`${day()}:cv_score`] = AI_LIMITS.cv_score;
  const calls = provider.calls;
  assert.deepEqual(await paste(repo), { error: `You've scored ${AI_LIMITS.cv_score} CVs today. You can score more tomorrow.` });
  assert.equal(provider.calls, calls);
  assert.equal(await used(repo), AI_LIMITS.cv_score);
  assert.equal(jobs(repo)[0].errorCode, "quota");
  assert.equal(jobs(repo)[0].consecutiveFailures, 0, "hitting a limit isn't a failure of the work");
});

test("quota: failed attempts don't spend it, however many; a student who failed all day can still score", async () => {
  provider.reply = () => apiError(400);
  const repo = student();
  for (let i = 0; i < 3; i++) await paste(repo);
  assert.equal(await used(repo), 0);
  assert.equal(failed(repo), 3);
  provider.reply = allBest;
  assert.ok("id" in (await paste(repo)));
  assert.equal(await used(repo), 1);
});

test("quota: failures have their own cap, so an outage can't spend without limit", async () => {
  provider.reply = allBest;
  const repo = student();
  await repo.profile();
  (g.__offerpathDemo.users[repo.userId].aiFailed ??= {})[`${day()}:cv_score`] = AI_FAILED_LIMITS.cv_score;
  const calls = provider.calls;
  assert.deepEqual(await paste(repo), { error: MESSAGES.failedCap });
  assert.equal(provider.calls, calls);
  assert.equal(await used(repo), 0);
  assert.equal(jobs(repo)[0].errorCode, "failed_cap");
});

test("session expiry during a run: an understandable message, the use back, and a retry that doesn't pay again", async () => {
  provider.reply = allBest;
  const repo = student();
  const before = await cvs(repo);
  const create = repo.createReport;
  repo.createReport = (async () => {
    throw Object.assign(new Error("JWT expired"), { code: "PGRST301" });
  }) as Repo["createReport"];
  const r = await upload(repo);
  assert.deepEqual(r, { kind: "error", error: MESSAGES.expired });
  assert.equal(await used(repo), 0, "the use is back");
  assert.equal(failed(repo), 1, "the provider was called");
  assert.equal(jobs(repo)[0].errorCode, "session_expired");
  assert.equal(jobs(repo)[0].consecutiveFailures, 0, "an expired session isn't a failure of the work");

  repo.createReport = create;
  const paid = provider.calls;
  const [source] = await repo.listSources();
  const again = await scoreFlow(repo, source.id, "Technology", "Final year");
  assert.ok("id" in again, JSON.stringify(again));
  assert.equal(provider.calls, paid, "the verdicts were published: nothing is judged twice");
  assert.equal(await used(repo), 1);
  assert.equal(await cvs(repo), before + 1);
});

test("a save that fails after scoring: no report, the use back, and a retry that doesn't pay again", async () => {
  provider.reply = allBest;
  const repo = student();
  const create = repo.createReport;
  repo.createReport = (async () => {
    throw new Error("database down");
  }) as Repo["createReport"];
  const { out } = await capture(() => assert.rejects(upload(repo), /database down/));
  assert.match(out, /analysis-job-failed/);
  assert.equal(await used(repo), 0, "the job recorded it and gave the use back before rethrowing");
  assert.equal(jobs(repo)[0].status, "failed");
  // What the action then says: a message with no detail of the fault.
  const said = await friendlyFailure<{ error?: string }>(() => Promise.reject(new Error("database down at 10.0.0.1")), (error) => ({ error }));
  assert.deepEqual(said, { error: MESSAGES.generic });
  assert.deepEqual(await friendlyFailure<{ error?: string }>(() => Promise.reject(Object.assign(new Error("x"), { code: "PGRST303" })), (error) => ({ error })), { error: MESSAGES.expired });
  repo.createReport = create;
  const paid = provider.calls;
  const [source] = await repo.listSources();
  assert.ok("id" in (await scoreFlow(repo, source.id, "Technology", "Final year")));
  assert.equal(provider.calls, paid);
});

test("job tracking unavailable (a migration not yet applied): the analysis still runs, one report per version, and an alert fires", async () => {
  provider.reply = allBest;
  const repo = student();
  repo.claimJob = (async () => {
    throw new Error('Could not find the function public.claim_analysis_job');
  }) as Repo["claimJob"];
  const before = await cvs(repo);
  const { value: r, out } = await capture(() => upload(repo));
  assert.equal(r.kind, "scored");
  assert.equal(await cvs(repo), before + 1);
  assert.equal(await used(repo), 1, "quota still applies, through the older counter");
  assert.match(out, /alert:analysis-jobs-unavailable/);
});

test("logs and job records carry no CV text and no secret, including when provider output or errors quote the CV", async () => {
  const canary = "Zanzibar-Quokka-CV-line-that-must-never-be-logged";
  const text = `${AUDIT_CLEAN_CV}\n• ${canary} for 40 customers`;
  const repo = student();
  for (const reply of [
    () => apiError(500, `simulated failure quoting ${canary}`),
    () => apiError(400, `simulated failure quoting ${canary}`),
    ({ model }: { model: string }) => message(model, `not json: ${canary}`),
    ({ model }: { model: string }) => message(model, JSON.stringify({ judgments: [{ id: 0, result: canary, verb: "strong", kind: "achievement", relevance: "high" }] })),
  ]) {
    provider.reply = reply as typeof outage;
    resetProviderState();
    const { out, value } = await capture(() => pasteFlow(repo, { text, original: null, sector: "Technology", stage: "Final year", key: `p-${crypto.randomUUID()}` }));
    assert.ok("error" in value, JSON.stringify(value));
    assert.match(out, /"event":"analysis-job"/);
    assert.ok(!out.includes(canary), out);
    assert.ok(!out.includes("test-key-never-sent"), out);
    assert.ok(!JSON.stringify(value).includes(canary));
  }
  assert.ok(provider.seen.some((s) => s.includes(canary)), "the canary really did go through the path");
  assert.ok(!JSON.stringify(jobs(repo)).includes(canary));
});

test("latency, calls and cost per attempt are logged, and only as counts", async () => {
  provider.reply = allBest;
  const { out } = await capture(() => paste(student()));
  const event = out.split("\n").map((l) => JSON.parse(l)).find((l) => l.event === "analysis-job");
  assert.equal(event.status, "completed");
  assert.equal(event.calls, AI_JUDGE_CONFIG.votes);
  assert.equal(event.inputUnits, 3000);
  assert.equal(event.outputUnits, 300);
  // 3 calls of 1000 in and 100 out at $0.10 and $0.50 per million tokens.
  assert.equal(event.costMicros, 450);
  assert.equal(event.costComplete, true);
  assert.ok(event.ms >= 0);
  assert.deepEqual(event.failures, {});
});

test("cost: failed votes that were billed count, and unknown prices say so", () => {
  assert.deepEqual(estimateCost("claude-haiku-5-5", { input_tokens: 1000, output_tokens: 100 }), { micros: 150, complete: true });
  assert.deepEqual(estimateCost("claude-opus-5-5", { input_tokens: 1000, output_tokens: 100 }), { micros: 6000, complete: true });
  assert.deepEqual(estimateCost("claude-haiku-5-5", { input_tokens: 200_000, output_tokens: 0 }), { micros: 100_000, complete: true });
  assert.deepEqual(estimateCost("some-other-model", { input_tokens: 1000, output_tokens: 100 }), { micros: 0, complete: false });
  assert.equal(estimateCost("claude-opus-5-5", { input_tokens: 1, output_tokens: 1, iterations: [{ type: "fallback_message" }] }).complete, false);
  assert.equal(estimateCost("claude-opus-5-5", { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 5 }).complete, false);
  assert.equal(classifyFailure(new TypeError("x")), "unknown");
});

test("states: only the allowed moves exist, and the database knows the same names", () => {
  assert.deepEqual([...JOB_STATES], ["queued", "processing", "completed", "partial", "failed"]);
  assert.ok(canMove("queued", "processing") && canMove("processing", "partial") && canMove("failed", "processing"));
  assert.ok(!canMove("completed", "processing") && !canMove("partial", "failed") && !canMove("queued", "completed") && !canMove("failed", "completed"));
  for (const from of JOB_STATES) for (const to of JOB_TRANSITIONS[from]) assert.ok(JOB_STATES.includes(to));
  const sql = fs.readFileSync("supabase/migrations/20261107180000_analysis_jobs.sql", "utf8");
  for (const s of JOB_STATES) assert.ok(sql.includes(`'${s}'`), s);
  for (const w of WORKFLOWS) assert.ok(sql.includes(`'${w}'`), w);
});

test("a retried attempt scores the same as an untroubled one: recovery can't move a number", async () => {
  provider.reply = allBest;
  const a = student();
  const clean = await upload(a);
  const cleanReport = await a.getReport<{ analysis: { score: number; meta: { scoring: { coreFingerprint: string } } } }>((clean as { id: string }).id);

  g.__offerpathJudgments?.clear();
  provider.reply = outage;
  const b = student();
  await upload(b);
  resetProviderState();
  provider.reply = allBest;
  const [source] = await b.listSources();
  const retried = await scoreFlow(b, source.id, "Technology", "Final year");
  const retriedReport = await b.getReport<typeof cleanReport extends infer R ? (R extends { payload: infer P } ? P : never) : never>((retried as { id: string }).id);
  assert.equal(retriedReport!.row.score, cleanReport!.row.score);
  assert.equal(retriedReport!.payload.analysis.meta.scoring.coreFingerprint, cleanReport!.payload.analysis.meta.scoring.coreFingerprint);
});

test("runAnalysisJob: what a job can record is a code and a boolean, so no text has anywhere to go", async () => {
  const repo = student();
  const r = await runAnalysisJob<{ ok?: boolean; error?: string }>(repo, { workflow: "letter_review", key: "unit", freshSeconds: null, replay: async () => null, refuse: (error) => ({ error }) }, async () => ({ status: "completed", value: { ok: true }, result: { ai: false } }));
  assert.deepEqual(r, { ok: true });
  const keys = Object.keys(jobs(repo)[0]).sort();
  assert.ok(!keys.some((k) => /text|content|payload|prompt|message/i.test(k)), keys.join());
});
