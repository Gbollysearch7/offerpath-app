-- Security verification findings (OP-026).
--
-- NOT APPLIED to any live database by the implementation session. Validated in supabase/tests/security.test.mjs
-- (PGlite, with stubbed auth and storage schemas). Run after 20261105120000_cv_sources.sql, also unapplied.

/* ---------------------------------------------------------------- institution fields at sign-up */

-- Student number, course, year, faculty and fee status belong to the institution: students can't edit them after
-- sign-up. But raw_user_meta_data is whatever the client sends to the public sign-up API, so anyone could claim
-- another student's number or a different fee status in their first request. Those fields are now taken from it only
-- when the identity provider supplied it (single sign-on); raw_app_meta_data can't be written by the client at all.
-- An imported student record still wins over both. A display name stays self-declared, as students can edit it anyway.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(new.email);
  v_domain text := lower(split_part(new.email, '@', 2));
  v_local text := split_part(new.email, '@', 1);
  v_claims jsonb := coalesce(new.raw_app_meta_data -> 'custom_claims', '{}'::jsonb);
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb) || v_claims;
  -- Institution fields: from the identity provider only.
  v_inst jsonb := case when coalesce(new.raw_app_meta_data ->> 'provider', '') like 'sso:%' then v_meta else v_claims end;
  v_uni uuid;
  r public.student_records;
  v_admin boolean;
begin
  select u.id into v_uni
  from public.universities u
  where v_domain = u.domain or v_domain like '%.' || u.domain
  limit 1;

  if v_uni is null then
    raise exception 'Offerpath is only open to partner universities (%)', v_domain using errcode = '42501';
  end if;

  select * into r from public.student_records where university_id = v_uni and email = v_email;
  select exists (select 1 from public.pending_admins where university_id = v_uni and email = v_email) into v_admin;

  insert into public.profiles (id, email, full_name, university_id, role, student_number, course, year_of_study, faculty, fee_status)
  values (
    new.id,
    new.email,
    coalesce(public.clean_text(v_meta ->> 'full_name', 120), public.clean_text(v_meta ->> 'name', 120), initcap(regexp_replace(v_local, '[._-]+', ' ', 'g'))),
    v_uni,
    case when v_admin then 'admin' else 'student' end,
    coalesce(r.student_number, public.clean_text(v_inst ->> 'student_number', 40)),
    coalesce(r.course, public.clean_text(v_inst ->> 'course', 120)),
    coalesce(r.year_of_study, public.clean_text(v_inst ->> 'year_of_study', 40)),
    coalesce(r.faculty, public.clean_text(v_inst ->> 'faculty', 120)),
    coalesce(r.fee_status, public.clean_fee_status(v_inst ->> 'fee_status'))
  );
  if v_admin then
    delete from public.pending_admins where university_id = v_uni and email = v_email;
  end if;
  return new;
end;
$$;

/* ---------------------------------------------------------------- original files are the server's to remove */

-- The original upload behind a version is meant to be immutable (OP-006), but this policy let a student delete their
-- own file directly through the storage API, leaving a version that says a file exists. The app never used it:
-- account deletion removes files with the service role.
drop policy if exists "delete own cv files" on storage.objects;

/* ---------------------------------------------------------------- privileges row-level security doesn't govern */

-- TRUNCATE ignores row-level security altogether. Supabase's default privileges grant it, with TRIGGER and REFERENCES,
-- to anon and authenticated on every new table. PostgREST has no way to issue these, so this closes a gap one layer
-- down rather than a known route: if a role ever gets SQL another way, TRUNCATE public.reports shouldn't simply work.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t.tablename);
  end loop;
end;
$$;
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;
