-- Same CV, same score, for everyone.
-- Judgments were cached per student and per sector, so the same bullet could get a different verdict
-- for another student or another target sector. They now live in one shared cache keyed by a hash of
-- (rubric version, judge model, part, [sector,] normalised bullet words):
--   * a "core" entry: result, verb and kind, which don't depend on the sector;
--   * a "relevance" entry per sector.
-- The cache holds only those labels and the hash: no CV text and no link to any student, so nothing in
-- it is personal data and it doesn't need deleting with an account. The first judgment stored for a key
-- is permanent. Only the server (service role) can read or write it.

drop table if exists public.bullet_judgments;

create table public.judgment_cache (
  key text primary key check (key ~ '^[0-9a-f]{64}$'),
  judgment jsonb not null check (
    (
      judgment ->> 'result' in ('measured', 'partial', 'none')
      and judgment ->> 'verb' in ('strong', 'ok', 'weak')
      and judgment ->> 'kind' in ('achievement', 'duty')
      and not judgment ? 'relevance'
    ) or (
      judgment ->> 'relevance' in ('high', 'some', 'none')
      and not judgment ? 'result'
    )
  ),
  judge text not null,
  created_at timestamptz not null default now()
);

alter table public.judgment_cache enable row level security;
-- No policies: anon and authenticated can't touch it. The service role bypasses RLS.
revoke all on public.judgment_cache from anon, authenticated;

create trigger judgment_cache_immutable before update on public.judgment_cache
  for each row execute function public.forbid_judgment_update();
