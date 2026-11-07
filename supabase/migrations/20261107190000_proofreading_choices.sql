-- A student's proofreading choices (OP-008): dismissing a suggestion on one document, reopening it, and choosing which
-- English to check against. One append-only history; the current state is read from it, so the state and its audit
-- trail can't disagree. Nothing here feeds a score, a report's analysis, the terminology list or another account.
--
-- NOT APPLIED to any live database by the implementation session. Validated in supabase/tests/schema.test.mjs and
-- security.test.mjs (PGlite, with stubbed auth and storage schemas). Apply before the code that reads it: the check page
-- reads this table. Run after 20261107180000_analysis_jobs.sql.

create table public.proofreading_choices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- The report the choice was made on. Deleting a report removes the words quoted from it here too.
  report_id uuid not null references public.reports (id) on delete cascade,
  -- sha256 of the text: a dismissal belongs to this document and no other.
  document_version text not null check (document_version ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('dismiss', 'reopen', 'language')),
  finding_id text check (char_length(finding_id) between 1 and 300),
  quote text check (char_length(quote) between 1 and 200),
  language text check (language in ('en-GB', 'en-US')),
  -- Only students make these. The column makes every row of the history say so.
  actor text not null default 'student' check (actor = 'student'),
  created_at timestamptz not null default now(),
  check (
    (kind = 'language' and language is not null and finding_id is null and quote is null)
    or (kind in ('dismiss', 'reopen') and language is null and finding_id is not null and quote is not null)
  )
);
create index proofreading_choices_user_document_idx on public.proofreading_choices (user_id, document_version, created_at);
create index proofreading_choices_report_idx on public.proofreading_choices (report_id);

-- The report must be this user's and about this text. The service role bypasses row-level security, so this holds for server writes too.
create or replace function public.proofreading_choices_check_report()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.reports r
    where r.id = new.report_id and r.user_id = new.user_id and r.payload #>> '{proofreading,documentVersion}' = new.document_version
  ) then
    raise exception 'a proofreading choice can only be made on its own user''s report of that document' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger proofreading_choices_report_owner before insert on public.proofreading_choices for each row execute function public.proofreading_choices_check_report();

-- History isn't rewritten. Rows leave only by cascade, with the report or the account.
create or replace function public.forbid_proofreading_choice_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'proofreading choices are append-only';
end;
$$;
create trigger proofreading_choices_immutable before update on public.proofreading_choices for each row execute function public.forbid_proofreading_choice_update();

/* ---------------------------------------------------------------- row-level security */

alter table public.proofreading_choices enable row level security;
-- A student reads their own and nobody else does: there is no adviser or admin policy.
create policy "read own proofreading choices" on public.proofreading_choices for select to authenticated using (user_id = (select auth.uid()));
-- All writes go through the server, as for reports and versions.
revoke insert, update, delete on public.proofreading_choices from anon, authenticated;

revoke execute on function public.proofreading_choices_check_report() from public, anon, authenticated;
revoke execute on function public.forbid_proofreading_choice_update() from public, anon, authenticated;
