-- Institution configuration, adviser casework and a durable access trail (OP-021).
--
-- NOT APPLIED to any live database by the implementation session. Validated in PGlite only
-- (supabase/tests/schema.test.mjs, supabase/tests/security.test.mjs, tests/adviser-db.test.ts).
--
-- Three rules this file exists to keep:
--  1. Nothing here can reach a score. The configuration tables have no score, weight, threshold or rubric column,
--     and no function in this file writes to public.reports, public.judgment_cache or a score series.
--  2. An adviser's view of a student is decided in one place, public.staff_can_see(), read on every call. Withdrawing
--     consent or removing a role therefore takes effect on the next request; nothing is cached or copied.
--  3. Disagreements, referral events and the access log are history: they are added to, never rewritten.
--
-- All new tables are deny-by-default: row-level security on, no policy, no grant. Every read and write goes through a
-- function below, which is also what writes the access log, so there is no route to the data that skips the log.

/* ---------------------------------------------------------------- the adviser role */

-- A careers admin runs the service. An adviser works with students: no configuration, team, import, export or dashboard.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('student', 'admin', 'adviser'));

-- An invitation says which role it is for. Existing invitations were for admins, so that stays the default.
alter table public.pending_admins add column staff_role text not null default 'admin' check (staff_role in ('admin', 'adviser'));

-- Same as 20261107120000_security_hardening.sql, except that an invitation may be for an adviser.
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
  v_staff_role text;
begin
  select u.id into v_uni
  from public.universities u
  where v_domain = u.domain or v_domain like '%.' || u.domain
  limit 1;

  if v_uni is null then
    raise exception 'Offerpath is only open to partner universities (%)', v_domain using errcode = '42501';
  end if;

  select * into r from public.student_records where university_id = v_uni and email = v_email;
  select staff_role into v_staff_role from public.pending_admins where university_id = v_uni and email = v_email;

  insert into public.profiles (id, email, full_name, university_id, role, student_number, course, year_of_study, faculty, fee_status)
  values (
    new.id,
    new.email,
    coalesce(public.clean_text(v_meta ->> 'full_name', 120), public.clean_text(v_meta ->> 'name', 120), initcap(regexp_replace(v_local, '[._-]+', ' ', 'g'))),
    v_uni,
    coalesce(v_staff_role, 'student'),
    coalesce(r.student_number, public.clean_text(v_inst ->> 'student_number', 40)),
    coalesce(r.course, public.clean_text(v_inst ->> 'course', 120)),
    coalesce(r.year_of_study, public.clean_text(v_inst ->> 'year_of_study', 40)),
    coalesce(r.faculty, public.clean_text(v_inst ->> 'faculty', 120)),
    coalesce(r.fee_status, public.clean_fee_status(v_inst ->> 'fee_status'))
  );
  if v_staff_role is not null then
    delete from public.pending_admins where university_id = v_uni and email = v_email;
  end if;
  return new;
end;
$$;

-- The caller's university, if they are careers staff of either kind. Raises otherwise, as admin_university() does.
create function public.staff_university()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uni uuid;
begin
  select university_id into v_uni from public.profiles where id = (select auth.uid()) and role in ('admin', 'adviser');
  if v_uni is null then
    raise exception 'careers staff only' using errcode = '42501';
  end if;
  return v_uni;
end;
$$;

/* ---------------------------------------------------------------- institution configuration */

-- One row per university; no row means the defaults. Branding is words and one colour: an externally hosted logo would
-- tell a third party each time a student opened a page. There is deliberately no column here that a scorer could read.
create table public.institution_settings (
  university_id uuid primary key references public.universities (id) on delete cascade,
  brand_name text check (char_length(brand_name) between 2 and 80 and brand_name !~ '[[:cntrl:]]'),
  brand_colour text check (brand_colour ~ '^#[0-9A-Fa-f]{6}$'),
  welcome_message text check (char_length(welcome_message) <= 600),
  -- 'assigned': an adviser sees only sharing students in the programme groups given to them. 'all': every sharing student.
  adviser_scope text not null default 'assigned' check (adviser_scope in ('assigned', 'all')),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

-- Membership is worked out from the record the university imported, so it can't drift from it and stores nothing new.
create table public.programme_groups (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80 and name !~ '[[:cntrl:]]'),
  faculties text[] not null default '{}' check (cardinality(faculties) <= 50),
  courses text[] not null default '{}' check (cardinality(courses) <= 200),
  created_at timestamptz not null default now(),
  unique (id, university_id),
  unique (university_id, name)
);

create table public.institution_resources (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities (id) on delete cascade,
  -- Null: everyone at the university. A group can't be deleted while a resource is scoped to it, because the alternative
  -- would quietly show that resource to everyone.
  group_id uuid,
  title text not null check (char_length(title) between 2 and 120 and title !~ '[[:cntrl:]]'),
  url text not null check (char_length(url) <= 500 and url ~ '^https://[^[:space:]]+$'),
  description text not null default '' check (char_length(description) <= 400),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  -- The composite key means a resource can only ever point at its own university's group.
  foreign key (group_id, university_id) references public.programme_groups (id, university_id)
);
create index institution_resources_uni_idx on public.institution_resources (university_id);

create table public.institution_contacts (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities (id) on delete cascade,
  label text not null check (char_length(label) between 2 and 80 and label !~ '[[:cntrl:]]'),
  purpose text not null default '' check (char_length(purpose) <= 300),
  email text check (email ~ '^[^@[:space:]]+@[^@[:space:]]+$' and char_length(email) <= 200),
  phone text check (char_length(phone) <= 40 and phone !~ '[[:cntrl:]]'),
  url text check (char_length(url) <= 500 and url ~ '^https://[^[:space:]]+$'),
  hours text check (char_length(hours) <= 120 and hours !~ '[[:cntrl:]]'),
  created_at timestamptz not null default now(),
  -- A contact nobody can reach is not a contact.
  check (email is not null or phone is not null or url is not null)
);
create index institution_contacts_uni_idx on public.institution_contacts (university_id);

create table public.adviser_group_assignments (
  adviser_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid not null,
  university_id uuid not null,
  primary key (adviser_id, group_id),
  foreign key (group_id, university_id) references public.programme_groups (id, university_id) on delete cascade
);

-- Stepping out of the adviser role removes their groups, so that a later re-appointment starts from nothing.
create function public.clear_adviser_groups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.adviser_group_assignments where adviser_id = new.id;
  return new;
end;
$$;
create trigger profiles_adviser_groups_cleared after update of role on public.profiles
  for each row when (old.role = 'adviser' and new.role <> 'adviser') execute function public.clear_adviser_groups();

/* ---------------------------------------------------------------- who can see whom */

create function public.in_programme_group(p_faculty text, p_course text, p_group public.programme_groups)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(coalesce(p_faculty, ''))) = any (select lower(btrim(f)) from unnest(p_group.faculties) f where btrim(f) <> '')
      or lower(btrim(coalesce(p_course, ''))) = any (select lower(btrim(c)) from unnest(p_group.courses) c where btrim(c) <> '');
$$;

-- The one definition of an adviser's population: read on every call, so consent and role changes bite immediately.
-- Careers admins see every student at their university who shares progress. Advisers see the same people, narrowed by
-- the university's policy. Nobody sees a student who doesn't share, or anyone at another university.
create function public.staff_can_see(p_actor uuid, p_student uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles a
    join public.profiles s on s.university_id = a.university_id
    where a.id = p_actor and s.id = p_student and a.university_id is not null
      and s.role = 'student' and s.share_progress
      and (
        a.role = 'admin'
        or (a.role = 'adviser' and (
          coalesce((select i.adviser_scope from public.institution_settings i where i.university_id = a.university_id), 'assigned') = 'all'
          or exists (
            select 1 from public.adviser_group_assignments ga join public.programme_groups g on g.id = ga.group_id
            where ga.adviser_id = a.id and public.in_programme_group(s.faculty, s.course, g)
          )
        ))
      )
  );
$$;

/* ---------------------------------------------------------------- the access trail */

-- Durable, unlike application logs (30 days at most), and written in the same transaction as the access it records.
-- There is no column for an IP address, browser or location: this says who looked at whom, not where they were.
-- When a student deletes their account, student_id goes null and the row stays, naming the member of staff and the
-- action but no longer anybody it can be tied to. target_id holds only what was asked for and refused.
create table public.staff_access_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  university_id uuid not null references public.universities (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text not null,
  actor_role text not null,
  student_id uuid references public.profiles (id) on delete set null,
  report_id uuid,
  target_id uuid,
  action text not null check (action in (
    'view_student', 'open_cv', 'add_note', 'record_disagreement', 'withdraw_disagreement',
    'create_referral', 'update_referral', 'export_students', 'export_outcomes', 'export_access_log',
    'change_configuration', 'change_role'
  )),
  outcome text not null check (outcome in ('granted', 'denied')),
  detail jsonb not null default '{}'::jsonb check (pg_column_size(detail) <= 2000)
);
create index staff_access_log_uni_idx on public.staff_access_log (university_id, at desc);
create index staff_access_log_student_idx on public.staff_access_log (student_id, at desc);

-- Writes one row. Not callable by signed-in users: only the functions below, in their own transaction, reach it.
-- A denied attempt names the student only if they are at the actor's own university, so that a guessed id from another
-- university leaves nothing readable about that student on this side, or on theirs.
create function public.log_staff_access(p_actor uuid, p_uni uuid, p_student uuid, p_report uuid, p_target uuid, p_action text, p_outcome text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_role text;
begin
  select full_name, role into v_name, v_role from public.profiles where id = p_actor;
  insert into public.staff_access_log (university_id, actor_id, actor_name, actor_role, student_id, report_id, target_id, action, outcome, detail)
  values (
    p_uni, p_actor, coalesce(v_name, 'Offerpath operator'), coalesce(v_role, 'operator'),
    case when exists (select 1 from public.profiles s where s.id = p_student and s.university_id = p_uni) then p_student end,
    p_report, p_target, p_action, p_outcome, coalesce(p_detail, '{}'::jsonb)
  );
end;
$$;

/* ---------------------------------------------------------------- disagreement */

-- An adviser's view of the automated feedback, beside it and never in place of it. The report is not touched. The
-- snapshot holds what the automated judgment said at that moment, so the record still makes sense if the report is
-- re-scored or the rules change. A change of mind is a new row (kind 'withdrawal'), not an edit.
create table public.adviser_disagreements (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  report_id uuid not null references public.reports (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  author_name text not null,
  author_role text not null,
  kind text not null default 'disagreement' check (kind in ('disagreement', 'withdrawal')),
  withdraws_id uuid references public.adviser_disagreements (id) on delete cascade,
  target_kind text not null check (target_kind in ('score', 'area', 'check')),
  target_key text not null default '' check (char_length(target_key) <= 60),
  judgment_snapshot jsonb not null,
  rationale text not null check (char_length(rationale) between 10 and 2000),
  created_at timestamptz not null default now(),
  check ((kind = 'withdrawal') = (withdraws_id is not null))
);
create index adviser_disagreements_student_idx on public.adviser_disagreements (student_id, created_at desc);
create index adviser_disagreements_report_idx on public.adviser_disagreements (report_id);

/* ---------------------------------------------------------------- referrals */

-- Who is holding what. 'proposed' waits for the student, who can accept or decline. After that the owner has it.
create table public.adviser_referrals (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  report_id uuid references public.reports (id) on delete set null,
  contact_id uuid references public.institution_contacts (id) on delete set null,
  -- Kept as written, so a referral still reads correctly after the contact is edited or removed.
  target_label text not null check (char_length(target_label) between 2 and 80),
  reason text not null check (char_length(reason) between 10 and 1000),
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'in_progress', 'closed', 'declined', 'withdrawn')),
  owner_id uuid references public.profiles (id) on delete set null,
  owner_name text,
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index adviser_referrals_student_idx on public.adviser_referrals (student_id, created_at desc);
create index adviser_referrals_owner_idx on public.adviser_referrals (owner_id, status);

-- Every change of status or owner, with who made it. The referral's current state is on the row above; its history is here.
create table public.adviser_referral_events (
  id bigint generated always as identity primary key,
  referral_id uuid not null references public.adviser_referrals (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text not null,
  actor_kind text not null check (actor_kind in ('student', 'staff')),
  from_status text,
  to_status text not null,
  from_owner text,
  to_owner text,
  note text check (char_length(note) <= 1000),
  at timestamptz not null default now()
);
create index adviser_referral_events_referral_idx on public.adviser_referral_events (referral_id, at);

-- When the student last opened their careers service page: what makes something "new" for them.
alter table public.profiles add column casework_seen_at timestamptz;

/* ---------------------------------------------------------------- history can't be rewritten */

-- Applies to everyone, including the service role. The one permitted change is a foreign key going null because the
-- person it names deleted their account; every other column must stay exactly as it was. Rows go only by cascade from
-- the student's account or report (their right to erasure) or, for the log, the retention job.
create function public.refuse_history_rewrite()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_key text;
begin
  for v_key in select jsonb_object_keys(v_old) loop
    if v_old -> v_key is distinct from v_new -> v_key
       and not (v_key = any (tg_argv) and v_new -> v_key = 'null'::jsonb) then
      raise exception '% is append-only: % can''t be changed', tg_table_name, v_key using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;
create trigger adviser_disagreements_append_only before update on public.adviser_disagreements
  for each row execute function public.refuse_history_rewrite('author_id');
create trigger adviser_referral_events_append_only before update on public.adviser_referral_events
  for each row execute function public.refuse_history_rewrite('actor_id');
create trigger staff_access_log_append_only before update on public.staff_access_log
  for each row execute function public.refuse_history_rewrite('actor_id', 'student_id');

alter table public.institution_settings enable row level security;
alter table public.programme_groups enable row level security;
alter table public.institution_resources enable row level security;
alter table public.institution_contacts enable row level security;
alter table public.adviser_group_assignments enable row level security;
alter table public.staff_access_log enable row level security;
alter table public.adviser_disagreements enable row level security;
alter table public.adviser_referrals enable row level security;
alter table public.adviser_referral_events enable row level security;
revoke all on public.institution_settings, public.programme_groups, public.institution_resources, public.institution_contacts,
  public.adviser_group_assignments, public.staff_access_log, public.adviser_disagreements, public.adviser_referrals,
  public.adviser_referral_events from public, anon, authenticated;
-- The retention job reads nothing here, and deletes only old log rows.
revoke all on public.staff_access_log from service_role;
grant select, delete on public.staff_access_log to service_role;
revoke all on public.adviser_disagreements, public.adviser_referral_events from service_role;

/* ---------------------------------------------------------------- existing adviser functions, now scoped and logged */

-- A student's details for careers staff. Null if they can't see this student. Area and check scores only: the summary,
-- detail and extras on a saved check can quote the CV, and reading the CV is a separate permission.
create or replace function public.admin_student_detail(p_student uuid)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.staff_university();
  v_actor uuid := (select auth.uid());
  v_result json;
begin
  if not public.staff_can_see(v_actor, p_student) then
    perform public.log_staff_access(v_actor, v_uni, p_student, null, p_student, 'view_student', 'denied');
    return null;
  end if;
  select json_build_object(
    'key', p.id,
    'studentNumber', coalesce(p.student_number, left(p.id::text, 7)),
    'name', p.full_name,
    'course', p.course, 'year', p.year_of_study, 'faculty', p.faculty, 'feeStatus', p.fee_status,
    'stage', p.stage, 'sectors', p.sectors,
    'cvSharing', p.adviser_can_view_cv,
    'lastActive', p.last_active_at,
    'reports', coalesce((
      select json_agg(json_build_object(
        'id', r.id, 'title', r.title, 'score', r.score, 'createdAt', r.created_at,
        'areas', (
          select json_agg(json_build_object(
            'key', a ->> 'key', 'name', a ->> 'name', 'score', (a ->> 'score')::numeric,
            'checks', (
              select json_agg(json_build_object('key', c ->> 'key', 'name', c ->> 'name', 'score', (c ->> 'score')::numeric))
              from jsonb_array_elements(case when jsonb_typeof(a -> 'checks') = 'array' then a -> 'checks' else '[]'::jsonb end) c
            )
          ))
          from jsonb_array_elements(case when jsonb_typeof(r.payload -> 'analysis' -> 'areas') = 'array' then r.payload -> 'analysis' -> 'areas' else '[]'::jsonb end) a
        ),
        'hasFile', r.storage_path is not null and p.adviser_can_view_cv
      ) order by r.created_at desc)
      from (select * from public.reports where user_id = p.id and type = 'cv_review' order by created_at desc limit 10) r
    ), '[]'::json),
    'notes', coalesce((
      select json_agg(json_build_object('id', n.id, 'reportId', n.report_id, 'author', n.author_name, 'note', n.note, 'createdAt', n.created_at) order by n.created_at desc)
      from public.adviser_notes n where n.student_id = p.id
    ), '[]'::json),
    'disagreements', coalesce((
      select json_agg(json_build_object(
        'id', d.id, 'reportId', d.report_id, 'author', d.author_name, 'authorRole', d.author_role, 'kind', d.kind, 'withdrawsId', d.withdraws_id,
        'targetKind', d.target_kind, 'targetKey', d.target_key, 'judgment', d.judgment_snapshot, 'rationale', d.rationale, 'createdAt', d.created_at
      ) order by d.created_at desc)
      from public.adviser_disagreements d where d.student_id = p.id
    ), '[]'::json),
    'referrals', coalesce((
      select json_agg(json_build_object(
        'id', x.id, 'reportId', x.report_id, 'target', x.target_label, 'reason', x.reason, 'status', x.status,
        'ownerId', x.owner_id, 'owner', x.owner_name, 'createdBy', x.created_by_name, 'createdAt', x.created_at, 'updatedAt', x.updated_at,
        'events', coalesce((
          select json_agg(json_build_object('actor', e.actor_name, 'actorKind', e.actor_kind, 'from', e.from_status, 'to', e.to_status, 'fromOwner', e.from_owner, 'toOwner', e.to_owner, 'note', e.note, 'at', e.at) order by e.at, e.id)
          from public.adviser_referral_events e where e.referral_id = x.id
        ), '[]'::json)
      ) order by x.created_at desc)
      from public.adviser_referrals x where x.student_id = p.id
    ), '[]'::json),
    -- Who a referral could be handed to: staff who could see this student anyway.
    'staff', coalesce((
      select json_agg(json_build_object('id', o.id, 'name', o.full_name, 'role', o.role) order by o.full_name)
      from public.profiles o
      where o.university_id = v_uni and o.role in ('admin', 'adviser') and public.staff_can_see(o.id, p.id)
    ), '[]'::json)
  ) into v_result
  from public.profiles p
  where p.id = p_student;
  perform public.log_staff_access(v_actor, v_uni, p_student, null, null, 'view_student', 'granted');
  return v_result;
end;
$$;

-- The storage path of a CV, with the access logged in the same transaction. The path alone opens nothing: signing a
-- link needs the service role, and the app does that only with ADVISER_CV_ACCESS on. A refused attempt is logged too,
-- and returns null rather than raising, so that the log entry survives.
create or replace function public.admin_cv_path(p_report uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.staff_university();
  v_actor uuid := (select auth.uid());
  v_student uuid;
  v_path text;
begin
  select r.user_id into v_student from public.reports r where r.id = p_report and r.type = 'cv_review';
  select r.storage_path into v_path
  from public.reports r join public.profiles p on p.id = r.user_id
  where r.id = p_report and r.type = 'cv_review' and p.adviser_can_view_cv and public.staff_can_see(v_actor, r.user_id);
  if v_path is null then
    perform public.log_staff_access(v_actor, v_uni, v_student, null, p_report, 'open_cv', 'denied');
    return null;
  end if;
  perform public.log_staff_access(v_actor, v_uni, v_student, p_report, null, 'open_cv', 'granted');
  return v_path;
end;
$$;

-- Notes attach to CV reviews, the only reports careers staff can read. This also closes OP-018's open question: a
-- LinkedIn report id, or any other type, is now refused as not found.
create or replace function public.admin_add_note(p_report uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.staff_university();
  v_actor uuid := (select auth.uid());
  v_student uuid;
  v_id uuid;
begin
  select r.user_id into v_student from public.reports r where r.id = p_report and r.type = 'cv_review';
  -- Raises, as it always has, so a refused note isn't logged: the entry would roll back with the error.
  if v_student is null or not public.staff_can_see(v_actor, v_student) then
    raise exception 'report not found' using errcode = '22023';
  end if;
  insert into public.adviser_notes (report_id, student_id, author_id, author_name, university_id, note)
  values (p_report, v_student, v_actor, (select full_name from public.profiles where id = v_actor), v_uni, btrim(p_note))
  returning id into v_id;
  perform public.log_staff_access(v_actor, v_uni, v_student, p_report, null, 'add_note', 'granted');
  return v_id;
end;
$$;

-- Same as 20261027190000_adviser.sql, except that the population is narrowed to what this member of staff may see.
-- The list isn't logged row by row: opening a student and exporting are. It carries no CV content.
create or replace function public.admin_students(
  p_filter text default 'all', p_search text default '', p_faculty text default '',
  p_limit integer default 50, p_offset integer default 0
)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.staff_university();
  v_actor uuid := (select auth.uid());
  v_search text := lower(left(coalesce(p_search, ''), 80));
  v_result json;
begin
  with f as (
    select s.*, public.student_flag(s) as flag from public.admin_student_facts(v_uni) s
    where public.staff_can_see(v_actor, s.user_id)
  ),
  base as (
    select * from f
    where (coalesce(p_faculty, '') = '' or faculty = p_faculty)
      and (v_search = '' or position(v_search in lower(student_number || ' ' || course)) > 0)
  ),
  filtered as (
    select * from base
    where case coalesce(p_filter, 'all')
      when 'needs' then flag <> ''
      when 'home' then fee_status = 'Home'
      when 'international' then fee_status = 'International'
      else true end
  )
  select json_build_object(
    'total', (select count(*) from filtered),
    'counts', json_build_object(
      'all', (select count(*) from base),
      'needs', (select count(*) from base where flag <> ''),
      'home', (select count(*) from base where fee_status = 'Home'),
      'international', (select count(*) from base where fee_status = 'International')
    ),
    'faculties', coalesce((select json_agg(distinct faculty order by faculty) from f), '[]'::json),
    'rows', coalesce((
      select json_agg(json_build_object(
        'key', user_id, 'id', student_number, 'course', course, 'year', year_of_study, 'status', fee_status, 'faculty', faculty,
        'score', latest_score,
        'change', case when cv_count > 0 then latest_score - first_score end,
        'lastActive', case
          when last_active_at::date = current_date then 'Today'
          when last_active_at::date = current_date - 1 then 'Yesterday'
          else (current_date - last_active_at::date) || ' days ago' end,
        'flag', flag
      ))
      from (select * from filtered order by last_active_at desc limit least(greatest(p_limit, 1), 5000) offset greatest(p_offset, 0)) page
    ), '[]'::json)
  ) into v_result;
  return v_result;
end;
$$;

/* ---------------------------------------------------------------- recording disagreement */

create function public.admin_record_disagreement(p_report uuid, p_target_kind text, p_target_key text, p_rationale text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.staff_university();
  v_actor uuid := (select auth.uid());
  v_rep record;
  v_key text := btrim(coalesce(p_target_key, ''));
  v_rationale text := btrim(coalesce(p_rationale, ''));
  v_item jsonb;
  v_snapshot jsonb;
  v_id uuid;
begin
  select r.id, r.user_id, r.score, r.created_at, r.payload into v_rep from public.reports r where r.id = p_report and r.type = 'cv_review';
  if v_rep.id is null or not public.staff_can_see(v_actor, v_rep.user_id) then
    perform public.log_staff_access(v_actor, v_uni, v_rep.user_id, null, p_report, 'record_disagreement', 'denied');
    return null;
  end if;
  if char_length(v_rationale) not between 10 and 2000 then
    raise exception 'rationale required' using errcode = '22023';
  end if;

  -- What the automated judgment said, read from the report here: the caller supplies only which part they mean.
  if p_target_kind = 'score' then
    v_key := '';
    v_snapshot := jsonb_build_object('score', v_rep.score);
  elsif p_target_kind = 'area' then
    select a into v_item from jsonb_array_elements(case when jsonb_typeof(v_rep.payload -> 'analysis' -> 'areas') = 'array' then v_rep.payload -> 'analysis' -> 'areas' else '[]'::jsonb end) a where a ->> 'key' = v_key limit 1;
    if v_item is null then raise exception 'unknown part of the report' using errcode = '22023'; end if;
    v_snapshot := jsonb_build_object('name', v_item ->> 'name', 'score', v_item -> 'score');
  elsif p_target_kind = 'check' then
    select c into v_item
    from jsonb_array_elements(case when jsonb_typeof(v_rep.payload -> 'analysis' -> 'areas') = 'array' then v_rep.payload -> 'analysis' -> 'areas' else '[]'::jsonb end) a,
      lateral jsonb_array_elements(case when jsonb_typeof(a -> 'checks') = 'array' then a -> 'checks' else '[]'::jsonb end) c
    where c ->> 'key' = v_key limit 1;
    if v_item is null then raise exception 'unknown part of the report' using errcode = '22023'; end if;
    v_snapshot := jsonb_build_object('name', v_item ->> 'name', 'score', v_item -> 'score');
  else
    raise exception 'unknown part of the report' using errcode = '22023';
  end if;
  v_snapshot := v_snapshot || jsonb_build_object('reportScore', v_rep.score, 'reportDate', v_rep.created_at, 'scoring', v_rep.payload -> 'analysis' -> 'meta' -> 'scoring' -> 'identity');

  insert into public.adviser_disagreements (university_id, student_id, report_id, author_id, author_name, author_role, target_kind, target_key, judgment_snapshot, rationale)
  select v_uni, v_rep.user_id, p_report, v_actor, a.full_name, a.role, p_target_kind, v_key, v_snapshot, v_rationale
  from public.profiles a where a.id = v_actor
  returning id into v_id;
  perform public.log_staff_access(v_actor, v_uni, v_rep.user_id, p_report, null, 'record_disagreement', 'granted', jsonb_build_object('kind', p_target_kind, 'key', v_key));
  return v_id;
end;
$$;

-- Adds a withdrawal; the original stays. Only its author or a careers admin, and only for a student still in view.
create function public.admin_withdraw_disagreement(p_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.staff_university();
  v_actor uuid := (select auth.uid());
  v_row public.adviser_disagreements;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id uuid;
begin
  select * into v_row from public.adviser_disagreements d where d.id = p_id and d.university_id = v_uni and d.kind = 'disagreement';
  if v_row.id is null or not public.staff_can_see(v_actor, v_row.student_id)
     or not (v_row.author_id = v_actor or exists (select 1 from public.profiles a where a.id = v_actor and a.role = 'admin')) then
    perform public.log_staff_access(v_actor, v_uni, v_row.student_id, null, p_id, 'withdraw_disagreement', 'denied');
    return null;
  end if;
  if char_length(v_reason) not between 10 and 2000 then
    raise exception 'rationale required' using errcode = '22023';
  end if;
  if exists (select 1 from public.adviser_disagreements d where d.withdraws_id = p_id) then
    raise exception 'already withdrawn' using errcode = '22023';
  end if;
  insert into public.adviser_disagreements (university_id, student_id, report_id, author_id, author_name, author_role, kind, withdraws_id, target_kind, target_key, judgment_snapshot, rationale)
  select v_uni, v_row.student_id, v_row.report_id, v_actor, a.full_name, a.role, 'withdrawal', p_id, v_row.target_kind, v_row.target_key, v_row.judgment_snapshot, v_reason
  from public.profiles a where a.id = v_actor
  returning id into v_id;
  perform public.log_staff_access(v_actor, v_uni, v_row.student_id, v_row.report_id, null, 'withdraw_disagreement', 'granted');
  return v_id;
end;
$$;

/* ---------------------------------------------------------------- referrals */

create function public.admin_create_referral(p_student uuid, p_report uuid, p_contact uuid, p_target text, p_reason text, p_owner uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.staff_university();
  v_actor uuid := (select auth.uid());
  v_owner uuid := coalesce(p_owner, v_actor);
  v_target text := btrim(coalesce(p_target, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_actor_name text;
  v_owner_name text;
  v_id uuid;
begin
  if not public.staff_can_see(v_actor, p_student) then
    perform public.log_staff_access(v_actor, v_uni, p_student, null, p_student, 'create_referral', 'denied');
    return null;
  end if;
  if p_report is not null and not exists (select 1 from public.reports r where r.id = p_report and r.user_id = p_student and r.type = 'cv_review') then
    raise exception 'report not found' using errcode = '22023';
  end if;
  if p_contact is not null then
    select label into v_target from public.institution_contacts c where c.id = p_contact and c.university_id = v_uni;
    if v_target is null then raise exception 'contact not found' using errcode = '22023'; end if;
  end if;
  if char_length(v_target) not between 2 and 80 or char_length(v_reason) not between 10 and 1000 then
    raise exception 'target and reason required' using errcode = '22023';
  end if;
  -- An owner is someone who could open this student's page anyway, so handing it on can't widen who knows about them.
  if not public.staff_can_see(v_owner, p_student) then
    raise exception 'that person can''t take this on' using errcode = '22023';
  end if;
  select full_name into v_actor_name from public.profiles where id = v_actor;
  select full_name into v_owner_name from public.profiles where id = v_owner;
  insert into public.adviser_referrals (university_id, student_id, report_id, contact_id, target_label, reason, owner_id, owner_name, created_by, created_by_name)
  values (v_uni, p_student, p_report, p_contact, v_target, v_reason, v_owner, v_owner_name, v_actor, v_actor_name)
  returning id into v_id;
  insert into public.adviser_referral_events (referral_id, actor_id, actor_name, actor_kind, to_status, to_owner)
  values (v_id, v_actor, v_actor_name, 'staff', 'proposed', v_owner_name);
  perform public.log_staff_access(v_actor, v_uni, p_student, p_report, null, 'create_referral', 'granted');
  return v_id;
end;
$$;

-- The owner or a careers admin moves a referral on. 'accepted' and 'declined' are the student's words, so staff can't
-- say them: staff can withdraw a proposal, start accepted work, and close it. Ownership can pass to anyone who can see
-- the student. Returns null, after logging, if this person can't act on it.
create function public.admin_update_referral(p_id uuid, p_status text, p_owner uuid, p_note text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.staff_university();
  v_actor uuid := (select auth.uid());
  v_row public.adviser_referrals;
  v_actor_row public.profiles;
  v_status text;
  v_owner uuid;
  v_owner_name text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_row from public.adviser_referrals x where x.id = p_id and x.university_id = v_uni;
  select * into v_actor_row from public.profiles a where a.id = v_actor;
  if v_row.id is null or not public.staff_can_see(v_actor, v_row.student_id)
     or not (v_row.owner_id = v_actor or v_actor_row.role = 'admin') then
    perform public.log_staff_access(v_actor, v_uni, v_row.student_id, v_row.report_id, p_id, 'update_referral', 'denied');
    return null;
  end if;
  v_status := coalesce(p_status, v_row.status);
  v_owner := coalesce(p_owner, v_row.owner_id);
  if v_status <> v_row.status and not (
    (v_row.status = 'proposed' and v_status = 'withdrawn')
    or (v_row.status = 'accepted' and v_status in ('in_progress', 'closed'))
    or (v_row.status = 'in_progress' and v_status = 'closed')
  ) then
    raise exception 'that step isn''t possible from here' using errcode = '22023';
  end if;
  if v_owner is distinct from v_row.owner_id then
    if v_owner is null or not public.staff_can_see(v_owner, v_row.student_id) then
      raise exception 'that person can''t take this on' using errcode = '22023';
    end if;
  end if;
  select full_name into v_owner_name from public.profiles where id = v_owner;
  if v_status = v_row.status and v_owner is not distinct from v_row.owner_id and v_note is null then
    return true;
  end if;
  update public.adviser_referrals set status = v_status, owner_id = v_owner, owner_name = coalesce(v_owner_name, owner_name), updated_at = now() where id = p_id;
  insert into public.adviser_referral_events (referral_id, actor_id, actor_name, actor_kind, from_status, to_status, from_owner, to_owner, note)
  values (p_id, v_actor, v_actor_row.full_name, 'staff', v_row.status, v_status, v_row.owner_name, coalesce(v_owner_name, v_row.owner_name), v_note);
  perform public.log_staff_access(v_actor, v_uni, v_row.student_id, v_row.report_id, null, 'update_referral', 'granted', jsonb_build_object('status', v_status));
  return true;
end;
$$;

-- The caller's queue: referrals they own (for a careers admin, every referral at the university, including any whose
-- owner has left). A referral whose student has stopped sharing is counted, not shown.
create function public.admin_casework()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.staff_university();
  v_actor uuid := (select auth.uid());
  v_admin boolean := exists (select 1 from public.profiles a where a.id = v_actor and a.role = 'admin');
begin
  return (
    with mine as (
      select x.*, public.staff_can_see(v_actor, x.student_id) as visible
      from public.adviser_referrals x
      where x.university_id = v_uni and x.status in ('proposed', 'accepted', 'in_progress') and (v_admin or x.owner_id = v_actor)
    )
    select json_build_object(
      'hidden', (select count(*) from mine where not visible),
      'referrals', coalesce((
        select json_agg(json_build_object(
          'id', m.id, 'studentKey', m.student_id, 'studentNumber', coalesce(p.student_number, left(p.id::text, 7)),
          'target', m.target_label, 'reason', m.reason, 'status', m.status, 'owner', m.owner_name, 'ownerGone', m.owner_id is null,
          'mine', m.owner_id = v_actor, 'createdAt', m.created_at, 'updatedAt', m.updated_at
        ) order by m.updated_at desc)
        from mine m join public.profiles p on p.id = m.student_id
        where m.visible
      ), '[]'::json)
    )
  );
end;
$$;

/* ---------------------------------------------------------------- exports and the trail itself */

-- The export route calls this before it builds a file, with what was asked for and how many rows it has. If the entry
-- can't be written, there is no file. Search text isn't kept, because it can be a student number.
create function public.admin_record_export(p_kind text, p_rows integer, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
begin
  if p_kind not in ('export_students', 'export_outcomes', 'export_access_log') then
    raise exception 'unknown export' using errcode = '22023';
  end if;
  perform public.log_staff_access((select auth.uid()), v_uni, null, null, null, p_kind, 'granted',
    jsonb_build_object('rows', greatest(coalesce(p_rows, 0), 0)) || (coalesce(p_detail, '{}'::jsonb) - 'q' - 'search'));
end;
$$;

-- Careers admins only. A student who has stopped sharing appears without their number: the entry is still there, but
-- the log doesn't become a way round withdrawn consent.
create function public.admin_access_log(p_limit integer default 100, p_offset integer default 0)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
begin
  return coalesce((
    select json_agg(json_build_object(
      'at', l.at, 'actor', l.actor_name, 'actorRole', l.actor_role, 'action', l.action, 'outcome', l.outcome,
      'student', case
        when l.student_id is null then null
        when p.share_progress then coalesce(p.student_number, left(p.id::text, 7))
        else 'Not sharing' end,
      'studentGone', l.action in ('view_student', 'open_cv', 'add_note', 'record_disagreement', 'withdraw_disagreement', 'create_referral', 'update_referral') and l.outcome = 'granted' and l.student_id is null,
      'detail', l.detail
    ) order by l.at desc, l.id desc)
    from (
      select * from public.staff_access_log where university_id = v_uni order by at desc, id desc
      limit least(greatest(p_limit, 1), 5000) offset greatest(p_offset, 0)
    ) l
    left join public.profiles p on p.id = l.student_id
  ), '[]'::json);
end;
$$;

/* ---------------------------------------------------------------- configuration: careers admins only */

create function public.admin_institution_config()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
begin
  return (
    select json_build_object(
      'universityName', u.name,
      'brandName', i.brand_name, 'brandColour', i.brand_colour, 'welcome', i.welcome_message,
      'adviserScope', coalesce(i.adviser_scope, 'assigned'),
      'reportSharing', u.report_sharing_enabled,
      'contacts', coalesce((select json_agg(json_build_object('id', c.id, 'label', c.label, 'purpose', c.purpose, 'email', c.email, 'phone', c.phone, 'url', c.url, 'hours', c.hours) order by c.label) from public.institution_contacts c where c.university_id = v_uni), '[]'::json),
      'resources', coalesce((select json_agg(json_build_object('id', r.id, 'title', r.title, 'url', r.url, 'description', r.description, 'groupId', r.group_id, 'active', r.active) order by r.title) from public.institution_resources r where r.university_id = v_uni), '[]'::json),
      'groups', coalesce((select json_agg(json_build_object('id', g.id, 'name', g.name, 'faculties', g.faculties, 'courses', g.courses) order by g.name) from public.programme_groups g where g.university_id = v_uni), '[]'::json)
    )
    from public.universities u left join public.institution_settings i on i.university_id = u.id
    where u.id = v_uni
  );
end;
$$;

create function public.admin_save_institution_settings(p_brand_name text, p_brand_colour text, p_welcome text, p_adviser_scope text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
  v_actor uuid := (select auth.uid());
begin
  insert into public.institution_settings (university_id, brand_name, brand_colour, welcome_message, adviser_scope, updated_by)
  values (v_uni, p_brand_name, p_brand_colour, p_welcome, p_adviser_scope, v_actor)
  on conflict (university_id) do update set brand_name = excluded.brand_name, brand_colour = excluded.brand_colour, welcome_message = excluded.welcome_message, adviser_scope = excluded.adviser_scope, updated_by = excluded.updated_by, updated_at = now();
  perform public.log_staff_access(v_actor, v_uni, null, null, null, 'change_configuration', 'granted', jsonb_build_object('what', 'settings', 'adviserScope', p_adviser_scope));
end;
$$;

-- The university can stop bearer links at any moment: that only ever reduces exposure. Starting them isn't here.
-- It stays with the operator until the founder and legal questions in the OP-020 and OP-021 reports are answered.
create function public.admin_stop_report_sharing()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
begin
  update public.universities set report_sharing_enabled = false where id = v_uni;
  perform public.log_staff_access((select auth.uid()), v_uni, null, null, null, 'change_configuration', 'granted', jsonb_build_object('what', 'report_sharing', 'enabled', false));
end;
$$;

create function public.admin_save_contact(p_id uuid, p_label text, p_purpose text, p_email text, p_phone text, p_url text, p_hours text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
  v_id uuid;
begin
  if p_id is null then
    insert into public.institution_contacts (university_id, label, purpose, email, phone, url, hours)
    values (v_uni, p_label, coalesce(p_purpose, ''), p_email, p_phone, p_url, p_hours) returning id into v_id;
  else
    update public.institution_contacts set label = p_label, purpose = coalesce(p_purpose, ''), email = p_email, phone = p_phone, url = p_url, hours = p_hours
    where id = p_id and university_id = v_uni returning id into v_id;
    if v_id is null then raise exception 'not found' using errcode = '22023'; end if;
  end if;
  perform public.log_staff_access((select auth.uid()), v_uni, null, null, v_id, 'change_configuration', 'granted', jsonb_build_object('what', 'contact'));
  return v_id;
end;
$$;

create function public.admin_delete_contact(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
begin
  delete from public.institution_contacts where id = p_id and university_id = v_uni;
  if not found then raise exception 'not found' using errcode = '22023'; end if;
  perform public.log_staff_access((select auth.uid()), v_uni, null, null, p_id, 'change_configuration', 'granted', jsonb_build_object('what', 'contact', 'removed', true));
end;
$$;

create function public.admin_save_resource(p_id uuid, p_title text, p_url text, p_description text, p_group uuid, p_active boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
  v_id uuid;
begin
  if p_group is not null and not exists (select 1 from public.programme_groups g where g.id = p_group and g.university_id = v_uni) then
    raise exception 'not found' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.institution_resources (university_id, group_id, title, url, description, active)
    values (v_uni, p_group, p_title, p_url, coalesce(p_description, ''), coalesce(p_active, true)) returning id into v_id;
  else
    update public.institution_resources set group_id = p_group, title = p_title, url = p_url, description = coalesce(p_description, ''), active = coalesce(p_active, true)
    where id = p_id and university_id = v_uni returning id into v_id;
    if v_id is null then raise exception 'not found' using errcode = '22023'; end if;
  end if;
  perform public.log_staff_access((select auth.uid()), v_uni, null, null, v_id, 'change_configuration', 'granted', jsonb_build_object('what', 'resource'));
  return v_id;
end;
$$;

create function public.admin_delete_resource(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
begin
  delete from public.institution_resources where id = p_id and university_id = v_uni;
  if not found then raise exception 'not found' using errcode = '22023'; end if;
  perform public.log_staff_access((select auth.uid()), v_uni, null, null, p_id, 'change_configuration', 'granted', jsonb_build_object('what', 'resource', 'removed', true));
end;
$$;

create function public.admin_save_group(p_id uuid, p_name text, p_faculties text[], p_courses text[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
  v_id uuid;
begin
  if p_id is null then
    insert into public.programme_groups (university_id, name, faculties, courses)
    values (v_uni, p_name, coalesce(p_faculties, '{}'), coalesce(p_courses, '{}')) returning id into v_id;
  else
    update public.programme_groups set name = p_name, faculties = coalesce(p_faculties, '{}'), courses = coalesce(p_courses, '{}')
    where id = p_id and university_id = v_uni returning id into v_id;
    if v_id is null then raise exception 'not found' using errcode = '22023'; end if;
  end if;
  perform public.log_staff_access((select auth.uid()), v_uni, null, null, v_id, 'change_configuration', 'granted', jsonb_build_object('what', 'programme_group'));
  return v_id;
end;
$$;

create function public.admin_delete_group(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
begin
  if exists (select 1 from public.institution_resources r where r.group_id = p_id and r.university_id = v_uni) then
    raise exception 'group has resources' using errcode = '22023';
  end if;
  delete from public.programme_groups where id = p_id and university_id = v_uni;
  if not found then raise exception 'not found' using errcode = '22023'; end if;
  perform public.log_staff_access((select auth.uid()), v_uni, null, null, p_id, 'change_configuration', 'granted', jsonb_build_object('what', 'programme_group', 'removed', true));
end;
$$;

/* ---------------------------------------------------------------- the adviser team: careers admins only */

create function public.admin_list_advisers()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
begin
  return json_build_object(
    'advisers', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'email', p.email, 'name', p.full_name,
        'groupIds', coalesce((select json_agg(a.group_id) from public.adviser_group_assignments a where a.adviser_id = p.id), '[]'::json)
      ) order by p.full_name)
      from public.profiles p where p.university_id = v_uni and p.role = 'adviser'
    ), '[]'::json),
    'pending', coalesce((select json_agg(json_build_object('email', q.email, 'invitedAt', q.created_at) order by q.created_at) from public.pending_admins q where q.university_id = v_uni and q.staff_role = 'adviser'), '[]'::json)
  );
end;
$$;

-- Removing the role takes effect on the adviser's next request: every function reads it afresh.
create function public.admin_set_adviser(p_email text, p_adviser boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
  v_actor uuid := (select auth.uid());
  v_domain text;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
  v_role text;
  v_status text;
begin
  select domain into v_domain from public.universities where id = v_uni;
  if not (split_part(v_email, '@', 2) = v_domain or split_part(v_email, '@', 2) like '%.' || v_domain) then
    raise exception 'That email address is not at your university' using errcode = '22023';
  end if;
  select id, role into v_id, v_role from public.profiles where university_id = v_uni and lower(email) = v_email;
  if v_role = 'admin' then
    raise exception 'That person is already a careers admin' using errcode = '22023';
  end if;
  if p_adviser then
    if v_id is not null then
      update public.profiles set role = 'adviser' where id = v_id;
      v_status := 'granted';
    else
      insert into public.pending_admins (university_id, email, invited_by, staff_role) values (v_uni, v_email, v_actor, 'adviser')
      on conflict (university_id, email) do nothing;
      v_status := 'invited';
    end if;
  else
    delete from public.pending_admins where university_id = v_uni and email = v_email and staff_role = 'adviser';
    if v_id is not null and v_role = 'adviser' then
      update public.profiles set role = 'student' where id = v_id;
    end if;
    v_status := 'removed';
  end if;
  perform public.log_staff_access(v_actor, v_uni, null, null, v_id, 'change_role', 'granted', jsonb_build_object('role', 'adviser', 'status', v_status));
  return v_status;
end;
$$;

create function public.admin_set_adviser_groups(p_adviser uuid, p_groups uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
  v_groups uuid[] := coalesce(p_groups, '{}');
begin
  if not exists (select 1 from public.profiles p where p.id = p_adviser and p.university_id = v_uni and p.role = 'adviser') then
    raise exception 'not found' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_groups) g where not exists (select 1 from public.programme_groups pg where pg.id = g and pg.university_id = v_uni)) then
    raise exception 'not found' using errcode = '22023';
  end if;
  delete from public.adviser_group_assignments where adviser_id = p_adviser;
  insert into public.adviser_group_assignments (adviser_id, group_id, university_id)
  select p_adviser, g, v_uni from unnest(v_groups) g on conflict do nothing;
  perform public.log_staff_access((select auth.uid()), v_uni, null, null, p_adviser, 'change_role', 'granted', jsonb_build_object('groups', cardinality(v_groups)));
end;
$$;

-- An invitation now records its role, so one admin invitation can overwrite an earlier adviser one. Otherwise as before.
create or replace function public.admin_set_role(p_email text, p_admin boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
  v_domain text;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
begin
  select domain into v_domain from public.universities where id = v_uni;
  if not (split_part(v_email, '@', 2) = v_domain or split_part(v_email, '@', 2) like '%.' || v_domain) then
    raise exception 'That email address is not at your university' using errcode = '22023';
  end if;
  select id into v_id from public.profiles where university_id = v_uni and lower(email) = v_email;

  if p_admin then
    if v_id is not null then
      update public.profiles set role = 'admin' where id = v_id;
      perform public.log_staff_access((select auth.uid()), v_uni, null, null, v_id, 'change_role', 'granted', jsonb_build_object('role', 'admin', 'status', 'granted'));
      return 'granted';
    end if;
    insert into public.pending_admins (university_id, email, invited_by, staff_role) values (v_uni, v_email, (select auth.uid()), 'admin')
    on conflict (university_id, email) do update set staff_role = 'admin';
    perform public.log_staff_access((select auth.uid()), v_uni, null, null, null, 'change_role', 'granted', jsonb_build_object('role', 'admin', 'status', 'invited'));
    return 'invited';
  end if;

  delete from public.pending_admins where university_id = v_uni and email = v_email and staff_role = 'admin';
  if v_id is null then return 'removed'; end if;
  if (select count(*) from public.profiles where university_id = v_uni and role = 'admin') <= 1 and exists (select 1 from public.profiles where id = v_id and role = 'admin') then
    raise exception 'Your university needs at least one careers admin' using errcode = '22023';
  end if;
  -- Only ever an admin: this call used to demote anybody at the university, which now includes advisers.
  update public.profiles set role = 'student' where id = v_id and role = 'admin';
  perform public.log_staff_access((select auth.uid()), v_uni, null, null, v_id, 'change_role', 'granted', jsonb_build_object('role', 'admin', 'status', 'removed'));
  return 'removed';
end;
$$;

-- Admin team page lists admin invitations only; adviser invitations are in admin_list_advisers().
create or replace function public.admin_list_team()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
begin
  return json_build_object(
    'admins', coalesce((select json_agg(json_build_object('email', email, 'name', full_name, 'you', id = (select auth.uid())) order by full_name) from public.profiles where university_id = v_uni and role = 'admin'), '[]'::json),
    'pending', coalesce((select json_agg(json_build_object('email', email, 'invitedAt', created_at) order by created_at) from public.pending_admins where university_id = v_uni and staff_role = 'admin'), '[]'::json)
  );
end;
$$;

/* ---------------------------------------------------------------- what the student sees */

-- Branding, contacts and the resources meant for them. Guidance only: nothing here is read by any scorer.
create function public.my_institution()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
begin
  select * into v_me from public.profiles where id = (select auth.uid());
  if v_me.university_id is null then return null; end if;
  return (
    select json_build_object(
      'universityId', u.id, 'universityName', u.name,
      'brandName', i.brand_name, 'brandColour', i.brand_colour, 'welcome', i.welcome_message,
      'updatedAt', i.updated_at,
      'contacts', coalesce((select json_agg(json_build_object('id', c.id, 'label', c.label, 'purpose', c.purpose, 'email', c.email, 'phone', c.phone, 'url', c.url, 'hours', c.hours) order by c.label) from public.institution_contacts c where c.university_id = u.id), '[]'::json),
      'resources', coalesce((
        select json_agg(json_build_object('id', r.id, 'title', r.title, 'url', r.url, 'description', r.description) order by r.title)
        from public.institution_resources r
        left join public.programme_groups g on g.id = r.group_id
        where r.university_id = u.id and r.active and (r.group_id is null or public.in_programme_group(v_me.faculty, v_me.course, g))
      ), '[]'::json)
    )
    from public.universities u left join public.institution_settings i on i.university_id = u.id
    where u.id = v_me.university_id
  );
end;
$$;

-- Everything careers staff have done about the signed-in student, and every time they looked. Their own rows only.
create function public.my_casework()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  return json_build_object(
    'seenAt', (select casework_seen_at from public.profiles where id = v_me),
    'disagreements', coalesce((
      select json_agg(json_build_object(
        'id', d.id, 'reportId', d.report_id, 'author', d.author_name, 'authorRole', d.author_role, 'kind', d.kind, 'withdrawsId', d.withdraws_id,
        'targetKind', d.target_kind, 'targetKey', d.target_key, 'judgment', d.judgment_snapshot, 'rationale', d.rationale, 'createdAt', d.created_at
      ) order by d.created_at desc)
      from public.adviser_disagreements d where d.student_id = v_me
    ), '[]'::json),
    'referrals', coalesce((
      select json_agg(json_build_object(
        'id', x.id, 'reportId', x.report_id, 'target', x.target_label, 'reason', x.reason, 'status', x.status,
        'owner', x.owner_name, 'createdBy', x.created_by_name, 'createdAt', x.created_at, 'updatedAt', x.updated_at,
        'events', coalesce((
          select json_agg(json_build_object('actor', e.actor_name, 'actorKind', e.actor_kind, 'from', e.from_status, 'to', e.to_status, 'fromOwner', e.from_owner, 'toOwner', e.to_owner, 'note', e.note, 'at', e.at) order by e.at, e.id)
          from public.adviser_referral_events e where e.referral_id = x.id
        ), '[]'::json)
      ) order by x.created_at desc)
      from public.adviser_referrals x where x.student_id = v_me
    ), '[]'::json),
    'access', coalesce((
      select json_agg(json_build_object('at', l.at, 'actor', l.actor_name, 'actorRole', l.actor_role, 'action', l.action) order by l.at desc, l.id desc)
      from (
        select * from public.staff_access_log
        where student_id = v_me and outcome = 'granted' order by at desc, id desc limit 200
      ) l
    ), '[]'::json)
  );
end;
$$;

-- How many things have happened since the student last opened the page. In-app only: nothing is sent anywhere.
create function public.my_casework_unseen()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select id, coalesce(casework_seen_at, 'epoch'::timestamptz) as seen from public.profiles where id = (select auth.uid()))
  select (
    (select count(*) from public.adviser_notes n, me where n.student_id = me.id and n.created_at > me.seen)
    + (select count(*) from public.adviser_disagreements d, me where d.student_id = me.id and d.created_at > me.seen)
    + (select count(*) from public.adviser_referrals x, me where x.student_id = me.id and x.updated_at > me.seen)
  )::integer;
$$;

create function public.mark_casework_seen()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set casework_seen_at = now() where id = (select auth.uid());
$$;

-- The student's answer to a proposed referral. Only theirs, and only while it is waiting for them.
create function public.respond_to_referral(p_id uuid, p_accept boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_row public.adviser_referrals;
  v_status text := case when p_accept then 'accepted' else 'declined' end;
begin
  select * into v_row from public.adviser_referrals where id = p_id and student_id = v_me;
  if v_row.id is null or v_row.status <> 'proposed' then
    return false;
  end if;
  update public.adviser_referrals set status = v_status, updated_at = now() where id = p_id;
  insert into public.adviser_referral_events (referral_id, actor_id, actor_name, actor_kind, from_status, to_status, from_owner, to_owner)
  select p_id, v_me, p.full_name, 'student', 'proposed', v_status, v_row.owner_name, v_row.owner_name from public.profiles p where p.id = v_me;
  return true;
end;
$$;

/* ---------------------------------------------------------------- privileges */

-- Internal: reached only from the functions above.
revoke execute on function public.staff_can_see(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.in_programme_group(text, text, public.programme_groups) from public, anon, authenticated;
revoke execute on function public.log_staff_access(uuid, uuid, uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.clear_adviser_groups() from public, anon, authenticated;
revoke execute on function public.refuse_history_rewrite() from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.staff_university()',
    'public.admin_record_disagreement(uuid, text, text, text)',
    'public.admin_withdraw_disagreement(uuid, text)',
    'public.admin_create_referral(uuid, uuid, uuid, text, text, uuid)',
    'public.admin_update_referral(uuid, text, uuid, text)',
    'public.admin_casework()',
    'public.admin_record_export(text, integer, jsonb)',
    'public.admin_access_log(integer, integer)',
    'public.admin_institution_config()',
    'public.admin_save_institution_settings(text, text, text, text)',
    'public.admin_stop_report_sharing()',
    'public.admin_save_contact(uuid, text, text, text, text, text, text)',
    'public.admin_delete_contact(uuid)',
    'public.admin_save_resource(uuid, text, text, text, uuid, boolean)',
    'public.admin_delete_resource(uuid)',
    'public.admin_save_group(uuid, text, text[], text[])',
    'public.admin_delete_group(uuid)',
    'public.admin_list_advisers()',
    'public.admin_set_adviser(text, boolean)',
    'public.admin_set_adviser_groups(uuid, uuid[])',
    'public.my_institution()',
    'public.my_casework()',
    'public.my_casework_unseen()',
    'public.mark_casework_seen()',
    'public.respond_to_referral(uuid, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
