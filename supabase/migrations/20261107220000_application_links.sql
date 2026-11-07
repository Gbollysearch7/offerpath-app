-- Connecting a role with the documents made for it (OP-019): which CV, tailored CV and letter sit on an application, which
-- document versions a student has been sent, and the recommendations they dismissed and why. Nothing here feeds a score,
-- holds document text, or is visible to an adviser or admin.
--
-- NOT APPLIED to any live database by the implementation session. Validated in supabase/tests/schema.test.mjs (PGlite, with
-- stubbed auth and storage schemas). Apply before the code that reads it: the dashboard reads these tables, and the download
-- routes write to artefact_downloads (a failed write doesn't stop a download). Run after 20261107210000_report_sharing.sql.

/* ---------------------------------------------------------------- an application made from an advert the student pasted */

-- The report a role came from, when it isn't a listed opportunity. Tracking the same report twice finds the same row.
alter table public.applications add column source_report_id uuid references public.reports (id) on delete set null;
create unique index applications_source_report_idx on public.applications (user_id, source_report_id) where source_report_id is not null;

create or replace function public.applications_check_source_report()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_report_id is not null and not exists (select 1 from public.reports r where r.id = new.source_report_id and r.user_id = new.user_id) then
    raise exception 'an application can only come from its own user''s report' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger applications_source_report_owner before insert or update of source_report_id on public.applications for each row execute function public.applications_check_source_report();

/* ---------------------------------------------------------------- links */

create table public.application_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Stopping tracking a role removes its links. The reports stay, with their own history.
  application_id uuid not null references public.applications (id) on delete cascade,
  -- Removing a report removes its place on the application, and nothing else.
  report_id uuid not null references public.reports (id) on delete cascade,
  kind text not null check (kind in ('cv', 'tailor', 'letter')),
  -- sha256 of the exact version kept for this application. Null: it follows the report's latest version.
  document_version text check (document_version ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One of each kind on an application. The same CV can sit on several.
  unique (application_id, kind)
);
create index application_links_user_idx on public.application_links (user_id);
create index application_links_report_idx on public.application_links (report_id);

-- Both ends must be this user's, and the report must be the kind the slot says. The service role bypasses row-level security, so this holds for server writes too.
create or replace function public.application_links_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.applications a where a.id = new.application_id and a.user_id = new.user_id) then
    raise exception 'an application link can only be on its own user''s application' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.reports r
    where r.id = new.report_id and r.user_id = new.user_id
      and r.type = case new.kind when 'cv' then 'cv_review' when 'tailor' then 'tailor' when 'letter' then 'cover_letter' end
  ) then
    raise exception 'an application link can only name its own user''s report of that kind' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger application_links_owner before insert or update on public.application_links for each row execute function public.application_links_check();

/* ---------------------------------------------------------------- downloads */

-- One row per document version sent to a student. A retried download touches last_at and adds nothing.
create table public.artefact_downloads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  report_id uuid not null references public.reports (id) on delete cascade,
  document_version text not null check (document_version ~ '^[0-9a-f]{64}$'),
  format text not null check (format in ('docx', 'pdf', 'txt', 'original')),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  unique (user_id, report_id, document_version)
);
create index artefact_downloads_report_idx on public.artefact_downloads (report_id);

create or replace function public.artefact_downloads_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.reports r where r.id = new.report_id and r.user_id = new.user_id) then
    raise exception 'a download can only be recorded on its own user''s report' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger artefact_downloads_owner before insert or update on public.artefact_downloads for each row execute function public.artefact_downloads_check();

/* ---------------------------------------------------------------- dismissed recommendations */

-- One append-only history; the current state is read from it. A key names ids and hashes, never document text.
create table public.action_choices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  action_key text not null check (char_length(action_key) between 1 and 240 and action_key ~ '^[a-z-]+(:[A-Za-z0-9_.-]+)*$'),
  kind text not null check (kind in ('dismiss', 'reopen')),
  reason text check (reason in ('done', 'not_relevant', 'disagree', 'later')),
  created_at timestamptz not null default now(),
  -- A dismissal always says why. Bringing something back has nothing to explain.
  check ((kind = 'dismiss' and reason is not null) or (kind = 'reopen' and reason is null))
);
create index action_choices_user_idx on public.action_choices (user_id, created_at);

create or replace function public.forbid_action_choice_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'action choices are append-only';
end;
$$;
create trigger action_choices_immutable before update on public.action_choices for each row execute function public.forbid_action_choice_update();

/* ---------------------------------------------------------------- row-level security */

alter table public.application_links enable row level security;
alter table public.artefact_downloads enable row level security;
alter table public.action_choices enable row level security;
-- A student reads their own and nobody else does: there is no adviser or admin policy.
create policy "read own application links" on public.application_links for select to authenticated using (user_id = (select auth.uid()));
create policy "read own downloads" on public.artefact_downloads for select to authenticated using (user_id = (select auth.uid()));
create policy "read own action choices" on public.action_choices for select to authenticated using (user_id = (select auth.uid()));
-- All writes go through the server, as for reports and versions.
revoke insert, update, delete on public.application_links from anon, authenticated;
revoke insert, update, delete on public.artefact_downloads from anon, authenticated;
revoke insert, update, delete on public.action_choices from anon, authenticated;

revoke execute on function public.applications_check_source_report() from public, anon, authenticated;
revoke execute on function public.application_links_check() from public, anon, authenticated;
revoke execute on function public.artefact_downloads_check() from public, anon, authenticated;
revoke execute on function public.forbid_action_choice_update() from public, anon, authenticated;
