-- Recoverable, observable analysis (OP-025).
--
-- NOT APPLIED to any live database by the implementation session. Validated in supabase/tests/schema.test.mjs and
-- tests/recovery-db.test.ts (PGlite, with stubbed auth and storage schemas). Run after 20261107120000_security_hardening.sql.
-- Additive: the previous app version never reads these, and the new app version keeps working without them (it logs an
-- alert and runs without job tracking), so this can be applied before or after the code, though before is what
-- docs/OPERATIONS.md asks for.

/* ---------------------------------------------------------------- daily usage: failures are counted apart */

-- A failed attempt gives its slot back (`count`), and is counted here instead, so a run of failures can't spend without limit.
alter table public.ai_usage add column failed integer not null default 0 check (failed >= 0);

/* ---------------------------------------------------------------- jobs */

-- One row per piece of analysis a student asked for. Ids, counts and states only: there is no column that can hold a
-- document, and the checks below refuse anything but a short code, a hash-like key and one boolean.
create table public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  workflow text not null check (workflow in ('cv_score', 'letter_draft', 'letter_review', 'letter_improve', 'tailor_create', 'tailor_version', 'line_rewrite')),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_:.#-]{1,240}$'),
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'partial', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  failures integer not null default 0 check (failures >= 0),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  lease_expires_at timestamptz,
  -- Set while this job holds one use in ai_usage. Cleared, with the use given back, if the job fails.
  charged_kind text check (charged_kind in ('line_rewrite', 'letter', 'cv_score', 'tailor')),
  charged_day date,
  result_id uuid references public.reports (id) on delete set null,
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and (result - 'ai') = '{}'::jsonb)),
  error_code text check (error_code ~ '^[a-z_]{1,40}$'),
  provider_calls integer not null default 0,
  provider_retries integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_micros bigint not null default 0,
  -- False if any attempt's price is unknown or estimated: the sum is then a lower bound or an estimate, and says so.
  cost_complete boolean not null default true,
  latency_ms integer,
  total_ms bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (user_id, workflow, idempotency_key)
);
create index analysis_jobs_active_idx on public.analysis_jobs (lease_expires_at) where status = 'processing';
create index analysis_jobs_user_active_idx on public.analysis_jobs (user_id) where status in ('processing', 'queued');
create index analysis_jobs_created_idx on public.analysis_jobs (created_at);

-- Server only. The student's view of a job is what the action returns; this table is operations data.
alter table public.analysis_jobs enable row level security;
revoke all on public.analysis_jobs from anon, authenticated;

create or replace function public.analysis_job_json(j public.analysis_jobs)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', j.id, 'workflow', j.workflow, 'status', j.status, 'attempts', j.attempts, 'failures', j.failures,
    'consecutive_failures', j.consecutive_failures, 'result_id', j.result_id, 'result', j.result, 'error_code', j.error_code,
    'charged', j.charged_kind is not null, 'finished_at', j.finished_at, 'created_at', j.created_at);
$$;

-- Marks work whose server is certainly gone as failed, and gives back what it held. A lease outlasts the longest a
-- server run can live, so nothing can still be running under one that has expired. Safe to run at any time, by anyone
-- with the service role. With a user id, sweeps only theirs; the claim below calls it that way on every request.
create or replace function public.sweep_analysis_jobs(p_user_id uuid default null, p_queued_expiry_seconds integer default 3600, p_retain_days integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.analysis_jobs;
  v_abandoned integer := 0;
  v_expired integer := 0;
  v_purged integer := 0;
begin
  for r in
    select * from public.analysis_jobs
    where status = 'processing' and lease_expires_at < now() and (p_user_id is null or user_id = p_user_id)
    for update skip locked
  loop
    if r.charged_kind is not null then
      update public.ai_usage set count = greatest(count - 1, 0), failed = failed + 1
      where user_id = r.user_id and day = r.charged_day and kind = r.charged_kind;
    end if;
    update public.analysis_jobs
    set status = 'failed', error_code = 'abandoned', failures = failures + 1, consecutive_failures = consecutive_failures + 1,
        charged_kind = null, charged_day = null, lease_expires_at = null, finished_at = now(), updated_at = now()
    where id = r.id;
    v_abandoned := v_abandoned + 1;
  end loop;

  update public.analysis_jobs
  set status = 'failed', error_code = 'abandoned', finished_at = now(), updated_at = now()
  where status = 'queued' and updated_at < now() - make_interval(secs => p_queued_expiry_seconds) and (p_user_id is null or user_id = p_user_id);
  get diagnostics v_expired = row_count;

  if p_retain_days is not null then
    delete from public.analysis_jobs where status in ('completed', 'partial', 'failed') and updated_at < now() - make_interval(days => p_retain_days);
    get diagnostics v_purged = row_count;
  end if;
  return jsonb_build_object('abandoned', v_abandoned, 'expired', v_expired, 'purged', v_purged);
end;
$$;

-- The one way into `processing`. Serialised per student, so a repeat can't slip past a first click.
-- outcome: claimed (run it) | replay (already done, here's the result) | in_progress (running elsewhere) |
--          busy (at a concurrency limit; left queued or failed, nothing charged) | cooling_down (failed repeatedly, wait).
create or replace function public.claim_analysis_job(
  p_user_id uuid, p_workflow text, p_key text, p_fresh_seconds integer,
  p_lease_seconds integer, p_max_user integer, p_max_global integer, p_max_consecutive_failures integer, p_cooldown_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.analysis_jobs;
  v_active integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('analysis_jobs:' || p_user_id::text, 0));
  perform public.sweep_analysis_jobs(p_user_id);

  select * into j from public.analysis_jobs where user_id = p_user_id and workflow = p_workflow and idempotency_key = p_key for update;

  if found and j.status in ('completed', 'partial') then
    if p_fresh_seconds is null or j.finished_at >= now() - make_interval(secs => p_fresh_seconds) then
      return jsonb_build_object('outcome', 'replay', 'job', public.analysis_job_json(j));
    end if;
    -- An old answer to a question that can be asked again: keep its row (and its cost) under another key, and start a new one.
    update public.analysis_jobs set idempotency_key = left(p_key, 200) || '#' || j.id::text where id = j.id;
    j := null;
  elsif found and j.status = 'processing' then
    return jsonb_build_object('outcome', 'in_progress', 'job', public.analysis_job_json(j));
  elsif found and j.status = 'failed' and j.consecutive_failures >= p_max_consecutive_failures
        and j.finished_at > now() - make_interval(secs => p_cooldown_seconds) then
    return jsonb_build_object('outcome', 'cooling_down', 'job', public.analysis_job_json(j),
      'retry_after', ceil(extract(epoch from j.finished_at + make_interval(secs => p_cooldown_seconds) - now())));
  end if;

  if j.id is null then
    insert into public.analysis_jobs (user_id, workflow, idempotency_key) values (p_user_id, p_workflow, p_key) returning * into j;
  end if;

  select count(*) into v_active from public.analysis_jobs where user_id = p_user_id and status = 'processing';
  if v_active >= p_max_user then
    return jsonb_build_object('outcome', 'busy', 'scope', 'user', 'job', public.analysis_job_json(j));
  end if;
  select count(*) into v_active from public.analysis_jobs where status = 'processing' and lease_expires_at >= now();
  if v_active >= p_max_global then
    return jsonb_build_object('outcome', 'busy', 'scope', 'global', 'job', public.analysis_job_json(j));
  end if;

  update public.analysis_jobs
  set status = 'processing', attempts = attempts + 1, lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      error_code = null, finished_at = null, updated_at = now()
  where id = j.id returning * into j;
  return jsonb_build_object('outcome', 'claimed', 'job', public.analysis_job_json(j));
end;
$$;

-- Takes one use of a daily quota for a job, at most once however often it's asked, and never past the limit.
create or replace function public.charge_analysis_job(p_user_id uuid, p_job_id uuid, p_attempt integer, p_kind text, p_limit integer, p_failed_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.analysis_jobs;
  v_used integer;
  v_failed integer;
begin
  select * into j from public.analysis_jobs where id = p_job_id and user_id = p_user_id for update;
  if not found or j.status <> 'processing' or j.attempts <> p_attempt then
    raise exception 'job not running';
  end if;
  if j.charged_kind is not null then
    select count into v_used from public.ai_usage where user_id = p_user_id and day = j.charged_day and kind = j.charged_kind;
    return jsonb_build_object('allowed', true, 'used', coalesce(v_used, 0));
  end if;
  select failed into v_failed from public.ai_usage where user_id = p_user_id and day = current_date and kind = p_kind;
  if coalesce(v_failed, 0) >= p_failed_limit then
    return jsonb_build_object('allowed', false, 'reason', 'failed_cap', 'used', 0);
  end if;
  insert into public.ai_usage (user_id, day, kind, count) values (p_user_id, current_date, p_kind, 1)
  on conflict (user_id, day, kind) do update set count = public.ai_usage.count + 1 where public.ai_usage.count < p_limit
  returning count into v_used;
  if v_used is null then
    return jsonb_build_object('allowed', false, 'reason', 'limit', 'used', p_limit);
  end if;
  update public.analysis_jobs set charged_kind = p_kind, charged_day = current_date, updated_at = now() where id = p_job_id;
  return jsonb_build_object('allowed', true, 'used', v_used);
end;
$$;

-- Ends a running attempt. Only the attempt that holds the job can end it, and giving a use back happens in the same
-- step as clearing the mark that says it's held, so it can't happen twice. Returns false if this attempt no longer holds the job.
create or replace function public.finish_analysis_job(
  p_user_id uuid, p_job_id uuid, p_attempt integer, p_status text, p_result_id uuid, p_result jsonb, p_error_code text,
  p_release boolean, p_count_failure boolean, p_usage jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.analysis_jobs;
  v_calls integer := coalesce((p_usage ->> 'calls')::integer, 0);
begin
  if p_status not in ('completed', 'partial', 'failed') then
    raise exception 'not a final state';
  end if;
  select * into j from public.analysis_jobs where id = p_job_id and user_id = p_user_id for update;
  if not found or j.status <> 'processing' or j.attempts <> p_attempt then
    return false;
  end if;
  if p_release and j.charged_kind is not null then
    update public.ai_usage
    -- Only a failure that reached the provider counts towards the failure cap: an open circuit or a failed save cost nothing.
    set count = greatest(count - 1, 0), failed = failed + case when v_calls > 0 then 1 else 0 end
    where user_id = p_user_id and day = j.charged_day and kind = j.charged_kind;
    j.charged_kind := null;
    j.charged_day := null;
  end if;
  update public.analysis_jobs
  set status = p_status, result_id = p_result_id, result = p_result, error_code = p_error_code, lease_expires_at = null,
      charged_kind = j.charged_kind, charged_day = j.charged_day,
      failures = failures + case when p_count_failure then 1 else 0 end,
      consecutive_failures = case when p_status = 'failed' then consecutive_failures + case when p_count_failure then 1 else 0 end else 0 end,
      provider_calls = provider_calls + v_calls,
      provider_retries = provider_retries + coalesce((p_usage ->> 'retries')::integer, 0),
      input_tokens = input_tokens + coalesce((p_usage ->> 'input')::bigint, 0),
      output_tokens = output_tokens + coalesce((p_usage ->> 'output')::bigint, 0),
      cost_micros = cost_micros + coalesce((p_usage ->> 'cost_micros')::bigint, 0),
      cost_complete = cost_complete and coalesce((p_usage ->> 'cost_complete')::boolean, true),
      latency_ms = (p_usage ->> 'latency_ms')::integer,
      total_ms = total_ms + coalesce((p_usage ->> 'latency_ms')::bigint, 0),
      finished_at = now(), updated_at = now()
  where id = p_job_id;
  return true;
end;
$$;

create or replace function public.get_analysis_job(p_user_id uuid, p_job_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.analysis_job_json(j) from public.analysis_jobs j where j.id = p_job_id and j.user_id = p_user_id;
$$;

-- What docs/OPERATIONS.md reads: per workflow, how much was asked for, how it ended, how long it took, and what it cost.
-- `cost_per_completed` spreads failed attempts' cost over the workflows that finished, as the blueprint asks.
create or replace function public.analysis_metrics(p_since timestamptz)
returns table (
  workflow text, jobs bigint, completed bigint, partial bigint, failed bigint, in_flight bigint, refused bigint, attempts bigint, failures bigint, error_rate numeric,
  p50_ms numeric, p95_ms numeric, provider_calls bigint, provider_retries bigint, input_tokens bigint, output_tokens bigint,
  cost_micros bigint, cost_per_completed_micros numeric, cost_incomplete_jobs bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    j.workflow,
    count(*),
    count(*) filter (where j.status = 'completed'),
    count(*) filter (where j.status = 'partial'),
    count(*) filter (where j.status = 'failed' and coalesce(j.error_code, '') not in ('quota', 'failed_cap', 'input')),
    count(*) filter (where j.status in ('queued', 'processing')),
    count(*) filter (where j.status = 'failed' and j.error_code in ('quota', 'failed_cap', 'input')),
    coalesce(sum(j.attempts), 0)::bigint,
    coalesce(sum(j.failures), 0)::bigint,
    round(coalesce(sum(j.failures), 0)::numeric / nullif(sum(j.attempts), 0), 4),
    (percentile_cont(0.5) within group (order by j.latency_ms) filter (where j.status in ('completed', 'partial')))::numeric,
    (percentile_cont(0.95) within group (order by j.latency_ms) filter (where j.status in ('completed', 'partial')))::numeric,
    coalesce(sum(j.provider_calls), 0)::bigint,
    coalesce(sum(j.provider_retries), 0)::bigint,
    coalesce(sum(j.input_tokens), 0)::bigint,
    coalesce(sum(j.output_tokens), 0)::bigint,
    coalesce(sum(j.cost_micros), 0)::bigint,
    round(coalesce(sum(j.cost_micros), 0)::numeric / nullif(count(*) filter (where j.status in ('completed', 'partial')), 0), 1),
    count(*) filter (where not j.cost_complete)
  from public.analysis_jobs j
  where j.created_at >= p_since
  group by j.workflow
  order by j.workflow;
$$;

revoke execute on function public.analysis_job_json(public.analysis_jobs) from public, anon, authenticated;
revoke execute on function public.sweep_analysis_jobs(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.claim_analysis_job(uuid, text, text, integer, integer, integer, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.charge_analysis_job(uuid, uuid, integer, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.finish_analysis_job(uuid, uuid, integer, text, uuid, jsonb, text, boolean, boolean, jsonb) from public, anon, authenticated;
revoke execute on function public.get_analysis_job(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.analysis_metrics(timestamptz) from public, anon, authenticated;
grant execute on function public.sweep_analysis_jobs(uuid, integer, integer) to service_role;
grant execute on function public.claim_analysis_job(uuid, text, text, integer, integer, integer, integer, integer, integer) to service_role;
grant execute on function public.charge_analysis_job(uuid, uuid, integer, text, integer, integer) to service_role;
grant execute on function public.finish_analysis_job(uuid, uuid, integer, text, uuid, jsonb, text, boolean, boolean, jsonb) to service_role;
grant execute on function public.get_analysis_job(uuid, uuid) to service_role;
grant execute on function public.analysis_metrics(timestamptz) to service_role;
