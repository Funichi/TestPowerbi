"""Stimometro: motore di calcolo (specifica, capitolo 4). È l'unica implementazione delle regole.

Isolato: niente database né interfaccia. Riceve una stima (dict) con il suo snapshot dei parametri e restituisce tutti i risultati.
Aritmetica decimale: ogni numero entra come Decimal(str(x)) e prima di arrotondare si normalizza a 9 decimali (§4.1),
così 112,5 × 6% = 6,75 diventa 7,0 come in Excel e non 6,5 per un 6,7499999… in virgola mobile.
I totali sono sempre somme di valori già arrotondati; costi, prezzi, margini, FTE e quantità per complessità non si arrotondano.
Una divisione per zero dà None, che l'interfaccia mostra come "n/d" (mai un errore).

Struttura della stima in ingresso:
  snapshot          copia del catalogo (vedi stime_catalogo.CATALOGO)
  righe             [{contesto: "progetto"|"am_esercizio", tipo, etichetta, quantita, mix: [S,M,D]|None, gg_be, gg_fe}]
  voci_corpo        [{nome, gg_be, gg_fe}]
  training_be/fe, durata_mesi (o None), prezzo_obiettivo (o None)
  am                {modalita: None|"manuale"|"driver",
                     manuale: {BE: {gg_mese, mesi}, FE: {gg_mese, mesi}},
                     driver: {fonte: "progetto"|"esercizio", servizio: "H8"|"H12"|"H24", anni, evolutiva, presa: bool|None}}
"""
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from .stime_catalogo import BLOCCHI, TEAM_PROGETTO

ZERO = Decimal(0)
UNO = Decimal(1)
_NOVE = Decimal("1e-9")


def D(x, default=ZERO):
    """Numero -> Decimal esatto (0.06 -> 0,06). Vuoto o non numerico -> default."""
    if x is None or x == "" or isinstance(x, bool):
        return default
    if isinstance(x, Decimal):
        return x
    try:
        return Decimal(str(x).replace(",", ".")) if isinstance(x, str) else Decimal(str(x))
    except (InvalidOperation, ValueError):
        return default


def normalizza(x):
    return x.quantize(_NOVE, rounding=ROUND_HALF_UP)


def arrotonda(x, passo):
    """R(x) = ROUND(x / P; 0) × P, con la metà verso l'alto (§4.1). Passo non positivo: nessun arrotondamento."""
    x = normalizza(D(x))
    if passo <= 0:
        return x
    return normalizza((normalizza(x / passo)).quantize(UNO, rounding=ROUND_HALF_UP) * passo)


def pct_it(x):
    """0,2695 -> "26,95%" (messaggi in italiano)."""
    return f"{normalizza(D(x) * 100).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)}%".replace(".", ",")


def dividi(a, b):
    return None if b is None or b == 0 or a is None else a / b


def _bt(be=ZERO, fe=ZERO):
    return {"BE": be, "FE": fe}


def _somma(*voci):
    return _bt(sum((v["BE"] for v in voci), ZERO), sum((v["FE"] for v in voci), ZERO))


class _Ctx:
    """Snapshot convertito in Decimal, con gli indici per codice, e raccolta dei messaggi (§4.13)."""

    def __init__(self, snap):
        self.snap = snap
        self.msg = []
        g = snap.get("generali", {})
        self.passo = D(g.get("passo"), Decimal("0.5"))
        self.G = D(g.get("gg_mese"), Decimal(20))
        self.margine = D(g.get("margine_progetto"))
        self.margine_am = D(g.get("margine_am"))
        self.costo = {t["codice"]: D(t.get("costo")) for t in snap.get("team", [])}
        self.moduli = {m["codice"]: m for m in snap.get("moduli", [])}
        self.ordine_moduli = [m["codice"] for m in snap.get("moduli", [])]
        self.tipi = {t["codice"]: t for t in snap.get("tipi", [])}
        self.fasi = {f["codice"]: f for f in snap.get("fasi", [])}
        self.am = snap.get("am", {})

    def R(self, x):
        return arrotonda(x, self.passo)

    def m(self, livello, codice, testo, dove=None):
        self.msg.append({"livello": livello, "codice": codice, "testo": testo, "dove": dove})

    def pct_fuori(self, valore, voce, nome, dove):
        """Avviso se la percentuale è fuori dall'intervallo min/max del catalogo, quando è definito."""
        lo, hi = voce.get("min"), voce.get("max")
        v = D(valore)
        if (lo is not None and v < D(lo)) or (hi is not None and v > D(hi)):
            self.m("avviso", "pct_fuori_intervallo", f"{nome}: {pct_it(v)} fuori dall'intervallo previsto", dove)


def _somma_uno(valori):
    return normalizza(sum((D(v) for v in valori), ZERO)) == UNO


# ------------------------------------------------------------------ giornate fisse sulle fasi (al posto della percentuale)
# Una fase (anche PM e contingency) può avere "gg_fissi" nello snapshot della stima: allora vale quel numero di giornate.
# Ripartizione per team: BE = R(N × quota BE), FE = R(N) − BE, così BE + FE = R(N) esattamente. La quota BE è %BE della fase,
# oppure (analisi, disegno, contingency) la quota BE della base su cui si calcolerebbe la percentuale; con base zero, 50%.

def _gg_fissi(ctx, f):
    v = (f or {}).get("gg_fissi")
    if v is None or v == "":
        return None
    n = D(v)
    if n < 0:
        ctx.m("errore", "negativo", f"{f.get('nome') or f.get('codice')}: giornate fisse negative", f"fase:{f.get('codice')}")
    return n


def quota_be(bt):
    tot = bt["BE"] + bt["FE"]
    return Decimal("0.5") if tot == 0 else bt["BE"] / tot


def _ripartisci_fisso(ctx, n, q_be):
    tot = ctx.R(n)
    be = ctx.R(n * q_be)
    return _bt(be, tot - be)


# ------------------------------------------------------------------ righe (§4.2)

def calcola_riga(ctx, r, dove):
    """Una riga di stima: n per complessità, giornate grezze e giornate BE/FE arrotondate."""
    tipo = ctx.tipi.get(r.get("tipo"))
    out = {"tipo": r.get("tipo"), "etichetta": r.get("etichetta") or "", "modulo": None, "modalita": None,
           "quantita": None, "mix": None, "mix_modificato": False, "n": None, "gg": None, "gg_grezzi": None,
           "pct_be": None, "BE": ZERO, "FE": ZERO, "tot": ZERO}
    if not tipo:
        ctx.m("errore", "tipo_sconosciuto", f"Tipo oggetto {r.get('tipo')!r} non presente nei parametri della stima", dove)
        return out
    out["modulo"], out["modalita"] = tipo["modulo"], tipo["modalita"]
    if not tipo.get("attivo", True):
        ctx.m("avviso", "tipo_disattivato", f"{tipo['codice']}: tipo oggetto disattivato nel catalogo, la riga usa i parametri della stima", dove)
    if tipo["modalita"] == "corpo":
        be = D(r.get("gg_be"), D(tipo.get("corpo_be")))
        fe = D(r.get("gg_fe"), D(tipo.get("corpo_fe")))
        if be < 0 or fe < 0:
            ctx.m("errore", "negativo", "Giornate negative", dove)
        out["BE"], out["FE"] = ctx.R(be), ctx.R(fe)
    else:
        q = D(r.get("quantita"))
        if q < 0:
            ctx.m("errore", "negativo", "Quantità negativa", dove)
        mix_riga = r.get("mix")
        mix = [D(x) for x in (mix_riga if mix_riga else tipo["mix"])]
        if mix_riga and not _somma_uno(mix):
            ctx.m("errore", "mix_riga", "Il mix S + M + D della riga non è 100%", dove)
        gg = [D(x) for x in tipo["gg"]]
        n = [q * x for x in mix]
        grezzi = sum((a * b for a, b in zip(n, gg)), ZERO)
        pbe, pfe = D(tipo.get("pct_be")), D(tipo.get("pct_fe"))
        out.update(quantita=q, mix=mix, mix_modificato=bool(mix_riga), n=n, gg=gg, gg_grezzi=grezzi, pct_be=pbe,
                   BE=ctx.R(grezzi * pbe), FE=ctx.R(grezzi * pfe))
    out["tot"] = out["BE"] + out["FE"]
    return out


def _controlla_tipo(ctx, tipo):
    dove = f"tipo:{tipo['codice']}"
    if tipo.get("modalita") == "corpo":
        if D(tipo.get("corpo_be")) < 0 or D(tipo.get("corpo_fe")) < 0:
            ctx.m("errore", "negativo", f"{tipo['codice']}: giornate a corpo negative", dove)
        return
    if not _somma_uno(tipo.get("mix") or []):
        ctx.m("errore", "mix_tipo", f"{tipo['codice']}: il mix S + M + D non è 100%", dove)
    if not _somma_uno([tipo.get("pct_be"), tipo.get("pct_fe")]):
        ctx.m("errore", "ripartizione_tipo", f"{tipo['codice']}: %BE + %FE non è 100%", dove)
    if any(D(x) < 0 for x in (tipo.get("gg") or [])):
        ctx.m("errore", "negativo", f"{tipo['codice']}: giornate unitarie negative", dove)


def _righe(ctx, righe, contesto):
    out = []
    for i, r in enumerate(righe):
        if (r.get("contesto") or "progetto") == contesto:
            x = calcola_riga(ctx, r, f"riga:{i}")
            x["indice"] = i
            out.append(x)
    return out


# ------------------------------------------------------------------ progetto (§4.3 - §4.10)

def _progetto(ctx, stima):
    R = ctx.R
    righe = _righe(ctx, stima.get("righe") or [], "progetto")
    for codice in dict.fromkeys(r["tipo"] for r in righe if r["tipo"] in ctx.tipi):
        _controlla_tipo(ctx, ctx.tipi[codice])

    # implementazione per modulo (§4.2)
    moduli = []
    usati = [c for c in ctx.ordine_moduli if any(r["modulo"] == c for r in righe)]
    for c in usati:
        mod = ctx.moduli[c]
        moduli.append({"codice": c, "nome": mod.get("nome"), "blocco": mod.get("blocco") or "Implementazione",
                       "impl": _somma(*[r for r in righe if r["modulo"] == c])})
    impl_moduli = [m for m in moduli if m["blocco"] != "Architettura"]
    arc_moduli = [m for m in moduli if m["blocco"] == "Architettura"]

    # sicurezza e blocco Implementazione (§4.4)
    base_moduli = sum((m["impl"]["BE"] + m["impl"]["FE"] for m in impl_moduli), ZERO)
    sec = ctx.fasi.get("SEC")
    if sec:
        S = base_moduli * D(sec.get("pct"))
        sicurezza = {"S": S, **_bt(R(S * D(sec.get("pct_be"))), R(S * D(sec.get("pct_fe"))))}
    else:
        sicurezza = {"S": ZERO, **_bt()}
    voci = []
    for i, v in enumerate(stima.get("voci_corpo") or []):
        be, fe = D(v.get("gg_be")), D(v.get("gg_fe"))
        if be < 0 or fe < 0:
            ctx.m("errore", "negativo", "Giornate negative nella voce a corpo", f"voce:{i}")
        voci.append({"nome": v.get("nome") or "", **_bt(R(be), R(fe))})
    implementazione = _somma(*[m["impl"] for m in impl_moduli], sicurezza, *voci)
    B = implementazione["BE"] + implementazione["FE"]
    architettura = _somma(*[m["impl"] for m in arc_moduli])

    # fasi trasversali e training (§4.5). Analisi e disegno (base "Moduli_team"): un'unica percentuale sull'implementazione
    # dei moduli, calcolata per team (le giornate BE restano BE): Analisi(t) = R(Σ Impl(m,t) × %Analisi)
    impl_mod = _somma(*[m["impl"] for m in impl_moduli])
    fasi = {}
    for f in ctx.snap.get("fasi", []):
        if f.get("codice") in ("PM", "CONT") or f.get("base") not in ("Moduli_team", "B"):
            continue
        ctx.pct_fuori(f.get("pct"), f, f.get("nome") or f["codice"], f"fase:{f['codice']}")
        fisso = _gg_fissi(ctx, f)
        voce = {"codice": f["codice"], "nome": f.get("nome"), "blocco": f.get("blocco"), "fisso": fisso is not None}
        if f.get("base") == "Moduli_team":
            pct = D(f.get("pct"))
            if fisso is None:
                fasi[f["codice"]] = {**voce, "X": base_moduli * pct, **_bt(R(impl_mod["BE"] * pct), R(impl_mod["FE"] * pct))}
            else:
                fasi[f["codice"]] = {**voce, "X": fisso, **_ripartisci_fisso(ctx, fisso, quota_be(impl_mod))}
            continue
        if not _somma_uno([f.get("pct_be"), f.get("pct_fe")]):
            ctx.m("errore", "ripartizione_fase", f"{f.get('nome') or f['codice']}: %BE + %FE non è 100%", f"fase:{f['codice']}")
        if fisso is None:
            X = B * D(f.get("pct"))
            fasi[f["codice"]] = {**voce, "X": X, **_bt(R(X * D(f.get("pct_be"))), R(X * D(f.get("pct_fe"))))}
        else:
            fasi[f["codice"]] = {**voce, "X": fisso, **_ripartisci_fisso(ctx, fisso, D(f.get("pct_be")))}
    tbe, tfe = D(stima.get("training_be")), D(stima.get("training_fe"))
    if tbe < 0 or tfe < 0:
        ctx.m("errore", "negativo", "Giornate di training negative", "training")
    training = _bt(R(tbe), R(tfe))

    # blocchi e totale progetto (§4.6)
    per_blocco = {b: [] for b in BLOCCHI}
    for f in fasi.values():
        if f["blocco"] in per_blocco:
            per_blocco[f["blocco"]].append(f)
    blocchi = {
        "Analisi": _somma(*per_blocco["Analisi"]),
        "Disegno": _somma(*per_blocco["Disegno"]),
        "Architettura": _somma(architettura, *per_blocco["Architettura"]),
        "Implementazione": _somma(implementazione, *per_blocco["Implementazione"]),
        "Training": _somma(training, *per_blocco["Training"]),
        "Test": _somma(*per_blocco["Test"]),
        "Deploy": _somma(*per_blocco["Deploy"]),
    }
    TP = _somma(*blocchi.values())
    tp = TP["BE"] + TP["FE"]
    for b in blocchi.values():
        b["tot"] = b["BE"] + b["FE"]
        b["peso"] = dividi(b["tot"], tp)                      # §4.9: sui sette blocchi, somma 100%
    TP["tot"] = tp

    # PM e contingency (§4.7)
    fpm, fco = ctx.fasi.get("PM", {}), ctx.fasi.get("CONT", {})
    ctx.pct_fuori(fpm.get("pct"), fpm, "Project management", "fase:PM")
    ctx.pct_fuori(fco.get("pct"), fco, "Contingency", "fase:CONT")
    fisso_pm, fisso_co = _gg_fissi(ctx, fpm), _gg_fissi(ctx, fco)
    PM = R(tp * D(fpm.get("pct"))) if fisso_pm is None else ctx.R(fisso_pm)
    if fisso_co is None:
        cont = _bt(R(TP["BE"] * D(fco.get("pct"))), R(TP["FE"] * D(fco.get("pct"))))
    else:
        cont = _ripartisci_fisso(ctx, fisso_co, quota_be(TP))
    cont["tot"] = cont["BE"] + cont["FE"]
    totale = tp + PM + cont["tot"]

    # costi, prezzo e prezzo obiettivo (§4.8)
    for t in ("BE", "FE", "PM"):
        if ctx.costo.get(t, ZERO) < 0:
            ctx.m("errore", "negativo", f"Costo giornaliero {t} negativo", f"team:{t}")
    costi = {"BE": (TP["BE"] + cont["BE"]) * ctx.costo.get("BE", ZERO),
             "FE": (TP["FE"] + cont["FE"]) * ctx.costo.get("FE", ZERO),
             "PM": PM * ctx.costo.get("PM", ZERO)}
    costi["tot"] = costi["BE"] + costi["FE"] + costi["PM"]
    m = ctx.margine
    if m >= 1:
        ctx.m("errore", "margine", "Il margine del progetto deve essere inferiore al 100%", "margine_progetto")
        prezzo = None
    elif m < 0:
        ctx.m("errore", "negativo", "Margine del progetto negativo", "margine_progetto")
        prezzo = costi["tot"] / (1 - m)
    else:
        prezzo = costi["tot"] / (1 - m)
    obiettivo = None
    po = stima.get("prezzo_obiettivo")
    if po not in (None, ""):
        P = D(po)
        mr = None if P <= 0 else 1 - costi["tot"] / P
        obiettivo = {"prezzo": P, "margine": mr, "scostamento": None if prezzo is None else P - prezzo,
                     "sotto_margine": mr is not None and mr < m}
        if obiettivo["sotto_margine"]:
            ctx.m("avviso", "margine_risultante", f"Con il prezzo obiettivo il margine scende al {pct_it(mr)}, sotto il {pct_it(m)} della stima", "prezzo_obiettivo")

    # FTE (§4.10)
    durata = stima.get("durata_mesi")
    fte = None
    if durata in (None, "") or D(durata) <= 0:
        ctx.m("info", "durata", "Durata non indicata: FTE non calcolati", "durata_mesi")
    else:
        den = D(durata) * ctx.G
        fte = {"BE": dividi(TP["BE"] + cont["BE"], den), "FE": dividi(TP["FE"] + cont["FE"], den), "PM": dividi(PM, den)}
        fte["tot"] = None if None in fte.values() else fte["BE"] + fte["FE"] + fte["PM"]

    return {
        "righe": righe, "moduli": moduli, "base_moduli": base_moduli, "sicurezza": sicurezza, "voci_corpo": voci,
        "implementazione": implementazione, "B": B, "architettura": architettura, "fasi": fasi, "training": training,
        "blocchi": blocchi, "TP": TP, "PM": PM, "contingency": cont, "totale": totale,
        "peso_pm": dividi(PM, tp), "peso_contingency": dividi(cont["tot"], tp),
        "costi": costi, "margine": m, "prezzo": prezzo,
        "costo_medio": dividi(costi["tot"], totale), "prezzo_medio": dividi(prezzo, totale),
        "obiettivo": obiettivo, "durata_mesi": None if durata in (None, "") else D(durata), "fte": fte,
    }


# ------------------------------------------------------------------ AM (§4.11, §4.12)

def _am_manuale(ctx, cfg):
    R = ctx.R
    team = {}
    for t in TEAM_PROGETTO:
        c = (cfg or {}).get(t) or {}
        gm, mesi = D(c.get("gg_mese")), D(c.get("mesi"))
        if gm < 0 or mesi < 0:
            ctx.m("errore", "negativo", f"AM {t}: valori negativi", f"am:{t}")
        gg = R(gm * mesi)
        team[t] = {"gg_mese": gm, "mesi": mesi, "gg": gg, "costo": gg * ctx.costo.get(t, ZERO), "fte": dividi(gm, ctx.G)}
    gg = sum((x["gg"] for x in team.values()), ZERO)
    costo = sum((x["costo"] for x in team.values()), ZERO)
    prezzo = _prezzo_am(ctx, costo)
    mesi = max(x["mesi"] for x in team.values())
    for x in team.values():
        x["prezzo"] = _prezzo_am(ctx, x["costo"])
    return {"modalita": "manuale", "team": team, "gg": gg, "costo": costo, "prezzo": prezzo,
            "mensile": dividi(prezzo, mesi), "calcolabile": True}


def _prezzo_am(ctx, costo):
    return None if ctx.margine_am >= 1 else costo / (1 - ctx.margine_am)


def _am_driver(ctx, cfg, stima, progetto):
    R = ctx.R
    cfg = cfg or {}
    fonte = cfg.get("fonte") or "progetto"
    am = ctx.am
    if fonte == "progetto":
        beq = dict(progetto["implementazione"])
        righe = []
    else:
        righe = _righe(ctx, stima.get("righe") or [], "am_esercizio")
        for codice in dict.fromkeys(r["tipo"] for r in righe if r["tipo"] in ctx.tipi):
            _controlla_tipo(ctx, ctx.tipi[codice])
        beq = _somma(*righe)
    tot = beq["BE"] + beq["FE"]
    servizio = cfg.get("servizio") or "H8"
    coeff = D((am.get("coeff") or {}).get(servizio), None)
    if coeff is None:
        ctx.m("errore", "servizio", f"Livello di servizio {servizio!r} non previsto", "am:servizio")
        coeff = ZERO
    anni = int(D(cfg.get("anni"), UNO))
    amax = int(D(am.get("anni_max"), Decimal(5)))
    if anni < 1 or anni > amax:
        ctx.m("errore", "anni", f"Gli anni di AM vanno da 1 a {amax}", "am:anni")
        anni = max(1, min(anni, amax))
    E = D(cfg.get("evolutiva"))
    if E < 0:
        ctx.m("errore", "negativo", "Evolutiva negativa", "am:evolutiva")
    presa = cfg.get("presa")
    if presa is None:
        presa = fonte != "progetto"                            # default: sì per "Oggetti in esercizio", no per "Progetto"
    out = {"modalita": "driver", "fonte": fonte, "servizio": servizio, "coeff": coeff, "anni_n": anni, "evolutiva": E, "presa": bool(presa),
           "righe": righe, "beq": {**beq, "tot": tot}, "quota": None, "anni": [], "gg": ZERO, "costo": ZERO, "prezzo": ZERO, "calcolabile": tot > 0}
    if tot <= 0:
        ctx.m("avviso", "beq_zero", "AM da driver non calcolabile: il build equivalente è zero", "am")
        out["prezzo"] = None
        return out
    quota = {t: beq[t] / tot for t in TEAM_PROGETTO}
    out["quota"] = quota
    pc, dec, pp = D(am.get("pct_correttiva")), D(am.get("decalage")), D(am.get("pct_presa"))
    evol = {t: R(E * quota[t]) for t in TEAM_PROGETTO}
    presa_t = {t: R(tot * pp * quota[t]) if presa else ZERO for t in TEAM_PROGETTO}
    for k in range(1, anni + 1):
        C = tot * pc * coeff * (1 - dec) ** (k - 1)
        corr = {t: R(C * quota[t]) for t in TEAM_PROGETTO}
        pr = presa_t if k == 1 else {t: ZERO for t in TEAM_PROGETTO}
        gg = {t: corr[t] + evol[t] + pr[t] for t in TEAM_PROGETTO}
        costo = sum((gg[t] * ctx.costo.get(t, ZERO) for t in TEAM_PROGETTO), ZERO)
        prezzo = _prezzo_am(ctx, costo)
        gtot = gg["BE"] + gg["FE"]
        out["anni"].append({"anno": k, "C": C, "correttiva": corr, "evolutiva": evol, "presa": pr, "gg": {**gg, "tot": gtot},
                            "costo": costo, "prezzo": prezzo, "mensile": dividi(prezzo, Decimal(12)), "fte": dividi(gtot, 12 * ctx.G)})
    out["gg"] = sum((a["gg"]["tot"] for a in out["anni"]), ZERO)
    out["costo"] = sum((a["costo"] for a in out["anni"]), ZERO)
    out["prezzo"] = None if any(a["prezzo"] is None for a in out["anni"]) else sum((a["prezzo"] for a in out["anni"]), ZERO)
    return out


# ------------------------------------------------------------------ ingresso

def calcola(stima):
    """Calcola l'intera stima con il suo snapshot. Non modifica l'ingresso."""
    ctx = _Ctx(stima.get("snapshot") or {})
    if ctx.passo <= 0:
        ctx.m("errore", "passo", "Il passo di arrotondamento deve essere maggiore di zero", "passo")
    if ctx.margine_am >= 1:
        ctx.m("errore", "margine", "Il margine AM deve essere inferiore al 100%", "margine_am")
    progetto = _progetto(ctx, stima)
    am_cfg = stima.get("am") or {}
    modo = am_cfg.get("modalita")
    am = None
    if modo == "manuale":
        am = _am_manuale(ctx, am_cfg.get("manuale"))
    elif modo == "driver":
        am = _am_driver(ctx, am_cfg.get("driver"), stima, progetto)
    return {"progetto": progetto, "am": am, "messaggi": ctx.msg,
            "export_bloccato": any(x["livello"] == "errore" for x in ctx.msg)}


def in_json(x):
    """Risultati pronti per JSON: Decimal -> float (None resta None = "n/d")."""
    if isinstance(x, Decimal):
        return float(x)
    if isinstance(x, dict):
        return {k: in_json(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [in_json(v) for v in x]
    return x
