-- Pilot requests from the public landing page. Written only by the server (service role); nobody else can read them.

create table public.pilot_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  university text not null check (char_length(university) between 1 and 160),
  role text not null default '' check (char_length(role) <= 120),
  email text not null check (char_length(email) between 3 and 254),
  created_at timestamptz not null default now()
);
create index pilot_requests_created_idx on public.pilot_requests (created_at desc);
alter table public.pilot_requests enable row level security;
revoke all on public.pilot_requests from anon, authenticated;
