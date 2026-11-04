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
- Stati: WIP = in corso; Waiting For response = consegnato, si attende; Sospeso = gara sospesa o non uscita lato cliente; NoBID = decisione nostra di non partecipare; Won/Lost = esito (lo stato Closed non esiste più). Stato e Market vengono normalizzati in lettura (maiuscole, spazi; Market vuoto = "(non indicato)").

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

**Verifica in due passaggi (consigliata da internet).** Impostazioni > "Verifica in due passaggi": dopo aver impostato la password, "Attiva…" mostra un codice QR da inquadrare con un'app di autenticazione (Google/Microsoft Authenticator o simili); si conferma con il primo codice a 6 cifre e l'app mostra 8 **codici di recupero** monouso, da conservare (non verranno più mostrati). Da quel momento, da fuori serve password **e** codice; dal PC non cambia nulla. Disattivandola o cambiando la password si chiudono tutte le sessioni già aperte.
**Blocco dei tentativi.** Da 5 errori consecutivi (password o codice) l'accesso da fuori si chiude per 1 minuto, poi 5 minuti (10 errori), 30 minuti (15), 2 ore (20); non dipende dall'indirizzo di chi prova e si azzera con un accesso riuscito. Dal PC si entra comunque. La durata della sessione (predefinita 7 giorni) si regola in Impostazioni; "Ultimi accessi da fuori" mostra il registro (`accessi.log` accanto a `config.json`).
**Rete locale.** Spunta "Consenti connessioni dalla rete locale", riavvia l'app e apri `http://IP-del-PC:8765` dall'altro dispositivo (Windows chiede di autorizzare l'app sulle reti private).

**Internet (gratuito).** L'app resta su 127.0.0.1; un tunnel la pubblica con un indirizzo https:
- *Tailscale Funnel*: installa Tailscale sul PC, abilita Funnel per il tuo account e lancia `tailscale funnel 8765`; ottieni un indirizzo fisso del tipo `https://nomepc.xxxx.ts.net`.
- In alternativa ngrok (un dominio statico gratuito) o un Cloudflare quick tunnel (`cloudflared tunnel --url http://127.0.0.1:8765`, indirizzo diverso a ogni avvio).
Usa sempre una password lunga; la rete aziendale potrebbe bloccare questi indirizzi.

**Avvio automatico.** `Avvio-automatico.bat` (nella cartella dell'app) fa partire l'app all'accensione del PC, senza aprire il browser; `Disattiva-avvio-automatico.bat` lo toglie.

## Metriche (core/metrics.py)

Win rate = Won / (Won + Lost) · Bid rate = (offerte non NoBID) / (tutte escluse le Sospeso) · NoBID rate = NoBID / (tutte escluse le Sospeso). Ogni percentuale è mostrata con la numerosità (n); sotto n=5 è un "campione ridotto".
Colonne facoltative lette se presenti nell'Excel (intestazioni): Valore stimato (o Base d'asta), Valore offerto, Valore aggiudicato, Motivo esito, Motivo NoBID, Aggiudicatario, Gara padre (Seq dell'Accordo Quadro), Pwin. La colonna tecnica "Valore" già presente nel file non viene usata.

## Aggiornare l'app con un clic (repository privato)

A ogni push GitHub Actions costruisce l'app; **solo dai push su `main`** la pubblica come Release `latest` (zip `GareOfferte-<n>.zip`, `n` = numero di build, scritto anche in `version.txt` accanto all'exe).
**Token (una volta sola):** github.com > foto profilo > Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token. Nome a piacere, scadenza (es. 1 anno), "Only select repositories" > TestPowerbi, Repository permissions > **Contents: Read-only** (Metadata si aggiunge da solo). Copia il token (inizia con `github_pat_`) e incollalo in Impostazioni > Aggiornamenti dell'app.
Poi: "Controlla aggiornamenti" > "Aggiorna ora". L'app scarica lo zip, si chiude, `Aggiorna.ps1` sostituisce i file (restano `config.json`, `monitoraggio.db`, `backup`) e riavvia l'app; la pagina si ricarica da sola. Se l'app non parte, `Aggiorna.bat` (nella cartella) fa lo stesso da solo. Esito e errori: `aggiornamento.log`.
Il token resta nel tuo `config.json` (non esce dal PC e non viene mai mostrato nell'interfaccia): tienilo di sola lettura.

## Referenze (libreria delle referenze AI & Data)

Vista "Referenze" nel menu: ricerca per argomento (con sinonimi), cliente, ambito, tipologia e mercato; schede con racconto da 30 secondi e racconto esteso.
- **Database separato** `referenze.db` (SQLite) nella stessa cartella di `monitoraggio.db` (modificabile con `referenze_db` in `config.json`); non tocca mai `monitoraggio.db`. Backup a ogni avvio in `backup_referenze/` (ultime 20).
- **Primo caricamento** da `referenze.json` (percorso nelle Impostazioni, default `C:\Script\Referenze\referenze.json`): crea il database; da lì in poi il database è l'unica fonte.
- Domini (ambiti, tipologie, mercati…) e **sinonimi di ricerca** stanno in un solo file: `core/referenze_cfg.py`.
- Il codice della vista (`static/referenze.js`, `referenze.css`) si carica solo alla prima apertura della vista.
- **Dati riservati**: `referenze.db`, `backup_referenze/`, `referenze*.json`, `Referenze*.xlsx`, `Prototipo_Referenze*.html` sono in `.gitignore`; nel repository solo dati finti (`tests/fixtures/referenze_finte.json`).

### Referenze: creazione, modifica e completezza (passo 2)
"Nuova referenza" e "Modifica" aprono una scheda a pannello (racconto esteso a sezioni riordinabili, etichette per temi/tecnologie/fonti, azioni Archivia, Elimina, "Segna come verificata", Storico). Ogni modifica salvata scrive in `referenze_log` il valore precedente di ogni campo cambiato.
**Campi mancanti** (regole in `core/referenze.py`, `mancanti_automatici`): anno vuoto, nessuna tecnologia, nessun referente, racconto senza "Il valore per il cliente", senza "La soluzione nel dettaglio" né descrizione, mercato vuoto, nessuna fonte/documento. Al salvataggio si ricalcolano; le voci inserite a mano (o importate e non calcolabili) restano.
**Materiale proposto**: ricco = almeno 6 sezioni e una fonte; medio = almeno 4 sezioni (3 con fonte); scarso = altrimenti. Lo si può cambiare a mano.

### Referenze: Excel e schede JSON (passo 3)
- **Esporta in Excel**: `Referenze_AAAAMMGG.xlsx` nello stesso formato di `Referenze_Consolidate.xlsx` (foglio «Referenze» con le stesse 26 colonne nello stesso ordine, più «Domini» e «Leggimi»). Liste separate da ` ; `; racconto esteso con `## Sezione` e punti elenco `• `. Le archiviate si includono solo con «Mostra archiviate» attivo (colonna «Archiviata» in più). È anche il modello per i caricamenti massivi: il file consolidato originale si importa così com'è.
- **Importa da Excel**: riga con ID esistente = aggiorna, senza ID = nuova. Anteprima prima di scrivere (nuove, aggiornate con i campi che cambiano, errori); si leggono solo le colonne presenti; copia di backup prima di applicare. Un file esportato e reimportato senza modifiche dà 0 nuove e 0 cambiamenti.
- **Scaletta del meeting**: sulle schede, la ★ aggiunge la referenza alla scaletta attiva (la prima volta ne crea una con la data di oggi). La barra in basso mostra la scaletta numerata: un clic apre la referenza a schermo intero, le frecce (o il trascinamento) riordinano, ✕ la toglie. Si possono avere più scalette con nome (menu a tendina, “Nuova scaletta…”, “⋯” per rinominare, svuotare o eliminare); "Copia testo" mette negli appunti tutte le referenze, "Presenta" le apre in sequenza con ← →. In modalità presentazione, senza ricerca, compare la scaletta; scrivendo un argomento si cercano altre referenze al volo. Le scalette stanno in `referenze.db` (tabelle `scalette` e `scalette_voci`, create da sole) e quindi nei backup; una referenza archiviata o eliminata esce dalla scaletta.
- **Importa scheda**: JSON nel formato di `referenze.json` (una scheda, un elenco o `{"referenze": [...]}`). Per ogni scheda: crea come nuova, unisci a una esistente (campo per campo: tieni l'esistente, usa la nuova, unisci le voci/sezioni) o salta.
- Il codice di importazione (`static/referenze_dati.js`) si carica solo al primo clic su «Importa…».

### Referenze: presentazione, copia e collegamento (passo 4)
- **Modalità presentazione** (pulsante nella barra della vista; si esce con Esc o con il pulsante in alto a destra): testo molto più grande e niente di interno: barra laterale, intestazione, schede «Ricerca / Da completare», badge, ID, fonti, campi mancanti, referenti, pulsanti «Copia testo» e «Modifica».
- **Copia testo**: copia negli appunti titolo e cliente, racconto da 30 secondi e racconto esteso in testo semplice (sezioni con titolo, elenchi con «• »).
- **Scheda Cliente**: riquadro «Referenze» con il numero di referenze del cliente (nome abbinato senza maiuscole, punteggiatura e S.p.A.) e il link «Vedi le referenze →» alla ricerca già filtrata. Compare solo se l'archivio delle referenze esiste.

## Stimometro

Modulo di stima dei progetti Data (specifica: "Stimometro: specifica funzionale e tecnica", v1.0). Sviluppato per fasi: 1 motore di calcolo, 2 dati e persistenza, 3 interfaccia, 4 export Excel, 5 integrazione con le gare.

- `core/stime_catalogo.py`: catalogo dei parametri di default (team e costi, parametri generali, moduli, tipi oggetto, fasi, parametri AM). È il seed iniziale: i valori si calibreranno dall'app.
- `core/stime_motore.py`: motore di calcolo, unica implementazione delle regole (capitolo 4 della specifica). Senza database né interfaccia; aritmetica decimale con arrotondamento a mezza giornata (`R(x) = ROUND(x/Passo;0)×Passo`, valori normalizzati a 9 decimali); totali come somme di valori già arrotondati; divisioni per zero = "n/d" (None). Ogni stima porta con sé lo snapshot dei parametri e il motore usa solo quello.
- `core/stime.py` (**Fase 2: dati e persistenza**): database `stime.db` accanto a `monitoraggio.db`, indipendente (il reimport dell'Excel non lo tocca; percorso modificabile con `stime_db` in `config.json`; copia in `backup_stime/` a ogni avvio, ultime 20). Contiene il catalogo (tabelle `team`, `parametri`, `moduli`, `tipi_oggetto`, `fasi`, con il seed del §5 alla prima apertura) e le stime (`stime`, `righe_stima`, `voci_corpo`).
  - Ogni stima ha la copia congelata dei parametri (snapshot): modificare il catalogo vale solo per le stime create dopo; le differenze dal default corrente si vedono campo per campo e "Riallinea" le sostituisce con il catalogo (i tipi oggetto disattivati usati dalle righe restano con i parametri precedenti, con un avviso).
  - Versioni: "nuova versione" copia tutto con versione + 1, stesso nome e stessa gara, e diventa la corrente; "clona" crea una stima indipendente in versione 1 con lo stesso snapshot. Al massimo una versione corrente per gara (per le stime senza gara, una per famiglia di versioni).
  - Collegamento alle gare: chiave stabile "codice SS | anno della Data ins." (sopravvive al reimport), con una fotografia della gara (cliente, oggetto).
  - Catalogo: codici univoci e non modificabili; moduli e tipi oggetto si aggiungono o si disattivano, non si eliminano; team e fasi fissi (cambiano costi e percentuali).
  - Totali memorizzati per l'elenco: giornate complessive, costo, prezzo e margine del progetto; prezzo AM a parte.
  - API: `GET/POST /api/stime`, `GET/PUT/DELETE /api/stime/<id>`, `POST /api/stime/<id>/versione|clona|corrente|riallinea`, `POST /api/stime/calcola` (ricalcolo senza salvare), `GET/PUT /api/stime/catalogo`.
- **Fase 3: interfaccia** (`static/stime.js`, `static/stime.css`, caricati solo all'apertura della voce di menu **Stime**):
  - **Elenco**: nome, cliente, gara, versione (con "corrente"), giornate, prezzo, margine, AM, ultima modifica; filtri per testo, cliente e gara; azioni nuova versione, clona, elimina.
  - **Editor a percorso**: 1 *Impostazioni* (cliente, gara, durata, prezzo obiettivo, margine, costi delle figure, giornate al mese, arrotondamento, note) → 2 *Moduli* → 3 *Attività* (training e attività a corpo: di base setup degli ambienti, gestione della sicurezza del dato, altre attività) → 4 *Fasi* → 5 *AM* → 6 *Riepilogo*. **Parametri avanzati**: ripartizioni BE/FE delle fasi, moduli e tipi oggetto; "Riallinea ai default correnti".
  - *Moduli*: una tabella con le categorie a scomparsa (intestazione con subtotale; quelle senza righe restano chiuse con "+ Aggiungi <tipo>"); per ogni tipo oggetto un sottotitolo con regola di conteggio e gg unitari S/M/D; righe con etichetta, quantità, mix e giornate. Il mix è una pastiglia (grigia = default, colorata = personalizzato) che apre un riquadro con S/M/D, controllo della somma 100% e "Ripristina default"; passando sopra le giornate si vede il conto. Tab va da etichetta a quantità; Invio sulla quantità aggiunge una riga dello stesso tipo; il cestino compare passando sulla riga. Le righe vuote non si salvano.
  - *Fasi*: ogni fase (anche PM e contingency) è una percentuale della sua base oppure un numero di **giornate fisse** (marcate "fisse", ↺ torna alla percentuale). Le giornate fisse si dividono tra BE e FE con la stessa quota della percentuale: BE = R(N × quota BE), FE = R(N) − BE.
  - Le giornate si mostrano **totali**: BE e FE restano separati nel calcolo (contingency, FTE, ripartizione dell'AM, costi) e negli input che li richiedono.
  - A destra, sempre visibili, i **Totali** fino al prezzo (blocchi, totale attività, PM, contingency, totale con PM e contingency, costo, prezzo) e lo scostamento dal prezzo obiettivo con una barra. Il *Riepilogo* è diviso in Progetto, Application Management, Rispetto all'obiettivo e Indicatori (durata, FTE, costo e prezzo medi al giorno). Ricalcolo in tempo reale dal server; gli errori bloccano solo l'export.
  - **Catalogo parametri**: figure e costi, parametri generali, attività a corpo predefinite, fasi, moduli e tipi oggetto (aggiunta e disattivazione), parametri AM.
- **Fase 4: export Excel** (`core/stime_xlsx.py`, pulsante "Esporta Excel" nell'elenco e nel menu ⋯ dell'editor; `GET /api/stime/<id>/export`): file `Stima_<cliente>_<nome>_v<versione>_<aaaa-mm-gg>.xlsx` con il **layout dello Stimometro originale**, tre fogli:
  - **Parametri**: un blocco di complessità per tipo oggetto ("Flussi Staging", "Complessità …"), con mix, quantità per riga, giornate BE/FE e due righe di scorta, più la tabella di effort a destra; attività a corpo con il training; oggetti in esercizio e servizio AM; in alto a destra arrotondamento, giornate al mese e legenda;
  - **Stima** (attivo all'apertura): "Stima Completa" con le sezioni da Analisi a Deploy (giornate in C, percentuali in E), totali, costi, margine, ricavi, prezzo obiettivo e Maintenance; a destra i pannelli Peso %, Val x GG, GG Backend/Frontend/PM, Manutenzione, Tempi e FTE;
  - **Appoggio redistribuzione**: stesse righe di Stima, con le giornate per team, le % BE/FE delle fasi, la colonna "GG fisse" (vuota = vale la percentuale) e i Check di quadratura (devono dare 0).
  - **Formule vive** con le stesse regole del motore, arrotondamento compreso (`ROUND(ROUND(x;9)/Passo;0)*Passo`); input in testo blu; nomi definiti per i parametri scalari (Passo, GgMese, CostoBE/FE/PM, MargineProgetto, MargineAM, PrezzoObiettivo, Durata, PctPM, PctContingency, parametri AM); niente tabelle Excel né riferimenti strutturati; nessun codice tecnico visibile; griglia nascosta; colori dell'originale (navy 002060, azzurro 8FAADC, celeste DAE3F3, grigio CCCCCC); margine risultante in rosso se sotto il margine.
  - L'export è bloccato se la stima ha errori di validazione (il messaggio dice quali). È a senso unico: le modifiche fatte nell'Excel non tornano nell'app.
  - Verifica: `python -m pytest -q tests/test_stime_xlsx.py` genera l'Excel di TC1, TC2 e TC3, lo ricalcola con **LibreOffice** headless e confronta le celle chiave con il motore (tolleranza 0,01), cerca errori di formula, controlla fogli ed etichette principali e prova che cambiando input nell'Excel (quantità, margine, giornate fisse) i risultati seguono. Serve LibreOffice (`soffice`): dove non c'è i test si saltano; in GitHub Actions girano in un job Linux dedicato.
- **Fase 5: integrazione con le gare**: nella finestra "Modifica offerta" (dalla Tabella) c'è la sezione **Stime**, con le versioni collegate alla gara, la corrente per prima con giornate, prezzo, margine e AM, e il pulsante **Nuova stima**, che apre la vista Stime con gara e cliente già compilati. Un clic su una versione la apre. Il collegamento usa la chiave stabile "codice SS | anno della Data ins.", che sopravvive al reimport dell'Excel; servono il codice SS e la data di inserimento della gara. I totali mostrati sono quelli memorizzati a ogni salvataggio.
- **Stime di tipo Assessment** (`core/stime_assessment.py`, motore separato; `core/stime_xlsx_assessment.py`, export): lavoro di consulenza organizzato in workstream e attività con deliverable, giornate PM/BE/FE inserite a mano.
  - "Nuova stima" chiede prima il tipo (Progetto o Assessment), che non si cambia più; nuova versione e clona lo mantengono. Nell'elenco e nella scheda gara c'è l'etichetta del tipo; nell'elenco anche il filtro.
  - Percorso: 1 *Impostazioni* (cliente, gara, durata, prezzo obiettivo, costi PM/BE/FE, contingency, margine, note) → 2 *Workstream* (workstream e attività: ID automatico A.n.k modificabile e mai rinumerato, attività, deliverable, giornate; aggiungi, duplica, elimina, riordina; "Svuota") → 3 *Attività accessorie* → 4 *Riepilogo*. Parametri avanzati: arrotondamento e giornate al mese. Una nuova stima parte con il modello predefinito del catalogo (5 workstream, 28 attività).
  - Calcolo: subtotali per workstream e team; contingency per team R(Totale × %), anche sul PM; costo = totale con contingency × costo del team; prezzo = costo / (1 − margine); FTE sul totale con contingency; peso del workstream sul totale senza contingency.
  - Catalogo: sezione Assessment con costi (PM 460, BE 380, FE 380 €/gg), contingency 5%, margine 25% e il modello di workstream modificabile.
  - Database (schema 4): `stime.tipo` (le stime esistenti diventano "progetto"), tabelle `workstream` e `attivita_assessment`, `voci_corpo.gg_pm` per le attività accessorie, tabelle `ass_modello_ws` e `ass_modello_attivita` per il modello.
  - Export: un foglio "Stima" con ID, Workstream, Attività, Deliverable, giornate PM/BE/FE e Totale; subtotali, Totale Progetto, riga Contingency con i totali con contingency, costi, margine, ricavi, prezzo obiettivo, tempi e FTE; formule vive con R al passo.
  - Test: `tests/test_stime_assessment.py` (TCA1 con passo 0,5 e 1, archivio, migrazione, API, export ricalcolato con LibreOffice).
- **Regole cambiate rispetto alla specifica v1.0** (concordate):
  - niente modulo **Architettura** (disegno architetturale, ambienti, pipeline): se serve, si inserisce come attività a corpo. Nei database esistenti il modulo viene disattivato; le righe già inserite restano con i loro parametri;
  - **analisi e disegno** sono due fasi con una **percentuale unica** (default 6%) sull'implementazione di tutti i moduli, calcolata per team: `Analisi(t) = R(Σ Impl(m,t) × %Analisi)`, lo stesso per il disegno. Le stime esistenti prendono la percentuale che avevano i moduli;
  - la **sicurezza** non è più una percentuale sui moduli ma un'attività a corpo ("Gestione della sicurezza del dato"): i database esistenti passano allo schema 3, che toglie la fase e aggiunge le attività di base;
  - **giornate fisse** al posto della percentuale per fasi, PM e contingency (anche nell'Excel: colonna "gg fissi" nel foglio Parametri; vuota = percentuale);
  - i casi di test **TC1 e TC2** sono adattati (senza Architettura; TC2 con analisi al 6% per tutti i moduli): i valori attesi sono nei test (`tests/test_stime_motore.py`). L'AM di TC2 e tutto TC3 restano quelli della specifica.
- Test: `python -m pytest -q tests/test_stime_motore.py tests/test_stime_store.py` (casi TC1, TC2, TC3 della specifica, regole generali, persistenza e API).

