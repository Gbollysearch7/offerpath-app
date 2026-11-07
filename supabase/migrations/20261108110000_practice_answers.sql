-- Saved interview practice (OP-023): a student's written answer, the question it answered and the feedback it got, connected
-- to the application and the exact CV and advert versions the question came from. This closes the interview-practice clause
-- left open by OP-019 (nothing used to be saved to link to). Nothing here feeds a score. Answers are private to the student:
-- no adviser, admin, share link or reporting function reads this table. Text only: there is no audio or video column.
--
-- NOT APPLIED to any live database by the implementation session. Validated in supabase/tests/schema.test.mjs (PGlite, with
-- stubbed auth and storage schemas). Apply before the code that reads it: the dashboard and the practice pages read this
-- table. Run after 20261108100000_erasure_ledger.sql.

/* ---------------------------------------------------------------- answers */

create table public.practice_answers (
  id uuid primary key default gen_random_uuid(),
  -- Goes with the account, whichever route deletes it: self-service, the retention job or an erasure re-applied after a restore.
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Stopping tracking a role doesn't lose the student's writing. The label below still says what it was for.
  application_id uuid references public.applications (id) on delete set null,
  mode text not null check (mode in ('general', 'application')),
  role_label text check (char_length(role_label) <= 400),
  -- The saved question quotes these documents, so it goes if they do.
  document_report_id uuid references public.reports (id) on delete cascade,
  document_version text check (document_version ~ '^[0-9a-f]{64}$'),
  document_label text check (char_length(document_label) <= 300),
  advert_report_id uuid references public.reports (id) on delete cascade,
  advert_version text check (advert_version ~ '^[0-9a-f]{64}$'),
  objective text not null check (objective in ('all', 'essential', 'gaps', 'cv', 'motivation')),
  question_id text not null check (char_length(question_id) between 1 and 200),
  question jsonb not null check (jsonb_typeof(question) = 'object'),
  answer text not null check (char_length(answer) between 20 and 4000),
  feedback jsonb not null check (jsonb_typeof(feedback) = 'object'),
  feedback_version text not null check (char_length(feedback_version) between 1 and 80),
  method text not null check (method in ('rules', 'rules+ai')),
  -- The same attempt twice is one answer.
  attempt_key text not null check (attempt_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  created_at timestamptz not null default now(),
  unique (user_id, attempt_key),
  -- General practice names no document. Practice for an application always says which version it came from.
  check (
    (mode = 'general' and document_report_id is null and document_version is null and advert_report_id is null and advert_version is null and application_id is null)
    or (mode = 'application' and document_report_id is not null and document_version is not null)
  )
);
create index practice_answers_user_idx on public.practice_answers (user_id, created_at desc);
create index practice_answers_application_idx on public.practice_answers (application_id) where application_id is not null;
create index practice_answers_document_idx on public.practice_answers (document_report_id) where document_report_id is not null;
create index practice_answers_advert_idx on public.practice_answers (advert_report_id) where advert_report_id is not null;

-- Everything it names must be this user's, and the document must be a CV or tailored CV. The service role bypasses row-level security, so this holds for server writes too.
create or replace function public.practice_answers_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.application_id is not null and not exists (select 1 from public.applications a where a.id = new.application_id and a.user_id = new.user_id) then
    raise exception 'a practice answer can only be on its own user''s application' using errcode = '42501';
  end if;
  if new.document_report_id is not null and not exists (select 1 from public.reports r where r.id = new.document_report_id and r.user_id = new.user_id and r.type in ('cv_review', 'tailor')) then
    raise exception 'a practice answer can only name its own user''s CV or tailored CV' using errcode = '42501';
  end if;
  if new.advert_report_id is not null and not exists (select 1 from public.reports r where r.id = new.advert_report_id and r.user_id = new.user_id and r.type = 'tailor') then
    raise exception 'a practice answer can only name its own user''s advert' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger practice_answers_owner before insert on public.practice_answers for each row execute function public.practice_answers_check();

-- What was written and what feedback it got stay as they were. The one change allowed is the foreign key letting go of an application.
create or replace function public.practice_answers_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.application_id is not null or (to_jsonb(new) - 'application_id') is distinct from (to_jsonb(old) - 'application_id') then
    raise exception 'practice answers are immutable';
  end if;
  return new;
end;
$$;
create trigger practice_answers_no_update before update on public.practice_answers for each row execute function public.practice_answers_immutable();

-- Practising is activity, as making a report is, so someone practising isn't deleted as inactive.
create trigger practice_answers_touch_activity after insert on public.practice_answers for each row execute function public.touch_activity();

/* ---------------------------------------------------------------- row-level security */

alter table public.practice_answers enable row level security;
-- A student reads their own and nobody else does: there is no adviser or admin policy, and no function reads it for them.
create policy "read own practice answers" on public.practice_answers for select to authenticated using (user_id = (select auth.uid()));
-- All writes go through the server, as for reports and versions.
revoke all on public.practice_answers from anon;
revoke insert, update, delete, truncate, references, trigger on public.practice_answers from authenticated;

revoke execute on function public.practice_answers_check() from public, anon, authenticated;
revoke execute on function public.practice_answers_immutable() from public, anon, authenticated;

/* ---------------------------------------------------------------- the optional model pass */

alter table public.analysis_jobs drop constraint analysis_jobs_workflow_check;
alter table public.analysis_jobs add constraint analysis_jobs_workflow_check check (workflow in ('cv_score', 'letter_draft', 'letter_review', 'letter_improve', 'tailor_create', 'tailor_version', 'line_rewrite', 'linkedin_create', 'linkedin_suggest', 'practice_feedback'));
alter table public.analysis_jobs drop constraint analysis_jobs_charged_kind_check;
alter table public.analysis_jobs add constraint analysis_jobs_charged_kind_check check (charged_kind in ('line_rewrite', 'letter', 'cv_score', 'tailor', 'linkedin', 'practice'));

alter table public.ai_usage drop constraint ai_usage_kind_check;
alter table public.ai_usage add constraint ai_usage_kind_check check (kind in ('line_rewrite', 'letter', 'cv_score', 'tailor', 'linkedin', 'practice'));

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
  if p_kind not in ('line_rewrite', 'letter', 'cv_score', 'tailor', 'linkedin', 'practice') then
    raise exception 'unknown kind';
  end if;
  insert into public.ai_usage (user_id, day, kind, count)
  values ((select auth.uid()), current_date, p_kind, 1)
  on conflict (user_id, day, kind) do update set count = public.ai_usage.count + 1
  returning count into v_count;
  return v_count;
end;
$$;
