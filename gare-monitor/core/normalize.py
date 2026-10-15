"""Normalizzazione dei valori in fase di LETTURA (in memoria: il file Excel non viene toccato)."""
import re
from collections import Counter, defaultdict

STATI = ["WIP", "Waiting For response", "Sospeso", "Won", "Lost", "NoBID", "Closed"]
STATO_MAP = {
    "wip": "WIP", "won": "Won", "win": "Won", "lost": "Lost",
    "nobid": "NoBID", "no bid": "NoBID", "no-bid": "NoBID",
    "sospeso": "Sospeso", "closed": "Closed",          # Closed è uno stato a sé (escluso dal win rate)
    "waiting for response": "Waiting For response", "waiting": "Waiting For response",
}
NOIND = "(non indicato)"


def squash(v):
    """trim + spazi multipli/nbsp ridotti a uno."""
    if v is None:
        return None
    s = re.sub(r"\s+", " ", str(v).replace("\xa0", " ")).strip()
    return s or None


def norm_stato(v):
    """Stato canonico, oppure None se il valore non è riconosciuto."""
    s = squash(v)
    return STATO_MAP.get(s.casefold()) if s else None


def normalize_rows(rows, domini):
    """Applica Stato e Market normalizzati a ogni riga (i valori originali restano in row['_raw'])."""
    canon = {m.casefold(): m for m in domini.get("market", [])}
    seen = defaultdict(Counter)           # Market non presenti in Domini: si sceglie la grafia più frequente
    for r in rows:
        m = squash(r["Market"])
        if m and m.casefold() not in canon:
            seen[m.casefold()][m] += 1
    for k, c in seen.items():
        canon[k] = c.most_common(1)[0][0]
    for r in rows:
        n = norm_stato(r["Stato"])
        if n:
            r["Stato"] = n
        m = squash(r["Market"])
        r["Market"] = canon[m.casefold()] if m else NOIND
    return rows


def normalization_summary(rows):
    """Elenco dei valori normalizzati con il numero di righe coinvolte."""
    c = Counter()
    for r in rows:
        raw = r.get("_raw") or {}
        sr, sn = raw.get("Stato"), r["Stato"]
        if isinstance(sr, str) and sr != sn and sn in STATI:
            c[("Stato", sr, sn, True)] += 1
        mr, mn = raw.get("Market"), r["Market"]
        if mr is None or not str(mr).strip():
            c[("Market", "(vuoto)", NOIND, False)] += 1
        elif str(mr) != mn:
            c[("Market", str(mr), mn, True)] += 1
    out = [{"campo": k[0], "da": k[1], "a": k[2], "righe": n, "scrivibile": k[3]} for k, n in c.items()]
    out.sort(key=lambda x: (x["campo"], -x["righe"], x["da"]))
    return out
