"""Scheda cliente, tempi medi di consegna, varianti dei nomi cliente e cartelle dei clienti."""
import difflib
import os
import re
import statistics
import unicodedata
from collections import Counter, defaultdict

from .logic import _split_ss, _tipo_group, add_months, client_key, split_solutions, TIPI_MAIN
from .normalize import NOIND, norm_stato
from .reader import clean_text, to_date

# per i tempi di consegna contano solo le offerte già consegnate: una WIP ha solo una scadenza prevista, una NoBID non è stata consegnata
ESCLUSI_TEMPI = {"WIP", "NoBID"}
FORME_SOCIETARIE = {"spa", "srl", "sas", "snc", "scarl", "scpa", "srls", "sapa", "ss"}


def _stato(r):
    return norm_stato(r["Stato"]) or r["Stato"]


def giorni_consegna(r):
    """Giorni tra Data ins. e Data consegna per le offerte consegnate; None se non calcolabile."""
    if _stato(r) in ESCLUSI_TEMPI:
        return None
    i, c = to_date(r["Data ins."]), to_date(r["Data consegna"])
    if not i or not c or c < i:
        return None
    return (c - i).days


def _tempi(giorni):
    if not giorni:
        return {"n": 0, "media": None, "mediana": None}
    return {"n": len(giorni), "media": round(sum(giorni) / len(giorni), 1), "mediana": round(statistics.median(giorni), 1)}


def _esiti(rows):
    c = Counter(_stato(r) for r in rows)
    w, l = c["Won"], c["Lost"]
    return {"totale": len(rows), "won": w, "lost": l, "wip": c["WIP"], "waiting": c["Waiting For response"],
            "altri": len(rows) - w - l - c["WIP"] - c["Waiting For response"], "chiuse": w + l, "rate": (w / (w + l)) if w + l else None}


def _piu_frequente(valori):
    c = Counter(v for v in valori if v)
    return c.most_common(1)[0][0] if c else None


# ---------------------------------------------------------------- scheda cliente

def scheda(rows, nome):
    key = client_key(nome)
    mie = [r for r in rows if client_key(r["Cliente"]) == key]
    if not key or not mie:
        raise ValueError("Cliente non trovato")
    gen = _esiti(rows)
    n_clienti = len({client_key(r["Cliente"]) for r in rows if client_key(r["Cliente"])})
    g_mie = [g for g in (giorni_consegna(r) for r in mie) if g is not None]
    g_tutte = [g for g in (giorni_consegna(r) for r in rows) if g is not None]
    k = _esiti(mie)
    k.update({"tempi": _tempi(g_mie)})
    datate = [r for r in mie if to_date(r["Data ins."])]
    datate.sort(key=lambda r: to_date(r["Data ins."]))
    ultima = datate[-1] if datate else None
    anni = defaultdict(list)
    for r in mie:
        d = to_date(r["Data ins."])
        anni[d.year if d else None].append(r)
    cron = sorted(mie, key=lambda r: (to_date(r["Data ins."]) or to_date("1900-01-01")), reverse=True)
    return {
        "nome": _piu_frequente([r["Cliente"] for r in mie]),
        "vertical": _piu_frequente([r["Vertical"] for r in mie]),
        "market": _piu_frequente([r["Market"] for r in mie if r["Market"] != NOIND]),
        "ss": sorted({p[0] for p in (_split_ss(r["SS"]) for r in mie) if p}),
        "kpi": k,
        "media": {"rate": gen["rate"], "chiuse": gen["chiuse"], "tempi": _tempi(g_tutte),
                  "offerte_per_cliente": round(gen["totale"] / n_clienti, 1) if n_clienti else None},
        "ultima": {"data": ultima["Data ins."], "stato": _stato(ultima), "oggetto": ultima["Oggetto"]} if ultima else None,
        "prima": datate[0]["Data ins."] if datate else None,
        "anni": [{"anno": a, **{x: v for x, v in _esiti(rs).items() if x in ("totale", "won", "lost", "wip", "waiting", "altri")}}
                 for a, rs in sorted(anni.items(), key=lambda t: (t[0] is None, t[0] or 0))],
        "cronologia": [{"_row": r["_row"], "Seq": r["Seq"], "SS": r["SS"], "Oggetto": r["Oggetto"], "tipo": r["tipo"], "Stato": _stato(r),
                        "Solution D&A": r["Solution D&A"], "Data ins.": r["Data ins."], "Data consegna": r["Data consegna"],
                        "giorni": giorni_consegna(r), "Attenzione": r.get("Attenzione") or 0, "_state": r.get("_state")} for r in cron],
    }


# ---------------------------------------------------------------- tempi medi

def tempi(rows, today, mesi=None):
    """Tempi medi Data ins. -> Data consegna, per tipo, per Solution e per Vertical. mesi: solo offerte aperte negli ultimi N mesi."""
    cutoff = add_months(today, -(mesi - 1)) if mesi else None
    gruppi = {"tipo": defaultdict(list), "solution": defaultdict(list), "vertical": defaultdict(list)}
    tutti = []
    for r in rows:
        g = giorni_consegna(r)
        d = to_date(r["Data ins."])
        if g is None or (cutoff and d < cutoff):
            continue
        tutti.append(g)
        gruppi["tipo"][_tipo_group(r["tipo"])].append(g)
        for s in split_solutions(r["Solution D&A"]) or ["(non assegnata)"]:
            gruppi["solution"][s.title() if s.islower() else s].append(g)
        gruppi["vertical"][clean_text(r["Vertical"]) or NOIND].append(g)

    def lista(d, ordine=None):
        out = [{"nome": n, **_tempi(v)} for n, v in d.items()]
        if ordine:
            out.sort(key=lambda x: ordine.index(x["nome"]) if x["nome"] in ordine else len(ordine))
        else:
            out.sort(key=lambda x: (-x["n"], x["nome"].casefold()))
        return out
    return {"totale": _tempi(tutti), "tipo": lista(gruppi["tipo"], TIPI_MAIN + ["Altro"]), "solution": lista(gruppi["solution"]),
            "vertical": lista(gruppi["vertical"]), "mesi": mesi}


# ---------------------------------------------------------------- varianti dei nomi cliente

def _norm_nome(nome):
    s = unicodedata.normalize("NFKD", clean_text(nome) or "").encode("ascii", "ignore").decode().casefold()
    s = re.sub(r"\b([a-z])\.(?=[a-z]\.|\s|$)", r"\1", s)                       # "s.p.a." -> "spa"
    s = re.sub(r"[^a-z0-9 ]", " ", s.replace(".", ""))
    toks = [t for t in s.split() if t not in FORME_SOCIETARIE]
    return " ".join(toks)


def varianti_clienti(rows):
    """Gruppi di nomi cliente che probabilmente sono lo stesso cliente (maiuscole, punteggiatura, società, refusi)."""
    nomi = Counter()
    for r in rows:
        if clean_text(r["Cliente"]):
            nomi[clean_text(r["Cliente"])] += 1
    elenco = list(nomi)
    norm = {n: _norm_nome(n) for n in elenco}
    padre = {n: n for n in elenco}

    def trova(x):
        while padre[x] != x:
            padre[x] = padre[padre[x]]
            x = padre[x]
        return x
    for i, a in enumerate(elenco):
        for b in elenco[i + 1:]:
            na, nb = norm[a], norm[b]
            if not na or not nb:
                continue
            if na == nb or (min(len(na), len(nb)) >= 5 and difflib.SequenceMatcher(None, na, nb).ratio() >= 0.9):
                padre[trova(a)] = trova(b)
    gruppi = defaultdict(list)
    for n in elenco:
        gruppi[trova(n)].append(n)
    out = []
    for g in gruppi.values():
        if len(g) < 2:
            continue
        g.sort(key=lambda n: (-nomi[n], n.isupper(), n))
        out.append({"suggerito": g[0], "nomi": [{"nome": n, "righe": nomi[n]} for n in g]})
    out.sort(key=lambda x: (-sum(n["righe"] for n in x["nomi"]), x["suggerito"].casefold()))
    return out


# ---------------------------------------------------------------- cartelle dei clienti

def _chiave_cartella(s):
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().casefold())


def _cartelle(base):
    try:
        return sorted(d for d in os.listdir(base) if os.path.isdir(os.path.join(base, d)))
    except OSError:
        return []


def trova_cartella(base, cliente, mappa=None):
    """{'stato': 'ok'|'scegli'|'nessuna', 'nome': cartella, 'candidati': [...]}. 'ok' = nome uguale o scelta già salvata."""
    if not base or not os.path.isdir(base):
        return {"stato": "nessuna", "nome": None, "candidati": []}
    cartelle = _cartelle(base)
    salvata = (mappa or {}).get(client_key(cliente))
    if salvata in cartelle:
        return {"stato": "ok", "nome": salvata, "candidati": []}
    k = _chiave_cartella(cliente)
    if not k:
        return {"stato": "nessuna", "nome": None, "candidati": []}
    esatta = [c for c in cartelle if _chiave_cartella(c) == k]
    if esatta:
        return {"stato": "ok", "nome": esatta[0], "candidati": []}
    cand = [c for c in cartelle if k in _chiave_cartella(c) or (len(_chiave_cartella(c)) >= 3 and _chiave_cartella(c) in k)]
    return {"stato": "scegli" if cand else "nessuna", "nome": None, "candidati": cand[:12]}
