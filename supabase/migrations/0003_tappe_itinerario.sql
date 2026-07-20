-- Tappe dell'itinerario: assegnano un luogo salvato a un giorno e a una posizione nell'ordine di quel giorno.
create table if not exists tappe_itinerario (
  id uuid primary key default gen_random_uuid(),
  viaggio_id uuid not null references viaggi(id) on delete cascade,
  luogo_id uuid not null references luoghi(id) on delete cascade,
  giorno int not null check (giorno > 0),
  posizione int not null check (posizione > 0),
  created_at timestamptz not null default now()
);

alter table tappe_itinerario enable row level security;

create policy "Seleziona tappe dei propri viaggi" on tappe_itinerario
  for select using (
    exists (select 1 from viaggi where viaggi.id = tappe_itinerario.viaggio_id and viaggi.user_id = auth.uid())
  );

create policy "Crea tappe nei propri viaggi" on tappe_itinerario
  for insert with check (
    exists (select 1 from viaggi where viaggi.id = tappe_itinerario.viaggio_id and viaggi.user_id = auth.uid())
  );

create policy "Aggiorna tappe dei propri viaggi" on tappe_itinerario
  for update using (
    exists (select 1 from viaggi where viaggi.id = tappe_itinerario.viaggio_id and viaggi.user_id = auth.uid())
  );

create policy "Elimina tappe dei propri viaggi" on tappe_itinerario
  for delete using (
    exists (select 1 from viaggi where viaggi.id = tappe_itinerario.viaggio_id and viaggi.user_id = auth.uid())
  );
