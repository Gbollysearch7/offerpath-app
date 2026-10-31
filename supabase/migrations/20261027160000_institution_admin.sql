-- Institution data, admin team management and university-owned opportunities.

/* ---------------------------------------------------------------- student records (T05) */

-- Records the careers team imports (CSV) or that SSO provides. Applied to a profile when it exists,
-- and on sign-up for students who haven't joined yet. Students can't read or write this table.
create table public.student_records (
  university_id uuid not null references public.universities (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  student_number text check (char_length(student_number) <= 40 and student_number !~ '[[:cntrl:]]'),
  course text check (char_length(course) <= 120 and course !~ '[[:cntrl:]]'),
  year_of_study text check (char_length(year_of_study) <= 40 and year_of_study !~ '[[:cntrl:]]'),
  faculty text check (char_length(faculty) <= 120 and faculty !~ '[[:cntrl:]]'),
  fee_status text check (fee_status in ('home', 'international')),
  updated_at timestamptz not null default now(),
  primary key (university_id, email)
);
alter table public.student_records enable row level security;
revoke all on public.student_records from anon, authenticated;

-- Careers staff invited before they've signed up.
create table public.pending_admins (
  university_id uuid not null references public.universities (id) on delete cascade,
  email text not null check (email = lower(email)),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (university_id, email)
);
alter table public.pending_admins enable row level security;
revoke all on public.pending_admins from anon, authenticated;

-- Cleans a free-text value from an import or SSO assertion.
create or replace function public.clean_text(p text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(btrim(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', ' ', 'g')), p_max), '');
$$;

create or replace function public.clean_fee_status(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(btrim(coalesce(p, '')))
    when 'home' then 'home' when 'uk' then 'home' when 'h' then 'home'
    when 'international' then 'international' when 'overseas' then 'international' when 'i' then 'international' when 'int' then 'international'
    else null end;
$$;

-- Sign-up: partner domains only (unchanged), then fill institution fields from an imported record,
-- falling back to SSO attributes (T25), and grant admin to invited careers staff (T06).
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
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb) || coalesce(new.raw_app_meta_data -> 'custom_claims', '{}'::jsonb);
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
    coalesce(r.student_number, public.clean_text(v_meta ->> 'student_number', 40)),
    coalesce(r.course, public.clean_text(v_meta ->> 'course', 120)),
    coalesce(r.year_of_study, public.clean_text(v_meta ->> 'year_of_study', 40)),
    coalesce(r.faculty, public.clean_text(v_meta ->> 'faculty', 120)),
    coalesce(r.fee_status, public.clean_fee_status(v_meta ->> 'fee_status'))
  );
  if v_admin then
    delete from public.pending_admins where university_id = v_uni and email = v_email;
  end if;
  return new;
end;
$$;

-- Admin import. Rows: [{email, student_number, course, year_of_study, faculty, fee_status}].
create or replace function public.admin_import_students(p_rows jsonb)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uni uuid := public.admin_university();
  v_domain text;
  v_row jsonb;
  v_email text;
  v_i integer := 0;
  v_saved integer := 0;
  v_applied integer := 0;
  v_n integer;
  v_skipped jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'import at most 5000 rows at a time'; end if;
  select domain into v_domain from public.universities where id = v_uni;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_email := lower(btrim(coalesce(v_row ->> 'email', '')));
    if v_email !~ '^[^@\s]+@[^@\s]+$' then
      v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'missing or invalid email');
      continue;
    end if;
    if not (split_part(v_email, '@', 2) = v_domain or split_part(v_email, '@', 2) like '%.' || v_domain) then
      v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'email is not at your university');
      continue;
    end if;
    insert into public.student_records (university_id, email, student_number, course, year_of_study, faculty, fee_status, updated_at)
    values (v_uni, v_email, public.clean_text(v_row ->> 'student_number', 40), public.clean_text(v_row ->> 'course', 120), public.clean_text(v_row ->> 'year_of_study', 40), public.clean_text(v_row ->> 'faculty', 120), public.clean_fee_status(v_row ->> 'fee_status'), now())
    on conflict (university_id, email) do update set
      student_number = excluded.student_number, course = excluded.course, year_of_study = excluded.year_of_study,
      faculty = excluded.faculty, fee_status = excluded.fee_status, updated_at = now();
    v_saved := v_saved + 1;
    update public.profiles p set
      student_number = r.student_number, course = r.course, year_of_study = r.year_of_study, faculty = r.faculty, fee_status = r.fee_status
    from public.student_records r
    where r.university_id = v_uni and r.email = v_email and p.university_id = v_uni and lower(p.email) = v_email and p.role = 'student';
    get diagnostics v_n = row_count;
    v_applied := v_applied + v_n;
  end loop;

  return json_build_object('saved', v_saved, 'appliedToAccounts', v_applied, 'skipped', v_skipped);
end;
$$;

/* ---------------------------------------------------------------- admin team (T06) */

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
    'pending', coalesce((select json_agg(json_build_object('email', email, 'invitedAt', created_at) order by created_at) from public.pending_admins where university_id = v_uni), '[]'::json)
  );
end;
$$;

-- Grants or removes careers-admin access for someone at the caller's university.
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
      return 'granted';
    end if;
    insert into public.pending_admins (university_id, email, invited_by) values (v_uni, v_email, (select auth.uid()))
    on conflict do nothing;
    return 'invited';
  end if;

  delete from public.pending_admins where university_id = v_uni and email = v_email;
  if v_id is null then return 'removed'; end if;
  if (select count(*) from public.profiles where university_id = v_uni and role = 'admin') <= 1 and exists (select 1 from public.profiles where id = v_id and role = 'admin') then
    raise exception 'Your university needs at least one careers admin' using errcode = '22023';
  end if;
  update public.profiles set role = 'student' where id = v_id;
  return 'removed';
end;
$$;

/* ---------------------------------------------------------------- opportunities (T07) */

alter table public.opportunities
  add column university_id uuid references public.universities (id) on delete cascade,
  add column url text check (url is null or url ~ '^https?://'),
  add column created_by uuid references public.profiles (id) on delete set null,
  add column updated_at timestamptz not null default now();
alter table public.opportunities
  add constraint opportunities_text_limits check (
    char_length(role) between 1 and 160 and char_length(org) between 1 and 120 and char_length(location) between 1 and 120
    and char_length(description) <= 8000 and char_length(sector) <= 60
  );
create index opportunities_university_idx on public.opportunities (university_id);

-- The caller's university if they're an admin, else null. Used by RLS policies.
create or replace function public.my_admin_university()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select university_id from public.profiles where id = (select auth.uid()) and role = 'admin';
$$;

create or replace function public.my_university()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select university_id from public.profiles where id = (select auth.uid());
$$;

drop policy if exists "opportunities readable when signed in" on public.opportunities;
-- Students see shared opportunities plus their own university's.
create policy "read shared and own university opportunities" on public.opportunities for select to authenticated
  using (university_id is null or university_id = (select public.my_university()));
-- Careers admins manage only their own university's opportunities.
create policy "admins insert own opportunities" on public.opportunities for insert to authenticated
  with check (university_id is not null and university_id = (select public.my_admin_university()));
create policy "admins update own opportunities" on public.opportunities for update to authenticated
  using (university_id = (select public.my_admin_university()))
  with check (university_id = (select public.my_admin_university()));
create policy "admins delete own opportunities" on public.opportunities for delete to authenticated
  using (university_id = (select public.my_admin_university()));
grant select, insert, update, delete on public.opportunities to authenticated;

revoke execute on function public.admin_import_students(jsonb) from public, anon;
revoke execute on function public.admin_list_team() from public, anon;
revoke execute on function public.admin_set_role(text, boolean) from public, anon;
grant execute on function public.admin_import_students(jsonb) to authenticated;
grant execute on function public.admin_list_team() to authenticated;
grant execute on function public.admin_set_role(text, boolean) to authenticated;
grant execute on function public.my_admin_university() to authenticated;
grant execute on function public.my_university() to authenticated;
