-- Scoped, expiring and revocable share links for CV reviews (OP-020), and the institution setting they sit behind.
--
-- NOT APPLIED to any live database by the implementation session. Validated in PGlite only (supabase/tests/schema.test.mjs
-- and tests/sharing-db.test.ts, with stubbed auth and storage schemas). Run after 20261107200000_linkedin_reports.sql.
-- Until it is applied the application reads sharing as off and offers no control.
--
-- A link is a bearer secret. Only the SHA-256 of a 256-bit token is stored. This is a separate mechanism from adviser access
-- (share_progress, adviser_can_view_cv): nothing here reads or changes those columns, no admin function reads these
-- tables, and no admin has a policy on them.

-- Off for every university, existing or new, until someone decides otherwise. Only the service role can change it.
alter table public.universities add column report_sharing_enabled boolean not null default false;

create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  report_id uuid not null references public.reports (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  scope text not null check (scope in ('score', 'areas', 'advice')),
  -- Fingerprint of what the student previewed. No document content.
  content_digest text not null check (content_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint share_links_expiry check (expires_at > created_at and expires_at <= created_at + interval '30 days')
);
create index share_links_user_idx on public.share_links (user_id, created_at desc);
create index share_links_report_idx on public.share_links (report_id);
create index share_links_expiry_idx on public.share_links (expires_at);

-- One row per time the shared page was shown. Just the time: this log tells a student their link was opened, and has no
-- reason to hold a recipient's IP address, browser or location.
create table public.share_link_access (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.share_links (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  accessed_at timestamptz not null default now()
);
create index share_link_access_link_idx on public.share_link_access (link_id, accessed_at desc);
create index share_link_access_user_idx on public.share_link_access (user_id);

-- Owners read their own rows and nothing else can be done directly. The hash isn't readable even by its owner.
alter table public.share_links enable row level security;
alter table public.share_link_access enable row level security;
revoke all on public.share_links from anon, authenticated;
revoke all on public.share_link_access from anon, authenticated;
grant select (id, user_id, report_id, scope, content_digest, created_at, expires_at, revoked_at) on public.share_links to authenticated;
grant select (id, link_id, user_id, accessed_at) on public.share_link_access to authenticated;
create policy "owners read their share links" on public.share_links for select to authenticated using (user_id = (select auth.uid()));
create policy "owners read their share access log" on public.share_link_access for select to authenticated using (user_id = (select auth.uid()));

-- The setting for the signed-in user's own university.
create or replace function public.report_sharing_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select u.report_sharing_enabled
    from public.profiles p join public.universities u on u.id = p.university_id
    where p.id = (select auth.uid()) and p.role = 'student'
  ), false);
$$;

-- The owner comes from the session, never from an argument. Only a student's own CV review, and only where allowed.
create or replace function public.create_share_link(p_report uuid, p_token_hash text, p_scope text, p_digest text, p_expires_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user is null then raise exception 'not signed in'; end if;
  if not public.report_sharing_enabled() then raise exception 'sharing is not available' using errcode = '42501'; end if;
  if not exists (select 1 from public.reports r where r.id = p_report and r.user_id = v_user and r.type = 'cv_review') then
    raise exception 'report not found' using errcode = '22023';
  end if;
  insert into public.share_links (user_id, report_id, token_hash, scope, content_digest, expires_at)
  values (v_user, p_report, p_token_hash, p_scope, p_digest, p_expires_at)
  returning id into v_id;
  return v_id;
end;
$$;

-- False for a link that isn't the caller's, the same as one that doesn't exist. A second call keeps the first time.
create or replace function public.revoke_share_link(p_link uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.share_links set revoked_at = coalesce(revoked_at, now()) where id = p_link and user_id = (select auth.uid());
  return found;
end;
$$;

-- Service role only, so tokens can't be tried against the database without passing the application's rate limit.
create or replace function public.share_link_lookup(p_token_hash text)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object('linkId', l.id, 'scope', l.scope, 'digest', l.content_digest, 'type', r.type, 'createdAt', r.created_at, 'payload', r.payload)
  from public.share_links l
  join public.reports r on r.id = l.report_id and r.user_id = l.user_id
  join public.profiles p on p.id = l.user_id
  join public.universities u on u.id = p.university_id
  where l.token_hash = p_token_hash and l.revoked_at is null and l.expires_at > now() and p.role = 'student' and u.report_sharing_enabled;
$$;

-- Writes the log entry only if the link is still live at this moment, so a revocation can't slip in after the lookup
-- unnoticed, and nothing is shown without an entry.
create or replace function public.share_link_record_access(p_link uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.share_link_access (link_id, user_id)
  select l.id, l.user_id
  from public.share_links l
  join public.profiles p on p.id = l.user_id
  join public.universities u on u.id = p.university_id
  where l.id = p_link and l.revoked_at is null and l.expires_at > now() and u.report_sharing_enabled;
  return found;
end;
$$;

revoke execute on function public.report_sharing_enabled() from public, anon;
revoke execute on function public.create_share_link(uuid, text, text, text, timestamptz) from public, anon;
revoke execute on function public.revoke_share_link(uuid) from public, anon;
revoke execute on function public.share_link_lookup(text) from public, anon, authenticated;
revoke execute on function public.share_link_record_access(uuid) from public, anon, authenticated;
grant execute on function public.report_sharing_enabled() to authenticated;
grant execute on function public.create_share_link(uuid, text, text, text, timestamptz) to authenticated;
grant execute on function public.revoke_share_link(uuid) to authenticated;
grant execute on function public.share_link_lookup(text) to service_role;
grant execute on function public.share_link_record_access(uuid) to service_role;
