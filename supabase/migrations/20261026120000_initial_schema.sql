-- Offerpath initial schema: universities, profiles, reports, opportunities, applications, AI usage.
-- Every user-owned table has row-level security. Admin reporting goes through security definer
-- functions that only return consenting students and hide groups smaller than five.


/* ---------------------------------------------------------------- tables */

create table public.universities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null unique,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '' check (char_length(full_name) <= 120),
  role text not null default 'student' check (role in ('student', 'admin')),
  university_id uuid references public.universities (id) on delete set null,
  stage text check (stage in ('first', 'penultimate', 'final', 'graduate')),
  sectors text[] not null default '{}' check (cardinality(sectors) <= 3),
  visa_sponsorship boolean not null default false,
  deadline_reminders boolean not null default true,
  -- Off until the student chooses in onboarding: sharing must be an explicit opt-in (UK GDPR).
  share_progress boolean not null default false,
  adviser_can_view_cv boolean not null default false,
  onboarded_at timestamptz,
  -- Institution-owned fields: set by the university (SSO attributes or import), never by students.
  course text check (char_length(course) <= 120 and course !~ '[[:cntrl:]]'),
  year_of_study text check (char_length(year_of_study) <= 40 and year_of_study !~ '[[:cntrl:]]'),
  fee_status text check (fee_status in ('home', 'international')),
  faculty text check (char_length(faculty) <= 120 and faculty !~ '[[:cntrl:]]'),
  student_number text check (char_length(student_number) <= 40 and student_number !~ '[[:cntrl:]]'),
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index profiles_university_idx on public.profiles (university_id) where role = 'student';

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('cv_review', 'tailor', 'cover_letter')),
  title text not null check (char_length(title) between 1 and 200),
  score integer check (score between 0 and 100),
  payload jsonb not null default '{}'::jsonb,
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reports_user_created_idx on public.reports (user_id, created_at desc);
create index reports_user_type_created_idx on public.reports (user_id, type, created_at desc);

create table public.opportunities (
  id text primary key,
  role text not null,
  org text not null,
  location text not null,
  type text not null check (type in ('Graduate scheme', 'Internship', 'Placement', 'Spring week')),
  sector text not null,
  sponsors_visa boolean not null default false,
  closes_on date not null,
  description text not null default '',
  created_at timestamptz not null default now()
);
create index opportunities_closes_idx on public.opportunities (closes_on);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  opportunity_id text references public.opportunities (id) on delete set null,
  role text not null,
  org text not null,
  status text not null default 'saved' check (status in ('saved', 'applied', 'tests', 'interview', 'offer')),
  closes_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, opportunity_id)
);
create index applications_user_idx on public.applications (user_id, updated_at desc);

create table public.ai_usage (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null default current_date,
  kind text not null check (kind in ('line_rewrite', 'letter', 'cv_score')),
  count integer not null default 0 check (count >= 0),
  primary key (user_id, day, kind)
);

/* ---------------------------------------------------------------- triggers */

-- New sign-ups get a profile, matched to a partner university by email domain.
-- Sign-ups from any other domain are rejected here, so the public auth API can't be used to bypass
-- the app's own partner-university check.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain text := lower(split_part(new.email, '@', 2));
  v_local text := split_part(new.email, '@', 1);
  v_uni uuid;
begin
  select u.id into v_uni
  from public.universities u
  where v_domain = u.domain or v_domain like '%.' || u.domain
  limit 1;

  if v_uni is null then
    raise exception 'Offerpath is only open to partner universities (%)', v_domain using errcode = '42501';
  end if;

  insert into public.profiles (id, email, full_name, university_id)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), initcap(regexp_replace(v_local, '[._-]+', ' ', 'g'))),
    v_uni
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set last_active_at = now() where id = new.user_id;
  return new;
end;
$$;

create trigger reports_touch_activity after insert on public.reports for each row execute function public.touch_activity();
create trigger applications_touch_activity after insert on public.applications for each row execute function public.touch_activity();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger reports_updated_at before update on public.reports for each row execute function public.set_updated_at();

/* ---------------------------------------------------------------- row-level security */

alter table public.universities enable row level security;
alter table public.profiles enable row level security;
alter table public.reports enable row level security;
alter table public.opportunities enable row level security;
alter table public.applications enable row level security;
alter table public.ai_usage enable row level security;

create policy "universities readable when signed in" on public.universities for select to authenticated using (true);
create policy "opportunities readable when signed in" on public.opportunities for select to authenticated using (true);

create policy "read own profile" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "update own profile" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- Students can't change their role, university, email or institution-owned fields.
revoke update on public.profiles from authenticated, anon;
grant update (full_name, stage, sectors, visa_sponsorship, deadline_reminders, share_progress, onboarded_at) on public.profiles to authenticated;

create policy "read own reports" on public.reports for select to authenticated using (user_id = (select auth.uid()));
create policy "create own reports" on public.reports for insert to authenticated with check (user_id = (select auth.uid()));
create policy "update own reports" on public.reports for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "delete own reports" on public.reports for delete to authenticated using (user_id = (select auth.uid()));

create policy "read own applications" on public.applications for select to authenticated using (user_id = (select auth.uid()));
-- Tracking a role goes through the server (it must be a real opportunity); students can only move status.
create policy "update own applications" on public.applications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke insert, update on public.applications from anon, authenticated;
grant update (status, updated_at) on public.applications to authenticated;
create policy "delete own applications" on public.applications for delete to authenticated using (user_id = (select auth.uid()));

create policy "read own ai usage" on public.ai_usage for select to authenticated using (user_id = (select auth.uid()));

/* ---------------------------------------------------------------- functions */

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
  if p_kind not in ('line_rewrite', 'letter', 'cv_score') then
    raise exception 'unknown kind';
  end if;
  insert into public.ai_usage (user_id, day, kind, count)
  values ((select auth.uid()), current_date, p_kind, 1)
  on conflict (user_id, day, kind) do update set count = public.ai_usage.count + 1
  returning count into v_count;
  return v_count;
end;
$$;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in';
  end if;
  -- Cascades to profiles, reports, applications and ai_usage.
  delete from auth.users where id = (select auth.uid());
end;
$$;

-- The caller's university, if they are an admin. Raises otherwise.
create or replace function public.admin_university()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uni uuid;
begin
  select university_id into v_uni from public.profiles where id = (select auth.uid()) and role = 'admin';
  if v_uni is null then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return v_uni;
end;
$$;

-- Per-student facts for consenting students at the admin's university.
create type public.student_fact as (
  user_id uuid,
  student_number text,
  course text,
  year_of_study text,
  fee_status text,
  faculty text,
  created_at timestamptz,
  last_active_at timestamptz,
  cv_count integer,
  first_score integer,
  latest_score integer,
  app_count integer,
  urgent_deadline boolean
);

create or replace function public.admin_student_facts(p_uni uuid)
returns setof public.student_fact
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    coalesce(p.student_number, left(p.id::text, 7)),
    coalesce(p.course, 'Not set'),
    coalesce(p.year_of_study, ''),
    case p.fee_status when 'home' then 'Home' when 'international' then 'International' else 'Not set' end,
    coalesce(p.faculty, 'Not set'),
    p.created_at,
    p.last_active_at,
    coalesce(cv.n, 0),
    cv.first_score,
    cv.latest_score,
    coalesce(ap.n, 0),
    coalesce(ap.urgent, false)
  from public.profiles p
  left join lateral (
    select
      count(*)::int as n,
      (array_agg(r.score order by r.created_at asc))[1] as first_score,
      (array_agg(r.score order by r.created_at desc))[1] as latest_score
    from public.reports r
    where r.user_id = p.id and r.type = 'cv_review' and r.score is not null
  ) cv on true
  left join lateral (
    select count(*)::int as n, bool_or(a.status = 'saved' and a.closes_on between current_date and current_date + 7) as urgent
    from public.applications a
    where a.user_id = p.id
  ) ap on true
  where p.university_id = p_uni and p.role = 'student' and p.share_progress
    -- Only confirmed accounts count: requesting a sign-in link must not create a countable student.
    and exists (select 1 from auth.users u where u.id = p.id and u.email_confirmed_at is not null);
$$;

create or replace function public.student_flag(f public.student_fact)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when f.cv_count = 0 and f.created_at < now() - interval '21 days' then 'No CV yet'
    when f.urgent_deadline and coalesce(f.latest_score, 0) < 50 then 'Deadline soon'
    when f.cv_count >= 3 and f.latest_score - f.first_score <= 2 then 'Not improving'
    when f.last_active_at < now() - interval '30 days' then 'Inactive'
    else ''
  end;
$$;

create or replace function public.admin_overview()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
  v_name text;
  v_result json;
begin
  select name into v_name from public.universities where id = v_uni;

  with f as (
    select s.*, public.student_flag(s) as flag from public.admin_student_facts(v_uni) s
  ),
  scored as (
    select * from f where latest_score is not null
  ),
  weeks as (
    select w.n, (
      select case when count(distinct r.user_id) >= 5 then round(avg(r.score))::int end
      from public.reports r join f on f.user_id = r.user_id
      where r.type = 'cv_review' and r.score is not null
        and r.created_at >= date_trunc('week', now()) - make_interval(weeks => 7 - w.n)
        and r.created_at < date_trunc('week', now()) - make_interval(weeks => 6 - w.n)
    ) as avg
    from generate_series(0, 7) as w(n)
  )
  select json_build_object(
    'universityName', coalesce(v_name, 'Your university'),
    'sample', false,
    'kpis', json_build_object(
      'activeStudents', (select count(*) from f where last_active_at > now() - interval '90 days'),
      'newThisMonth', (select count(*) from f where created_at >= date_trunc('month', now())),
      'avgScore', (select case when count(*) >= 5 then round(avg(latest_score))::int end from scored),
      'avgFirstScore', (select case when count(*) >= 5 then round(avg(first_score))::int end from scored),
      'avgImprovement', (select case when count(*) >= 5 then round(avg(latest_score - first_score))::int end from scored),
      'cvsReviewed', (select coalesce(sum(cv_count), 0) from f),
      'perStudent', (select case when count(*) > 0 then round(sum(cv_count)::numeric / count(*), 1) else 0 end from f),
      'appsTracked', (select coalesce(sum(app_count), 0) from f),
      'needHand', (select count(*) from f where flag <> '')
    ),
    'weekly', (select json_agg(avg order by n) from weeks),
    'bands', (
      select case when count(*) >= 5 then json_build_object(
        'needs', round(100.0 * count(*) filter (where latest_score < 50) / count(*)),
        'getting', round(100.0 * count(*) filter (where latest_score between 50 and 74) / count(*)),
        'strong', round(100.0 * count(*) filter (where latest_score between 75 and 89) / count(*)),
        'ready', round(100.0 * count(*) filter (where latest_score >= 90) / count(*))
      ) end
      from scored
    ),
    'faculties', coalesce((
      select json_agg(json_build_object('name', faculty, 'avg', avg_score, 'improvement', imp) order by avg_score desc)
      from (
        select faculty, round(avg(latest_score))::int as avg_score, round(avg(latest_score - first_score))::int as imp
        from scored group by faculty having count(*) >= 5
      ) x
    ), '[]'::json),
    'homeIntl', (
      select case when count(*) filter (where fee_status = 'Home') >= 5 and count(*) filter (where fee_status = 'International') >= 5 then json_build_array(
        json_build_object('metric', 'Average score',
          'home', coalesce(round(avg(latest_score) filter (where fee_status = 'Home'))::int, 0),
          'intl', coalesce(round(avg(latest_score) filter (where fee_status = 'International'))::int, 0)),
        json_build_object('metric', 'CVs reviewed per student',
          'home', round(avg(cv_count) filter (where fee_status = 'Home'), 1),
          'intl', round(avg(cv_count) filter (where fee_status = 'International'), 1)),
        json_build_object('metric', 'Applications tracked per student',
          'home', round(avg(app_count) filter (where fee_status = 'Home'), 1),
          'intl', round(avg(app_count) filter (where fee_status = 'International'), 1))
      ) else '[]'::json end
      from f
    ),
    'needs', coalesce((
      select json_agg(json_build_object('count', n, 'why', why, 'hint', hint))
      from (
        select count(*) as n, flag,
          case flag
            when 'No CV yet' then 'Signed up but no CV uploaded'
            when 'Not improving' then 'Score not improving after 3 uploads'
            when 'Deadline soon' then 'Tracked deadline in 7 days, score under 50'
            else 'Inactive for 30 days' end as why,
          case flag
            when 'No CV yet' then 'Over 3 weeks'
            when 'Deadline soon' then 'Urgent'
            else '' end as hint
        from f where flag <> '' group by flag having count(*) >= 5
      ) x
    ), '[]'::json)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.admin_students()
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
      'id', student_number,
      'course', course,
      'year', year_of_study,
      'status', fee_status,
      'faculty', faculty,
      'score', latest_score,
      'change', case when cv_count > 0 then latest_score - first_score end,
      'lastActive', case
        when last_active_at::date = current_date then 'Today'
        when last_active_at::date = current_date - 1 then 'Yesterday'
        else (current_date - last_active_at::date) || ' days ago' end,
      'flag', public.student_flag(s)
    ) order by last_active_at desc)
    from public.admin_student_facts(v_uni) s
  ), '[]'::json);
end;
$$;

-- Only signed-in users can call the RPCs; internal helpers aren't exposed.
revoke execute on function public.admin_student_facts(uuid) from public, anon, authenticated;
revoke execute on function public.admin_university() from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_activity() from public, anon, authenticated;
revoke execute on function public.bump_ai_usage(text) from public, anon;
revoke execute on function public.delete_my_account() from public, anon;
revoke execute on function public.admin_overview() from public, anon;
revoke execute on function public.admin_students() from public, anon;
grant execute on function public.bump_ai_usage(text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_students() to authenticated;
grant execute on function public.admin_university() to authenticated;

/* ---------------------------------------------------------------- storage */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cvs', 'cvs', false, 2097152, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream'
])
on conflict (id) do nothing;

create policy "read own cv files" on storage.objects for select to authenticated
  using (bucket_id = 'cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- No student upload policy: the server stores CV files after checking them.
create policy "delete own cv files" on storage.objects for delete to authenticated
  using (bucket_id = 'cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
