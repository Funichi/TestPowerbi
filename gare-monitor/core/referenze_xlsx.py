"""Referenze: esportazione in Excel (anche modello per i caricamenti massivi), importazione con anteprima e importazione di schede JSON con unione."""
import difflib
import io
import re
import secrets
import time
import unicodedata

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

from . import referenze_cfg as cfg
from .referenze import MODIFICABILI, RefError, cliente_key, mancanti_automatici, normalizza, valida

SEP = " ; "
PUNTO = "• "
# (campo, intestazione, larghezza, obbligatorio): le colonne e l'ordine del foglio «Referenze» di Referenze_Consolidate.xlsx
COLONNE = [("id", "ID", 10, True), ("origine", "Origine", 16, False), ("contatore", "Contatore Excel", 10, False), ("cliente", "Cliente", 26, True), ("titolo", "Titolo", 42, True),
           ("ambito", "Ambito", 20, True), ("tipologie", "Tipologie", 34, False), ("mercato", "Mercato", 22, True), ("segmento", "Segmento", 13, False), ("anno", "Anno", 8, False),
           ("temi", "Temi", 26, False), ("tecnologie", "Tecnologie", 34, False), ("pitch", "Pitch 30 secondi", 60, False), ("esteso", "Racconto esteso", 90, False),
           ("fonti", "Fonti", 40, False), ("confidenza", "Confidenza abbinamento", 12, False), ("materiale", "Materiale", 10, False), ("campi_mancanti", "Campi mancanti", 30, False),
           ("da_verificare", "Da verificare", 10, False), ("note", "Note di verifica", 60, False), ("titolo_excel", "Titolo originale Excel", 34, False),
           ("descrizione_excel", "Descrizione originale Excel", 60, False), ("referente_aidata", "Referente AI&Data", 18, False), ("referente_mercato", "Referente Mercato", 13, False),
           ("referente_progetto", "Referente di progetto", 13, False), ("owner", "Owner", 12, False)]
# campi dell'archivio che non sono nel foglio: si leggono se compaiono (colonna facoltativa), non si esportano (tranne "Archiviata" su richiesta)
COLONNA_ARCHIVIATA = ("archiviata", "Archiviata", 11, False)
ETICHETTE = {c: h for c, h, _, _ in COLONNE + [COLONNA_ARCHIVIATA]}
LISTE = ("tipologie", "temi", "tecnologie", "fonti", "documenti", "campi_mancanti")
BOOL = ("da_verificare", "archiviata")
NON_MODIFICABILI = {"id", "origine", "contatore"}
DA_CONFRONTARE = [c for c, _, _, _ in COLONNE + [COLONNA_ARCHIVIATA] if c not in NON_MODIFICABILI] + ["documenti", "tecnologie_excel"]
# nomi alternativi delle intestazioni (si confrontano senza maiuscole, accenti e punteggiatura)
EXTRA_ALIAS = {"id": ["idreferenza", "codice", "ref"], "contatore": ["contatore", "nriga", "riga", "n"], "titolo_excel": ["titoloexcel", "titolooriginale", "titolomaster"],
               "tipologie": ["tipologia"], "pitch": ["pitch", "in30secondi", "racconto30secondi", "racconto30s", "racconto da 30 secondi"], "esteso": ["raccontoesteso", "esteso"],
               "descrizione_excel": ["descrizione", "descrizioneexcel"], "tecnologie_excel": ["tecnologieexcel", "tecnologieoriginaliexcel", "tecnologieoriginali"],
               "documenti": ["documenti", "iddocumenti"], "archiviata": ["archiviata", "archiviato"], "confidenza": ["confidenza"], "note": ["note"],
               "referente_aidata": ["referenteaidata", "referenteaiedata", "referenteai"], "campi_mancanti": ["mancante", "campimancanti"], "da_verificare": ["daverificare", "verificare"],
               "owner": ["proprietario"]}
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _n(s):
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().casefold())


ALIAS = {}
for _c, _h in ETICHETTE.items():
    ALIAS[_n(_h)] = _c
    ALIAS[_n(_c)] = _c
for _c, _l in EXTRA_ALIAS.items():
    for _a in _l:
        ALIAS.setdefault(_n(_a), _c)


# ---------------------------------------------------------------- formato delle celle (racconto esteso e liste)
def esteso_a_testo(esteso):
    parti = []
    for s in esteso or []:
        t = s.get("testo")
        corpo = "\n".join(PUNTO + str(x) for x in t) if isinstance(t, list) else str(t or "")
        parti.append(f"## {s['sezione']}\n{corpo}")
    return "\n\n".join(parti)


def testo_a_esteso(testo):
    """Inverso di esteso_a_testo: '## Sezione' apre una sezione; se tutte le righe iniziano con '• ' è un elenco, altrimenti un paragrafo."""
    sezioni, cur = [], None
    for riga in str(testo or "").replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if riga.startswith("## "):
            cur = {"sezione": riga[3:].strip(), "righe": []}
            sezioni.append(cur)
        elif cur is not None:
            cur["righe"].append(riga)
        elif riga.strip():
            raise RefError("Il racconto esteso deve iniziare con una riga '## Nome sezione'")
    out = []
    for s in sezioni:
        piene = [r for r in s["righe"] if r.strip()]
        if piene and all(r.lstrip().startswith("•") for r in piene):
            out.append({"sezione": s["sezione"], "testo": [r.lstrip()[1:].strip() for r in piene]})
        else:
            out.append({"sezione": s["sezione"], "testo": "\n".join(s["righe"]).strip()})
    return out


def _liste(v):
    return [x.strip() for x in str(v or "").split(";") if x.strip()]


def _bool(v):
    return str(v or "").strip().casefold() in ("sì", "si", "s", "true", "vero", "1", "x", "yes", "y")


def _pulisci(s):
    return _CTRL.sub("", s) if isinstance(s, str) else s


# ---------------------------------------------------------------- forma canonica (per confrontare file e archivio senza falsi cambiamenti)
def canon(campo, v):
    if campo in LISTE:
        return [str(x).strip() for x in (v or []) if str(x).strip()]
    if campo == "esteso":
        out = []
        for s in v or []:
            t = s.get("testo")
            out.append({"sezione": str(s.get("sezione", "")).strip(), "testo": [str(x).strip() for x in t if str(x).strip()] if isinstance(t, list) else str(t or "").strip()})
        return out
    if campo in BOOL:
        return bool(v)
    return str(v if v is not None else "").strip()


# ---------------------------------------------------------------- esportazione
def esporta(store, includi_archiviate=False):
    """File nel formato di Referenze_Consolidate.xlsx: foglio «Referenze» (stesse colonne e stesso ordine), «Domini» e «Leggimi».
    Le archiviate si esportano solo su richiesta, con una colonna «Archiviata» in più."""
    colonne = COLONNE + ([COLONNA_ARCHIVIATA] if includi_archiviate else [])
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Referenze"
    ws.append([h for _, h, _, _ in colonne])
    for r in sorted(store.elenco(archiviate=includi_archiviate), key=lambda r: (int(re.sub(r"\D", "", r["id"]) or 0), r["id"])):        # per ID, come nel file consolidato
        riga = []
        for campo, _, _, _ in colonne:
            v = r.get(campo)
            if campo in LISTE:
                v = SEP.join(v or [])
            elif campo == "esteso":
                v = esteso_a_testo(v)
            elif campo in BOOL:
                v = "Sì" if v else "No"
            elif campo == "contatore":
                v = v if isinstance(v, int) else None
            riga.append(_pulisci(v) if v != "" else None)
        ws.append(riga)
    base = Font(name="Arial", size=10)
    giallo, rosa = PatternFill("solid", start_color="FFFFF2CC", end_color="FFFFF2CC"), PatternFill("solid", start_color="FFC2187A", end_color="FFC2187A")
    for i, (campo, _, w, obbl) in enumerate(colonne, 1):
        c = ws.cell(1, i)
        c.font, c.fill, c.alignment = (Font(name="Arial", size=10, bold=True, color="FF000000") if obbl else Font(name="Arial", size=10, bold=True, color="FFFFFFFF")), (giallo if obbl else rosa), Alignment(vertical="center", wrap_text=True)
        ws.column_dimensions[c.column_letter].width = w
        for r in range(2, ws.max_row + 1):
            cell = ws.cell(r, i)
            cell.font, cell.alignment = base, Alignment(vertical="top", wrap_text=True)
            if isinstance(cell.value, str) and cell.value.startswith("="):
                cell.data_type = "s"                                   # un testo che inizia con "=" non deve diventare una formula
            if campo == "anno":
                cell.number_format = "@"
    ws.row_dimensions[1].height = 46
    ws.freeze_panes = "E2"
    ws.auto_filter.ref = ws.dimensions
    # Domini (stesse colonne del file consolidato)
    dm = wb.create_sheet("Domini")
    dom = [("Ambito", cfg.AMBITI), ("Tipologie AI", cfg.TIPOLOGIE["AI"]), ("Tipologie Data", cfg.TIPOLOGIE["Data Management & Reporting"]), ("Mercato", cfg.MERCATI),
           ("Campi mancanti", cfg.CAMPI_MANCANTI), ("Confidenza", cfg.CONFIDENZE), ("Materiale", cfg.MATERIALE)]
    for i, (titolo, valori) in enumerate(dom, 1):
        c = dm.cell(1, i, titolo)
        c.font, c.fill = Font(name="Arial", size=10, bold=True, color="FFFFFFFF"), rosa
        dm.column_dimensions[c.column_letter].width = [28, 40, 36, 28, 40, 14, 12][i - 1]
        for j, v in enumerate(valori, 2):
            dm.cell(j, i, v).font = base
    # menu a tendina (Ambito, Mercato, Confidenza, Materiale), come nel file consolidato
    for campo, col, n in (("ambito", "A", len(cfg.AMBITI)), ("mercato", "D", len(cfg.MERCATI)), ("confidenza", "F", len(cfg.CONFIDENZE)), ("materiale", "G", len(cfg.MATERIALE))):
        idx = [c for c, _, _, _ in colonne].index(campo) + 1
        dv = DataValidation(type="list", formula1=f"=Domini!${col}$2:${col}${n + 1}", allow_blank=True, showErrorMessage=False)
        ws.add_data_validation(dv)
        dv.add(f"{ws.cell(2, idx).coordinate}:{ws.cell(max(ws.max_row, 755), idx).coordinate}")
    # Leggimi
    lg = wb.create_sheet("Leggimi")
    righe = [
        ("Libreria Referenze AI & Data – esportazione dall'app", 14, True), ("", 10, False),
        (f"Esportato il {time.strftime('%d/%m/%Y')} dall'app Gare & Offerte ({store.count(archiviate=False)} referenze{', più le archiviate' if includi_archiviate else ''}).", 10, False), ("", 10, False),
        ("Fogli", 11, True),
        ("• Referenze: una riga per referenza. È anche il formato per i caricamenti massivi (Importa da Excel).", 10, False),
        ("• Domini: valori ammessi per Ambito, Tipologie, Mercato, Campi mancanti, Confidenza e Materiale.", 10, False), ("", 10, False),
        ("Come compilare nuove righe (caricamento massivo)", 11, True),
        ("• Celle gialle in intestazione = campi obbligatori: ID, Cliente, Titolo, Ambito, Mercato.", 10, False),
        ("• ID: lasciare vuoto per una nuova referenza (l'app lo assegna); se presente, il caricamento aggiorna la referenza esistente invece di duplicarla.", 10, False),
        (f"• Tipologie, Temi, Tecnologie, Fonti, Campi mancanti: più valori separati da \"{SEP}\".", 10, False),
        ("• Racconto esteso: sezioni introdotte da \"## Nome sezione\"; elenchi puntati con \"• \".", 10, False),
        ("• Da verificare: Sì / No. Anno: 4 cifre (es. 2024) oppure vuoto.", 10, False),
        ("• Ambito e Mercato hanno un menu a tendina; le Tipologie devono essere tra quelle del foglio Domini (quelle AI per l'ambito AI, quelle Data per Data Management & Reporting).", 10, False),
        ("• ID, Origine e Contatore Excel non si modificano da qui. Se una colonna manca nel file, quel campo non viene toccato.", 10, False),
        ("• Prima di applicare l'app mostra un'anteprima: nuove, aggiornate, righe con errori e campi che cambiano.", 10, False),
    ]
    for i, (t, size, bold) in enumerate(righe, 1):
        lg.cell(i, 1, t or None).font = Font(name="Arial", size=size, bold=bold)
    lg.column_dimensions["A"].width = 130
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


# ---------------------------------------------------------------- lettura del file
def leggi_xlsx(fileobj):
    """File Excel -> (righe, colonne_presenti, avvisi). righe = [{'n': numero riga Excel, 'dati': {campo: valore}}]."""
    try:
        wb = openpyxl.load_workbook(fileobj, data_only=True, read_only=True)
    except Exception as e:
        raise RefError(f"Non riesco ad aprire il file Excel: {e}") from e
    ws = wb["Referenze"] if "Referenze" in wb.sheetnames else wb[wb.sheetnames[0]]
    it = ws.iter_rows(values_only=True)
    intestazione = next(it, None)
    if not intestazione:
        raise RefError("Il foglio è vuoto")
    mappa, avvisi = {}, []
    for i, h in enumerate(intestazione):
        if h is None or str(h).strip() == "":
            continue
        campo = ALIAS.get(_n(h))
        if campo and campo not in mappa.values():
            mappa[i] = campo
        else:
            avvisi.append(f"Colonna ignorata: «{h}»")
    if not mappa:
        raise RefError("Non riconosco nessuna colonna: usa il file esportato dall'app come modello")
    righe = []
    for n, row in enumerate(it, 2):
        dati = {}
        for i, campo in mappa.items():
            v = row[i] if i < len(row) else None
            if campo == "contatore":
                dati[campo] = int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None
            elif campo in LISTE:
                dati[campo] = _liste(v)
            elif campo in BOOL:
                dati[campo] = _bool(v)
            elif campo == "esteso":
                dati[campo] = testo_a_esteso(_pulisci(v))
            elif campo == "anno":
                dati[campo] = str(int(v)) if isinstance(v, (int, float)) and not isinstance(v, bool) and float(v).is_integer() else str(v or "").strip()
            else:
                dati[campo] = str(v).strip() if v is not None else ""
        if any(dati.get(c) not in ("", [], None, False) for c in dati if c not in ("id",)) or dati.get("id"):
            righe.append({"n": n, "dati": dati})
    wb.close()
    return righe, set(mappa.values()), avvisi


# ---------------------------------------------------------------- anteprima e applicazione (Excel)
_PENDENTI = {}


def _pulisci_pendenti():
    for t in [t for t, v in _PENDENTI.items() if time.time() - v["ts"] > 1800]:
        _PENDENTI.pop(t, None)


def anteprima_excel(store, fileobj):
    righe, presenti, avvisi = leggi_xlsx(fileobj)
    esistenti = {r["id"]: r for r in store.elenco(archiviate=True)}
    nuove, aggiornate, invariate, errori, viste = [], [], 0, [], set()
    for riga in righe:
        n, dati = riga["n"], riga["dati"]
        rid = (dati.get("id") or "").strip()
        try:
            if rid:
                if rid in viste:
                    raise RefError(f"ID duplicato nel file: {rid}")
                viste.add(rid)
                cur = esistenti.get(rid)
                if not cur:
                    raise RefError(f"ID {rid} non presente nell'archivio (lascia l'ID vuoto per crearla come nuova)")
                cambi = {}
                for campo in DA_CONFRONTARE:
                    if campo not in presenti or campo not in dati:
                        continue
                    if campo in ("materiale", "confidenza") and not dati[campo]:
                        continue                                              # cella vuota = non cambiare
                    if canon(campo, dati[campo]) != canon(campo, cur[campo]):
                        cambi[campo] = dati[campo]
                if not cambi:
                    invariate += 1
                    continue
                valida(normalizza({**cur, **{k: v for k, v in cambi.items() if k != "archiviata"}}), cur)
                aggiornate.append({"n": n, "id": rid, "cliente": cur["cliente"], "titolo": cur["titolo"], "cambi": cambi,
                                   "campi": [{"campo": c, "etichetta": ETICHETTE.get(c, c), "prima": cur[c], "dopo": v} for c, v in cambi.items()]})
            else:
                nuova = {k: v for k, v in dati.items() if k in MODIFICABILI or k == "archiviata"}
                valida(normalizza(nuova))
                nuove.append({"n": n, "cliente": nuova.get("cliente", ""), "titolo": nuova.get("titolo", ""), "dati": nuova})
        except RefError as e:
            errori.append({"n": n, "id": rid, "cliente": dati.get("cliente", ""), "titolo": dati.get("titolo", ""), "errore": str(e)})
    _pulisci_pendenti()
    token = secrets.token_hex(12)
    _PENDENTI[token] = {"ts": time.time(), "nuove": nuove, "aggiornate": aggiornate}
    return {"token": token, "righe": len(righe), "invariate": invariate, "avvisi": avvisi, "errori": errori,
            "nuove": [{k: v for k, v in x.items() if k != "dati"} for x in nuove],
            "aggiornate": [{k: v for k, v in x.items() if k != "cambi"} for x in aggiornate]}


def applica_excel(store, token):
    p = _PENDENTI.pop(token, None)
    if not p:
        raise RefError("L'anteprima è scaduta: ricarica il file")
    store.backup()                                                           # copia di sicurezza prima di scrivere
    creati = aggiornati = 0
    errori = []
    for x in p["nuove"]:
        try:
            d = dict(x["dati"])
            arch = d.pop("archiviata", False)
            nuova = store.crea(d, origine="Import Excel")
            if arch:
                store.archivia(nuova["id"], True)
            creati += 1
        except RefError as e:
            errori.append({"n": x["n"], "errore": str(e)})
    for x in p["aggiornate"]:
        try:
            cambi = dict(x["cambi"])
            arch = cambi.pop("archiviata", None)
            if cambi:
                store.aggiorna(x["id"], cambi)
            if arch is not None:
                store.archivia(x["id"], arch)
            aggiornati += 1
        except RefError as e:
            errori.append({"n": x["n"], "errore": str(e)})
    return {"creati": creati, "aggiornati": aggiornati, "errori": errori}


# ---------------------------------------------------------------- importa scheda (JSON) con unione
def _norm_titolo(t):
    return re.sub(r"[^a-z0-9 ]", "", unicodedata.normalize("NFKD", str(t or "")).encode("ascii", "ignore").decode().casefold())


def schede_da_json(payload):
    if isinstance(payload, dict):
        payload = payload.get("referenze", [payload])
    if not isinstance(payload, list) or not payload or not all(isinstance(x, dict) for x in payload):
        raise RefError("Mi aspetto una scheda, un elenco di schede, oppure {\"referenze\": [...]}")
    return payload


def anteprima_schede(store, payload):
    esistenti = store.elenco(archiviate=True)
    out = []
    for i, grezza in enumerate(schede_da_json(payload)):
        s = normalizza({k: v for k, v in grezza.items() if k in MODIFICABILI or k in ("id", "origine")})
        errori = []
        try:
            valida(s)
        except RefError as e:
            errori = str(e).split("; ")
        cand = []
        for r in esistenti:
            punti = 0.5 * (cliente_key(r["cliente"]) == cliente_key(s["cliente"]) and bool(s["cliente"])) + 0.5 * difflib.SequenceMatcher(None, _norm_titolo(s["titolo"]), _norm_titolo(r["titolo"])).ratio()
            if s["id"] and s["id"] == r["id"]:
                punti = 1.0
            if punti >= 0.45:
                cand.append({"id": r["id"], "cliente": r["cliente"], "titolo": r["titolo"], "punteggio": round(punti, 2), "archiviata": r["archiviata"]})
        cand.sort(key=lambda c: -c["punteggio"])
        out.append({"indice": i, "scheda": s, "errori": errori, "candidati": cand[:5], "suggerimento": cand[0]["id"] if cand and cand[0]["punteggio"] >= 0.8 else "nuova"})
    return {"schede": out}


def applica_schede(store, azioni):
    store.backup()
    creati = uniti = saltati = 0
    errori = []
    for a in azioni or []:
        tipo = a.get("tipo")
        try:
            if tipo == "nuova":
                d = {k: v for k, v in (a.get("scheda") or {}).items() if k in MODIFICABILI}
                store.crea(d, origine=(a.get("scheda") or {}).get("origine") or "Import scheda")
                creati += 1
            elif tipo == "unisci":
                store.aggiorna(a["id"], {k: v for k, v in (a.get("campi") or {}).items() if k in MODIFICABILI})
                uniti += 1
            else:
                saltati += 1
        except (RefError, KeyError) as e:
            errori.append({"indice": a.get("indice"), "errore": str(e)})
    return {"creati": creati, "uniti": uniti, "saltati": saltati, "errori": errori}
