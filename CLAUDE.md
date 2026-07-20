# App di Viaggio — MVP

Web app che unisce un diario di viaggio (luoghi da visitare/mangiare/dormire) con un itinerario giorno per giorno.

## Stack

- Next.js (App Router, TypeScript, Tailwind CSS)
- Supabase (database + autenticazione)
- Google Maps API (ricerca luoghi, mappe, navigazione)
- Vercel (hosting)

## Come avviare il progetto in locale

```bash
npm install
npm run dev
```

Poi apri http://localhost:3000

## Variabili d'ambiente necessarie

Copia `.env.example` in `.env.local` e inserisci i valori veri (questo file non va mai su Git):

- `NEXT_PUBLIC_SUPABASE_URL` — URL del progetto Supabase
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — chiave pubblica (anon) del progetto Supabase
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — chiave API di Google Maps (Google Cloud Console)

## Struttura cartelle

- `app/` — pagine e routing (App Router)
- `components/` — elementi di interfaccia riutilizzabili
- `lib/` — logica di connessione a Supabase e Google Maps

## Stato di avanzamento

- [x] 0. Scaffold iniziale del progetto
- [x] 1. Autenticazione utente (registrazione, login, logout)
- [x] 2. Creazione e gestione viaggi
- [x] 3. Salvataggio luoghi per categoria
- [ ] 4. Costruzione dell'itinerario
- [ ] 5. Consultazione durante il viaggio (mobile + navigazione)
