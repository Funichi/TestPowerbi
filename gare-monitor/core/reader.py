"""Lettura dell'Excel (sola lettura, su una copia temporanea: il file originale non viene mai bloccato)."""
import datetime as dt
import os
import re
import shutil
import tempfile
import warnings

import openpyxl
from openpyxl.utils import column_index_from_string

from .normalize import normalize_rows

SHEET_MAIN = "gare e offerte"
SHEET_DOMINI = "Domini"

DATE_FIELDS = ["Data ins.", "Data Opt review", "Data consegna"]
# Campi che l'app mostra/modifica. Le colonne economiche e "Valore" restano intatte nel file.
FIELDS = [
    "Vertical", "Market", "Cliente", "Commessa", "SS", "Oggetto", "Legal Entity", "tipo",
    "Data ins.", "Data Opt review", "Data consegna", "Solution D&A", "Stato", "Salesman",
    "Referenti vertical", "Tecnologie di riferimento D&A", "Note",
]

# Colonne numeriche che l'app scrive (se ci sono nell'Excel): il TCV arriva dalla stima ufficiale dello Stimometro
NUM_FIELDS = ["TCV Offerta Economica"]


# Colonne facoltative: se nell'Excel ci sono (intestazioni qui sotto, maiuscole/minuscole indifferenti) l'app le usa, altrimenti
# le sezioni che le richiedono non compaiono. "Valore" non è tra queste: nel file è già una colonna tecnica.
OPTIONAL = {
    "valore": ["valore stimato", "base d'asta", "base asta", "valore base", "importo base"],
    "valore_offerto": ["valore offerto"],
    "valore_agg": ["valore aggiudicato"],
    "motivo_esito": ["motivo esito"],
    "motivo_nobid": ["motivo nobid", "motivo no bid"],
    "aggiudicatario": ["aggiudicatario"],
    "gara_padre": ["gara padre"],
    "pwin": ["pwin", "pwin %", "pwin%"],
}
NUMERIC_OPT = {"valore", "valore_offerto", "valore_agg", "pwin"}


def to_number(v):
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[€%\s]", "", str(v))
    if not s:
        return None
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def optional_columns(headers):
    """{chiave: intestazione presente nel file}."""
    low = {h.casefold(): h for h in headers}
    return {k: low[n] for k, names in OPTIONAL.items() for n in names if n in low}


ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$")


def to_date(v):
    """datetime/date/stringa gg/mm/aaaa o aaaa-mm-gg -> date, altrimenti None."""
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    if isinstance(v, str):
        s = v.strip()
        if ISO_RE.match(s):
            s = s[:10]
        for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%y", "%d.%m.%Y"):
            try:
                return dt.datetime.strptime(s, fmt).date()
            except ValueError:
                pass
    return None


def to_iso(v):
    d = to_date(v)
    return d.isoformat() if d else None


def clean_text(v):
    if v is None:
        return None
    s = str(v).replace("\xa0", " ")
    s = re.sub(r"[ \t]+", " ", s).strip()
    return s or None


def row_sig(cliente, oggetto, data_ins):
    """Impronta della riga: serve a verificare, prima di scrivere, che la riga non sia cambiata nel frattempo."""
    c = (clean_text(cliente) or "").casefold()
    o = (clean_text(oggetto) or "").casefold()
    return f"{c}|{o}|{to_iso(data_ins) or ''}"


def _column_list(ws, header):
    """Valori sotto l'intestazione `header` (riga 1) fino alla prima cella vuota."""
    col = None
    for c in ws[1]:
        if clean_text(c.value) == header:
            col = c.column
            break
    out = []
    if col is None:
        return out
    r = 2
    while ws.cell(r, col).value not in (None, ""):
        out.append(clean_text(ws.cell(r, col).value))
        r += 1
    return out


# Livello di attenzione = colore di riempimento della cella del nome cliente, come si fa oggi nell'Excel
ATT_COLORS = {1: "FFFF00", 2: "FFC000", 3: "FF0000"}          # giallo = rilevante, arancione = da attenzionare, rosso = urgente
ATT_LABELS = {0: "nessuna", 1: "Rilevante (giallo)", 2: "Da attenzionare (arancione)", 3: "Urgente (rosso)"}


def fill_level(cell):
    """0 se la cella non ha uno dei tre colori; altrimenti 1, 2 o 3."""
    f = cell.fill
    if f is None or f.fill_type != "solid":
        return 0
    c = f.fgColor
    if c is None or c.type != "rgb" or not isinstance(c.rgb, str) or len(c.rgb) < 6:
        return 0
    rgb = c.rgb[-6:].upper()
    for lvl, ref in ATT_COLORS.items():
        if sum(abs(int(rgb[i:i + 2], 16) - int(ref[i:i + 2], 16)) for i in (0, 2, 4)) <= 50:
            return lvl
    return 0


def _cell_value(v):
    """Valore di cella pronto per il database: date come testo ISO, il resto invariato."""
    if isinstance(v, dt.datetime):
        return v.date().isoformat() if (v.hour, v.minute, v.second) == (0, 0, 0) else v.isoformat(timespec="seconds")
    if isinstance(v, dt.date):
        return v.isoformat()
    if isinstance(v, dt.time):
        return v.isoformat(timespec="seconds")
    return v


def _is_formula(v):
    return (isinstance(v, str) and v.startswith("=")) or type(v).__name__ in ("ArrayFormula", "DataTableFormula")


def _formula_text(v):
    return v.text if hasattr(v, "text") else str(v or "")


def _tabella(wb, nome):
    """Righe (dict per intestazione) di una tabella Excel cercata per nome in tutti i fogli; None se non c'è."""
    for ws in wb.worksheets:
        for t in ws.tables.values():
            if t.name.casefold() == nome.casefold():
                righe = list(ws[t.ref])
                intest = [clean_text(c.value) for c in righe[0]]
                return [{h: c.value for h, c in zip(intest, r) if h} for r in righe[1:]]
    return None


def _anno(v):
    return v.year if isinstance(v, (dt.date, dt.datetime)) else None


def ricalcola_formule(ws_val, ws_form, wb_val, cols, domini):
    """Celle calcolate da formule ma salvate senza il valore (file scritto senza Excel, per esempio da openpyxl):
    l'app le ricostruisce con le stesse regole delle formule dell'Excel. Ritorna {colonna: {n_riga: valore}}.
    - SS: prefisso del cliente dalla tabella MappaSS (Cliente → Prefisso SS) + progressivo dell'anno della Data ins.,
      contando le righe sopra con lo stesso prefisso nello stesso anno (come la formula LET/XLOOKUP del file);
      "DA CENSIRE" se il cliente non è in MappaSS; vuoto se mancano cliente o data.
    - Commessa: codice da Domini per Vertical + anno della Data ins."""
    out = {}
    c_cli, c_ins = cols.get("Cliente"), cols.get("Data ins.")
    if "SS" in cols and c_cli and c_ins:
        c = cols["SS"]
        da_fare = [r for r in range(2, ws_val.max_row + 1) if ws_val.cell(r, c).value is None and _is_formula(ws_form.cell(r, c).value)
                   and "MappaSS" in _formula_text(ws_form.cell(r, c).value)]
        mappa_righe = _tabella(wb_val, "MappaSS") if da_fare else None
        if da_fare and mappa_righe is not None:
            mappa = {}
            for m in mappa_righe:
                k = m.get("Cliente")
                if k is not None and str(k).casefold() not in mappa:          # XLOOKUP: prima corrispondenza, maiuscole indifferenti
                    mappa[str(k).casefold()] = m.get("Prefisso SS")
            pref = lambda v: "" if v in (None, "") else str(mappa.get(str(v).casefold()) or "")
            fare, conta, ss = set(da_fare), {}, {}
            for r in range(2, ws_val.max_row + 1):
                cli, ins = ws_val.cell(r, c_cli).value, ws_val.cell(r, c_ins).value
                p, anno = pref(cli), _anno(ins)
                if r in fare:
                    if cli in (None, "") or ins in (None, ""):
                        ss[r] = None
                    elif not p:
                        ss[r] = "DA CENSIRE"
                    else:
                        ss[r] = p + str(1 if r == 2 else conta.get((anno, p), 0) + 1)
                if p and anno:
                    conta[(anno, p)] = conta.get((anno, p), 0) + 1
            out["SS"] = ss
    if "Commessa" in cols and cols.get("Vertical") and c_ins:
        c = cols["Commessa"]
        com = {}
        # CERCA.VERT(Settore&Anno; Tabella1; 3; FALSO): vince la PRIMA riga di Domini con quel settore e quell'anno
        codici = {}
        for x in _tabella(wb_val, "Tabella1") or []:
            if x.get("Settore") and x.get("Codice") and x.get("Anno"):
                codici.setdefault(f"{str(x['Settore']).strip().casefold()}|{int(x['Anno'])}", str(x["Codice"]).strip())
        codici = codici or (domini.get("commesse") or {})
        rif = re.compile(r"CONCAT\(\$?([A-Z]{1,3})\$?\d+\s*,\s*YEAR\(\$?([A-Z]{1,3})\$?\d+\)", re.I)
        for r in range(2, ws_val.max_row + 1):
            f = ws_form.cell(r, c).value
            if ws_val.cell(r, c).value is None and _is_formula(f):
                m = rif.search(_formula_text(f))                     # le colonne che usa davvero la formula di questa riga
                c_v = column_index_from_string(m.group(1)) if m else cols["Vertical"]
                c_a = column_index_from_string(m.group(2)) if m else c_ins
                vert, anno = ws_val.cell(r, c_v).value, _anno(ws_val.cell(r, c_a).value)
                com[r] = codici.get(f"{str(vert or '').strip().casefold()}|{anno}") if anno else None
        if com:
            out["Commessa"] = com
    return out


def read_excel(path):
    """Legge TUTTE le colonne del foglio principale (+ le liste di Domini), su una copia temporanea del file.
    Ritorna {'headers': [...], 'rows': [{'xl': n_riga, 'cells': {colonna: valore}}], 'domini': {...}}."""
    tmp = tempfile.mkdtemp(prefix="gare_")
    try:
        copy = os.path.join(tmp, "copia.xlsx")
        try:
            shutil.copyfile(path, copy)
        except OSError as e:
            if os.name != "nt":
                raise
            try:
                from .snapshot import snapshot_via_excel
                snapshot_via_excel(path, copy)
            except Exception as e2:
                raise PermissionError(
                    f"Non riesco a leggere il file ({e}). Provato anche tramite Excel: {e2}. "
                    "Controlla che il file sia scaricato da OneDrive ('Mantieni sempre su questo dispositivo') e non bloccato.") from e2
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            wb = openpyxl.load_workbook(copy, data_only=True)
        if SHEET_MAIN not in wb.sheetnames:
            raise ValueError(f"Nel file manca il foglio '{SHEET_MAIN}'")
        ws = wb[SHEET_MAIN]
        headers, cols = [], {}
        for c in ws[1]:
            h = clean_text(c.value)
            if not h:
                continue
            base, n = h, 2
            while h in cols:                       # intestazioni duplicate: " (2)", " (3)"…
                h = f"{base} ({n})"
                n += 1
            cols[h] = c.column
            headers.append(h)
        missing = [f for f in ("Cliente", "Stato", "Data ins.") if f not in cols]
        if missing:
            raise ValueError(f"Nel foglio '{SHEET_MAIN}' mancano le colonne: {', '.join(missing)}")
        domini = _read_domini(wb[SHEET_DOMINI] if SHEET_DOMINI in wb.sheetnames else None)
        # celle con formule salvate senza valore (file scritto senza Excel): ricalcolo SS e Commessa come le formule del file
        ricalcolati = {}
        if any(ws.cell(r, cols[h]).value is None for h in ("SS", "Commessa") if h in cols for r in range(2, min(ws.max_row, 60) + 1)):
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                wf = openpyxl.load_workbook(copy, data_only=False)
            ricalcolati = ricalcola_formule(ws, wf[SHEET_MAIN], wb, cols, domini)
        rows = []
        for r in range(2, ws.max_row + 1):
            cells = {h: _cell_value(ws.cell(r, cols[h]).value) for h in headers}
            for h, valori in ricalcolati.items():
                if r in valori:
                    cells[h] = valori[r]
            if not (clean_text(cells.get("Cliente")) or clean_text(cells.get("Oggetto"))):
                continue
            rows.append({"xl": r, "cells": cells, "att": fill_level(ws.cell(r, cols["Cliente"]))})
        n = {h: sum(1 for v in valori.values() if v not in (None, "")) for h, valori in ricalcolati.items()}
        return {"headers": headers, "rows": rows, "domini": domini, "ricalcolati": {h: k for h, k in n.items() if k}}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def build_row(rid, xl, cells, orig=None, state="orig", att=0, optional=None):
    """Riga per l'app a partire dai valori del database.
    cells = valori attuali; orig = valori importati dall'Excel (None per le righe nuove)."""
    row = {"_row": rid, "_xl": xl, "_state": state, "Attenzione": att or 0}
    seq = cells.get("Seq")
    row["Seq"] = seq if isinstance(seq, (int, float)) and not isinstance(seq, bool) else (xl - 1 if xl else None)
    invalid, textdates = [], []
    for f in FIELDS:
        v = cells.get(f)
        if f in DATE_FIELDS:
            iso = to_iso(v)
            row[f] = iso
            if v not in (None, "") and iso is None:
                invalid.append(f)
            if isinstance(v, str) and iso and not ISO_RE.match(v.strip()):
                textdates.append(f)
        else:
            row[f] = clean_text(v)
    for f in NUM_FIELDS:
        if f in cells:
            row[f] = to_number(cells.get(f))
    opt = {}
    for k, h in (optional or {}).items():
        v = cells.get(h)
        opt[k] = to_number(v) if k in NUMERIC_OPT else (clean_text(v) if k != "gara_padre" else (to_number(v) and int(to_number(v)) or clean_text(v)))
    if opt:
        row["_opt"] = opt
    row["_invalid_dates"] = invalid
    if textdates:
        row["_textdates"] = textdates
    base = orig if orig is not None else cells
    row["_raw"] = {k: (str(base[k]) if base.get(k) is not None else None) for k in ("Stato", "Market") if k in base}
    row["_sig"] = row_sig(cells.get("Cliente"), cells.get("Oggetto"), cells.get("Data ins."))
    return row


def _read_domini(ws):
    d = {"vertical": [], "market": [], "tipo": [], "stato": [], "commesse": {}}
    if ws is None:
        return d
    d["vertical"] = _column_list(ws, "Vertical")
    d["market"] = _column_list(ws, "Market")
    d["tipo"] = _column_list(ws, "tipo")
    seen = []
    for s in _column_list(ws, "Stato"):
        if s not in seen:
            seen.append(s)
    d["stato"] = seen
    # tabella Settore/Codice/Anno -> commessa
    cols = {}
    for c in ws[1]:
        h = clean_text(c.value)
        if h in ("Settore", "Codice", "Anno"):
            cols[h] = c.column
    if len(cols) == 3:
        r = 2
        while ws.cell(r, cols["Settore"]).value not in (None, ""):
            sett, cod, anno = (ws.cell(r, cols[k]).value for k in ("Settore", "Codice", "Anno"))
            if isinstance(sett, str) and cod and anno:
                d["commesse"][f"{sett.strip().casefold()}|{int(anno)}"] = str(cod).strip()
            r += 1
    return d
