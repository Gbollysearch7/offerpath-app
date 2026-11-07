-- CV document versions (OP-006).
-- Every CV review starts from a version of the student's text: the upload as it was read, a correction the
-- student made to that reading, or text they typed when a file (a scan) could not be read. Versions are
-- immutable; a correction is a new row whose parent_id names the version it was made from, and the report that
-- scored a version points at it. Only the server (service role) writes here, exactly as for reports; students
-- read their own rows and download their own files under the existing bucket policy.
--
-- NOT APPLIED to any live database by the implementation session. Validated in supabase/tests/schema.test.mjs (PGlite).

create table public.cv_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- The version this one was derived from. An upload has none; a correction always has one; a paste has one when
  -- the unreadable file was kept beside it.
  parent_id uuid references public.cv_sources (id) on delete cascade,
  kind text not null check (kind in ('upload', 'correction', 'paste')),
  file_name text not null check (char_length(file_name) between 1 and 200),
  -- The text exactly as it was read or written. Empty only for a retained file that could not be read.
  text text not null check (char_length(text) <= 40000),
  -- sha256 of text: the documentVersion every report, finding and evidence reference names.
  document_version text not null check (document_version ~ '^[0-9a-f]{64}$'),
  -- DocumentMeta (how the text was read: pages, warnings, confidence, structure). '{}' when the file was unreadable.
  meta jsonb not null default '{}'::jsonb,
  -- Why a retained file could not be read ({kind, code, message}); null when it was.
  outcome jsonb,
  storage_path text,
  -- The client's key for one attempt. The same key from the same user returns the same version.
  idempotency_key text check (char_length(idempotency_key) between 8 and 80),
  created_at timestamptz not null default now(),
  check (kind <> 'upload' or parent_id is null),
  check (kind <> 'correction' or parent_id is not null)
);
create index cv_sources_user_created_idx on public.cv_sources (user_id, created_at desc);
create index cv_sources_parent_idx on public.cv_sources (parent_id) where parent_id is not null;
-- A refresh, a double click or a retry after a failed save must not make a second version.
create unique index cv_sources_idempotency_key on public.cv_sources (user_id, idempotency_key) where idempotency_key is not null;
-- Nor must the same corrected text submitted twice (two tabs) from the same parent.
create unique index cv_sources_parent_version_key on public.cv_sources (user_id, parent_id, document_version) where parent_id is not null;

-- A report scores exactly one version, and a version is scored at most once.
alter table public.reports add column source_id uuid references public.cv_sources (id) on delete set null;
create unique index reports_source_id_key on public.reports (source_id) where source_id is not null;

/* ---------------------------------------------------------------- ownership, enforced in the database */

-- A version can only descend from its own user's version; a report can only score its own user's version.
-- The service role bypasses row-level security, so these checks hold even for server writes.
create or replace function public.cv_sources_check_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null and not exists (select 1 from public.cv_sources p where p.id = new.parent_id and p.user_id = new.user_id) then
    raise exception 'a source version can only descend from its own user''s version' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger cv_sources_parent_owner before insert on public.cv_sources for each row execute function public.cv_sources_check_parent();

create or replace function public.reports_check_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_id is not null and not exists (select 1 from public.cv_sources s where s.id = new.source_id and s.user_id = new.user_id) then
    raise exception 'a report can only score its own user''s source version' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger reports_source_owner before insert or update of source_id on public.reports for each row execute function public.reports_check_source();

-- Versions are immutable once written: the original upload is never overwritten, and neither is a correction.
create or replace function public.forbid_source_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'cv source versions are immutable';
end;
$$;
create trigger cv_sources_immutable before update on public.cv_sources for each row execute function public.forbid_source_update();

/* ---------------------------------------------------------------- row-level security */

alter table public.cv_sources enable row level security;
create policy "read own cv sources" on public.cv_sources for select to authenticated using (user_id = (select auth.uid()));
-- All writes go through the server, as for reports.
revoke insert, update, delete on public.cv_sources from anon, authenticated;

revoke execute on function public.cv_sources_check_parent() from public, anon, authenticated;
revoke execute on function public.reports_check_source() from public, anon, authenticated;
revoke execute on function public.forbid_source_update() from public, anon, authenticated;
