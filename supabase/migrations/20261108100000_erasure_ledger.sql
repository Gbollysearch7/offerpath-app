-- FD-21: which accounts have been erased, so that restoring a backup doesn't quietly bring them back.
--
-- One row per erased account: its opaque id and when. No name, no email, no CV content, and no foreign key, because the
-- row has to outlive the account it names. A trigger on auth.users fills it, so every way of deleting an account counts:
-- self-service, the retention job, the admin API, the dashboard.
--
-- THIS TABLE ALONE DOES NOT SOLVE THE PROBLEM. A restore takes this table back to the time of the backup, along with
-- everything else, so an erasure made after the backup is missing from it. The rows must also be exported off-site
-- (npm run erasures:export) and re-applied after a restore (npm run erasures:reapply). See docs/RESTORE_PROCEDURE.md.
--
-- Nothing purges this table yet. How long it may be kept, and whether keeping it is lawful, is a legal question for the
-- founder and the DPO (FD-21); it isn't settled here.

create table public.erasure_ledger (
  account_id uuid primary key,
  erased_at timestamptz not null default now()
);

alter table public.erasure_ledger enable row level security;

-- No policies: nothing a signed-in or signed-out user can do reaches it. The service role reads it to export, and
-- writes it only to put back rows from an export after a restore. Rows are never changed.
revoke all on table public.erasure_ledger from public, anon, authenticated, service_role;
grant select, insert on table public.erasure_ledger to service_role;

create function public.record_account_erasure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.erasure_ledger (account_id) values (old.id) on conflict (account_id) do nothing;
  return old;
end;
$$;

revoke execute on function public.record_account_erasure() from public, anon, authenticated, service_role;

-- If this can't write, the delete fails and the caller retries, rather than erasing someone with no record of it.
create trigger on_auth_user_erased
  after delete on auth.users
  for each row execute function public.record_account_erasure();
