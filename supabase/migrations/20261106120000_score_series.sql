-- Scoring series (OP-010). A score compares only with scores made under the same versions and method, and only when
-- it was fully assessed. Institutional improvement figures compared a student's first and latest scores whatever
-- rules produced them, so a rule change could read as a cohort improving or declining.
--
-- Changes no stored score and rewrites no report. For a student whose reports are all in one series, every figure is
-- what it was. Otherwise first_score is the first score in the latest report's series, and null (so "improvement" is
-- unknown, not zero) when fewer than two reports are comparable. A student's only report stays first = latest, as before.
--
-- NOT APPLIED to any live database by the implementation session. Validated in supabase/tests/schema.test.mjs (PGlite).
-- The same rule in TypeScript is scoreSeries in src/lib/analysis/scoring-contract.ts;
-- tests/fixtures/score-series-cases.json holds the expected answers both must give.

create function public.report_score_series(p jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    -- Not fully assessed: no bullets to judge, or a low-confidence reading. Not comparable with anything.
    when p #>> '{analysis,meta,bullets}' = '0' or p #>> '{document,extraction,confidence,band}' = 'low' then null
    -- OP-010 onwards: recorded with the score.
    when p #>> '{analysis,meta,scoring,identity}' is not null then p #>> '{analysis,meta,scoring,identity}'
    -- OP-004 to OP-010: the parts were recorded. The normaliser and prompt names are the first ones ever recorded.
    when p #>> '{analysis,meta,method}' is null or p #>> '{analysis,meta,rubric}' is null
      or p #>> '{assessment,versions,parser}' is null or p #>> '{assessment,versions,dictionary}' is null then null
    else concat_ws('|',
      p #>> '{analysis,meta,method}',
      p #>> '{analysis,meta,rubric}',
      p #>> '{assessment,versions,parser}',
      p #>> '{assessment,versions,dictionary}',
      'normaliser-2026-11-06.1',
      case when p #>> '{analysis,meta,method}' = 'ai' then 'judge-prompt-2026-11-06.1' else '-' end,
      coalesce(p #>> '{assessment,versions,model}', '-'))
    -- Anything older does not say how it was scored, and unknown is not treated as compatible.
  end;
$$;

revoke execute on function public.report_score_series(jsonb) from public, anon, authenticated;

alter type public.student_fact add attribute comparable_cvs integer;

create or replace function public.admin_student_facts(p_uni uuid, p_from timestamptz default null, p_to timestamptz default null)
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
    case when cv.n = 1 then cv.latest_score when s.n >= 2 then s.first_score end,
    cv.latest_score,
    coalesce(ap.n, 0),
    coalesce(ap.urgent, false),
    coalesce(ap.interviews, 0),
    coalesce(ap.offers, 0),
    coalesce(s.n, 0)
  from public.profiles p
  left join lateral (
    select
      count(*)::int as n,
      (array_agg(r.score order by r.created_at desc))[1] as latest_score,
      (array_agg(public.report_score_series(r.payload) order by r.created_at desc))[1] as latest_series
    from public.reports r
    where r.user_id = p.id and r.type = 'cv_review' and r.score is not null
      and (p_from is null or r.created_at >= p_from) and (p_to is null or r.created_at < p_to)
  ) cv on true
  left join lateral (
    select count(*)::int as n, (array_agg(r.score order by r.created_at asc))[1] as first_score
    from public.reports r
    where r.user_id = p.id and r.type = 'cv_review' and r.score is not null
      and public.report_score_series(r.payload) = cv.latest_series
      and (p_from is null or r.created_at >= p_from) and (p_to is null or r.created_at < p_to)
  ) s on true
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

-- "Not improving" needs three comparable scores: a rule change isn't a student failing to improve.
create or replace function public.student_flag(f public.student_fact)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when f.cv_count = 0 and f.created_at < now() - interval '21 days' then 'No CV yet'
    when f.urgent_deadline and coalesce(f.latest_score, 0) < 50 then 'Deadline soon'
    when f.comparable_cvs >= 3 and f.latest_score - f.first_score <= 2 then 'Not improving'
    when f.last_active_at < now() - interval '30 days' then 'Inactive'
    else ''
  end;
$$;
