-- The RLS helpers only mean something for a signed-in user. Signed-out visitors got null back, but
-- shouldn't be able to call them at all (flagged by the Supabase security advisor).
revoke execute on function public.my_admin_university() from public, anon;
revoke execute on function public.my_university() from public, anon;
