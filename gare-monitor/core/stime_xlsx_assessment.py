"""Stimometro: export Excel delle stime di tipo Assessment.

Un solo foglio, "Stima", con la grafica dell'export dei progetti (barre navy, intestazioni azzurre, totali grigi, griglia nascosta,
input in blu, formule vive) e la struttura del foglio originale: ID · Workstream · Attività · Deliverable / output ·
Giornate PM · Giornate BE · Giornate FE · Totale. Per ogni workstream un'intestazione, le attività e il Subtotale; le attività
accessorie; il Totale Progetto; la riga Contingency con i totali con contingency; costi, margine, ricavi, prezzo obiettivo;
tempi e FTE. Ogni giornata inserita si arrotonda con R(x) = ROUND(ROUND(x;9)/Passo;0)*Passo, come nel motore.
"""
import datetime as dt
import io

from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Font
from openpyxl.workbook.defined_name import DefinedName

from .stime_assessment import calcola_assessment
from .stime_xlsx import BLU, F_EUR, F_GG, F_N2, F_NUM, F_PCT, F_PCT1, GRIGIO_TESTO, ROSSO_TESTO, Foglio, R, _n

COL_T = {"PM": 5, "BE": 6, "FE": 7}


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
    S = Foglio(wb.active, {"A": 9, "B": 26, "C": 48, "D": 30, "E": 11, "F": 11, "G": 11, "H": 12, "I": 3, "J": 28, "K": 11})
    S.ws.title = "Stima"
    celle = {}
    SX = lambda r, c: f"Stima!{S.ref(r, c, True)}"

    def nome_def(nome, r, c):
        wb.defined_names[nome] = DefinedName(nome, attr_text=S.ext(r, c))

    def etichetta(r, testo, c2=4, stile="etich", bold=False):
        for c in range(1, c2 + 1):
            S.put(r, c, testo if c == 1 else None, stile=stile)
        if c2 > 1:
            S.ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=c2)
        cell = S.ws.cell(row=r, column=1)
        cell.alignment = Alignment(horizontal="left" if stile == "etich" else "center", vertical="center")
        if bold and stile == "etich":
            cell.font = Font(name="Calibri", size=10, bold=True)

    # intestazione e parametri generali
    gara = stima.get("gara") or {}
    info = [stima.get("nome") or "", stima.get("cliente") or ""]
    if gara:
        info.append(f"gara {gara.get('ss') or ''} · {gara.get('anno') or ''}".strip())
    info += [f"v{stima.get('versione') or 1}", f"esportato il {oggi.strftime('%d/%m/%Y')}"]
    S.put(1, 1, " · ".join(x for x in info if x), sz=8, color=GRIGIO_TESTO, bordo=False)
    S.unisci(2, 1, 8, "Stima Assessment", sz=12)
    for i, x in enumerate(["ID", "Workstream", "Attività", "Deliverable / output", "Giornate PM", "Giornate BE", "Giornate FE", "Totale"]):
        S.put(3, 1 + i, x, stile="testa")
    S.unisci(2, 10, 11, "Parametri generali")
    S.put(3, 10, "Arrotondamento (gg)", stile="etich")
    S.put(3, 11, _n(g.get("passo")), F_NUM, inp=True, center=True)
    nome_def("Passo", 3, 11)
    S.put(4, 10, "Giornate lavorative al mese", stile="etich")
    S.put(4, 11, _n(g.get("gg_mese")), F_NUM, inp=True, center=True)
    nome_def("GgMese", 4, 11)
    S.put(6, 10, "Testo blu = valore modificabile", color=BLU, bordo=False)
    S.put(7, 10, "Tutto il resto si ricalcola", color=GRIGIO_TESTO, bordo=False)

    def riga_attivita(r, id_, ws_nome, testo, deliverable, x):
        for c, v in ((1, id_), (2, ws_nome)):
            S.put(r, c, v, stile="etich").alignment = Alignment(wrap_text=True, vertical="top")
        for c, v in ((3, testo), (4, deliverable)):
            cell = S.put(r, c, v)
            cell.alignment = Alignment(wrap_text=True, vertical="top")
        for t, c in COL_T.items():
            S.put(r, c, _n(x.get("gg_" + t.lower())) or 0, F_GG, inp=True, center=True)
        S.put(r, 8, "=" + "+".join(R(S.ref(r, c)) for c in COL_T.values()), F_GG, center=True, bold=True)

    def subtotale(r, righe, etich="Subtotale"):
        etichetta(r, etich, 4, stile="tot")
        for c in list(COL_T.values()):
            S.put(r, c, "=" + ("+".join(R(S.ref(x, c)) for x in righe) if righe else "0"), F_GG, stile="tot")
        S.put(r, 8, f"=E{r}+F{r}+G{r}", F_GG, stile="tot")

    r = 4
    subtot = []
    for i, w in enumerate(stima.get("workstream") or []):
        nome = w.get("nome") or w.get("codice") or ""
        S.put(r, 1, w.get("codice") or "", stile="testa")
        for c in range(2, 9):
            S.put(r, c, nome if c == 2 else None, stile="testa")
        S.ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=8)
        S.ws.cell(row=r, column=2).alignment = Alignment(horizontal="left", vertical="center")
        r += 1
        prima = r
        for x in w.get("attivita") or []:
            riga_attivita(r, x.get("id") or "", nome, x.get("attivita") or "", x.get("deliverable") or "", x)
            r += 1
        subtotale(r, list(range(prima, r)))
        subtot.append(r)
        for t, c in (*COL_T.items(), ("TOT", 8)):
            celle[f"WS{i}_{t}"] = SX(r, c)
        r += 1
    voci = stima.get("voci_corpo") or []
    if voci:
        S.put(r, 1, "", stile="testa")
        for c in range(2, 9):
            S.put(r, c, "Attività accessorie" if c == 2 else None, stile="testa")
        S.ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=8)
        S.ws.cell(row=r, column=2).alignment = Alignment(horizontal="left", vertical="center")
        r += 1
        prima = r
        for v in voci:
            riga_attivita(r, "", "Attività accessorie", v.get("nome") or "", "", v)
            r += 1
        subtotale(r, list(range(prima, r)))
        subtot.append(r)
        celle["ACC_TOT"] = SX(r, 8)
        r += 1
    # Totale Progetto
    r_tot = r
    etichetta(r_tot, "Totale Progetto", 4, stile="navy")
    for c in (*COL_T.values(), 8):
        L = "ABCDEFGH"[c - 1]
        S.put(r_tot, c, "=" + ("+".join(f"{L}{x}" for x in subtot) if subtot else "0"), F_GG, stile="navy")
    for t, c in (*COL_T.items(), ("TOT", 8)):
        celle[f"TOT_{t}"] = SX(r_tot, c)
    # Contingency: la percentuale è un input, le celle sono i totali con contingency per team
    r_c = r_tot + 1
    etichetta(r_c, "Contingency", 2, stile="etich", bold=True)
    S.put(r_c, 3, _n(a.get("contingency")), F_PCT, inp=True, center=True)
    nome_def("PctContingency", r_c, 3)
    S.put(r_c, 4, "Totale con contingency", stile="etich")
    for t, c in COL_T.items():
        L = "ABCDEFGH"[c - 1]
        S.put(r_c, c, f"={L}{r_tot}+{R(f'{L}{r_tot}*PctContingency')}", F_GG, center=True, bold=True)
        celle[f"TC_{t}"] = SX(r_c, c)
    S.put(r_c, 8, f"=E{r_c}+F{r_c}+G{r_c}", F_GG, center=True, bold=True)
    celle["TC_TOT"] = SX(r_c, 8)
    # costi
    r = r_c + 2
    r_cu = r
    etichetta(r, "Costo Unitario")
    for (t, c), k in zip(COL_T.items(), ("costo_pm", "costo_be", "costo_fe")):
        S.put(r, c, _n(a.get(k)), F_EUR, inp=True, center=True)
        nome_def("Costo" + t, r, c)
    S.put(r, 8, None)
    r += 1
    r_ct = r
    etichetta(r, "Costi totale", stile="tot")
    for t, c in COL_T.items():
        L = "ABCDEFGH"[c - 1]
        S.put(r, c, f"={L}{r_c}*{L}{r_cu}", F_EUR, stile="tot")
        celle[f"COSTO_{t}"] = SX(r, c)
    S.put(r, 8, f"=E{r}+F{r}+G{r}", F_EUR, stile="tot")
    celle["COSTO"] = SX(r, 8)
    r += 1
    etichetta(r, "Margine", bold=True)
    S.put(r, 8, _n(a.get("margine")), F_PCT, inp=True, center=True)
    nome_def("MargineProgetto", r, 8)
    r += 1
    r_ric = r
    etichetta(r, "Ricavi", stile="tot")
    S.put(r, 8, f'=IF(MargineProgetto>=1,"",H{r_ct}/(1-MargineProgetto))', F_EUR, stile="tot")
    celle["PREZZO"] = SX(r, 8)
    r += 1
    etichetta(r, "Prezzo obiettivo")
    S.put(r, 8, _n(stima.get("prezzo_obiettivo")), F_EUR, inp=True, center=True)
    nome_def("PrezzoObiettivo", r, 8)
    r += 1
    etichetta(r, "Margine risultante")
    S.put(r, 8, f'=IF(PrezzoObiettivo="","",IF(PrezzoObiettivo>0,1-H{r_ct}/PrezzoObiettivo,""))', F_PCT1, center=True)
    S.ws.conditional_formatting.add(f"H{r}", FormulaRule(formula=[f'IF(H{r}="",FALSE,H{r}<MargineProgetto)'], font=Font(color=ROSSO_TESTO, bold=True)))
    celle["MARG_RIS"] = SX(r, 8)
    r += 1
    etichetta(r, "Scostamento")
    S.put(r, 8, f'=IF(PrezzoObiettivo="","",IF(H{r_ric}="","",PrezzoObiettivo-H{r_ric}))', F_EUR, center=True)
    celle["SCOST"] = SX(r, 8)
    r += 1
    etichetta(r, "Costo medio al giorno")
    S.put(r, 8, f'=IF(H{r_c}=0,"",H{r_ct}/H{r_c})', F_EUR, center=True)
    celle["COSTO_MEDIO"] = SX(r, 8)
    r += 1
    etichetta(r, "Prezzo medio al giorno")
    S.put(r, 8, f'=IF(OR(H{r_c}=0,H{r_ric}=""),"",H{r_ric}/H{r_c})', F_EUR, center=True)
    celle["PREZZO_MEDIO"] = SX(r, 8)
    # tempi e FTE
    r += 2
    S.unisci(r, 1, 8, "Tempi")
    r += 1
    etichetta(r, "Stima mesi progetto")
    S.put(r, 8, _n(stima.get("durata_mesi")), F_NUM, inp=True, center=True)
    nome_def("Durata", r, 8)
    r += 1
    etichetta(r, "Giornate di lavoro al mese")
    S.put(r, 8, "=GgMese", F_NUM, center=True)
    r += 1
    etichetta(r, "FTE", stile="tot")
    for t, c in COL_T.items():
        L = "ABCDEFGH"[c - 1]
        S.put(r, c, f'=IF(Durata="","",IF(Durata*GgMese<=0,"",{L}{r_c}/(Durata*GgMese)))', F_N2, stile="tot")
        celle[f"FTE_{t}"] = SX(r, c)
    S.put(r, 8, f'=IF(E{r}="","",E{r}+F{r}+G{r})', F_N2, stile="tot")
    celle["FTE_TOT"] = SX(r, 8)

    S.ws.freeze_panes = "A4"
    S.stampa()
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue(), nome_file, celle
