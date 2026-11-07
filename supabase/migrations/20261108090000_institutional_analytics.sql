-- Institutional analytics (OP-022): six service measures with definitions, and publication rules a filter, a date range or
-- an export can't get round.
--
-- NOT APPLIED to any live database by the implementation session. Validated in supabase/tests/schema.test.mjs and
-- tests/analytics-db.test.ts (PGlite, with stubbed auth and storage schemas). Run after every earlier migration and deploy
-- with the code that calls admin_analytics: this drops admin_overview and admin_outcomes_pack, which took any date range.
--
-- Adds no table and no column, and stores nothing: every figure is worked out on request. It changes no score and no report.
--
-- The rules (src/lib/analytics/rules.ts is the same logic in TypeScript for demo mode, and
-- tests/fixtures/analytics-publication-cases.json holds the answers both must give):
--   1. A date range is one of a fixed set of terms and academic years, never arbitrary dates.
--   2. There is no filter argument. One function returns one set of figures for a period, so the screen and every file agree.
--   3. A figure runs to the end of yesterday, so a student's action today can't be watched moving a number.
--   4. Every count is rounded to the nearest 5, so subtracting two figures doesn't give an exact answer.
--   5. A group of fewer than 5 is hidden, with no name. If what is hidden comes to fewer than 5, the next smallest group is hidden too.
--   6. A count of students within a group is hidden unless at least 5 are on each side of it, so "all" and "none" can't be read.
--   7. An average needs 25 students, and is only ever within one scoring version set.
--   8. A term or a year is withheld if subtracting it from its parent period would isolate fewer than 5 students.

drop function if exists public.admin_overview(timestamptz, timestamptz);
drop function if exists public.admin_outcomes_pack(timestamptz, timestamptz);

/* ---------------------------------------------------------------- the publication rules */

create function public.analytics_round(p_n bigint)
returns integer
language sql
immutable
set search_path = ''
as $$
  select (round(p_n / 5.0) * 5)::integer;
$$;

-- A number of students: hidden under 5.
create function public.analytics_count(p_n bigint)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_n >= 5 then public.analytics_round(p_n) end;
$$;

-- Students within a group: at least 5 on each side, or nothing. Hidden looks the same whichever side was too small.
create function public.analytics_part(p_n bigint, p_of bigint)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_n >= 5 and p_of - p_n >= 5 then public.analytics_round(p_n) end;
$$;

-- Things counted rather than students (five reports can be one person's): needs 5 students behind it.
create function public.analytics_events(p_events bigint, p_students bigint)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_students >= 5 then public.analytics_round(p_events) end;
$$;

create function public.analytics_average(p_avg numeric, p_n bigint)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_n >= 25 then round(p_avg)::integer end;
$$;

-- Which groups of one breakdown to hide. Under 5 is hidden. If what's hidden totals under 5, then total minus the rest would
-- still isolate it, so the next smallest goes too, until it doesn't or nothing is left.
create function public.analytics_hidden_groups(p_sizes jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_hidden text[] := '{}';
  v_sum bigint := 0;
  v_row record;
begin
  for v_row in select key, value::bigint as n from jsonb_each_text(coalesce(p_sizes, '{}'::jsonb)) order by value::bigint, key collate "C" loop
    if v_row.n < 5 or (v_sum > 0 and v_sum < 5) then
      v_hidden := v_hidden || v_row.key;
      v_sum := v_sum + v_row.n;
    end if;
  end loop;
  return v_hidden;
end;
$$;

-- A period is named, and these are the only ones. The same boundaries as listPeriods in src/lib/periods.ts, in UTC.
create function public.analytics_period(p_key text, out p_from timestamptz, out p_to timestamptz)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_m text[];
  v_y integer;
  utc constant text := 'UTC';
begin
  if p_key = 'all' then
    return;
  end if;
  v_m := regexp_match(coalesce(p_key, ''), '^(autumn|spring|summer|year)-([0-9]{4})$');
  if v_m is null then
    raise exception 'unknown reporting period' using errcode = '22023';
  end if;
  v_y := v_m[2]::integer;
  case v_m[1]
    when 'autumn' then p_from := make_timestamptz(v_y, 9, 1, 0, 0, 0, utc); p_to := make_timestamptz(v_y + 1, 1, 1, 0, 0, 0, utc);
    when 'spring' then p_from := make_timestamptz(v_y, 1, 1, 0, 0, 0, utc); p_to := make_timestamptz(v_y, 4, 16, 0, 0, 0, utc);
    when 'summer' then p_from := make_timestamptz(v_y, 4, 16, 0, 0, 0, utc); p_to := make_timestamptz(v_y, 9, 1, 0, 0, 0, utc);
    else p_from := make_timestamptz(v_y, 9, 1, 0, 0, 0, utc); p_to := make_timestamptz(v_y + 1, 9, 1, 0, 0, 0, utc);
  end case;
end;
$$;

/* ---------------------------------------------------------------- what counts as the same CV */

-- The same text as normaliseText in src/lib/analysis/fingerprint.ts, so a re-export that differs only in formatting is a
-- duplicate here as it is on the student's dashboard (OP-019). tests/analytics-db.test.ts compares the two on hostile input.
-- It covers NORMALISER_VERSION normaliser-2026-11-06.1; that test holds the version and fails if the constant is bumped.
create function public.analytics_normalise_text(p_text text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := normalize(coalesce(p_text, ''), NFKC);
begin
  v := regexp_replace(v, E'\r\n?', E'\n', 'g');
  v := regexp_replace(v, '[  -​  　]', ' ', 'g');
  v := regexp_replace(v, '[‌-‏﻿]', '', 'g');
  v := regexp_replace(v, '[‘’‚‛′]', '''', 'g');
  v := regexp_replace(v, '[“”„‟″]', '"', 'g');
  v := regexp_replace(v, '[‐‑‒–—―−]', '-', 'g');
  v := regexp_replace(v, '(^|(?<=[  ]))[ \t]*[•●▪‣◦∙·*–—›»▸►▶➢➤→✓✔■□◆◇♦○❖-][ \t]+', E'• ', 'gn');
  v := regexp_replace(v, '[ \t]+', ' ', 'g');
  return coalesce((
    select string_agg(l.t, E'\n' order by l.i)
    from (select regexp_replace(x.line, '^[\s   ]+|[\s   ]+$', '', 'g') as t, x.i from unnest(string_to_array(v, E'\n')) with ordinality as x(line, i)) l
    where l.t <> ''
  ), '');
end;
$$;

create function public.analytics_doc_key(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(md5(public.analytics_normalise_text(p_text)), md5(''));
$$;

-- A timestamp saved inside a report. Unreadable means not counted, never an error on the dashboard.
create function public.analytics_ts(p_at text)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_at::timestamptz;
exception when others then
  return null;
end;
$$;

/* ---------------------------------------------------------------- what happened, exactly: never returned to a caller */

-- Every CV review by a student who shares their progress, classified:
--   complete: scored and fully assessed, and the first time this text was reviewed
--   duplicate: fully assessed, but the same text after normalising was already reviewed, whatever the file looked like
--   incomplete: no score, no bullets to judge, a low-confidence reading, or no text
create function public.analytics_reviews(p_uni uuid, p_end timestamptz)
returns table (user_id uuid, report_id uuid, created_at timestamptz, score integer, series text, doc_key text, state text, version_order integer)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select r.id, r.user_id, r.created_at, r.score, public.report_score_series(r.payload) as series,
      case when r.score is not null
        and r.payload #>> '{analysis,meta,bullets}' is distinct from '0'
        and r.payload #>> '{document,extraction,confidence,band}' is distinct from 'low'
      then public.analytics_doc_key(r.payload ->> 'text') end as doc_key
    from public.reports r
    join public.profiles p on p.id = r.user_id
    where p.university_id = p_uni and p.role = 'student' and p.share_progress
      and exists (select 1 from auth.users u where u.id = p.id and u.email_confirmed_at is not null)
      and r.type = 'cv_review' and r.created_at < p_end
  ),
  ranked as (
    select b.*, row_number() over (partition by b.user_id, b.doc_key order by b.created_at, b.id) as rn from base b
  ),
  firsts as (
    select k.id, row_number() over (partition by k.user_id order by k.created_at, k.id)::integer as version_order
    from ranked k where k.doc_key is not null and k.rn = 1
  )
  select k.user_id, k.id, k.created_at, k.score, k.series, k.doc_key,
    case when k.doc_key is null then 'incomplete' when k.rn = 1 then 'complete' else 'duplicate' end,
    f.version_order
  from ranked k left join firsts f on f.id = k.id;
$$;

-- When each edit a student still keeps was made. The same rule as keptEdits in src/lib/applications/workspace.ts: a line saved
-- in a CV review, a decision kept in the current version of a tailored CV or letter, a LinkedIn section past its first version.
-- An edit that was undone or rejected isn't in the current version, so it doesn't count.
create function public.analytics_kept_edit_times(p_type text, p jsonb, p_updated timestamptz)
returns setof timestamptz
language sql
immutable
set search_path = ''
as $$
  select coalesce(public.analytics_ts(l -> 'acceptedHistory' -> -1 ->> 'at'), p_updated)
  from jsonb_array_elements(case when p_type = 'cv_review' and jsonb_typeof(p #> '{analysis,lines}') = 'array' then p #> '{analysis,lines}' else '[]'::jsonb end) l
  where l ->> 'accepted' is not null
  union all
  select public.analytics_ts(d.value ->> 'at')
  from jsonb_array_elements(case when p_type in ('tailor', 'cover_letter') and jsonb_typeof(p #> '{edits,versions}') = 'array' then p #> '{edits,versions}' else '[]'::jsonb end) v,
    jsonb_each(case when jsonb_typeof(v -> 'decisions') = 'object' then v -> 'decisions' else '{}'::jsonb end) d
  where v ->> 'id' = p #>> '{edits,current}' and d.value ->> 'status' <> 'rejected' and d.value ->> 'text' is not null
  union all
  select public.analytics_ts(v ->> 'at')
  from jsonb_array_elements(case when p_type = 'linkedin' and jsonb_typeof(p -> 'sections') = 'array' then p -> 'sections' else '[]'::jsonb end) s,
    jsonb_array_elements(case when jsonb_typeof(s -> 'versions') = 'array' then s -> 'versions' else '[]'::jsonb end) v
  where v ->> 'id' = s ->> 'current' and (v ->> 'n')::integer > 1;
$$;

-- One row per student who shares their progress and had an account by the end of the period.
create function public.analytics_student_rows(p_uni uuid, p_from timestamptz, p_end timestamptz)
returns table (
  user_id uuid, faculty text, year_group text, fee_status text,
  completed boolean, versions integer, reviewed_by_end boolean, repeat_use boolean,
  duplicates integer, incompletes integer, failed integer,
  useful_edit boolean, referred boolean, referral_accepted boolean,
  tracked boolean, interview boolean, offer boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with rv as materialized (select * from public.analytics_reviews(p_uni, p_end)),
  inside as materialized (select * from rv where p_from is null or rv.created_at >= p_from)
  select p.id,
    coalesce(p.faculty, 'Not set'),
    coalesce(nullif(p.year_of_study, ''), 'Not set'),
    case p.fee_status when 'home' then 'Home' when 'international' then 'International' else 'Not set' end,
    coalesce(i.versions, 0) > 0,
    coalesce(i.versions, 0),
    exists (select 1 from rv where rv.user_id = p.id and rv.state = 'complete'),
    coalesce(i.repeats, 0) > 0,
    coalesce(i.duplicates, 0),
    coalesce(i.incompletes, 0),
    coalesce(fj.n, 0),
    exists (
      select 1 from (
        select t as at from public.reports r, public.analytics_kept_edit_times(r.type, r.payload, r.updated_at) t where r.user_id = p.id
        union all
        select cs.created_at from public.cv_sources cs where cs.user_id = p.id and cs.kind = 'correction'
      ) e where e.at < p_end and (p_from is null or e.at >= p_from)
    ),
    coalesce(rf.n, 0) > 0,
    coalesce(rf.accepted, 0) > 0,
    coalesce(ap.n, 0) > 0,
    coalesce(ap.interviews, 0) > 0,
    coalesce(ap.offers, 0) > 0
  from public.profiles p
  left join lateral (
    select count(*) filter (where x.state = 'complete')::integer as versions,
      count(*) filter (where x.state = 'complete' and x.version_order >= 2)::integer as repeats,
      count(*) filter (where x.state = 'duplicate')::integer as duplicates,
      count(*) filter (where x.state = 'incomplete')::integer as incompletes
    from inside x where x.user_id = p.id
  ) i on true
  left join lateral (
    select count(*)::integer as n from public.analysis_jobs j
    where j.user_id = p.id and j.workflow = 'cv_score' and j.status = 'failed' and j.created_at < p_end and (p_from is null or j.created_at >= p_from)
  ) fj on true
  left join lateral (
    select count(*)::integer as n, count(*) filter (where a.status in ('accepted', 'in_progress', 'closed'))::integer as accepted
    from public.adviser_referrals a
    where a.student_id = p.id and a.status <> 'withdrawn' and a.created_at < p_end and (p_from is null or a.created_at >= p_from)
  ) rf on true
  left join lateral (
    select count(*)::integer as n,
      count(*) filter (where a.status in ('interview', 'offer'))::integer as interviews,
      count(*) filter (where a.status = 'offer')::integer as offers
    from public.applications a
    where a.user_id = p.id and a.created_at < p_end and (p_from is null or a.created_at >= p_from)
  ) ap on true
  where p.university_id = p_uni and p.role = 'student' and p.share_progress and p.created_at < p_end
    and exists (select 1 from auth.users u where u.id = p.id and u.email_confirmed_at is not null);
$$;

-- Each student's scores within each scoring version set, one reading per distinct text. Reports in no set are left out:
-- unknown versions and incomplete assessments aren't comparable with anything.
create function public.analytics_version_rows(p_uni uuid, p_from timestamptz, p_end timestamptz)
returns table (user_id uuid, series text, first_score integer, latest_score integer, versions integer)
language sql
stable
security definer
set search_path = ''
as $$
  with distinct_docs as (
    select distinct on (r.user_id, r.series, r.doc_key) r.user_id, r.series, r.doc_key, r.score, r.created_at, r.report_id
    from public.analytics_reviews(p_uni, p_end) r
    where r.state <> 'incomplete' and r.series is not null and (p_from is null or r.created_at >= p_from)
    order by r.user_id, r.series, r.doc_key, r.created_at, r.report_id
  )
  select d.user_id, d.series,
    (array_agg(d.score order by d.created_at, d.report_id))[1],
    (array_agg(d.score order by d.created_at desc, d.report_id desc))[1],
    count(*)::integer
  from distinct_docs d group by d.user_id, d.series;
$$;

-- Rule 8. year minus its terms, or all time minus its years, could isolate a handful of students, so a term or year is withheld
-- while any period it could be subtracted from or added to holds a few people. An empty period isolates nobody.
create function public.analytics_period_withheld(p_uni uuid, p_key text, p_end timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with confirmed as (
    select p.id, p.created_at, p.share_progress from public.profiles p
    where p.university_id = p_uni and p.role = 'student'
      and exists (select 1 from auth.users u where u.id = p.id and u.email_confirmed_at is not null)
  ),
  sharing as (select c.id from confirmed c where c.share_progress),
  activity as (
    select c.id, c.created_at as at from confirmed c
    union all select r.user_id, r.created_at from public.reports r join sharing s on s.id = r.user_id
    union all select r.user_id, r.updated_at from public.reports r join sharing s on s.id = r.user_id
    union all select a.user_id, a.created_at from public.applications a join sharing s on s.id = a.user_id
    union all select cs.user_id, cs.created_at from public.cv_sources cs join sharing s on s.id = cs.user_id where cs.kind = 'correction'
    union all select j.user_id, j.created_at from public.analysis_jobs j join sharing s on s.id = j.user_id where j.workflow = 'cv_score'
    union all select f.student_id, f.created_at from public.adviser_referrals f join sharing s on s.id = f.student_id
  ),
  dated as (
    select a.id, u.at_utc,
      extract(year from u.at_utc)::integer - case when extract(month from u.at_utc) < 9 then 1 else 0 end as ay,
      case
        when extract(month from u.at_utc) >= 9 then 'autumn'
        when extract(month from u.at_utc) < 4 or (extract(month from u.at_utc) = 4 and extract(day from u.at_utc) < 16) then 'spring'
        else 'summer'
      end as term
    from activity a, lateral (select a.at at time zone 'UTC' as at_utc) u
    where a.at < p_end
  ),
  asked as (
    select split_part(p_key, '-', 1) as kind,
      case split_part(p_key, '-', 1)
        when 'year' then split_part(p_key, '-', 2)::integer
        when 'autumn' then split_part(p_key, '-', 2)::integer
        when 'all' then null
        else split_part(p_key, '-', 2)::integer - 1
      end as ay
  )
  select case when (select kind from asked) = 'all' then false else
    exists (select 1 from dated d group by d.ay having count(distinct d.id) < 5)
    or ((select kind from asked) <> 'year' and exists (
      select 1 from dated d where d.ay = (select ay from asked) group by d.term having count(distinct d.id) < 5
    ))
  end;
$$;

/* ---------------------------------------------------------------- what a careers admin gets */

create function public.admin_analytics(p_period text default 'all')
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
  v_name text;
  v_from timestamptz;
  v_to timestamptz;
  v_today timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  v_end timestamptz;
  v_withheld boolean;
  v_invited bigint;
  v_accounts bigint;
  v_sharing bigint;
  v_activated bigint;
  v_unmatched bigint;
  v_rows jsonb;
  v_set text;
  v_set_rows jsonb;
  v_set_aside bigint;
  v_t record;
  v_scores jsonb;
  v_breakdowns jsonb := '[]'::jsonb;
  v_needs jsonb;
  v_need_total bigint;
  v_dim record;
  v_sizes jsonb;
  v_hidden text[];
begin
  select name into v_name from public.universities where id = v_uni;
  select a.p_from, a.p_to into v_from, v_to from public.analytics_period(p_period) a;
  v_end := least(coalesce(v_to, v_today), v_today);
  -- Up to today, not the period's end: what matters is what lies in the periods either side of this one.
  v_withheld := public.analytics_period_withheld(v_uni, p_period, v_today);

  -- These two describe today, not the period: nothing records when a record was first imported.
  select count(*) into v_invited from public.student_records r where r.university_id = v_uni;
  select count(*), count(*) filter (where p.share_progress) into v_accounts, v_sharing
  from public.profiles p
  where p.university_id = v_uni and p.role = 'student' and p.created_at < v_today
    and exists (select 1 from auth.users u where u.id = p.id and u.email_confirmed_at is not null);

  if v_withheld then
    return json_build_object(
      'universityName', coalesce(v_name, 'Your university'), 'sample', false, 'rules', 'analytics-publication-1',
      'period', json_build_object('key', p_period, 'from', v_from, 'to', v_to, 'through', v_end),
      'withheld', true,
      'invited', public.analytics_count(v_invited),
      'accounts', public.analytics_count(v_accounts),
      'sharing', public.analytics_part(v_sharing, v_accounts),
      'metrics', null, 'excluded', null, 'scores', null, 'breakdowns', '[]'::json, 'needs', null
    );
  end if;

  -- Accounts made in the period, matched to an imported record by email. Includes students who don't share: this is a
  -- number only, needed to say how many students the rest of the page leaves out.
  select count(*) filter (where matched), count(*) filter (where not matched) into v_activated, v_unmatched
  from (
    select exists (select 1 from public.student_records r where r.university_id = v_uni and r.email = lower(u.email)) as matched
    from public.profiles p join auth.users u on u.id = p.id
    where p.university_id = v_uni and p.role = 'student' and u.email_confirmed_at is not null
      and p.created_at < v_end and (v_from is null or p.created_at >= v_from)
  ) x;

  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_rows from public.analytics_student_rows(v_uni, v_from, v_end) s;

  -- The set most students are in. A tie goes to the alphabetically last identity, so the answer doesn't depend on row order.
  select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) into v_set_rows from public.analytics_version_rows(v_uni, v_from, v_end) v;
  select e ->> 'series' into v_set from jsonb_array_elements(v_set_rows) e
    group by e ->> 'series' order by count(*) desc, e ->> 'series' desc limit 1;
  select count(distinct e ->> 'user_id') into v_set_aside from jsonb_array_elements(v_set_rows) e
    where e ->> 'user_id' not in (select x ->> 'user_id' from jsonb_array_elements(v_set_rows) x where x ->> 'series' = v_set);
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_set_rows from jsonb_array_elements(v_set_rows) e where e ->> 'series' = v_set;

  select
    count(*) as students,
    count(*) filter (where (r ->> 'completed')::boolean) as completed,
    coalesce(sum((r ->> 'versions')::integer), 0) as versions,
    count(*) filter (where (r ->> 'reviewed_by_end')::boolean) as reviewed,
    count(*) filter (where (r ->> 'repeat_use')::boolean) as repeat_use,
    count(*) filter (where (r ->> 'useful_edit')::boolean) as edits,
    count(*) filter (where (r ->> 'referred')::boolean) as referred,
    count(*) filter (where (r ->> 'referral_accepted')::boolean) as accepted,
    count(*) filter (where (r ->> 'tracked')::boolean) as tracked,
    count(*) filter (where (r ->> 'interview')::boolean) as interview,
    count(*) filter (where (r ->> 'offer')::boolean) as offer,
    coalesce(sum((r ->> 'duplicates')::integer), 0) as duplicates,
    count(*) filter (where (r ->> 'duplicates')::integer > 0) as duplicate_students,
    coalesce(sum((r ->> 'incompletes')::integer), 0) as incompletes,
    count(*) filter (where (r ->> 'incompletes')::integer > 0) as incomplete_students,
    coalesce(sum((r ->> 'failed')::integer), 0) as failed,
    count(*) filter (where (r ->> 'failed')::integer > 0) as failed_students
  into v_t
  from jsonb_array_elements(v_rows) r;

  -- Within one version set only. Improvement needs two different texts, so resubmitting a file can't count as one.
  select jsonb_build_object(
    'versionSet', case when count(*) >= 5 then v_set end,
    'students', public.analytics_count(count(*)),
    'setAside', public.analytics_events(v_set_aside, v_set_aside),
    'average', public.analytics_average(avg((e ->> 'latest_score')::numeric), count(*)),
    'comparable', public.analytics_count(count(*) filter (where (e ->> 'versions')::integer >= 2)),
    'improved10', public.analytics_part(
      count(*) filter (where (e ->> 'versions')::integer >= 2 and (e ->> 'latest_score')::integer - (e ->> 'first_score')::integer >= 10),
      count(*) filter (where (e ->> 'versions')::integer >= 2)),
    'bands', jsonb_build_object(
      'low', public.analytics_part(count(*) filter (where (e ->> 'latest_score')::integer < 50), count(*)),
      'mid', public.analytics_part(count(*) filter (where (e ->> 'latest_score')::integer between 50 and 74), count(*)),
      'high', public.analytics_part(count(*) filter (where (e ->> 'latest_score')::integer between 75 and 89), count(*)),
      'top', public.analytics_part(count(*) filter (where (e ->> 'latest_score')::integer >= 90), count(*))
    )
  ) into v_scores
  from jsonb_array_elements(v_set_rows) e;

  for v_dim in select * from (values ('All students', ''), ('Faculty', 'faculty'), ('Year of study', 'year_group'), ('Fee status', 'fee_status')) as d(label, col) loop
    select coalesce(jsonb_object_agg(g, n), '{}'::jsonb) into v_sizes
    from (select case when v_dim.col = '' then 'All' else r ->> v_dim.col end as g, count(*) as n from jsonb_array_elements(v_rows) r group by 1) x;
    v_hidden := public.analytics_hidden_groups(v_sizes);
    select v_breakdowns || coalesce(jsonb_agg(row order by row ->> 'group'), '[]'::jsonb) into v_breakdowns
    from (
      select jsonb_build_object(
        'dimension', v_dim.label, 'group', g.grp, 'hidden', false,
        'students', public.analytics_count(g.n),
        'completed', public.analytics_part(g.completed, g.n),
        'usefulEdits', public.analytics_part(g.edits, g.n),
        'repeatUse', public.analytics_part(g.repeat_use, g.reviewed),
        'reviewed', public.analytics_count(g.reviewed),
        'referred', public.analytics_part(g.referred, g.n),
        'tracked', public.analytics_part(g.tracked, g.n),
        'interview', public.analytics_part(g.interview, g.n),
        'offer', public.analytics_part(g.offer, g.n),
        'average', public.analytics_average(g.avg_score, g.scored)
      ) as row
      from (
        select case when v_dim.col = '' then 'All' else r ->> v_dim.col end as grp,
          count(*) as n,
          count(*) filter (where (r ->> 'completed')::boolean) as completed,
          count(*) filter (where (r ->> 'useful_edit')::boolean) as edits,
          count(*) filter (where (r ->> 'repeat_use')::boolean) as repeat_use,
          count(*) filter (where (r ->> 'reviewed_by_end')::boolean) as reviewed,
          count(*) filter (where (r ->> 'referred')::boolean) as referred,
          count(*) filter (where (r ->> 'tracked')::boolean) as tracked,
          count(*) filter (where (r ->> 'interview')::boolean) as interview,
          count(*) filter (where (r ->> 'offer')::boolean) as offer,
          avg((sc ->> 'latest_score')::numeric) as avg_score,
          count(sc) as scored
        from jsonb_array_elements(v_rows) r
        left join lateral (select e from jsonb_array_elements(v_set_rows) e where e ->> 'user_id' = r ->> 'user_id') s(sc) on true
        group by 1
      ) g
      where not (g.grp = any (v_hidden))
    ) rows;
    if cardinality(v_hidden) > 0 then
      v_breakdowns := v_breakdowns || jsonb_build_object('dimension', v_dim.label, 'group', null, 'hidden', true);
    end if;
  end loop;

  -- Where things stand, not the period's. Each student counted chose to share, and the student list is where a team acts on it.
  select coalesce(jsonb_object_agg(flag, n), '{}'::jsonb), coalesce(sum(n), 0) into v_sizes, v_need_total
  from (select public.student_flag(s) as flag, count(*) as n from public.admin_student_facts(v_uni, null, v_today) s where s.created_at < v_today group by 1) x where flag <> '';
  v_hidden := public.analytics_hidden_groups(v_sizes);
  select coalesce(jsonb_agg(jsonb_build_object('flag', k.key, 'count', public.analytics_count(k.value::bigint)) order by k.key), '[]'::jsonb) into v_needs
  from jsonb_each_text(v_sizes) k where not (k.key = any (v_hidden));

  return json_build_object(
    'universityName', coalesce(v_name, 'Your university'), 'sample', false, 'rules', 'analytics-publication-1',
    'period', json_build_object('key', p_period, 'from', v_from, 'to', v_to, 'through', v_end),
    'withheld', false,
    'invited', public.analytics_count(v_invited),
    'accounts', public.analytics_count(v_accounts),
    'sharing', public.analytics_part(v_sharing, v_accounts),
    'metrics', json_build_object(
      'activated', public.analytics_part(v_activated, v_invited),
      'completed', public.analytics_part(v_t.completed, v_t.students),
      'versions', public.analytics_events(v_t.versions, v_t.completed),
      'usefulEdits', public.analytics_part(v_t.edits, v_t.students),
      'repeatUse', public.analytics_part(v_t.repeat_use, v_t.reviewed),
      'reviewed', public.analytics_count(v_t.reviewed),
      'referred', public.analytics_part(v_t.referred, v_t.students),
      'referralsAccepted', public.analytics_part(v_t.accepted, v_t.referred),
      'tracked', public.analytics_part(v_t.tracked, v_t.students),
      'interview', public.analytics_part(v_t.interview, v_t.students),
      'offer', public.analytics_part(v_t.offer, v_t.students),
      'students', public.analytics_count(v_t.students)
    ),
    'excluded', json_build_object(
      'duplicates', public.analytics_events(v_t.duplicates, v_t.duplicate_students),
      'incomplete', public.analytics_events(v_t.incompletes, v_t.incomplete_students),
      'failed', public.analytics_events(v_t.failed, v_t.failed_students),
      'noRecord', public.analytics_count(v_unmatched)
    ),
    'scores', v_scores,
    'breakdowns', v_breakdowns,
    'needs', json_build_object('total', public.analytics_part(v_need_total, v_sharing), 'rows', v_needs)
  );
end;
$$;

revoke execute on function public.analytics_round(bigint) from public, anon, authenticated;
revoke execute on function public.analytics_count(bigint) from public, anon, authenticated;
revoke execute on function public.analytics_part(bigint, bigint) from public, anon, authenticated;
revoke execute on function public.analytics_events(bigint, bigint) from public, anon, authenticated;
revoke execute on function public.analytics_average(numeric, bigint) from public, anon, authenticated;
revoke execute on function public.analytics_hidden_groups(jsonb) from public, anon, authenticated;
revoke execute on function public.analytics_period(text) from public, anon, authenticated;
revoke execute on function public.analytics_normalise_text(text) from public, anon, authenticated;
revoke execute on function public.analytics_doc_key(text) from public, anon, authenticated;
revoke execute on function public.analytics_ts(text) from public, anon, authenticated;
revoke execute on function public.analytics_reviews(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.analytics_kept_edit_times(text, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.analytics_student_rows(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.analytics_version_rows(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.analytics_period_withheld(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_analytics(text) from public, anon;
grant execute on function public.admin_analytics(text) to authenticated;
