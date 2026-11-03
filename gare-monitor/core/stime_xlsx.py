"""Stimometro: export Excel con il layout dello Stimometro originale (specifica §8).

Tre fogli: Parametri, Stima, Appoggio redistribuzione (all'apertura è attivo Stima).
- Parametri: un blocco di complessità per ogni tipo oggetto a quantità (quantità per riga, mix, giornate unitarie e ripartizione
  BE/FE), le attività a corpo (training compreso), gli oggetti in esercizio dell'AM, il servizio AM e, in alto a destra,
  arrotondamento e giornate lavorative al mese.
- Stima: le sezioni da Analisi a Deploy con le giornate (colonna C) e le percentuali (colonna E), i totali, i costi, il margine,
  il prezzo obiettivo e la manutenzione; a destra i pannelli di riepilogo (pesi, valori per giornata, giornate per team, FTE).
- Appoggio redistribuzione: le stesse righe del foglio Stima, con le giornate per team (BE/FE), le ripartizioni delle fasi in
  percentuale, le giornate fisse (colonna J: vuota = vale la percentuale) e i controlli di quadratura.

Ogni valore calcolato è una formula con le regole del motore (stime_motore.py), arrotondamento compreso:
R(x) = ROUND(ROUND(x;9)/Passo;0)*Passo. Funzioni usate: SUM, ROUND, IF, MAX. Nessuna tabella Excel, nessun riferimento strutturato,
nessun collegamento esterno, nessuna macro. Gli input sono in testo blu. Il file è a senso unico: le modifiche fatte nell'Excel
non tornano nell'app.
"""
import datetime as dt
import io
import re

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.workbook.defined_name import DefinedName

from .stime_catalogo import BLOCCHI
from .stime_motore import calcola

# formati (come nell'originale; le percentuali delle fasi con un decimale, perché 0,2% e 0,5% non diventino 0% e 1%)
F_GG, F_EUR, F_PCT, F_PCT1, F_MIX, F_NUM, F_N2, F_CHK = "0.0", '#,##0 "€"', "0%", "0.0%", "0.00%", "General", "0.00", "0.00"
NAVY, AZZURRO, CELESTE, GRIGIO = "002060", "8FAADC", "DAE3F3", "CCCCCC"
BLU, GRIGIO_TESTO, ROSSO_TESTO = "0000FF", "808080", "C00000"
FILLS = {k: PatternFill("solid", fgColor=v) for k, v in (("navy", NAVY), ("testa", AZZURRO), ("etich", CELESTE), ("tot", GRIGIO))}
SOTTILE = Side(style="thin", color="000000")
BORDO = Border(left=SOTTILE, right=SOTTILE, top=SOTTILE, bottom=SOTTILE)
SHEET_P, SHEET_S, SHEET_A = "Parametri", "Stima", "Appoggio redistribuzione"


def R(expr):
    """Arrotondamento al passo come nel motore (§4.1), con la normalizzazione a 9 decimali."""
    return f"ROUND(ROUND({expr},9)/Passo,0)*Passo"


def _n(x):
    return None if x is None or x == "" else float(x)


def _font(sz=10, bold=False, color=None, italic=False, strike=False):
    return Font(name="Calibri", size=sz, bold=bold, color=color, italic=italic, strike=strike)


class Foglio:
    def __init__(self, ws, larghezze):
        self.ws = ws
        for col, w in larghezze.items():
            ws.column_dimensions[col].width = w
        ws.sheet_view.showGridLines = False

    @staticmethod
    def ref(r, c, assoluto=False):
        col = get_column_letter(c)
        return f"${col}${r}" if assoluto else f"{col}{r}"

    def ext(self, r, c):
        """Riferimento dall'esterno del foglio: 'Nome'!$C$5."""
        return f"'{self.ws.title}'!{self.ref(r, c, True)}"

    def put(self, r, c, v, fmt=None, stile=None, inp=False, bold=False, sz=10, center=False, bordo=True, color=None, italic=False):
        """stile: navy (barra titolo/totale principale), testa (intestazione), etich (etichetta di dettaglio), tot (riga Totale)."""
        cell = self.ws.cell(row=r, column=c, value=v)
        if stile == "navy":
            cell.font = _font(sz, True, "FFFFFF")
        elif stile in ("testa", "tot"):
            cell.font = _font(sz, True, BLU if inp else color)
        else:
            cell.font = _font(sz, bold, BLU if inp else color, italic)
        if stile:
            cell.fill = FILLS[stile]
        if fmt:
            cell.number_format = fmt
        if center or stile in ("navy", "testa", "tot"):
            cell.alignment = Alignment(horizontal="center", vertical="center")
        if bordo:
            cell.border = BORDO
        return cell

    def unisci(self, r, c1, c2, v, stile="navy", sz=10):
        for c in range(c1, c2 + 1):
            self.put(r, c, v if c == c1 else None, stile=stile, sz=sz)
        if c2 > c1:
            self.ws.merge_cells(start_row=r, start_column=c1, end_row=r, end_column=c2)

    def stampa(self, una_pagina=False):
        ws = self.ws
        ws.page_setup.orientation = "landscape"
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 1 if una_pagina else 0
        ws.sheet_properties.pageSetUpPr.fitToPage = True


def nome_file(stima, oggi=None):
    pulisci = lambda s: re.sub(r"[^A-Za-z0-9]+", "_", str(s or "").strip()).strip("_")[:40] or "senza_nome"
    return f"Stima_{pulisci(stima.get('cliente'))}_{pulisci(stima.get('nome'))}_v{stima.get('versione') or 1}_{(oggi or dt.date.today()).isoformat()}.xlsx"


def _somma(refs):
    return "+".join(refs) if refs else "0"


def esporta(stima, oggi=None):
    """Excel della stima: (bytes, nome file, celle chiave {nome: "'Foglio'!$C$5"} per i test). Solleva ValueError se ci sono errori."""
    res = calcola(stima)
    if res["export_bloccato"]:
        errori = [m["testo"] for m in res["messaggi"] if m["livello"] == "errore"]
        raise ValueError("Export bloccato: correggi prima gli errori della stima (" + "; ".join(dict.fromkeys(errori)) + ")")
    snap = stima["snapshot"]
    oggi = oggi or dt.date.today()
    wb = Workbook()
    wb.calculation.fullCalcOnLoad = True
    P = Foglio(wb.active, {"A": 3.5, "B": 18, "C": 13, "D": 13, "E": 13, "F": 13, "G": 13, "H": 13, "I": 11, "J": 11, "K": 11,
                           "L": 2, "M": 2, "N": 13, "O": 9, "P": 3, "Q": 28, "R": 12})
    P.ws.title = SHEET_P
    S = Foglio(wb.create_sheet(SHEET_S), {"A": 2.4, "B": 27.5, "C": 26, "D": 1.4, "E": 8.7, "F": 1.7, "G": 2.5, "H": 17.8, "I": 14,
                                          "J": 10, "K": 3.8, "L": 16.6, "M": 12.6, "N": 12.6, "O": 12.6})
    A = Foglio(wb.create_sheet(SHEET_A), {"A": 2.7, "B": 27.5, "C": 26, "D": 2.5, "E": 12, "F": 12.4, "G": 7, "H": 7, "I": 9, "J": 11})
    celle = {}

    def nome_def(nome, foglio, r, c):
        wb.defined_names[nome] = DefinedName(nome, attr_text=foglio.ext(r, c))

    tipi = {t["codice"]: t for t in snap["tipi"]}
    moduli = {m["codice"]: m for m in snap["moduli"]}
    fasi = {f["codice"]: f for f in snap["fasi"]}
    righe_valide = [x for x in stima.get("righe") or [] if x.get("tipo") in tipi]
    righe_prog = [x for x in righe_valide if (x.get("contesto") or "progetto") == "progetto"]
    righe_es = [x for x in righe_valide if x.get("contesto") == "am_esercizio"]
    am_cfg = stima.get("am") or {}
    modo = am_cfg.get("modalita")
    g = snap["generali"]

    # ================================================================ Parametri
    # in alto a destra: parametri generali e legenda
    P.unisci(2, 17, 18, "Parametri generali")
    P.put(3, 17, "Arrotondamento (gg)", stile="etich")
    P.put(3, 18, _n(g.get("passo")), F_NUM, inp=True, center=True)
    nome_def("Passo", P, 3, 18)
    P.put(4, 17, "Giornate lavorative al mese", stile="etich")
    P.put(4, 18, _n(g.get("gg_mese")), F_NUM, inp=True, center=True)
    nome_def("GgMese", P, 4, 18)
    P.put(6, 17, "Testo blu = valore modificabile", color=BLU, bordo=False)
    P.put(7, 17, "Tutto il resto si ricalcola", color=GRIGIO_TESTO, bordo=False)

    def blocco_complessita(r, t, righe, titolo, effort):
        """Blocco di complessità di un tipo oggetto a quantità. Restituisce (riga successiva libera, cella Totale GG BE, GG FE)."""
        mod_mix = any(x.get("mix") for x in righe)
        P.put(r, 3, "Mix", sz=8, color=GRIGIO_TESTO, bordo=False)
        for i in range(3):
            P.put(r, 4 + i, _n(t["mix"][i]), F_MIX, inp=True, center=True)
        mixd = [P.ref(r, 4 + i, True) for i in range(3)]
        P.unisci(r + 1, 2, 11 if mod_mix else 8, titolo)
        P.unisci(r + 1, 14, 15, effort)
        intest = ["Voce", "Quantità", "Semplice", "Medio", "Difficile", "GG BE", "GG FE"] + (["Mix riga S", "Mix riga M", "Mix riga D"] if mod_mix else [])
        for i, x in enumerate(intest):
            P.put(r + 2, 2 + i, x, stile="testa")
        P.put(r + 2, 14, "Difficoltà", stile="testa")
        P.put(r + 2, 15, "Effort", stile="testa")
        e0 = r + 3                                              # tabella di effort: S, M, D, % BE, % FE
        for i, (lab, val, fmt) in enumerate((("Semplice", t["gg"][0], F_NUM), ("Medio", t["gg"][1], F_NUM), ("Difficile", t["gg"][2], F_NUM),
                                             ("% BE", t.get("pct_be"), F_PCT), ("% FE", t.get("pct_fe"), F_PCT))):
            P.put(e0 + i, 14, lab, stile="etich", bold=True)
            P.put(e0 + i, 15, _n(val), fmt, inp=True, center=True)
        gg = [P.ref(e0 + i, 15, True) for i in range(3)]
        pbe, pfe = P.ref(e0 + 3, 15, True), P.ref(e0 + 4, 15, True)
        prima = r + 3
        tutte = list(righe) + [None, None]                      # due righe di scorta con le formule pronte
        for k, x in enumerate(tutte):
            rr = prima + k
            P.put(rr, 2, (x.get("etichetta") or t.get("nome")) if x else None, stile="etich", bold=True)
            P.put(rr, 3, (_n(x.get("quantita")) or 0) if x else None, F_NUM, inp=True, center=True)
            if mod_mix:
                for i in range(3):
                    if x and x.get("mix"):
                        c = P.put(rr, 9 + i, _n(x["mix"][i]), F_MIX, inp=True, center=True)
                        if i == 0:
                            c.comment = Comment("Mix modificato rispetto al default", "Stimometro")
                    else:
                        P.put(rr, 9 + i, f"={mixd[i]}", F_MIX, center=True)
                mix = [P.ref(rr, 9 + i) for i in range(3)]
            else:
                mix = mixd
            for i in range(3):
                P.put(rr, 4 + i, f"={P.ref(rr, 3)}*{mix[i]}", F_N2, center=True)
            grezzi = f"{P.ref(rr, 4)}*{gg[0]}+{P.ref(rr, 5)}*{gg[1]}+{P.ref(rr, 6)}*{gg[2]}"
            P.put(rr, 7, "=" + R(f"({grezzi})*{pbe}"), F_GG, center=True)
            P.put(rr, 8, "=" + R(f"({grezzi})*{pfe}"), F_GG, center=True)
        rt = prima + len(tutte)
        P.put(rt, 2, "Totale", stile="tot")
        for c in range(3, 9):
            P.put(rt, c, f"=SUM({P.ref(prima, c)}:{P.ref(rt - 1, c)})", F_NUM if c == 3 else F_N2 if c < 7 else F_GG, stile="tot")
        if mod_mix:
            for c in range(9, 12):
                P.put(rt, c, None, stile="tot")
        return max(rt, e0 + 4) + 2, P.ref(rt, 7, True), P.ref(rt, 8, True)

    def titoli(cod_mod, t, prefisso=""):
        m = moduli.get(cod_mod) or {}
        nome = m.get("nome") or cod_mod
        piu_tipi = sum(1 for x in snap["tipi"] if x["modulo"] == cod_mod and x.get("modalita") == "quantita" and (x.get("attivo", True) or x is t)) > 1
        if prefisso:
            tit = f"{prefisso}{nome}"
        elif cod_mod == "STG":
            tit = "Flussi Staging"
        else:
            tit = f"Complessità {nome}"
        if piu_tipi:
            tit += f" – {t.get('nome')}"
        return tit, f"Effort {nome}"

    def blocchi_di(righe, r, prefisso=""):
        """Un blocco per ogni tipo oggetto a quantità usato, nell'ordine del catalogo. Restituisce (riga, {modulo: ([BE], [FE])})."""
        per_mod = {}
        for t in snap["tipi"]:
            mie = [x for x in righe if x["tipo"] == t["codice"]]
            if not mie or t.get("modalita") != "quantita":
                continue
            tit, eff = titoli(t["modulo"], t, prefisso)
            r, cbe, cfe = blocco_complessita(r, t, mie, tit, eff)
            per_mod.setdefault(t["modulo"], ([], []))
            per_mod[t["modulo"]][0].append(f"{SHEET_P}!{cbe}")
            per_mod[t["modulo"]][1].append(f"{SHEET_P}!{cfe}")
        return r, per_mod

    r, mod_q = blocchi_di(righe_prog, 2)

    # attività a corpo (voci della stima, righe a corpo dei moduli, training)
    P.unisci(r, 2, 5, "Attività a corpo")
    for i, x in enumerate(["Attività", "BE (gg)", "FE (gg)", "Blocco"]):
        P.put(r + 1, 2 + i, x, stile="testa")
    r += 2
    prima_corpo = r
    voci_pos, corpo_mod, training_pos = [], {}, None
    for v in stima.get("voci_corpo") or []:
        P.put(r, 2, v.get("nome") or "", stile="etich", bold=True)
        P.put(r, 3, _n(v.get("gg_be")) or 0, F_NUM, inp=True, center=True)
        P.put(r, 4, _n(v.get("gg_fe")) or 0, F_NUM, inp=True, center=True)
        P.put(r, 5, "Implementazione", center=True)
        voci_pos.append((v.get("nome") or "", f"{SHEET_P}!{P.ref(r, 3, True)}", f"{SHEET_P}!{P.ref(r, 4, True)}"))
        r += 1
    for x in righe_prog:
        t = tipi[x["tipo"]]
        if t.get("modalita") == "quantita":
            continue
        be = x.get("gg_be") if x.get("gg_be") is not None else t.get("corpo_be")
        fe = x.get("gg_fe") if x.get("gg_fe") is not None else t.get("corpo_fe")
        P.put(r, 2, x.get("etichetta") or t.get("nome"), stile="etich", bold=True)
        P.put(r, 3, _n(be) or 0, F_NUM, inp=True, center=True)
        P.put(r, 4, _n(fe) or 0, F_NUM, inp=True, center=True)
        P.put(r, 5, (moduli.get(t["modulo"]) or {}).get("nome") or t["modulo"], center=True)
        corpo_mod.setdefault(t["modulo"], ([], []))
        corpo_mod[t["modulo"]][0].append(R(f"{SHEET_P}!{P.ref(r, 3, True)}"))
        corpo_mod[t["modulo"]][1].append(R(f"{SHEET_P}!{P.ref(r, 4, True)}"))
        r += 1
    P.put(r, 2, "Training", stile="etich", bold=True)
    P.put(r, 3, _n(stima.get("training_be")) or 0, F_NUM, inp=True, center=True)
    P.put(r, 4, _n(stima.get("training_fe")) or 0, F_NUM, inp=True, center=True)
    P.put(r, 5, "Training", center=True)
    training_pos = (f"{SHEET_P}!{P.ref(r, 3, True)}", f"{SHEET_P}!{P.ref(r, 4, True)}")
    r += 1
    P.put(r, 2, "Totale", stile="tot")
    P.put(r, 3, f"=SUM(C{prima_corpo}:C{r - 1})", F_GG, stile="tot")
    P.put(r, 4, f"=SUM(D{prima_corpo}:D{r - 1})", F_GG, stile="tot")
    P.put(r, 5, None, stile="tot")
    r += 3

    # oggetti in esercizio dell'AM (fonte "Oggetti in esercizio")
    driver = am_cfg.get("driver") or {}
    fonte_es = modo == "driver" and (driver.get("fonte") or "progetto") != "progetto"
    mod_es = {}
    if fonte_es:
        r, mod_es = blocchi_di(righe_es, r, "AM – Oggetti in esercizio: ")

    # Servizio AM: posizioni riempite più sotto (dipendono dal foglio Stima per il build equivalente da progetto)
    r_am = r

    # ================================================================ Stima e Appoggio redistribuzione: righe allineate
    gara = stima.get("gara") or {}
    info = [stima.get("nome") or "", stima.get("cliente") or ""]
    if gara:
        info.append(f"gara {gara.get('ss') or ''} · {gara.get('anno') or ''}".strip())
    info += [f"v{stima.get('versione') or 1}", f"esportato il {oggi.strftime('%d/%m/%Y')}"]
    S.put(1, 2, " · ".join(x for x in info if x), sz=8, color=GRIGIO_TESTO, bordo=False)
    S.unisci(2, 2, 5, "Stima Completa", sz=12)
    A.unisci(2, 2, 3, "Stima Completa", sz=12)
    A.unisci(2, 7, 8, "% Distribuzione", sz=11)
    for c, x in ((5, "GG Backend"), (6, "GG Frontend"), (7, "BE"), (8, "FE"), (9, "Check"), (10, "GG fisse")):
        A.put(3, c, x, stile="navy", sz=11)
    AX = lambda r_, c_: f"'{SHEET_A}'!{A.ref(r_, c_, True)}"
    SX = lambda r_, c_: f"{SHEET_S}!{S.ref(r_, c_, True)}"
    grigio_se_fisse = []                                         # (cella % in Stima, cella giornate fisse in Appoggio)

    def testa_sezione(r_, nome, pct=True):
        S.put(r_, 2, nome, stile="testa")
        S.put(r_, 3, "Effort", stile="testa", sz=12)
        if pct:
            S.put(r_, 5, "%", stile="testa")
        A.put(r_, 2, nome, stile="testa")
        A.put(r_, 3, "Effort", stile="testa", sz=12)

    def voce(r_, nome, e_form, f_form, pct=None, split=None, fisse=None):
        """Una riga di dettaglio: in Appoggio E/F (giornate per team), in Stima C = E + F; pct = percentuale in E (input);
        split = (% BE, % FE) di Appoggio G/H (input); fisse = valore delle giornate fisse (Appoggio J, input)."""
        S.put(r_, 2, nome, stile="etich")
        A.put(r_, 2, nome, stile="etich")
        S.put(r_, 3, f"={AX(r_, 5)}+{AX(r_, 6)}", F_GG, sz=12, center=True)
        A.put(r_, 3, f"={SX(r_, 3)}", F_GG, sz=12, center=True)
        A.put(r_, 5, e_form, F_GG, sz=12, center=True)
        A.put(r_, 6, f_form, F_GG, sz=12, center=True)
        if pct is not None:
            c = S.put(r_, 5, pct[0], F_PCT1, inp=pct[1], center=True)
        if split is not None:
            A.put(r_, 7, _n(split[0]), F_PCT, inp=True, center=True, sz=11)
            A.put(r_, 8, _n(split[1]), F_PCT, inp=True, center=True, sz=11)
        if fisse is not None:
            A.put(r_, 10, fisse[0], F_NUM, inp=True, center=True, sz=11)
            if pct is not None:
                grigio_se_fisse.append((S.ref(r_, 5), AX(r_, 10)))
            for extra in fisse[1:]:
                grigio_se_fisse.append((extra, AX(r_, 10)))

    def totale_sezione(r_, prima_, nome="Totale"):
        S.put(r_, 2, nome, stile="tot")
        S.put(r_, 3, f"=SUM(C{prima_}:C{r_ - 1})", F_GG, stile="tot", sz=12)
        A.put(r_, 2, nome, stile="tot")
        A.put(r_, 3, f"={SX(r_, 3)}", F_GG, stile="tot", sz=12)
        A.put(r_, 5, f"=SUM(E{prima_}:E{r_ - 1})", F_GG, stile="tot", sz=12)
        A.put(r_, 6, f"=SUM(F{prima_}:F{r_ - 1})", F_GG, stile="tot", sz=12)
        A.put(r_, 9, f"=SUM(E{r_}:F{r_})-C{r_}", F_CHK, sz=11, center=True)

    # contenuto delle sezioni
    p_res = res["progetto"]
    arc_mod = [c for c in moduli if (moduli[c].get("blocco") == "Architettura") and (c in mod_q or c in corpo_mod)]
    impl_mod = [c for c in moduli if (moduli[c].get("blocco") or "Implementazione") != "Architettura" and (c in mod_q or c in corpo_mod)]
    fasi_b = lambda blocco: [f for f in snap["fasi"] if f.get("blocco") == blocco and f.get("base") == "B" and f["codice"] not in ("PM", "CONT", "SEC")]
    fasi_mt = lambda blocco: [f for f in snap["fasi"] if f.get("blocco") == blocco and f.get("base") == "Moduli_team"]
    sezioni = [b for b in BLOCCHI if b != "Architettura" or arc_mod or fasi_b("Architettura") or fasi_mt("Architettura")]

    r = 3
    sez_tot = {}                 # blocco -> riga del Totale
    righe_moduli_impl = []       # righe dei moduli dell'implementazione (base di analisi, disegno e sicurezza)
    pendenti = []                # voci che dipendono da righe successive: (riga, funzione)
    impl_tot_row = None
    for b in sezioni:
        con_pct = bool(fasi_b(b) or fasi_mt(b)) or (b == "Implementazione" and "SEC" in fasi)
        testa_sezione(r, b, con_pct)
        r += 1
        prima = r
        for f in fasi_b(b):                                     # fasi in percentuale sull'implementazione (B)
            rr = r
            pendenti.append((rr, f))
            r += 1
        for f in fasi_mt(b):                                    # analisi e disegno: per team sull'implementazione dei moduli
            pendenti.append((r, f))
            r += 2
        if b in ("Implementazione", "Architettura"):
            for c in (impl_mod if b == "Implementazione" else arc_mod):
                be = mod_q.get(c, ([], []))[0] + corpo_mod.get(c, ([], []))[0]
                fe = mod_q.get(c, ([], []))[1] + corpo_mod.get(c, ([], []))[1]
                voce(r, moduli[c].get("nome") or c, "=" + _somma(be), "=" + _somma(fe))
                if b == "Implementazione":
                    righe_moduli_impl.append(r)
                r += 1
        if b == "Implementazione":
            if "SEC" in fasi:                                   # stime create prima: sicurezza in percentuale sui moduli
                pendenti.append((r, fasi["SEC"]))
                r += 1
            for nome, cbe, cfe in voci_pos:
                voce(r, nome, "=" + R(cbe), "=" + R(cfe))
                r += 1
        if b == "Training":
            voce(r, "Training Backend", "=" + R(training_pos[0]), "=0")
            r += 1
            voce(r, "Training Frontend", "=0", "=" + R(training_pos[1]))
            r += 1
        if r == prima:
            voce(r, "—", "=0", "=0")
            r += 1
        totale_sezione(r, prima)
        sez_tot[b] = r
        if b == "Implementazione":
            impl_tot_row = r
        r += 1
    B_ref = SX(impl_tot_row, 3)
    celle["B"] = SX(impl_tot_row, 3)
    mod_be = _somma([AX(x, 5) for x in righe_moduli_impl])
    mod_fe = _somma([AX(x, 6) for x in righe_moduli_impl])
    mod_tot = f"({mod_be}+{mod_fe})"
    for rr, f in pendenti:
        gf = AX(rr, 10)
        if f["codice"] == "SEC":
            x = f"{mod_tot}*{SX(rr, 5)}"
            voce(rr, f.get("nome") or "Sicurezza", "=" + R(f"{x}*{AX(rr, 7)}"), "=" + R(f"{x}*{AX(rr, 8)}"),
                 pct=(_n(f.get("pct")), True), split=(f.get("pct_be"), f.get("pct_fe")))
        elif f.get("base") == "B":
            x = f"{B_ref}*{SX(rr, 5)}"
            e_ = f'=IF({gf}="",{R(f"{x}*{AX(rr, 7)}")},{R(f"{gf}*{AX(rr, 7)}")})'
            f_ = f'=IF({gf}="",{R(f"{x}*{AX(rr, 8)}")},{R(gf)}-{AX(rr, 5)})'
            voce(rr, f.get("nome") or f["codice"], e_, f_, pct=(_n(f.get("pct")), True), split=(f.get("pct_be"), f.get("pct_fe")),
                 fisse=(_n(f.get("gg_fissi")),))
        else:                                                   # Moduli_team: due righe, Back-end e Front-end
            nome = f.get("nome") or f["codice"]
            gf = AX(rr, 10)
            e_ = f'=IF({gf}="",{R(f"({mod_be})*{SX(rr, 5)}")},IF({mod_tot}=0,{R(f"{gf}*0.5")},{R(f"{gf}*({mod_be})/{mod_tot}")}))'
            voce(rr, f"{nome} Back-end", e_, "=0", pct=(_n(f.get("pct")), True), fisse=(_n(f.get("gg_fissi")), S.ref(rr + 1, 5)))
            f2 = f'=IF({gf}="",{R(f"({mod_fe})*{SX(rr + 1, 5)}")},{R(gf)}-{AX(rr, 5)})'
            voce(rr + 1, f"{nome} Front-end", "=0", f2, pct=(f"={S.ref(rr, 5)}", False))

    # Totale Progetto
    r_tp = r
    S.put(r_tp, 2, "Totale Progetto", stile="navy")
    S.put(r_tp, 3, "=" + "+".join(f"C{sez_tot[b]}" for b in sezioni), F_GG, stile="navy", sz=12)
    A.put(r_tp, 2, "Totale Progetto", stile="navy")
    A.put(r_tp, 3, f"={SX(r_tp, 3)}", F_GG, sz=12, center=True)
    A.put(r_tp, 5, "=" + "+".join(f"E{sez_tot[b]}" for b in sezioni), F_GG, sz=12, center=True)
    A.put(r_tp, 6, "=" + "+".join(f"F{sez_tot[b]}" for b in sezioni), F_GG, sz=12, center=True)
    A.put(r_tp, 9, f"=SUM(E{r_tp}:F{r_tp})-C{r_tp}", F_CHK, sz=11, center=True)
    celle["TP"] = SX(r_tp, 3)
    tp_be, tp_fe, tp = AX(r_tp, 5), AX(r_tp, 6), SX(r_tp, 3)

    # Project Manager e Contingency (percentuale o giornate fisse in Appoggio J)
    r_pm, r_co, r_tc = r_tp + 2, r_tp + 3, r_tp + 4
    fpm, fco = fasi.get("PM", {}), fasi.get("CONT", {})
    S.put(r_pm, 2, "Project Manager", stile="etich")
    A.put(r_pm, 2, "Project Manager", stile="etich")
    S.put(r_pm, 3, f'=IF({AX(r_pm, 10)}="",{R(f"C{r_tp}*E{r_pm}")},{R(AX(r_pm, 10))})', F_GG, sz=12, center=True)
    A.put(r_pm, 3, f"={SX(r_pm, 3)}", F_GG, sz=12, center=True)
    S.put(r_pm, 5, _n(fpm.get("pct")), F_PCT1, inp=True, center=True)
    A.put(r_pm, 10, _n(fpm.get("gg_fissi")), F_NUM, inp=True, center=True, sz=11)
    grigio_se_fisse.append((S.ref(r_pm, 5), AX(r_pm, 10)))
    nome_def("PctPM", S, r_pm, 5)
    celle["PM"] = SX(r_pm, 3)
    gco = AX(r_co, 10)
    e_co = f'=IF({gco}="",{R(f"{tp_be}*{SX(r_co, 5)}")},IF({tp}=0,{R(f"{gco}*0.5")},{R(f"{gco}*{tp_be}/{tp}")}))'
    f_co = f'=IF({gco}="",{R(f"{tp_fe}*{SX(r_co, 5)}")},{R(gco)}-{AX(r_co, 5)})'
    voce(r_co, "Contingency", e_co, f_co, pct=(_n(fco.get("pct")), True), fisse=(_n(fco.get("gg_fissi")),))
    nome_def("PctContingency", S, r_co, 5)
    celle["CONT"] = SX(r_co, 3)
    S.put(r_tc, 2, "Totale Progetto + Contingency", stile="tot")
    S.put(r_tc, 3, f"=C{r_tp}+C{r_pm}+C{r_co}", F_GG, stile="tot", sz=12)
    A.put(r_tc, 2, "Totale con contingency", stile="tot")
    A.put(r_tc, 3, f"={SX(r_tc, 3)}", F_GG, stile="tot", sz=12)
    A.put(r_tc, 5, f"=E{r_tp}+E{r_co}", F_GG, stile="tot", sz=12)
    A.put(r_tc, 6, f"=F{r_tp}+F{r_co}", F_GG, stile="tot", sz=12)
    A.put(r_tc, 9, f"=SUM(E{r_tc}:F{r_tc})+C{r_pm}-C{r_tc}", F_CHK, sz=11, center=True)
    celle["TOTALE"] = SX(r_tc, 3)
    celle["QUADRATURA"] = AX(r_tc, 9)
    gg_be, gg_fe, gg_pm, totale = AX(r_tc, 5), AX(r_tc, 6), SX(r_pm, 3), SX(r_tc, 3)

    # costi, margine, prezzo obiettivo
    costo = {t["codice"]: _n(t.get("costo")) for t in snap["team"]}
    r = r_tc + 2
    r_costi = r
    for i, (lab, cod) in enumerate((("Costo Risorse BE", "BE"), ("Costo Risorse FE", "FE"), ("Costo PM", "PM"))):
        S.put(r + i, 2, lab, stile="etich")
        S.put(r + i, 3, costo.get(cod), F_EUR, inp=True, sz=12, center=True)
        nome_def("Costo" + cod, S, r + i, 3)
    r += 3
    S.put(r, 2, "Costo totale", stile="tot")
    S.put(r, 3, f"={gg_be}*CostoBE+{gg_fe}*CostoFE+{gg_pm}*CostoPM", F_EUR, stile="tot", sz=12)
    r_costo = r
    celle["COSTO"] = SX(r_costo, 3)
    r += 2
    S.put(r, 2, "Margine", stile="etich", bold=True)
    S.put(r, 3, _n(g.get("margine_progetto")), F_PCT, inp=True, sz=12, center=True)
    nome_def("MargineProgetto", S, r, 3)
    r_marg = r
    r += 1
    S.put(r, 2, "Ricavi", stile="tot")
    S.put(r, 3, f'=IF(MargineProgetto>=1,"",C{r_costo}/(1-MargineProgetto))', F_EUR, stile="tot", sz=12)
    r_ricavi = r
    celle["PREZZO"] = SX(r_ricavi, 3)
    r += 2
    S.put(r, 2, "Prezzo obiettivo", stile="etich")
    S.put(r, 3, _n(stima.get("prezzo_obiettivo")), F_EUR, inp=True, sz=12, center=True)
    nome_def("PrezzoObiettivo", S, r, 3)
    r += 1
    S.put(r, 2, "Margine risultante", stile="etich")
    S.put(r, 3, f'=IF(PrezzoObiettivo="","",IF(PrezzoObiettivo>0,1-C{r_costo}/PrezzoObiettivo,""))', F_PCT1, sz=12, center=True)
    S.ws.conditional_formatting.add(f"C{r}", FormulaRule(formula=[f'IF(C{r}="",FALSE,C{r}<MargineProgetto)'],
                                                          font=Font(color=ROSSO_TESTO, bold=True)))
    celle["MARG_RIS"] = SX(r, 3)
    r += 1
    S.put(r, 2, "Scostamento", stile="etich")
    S.put(r, 3, f'=IF(PrezzoObiettivo="","",IF(C{r_ricavi}="","",PrezzoObiettivo-C{r_ricavi}))', F_EUR, sz=12, center=True)
    celle["SCOST"] = SX(r, 3)
    r += 2
    r_maint = r

    # ================================================================ Parametri: Servizio AM (ora che le righe di Stima sono note)
    r = r_am
    am_gg_team = None                                            # (giornate BE, giornate FE) dell'AM
    am_anni = []
    beq_ref = None
    if modo == "manuale":
        man = am_cfg.get("manuale") or {}
        P.unisci(r, 2, 5, "Servizio AM")
        for i, x in enumerate(["Processo", "GG/Mese", "Mesi", "gg/tot"]):
            P.put(r + 1, 2 + i, x, stile="testa")
        for k, (lab, t) in enumerate((("BackEnd", "BE"), ("Front-end", "FE"))):
            rr = r + 2 + k
            P.put(rr, 2, lab, stile="etich", bold=True)
            P.put(rr, 3, _n((man.get(t) or {}).get("gg_mese")), F_NUM, inp=True, center=True)
            P.put(rr, 4, _n((man.get(t) or {}).get("mesi")), F_NUM, inp=True, center=True)
            P.put(rr, 5, "=" + R(f"C{rr}*D{rr}"), F_GG, center=True)
        rt = r + 4
        P.put(rt, 2, "Totale", stile="tot")
        P.put(rt, 3, None, stile="tot"); P.put(rt, 4, None, stile="tot")
        P.put(rt, 5, f"=E{r + 2}+E{r + 3}", F_GG, stile="tot")
        am_gg_team = (f"{SHEET_P}!$E${r + 2}", f"{SHEET_P}!$E${r + 3}")
    elif modo == "driver":
        A_ = snap.get("am", {})
        coeff = A_.get("coeff") or {}
        presa = driver.get("presa")
        if presa is None:
            presa = fonte_es
        P.unisci(r, 2, 4, "Servizio AM")
        voci_am = [("Fonte del build equivalente", "Oggetti in esercizio" if fonte_es else "Progetto", None, None, False),
                   ("Livello di servizio (H8, H12, H24)", driver.get("servizio") or "H8", None, "AmServizio", True),
                   ("Coefficiente H8", _n(coeff.get("H8")), F_NUM, "CoeffH8", True),
                   ("Coefficiente H12", _n(coeff.get("H12")), F_NUM, "CoeffH12", True),
                   ("Coefficiente H24", _n(coeff.get("H24")), F_NUM, "CoeffH24", True),
                   ("% correttiva annua", _n(A_.get("pct_correttiva")), F_PCT, "PctCorrettiva", True),
                   ("Presa in carico (Sì/No)", "Sì" if presa else "No", None, "AmPresa", True),
                   ("% presa in carico (anno 1)", _n(A_.get("pct_presa")), F_PCT, "PctPresa", True),
                   ("Decalage annuo", _n(A_.get("decalage")), F_PCT, "Decalage", True),
                   (f"Anni (da 1 a {int(A_.get('anni_max') or 5)})", _n(driver.get("anni") or 1), F_NUM, "AmAnni", True),
                   ("Evolutiva (gg/anno)", _n(driver.get("evolutiva") or 0), F_NUM, "AmEvolutiva", True)]
        rr = r + 1
        for lab, val, fmt, nome, inp in voci_am:
            P.unisci(rr, 2, 3, lab, stile="etich")
            P.put(rr, 4, val, fmt, inp=inp, center=True)
            if nome:
                nome_def(nome, P, rr, 4)
            rr += 1
        P.unisci(rr, 2, 3, "Coefficiente di servizio", stile="etich")
        P.put(rr, 4, '=IF(AmServizio="H24",CoeffH24,IF(AmServizio="H12",CoeffH12,CoeffH8))', F_NUM, center=True)
        c_coeff = P.ref(rr, 4, True)
        rr += 1
        if fonte_es:
            beq_be = _somma([x for v in mod_es.values() for x in v[0]])
            beq_fe = _somma([x for v in mod_es.values() for x in v[1]])
        else:
            beq_be, beq_fe = AX(impl_tot_row, 5), AX(impl_tot_row, 6)
        for lab, form in (("Build equivalente BE", "=" + beq_be), ("Build equivalente FE", "=" + beq_fe)):
            P.unisci(rr, 2, 3, lab, stile="etich")
            P.put(rr, 4, form, F_GG, center=True)
            rr += 1
        P.unisci(rr, 2, 3, "Build equivalente", stile="tot")
        P.put(rr, 4, f"=D{rr - 2}+D{rr - 1}", F_GG, stile="tot")
        beq_ref = P.ref(rr, 4, True)
        beq_ext = P.ext(rr, 4)
        celle["AM_BEQ"] = beq_ext
        rr += 1
        P.unisci(rr, 2, 3, "Quota BE", stile="etich")
        P.put(rr, 4, f"=IF({beq_ref}=0,0,D{rr - 3}/{beq_ref})", F_PCT, center=True)
        qbe = P.ref(rr, 4, True)
        rr += 1
        P.unisci(rr, 2, 3, "Quota FE", stile="etich")
        P.put(rr, 4, f"=IF({beq_ref}=0,0,D{rr - 3}/{beq_ref})", F_PCT, center=True)
        qfe = P.ref(rr, 4, True)
        rr += 1
        P.put(rr, 2, f'=IF({beq_ref}=0,"AM non calcolabile: il build equivalente è zero","")', color=ROSSO_TESTO, bold=True, bordo=False)
        rr += 2
        # tabella per anno
        intest = ["Anno", "Correttiva BE", "Correttiva FE", "Evolutiva BE", "Evolutiva FE", "Presa in carico BE", "Presa in carico FE",
                  "Totale BE", "Totale FE", "Totale"]
        for i, x in enumerate(intest):
            P.put(rr, 2 + i, x, stile="testa")
        rr += 1
        anni_max = int(A_.get("anni_max") or 5)
        prima = rr
        for k in range(1, anni_max + 1):
            v = lambda expr, k=k: f'=IF(OR({k}>AmAnni,{beq_ref}=0),"",{expr})'
            base = f"{beq_ref}*PctCorrettiva*{c_coeff}*(1-Decalage)^{k - 1}"
            P.put(rr, 2, k, stile="etich", bold=True)
            P.put(rr, 3, v(R(f"{base}*{qbe}")), F_GG, center=True)
            P.put(rr, 4, v(R(f"{base}*{qfe}")), F_GG, center=True)
            P.put(rr, 5, v(R(f"AmEvolutiva*{qbe}")), F_GG, center=True)
            P.put(rr, 6, v(R(f"AmEvolutiva*{qfe}")), F_GG, center=True)
            pr = (lambda q: f'IF(AmPresa="Sì",{R(f"{beq_ref}*PctPresa*{q}")},0)') if k == 1 else (lambda q: "0")
            P.put(rr, 7, v(pr(qbe)), F_GG, center=True)
            P.put(rr, 8, v(pr(qfe)), F_GG, center=True)
            P.put(rr, 9, v(f"C{rr}+E{rr}+G{rr}"), F_GG, center=True)
            P.put(rr, 10, v(f"D{rr}+F{rr}+H{rr}"), F_GG, center=True)
            P.put(rr, 11, v(f"I{rr}+J{rr}"), F_GG, center=True)
            am_anni.append({"riga": rr, "gg": P.ext(rr, 11)})
            rr += 1
        P.put(rr, 2, "Totale", stile="tot")
        for c in range(3, 12):
            L = get_column_letter(c)
            P.put(rr, c, f"=SUM({L}{prima}:{L}{rr - 1})", F_GG, stile="tot")
        am_gg_team = (P.ext(rr, 9), P.ext(rr, 10))
        rr += 2
        # economia per anno
        for i, x in enumerate(["Anno", "Costo", "Ricavi", "Mensile", "FTE"]):
            P.put(rr, 2 + i, x, stile="testa")
        rr += 1
        prima_e = rr
        for k, a in enumerate(am_anni, start=1):
            ra = a["riga"]
            P.put(rr, 2, k, stile="etich", bold=True)
            P.put(rr, 3, f'=IF(K{ra}="","",I{ra}*CostoBE+J{ra}*CostoFE)', F_EUR, center=True)
            P.put(rr, 4, f'=IF(C{rr}="","",IF(MargineAM>=1,"",C{rr}/(1-MargineAM)))', F_EUR, center=True)
            P.put(rr, 5, f'=IF(D{rr}="","",D{rr}/12)', F_EUR, center=True)
            P.put(rr, 6, f'=IF(K{ra}="","",IF(GgMese=0,"",K{ra}/(12*GgMese)))', F_N2, center=True)
            a.update(costo=P.ext(rr, 3), prezzo=P.ext(rr, 4), mensile=P.ext(rr, 5), fte=P.ext(rr, 6))
            rr += 1
        P.put(rr, 2, "Totale", stile="tot")
        P.put(rr, 3, f"=SUM(C{prima_e}:C{rr - 1})", F_EUR, stile="tot")
        P.put(rr, 4, f"=SUM(D{prima_e}:D{rr - 1})", F_EUR, stile="tot")
        P.put(rr, 5, None, stile="tot"); P.put(rr, 6, None, stile="tot")
        am_costo_anni = P.ext(rr, 3)

    # ================================================================ Stima: Maintenance
    r = r_maint
    S.unisci(r, 2, 3, "Maintenance", sz=12)
    r += 1
    am_tot = None
    if modo in ("manuale", "driver"):
        if modo == "driver":
            prima = r
            for k, a in enumerate(am_anni, start=1):
                S.put(r, 2, f"Giornate anno {k}", stile="etich")
                S.put(r, 3, "=" + a["gg"], F_GG, sz=12, center=True)
                r += 1
            S.put(r, 2, "Giornate Stimate", stile="etich", bold=True)
            S.put(r, 3, f"=SUM(C{prima}:C{r - 1})", F_GG, sz=12, center=True, bold=True)
        else:
            S.put(r, 2, "Giornate Stimate", stile="etich")
            S.put(r, 3, f"={am_gg_team[0]}+{am_gg_team[1]}", F_GG, sz=12, center=True)
        r_amgg = r
        r += 1
        S.put(r, 2, "Costo totale", stile="tot")
        S.put(r, 3, f"={am_gg_team[0]}*CostoBE+{am_gg_team[1]}*CostoFE", F_EUR, stile="tot", sz=12)
        r_amc = r
        r += 1
    else:
        S.put(r, 2, "Nessuna AM prevista", stile="etich")
        S.put(r, 3, None)
        r += 1
    S.put(r, 2, "Margine AM", stile="etich")
    S.put(r, 3, _n(g.get("margine_am")), F_PCT, inp=True, sz=12, center=True)
    nome_def("MargineAM", S, r, 3)
    r_amm = r
    r += 1
    if modo in ("manuale", "driver"):
        S.put(r, 2, "Ricavi", stile="tot")
        cond = f"OR(MargineAM>=1,{beq_ext}=0)" if modo == "driver" else "MargineAM>=1"
        S.put(r, 3, f'=IF({cond},"",C{r_amc}/(1-MargineAM))', F_EUR, stile="tot", sz=12)
        r_amr = r
        am_tot = (SX(r_amgg, 3), SX(r_amc, 3), SX(r_amr, 3))
        celle["AM_GG"], celle["AM_COSTO"], celle["AM_PREZZO"] = am_tot
        for i, a in enumerate(am_anni, start=1):
            for k in ("gg", "costo", "prezzo", "mensile", "fte"):
                celle[f"AM_Y{i}_{k.upper()}"] = a[k]

    # ================================================================ Stima: pannelli a destra
    nb = len(sezioni)
    # Progetto · Peso %
    S.unisci(2, 8, 9, "Progetto", sz=12)
    S.put(2, 10, "Peso %", stile="navy", sz=12)
    for i, b in enumerate(sezioni):
        rr = 3 + i
        S.put(rr, 8, b, stile="etich", sz=12)
        S.put(rr, 9, f"=C{sez_tot[b]}", F_GG, sz=12, center=True)
        S.put(rr, 10, f'=IF($I${3 + nb}=0,"",I{rr}/$I${3 + nb})', F_PCT, sz=12, center=True)
        celle[f"BLK_{b}"] = SX(rr, 9)
        celle[f"PESO_{b}"] = SX(rr, 10)
    rt = 3 + nb
    S.put(rt, 8, "Totale", stile="navy", sz=12)
    S.put(rt, 9, f"=SUM(I3:I{rt - 1})", F_GG, stile="navy", sz=12)
    S.put(rt, 10, f'=IF(I{rt}=0,"",SUM(J3:J{rt - 1}))', F_PCT, stile="navy", sz=12)
    for k, (lab, src) in enumerate((("Project Manager", f"C{r_pm}"), ("Contingency", f"C{r_co}"))):
        rr = rt + 2 + k
        S.put(rr, 8, lab, stile="etich", sz=12)
        S.put(rr, 9, "=" + src, F_GG, sz=12, center=True)
        S.put(rr, 10, f'=IF($I${rt}=0,"",I{rr}/$I${rt})', F_PCT, sz=12, center=True)
    rtc = rt + 4
    S.put(rtc, 8, "Totale", stile="navy", sz=12)
    S.put(rtc, 9, f"=I{rt}+I{rt + 2}+I{rt + 3}", F_GG, stile="navy", sz=12)
    S.put(rtc, 10, None, stile="navy")
    # Progetto · Val x GG
    rv = rtc + 2
    S.unisci(rv, 8, 9, "Progetto", sz=12)
    S.put(rv, 10, "Val x GG", stile="navy", sz=12)
    S.put(rv + 1, 8, "Costo totale", stile="tot", sz=12)
    S.put(rv + 1, 9, f"=C{r_costo}", F_EUR, stile="tot", sz=12)
    S.put(rv + 1, 10, f'=IF(I{rtc}=0,"",I{rv + 1}/I{rtc})', F_EUR, sz=12, center=True)
    celle["COSTO_MEDIO"] = SX(rv + 1, 10)
    S.put(rv + 2, 8, "Margine", stile="etich", sz=12)
    S.put(rv + 2, 9, "=MargineProgetto", F_PCT, sz=12, center=True)
    S.put(rv + 2, 10, None)
    S.put(rv + 3, 8, "Ricavi", stile="tot", sz=12)
    S.put(rv + 3, 9, f"=C{r_ricavi}", F_EUR, stile="tot", sz=12)
    S.put(rv + 3, 10, f'=IF(OR(I{rtc}=0,I{rv + 3}=""),"",I{rv + 3}/I{rtc})', F_EUR, sz=12, center=True)
    celle["PREZZO_MEDIO"] = SX(rv + 3, 10)
    # Manutenzione · Val x GG
    rm = rv + 5
    S.unisci(rm, 8, 9, "Manutenzione", sz=12)
    S.put(rm, 10, "Val x GG", stile="navy", sz=12)
    if am_tot:
        righe_m = (("Giornate", "=" + am_tot[0], F_GG, None, None), ("Costo totale", "=" + am_tot[1], F_EUR, "tot", True),
                   ("Margine", "=MargineAM", F_PCT, None, None), ("Ricavi", "=" + am_tot[2], F_EUR, "tot", True))
        for k, (lab, form, fmt, st, vxg) in enumerate(righe_m):
            rr = rm + 1 + k
            S.put(rr, 8, lab, stile=st or "etich", sz=12)
            S.put(rr, 9, form, fmt, stile=st, sz=12, center=True)
            S.put(rr, 10, f'=IF(OR(I{rm + 1}=0,I{rr}=""),"",I{rr}/I{rm + 1})' if vxg else None, F_EUR, sz=12, center=True)
    else:
        S.put(rm + 1, 8, "Nessuna AM", stile="etich", sz=12)
        S.put(rm + 1, 9, None); S.put(rm + 1, 10, None)
    # Progetto · GG Backend · GG Frontend · GG PM
    for c, x in ((12, "Progetto"), (13, "GG Backend"), (14, "GG Frontend"), (15, "GG PM")):
        S.put(2, c, x, stile="navy", sz=12)
    for i, b in enumerate(sezioni):
        rr = 3 + i
        S.put(rr, 12, b, stile="etich", sz=12)
        S.put(rr, 13, f"={AX(sez_tot[b], 5)}", F_GG, sz=12, center=True)
        S.put(rr, 14, f"={AX(sez_tot[b], 6)}", F_GG, sz=12, center=True)
        S.put(rr, 15, None)
    S.put(rt, 12, "Totale", stile="navy", sz=12)
    for c in (13, 14):
        L = get_column_letter(c)
        S.put(rt, c, f"=SUM({L}3:{L}{rt - 1})", F_GG, stile="navy", sz=12)
    S.put(rt, 15, None, stile="navy")
    S.put(rt + 1, 12, "Contingency", stile="etich", sz=12)
    S.put(rt + 1, 13, f"={AX(r_co, 5)}", F_GG, sz=12, center=True)
    S.put(rt + 1, 14, f"={AX(r_co, 6)}", F_GG, sz=12, center=True)
    S.put(rt + 1, 15, None)
    S.put(rt + 2, 12, "Project Manager", stile="etich", sz=12)
    S.put(rt + 2, 13, None); S.put(rt + 2, 14, None)
    S.put(rt + 2, 15, f"=C{r_pm}", F_GG, sz=12, center=True)
    S.put(rt + 3, 12, "Totale", stile="navy", sz=12)
    for c in (13, 14, 15):
        L = get_column_letter(c)
        S.put(rt + 3, c, f"=SUM({L}{rt}:{L}{rt + 2})", F_GG, stile="navy", sz=12)
    S.put(rt + 4, 12, "Costo totale", stile="tot", sz=12)
    for c, nome, k in ((13, "CostoBE", "COSTO_BE"), (14, "CostoFE", "COSTO_FE"), (15, "CostoPM", "COSTO_PM")):
        L = get_column_letter(c)
        S.put(rt + 4, c, f"={L}{rt + 3}*{nome}", F_EUR, stile="tot", sz=12)
        celle[k] = SX(rt + 4, c)
    r_fte_base = rt + 3
    # Manutenzione · GG Backend · GG Frontend
    for c, x in ((12, "Manutenzione"), (13, "GG Backend"), (14, "GG Frontend")):
        S.put(rm, c, x, stile="navy", sz=12)
    S.put(rm + 1, 12, "Giornate", stile="etich", sz=12)
    S.put(rm + 2, 12, "Costo totale", stile="tot", sz=12)
    if am_gg_team:
        S.put(rm + 1, 13, "=" + am_gg_team[0], F_GG, sz=12, center=True)
        S.put(rm + 1, 14, "=" + am_gg_team[1], F_GG, sz=12, center=True)
        S.put(rm + 2, 13, f"=M{rm + 1}*CostoBE", F_EUR, stile="tot", sz=12)
        S.put(rm + 2, 14, f"=N{rm + 1}*CostoFE", F_EUR, stile="tot", sz=12)
    else:
        for c in (13, 14):
            S.put(rm + 1, c, None); S.put(rm + 2, c, None, stile="tot")
    # Tempi e FTE (sulle giornate con contingency)
    rf = rm + 5
    S.unisci(rf, 12, 15, "Tempi e FTE", sz=12)
    S.put(rf + 1, 12, "Durata (mesi)", stile="etich", sz=12)
    S.put(rf + 1, 13, _n(stima.get("durata_mesi")), F_NUM, inp=True, sz=12, center=True)
    nome_def("Durata", S, rf + 1, 13)
    S.put(rf + 2, 12, "Giornate al mese", stile="etich", sz=12)
    S.put(rf + 2, 13, "=GgMese", F_NUM, sz=12, center=True)
    fte = lambda gg: f'=IF(Durata="","",IF(Durata*GgMese<=0,"",{gg}/(Durata*GgMese)))'
    for k, (lab, gg, chiave) in enumerate((("FTE Backend", f"M{r_fte_base}", "FTE_BE"), ("FTE Frontend", f"N{r_fte_base}", "FTE_FE"),
                                           ("FTE PM", f"O{r_fte_base}", "FTE_PM"))):
        rr = rf + 3 + k
        S.put(rr, 12, lab, stile="etich", sz=12)
        S.put(rr, 13, fte(gg), F_N2, sz=12, center=True)
        celle[chiave] = SX(rr, 13)
    S.put(rf + 6, 12, "FTE totale", stile="tot", sz=12)
    S.put(rf + 6, 13, f'=IF(M{rf + 3}="","",M{rf + 3}+M{rf + 4}+M{rf + 5})', F_N2, stile="tot", sz=12)
    celle["FTE_TOT"] = SX(rf + 6, 13)

    # percentuale grigia e barrata quando la fase ha giornate fisse
    for cella, gf in grigio_se_fisse:
        S.ws.conditional_formatting.add(cella, FormulaRule(formula=[f'{gf}<>""'], font=Font(color=GRIGIO_TESTO, strike=True)))

    P.stampa()
    S.stampa(una_pagina=True)
    A.stampa(una_pagina=True)
    wb.active = 1
    for ws in wb.worksheets:
        ws.sheet_view.tabSelected = ws.title == SHEET_S
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue(), nome_file(stima, oggi), celle
