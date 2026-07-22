-- Foto del luogo (da Wikipedia, solo per la categoria "visitare"), mostrata nell'elenco dei luoghi salvati.
alter table luoghi add column if not exists foto_url text;
