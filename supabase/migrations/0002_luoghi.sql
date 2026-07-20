-- Tabella dei luoghi salvati, collegati a un viaggio.
create table if not exists luoghi (
  id uuid primary key default gen_random_uuid(),
  viaggio_id uuid not null references viaggi(id) on delete cascade,
  nome text not null,
  categoria text not null check (categoria in ('visitare', 'mangiare', 'dormire')),
  indirizzo text,
  lat double precision,
  lng double precision,
  google_place_id text,
  nota text,
  created_at timestamptz not null default now()
);

alter table luoghi enable row level security;

create policy "Seleziona luoghi dei propri viaggi" on luoghi
  for select using (
    exists (select 1 from viaggi where viaggi.id = luoghi.viaggio_id and viaggi.user_id = auth.uid())
  );

create policy "Crea luoghi nei propri viaggi" on luoghi
  for insert with check (
    exists (select 1 from viaggi where viaggi.id = luoghi.viaggio_id and viaggi.user_id = auth.uid())
  );

create policy "Aggiorna luoghi dei propri viaggi" on luoghi
  for update using (
    exists (select 1 from viaggi where viaggi.id = luoghi.viaggio_id and viaggi.user_id = auth.uid())
  );

create policy "Elimina luoghi dei propri viaggi" on luoghi
  for delete using (
    exists (select 1 from viaggi where viaggi.id = luoghi.viaggio_id and viaggi.user_id = auth.uid())
  );
