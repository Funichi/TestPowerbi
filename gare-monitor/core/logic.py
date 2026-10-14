"""Regole di business: normalizzazione, codici SS/commessa, cruscotto e punti di attenzione."""
import datetime as dt
import re
from collections import Counter, defaultdict

from .reader import DATE_FIELDS, clean_text, to_date

STATI = ["WIP", "Waiting For response", "Sospeso", "Won", "Lost", "NoBID"]
STATO_MAP = {
    "wip": "WIP", "won": "Won", "win": "Won", "lost": "Lost",
    "nobid": "NoBID", "no bid": "NoBID", "no-bid": "NoBID",
    "sospeso": "Sospeso", "closed": "Sospeso",
    "waiting for response": "Waiting For response", "waiting": "Waiting For response",
}
GIORNI_SOLLECITO = 30      # Waiting For response da più di N giorni dalla Data ins.
GIORNI_RICLASSIFICA = 90   # oltre: probabilmente da portare a Sospeso
GIORNI_SCADENZA = 7        # consegne imminenti


def norm_stato(v):
    s = clean_text(v)
    if not s:
        return None
    return STATO_MAP.get(s.casefold())


def add_months(d, n):
    m = d.year * 12 + d.month - 1 + n
    return dt.date(m // 12, m % 12 + 1, 1)


def split_solutions(v):
    s = clean_text(v)
    if not s:
        return []
    return [p.strip() for p in re.split(r"\s*[/,+&;]\s*", s) if p.strip()]


def client_key(name):
    return (clean_text(name) or "").casefold()


# ---------------------------------------------------------------- codici

def _split_ss(ss):
    """'ATO12' -> ('ATO', 12); '2RG0' -> ('2RG', 0); codici senza numero finale -> None."""
    s = clean_text(ss)
    if not s:
        return None
    m = re.match(r"^([A-Za-z0-9]*?[A-Za-z])(\d+)$", s)
    return (m.group(1).upper(), int(m.group(2))) if m else None


def suggest_ss(rows, cliente):
    """Prefisso (3 lettere del cliente) + progressivo. Ritorna {'ss','prefisso','numero','avviso'}."""
    key = client_key(cliente)
    if not key:
        return {"ss": None, "prefisso": None, "numero": None, "avviso": None}
    prefixes = Counter()
    for r in rows:
        if client_key(r["Cliente"]) == key:
            p = _split_ss(r["SS"])
            if p:
                prefixes[p[0]] += 1
    avviso = None
    if prefixes:
        prefix = prefixes.most_common(1)[0][0]
    else:
        letters = re.sub(r"[^A-Za-z0-9]", "", clean_text(cliente))
        prefix = (letters[:3] or "XXX").upper()
        altri = {r["Cliente"] for r in rows if (_split_ss(r["SS"]) or ("",))[0] == prefix and client_key(r["Cliente"]) != key}
        if altri:
            avviso = f"Il prefisso {prefix} è già usato da: {', '.join(sorted(altri)[:3])}. Controlla o cambialo."
    mx = max((p[1] for p in (_split_ss(r["SS"]) for r in rows) if p and p[0] == prefix), default=0)
    return {"ss": f"{prefix}{mx + 1}", "prefisso": prefix, "numero": mx + 1, "avviso": avviso}


def suggest_commessa(domini, vertical, data_consegna, data_ins):
    """Come la formula dell'Excel: Vertical + anno (della Data consegna; se manca, della Data ins.)."""
    d = to_date(data_consegna) or to_date(data_ins)
    if not d or not vertical:
        return None
    return domini.get("commesse", {}).get(f"{vertical.strip().casefold()}|{d.year}")


# ---------------------------------------------------------------- pulizia

def clean_preview(rows, domini):
    out = []
    liste = {"Vertical": domini.get("vertical", []), "Market": domini.get("market", []), "tipo": domini.get("tipo", [])}

    def add(r, kind, field, old, new, default=True):
        out.append({"row": r["_row"], "sig": r["_sig"], "kind": kind, "field": field, "old": old, "new": new,
                    "cliente": r["Cliente"], "oggetto": (r["Oggetto"] or "")[:80], "default": default})

    spellings = defaultdict(Counter)
    for r in rows:
        spellings[client_key(r["Cliente"])][r["Cliente"]] += 1
    canon = {k: c.most_common(1)[0][0] for k, c in spellings.items() if len(c) > 1}

    for r in rows:
        st = r["Stato"]
        n = norm_stato(st)
        if st and n and n != st:
            add(r, "Stato uniformato", "Stato", st, n)
        for f, lista in liste.items():
            v = r[f]
            if v and v not in lista:
                match = next((x for x in lista if x.casefold() == v.casefold()), None)
                if match:
                    add(r, "Maiuscole/elenco", f, v, match)
        for f in r.get("_textdates", []):
            add(r, "Data scritta come testo", f, "(testo)", r[f])
        k = client_key(r["Cliente"])
        if k in canon and r["Cliente"] != canon[k]:
            add(r, "Cliente scritto in modi diversi", "Cliente", r["Cliente"], canon[k], default=False)
    return out


# ---------------------------------------------------------------- cruscotto

def _brief(r, **extra):
    d = {k: r[k] for k in ("_row", "Seq", "Cliente", "Oggetto", "Stato", "Solution D&A", "Data ins.", "Data consegna", "Vertical")}
    d.update(extra)
    return d


def dashboard(rows, domini, today, months):
    """months: int (ultimi N mesi) o None (tutto)."""
    cutoff = add_months(today, -(months - 1)) if months else None

    def ins(r):
        return to_date(r["Data ins."])

    def cons(r):
        return to_date(r["Data consegna"])

    def in_period(r):
        d = ins(r)
        return cutoff is None or d is None or d >= cutoff

    stato = {r["_row"]: (norm_stato(r["Stato"]) or r["Stato"]) for r in rows}
    scope = [r for r in rows if in_period(r) or stato[r["_row"]] == "WIP"]

    # Pipeline per solution: WIP sempre (tutte); le altre colonne nel periodo
    pipe = defaultdict(Counter)
    spell = defaultdict(Counter)
    for r in scope:
        s = stato[r["_row"]]
        for nme in split_solutions(r["Solution D&A"]) or ["(non assegnata)"]:
            k = nme.casefold()
            spell[k][nme] += 1
            pipe[k][s] += 1
    pipeline = []
    for k, c in pipe.items():
        pipeline.append({"solution": spell[k].most_common(1)[0][0], **{s: c.get(s, 0) for s in STATI}, "totale": sum(c.values())})
    pipeline.sort(key=lambda x: (-x["WIP"], -x["Waiting For response"], x["solution"].casefold()))

    # Scadenze: WIP con consegna scaduta o entro 7 giorni
    scadenze = []
    for r in rows:
        c = cons(r)
        if stato[r["_row"]] == "WIP" and c is not None and (c - today).days <= GIORNI_SCADENZA:
            scadenze.append(_brief(r, giorni=(c - today).days))
    scadenze.sort(key=lambda x: x["giorni"])

    # Waiting da sollecitare (età dalla Data ins.)
    solleciti, riclass = [], []
    riclass_totale = 0
    for r in rows:
        d = ins(r)
        if stato[r["_row"]] != "Waiting For response" or d is None:
            continue
        g = (today - d).days
        if GIORNI_SOLLECITO <= g <= GIORNI_RICLASSIFICA:
            solleciti.append(_brief(r, giorni=g))
        elif g > GIORNI_RICLASSIFICA:
            riclass_totale += 1
            if in_period(r):
                riclass.append(_brief(r, giorni=g))
    solleciti.sort(key=lambda x: -x["giorni"])
    riclass.sort(key=lambda x: -x["giorni"])

    # Punti di attenzione
    ss_count = Counter()
    for r in rows:
        s = clean_text(r["SS"])
        if s and _split_ss(s):
            ss_count[s.upper()] += 1
    att = defaultdict(list)
    for r in scope:
        s = stato[r["_row"]]
        i, c = ins(r), cons(r)
        if i is None and "Data ins." not in r["_invalid_dates"]:
            att["Senza Data ins."].append(_brief(r))
        if s == "WIP" and c is None and "Data consegna" not in r["_invalid_dates"]:
            att["In corso (WIP) senza Data consegna"].append(_brief(r))
        for f in r["_invalid_dates"]:
            att["Data non riconosciuta (testo)"].append(_brief(r, dettaglio=f))
        if i and c and c < i:
            att["Data consegna precedente alla Data ins."].append(_brief(r))
        if i and (i - today).days > 7:
            att["Data ins. nel futuro"].append(_brief(r))
        if r["Stato"] and r["Stato"] not in STATI:
            att["Stato da uniformare (Pulizia dati)"].append(_brief(r, dettaglio=r["Stato"]))
        if not r["Stato"]:
            att["Senza Stato"].append(_brief(r))
        if s in ("WIP", "Waiting For response") and not clean_text(r["Solution D&A"]):
            att["WIP/Waiting senza Solution D&A"].append(_brief(r))
        mancanti = [f for f in ("Vertical", "Market", "tipo", "Oggetto") if not r[f]]
        if mancanti:
            att["Campi base mancanti (Vertical/Market/tipo/Oggetto)"].append(_brief(r, dettaglio=", ".join(mancanti)))
        ssv = clean_text(r["SS"])
        if ssv and ss_count.get(ssv.upper(), 0) > 1:
            att["Codice SS duplicato"].append(_brief(r, dettaglio=ssv))
    attenzioni = sorted(({"titolo": t, "righe": v} for t, v in att.items()), key=lambda a: -len(a["righe"]))

    # Trend mensile
    dates = [d for r in rows for d in (ins(r), cons(r)) if d]
    start = add_months(today, -(months - 1)) if months else (min(dates).replace(day=1) if dates else today.replace(day=1))
    mesi = []
    m = start
    while m <= today.replace(day=1):
        mesi.append(m)
        m = add_months(m, 1)
    idx = {(m.year, m.month): i for i, m in enumerate(mesi)}
    inserite = [dict.fromkeys(STATI + ["Altro"], 0) for _ in mesi]
    consegnate = [0] * len(mesi)
    for r in rows:
        i, c = ins(r), cons(r)
        if i and (i.year, i.month) in idx:
            s = stato[r["_row"]]
            inserite[idx[(i.year, i.month)]][s if s in STATI else "Altro"] += 1
        if c and (c.year, c.month) in idx:
            consegnate[idx[(c.year, c.month)]] += 1
    trend = {"mesi": [m.strftime("%Y-%m") for m in mesi], "inserite": inserite, "consegnate": consegnate}

    return {
        "oggi": today.isoformat(),
        "tiles": {
            "wip": sum(1 for r in rows if stato[r["_row"]] == "WIP"),
            "waiting": sum(1 for r in scope if stato[r["_row"]] == "Waiting For response"),
            "scadute": sum(1 for x in scadenze if x["giorni"] < 0),
            "imminenti": sum(1 for x in scadenze if x["giorni"] >= 0),
            "solleciti": len(solleciti),
            "attenzioni": sum(len(a["righe"]) for a in attenzioni),
        },
        "stati": {st: sum(1 for r in scope if stato[r["_row"]] == st) for st in STATI},
        "pipeline": pipeline, "scadenze": scadenze, "solleciti": solleciti, "riclassificare": riclass,
        "riclassificare_totale": riclass_totale, "attenzioni": attenzioni, "trend": trend,
        "soglie": {"sollecito": GIORNI_SOLLECITO, "riclassifica": GIORNI_RICLASSIFICA, "scadenza": GIORNI_SCADENZA},
    }
