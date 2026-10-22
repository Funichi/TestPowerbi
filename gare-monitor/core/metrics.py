"""Metriche dell'app: UNA sola definizione, usata da cruscotto, scheda cliente ed elenco.

  Win rate    = Won / (Won + Lost)
  Bid rate    = offerte non NoBID / tutte le offerte escluse le Sospeso
  NoBID rate  = NoBID / tutte le offerte escluse le Sospeso
Ogni percentuale viaggia con la numerosità (n): {"rate": 0.0-1.0 | None, "n": denominatore, "num": numeratore}.
"""
import re
from collections import Counter

from .normalize import norm_stato

MIN_N = 5                                   # sotto questa numerosità un rapporto è un "campione ridotto"
APERTE = ("WIP", "Waiting For response")
NON_ASSEGNATO = "non assegnato"


def stato_of(r):
    return norm_stato(r["Stato"]) or r["Stato"]


def _ratio(num, den):
    return {"rate": (num / den) if den else None, "n": den, "num": num, "ridotto": den < MIN_N}


def count(rows):
    return Counter(stato_of(r) for r in rows)


def win_rate(rows):
    c = count(rows)
    return _ratio(c["Won"], c["Won"] + c["Lost"])


def _bid_base(rows):
    c = count(rows)
    return c, len(rows) - c["Sospeso"]


def bid_rate(rows):
    c, den = _bid_base(rows)
    return _ratio(den - c["NoBID"], den)


def nobid_rate(rows):
    c, den = _bid_base(rows)
    return _ratio(c["NoBID"], den)


def referenti(valore):
    """Referenti Solution di una riga; lista vuota se non assegnata (cella vuota o 'Non Assegnato')."""
    s = (valore or "").strip()
    if not s or s.casefold() == NON_ASSEGNATO:
        return []
    return [p.strip() for p in re.split(r"\s*[/,+&;]\s*", s) if p.strip() and p.strip().casefold() != NON_ASSEGNATO]


def non_assegnata(r):
    return not referenti(r["Solution D&A"])


def valore_riga(r):
    o = r.get("_opt") or {}
    return o.get("valore_offerto") if o.get("valore_offerto") is not None else o.get("valore")


def ha_valore(rows):
    return any(valore_riga(r) is not None for r in rows)


def valore_stats(rows):
    """Valori economici (solo se nel file c'è almeno una colonna valore): presentato, vinto, win rate sul valore, pipeline."""
    if not ha_valore(rows):
        return None
    tot = {s: 0.0 for s in ("Won", "Lost", "Waiting For response", "WIP")}
    vinto = 0.0
    pesata, ha_pwin = 0.0, False
    for r in rows:
        v, st = valore_riga(r), stato_of(r)
        if v is None:
            continue
        if st in tot:
            tot[st] += v
        if st == "Won":
            agg = (r.get("_opt") or {}).get("valore_agg")
            vinto += agg if agg is not None else v
        if st in APERTE:
            p = (r.get("_opt") or {}).get("pwin")
            if p is not None:
                ha_pwin = True
                pesata += v * p / 100
    chiuso = vinto + tot["Lost"]
    return {"presentato": tot["Won"] + tot["Lost"] + tot["Waiting For response"], "vinto": vinto,
            "win_rate": (vinto / chiuso) if chiuso else None, "pipeline": tot["WIP"] + tot["Waiting For response"],
            "pipeline_pesata": pesata if ha_pwin else None}


def summary(rows):
    """Sintesi per l'elenco filtrato e le schede."""
    c = count(rows)
    return {"totale": len(rows), "aperte": sum(c[s] for s in APERTE), "won": c["Won"], "lost": c["Lost"], "nobid": c["NoBID"], "sospeso": c["Sospeso"],
            "win": win_rate(rows), "bid": bid_rate(rows), "nobid_rate": nobid_rate(rows), "valore": valore_stats(rows)}
