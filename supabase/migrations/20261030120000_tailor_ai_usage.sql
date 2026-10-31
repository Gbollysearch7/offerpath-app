-- Tailoring a CV to a job ad with Claude gets its own daily limit.

alter table public.ai_usage drop constraint ai_usage_kind_check;
alter table public.ai_usage add constraint ai_usage_kind_check check (kind in ('line_rewrite', 'letter', 'cv_score', 'tailor'));

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
  if p_kind not in ('line_rewrite', 'letter', 'cv_score', 'tailor') then
    raise exception 'unknown kind';
  end if;
  insert into public.ai_usage (user_id, day, kind, count)
  values ((select auth.uid()), current_date, p_kind, 1)
  on conflict (user_id, day, kind) do update set count = public.ai_usage.count + 1
  returning count into v_count;
  return v_count;
end;
$$;
