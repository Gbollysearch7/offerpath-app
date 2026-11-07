-- LinkedIn profile reviews (OP-018): a new report type, and the job and usage kinds it needs. No new table: a review is a
-- row in public.reports, so the existing owner-only read policy, the server-only write rule and the account-deletion
-- cascade all apply to it. Sections, versions, decisions and proofreading choices live in its payload.
--
-- NOT APPLIED to any live database by the implementation session. Validated in supabase/tests/schema.test.mjs (PGlite,
-- with stubbed auth and storage schemas). Apply before the code that writes these reports is used: until then, starting a
-- review fails at the insert and no other report type is affected. Run after 20261107190000_proofreading_choices.sql.

alter table public.reports drop constraint reports_type_check;
alter table public.reports add constraint reports_type_check check (type in ('cv_review', 'tailor', 'cover_letter', 'linkedin'));

-- A review has its own feedback and no number, so it can't be averaged with or mistaken for a CV score, and it holds no file:
-- the export a student uploads is read and forgotten.
alter table public.reports add constraint reports_linkedin_no_score check (type <> 'linkedin' or (score is null and storage_path is null and source_id is null));

-- Stated again so this file alone shows the position: row-level security on, students read their own, and only the server writes.
alter table public.reports enable row level security;
revoke insert, update, delete on public.reports from anon, authenticated;

alter table public.analysis_jobs drop constraint analysis_jobs_workflow_check;
alter table public.analysis_jobs add constraint analysis_jobs_workflow_check check (workflow in ('cv_score', 'letter_draft', 'letter_review', 'letter_improve', 'tailor_create', 'tailor_version', 'line_rewrite', 'linkedin_create', 'linkedin_suggest'));
alter table public.analysis_jobs drop constraint analysis_jobs_charged_kind_check;
alter table public.analysis_jobs add constraint analysis_jobs_charged_kind_check check (charged_kind in ('line_rewrite', 'letter', 'cv_score', 'tailor', 'linkedin'));

alter table public.ai_usage drop constraint ai_usage_kind_check;
alter table public.ai_usage add constraint ai_usage_kind_check check (kind in ('line_rewrite', 'letter', 'cv_score', 'tailor', 'linkedin'));

create or replace function public.bump_ai_usage(p_kind text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in';
  end if;
  if p_kind not in ('line_rewrite', 'letter', 'cv_score', 'tailor', 'linkedin') then
    raise exception 'unknown kind';
  end if;
  insert into public.ai_usage (user_id, day, kind, count)
  values ((select auth.uid()), current_date, p_kind, 1)
  on conflict (user_id, day, kind) do update set count = public.ai_usage.count + 1
  returning count into v_count;
  return v_count;
end;
$$;
