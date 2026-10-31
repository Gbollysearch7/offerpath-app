-- Adviser features (T20). Behind the ADVISER_CV_ACCESS flag in the app; the database enforces consent:
-- advisers only see students who share progress, and only get a CV when the student has opted in.

grant update (adviser_can_view_cv) on public.profiles to authenticated;

create table public.adviser_notes (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  author_name text not null,
  university_id uuid not null references public.universities (id) on delete cascade,
  note text not null check (char_length(note) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index adviser_notes_student_idx on public.adviser_notes (student_id, created_at desc);
alter table public.adviser_notes enable row level security;
revoke all on public.adviser_notes from anon, authenticated;
grant select on public.adviser_notes to authenticated;
-- Students read notes about their own reports.
create policy "students read their notes" on public.adviser_notes for select to authenticated using (student_id = (select auth.uid()));

-- One student's details for an adviser. Null if the student isn't at the adviser's university or doesn't share.
create or replace function public.admin_student_detail(p_student uuid)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
  v_result json;
begin
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
        'areas', r.payload -> 'analysis' -> 'areas',
        'hasFile', r.storage_path is not null and p.adviser_can_view_cv
      ) order by r.created_at desc)
      from (select * from public.reports where user_id = p.id and type = 'cv_review' order by created_at desc limit 10) r
    ), '[]'::json),
    'notes', coalesce((
      select json_agg(json_build_object('id', n.id, 'reportId', n.report_id, 'author', n.author_name, 'note', n.note, 'createdAt', n.created_at) order by n.created_at desc)
      from public.adviser_notes n where n.student_id = p.id
    ), '[]'::json)
  ) into v_result
  from public.profiles p
  where p.id = p_student and p.university_id = v_uni and p.role = 'student' and p.share_progress;
  return v_result;
end;
$$;

-- The storage path of a CV, only if the student has opted in to adviser access.
create or replace function public.admin_cv_path(p_report uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.storage_path
  from public.reports r join public.profiles p on p.id = r.user_id
  where r.id = p_report and r.type = 'cv_review'
    and p.university_id = public.admin_university() and p.share_progress and p.adviser_can_view_cv;
$$;

create or replace function public.admin_add_note(p_report uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
  v_student uuid;
  v_id uuid;
begin
  select r.user_id into v_student
  from public.reports r join public.profiles p on p.id = r.user_id
  where r.id = p_report and p.university_id = v_uni and p.share_progress;
  if v_student is null then raise exception 'report not found' using errcode = '22023'; end if;
  insert into public.adviser_notes (report_id, student_id, author_id, author_name, university_id, note)
  values (p_report, v_student, (select auth.uid()), (select full_name from public.profiles where id = (select auth.uid())), v_uni, btrim(p_note))
  returning id into v_id;
  return v_id;
end;
$$;

-- Student list rows now carry the profile id so advisers can open a student's page.
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
  v_uni uuid := public.admin_university();
  v_search text := lower(left(coalesce(p_search, ''), 80));
  v_result json;
begin
  with f as (
    select s.*, public.student_flag(s) as flag from public.admin_student_facts(v_uni) s
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

revoke execute on function public.admin_student_detail(uuid) from public, anon;
revoke execute on function public.admin_cv_path(uuid) from public, anon;
grant execute on function public.admin_cv_path(uuid) to authenticated;
revoke execute on function public.admin_add_note(uuid, text) from public, anon;
grant execute on function public.admin_student_detail(uuid) to authenticated;
grant execute on function public.admin_add_note(uuid, text) to authenticated;
