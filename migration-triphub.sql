-- TripHub: tabella viaggi condivisi
-- Esegui questo script UNA volta in Supabase: SQL Editor > New query > incolla > Run

create table if not exists public.triphub_trips (
  id text primary key,
  name text,
  start_day text,
  end_day text,
  location text,
  participants text,
  data jsonb,
  deleted boolean default false,
  updated_at timestamptz default now()
);

alter table public.triphub_trips enable row level security;

drop policy if exists "triphub anon select" on public.triphub_trips;
drop policy if exists "triphub anon insert" on public.triphub_trips;
drop policy if exists "triphub anon update" on public.triphub_trips;

create policy "triphub anon select" on public.triphub_trips for select using (true);
create policy "triphub anon insert" on public.triphub_trips for insert with check (true);
create policy "triphub anon update" on public.triphub_trips for update using (true);

-- realtime (se dà errore "already member", ignoralo: vuol dire che è già attivo)
alter publication supabase_realtime add table public.triphub_trips;
