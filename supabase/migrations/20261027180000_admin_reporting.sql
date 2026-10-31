-- Admin reporting (T16): reporting periods, a server-paged student list, and the Graduate Outcomes /
-- TEF evidence pack. Same consent and group-of-five rules as before.

drop function if exists public.admin_overview();
drop function if exists public.admin_students();
drop function if exists public.student_flag(public.student_fact);
drop function if exists public.admin_student_facts(uuid);

alter type public.student_fact add attribute interviews integer, add attribute offers integer;

-- Facts per consenting, confirmed student. Activity (CV reviews, applications) can be limited to a period.
create function public.admin_student_facts(p_uni uuid, p_from timestamptz default null, p_to timestamptz default null)
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
    coalesce(ap.urgent, false),
    coalesce(ap.interviews, 0),
    coalesce(ap.offers, 0)
  from public.profiles p
  left join lateral (
    select
      count(*)::int as n,
      (array_agg(r.score order by r.created_at asc))[1] as first_score,
      (array_agg(r.score order by r.created_at desc))[1] as latest_score
    from public.reports r
    where r.user_id = p.id and r.type = 'cv_review' and r.score is not null
      and (p_from is null or r.created_at >= p_from) and (p_to is null or r.created_at < p_to)
  ) cv on true
  left join lateral (
    select count(*)::int as n,
      bool_or(a.status = 'saved' and a.closes_on between current_date and current_date + 7) as urgent,
      (count(*) filter (where a.status in ('interview', 'offer')))::int as interviews,
      (count(*) filter (where a.status = 'offer'))::int as offers
    from public.applications a
    where a.user_id = p.id
      and (p_from is null or a.created_at >= p_from) and (p_to is null or a.created_at < p_to)
  ) ap on true
  where p.university_id = p_uni and p.role = 'student' and p.share_progress
    and exists (select 1 from auth.users u where u.id = p.id and u.email_confirmed_at is not null);
$$;

create function public.student_flag(f public.student_fact)
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

create function public.admin_overview(p_from timestamptz default null, p_to timestamptz default null)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
  v_name text;
  v_end timestamptz := least(coalesce(p_to, now()), now());
  v_result json;
begin
  select name into v_name from public.universities where id = v_uni;

  with f as (
    select s.*, public.student_flag(s) as flag from public.admin_student_facts(v_uni, p_from, p_to) s
  ),
  scored as (
    select * from f where latest_score is not null
  ),
  weeks as (
    select w.n, (
      select case when count(distinct r.user_id) >= 5 then round(avg(r.score))::int end
      from public.reports r join f on f.user_id = r.user_id
      where r.type = 'cv_review' and r.score is not null
        and r.created_at >= date_trunc('week', v_end) - make_interval(weeks => 7 - w.n)
        and r.created_at < date_trunc('week', v_end) - make_interval(weeks => 6 - w.n)
    ) as avg
    from generate_series(0, 7) as w(n)
  )
  select json_build_object(
    'universityName', coalesce(v_name, 'Your university'),
    'sample', false,
    'kpis', json_build_object(
      'activeStudents', (select count(*) from f where cv_count > 0 or app_count > 0 or (p_from is null and last_active_at > now() - interval '90 days')),
      'newThisMonth', (select count(*) from f where created_at >= coalesce(p_from, date_trunc('month', now())) and created_at < coalesce(p_to, now() + interval '1 day')),
      'avgScore', (select case when count(*) >= 5 then round(avg(latest_score))::int end from scored),
      'avgFirstScore', (select case when count(*) >= 5 then round(avg(first_score))::int end from scored),
      'avgImprovement', (select case when count(*) >= 5 then round(avg(latest_score - first_score))::int end from scored),
      'cvsReviewed', (select coalesce(sum(cv_count), 0) from f),
      'perStudent', (select case when count(*) filter (where cv_count > 0) > 0 then round(sum(cv_count)::numeric / count(*) filter (where cv_count > 0), 1) else 0 end from f),
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

-- One page of the student list, with counts for each filter. Filter: all | needs | home | international.
create function public.admin_students(
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
        'id', student_number, 'course', course, 'year', year_of_study, 'status', fee_status, 'faculty', faculty,
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

-- Graduate Outcomes / TEF evidence: an engagement funnel overall and by faculty, year and fee status.
-- Any group with fewer than five students is reported as suppressed.
create function public.admin_outcomes_pack(p_from timestamptz default null, p_to timestamptz default null)
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
  with f as (select * from public.admin_student_facts(v_uni, p_from, p_to)),
  groups as (
    select 'All students' as dimension, 'All' as grp, f.* from f
    union all select 'Faculty', faculty, f.* from f
    union all select 'Year of study', coalesce(nullif(year_of_study, ''), 'Not set'), f.* from f
    union all select 'Fee status', fee_status, f.* from f
  ),
  agg as (
    select dimension, grp, count(*) as n,
      count(*) filter (where cv_count > 0) as uploaded,
      count(*) filter (where cv_count >= 2) as reuploaded,
      count(*) filter (where latest_score - first_score >= 10) as improved10,
      count(*) filter (where latest_score >= 75) as strong,
      count(*) filter (where app_count > 0) as tracked,
      count(*) filter (where interviews > 0) as interview,
      count(*) filter (where offers > 0) as offer,
      round(avg(latest_score)) as avg_score,
      round(avg(latest_score - first_score) filter (where cv_count >= 2)) as avg_improvement
    from groups group by dimension, grp
  )
  select json_build_object(
    'from', p_from, 'to', p_to,
    'rows', coalesce(json_agg(case when n >= 5 then json_build_object(
        'dimension', dimension, 'group', grp, 'students', n, 'uploadedCv', uploaded, 'reuploaded', reuploaded,
        'improved10', improved10, 'strongOrBetter', strong, 'trackedApplications', tracked,
        'reachedInterview', interview, 'receivedOffer', offer, 'avgScore', avg_score, 'avgImprovement', avg_improvement)
      else json_build_object('dimension', dimension, 'group', grp, 'suppressed', true) end
      order by dimension = 'All students' desc, dimension, grp), '[]'::json)
  ) into v_result
  from agg;
  return v_result;
end;
$$;

revoke execute on function public.admin_student_facts(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_overview(timestamptz, timestamptz) from public, anon;
revoke execute on function public.admin_students(text, text, text, integer, integer) from public, anon;
revoke execute on function public.admin_outcomes_pack(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_overview(timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_students(text, text, text, integer, integer) to authenticated;
grant execute on function public.admin_outcomes_pack(timestamptz, timestamptz) to authenticated;
