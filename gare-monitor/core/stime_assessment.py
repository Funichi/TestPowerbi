"""Stimometro: motore delle stime di tipo Assessment (workstream e attività con deliverable).

Funzione pura, separata dal motore del progetto: niente fasi in percentuale e niente AM. Riusa le regole generali
(arrotondamento R al passo con la normalizzazione a 9 decimali, valori "n/d" per le divisioni per zero, messaggi).

    Subtotale(ws,t) = Σ R(attività del workstream, team t)        t ∈ {PM, BE, FE}
    Accessorie(t)   = Σ R(attività accessorie, team t)
    Totale(t)       = Σ Subtotale(ws,t) + Accessorie(t)
    Contingency(t)  = R(Totale(t) × %Contingency)                 (anche sul PM)
    TotaleCont(t)   = Totale(t) + Contingency(t)
    Costo(t)        = TotaleCont(t) × costo_t;  Prezzo = Costo / (1 − margine)
    FTE(t)          = TotaleCont(t) / (mesi × giornate al mese)
    Peso(ws)        = giornate del workstream / giornate totali senza contingency
"""
from decimal import Decimal

from .stime_catalogo import ASSESSMENT_DEFAULT
from .stime_motore import ZERO, D, arrotonda, dividi, pct_it

TEAM = ("PM", "BE", "FE")


def _vuoto():
    return {t: ZERO for t in TEAM}


def _tot(x):
    x["tot"] = sum((x[t] for t in TEAM), ZERO)
    return x


def calcola_assessment(stima):
    """Calcola una stima Assessment con il suo snapshot. Non modifica l'ingresso."""
    snap = stima.get("snapshot") or {}
    g = snap.get("generali", {})
    a = {**ASSESSMENT_DEFAULT, **(snap.get("assessment") or {})}
    passo, G = D(g.get("passo"), Decimal("0.5")), D(g.get("gg_mese"), Decimal(20))
    msg = []
    m = lambda livello, codice, testo, dove=None: msg.append({"livello": livello, "codice": codice, "testo": testo, "dove": dove})
    R = lambda x: arrotonda(x, passo)
    if passo <= 0:
        m("errore", "passo", "Il passo di arrotondamento deve essere maggiore di zero", "passo")
    costo = {"PM": D(a.get("costo_pm")), "BE": D(a.get("costo_be")), "FE": D(a.get("costo_fe"))}
    for t in TEAM:
        if costo[t] < 0:
            m("errore", "negativo", f"Costo giornaliero {t} negativo", f"costo:{t}")
    pct_cont, margine = D(a.get("contingency")), D(a.get("margine"))
    if pct_cont < 0:
        m("errore", "negativo", "Contingency negativa", "contingency")

    def giornate(x, dove):
        out = {}
        for t in TEAM:
            v = D(x.get("gg_" + t.lower()))
            if v < 0:
                m("errore", "negativo", "Giornate negative", dove)
            out[t] = R(v)
        return _tot(out)

    workstream = []
    for i, ws in enumerate(stima.get("workstream") or []):
        att = []
        for j, x in enumerate(ws.get("attivita") or []):
            att.append({"id": x.get("id") or "", "attivita": x.get("attivita") or "", "deliverable": x.get("deliverable") or "",
                        **giornate(x, f"attivita:{i}:{j}")})
        sub = _tot({t: sum((y[t] for y in att), ZERO) for t in TEAM})
        workstream.append({"codice": ws.get("codice") or "", "nome": ws.get("nome") or "", "attivita": att, **sub})
    accessorie = [{"nome": v.get("nome") or "", **giornate(v, f"voce:{i}")} for i, v in enumerate(stima.get("voci_corpo") or [])]
    acc = _tot({t: sum((y[t] for y in accessorie), ZERO) for t in TEAM})
    totale = _tot({t: sum((w[t] for w in workstream), ZERO) + acc[t] for t in TEAM})
    for w in workstream:
        w["peso"] = dividi(w["tot"], totale["tot"])
    acc["peso"] = dividi(acc["tot"], totale["tot"])
    cont = _tot({t: R(totale[t] * pct_cont) for t in TEAM})
    tcont = _tot({t: totale[t] + cont[t] for t in TEAM})
    costi = _tot({t: tcont[t] * costo[t] for t in TEAM})

    if margine >= 1:
        m("errore", "margine", "Il margine deve essere inferiore al 100%", "margine")
        prezzo = None
    else:
        if margine < 0:
            m("errore", "negativo", "Margine negativo", "margine")
        prezzo = costi["tot"] / (1 - margine)
    obiettivo = None
    po = stima.get("prezzo_obiettivo")
    if po not in (None, ""):
        P = D(po)
        mr = None if P <= 0 else 1 - costi["tot"] / P
        obiettivo = {"prezzo": P, "margine": mr, "scostamento": None if prezzo is None else P - prezzo,
                     "sotto_margine": mr is not None and mr < margine}
        if obiettivo["sotto_margine"]:
            m("avviso", "margine_risultante", f"Con il prezzo obiettivo il margine scende al {pct_it(mr)}, sotto il {pct_it(margine)} della stima", "prezzo_obiettivo")

    durata = stima.get("durata_mesi")
    fte = None
    if durata in (None, "") or D(durata) <= 0:
        m("info", "durata", "Durata non indicata: FTE non calcolati", "durata_mesi")
    else:
        den = D(durata) * G
        fte = {t: dividi(tcont[t], den) for t in TEAM}
        fte["tot"] = None if None in fte.values() else sum((fte[t] for t in TEAM), ZERO)

    ass = {"workstream": workstream, "accessorie": accessorie, "acc": acc, "totale": totale, "pct_contingency": pct_cont,
           "contingency": cont, "totale_cont": tcont, "costo_unitario": costo, "costi": costi, "margine": margine, "prezzo": prezzo,
           "costo_medio": dividi(costi["tot"], tcont["tot"]), "prezzo_medio": dividi(prezzo, tcont["tot"]),
           "obiettivo": obiettivo, "durata_mesi": None if durata in (None, "") else D(durata), "fte": fte}
    return {"tipo": "assessment", "assessment": ass, "progetto": None, "am": None, "messaggi": msg,
            "export_bloccato": any(x["livello"] == "errore" for x in msg)}
