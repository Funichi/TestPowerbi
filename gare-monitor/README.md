# Gare & Offerte

App locale (si apre nel browser) che usa il file Excel `HISTORY.xlsx` come archivio principale:
inserimento e modifica righe, cruscotto con scadenze/punti di attenzione/pipeline per solution/trend mensili,
vista a tabella e a schede, pulizia dati. Solo foglio **gare e offerte** (e **Domini** per gli elenchi).

## Uso (Windows)
1. Scarica `GareOfferte.exe` (GitHub → Actions → "Build Gare Monitor" → artifact `GareOfferte-windows`) e mettilo in una cartella tua.
2. Doppio click: si apre la finestra nera (lasciala aperta) e il browser su http://127.0.0.1:8765.
3. Al primo avvio scegli il file Excel (copia sincronizzata di SharePoint). Il percorso viene salvato in `config.json` accanto all'exe.
Alternativa senza exe: con Python installato, doppio click su `Avvia.bat`.

## Regole implementate
- Scrittura **tramite Excel stesso** (COM): tabella, formule, pivot e menu a tendina restano intatti. Se il file è già aperto in Excel viene aggiornato quello; altrimenti Excel lo apre in background.
- **Backup** prima di ogni scrittura in `backup/` (ultimi 40).
- Prima di modificare una riga si controlla che non sia cambiata nel frattempo (Cliente+Oggetto+Data ins.).
- SS = prefisso del cliente (3 lettere, o quello già usato) + progressivo; Commessa da Domini (Vertical + anno della Data consegna, altrimenti Data ins.). Entrambi modificabili.
- Stati: WIP = in corso; Waiting For response = consegnato, si attende; Sospeso (incluso Closed) = nessuna risposta; Won/Lost/NoBID = chiusi.
- Da sollecitare: Waiting da 30 a 90 giorni dalla **Data ins.**; oltre 90 giorni = probabili Sospeso. Scadenze: WIP con consegna scaduta o entro 7 giorni.
- Colonne economiche e "Valore" non vengono lette né toccate.

## Sviluppo / test
```
pip install -r requirements.txt pytest
python -m pytest -q tests
GARE_NO_BROWSER=1 python app.py      # GARE_CONFIG=percorso/config.json per un altro file di configurazione
```
Per provare su Linux/Mac la scrittura usa `"writer": "openpyxl"` in `config.json` (perde pivot e validazioni estese: solo per test).
