-- Città del luogo (estratta dai risultati di Google Maps), usata per raggruppare i luoghi nell'interfaccia.
alter table luoghi add column if not exists citta text;
