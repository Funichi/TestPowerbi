# Gare & Offerte

App locale (si apre nel browser) che usa il file Excel `HISTORY.xlsx` come archivio principale:
inserimento e modifica righe, cruscotto con scadenze/punti di attenzione/pipeline per solution/trend mensili,
vista a tabella e a schede, pulizia dati. Solo foglio **gare e offerte** (e **Domini** per gli elenchi).

## Uso (Windows)
1. Scarica `GareOfferte.exe` (GitHub → Actions → "Build Gare Monitor" → artifact `GareOfferte-windows`) e mettilo in una cartella tua.
2. Doppio click: si apre la finestra nera (lasciala aperta) e il browser su http://127.0.0.1:8765.
3. Al primo avvio scegli il file Excel (copia sincronizzata di SharePoint). Il percorso viene salvato in `config.json` accanto all'exe.
Alternativa senza exe: con Python installato, doppio click su `Avvia.bat`.

## Come funzionano i dati
- L'app lavora su un **database locale SQLite** (`monitoraggio.db`, accanto all'app; nessuna installazione, nessun permesso di amministratore). Contiene **tutte le colonne** del foglio "gare e offerte" in un'unica tabella.
- **Aggiorna dall'Excel**: svuota il database e lo ricarica dal file. Le modifiche non ancora esportate vengono scartate (prima chiede conferma e salva una copia del database in `backup/`). Al primo avvio l'import è automatico.
- **Nuova offerta / modifica**: si salvano solo nel database. Le righe sono segnate "nuova" o "modificata"; una riga nuova si può eliminare, una modifica si può annullare.
- **Esporta in Excel**: mostra cosa verrà scritto e poi lo scrive direttamente in `HISTORY.xlsx` (righe nuove accodate dopo l'ultima, righe modificate aggiornate sulla loro riga). Prima crea un backup dell'Excel in `backup/`; se una riga da modificare nel file è cambiata nel frattempo si ferma senza scrivere nulla. Alla fine rilegge il file.
- **Clienti**: scheda per cliente (offerte, esiti, win rate e tempo medio di consegna a confronto con la media, storico, linea del tempo). Il nome cliente è cliccabile in Tabella e Cruscotto (non in Consegne WIP). "Apri cartella" apre la cartella del cliente dentro la cartella indicata in Impostazioni; se il nome non coincide si sceglie una volta e l'app lo ricorda.
- **Tempi di consegna**: giorni medi e mediani tra Data ins. e Data consegna per tipo, Solution e Vertical (solo offerte consegnate: esclusi WIP e NoBID).
- **Codice SS**: il progressivo riparte ogni anno (anno di Data ins.). È un duplicato solo se lo stesso codice compare due volte nello stesso anno.
- **Pulizia dati**: i suggerimenti non scrivono nulla (si corregge nell'Excel e poi "Aggiorna dall'Excel"). L'unione dei clienti scritti in modi diversi modifica invece il database locale e va poi esportata.

## Regole implementate
- Scrittura nell'Excel **tramite Excel stesso** (COM): tabella, formule, pivot e menu a tendina restano intatti. Se il file è già aperto in Excel viene aggiornato quello; altrimenti Excel lo apre in background.
- **Attenzione**: il colore della cella del nome cliente nell'Excel (giallo = rilevante, arancione = da attenzionare, rosso = urgente) è un livello 1-3 nell'app, modificabile da Consegne WIP, Tabella e form. All'esportazione la cella viene colorata (o ripulita) come a mano.
- SS = prefisso del cliente (3 lettere, o quello già usato) + progressivo; Commessa da Domini (Vertical + anno della Data consegna, altrimenti Data ins.). Entrambi modificabili.
- Stati: WIP = in corso; Waiting For response = consegnato, si attende; Sospeso = nessuna risposta; Closed è uno stato a sé (escluso dal win rate); Won/Lost/NoBID = chiusi. Stato e Market vengono normalizzati in lettura (maiuscole, spazi; Market vuoto = "(non indicato)").

## Sviluppo / test
```
pip install -r requirements.txt pytest
python -m pytest -q tests
GARE_NO_BROWSER=1 python app.py      # GARE_CONFIG=percorso/config.json per un altro file di configurazione
```
Il percorso del database si può cambiare con `"db_path"` in `config.json`. Per provare su Linux/Mac la scrittura usa `"writer": "openpyxl"` in `config.json` (perde pivot e validazioni estese: solo per test).

## Aggiornare l'app (Windows)

L'artefatto di GitHub Actions è una cartella (GareOfferte.exe + _internal), non più un singolo exe: gli exe singoli vengono spesso bloccati da Defender come falsi positivi.
Chiudi l'app, estrai lo zip **sopra** la cartella esistente (es. `C:\Script\Monitoraggio History`) sovrascrivendo i file: `config.json`, `monitoraggio.db` e `backup` restano intatti.
Se Defender blocca comunque il file: Sicurezza di Windows > Protezione da virus > Cronologia protezione > Consenti sul file; oppure segnalalo come falso positivo su https://www.microsoft.com/wdsi/filesubmission.

## Usare l'app da un altro dispositivo o da internet

L'Excel "master" resta quello condiviso su SharePoint. Sul PC dove gira l'app tieni una copia: quando i colleghi hanno modificato il file condiviso, sovrascrivi la copia locale con quella aggiornata. L'app se ne accorge entro un minuto e rilegge i dati da sola; se ci sono modifiche non ancora esportate non tocca nulla e il pallino del file diventa arancione ("Aggiorna dall'Excel" le scarterebbe: esporta prima).
Attenzione: "Esporta in Excel" scrive nella copia locale. Quelle righe vanno poi riportate nel file condiviso di SharePoint, altrimenti la prossima sovrascrittura le cancella.

**Password.** Impostazioni > "Accesso da altre reti o da internet". Dal PC l'app si apre sempre senza password; da qualsiasi altro percorso (rete locale o tunnel) serve la password, altrimenti l'accesso è rifiutato. Da fuori non si possono cambiare le Impostazioni né aprire le cartelle del PC.

**Rete locale.** Spunta "Consenti connessioni dalla rete locale", riavvia l'app e apri `http://IP-del-PC:8765` dall'altro dispositivo (Windows chiede di autorizzare l'app sulle reti private).

**Internet (gratuito).** L'app resta su 127.0.0.1; un tunnel la pubblica con un indirizzo https:
- *Tailscale Funnel*: installa Tailscale sul PC, abilita Funnel per il tuo account e lancia `tailscale funnel 8765`; ottieni un indirizzo fisso del tipo `https://nomepc.xxxx.ts.net`.
- In alternativa ngrok (un dominio statico gratuito) o un Cloudflare quick tunnel (`cloudflared tunnel --url http://127.0.0.1:8765`, indirizzo diverso a ogni avvio).
Usa sempre una password lunga; la rete aziendale potrebbe bloccare questi indirizzi.

**Avvio automatico.** `Avvio-automatico.bat` (nella cartella dell'app) fa partire l'app all'accensione del PC, senza aprire il browser; `Disattiva-avvio-automatico.bat` lo toglie.
