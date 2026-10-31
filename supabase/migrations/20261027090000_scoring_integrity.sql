-- Scoring integrity.
-- 1. bullet_judgments: each student's cache of Claude Haiku judgments, keyed by a hash of
--    (rubric version, judge model, student, sector, normalised bullet words). It stores no CV text,
--    is scoped per student so nobody can influence anyone else's scores, and is deleted with the account.
--    The first judgment stored for a key is permanent, which is what makes the same CV
--    always get the same score. Only the server (service role) can read or write it.
-- 2. reports become read-only for students. Scores are written by the server after scoring,
--    so a student can't set their own score through the API.

create table public.bullet_judgments (
  key text primary key check (key ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references public.profiles (id) on delete cascade,
  judgment jsonb not null check (
    judgment ->> 'result' in ('measured', 'partial', 'none')
    and judgment ->> 'verb' in ('strong', 'ok', 'weak')
    and judgment ->> 'kind' in ('achievement', 'duty')
    and judgment ->> 'relevance' in ('high', 'some', 'none')
  ),
  judge text not null,
  created_at timestamptz not null default now()
);

create index bullet_judgments_user_idx on public.bullet_judgments (user_id);

alter table public.bullet_judgments enable row level security;
-- No policies: anon and authenticated can't touch it. The service role bypasses RLS.
revoke all on public.bullet_judgments from anon, authenticated;

-- Judgments are append-only: never changed once written.
create or replace function public.forbid_judgment_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'bullet judgments are immutable';
end;
$$;

create trigger bullet_judgments_immutable before update on public.bullet_judgments
  for each row execute function public.forbid_judgment_update();

-- Reports: students read their own; all writes go through the server.
drop policy if exists "create own reports" on public.reports;
drop policy if exists "update own reports" on public.reports;
drop policy if exists "delete own reports" on public.reports;
revoke insert, update, delete on public.reports from anon, authenticated;
