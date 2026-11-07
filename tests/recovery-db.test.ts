// OP-025: one contract, two implementations: the demo repository, and the Supabase repository calling the real SQL
// functions from the migration in PGlite (one connection, so concurrency here is sequential: see the report).
import "./fixtures/provider-stub";
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { JOB_POLICY } from "@/lib/analysis/job-state";
import { runAnalysisHousekeeping, workflowsToAlert, type WorkflowMetrics } from "@/lib/analysis-metrics";
import { demoRepo, type DemoJob } from "@/lib/repo/demo";
import { supabaseRepo } from "@/lib/repo/supabase";
import type { Repo } from "@/lib/repo/types";

const db = new PGlite();
before(async () => {
  await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema storage; create schema extensions;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb, email_confirmed_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security; grant select, insert, delete on storage.objects to authenticated;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  grant execute on function storage.foldername(text) to authenticated;
`);
  for (const f of fs.readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql")).sort()) await db.exec(fs.readFileSync(path.join("supabase/migrations", f), "utf8"));
  await db.exec(fs.readFileSync("supabase/seed.sql", "utf8"));
});

/** PostgREST's `rpc`, as far as the repository needs it: named arguments in, one value or a set of rows out. */
const admin = {
  async rpc(name: string, args: Record<string, unknown>) {
    const keys = Object.keys(args);
    const call = `public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
    const params = keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
    try {
      if (name === "analysis_metrics") return { data: (await db.query(`select * from ${call}`, params)).rows, error: null };
      return { data: ((await db.query(`select ${call} as r`, params)).rows[0] as { r: unknown }).r, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message, code: (e as { code?: string }).code } };
    }
  },
} as unknown as SupabaseClient;

const g = globalThis as unknown as { __offerpathDemo: { users: Record<string, { ai: Record<string, number>; aiFailed?: Record<string, number> }>; jobs?: DemoJob[] } };
const day = () => new Date().toISOString().slice(0, 10);
const newUser = async () => (await db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [`job.${crypto.randomUUID().slice(0, 8)}@northfield.ac.uk`])).rows[0].id;

interface Backend {
  name: string;
  repo: Repo;
  /** [count, failed] in today's usage for one kind. */
  usage(): Promise<[number, number]>;
  /** Moves a job's clock back: its lease expires, and it finished this long ago. */
  age(id: string, seconds: number): Promise<void>;
  reportId(): Promise<string>;
  rows(): Promise<number>;
  crowd(n: number): Promise<() => Promise<void>>;
}

const backends: (() => Promise<Backend>)[] = [
  async () => {
    const repo = demoRepo(`student-${crypto.randomUUID()}`, "student");
    await repo.profile();
    return {
      name: "demo",
      repo,
      usage: async () => [g.__offerpathDemo.users[repo.userId].ai[`${day()}:cv_score`] ?? 0, g.__offerpathDemo.users[repo.userId].aiFailed?.[`${day()}:cv_score`] ?? 0],
      age: async (id, seconds) => {
        const j = g.__offerpathDemo.jobs!.find((x) => x.id === id)!;
        if (j.leaseExpiresAt) j.leaseExpiresAt = Date.now() - seconds * 1000;
        if (j.finishedMs) j.finishedMs = Date.now() - seconds * 1000;
      },
      reportId: async () => (await repo.latestReport("cv_review"))!.row.id,
      rows: async () => g.__offerpathDemo.jobs!.filter((j) => j.userId === repo.userId).length,
      crowd: async (n) => {
        const fake = Array.from({ length: n }, (_, i): DemoJob => ({ id: `crowd-${i}`, userId: "crowd", key: `${i}`, workflow: "cv_score", status: "processing", attempts: 1, failures: 0, consecutiveFailures: 0, resultId: null, result: null, errorCode: null, charged: false, finishedAt: null, createdAt: "", leaseExpiresAt: Date.now() + 60_000, chargedKey: null, updatedAt: Date.now(), finishedMs: null }));
        g.__offerpathDemo.jobs!.push(...fake);
        return async () => {
          g.__offerpathDemo.jobs = g.__offerpathDemo.jobs!.filter((j) => j.userId !== "crowd");
        };
      },
    };
  },
  async () => {
    const id = await newUser();
    const repo = supabaseRepo(null as unknown as SupabaseClient, id, () => admin);
    return {
      name: "supabase",
      repo,
      usage: async () => {
        const r = (await db.query<{ count: number; failed: number }>(`select count, failed from public.ai_usage where user_id = $1 and kind = 'cv_score' and day = current_date`, [id])).rows[0];
        return [r?.count ?? 0, r?.failed ?? 0];
      },
      age: async (job, seconds) => {
        await db.query(`update public.analysis_jobs set lease_expires_at = case when lease_expires_at is null then null else now() - make_interval(secs => $2) end, finished_at = case when finished_at is null then null else now() - make_interval(secs => $2) end where id = $1`, [job, seconds]);
      },
      reportId: async () => (await db.query<{ id: string }>(`insert into public.reports (user_id, type, title, score, payload) values ($1, 'cover_letter', 't', 1, '{}') returning id`, [id])).rows[0].id,
      rows: async () => (await db.query<{ n: number }>(`select count(*)::int as n from public.analysis_jobs where user_id = $1`, [id])).rows[0].n,
      crowd: async (n) => {
        const crowd = await newUser();
        await db.query(`insert into public.analysis_jobs (user_id, workflow, idempotency_key, status, attempts, lease_expires_at) select $1, 'cv_score', 'crowd-' || i, 'processing', 1, now() + interval '60 seconds' from generate_series(1, $2::int) i`, [crowd, n]);
        return async () => void (await db.query(`delete from public.analysis_jobs where user_id = $1`, [crowd]));
      },
    };
  },
];

const usage = { calls: 1, retries: 0, input: 10, output: 5, costMicros: 7, costComplete: true, latencyMs: 12 };
const noCalls = { ...usage, calls: 0 };
const claim = (repo: Repo, key: string, freshSeconds: number | null = null) => repo.claimJob({ workflow: "cv_score", key, freshSeconds });
const held = (c: { job: { id: string; attempts: number } }) => ({ id: c.job.id, attempt: c.job.attempts });
const charge = (repo: Repo, c: { job: { id: string; attempts: number } }, limit = 20, failedLimit = 20) => repo.chargeJob(held(c), "cv_score", limit, failedLimit);

for (const [i, make] of backends.entries()) {
  const named = (s: string) => `${["demo", "supabase"][i]}: ${s}`;

  test(named("claim, repeat, finish, replay"), async () => {
    const { repo } = await make();
    const first = await claim(repo, "replay-1");
    assert.equal(first.outcome, "claimed");
    assert.equal(first.job.status, "processing");
    assert.equal(first.job.attempts, 1);
    const second = await claim(repo, "replay-1");
    assert.equal(second.outcome, "in_progress");
    assert.equal(second.job.id, first.job.id);
    const me = await make();
    assert.equal((await claim(me.repo, "replay-1")).outcome, "claimed", "keys are per student");
  });

  test(named("a finished job answers a repeat, with its result"), async () => {
    const x = await make();
    const c = await claim(x.repo, "replay-2");
    const reportId = await x.reportId();
    assert.equal(await x.repo.finishJob(held(c), { status: "completed", resultId: reportId, result: { ai: true }, release: false, countFailure: false, usage }), true);
    const again = await claim(x.repo, "replay-2");
    assert.equal(again.outcome, "replay");
    assert.equal(again.job.resultId, reportId);
    assert.deepEqual(again.job.result, { ai: true });
    assert.equal(again.job.status, "completed");
    const read = await x.repo.getJob(c.job.id);
    assert.equal(read!.status, "completed");
  });

  test(named("within the repeat window it's a repeat; after it, a new job, and the old row stays on record"), async () => {
    const x = await make();
    const c = await claim(x.repo, "fresh-1", JOB_POLICY.repeatWindowSeconds);
    await x.repo.finishJob(held(c), { status: "partial", release: false, countFailure: false, usage });
    assert.equal((await claim(x.repo, "fresh-1", JOB_POLICY.repeatWindowSeconds)).outcome, "replay");
    await x.age(c.job.id, JOB_POLICY.repeatWindowSeconds + 1);
    const next = await claim(x.repo, "fresh-1", JOB_POLICY.repeatWindowSeconds);
    assert.equal(next.outcome, "claimed");
    assert.notEqual(next.job.id, c.job.id);
    assert.equal(await x.rows(), 2);
  });

  test(named("charging is once per job, and failing gives it back once"), async () => {
    const x = await make();
    const c = await claim(x.repo, "charge-1");
    assert.deepEqual(await charge(x.repo, c), { allowed: true, used: 1 });
    assert.equal((await charge(x.repo, c)).used, 1, "asked twice, taken once");
    assert.deepEqual(await x.usage(), [1, 0]);
    assert.equal((await x.repo.getJob(c.job.id))!.charged, true);
    assert.equal(await x.repo.finishJob(held(c), { status: "failed", errorCode: "provider", release: true, countFailure: true, usage }), true);
    assert.deepEqual(await x.usage(), [0, 1]);
    assert.equal(await x.repo.finishJob(held(c), { status: "failed", errorCode: "provider", release: true, countFailure: true, usage }), false, "already over");
    assert.deepEqual(await x.usage(), [0, 1], "no second refund");
  });

  test(named("completed work keeps its use; a failure before any provider call doesn't count towards the cap"), async () => {
    const x = await make();
    const c = await claim(x.repo, "charge-2");
    await charge(x.repo, c);
    await x.repo.finishJob(held(c), { status: "completed", release: false, countFailure: false, usage });
    assert.deepEqual(await x.usage(), [1, 0]);
    const d = await claim(x.repo, "charge-3");
    await charge(x.repo, d);
    await x.repo.finishJob(held(d), { status: "failed", errorCode: "internal", release: true, countFailure: true, usage: noCalls });
    assert.deepEqual(await x.usage(), [1, 0]);
    const e = await claim(x.repo, "charge-4");
    await charge(x.repo, e);
    await x.repo.finishJob(held(e), { status: "partial", errorCode: "provider", release: true, countFailure: false, usage });
    assert.deepEqual(await x.usage(), [1, 1], "a rule-based fallback isn't what was asked for: the use goes back");
  });

  test(named("a limit refuses without climbing, and the failure cap refuses separately"), async () => {
    const x = await make();
    const a = await claim(x.repo, "limit-1");
    assert.equal((await charge(x.repo, a, 1)).allowed, true);
    const c = await claim(x.repo, "limit-2");
    assert.deepEqual(await charge(x.repo, c, 1), { allowed: false, reason: "limit", used: 1 });
    assert.deepEqual(await x.usage(), [1, 0]);
    await x.repo.finishJob(held(c), { status: "failed", errorCode: "quota", release: false, countFailure: false, usage: noCalls });
    assert.equal((await x.repo.getJob(c.job.id))!.consecutiveFailures, 0);

    const y = await make();
    const f = await claim(y.repo, "cap-1");
    await charge(y.repo, f);
    await y.repo.finishJob(held(f), { status: "failed", errorCode: "provider", release: true, countFailure: true, usage });
    const again = await claim(y.repo, "cap-2");
    assert.deepEqual(await charge(y.repo, again, 20, 1), { allowed: false, reason: "failed_cap", used: 0 });
  });

  test(named("an attempt that no longer holds the job can't charge or finish it"), async () => {
    const x = await make();
    const c = await claim(x.repo, "fence-1");
    await x.repo.finishJob(held(c), { status: "failed", release: true, countFailure: true, usage });
    const next = await claim(x.repo, "fence-1");
    assert.equal(next.job.attempts, 2);
    assert.equal(await x.repo.finishJob(held(c), { status: "completed", release: false, countFailure: false, usage }), false);
    await assert.rejects(charge(x.repo, c));
    assert.equal((await x.repo.getJob(c.job.id))!.status, "processing");
    await assert.rejects(x.repo.chargeJob({ id: c.job.id, attempt: 2 }, "cv_score", 0, 0).then((r) => assert.ok(r.allowed)), "limit of 0 refuses");
  });

  test(named("an expired lease is settled on the next request: failed, and its use back, once"), async () => {
    const x = await make();
    const c = await claim(x.repo, "lease-1");
    await charge(x.repo, c);
    await x.age(c.job.id, 1);
    const next = await claim(x.repo, "lease-1");
    assert.equal(next.outcome, "claimed");
    assert.equal(next.job.attempts, 2);
    assert.equal(next.job.failures, 1);
    assert.equal(next.job.charged, false);
    assert.deepEqual(await x.usage(), [0, 1]);
    assert.deepEqual(await charge(x.repo, next), { allowed: true, used: 1 });
    await x.repo.finishJob(held(next), { status: "completed", release: false, countFailure: false, usage });
    assert.deepEqual(await x.usage(), [1, 1], "one use, for the run that finished");
  });

  test(named("an expired lease on other work is settled too, when anything is asked"), async () => {
    const x = await make();
    const c = await claim(x.repo, "lease-2");
    await charge(x.repo, c);
    await x.age(c.job.id, 1);
    await claim(x.repo, "lease-3");
    assert.deepEqual(await x.usage(), [0, 1]);
    const job = await x.repo.getJob(c.job.id);
    assert.equal(job!.status, "failed");
    assert.equal(job!.errorCode, "abandoned");
  });

  test(named("at a student's limit a job waits in queued, and the same key then runs"), async () => {
    const x = await make();
    const running = [];
    for (let i = 0; i < JOB_POLICY.maxActivePerUser; i++) running.push(await claim(x.repo, `busy-${i}`));
    assert.ok(running.every((r) => r.outcome === "claimed"));
    const over = await claim(x.repo, "busy-over");
    assert.equal(over.outcome, "busy");
    assert.equal(over.scope, "user");
    assert.equal(over.job.status, "queued");
    assert.equal(over.job.attempts, 0);
    await x.repo.finishJob(held(running[0]), { status: "completed", release: false, countFailure: false, usage });
    const retry = await claim(x.repo, "busy-over");
    assert.equal(retry.outcome, "claimed");
    assert.equal(retry.job.id, over.job.id);
    assert.equal(retry.job.attempts, 1);
  });

  test(named("at the limit across students, the scope says so"), async () => {
    const x = await make();
    const undo = await x.crowd(JOB_POLICY.maxActiveGlobal);
    try {
      const c = await claim(x.repo, "global-1");
      assert.equal(c.outcome, "busy");
      assert.equal(c.scope, "global");
    } finally {
      await undo();
    }
    assert.equal((await claim(x.repo, "global-1")).outcome, "claimed");
  });

  test(named("three failures in a row rest the work; afterwards it can run; a success clears the count"), async () => {
    const x = await make();
    let c = await claim(x.repo, "rest-1");
    for (let i = 0; i < JOB_POLICY.maxConsecutiveFailures; i++) {
      assert.equal(c.outcome, "claimed", `failure ${i}`);
      await x.repo.finishJob(held(c), { status: "failed", errorCode: "provider", release: true, countFailure: true, usage });
      c = await claim(x.repo, "rest-1");
    }
    assert.equal(c.outcome, "cooling_down");
    assert.ok(c.retryAfterSeconds! > 0 && c.retryAfterSeconds! <= JOB_POLICY.cooldownSeconds, String(c.retryAfterSeconds));
    await x.age(c.job.id, JOB_POLICY.cooldownSeconds + 1);
    const back = await claim(x.repo, "rest-1");
    assert.equal(back.outcome, "claimed");
    await x.repo.finishJob(held(back), { status: "completed", release: false, countFailure: false, usage });
    const done = await x.repo.getJob(back.job.id);
    assert.equal(done!.consecutiveFailures, 0);
    assert.equal(done!.failures, 3);
  });

  test(named("another student's job can't be read or ended"), async () => {
    const x = await make();
    const y = await make();
    const c = await claim(x.repo, "mine-1");
    assert.equal(await y.repo.getJob(c.job.id), null);
    assert.equal(await y.repo.finishJob(held(c), { status: "completed", release: false, countFailure: false, usage }), false);
    await assert.rejects(y.repo.chargeJob(held(c), "cv_score", 20, 20));
    assert.equal((await x.repo.getJob(c.job.id))!.status, "processing");
  });
}

test("metrics: latency, error rate and cost per completed workflow, with failed attempts' cost spread over what finished", async () => {
  await db.exec(`delete from public.analysis_jobs`);
  const id = await newUser();
  const repo = supabaseRepo(null as unknown as SupabaseClient, id, () => admin);
  const u = (costMicros: number, latencyMs: number, calls = 3) => ({ calls, retries: 1, input: 100, output: 10, costMicros, costComplete: true, latencyMs });
  // One job fails then completes; one completes; one is partial; one fails for good; one is refused by quota; one still runs.
  const a = await claim(repo, "m-a");
  await repo.finishJob(held(a), { status: "failed", errorCode: "provider", release: true, countFailure: true, usage: u(100, 1000) });
  const a2 = await claim(repo, "m-a");
  await repo.finishJob(held(a2), { status: "completed", release: false, countFailure: false, usage: u(300, 2000) });
  const b = await claim(repo, "m-b");
  await repo.finishJob(held(b), { status: "completed", release: false, countFailure: false, usage: u(300, 4000) });
  const c = await claim(repo, "m-c");
  await repo.finishJob(held(c), { status: "partial", errorCode: "provider", release: true, countFailure: false, usage: u(0, 6000) });
  const d = await claim(repo, "m-d");
  await repo.finishJob(held(d), { status: "failed", errorCode: "provider", release: true, countFailure: true, usage: u(200, 50_000) });
  const e = await claim(repo, "m-e");
  await repo.finishJob(held(e), { status: "failed", errorCode: "quota", release: false, countFailure: false, usage: u(0, 5, 0) });
  await claim(repo, "m-f");

  const out = (await runAnalysisHousekeeping(() => admin)) as { metrics: WorkflowMetrics[] };
  assert.equal(out.metrics.length, 1);
  const m = out.metrics[0];
  assert.equal(m.workflow, "cv_score");
  assert.equal(m.jobs, 6);
  assert.equal(m.completed, 2);
  assert.equal(m.partial, 1);
  assert.equal(m.failed, 1, "a quota refusal isn't a failure");
  assert.equal(m.refused, 1);
  assert.equal(m.in_flight, 1);
  assert.equal(m.attempts, 7);
  assert.equal(m.failures, 2);
  assert.equal(m.error_rate, 0.2857);
  assert.equal(m.p50_ms, 4000, "of the workflows that finished: 2000, 4000, 6000");
  assert.equal(m.p95_ms, 5800);
  assert.equal(m.provider_calls, 15);
  assert.equal(m.provider_retries, 6);
  assert.equal(m.input_tokens, 600);
  assert.equal(m.output_tokens, 60);
  assert.equal(m.cost_micros, 900);
  assert.equal(m.cost_per_completed_micros, 300, "900 across 3 finished: the failures are paid for by what finished");
  assert.equal(m.cost_incomplete_jobs, 0);
});

test("housekeeping settles orphans across every student, purges old rows, and alerts only on a meaningful failure rate", async () => {
  await db.exec(`delete from public.analysis_jobs`);
  const id = await newUser();
  const repo = supabaseRepo(null as unknown as SupabaseClient, id, () => admin);
  const c = await claim(repo, "h-1");
  await charge(repo, c);
  const old = await claim(repo, "h-2");
  await repo.finishJob(held(old), { status: "completed", release: false, countFailure: false, usage });
  await db.query(`update public.analysis_jobs set updated_at = now() - make_interval(days => $2) where id = $1`, [old.job.id, JOB_POLICY.retainDays + 1]);
  const stale = await claim(repo, "h-3");
  await repo.finishJob(held(stale), { status: "failed", release: true, countFailure: true, usage });
  await db.query(`update public.analysis_jobs set status = 'queued', updated_at = now() - make_interval(secs => $2) where id = $1`, [stale.job.id, JOB_POLICY.queuedExpirySeconds + 1]);
  // Last, or the claims above would settle it themselves: each one sweeps the student's own work.
  await db.query(`update public.analysis_jobs set lease_expires_at = now() - interval '1 second' where id = $1`, [c.job.id]);

  const out = (await runAnalysisHousekeeping(() => admin)) as { sweep: { abandoned: number; expired: number; purged: number } };
  assert.deepEqual(out.sweep, { abandoned: 1, expired: 1, purged: 1 });
  assert.equal((await repo.getJob(c.job.id))!.status, "failed");
  const row = (await db.query<{ count: number; failed: number }>(`select count, failed from public.ai_usage where user_id = $1 and kind = 'cv_score' and day = current_date`, [id])).rows[0];
  assert.deepEqual([row.count, row.failed], [0, 1]);
  assert.equal(await repo.getJob(old.job.id), null, "purged after the retention period");

  const m = (attempts: number, rate: number) => ({ workflow: "x", attempts, error_rate: rate }) as WorkflowMetrics;
  assert.equal(workflowsToAlert([m(5, 1), m(100, 0.1)]).length, 0);
  assert.equal(workflowsToAlert([m(20, 0.2)]).length, 1);
});

test("housekeeping does nothing in demo mode, where there's no database", async () => {
  assert.deepEqual(await runAnalysisHousekeeping(), { skipped: "demo mode" });
});
