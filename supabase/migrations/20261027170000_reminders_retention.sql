-- Scheduled jobs: deadline reminder emails (T04) and deletion of long-inactive accounts (privacy notice).
-- All functions here are server-only (service role).

create table public.reminder_log (
  application_id uuid primary key references public.applications (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  sent_at timestamptz not null default now()
);
alter table public.reminder_log enable row level security;
revoke all on public.reminder_log from anon, authenticated;

alter table public.profiles add column retention_warned_at timestamptz;

-- Tracked roles (not yet applied for) closing within 7 days, for students who want reminders and
-- haven't already been reminded about that role.
create or replace function public.due_deadline_reminders()
returns table (user_id uuid, email text, full_name text, application_id uuid, role text, org text, closes_on date)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.email, p.full_name, a.id, a.role, a.org, a.closes_on
  from public.applications a
  join public.profiles p on p.id = a.user_id
  join auth.users u on u.id = p.id
  where p.deadline_reminders
    and u.email_confirmed_at is not null
    and a.status = 'saved'
    and a.closes_on between current_date and current_date + 7
    and not exists (select 1 from public.reminder_log r where r.application_id = a.id)
  order by p.id, a.closes_on;
$$;

create or replace function public.mark_reminders_sent(p_application_ids uuid[])
returns integer
language sql
security definer
set search_path = ''
as $$
  with ins as (
    insert into public.reminder_log (application_id, user_id)
    select a.id, a.user_id from public.applications a where a.id = any (p_application_ids)
    on conflict do nothing
    returning 1
  )
  select count(*)::int from ins;
$$;

-- Accounts to warn (inactive for months - 1) or delete (inactive for months, warned 30+ days ago).
-- Careers admins are never deleted automatically.
create or replace function public.retention_candidates(p_months integer)
returns table (user_id uuid, email text, full_name text, action text)
language sql
stable
security definer
set search_path = ''
as $$
  select id, email, full_name,
    case when last_active_at < now() - make_interval(months => p_months) and retention_warned_at < now() - interval '30 days' then 'delete' else 'warn' end
  from public.profiles
  where role = 'student'
    and (
      (retention_warned_at is null and last_active_at < now() - make_interval(months => greatest(p_months - 1, 1)))
      or (last_active_at < now() - make_interval(months => p_months) and retention_warned_at < now() - interval '30 days')
    );
$$;

revoke execute on function public.due_deadline_reminders() from public, anon, authenticated;
revoke execute on function public.mark_reminders_sent(uuid[]) from public, anon, authenticated;
revoke execute on function public.retention_candidates(integer) from public, anon, authenticated;
