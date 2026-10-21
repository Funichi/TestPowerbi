"""Scheda cliente, tempi medi di consegna, varianti dei nomi cliente e cartelle dei clienti."""
import datetime as dt
import difflib
import os
import re
import statistics
import unicodedata
from collections import Counter, defaultdict

from . import metrics
from .logic import _tipo_group, add_months, client_key, split_solutions, TIPI_MAIN
from .normalize import NOIND, norm_stato
from .reader import clean_text, to_date

# per la pagina "Tempi di consegna" contano solo le offerte già consegnate: una WIP ha solo una scadenza prevista, una NoBID non è stata consegnata
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


def preavviso(r):
    """Giorni tra Data ins. e Data consegna: il tempo concesso dal cliente per rispondere. None se manca una data o è incoerente."""
    i, c = to_date(r["Data ins."]), to_date(r["Data consegna"])
    return (c - i).days if i and c and c >= i else None


def _preavviso(rows):
    return _tempi([g for g in map(preavviso, rows) if g is not None])


def _kpi(rows):
    """Metriche (definite in metrics.py) + preavviso per un insieme di offerte."""
    k = metrics.summary(rows)
    k["wip"] = metrics.count(rows)["WIP"]
    k["waiting"] = metrics.count(rows)["Waiting For response"]
    k["preavviso"] = _preavviso(rows)
    return k


def _piu_frequente(valori):
    c = Counter(v for v in valori if v)
    return c.most_common(1)[0][0] if c else None


# ---------------------------------------------------------------- scheda cliente

def _anno(r):
    d = to_date(r["Data ins."])
    return d.year if d else None


def _opzionali(rows):
    return sorted({k for r in rows for k, v in (r.get("_opt") or {}).items() if v not in (None, "")})


def scheda(rows, nome, anno=None, oggi=None):
    """Scheda di un cliente. anno: i numeri del periodo (e i benchmark) riguardano solo le offerte aperte in quell'anno;
    'Da presidiare' e il riepilogo per anno guardano sempre tutte le offerte del cliente."""
    oggi = oggi or dt.date.today()
    key = client_key(nome)
    tutte_mie = [r for r in rows if client_key(r["Cliente"]) == key]
    if not key or not tutte_mie:
        raise ValueError("Cliente non trovato")
    opzionali = _opzionali(rows)
    anni_disponibili = sorted({a for a in map(_anno, tutte_mie) if a})
    per_anno = defaultdict(list)
    for r in tutte_mie:
        per_anno[_anno(r)].append(r)
    riepilogo = [{"anno": a, **_kpi(rs)} for a, rs in sorted(per_anno.items(), key=lambda t: (t[0] is None, -(t[0] or 0)))]
    universo = [r for r in rows if _anno(r) == anno] if anno else rows
    mie = [r for r in universo if client_key(r["Cliente"]) == key]
    mkt = _piu_frequente([r["Market"] for r in tutte_mie if r["Market"] != NOIND])
    n_clienti = len({client_key(r["Cliente"]) for r in universo if client_key(r["Cliente"])})
    del_mkt = [r for r in universo if mkt and r["Market"] == mkt]
    datate = sorted((r for r in tutte_mie if to_date(r["Data ins."])), key=lambda r: to_date(r["Data ins."]))
    ultima = datate[-1] if datate else None

    def bench(rs):
        k = _kpi(rs)
        return {k_: k[k_] for k_ in ("win", "bid", "nobid_rate", "preavviso", "totale")}

    presidiare = []
    for r in tutte_mie:
        st = metrics.stato_of(r)
        if st not in metrics.APERTE:
            continue
        c = to_date(r["Data consegna"])
        gg = (c - oggi).days if c else None
        presidiare.append({"_row": r["_row"], "Oggetto": r["Oggetto"], "tipo": r["tipo"], "Stato": st, "referente": r["Solution D&A"],
                           "Data consegna": r["Data consegna"], "giorni": gg,
                           "urgente": bool(st == "WIP" and gg is not None and gg <= 3), "non_assegnata": bool(st == "WIP" and metrics.non_assegnata(r))})
    presidiare.sort(key=lambda x: (x["giorni"] is None, x["giorni"] if x["giorni"] is not None else 0))

    team = defaultdict(list)
    for r in mie:
        for ref in metrics.referenti(r["Solution D&A"]) or [None]:
            team[ref].append(r)
    team_out = []
    for ref, rs in team.items():
        c = metrics.count(rs)
        team_out.append({"nome": ref, "totale": len(rs), "aperte": c["WIP"] + c["Waiting For response"], "wip": c["WIP"], "won": c["Won"],
                         "lost": c["Lost"], "nobid": c["NoBID"], "non_assegnato": ref is None})
    team_out.sort(key=lambda t: (t["non_assegnato"], -t["totale"], (t["nome"] or "").casefold()))

    cron = sorted(mie, key=lambda r: (to_date(r["Data ins."]) or to_date("1900-01-01")), reverse=True)
    return {
        "nome": _piu_frequente([r["Cliente"] for r in tutte_mie]),
        "anno": anno, "anni_disponibili": anni_disponibili, "riepilogo": riepilogo, "opzionali": opzionali,
        "vertical": _piu_frequente([r["Vertical"] for r in tutte_mie]), "market": mkt,
        "kpi": _kpi(mie), "alltime": _kpi(tutte_mie),
        "mercato": {"nome": mkt, "n_clienti": len({client_key(r["Cliente"]) for r in del_mkt}), **bench(del_mkt)} if mkt else None,
        "generale": {**bench(universo), "offerte_per_cliente": round(len(universo) / n_clienti, 1) if n_clienti else None},
        "aperte": sum(1 for r in tutte_mie if metrics.stato_of(r) in metrics.APERTE),
        "ultima": {"data": ultima["Data ins."], "stato": metrics.stato_of(ultima), "oggetto": ultima["Oggetto"],
                   "giorni_fa": (oggi - to_date(ultima["Data ins."])).days} if ultima else None,
        "prima": datate[0]["Data ins."] if datate else None,
        "presidiare": presidiare, "team": team_out, "valore": metrics.valore_stats(mie) if "valore" in opzionali or "valore_offerto" in opzionali else None,
        "cronologia": [{"_row": r["_row"], "Seq": r["Seq"], "Oggetto": r["Oggetto"], "tipo": r["tipo"], "Stato": metrics.stato_of(r),
                        "referente": r["Solution D&A"], "non_assegnata": metrics.non_assegnata(r), "Data ins.": r["Data ins."],
                        "Data consegna": r["Data consegna"], "preavviso": preavviso(r), "Attenzione": r.get("Attenzione") or 0,
                        "_state": r.get("_state"), "opt": r.get("_opt") or {}} for r in cron],
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
