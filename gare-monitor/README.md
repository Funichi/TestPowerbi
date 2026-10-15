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
- **Pulizia dati**: solo suggerimenti, non scrive nulla. Si corregge nell'Excel e poi si preme "Aggiorna dall'Excel".

## Regole implementate
- Scrittura nell'Excel **tramite Excel stesso** (COM): tabella, formule, pivot e menu a tendina restano intatti. Se il file è già aperto in Excel viene aggiornato quello; altrimenti Excel lo apre in background.
- SS = prefisso del cliente (3 lettere, o quello già usato) + progressivo; Commessa da Domini (Vertical + anno della Data consegna, altrimenti Data ins.). Entrambi modificabili.
- Stati: WIP = in corso; Waiting For response = consegnato, si attende; Sospeso = nessuna risposta; Closed è uno stato a sé (escluso dal win rate); Won/Lost/NoBID = chiusi. Stato e Market vengono normalizzati in lettura (maiuscole, spazi; Market vuoto = "(non indicato)").

## Sviluppo / test
```
pip install -r requirements.txt pytest
python -m pytest -q tests
GARE_NO_BROWSER=1 python app.py      # GARE_CONFIG=percorso/config.json per un altro file di configurazione
```
Il percorso del database si può cambiare con `"db_path"` in `config.json`. Per provare su Linux/Mac la scrittura usa `"writer": "openpyxl"` in `config.json` (perde pivot e validazioni estese: solo per test).
