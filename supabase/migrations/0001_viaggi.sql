-- Tabella dei viaggi, uno o più per utente.
create table if not exists viaggi (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  data_inizio date,
  data_fine date,
  created_at timestamptz not null default now()
);

alter table viaggi enable row level security;

create policy "Seleziona i propri viaggi" on viaggi
  for select using (auth.uid() = user_id);

create policy "Crea i propri viaggi" on viaggi
  for insert with check (auth.uid() = user_id);

create policy "Aggiorna i propri viaggi" on viaggi
  for update using (auth.uid() = user_id);

create policy "Elimina i propri viaggi" on viaggi
  for delete using (auth.uid() = user_id);
