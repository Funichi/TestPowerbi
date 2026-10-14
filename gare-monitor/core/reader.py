"""Lettura dell'Excel (sola lettura, su una copia temporanea: il file originale non viene mai bloccato)."""
import datetime as dt
import os
import re
import shutil
import tempfile
import warnings

import openpyxl

SHEET_MAIN = "gare e offerte"
SHEET_DOMINI = "Domini"

DATE_FIELDS = ["Data ins.", "Data Opt review", "Data consegna"]
# Campi che l'app mostra/modifica. Le colonne economiche e "Valore" restano intatte nel file.
FIELDS = [
    "Vertical", "Market", "Cliente", "Commessa", "SS", "Oggetto", "Legal Entity", "tipo",
    "Data ins.", "Data Opt review", "Data consegna", "Solution D&A", "Stato", "Salesman",
    "Referenti vertical", "Tecnologie di riferimento D&A", "Note",
]


def to_date(v):
    """datetime/date/stringa gg/mm/aaaa o aaaa-mm-gg -> date, altrimenti None."""
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    if isinstance(v, str):
        s = v.strip()
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


def read_workbook(path):
    """Ritorna {'rows': [...], 'domini': {...}}."""
    tmp = tempfile.mkdtemp(prefix="gare_")
    try:
        copy = os.path.join(tmp, "copia.xlsx")
        shutil.copyfile(path, copy)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            wb = openpyxl.load_workbook(copy, data_only=True)
        return {"rows": _read_rows(wb[SHEET_MAIN]), "domini": _read_domini(wb[SHEET_DOMINI] if SHEET_DOMINI in wb.sheetnames else None)}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _read_rows(ws):
    header = {}
    for c in ws[1]:
        h = clean_text(c.value)
        if h:
            header[h] = c.column
    missing = [f for f in ("Cliente", "Stato", "Data ins.") if f not in header]
    if missing:
        raise ValueError(f"Nel foglio '{SHEET_MAIN}' mancano le colonne: {', '.join(missing)}")
    rows = []
    for r in range(2, ws.max_row + 1):
        raw = {f: ws.cell(r, header[f]).value for f in FIELDS if f in header}
        if not (clean_text(raw.get("Cliente")) or clean_text(raw.get("Oggetto"))):
            continue
        seq = ws.cell(r, header["Seq"]).value if "Seq" in header else None
        row = {"_row": r, "Seq": seq if isinstance(seq, (int, float)) else r - 1}
        invalid = []
        for f in FIELDS:
            v = raw.get(f)
            if f in DATE_FIELDS:
                iso = to_iso(v)
                row[f] = iso
                if v not in (None, "") and iso is None:
                    invalid.append(f)
                if isinstance(v, str) and iso:
                    row.setdefault("_textdates", []).append(f)
            else:
                row[f] = clean_text(v)
        row["_invalid_dates"] = invalid
        row["_sig"] = row_sig(raw.get("Cliente"), raw.get("Oggetto"), raw.get("Data ins."))
        rows.append(row)
    return rows


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
