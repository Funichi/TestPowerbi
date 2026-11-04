"""Stimometro: export Excel delle stime di tipo Assessment.

Un solo foglio, "Stima", con la grafica dell'export dei progetti (barre navy, intestazioni azzurre, totali grigi, griglia nascosta,
input in blu, formule vive) e la struttura del foglio originale: ID · Workstream · Attività · Giornate PM · Giornate BE ·
Giornate FE · Totale. L'ID è quello dell'app, per posizione: workstream N → attività N.1, N.2… Per ogni workstream
un'intestazione, le attività e il Subtotale; le attività accessorie; il Totale Progetto; la riga Contingency con i totali con
contingency; costi, margine, ricavi, prezzo obiettivo; tempi e FTE. Ogni giornata inserita si arrotonda con
R(x) = ROUND(ROUND(x;9)/Passo;0)*Passo, come nel motore.
"""
import datetime as dt
import io

from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Font
from openpyxl.workbook.defined_name import DefinedName

from .stime_assessment import calcola_assessment
from .stime_xlsx import BLU, F_EUR, F_GG, F_N2, F_NUM, F_PCT, F_PCT1, GRIGIO_TESTO, ROSSO_TESTO, Foglio, R, _n

COL_T = {"PM": 4, "BE": 5, "FE": 6}           # D, E, F
C_TOT = 7                                     # G
C_ETI = 3                                     # le etichette di totali e costi occupano A:C
L = lambda c: "ABCDEFGHIJ"[c - 1]
C_PAR = 9                                     # riquadro dei parametri generali: I (etichetta), J (valore)


def esporta_assessment(stima, nome_file, oggi=None):
    res = calcola_assessment(stima)
    if res["export_bloccato"]:
        errori = [m["testo"] for m in res["messaggi"] if m["livello"] == "errore"]
        raise ValueError("Export bloccato: correggi prima gli errori della stima (" + "; ".join(dict.fromkeys(errori)) + ")")
    oggi = oggi or dt.date.today()
    snap = stima.get("snapshot") or {}
    g, a = snap.get("generali", {}), snap.get("assessment", {})
    wb = Workbook()
    wb.calculation.fullCalcOnLoad = True
    S = Foglio(wb.active, {"A": 7, "B": 30, "C": 62, "D": 11, "E": 11, "F": 11, "G": 12, "H": 3, "I": 28, "J": 11})
    S.ws.title = "Stima"
    celle = {}
    SX = lambda r, c: f"Stima!{S.ref(r, c, True)}"
    somma_team = lambda r: f"={L(4)}{r}+{L(5)}{r}+{L(6)}{r}"

    def nome_def(nome, r, c):
        wb.defined_names[nome] = DefinedName(nome, attr_text=S.ext(r, c))

    def etichetta(r, testo, c2=C_ETI, stile="etich", bold=False):
        for c in range(1, c2 + 1):
            S.put(r, c, testo if c == 1 else None, stile=stile)
        if c2 > 1:
            S.ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=c2)
        cell = S.ws.cell(row=r, column=1)
        cell.alignment = Alignment(horizontal="left" if stile == "etich" else "center", vertical="center")
        if bold and stile == "etich":
            cell.font = Font(name="Calibri", size=10, bold=True)

    def intestazione_gruppo(r, codice, nome):
        S.put(r, 1, codice, stile="testa")
        for c in range(2, C_TOT + 1):
            S.put(r, c, nome if c == 2 else None, stile="testa")
        S.ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=C_TOT)
        S.ws.cell(row=r, column=2).alignment = Alignment(horizontal="left", vertical="center")

    # intestazione e parametri generali
    gara = stima.get("gara") or {}
    info = [stima.get("nome") or "", stima.get("cliente") or ""]
    if gara:
        info.append(f"gara {gara.get('ss') or ''} · {gara.get('anno') or ''}".strip())
    info += [f"v{stima.get('versione') or 1}", f"esportato il {oggi.strftime('%d/%m/%Y')}"]
    S.put(1, 1, " · ".join(x for x in info if x), sz=8, color=GRIGIO_TESTO, bordo=False)
    S.unisci(2, 1, C_TOT, "Stima Assessment", sz=12)
    for i, x in enumerate(["ID", "Workstream", "Attività", "Giornate PM", "Giornate BE", "Giornate FE", "Totale"]):
        S.put(3, 1 + i, x, stile="testa")
    S.unisci(2, C_PAR, C_PAR + 1, "Parametri generali")
    S.put(3, C_PAR, "Arrotondamento (gg)", stile="etich")
    S.put(3, C_PAR + 1, _n(g.get("passo")), F_NUM, inp=True, center=True)
    nome_def("Passo", 3, C_PAR + 1)
    S.put(4, C_PAR, "Giornate lavorative al mese", stile="etich")
    S.put(4, C_PAR + 1, _n(g.get("gg_mese")), F_NUM, inp=True, center=True)
    nome_def("GgMese", 4, C_PAR + 1)
    S.put(6, C_PAR, "Testo blu = valore modificabile", color=BLU, bordo=False)
    S.put(7, C_PAR, "Tutto il resto si ricalcola", color=GRIGIO_TESTO, bordo=False)

    def riga_attivita(r, id_, ws_nome, testo, x):
        for c, v in ((1, id_), (2, ws_nome)):
            S.put(r, c, v, stile="etich").alignment = Alignment(wrap_text=True, vertical="top")
        S.put(r, 3, testo).alignment = Alignment(wrap_text=True, vertical="top")
        for t, c in COL_T.items():
            S.put(r, c, _n(x.get("gg_" + t.lower())) or 0, F_GG, inp=True, center=True)
        S.put(r, C_TOT, "=" + "+".join(R(S.ref(r, c)) for c in COL_T.values()), F_GG, center=True, bold=True)

    def subtotale(r, righe, etich="Subtotale"):
        etichetta(r, etich, C_ETI, stile="tot")
        for c in COL_T.values():
            S.put(r, c, "=" + ("+".join(R(S.ref(x, c)) for x in righe) if righe else "0"), F_GG, stile="tot")
        S.put(r, C_TOT, somma_team(r), F_GG, stile="tot")

    r = 4
    subtot = []
    for i, w in enumerate(stima.get("workstream") or []):
        nome = w.get("nome") or w.get("codice") or ""
        intestazione_gruppo(r, w.get("codice") or "", nome)
        r += 1
        prima = r
        for j, x in enumerate(w.get("attivita") or []):
            riga_attivita(r, f"{i}.{j + 1}", nome, x.get("attivita") or "", x)
            r += 1
        subtotale(r, list(range(prima, r)))
        subtot.append(r)
        for t, c in (*COL_T.items(), ("TOT", C_TOT)):
            celle[f"WS{i}_{t}"] = SX(r, c)
        r += 1
    voci = stima.get("voci_corpo") or []
    if voci:
        intestazione_gruppo(r, "", "Attività accessorie")
        r += 1
        prima = r
        for v in voci:
            riga_attivita(r, "", "Attività accessorie", v.get("nome") or "", v)
            r += 1
        subtotale(r, list(range(prima, r)))
        subtot.append(r)
        celle["ACC_TOT"] = SX(r, C_TOT)
        r += 1
    # Totale Progetto
    r_tot = r
    etichetta(r_tot, "Totale Progetto", C_ETI, stile="navy")
    for c in (*COL_T.values(), C_TOT):
        S.put(r_tot, c, "=" + ("+".join(f"{L(c)}{x}" for x in subtot) if subtot else "0"), F_GG, stile="navy")
    for t, c in (*COL_T.items(), ("TOT", C_TOT)):
        celle[f"TOT_{t}"] = SX(r_tot, c)
    # Contingency: la percentuale è un input, le celle sono i totali con contingency per team
    r_c = r_tot + 1
    S.put(r_c, 1, "Contingency", stile="etich", bold=True)
    S.put(r_c, 2, _n(a.get("contingency")), F_PCT, inp=True, center=True)
    nome_def("PctContingency", r_c, 2)
    S.put(r_c, 3, "Totale con contingency", stile="etich")
    for t, c in COL_T.items():
        S.put(r_c, c, f"={L(c)}{r_tot}+{R(f'{L(c)}{r_tot}*PctContingency')}", F_GG, center=True, bold=True)
        celle[f"TC_{t}"] = SX(r_c, c)
    S.put(r_c, C_TOT, somma_team(r_c), F_GG, center=True, bold=True)
    celle["TC_TOT"] = SX(r_c, C_TOT)
    T = L(C_TOT)
    # costi
    r = r_c + 2
    r_cu = r
    etichetta(r, "Costo Unitario")
    for (t, c), k in zip(COL_T.items(), ("costo_pm", "costo_be", "costo_fe")):
        S.put(r, c, _n(a.get(k)), F_EUR, inp=True, center=True)
        nome_def("Costo" + t, r, c)
    S.put(r, C_TOT, None)
    r += 1
    r_ct = r
    etichetta(r, "Costi totale", stile="tot")
    for t, c in COL_T.items():
        S.put(r, c, f"={L(c)}{r_c}*{L(c)}{r_cu}", F_EUR, stile="tot")
        celle[f"COSTO_{t}"] = SX(r, c)
    S.put(r, C_TOT, somma_team(r), F_EUR, stile="tot")
    celle["COSTO"] = SX(r, C_TOT)
    r += 1
    etichetta(r, "Margine", bold=True)
    S.put(r, C_TOT, _n(a.get("margine")), F_PCT, inp=True, center=True)
    nome_def("MargineProgetto", r, C_TOT)
    r += 1
    r_ric = r
    etichetta(r, "Ricavi", stile="tot")
    S.put(r, C_TOT, f'=IF(MargineProgetto>=1,"",{T}{r_ct}/(1-MargineProgetto))', F_EUR, stile="tot")
    celle["PREZZO"] = SX(r, C_TOT)
    r += 1
    etichetta(r, "Prezzo obiettivo")
    S.put(r, C_TOT, _n(stima.get("prezzo_obiettivo")), F_EUR, inp=True, center=True)
    nome_def("PrezzoObiettivo", r, C_TOT)
    r += 1
    etichetta(r, "Margine risultante")
    S.put(r, C_TOT, f'=IF(PrezzoObiettivo="","",IF(PrezzoObiettivo>0,1-{T}{r_ct}/PrezzoObiettivo,""))', F_PCT1, center=True)
    S.ws.conditional_formatting.add(f"{T}{r}", FormulaRule(formula=[f'IF({T}{r}="",FALSE,{T}{r}<MargineProgetto)'], font=Font(color=ROSSO_TESTO, bold=True)))
    celle["MARG_RIS"] = SX(r, C_TOT)
    r += 1
    etichetta(r, "Scostamento")
    S.put(r, C_TOT, f'=IF(PrezzoObiettivo="","",IF({T}{r_ric}="","",PrezzoObiettivo-{T}{r_ric}))', F_EUR, center=True)
    celle["SCOST"] = SX(r, C_TOT)
    r += 1
    etichetta(r, "Costo medio al giorno")
    S.put(r, C_TOT, f'=IF({T}{r_c}=0,"",{T}{r_ct}/{T}{r_c})', F_EUR, center=True)
    celle["COSTO_MEDIO"] = SX(r, C_TOT)
    r += 1
    etichetta(r, "Prezzo medio al giorno")
    S.put(r, C_TOT, f'=IF(OR({T}{r_c}=0,{T}{r_ric}=""),"",{T}{r_ric}/{T}{r_c})', F_EUR, center=True)
    celle["PREZZO_MEDIO"] = SX(r, C_TOT)
    # tempi e FTE
    r += 2
    S.unisci(r, 1, C_TOT, "Tempi")
    r += 1
    etichetta(r, "Stima mesi progetto")
    S.put(r, C_TOT, _n(stima.get("durata_mesi")), F_NUM, inp=True, center=True)
    nome_def("Durata", r, C_TOT)
    r += 1
    etichetta(r, "Giornate di lavoro al mese")
    S.put(r, C_TOT, "=GgMese", F_NUM, center=True)
    r += 1
    etichetta(r, "FTE", stile="tot")
    for t, c in COL_T.items():
        S.put(r, c, f'=IF(Durata="","",IF(Durata*GgMese<=0,"",{L(c)}{r_c}/(Durata*GgMese)))', F_N2, stile="tot")
        celle[f"FTE_{t}"] = SX(r, c)
    S.put(r, C_TOT, f'=IF({L(4)}{r}="","",{L(4)}{r}+{L(5)}{r}+{L(6)}{r})', F_N2, stile="tot")
    celle["FTE_TOT"] = SX(r, C_TOT)

    S.ws.freeze_panes = "A4"
    S.stampa()
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue(), nome_file, celle
