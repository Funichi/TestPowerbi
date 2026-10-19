"""Regole di business: normalizzazione, codici SS/commessa, cruscotto e punti di attenzione."""
import datetime as dt
import re
from collections import Counter, defaultdict

from .normalize import NOIND, STATI, STATO_MAP, norm_stato, normalization_summary  # noqa: F401  (ri-esportati)
from .reader import DATE_FIELDS, clean_text, to_date

GIORNI_SOLLECITO = 30      # Waiting For response da più di N giorni dalla Data ins. (pillola "da sollecitare")
GIORNI_RICLASSIFICA = 90   # oltre: probabilmente da portare a Sospeso
GIORNI_SCADENZA = 7        # consegne imminenti
TIPI_MAIN = ["Gara", "Gara sotto AQ", "Offerta diretta", "Incontro Cliente", "RFI"]
MIN_CHIUSE = 5             # sotto questa soglia il win rate di un tipo non viene mostrato


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


def _anno_ins(r):
    d = to_date(r["Data ins."])
    return d.year if d else None


def suggest_ss(rows, cliente, data_ins=None):
    """Prefisso (3 lettere del cliente) + progressivo. Il progressivo riparte ogni anno (anno della Data ins.):
    lo stesso codice può tornare in anni diversi, mai due volte nello stesso anno.
    Ritorna {'ss','prefisso','numero','anno','avviso'}."""
    key = client_key(cliente)
    if not key:
        return {"ss": None, "prefisso": None, "numero": None, "anno": None, "avviso": None}
    anno = (to_date(data_ins) or dt.date.today()).year
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
    mx = max((p[1] for r in rows for p in [_split_ss(r["SS"])] if p and p[0] == prefix and _anno_ins(r) == anno), default=0)
    return {"ss": f"{prefix}{mx + 1}", "prefisso": prefix, "numero": mx + 1, "anno": anno, "avviso": avviso}


def suggest_commessa(domini, vertical, data_consegna, data_ins):
    """Come la formula dell'Excel: Vertical + anno (della Data consegna; se manca, della Data ins.)."""
    d = to_date(data_consegna) or to_date(data_ins)
    if not d or not vertical:
        return None
    return domini.get("commesse", {}).get(f"{vertical.strip().casefold()}|{d.year}")


# ---------------------------------------------------------------- pulizia

def clean_preview(rows, domini):
    out = []
    liste = {"Vertical": domini.get("vertical", []), "tipo": domini.get("tipo", [])}

    def add(r, kind, field, old, new, default=True):
        out.append({"row": r["_row"], "xl": r.get("_xl"), "kind": kind, "field": field, "old": old, "new": new,
                    "cliente": r["Cliente"], "oggetto": (r["Oggetto"] or "")[:80]})

    for r in rows:
        if r.get("_state") == "new":                    # righe inserite qui: non sono ancora nell'Excel
            continue
        raw = r.get("_raw") or {}
        sr = raw.get("Stato")
        if isinstance(sr, str) and sr != r["Stato"] and r["Stato"] in STATI:
            add(r, "Stato uniformato", "Stato", sr, r["Stato"])
        mr = raw.get("Market")
        if mr and str(mr) != r["Market"] and r["Market"] != NOIND:
            add(r, "Maiuscole/elenco", "Market", str(mr), r["Market"])
        for f, lista in liste.items():
            v = r[f]
            if v and v not in lista:
                match = next((x for x in lista if x.casefold() == v.casefold()), None)
                if match:
                    add(r, "Maiuscole/elenco", f, v, match)
        for f in r.get("_textdates", []):
            add(r, "Data scritta come testo", f, "(testo)", r[f])
    return out


# ---------------------------------------------------------------- cruscotto

def _group_pipeline(rows, stato, key):
    """Offerte per gruppo (Market/Vertical) e stato: WIP, Waiting, Won, Lost; Sospeso/NoBID/altro in 'Altro'."""
    g = defaultdict(Counter)
    for r in rows:
        nome = clean_text(r[key]) or "(non indicato)"
        st = stato[r["_row"]]
        g[nome][st if st in ("WIP", "Waiting For response", "Won", "Lost") else "Altro"] += 1
    out = [{"nome": n, "WIP": c["WIP"], "Waiting For response": c["Waiting For response"], "Won": c["Won"], "Lost": c["Lost"],
            "Altro": c["Altro"], "totale": sum(c.values())} for n, c in g.items()]
    out.sort(key=lambda x: (-x["totale"], x["nome"].casefold()))
    return out


def _brief(r, **extra):
    d = {k: r[k] for k in ("_row", "Seq", "Cliente", "Oggetto", "Stato", "Solution D&A", "Data ins.", "Data consegna", "Vertical")}
    d.update(extra)
    return d


def _prev_year(d):
    try:
        return d.replace(year=d.year - 1)
    except ValueError:                       # 29 febbraio
        return d.replace(year=d.year - 1, day=28)


def _tipo_group(v):
    t = (clean_text(v) or "").casefold()
    return next((m for m in TIPI_MAIN if m.casefold() == t), "Altro")


ETA_FASCE = [("0-30", "0–30 gg"), ("31-90", "31–90 gg"), ("91-180", "91–180 gg"), ("181+", "oltre 180 gg"), ("nd", "data mancante")]


def _fascia_eta(age):
    if age is None:
        return "nd"
    return "0-30" if age <= 30 else "31-90" if age <= 90 else "91-180" if age <= 180 else "181+"


def dashboard(rows, domini, today, months, anno=None):
    """months: int (ultimi N mesi) o None (tutto); anno: un anno solare (ha la precedenza su months). Il periodo vale solo per Pipeline per Market ed Esito per tipo:
    KPI YTD, win rate a 12 mesi e trend usano l'anno solare / gli ultimi 12 mesi."""
    cutoff = add_months(today, -(months - 1)) if months and not anno else None

    def ins(r):
        return to_date(r["Data ins."])

    def cons(r):
        return to_date(r["Data consegna"])

    def in_period(r):
        d = ins(r)
        if anno:                                        # un anno solare: solo le offerte aperte in quell'anno
            return d is not None and d.year == anno
        return cutoff is None or d is None or d >= cutoff

    stato = {r["_row"]: (norm_stato(r["Stato"]) or r["Stato"]) for r in rows}
    # le offerte WIP sono sempre "attuali": restano nel quadro, tranne quando si guarda un anno passato
    scope = [r for r in rows if in_period(r) or (stato[r["_row"]] == "WIP" and (not anno or anno == today.year))]

    # ---- KPI: YTD con confronto allo stesso periodo dell'anno precedente; win rate ultimi 12 mesi
    y0, py0, pend = dt.date(today.year, 1, 1), dt.date(today.year - 1, 1, 1), _prev_year(today)

    def count(a, b, only=None):
        return sum(1 for r in rows if ins(r) and a <= ins(r) <= b and (only is None or stato[r["_row"]] == only))

    start12 = _prev_year(today) + dt.timedelta(days=1)
    w12 = sum(1 for r in rows if ins(r) and start12 <= ins(r) <= today and stato[r["_row"]] == "Won")
    l12 = sum(1 for r in rows if ins(r) and start12 <= ins(r) <= today and stato[r["_row"]] == "Lost")
    kpi = {
        "anno": today.year, "prec": today.year - 1,
        "wip": sum(1 for r in rows if stato[r["_row"]] == "WIP"),
        "waiting": sum(1 for r in rows if stato[r["_row"]] == "Waiting For response"),
        "inserite_ytd": {"cur": count(y0, today), "prev": count(py0, pend)},
        "won_ytd": {"cur": count(y0, today, "Won"), "prev": count(py0, pend, "Won")},
        "winrate12": {"won": w12, "chiuse": w12 + l12, "rate": (w12 / (w12 + l12)) if w12 + l12 else None},
    }

    # ---- Trend anno su anno (12 mesi, anno corrente vs precedente)
    def monthly(year, only=None):
        arr = [0] * 12
        for r in rows:
            d = ins(r)
            if d and d.year == year and (only is None or stato[r["_row"]] == only):
                arr[d.month - 1] += 1
        return arr
    trend = {"anno": today.year, "prec": today.year - 1, "mese": today.month,
             "inserite": {"cur": monthly(today.year), "prev": monthly(today.year - 1)},
             "won": {"cur": monthly(today.year, "Won"), "prev": monthly(today.year - 1, "Won")}}

    # ---- Esito per tipo (segue il periodo)
    g = defaultdict(Counter)
    for r in rows:
        if in_period(r):
            g[_tipo_group(r["tipo"])][stato[r["_row"]]] += 1
    esito = []
    for nome in TIPI_MAIN + ["Altro"]:
        c = g.get(nome)
        if not c:
            continue
        w, l = c["Won"], c["Lost"]
        esito.append({"nome": nome, "Won": w, "Lost": l, "NoBID": c["NoBID"] + c["Sospeso"],          # Sospeso e NoBID insieme come "No Bid"
                      "Waiting For response": c["Waiting For response"], "WIP": c["WIP"], "Closed": c["Closed"],
                      "totale": sum(c.values()), "chiuse": w + l, "rate": (w / (w + l)) if w + l >= MIN_CHIUSE else None})

    # ---- Top 10 clienti per numero di opportunità
    cl = defaultdict(lambda: {"nomi": Counter(), "tot": 0, "won": 0, "rows": []})
    for r in rows:
        k = client_key(r["Cliente"])
        if k and in_period(r):
            g_ = cl[k]
            g_["nomi"][r["Cliente"]] += 1
            g_["tot"] += 1
            g_["won"] += stato[r["_row"]] == "Won"
            g_["rows"].append(r["_row"])
    top_clienti = sorted(({"nome": v["nomi"].most_common(1)[0][0], "totale": v["tot"], "won": v["won"], "rows": v["rows"]} for v in cl.values()),
                         key=lambda x: (-x["totale"], -x["won"], x["nome"].casefold()))[:10]

    # ---- Età delle offerte in attesa (da Data consegna; se manca, da Data ins.)
    fasce = {k: [] for k, _ in ETA_FASCE}
    for r in rows:
        if stato[r["_row"]] != "Waiting For response":
            continue
        base = cons(r) or ins(r)
        fasce[_fascia_eta(max((today - base).days, 0) if base else None)].append(r["_row"])
    eta = {"fasce": [{"k": k, "label": l, "n": len(fasce[k]), "rows": fasce[k]} for k, l in ETA_FASCE],
           "totale": sum(len(v) for v in fasce.values()), "oltre180": len(fasce["181+"]), "mancante": len(fasce["nd"])}

    # ---- Pillole: scadenze WIP e offerte da sollecitare
    scadute = imminenti = 0
    for r in rows:
        c = cons(r)
        if stato[r["_row"]] == "WIP" and c is not None:
            gg = (c - today).days
            scadute += gg < 0
            imminenti += 0 <= gg <= GIORNI_SCADENZA
    solleciti = [r["_row"] for r in rows if stato[r["_row"]] == "Waiting For response" and ins(r)
                 and GIORNI_SOLLECITO <= (today - ins(r)).days <= GIORNI_RICLASSIFICA]

    att_wip = Counter(r["Attenzione"] for r in rows if stato[r["_row"]] == "WIP" and r.get("Attenzione"))
    # torta delle attenzioni: per livello (3 rosso, 2 arancione, 1 giallo, 0 nessuna), sulle sole WIP o su tutte le offerte
    attenzione_chart = {
        "wip": {str(k): sum(1 for r in rows if stato[r["_row"]] == "WIP" and (r.get("Attenzione") or 0) == k) for k in (3, 2, 1, 0)},
        "tutte": {str(k): sum(1 for r in rows if (r.get("Attenzione") or 0) == k) for k in (3, 2, 1, 0)},
    }

    # WIP per tipo e per scadenza: scadute / questa settimana / prossima settimana / oltre / senza data
    week_end = 6 - today.weekday()

    def bucket(r):
        c = cons(r)
        if c is None:
            return "senza_data"
        g_ = (c - today).days
        return "scadute" if g_ < 0 else "settimana" if g_ <= week_end else "prossima" if g_ <= week_end + 7 else "oltre"
    wt = defaultdict(Counter)
    for r in rows:
        if stato[r["_row"]] == "WIP":
            wt[_tipo_group(r["tipo"])][bucket(r)] += 1
    wip_tipo = [{"nome": n, **{k: wt[n].get(k, 0) for k in ("scadute", "settimana", "prossima", "oltre", "senza_data")}, "totale": sum(wt[n].values())}
                for n in TIPI_MAIN + ["Altro"] if wt.get(n)]

    # ---- Punti di attenzione
    ss_count = Counter()                               # il codice SS è progressivo per anno: duplicato = stesso codice nello stesso anno di Data ins.
    for r in rows:
        s = clean_text(r["SS"])
        if s and _split_ss(s) and _anno_ins(r):
            ss_count[(s.upper(), _anno_ins(r))] += 1
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
            att["Stato non riconosciuto"].append(_brief(r, dettaglio=r["Stato"]))
        if not r["Stato"]:
            att["Senza Stato"].append(_brief(r))
        if s in ("WIP", "Waiting For response") and not clean_text(r["Solution D&A"]):
            att["WIP/Waiting senza Solution D&A"].append(_brief(r))
        mancanti = [f for f in ("Vertical", "tipo", "Oggetto") if not r[f]] + (["Market"] if r["Market"] == NOIND else [])
        if mancanti:
            att["Campi base mancanti (Vertical/Market/tipo/Oggetto)"].append(_brief(r, dettaglio=", ".join(mancanti)))
        ssv = clean_text(r["SS"])
        if ssv and _anno_ins(r) and ss_count.get((ssv.upper(), _anno_ins(r)), 0) > 1:
            att["Codice SS duplicato nello stesso anno"].append(_brief(r, dettaglio=f"{ssv} · {_anno_ins(r)}"))
    attenzioni = sorted(({"titolo": t, "righe": v} for t, v in att.items()), key=lambda a: -len(a["righe"]))

    return {
        "oggi": today.isoformat(),
        "kpi": kpi,
        "pillole": {"scadute": scadute, "imminenti": imminenti, "solleciti": solleciti,
                    "attenzione": {"totale": sum(att_wip.values()), "rosse": att_wip[3], "arancioni": att_wip[2], "gialle": att_wip[1]}, "attenzioni": sum(len(a["righe"]) for a in attenzioni)},
        "trend": trend,
        "eta_attesa": eta,
        "pipeline_market": _group_pipeline(scope, stato, "Market"),
        "pipeline_vertical": _group_pipeline(scope, stato, "Vertical"),
        "esito_tipo": esito,
        "top_clienti": top_clienti,
        "attenzione_chart": attenzione_chart,
        "wip_tipo": wip_tipo,
        "attenzioni": attenzioni,
        "soglie": {"sollecito": GIORNI_SOLLECITO, "riclassifica": GIORNI_RICLASSIFICA, "scadenza": GIORNI_SCADENZA, "min_chiuse": MIN_CHIUSE},
    }
