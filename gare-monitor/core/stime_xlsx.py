"""Stimometro: export Excel con formule vive (specifica §8, con le regole concordate: analisi e disegno a percentuale unica).

Cinque fogli: Riepilogo, Parametri, Stima, Ripartizione BE-FE, AM. Ogni valore calcolato è una formula che implementa le
stesse regole del motore (stime_motore.py), arrotondamenti compresi: R(x) = ROUND(ROUND(x;9)/Passo;0)*Passo. Gli input stanno nel
foglio Parametri, nelle colonne di input del foglio Stima (quantità, mix modificati, giornate a corpo, attività a corpo, training)
e nelle quantità degli oggetti in esercizio del foglio AM: cambiandoli, tutto si ricalcola. Funzioni usate: SUM, ROUND, IF, MAX.
Nessun collegamento esterno, nessuna macro. Il file è a senso unico: le modifiche fatte nell'Excel non tornano nell'app.
"""
import datetime as dt
import io
import re

from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.workbook.defined_name import DefinedName

from .stime_catalogo import BLOCCHI
from .stime_motore import calcola

F_GG, F_EUR, F_EUR2, F_PCT, F_FTE, F_NUM = "0.0", '#,##0 "€"', '#,##0.00 "€"', "0.0%", "0.00", "0.####"
FONT = Font(name="Arial", size=10)
GRASSETTO = Font(name="Arial", size=10, bold=True)
TITOLO = Font(name="Arial", size=14, bold=True)
INPUT_FONT = Font(name="Arial", size=10, color="0000FF")
INPUT_FILL = PatternFill("solid", fgColor="FFF2CC")
TESTA_FILL = PatternFill("solid", fgColor="E8D3E0")
GRUPPO_FILL = PatternFill("solid", fgColor="F2F2F2")
ROSSO = Font(name="Arial", size=10, bold=True, color="C00000")
SOTTILE = Border(bottom=Side(style="thin", color="BFBFBF"))


def R(expr):
    """Arrotondamento a mezza giornata come nel motore (§4.1), con la normalizzazione a 9 decimali."""
    return f"ROUND(ROUND({expr},9)/Passo,0)*Passo"


def _n(x):
    return None if x is None or x == "" else float(x)


class Foglio:
    def __init__(self, ws, larghezze):
        self.ws = ws
        for i, w in enumerate(larghezze, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w

    def ref(self, r, c, assoluto=True):
        col = get_column_letter(c)
        return f"${col}${r}" if assoluto else f"{col}{r}"

    def ext(self, r, c):
        """Riferimento dall'esterno del foglio: 'Nome foglio'!$C$5."""
        return f"'{self.ws.title}'!{self.ref(r, c)}"

    def put(self, r, c, v, fmt=None, inp=False, bold=False, fill=None, font=None, wrap=False):
        cell = self.ws.cell(row=r, column=c, value=("=" + v[1:] if isinstance(v, str) and v.startswith("=") else v))
        cell.font = font or (INPUT_FONT if inp else GRASSETTO if bold else FONT)
        if inp:
            cell.fill = INPUT_FILL
        elif fill:
            cell.fill = fill
        if fmt:
            cell.number_format = fmt
        if wrap:
            cell.alignment = Alignment(wrap_text=True, vertical="top")
        return cell

    def testa(self, r, etichette, c0=1):
        for i, t in enumerate(etichette):
            cell = self.put(r, c0 + i, t, bold=True, fill=TESTA_FILL)
            cell.alignment = Alignment(horizontal="center" if i else "left", vertical="center", wrap_text=True)

    def stampa(self, freeze=None):
        ws = self.ws
        ws.page_setup.orientation = "landscape"
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        if freeze:
            ws.freeze_panes = freeze


def nome_file(stima, oggi=None):
    pulisci = lambda s: re.sub(r"[^A-Za-z0-9]+", "_", str(s or "").strip()).strip("_")[:40] or "senza_nome"
    return f"Stima_{pulisci(stima.get('cliente'))}_{pulisci(stima.get('nome'))}_v{stima.get('versione') or 1}_{(oggi or dt.date.today()).isoformat()}.xlsx"


def esporta(stima, oggi=None):
    """Excel della stima: (bytes, nome file, celle chiave {nome: "'Foglio'!$C$5"} per i test). Solleva ValueError se ci sono errori."""
    res = calcola(stima)
    if res["export_bloccato"]:
        errori = [m["testo"] for m in res["messaggi"] if m["livello"] == "errore"]
        raise ValueError("Export bloccato: correggi prima gli errori della stima (" + "; ".join(dict.fromkeys(errori)) + ")")
    snap = stima["snapshot"]
    wb = Workbook()
    wb.calculation.fullCalcOnLoad = True
    w_riep = wb.active
    w_riep.title = "Riepilogo"
    fogli = {"Riepilogo": Foglio(w_riep, [34, 14, 14, 14, 12, 4, 30, 18])}
    for nome, larg in (("Parametri", [16, 34, 18, 22, 10, 10, 10, 10, 10, 10, 10, 10, 11, 11]),
                       ("Stima", [24, 28, 22, 10, 8, 8, 8, 9, 9, 9, 8, 8, 8, 11, 8, 10, 10, 10, 10, 10]),
                       ("Ripartizione BE-FE", [30, 12, 12, 12, 13]), ("AM", [26, 28, 18, 11, 11, 11, 11, 11, 11, 11, 11, 13, 13, 13, 9])):
        fogli[nome] = Foglio(wb.create_sheet(nome), larg)
    celle = {}
    nomi = {}

    def nome_def(nome, foglio, r, c):
        wb.defined_names[nome] = DefinedName(nome, attr_text=foglio.ext(r, c))
        nomi[nome] = foglio.ext(r, c)

    # ================================================================ Parametri
    P = fogli["Parametri"]
    P.put(1, 1, "Parametri della stima", font=TITOLO)
    P.put(2, 1, "", inp=True)
    P.put(2, 2, "Celle di input: si possono modificare, tutto il resto si ricalcola")
    P.put(3, 1, "")
    P.put(3, 2, "Celle senza colore: valori calcolati o descrittivi")
    r = 5
    P.put(r, 1, "Figure e costi giornalieri", bold=True)
    r += 1
    P.testa(r, ["Codice", "Figura", "€/gg"])
    for t in snap["team"]:
        r += 1
        P.put(r, 1, t["codice"])
        P.put(r, 2, t.get("nome"))
        P.put(r, 3, _n(t.get("costo")), F_EUR2, inp=True)
        nome_def("Costo" + t["codice"], P, r, 3)
    g = snap["generali"]
    r += 2
    P.put(r, 1, "Parametri generali", bold=True)
    for etich, nome, val, fmt in (("Margine del progetto", "MargineProgetto", g.get("margine_progetto"), F_PCT),
                                  ("Margine dell'AM", "MargineAM", g.get("margine_am"), F_PCT),
                                  ("Giornate lavorative al mese", "GgMese", g.get("gg_mese"), F_NUM),
                                  ("Passo di arrotondamento (gg)", "Passo", g.get("passo"), F_NUM),
                                  ("Durata del progetto (mesi)", "Durata", stima.get("durata_mesi"), F_NUM),
                                  ("Prezzo obiettivo", "PrezzoObiettivo", stima.get("prezzo_obiettivo"), F_EUR2)):
        r += 1
        P.put(r, 2, etich)
        P.put(r, 3, _n(val), fmt, inp=True)
        nome_def(nome, P, r, 3)
    # fasi
    r += 2
    P.put(r, 1, "Fasi, PM e contingency", bold=True)
    r += 1
    P.testa(r, ["Codice", "Fase", "Blocco", "Calcolata su", "%", "% BE", "% FE"])
    basi = {"Moduli_team": "Implementazione dei moduli (per team)", "B": "Implementazione (B)", "BaseModuli": "Somma dei moduli", "TP": "Totale progetto", "TP_team": "Totale progetto (per team)"}
    fase_pos = {}
    for f in snap["fasi"]:
        r += 1
        P.put(r, 1, f["codice"])
        P.put(r, 2, f.get("nome"))
        P.put(r, 3, f.get("blocco") or "—")
        P.put(r, 4, basi.get(f.get("base"), f.get("base")))
        P.put(r, 5, _n(f.get("pct")), F_PCT, inp=True)
        if f.get("pct_be") is not None:
            P.put(r, 6, _n(f.get("pct_be")), F_PCT, inp=True)
            P.put(r, 7, _n(f.get("pct_fe")), F_PCT, inp=True)
        fase_pos[f["codice"]] = {"pct": P.ext(r, 5), "be": P.ext(r, 6), "fe": P.ext(r, 7)}
        if f["codice"] == "PM":
            nome_def("PctPM", P, r, 5)
        if f["codice"] == "CONT":
            nome_def("PctContingency", P, r, 5)
    # moduli e tipi oggetto usati dalla stima (progetto e oggetti in esercizio)
    righe_valide = [x for x in stima.get("righe") or [] if x.get("tipo") in {t["codice"] for t in snap["tipi"]}]
    tipi_usati = list(dict.fromkeys(x["tipo"] for x in righe_valide))
    tipi = {t["codice"]: t for t in snap["tipi"]}
    moduli_usati = [m for m in snap["moduli"] if any(tipi[c]["modulo"] == m["codice"] for c in tipi_usati)]
    r += 2
    P.put(r, 1, "Moduli usati nella stima", bold=True)
    r += 1
    P.testa(r, ["Codice", "Modulo", "Blocco"])
    for m in moduli_usati:
        r += 1
        P.put(r, 1, m["codice"]); P.put(r, 2, m.get("nome")); P.put(r, 3, m.get("blocco"))
    r += 2
    P.put(r, 1, "Tipi oggetto usati nella stima", bold=True)
    r += 1
    P.testa(r, ["Codice", "Tipo oggetto", "Modulo", "Modalità", "Mix S", "Mix M", "Mix D", "gg S", "gg M", "gg D", "% BE", "% FE", "BE a corpo", "FE a corpo"])
    tipo_pos = {}
    for c in [t["codice"] for t in snap["tipi"] if t["codice"] in tipi_usati]:
        t = tipi[c]
        r += 1
        P.put(r, 1, c); P.put(r, 2, t.get("nome")); P.put(r, 3, t.get("modulo")); P.put(r, 4, "a quantità" if t["modalita"] == "quantita" else "a corpo")
        if t["modalita"] == "quantita":
            for i in range(3):
                P.put(r, 5 + i, _n(t["mix"][i]), F_PCT, inp=True)
                P.put(r, 8 + i, _n(t["gg"][i]), F_NUM, inp=True)
            P.put(r, 11, _n(t.get("pct_be")), F_PCT, inp=True)
            P.put(r, 12, _n(t.get("pct_fe")), F_PCT, inp=True)
        else:
            P.put(r, 13, _n(t.get("corpo_be")), F_NUM)
            P.put(r, 14, _n(t.get("corpo_fe")), F_NUM)
        tipo_pos[c] = {"mix": [P.ext(r, 5 + i) for i in range(3)], "gg": [P.ext(r, 8 + i) for i in range(3)], "be": P.ext(r, 11), "fe": P.ext(r, 12)}
    # AM
    am_cfg = stima.get("am") or {}
    modo = am_cfg.get("modalita")
    A = snap.get("am", {})
    r += 2
    P.put(r, 1, "Application Management", bold=True)
    r += 1
    P.put(r, 2, "Modalità")
    P.put(r, 3, {"manuale": "manuale", "driver": "da driver"}.get(modo, "nessuna"))
    for etich, nome, val, fmt in (("% correttiva annua sul build equivalente", "PctCorrettiva", A.get("pct_correttiva"), F_PCT),
                                  ("Coefficiente di servizio H8", "CoeffH8", (A.get("coeff") or {}).get("H8"), F_NUM),
                                  ("Coefficiente di servizio H12", "CoeffH12", (A.get("coeff") or {}).get("H12"), F_NUM),
                                  ("Coefficiente di servizio H24", "CoeffH24", (A.get("coeff") or {}).get("H24"), F_NUM),
                                  ("% presa in carico (anno 1)", "PctPresa", A.get("pct_presa"), F_PCT),
                                  ("Decalage annuo (composto)", "Decalage", A.get("decalage"), F_PCT)):
        r += 1
        P.put(r, 2, etich)
        P.put(r, 3, _n(val), fmt, inp=True)
        nome_def(nome, P, r, 3)
    anni_max = int(A.get("anni_max") or 5)
    if modo == "manuale":
        man = am_cfg.get("manuale") or {}
        for t in ("BE", "FE"):
            for etich, campo, nome in ((f"AM {t}: giornate al mese", "gg_mese", f"AmGgMese{t}"), (f"AM {t}: mesi", "mesi", f"AmMesi{t}")):
                r += 1
                P.put(r, 2, etich)
                P.put(r, 3, _n((man.get(t) or {}).get(campo)), F_NUM, inp=True)
                nome_def(nome, P, r, 3)
    elif modo == "driver":
        d = am_cfg.get("driver") or {}
        presa = d.get("presa")
        if presa is None:
            presa = (d.get("fonte") or "progetto") != "progetto"
        r += 1
        P.put(r, 2, "Fonte del build equivalente")
        P.put(r, 3, "Progetto" if (d.get("fonte") or "progetto") == "progetto" else "Oggetti in esercizio")
        for etich, nome, val, fmt in (("Livello di servizio (H8, H12, H24)", "AmServizio", d.get("servizio") or "H8", None),
                                      (f"Anni (da 1 a {anni_max})", "AmAnni", d.get("anni") or 1, F_NUM),
                                      ("Evolutiva (gg/anno)", "AmEvolutiva", d.get("evolutiva") or 0, F_NUM),
                                      ("Presa in carico (Sì/No)", "AmPresa", "Sì" if presa else "No", None)):
            r += 1
            P.put(r, 2, etich)
            P.put(r, 3, val if fmt is None else _n(val), fmt, inp=True)
            nome_def(nome, P, r, 3)
    P.stampa("A5")

    # ================================================================ Stima (righe per modulo e calcoli del progetto)
    S = fogli["Stima"]
    S.put(1, 1, f"Stima: {stima.get('nome') or ''}", font=TITOLO)
    S.put(2, 1, "Colonne gialle: input (quantità, mix modificati, giornate a corpo). Il mix in bianco rimanda al default del tipo oggetto (foglio Parametri).")
    INTEST = ["Modulo", "Tipo oggetto", "Etichetta", "Quantità", "Mix S", "Mix M", "Mix D", "n S", "n M", "n D", "gg S", "gg M", "gg D", "gg grezzi", "% BE", "gg BE", "gg FE", "Totale", "Input BE", "Input FE"]
    S.testa(4, INTEST)
    C = {n: i + 1 for i, n in enumerate(INTEST)}

    def righe_tabella(foglio, r, righe, prefisso):
        """Righe per modulo con il subtotale; restituisce (riga dopo, {modulo: (cella BE, cella FE)})."""
        sub = {}
        for m in snap["moduli"]:
            mie = [x for x in righe if tipi[x["tipo"]]["modulo"] == m["codice"]]
            if not mie:
                continue
            foglio.put(r, 1, m.get("nome"), bold=True, fill=GRUPPO_FILL)
            for c in range(2, len(INTEST) + 1):
                foglio.put(r, c, None, fill=GRUPPO_FILL)
            r += 1
            prima = r
            for x in mie:
                t = tipi[x["tipo"]]
                foglio.put(r, 1, m["codice"]); foglio.put(r, 2, t.get("nome")); foglio.put(r, 3, x.get("etichetta") or "")
                ref = lambda col: foglio.ref(r, C[col], False)
                if t["modalita"] == "quantita":
                    pos = tipo_pos[x["tipo"]]
                    foglio.put(r, C["Quantità"], _n(x.get("quantita")) or 0, F_NUM, inp=True)
                    for i, col in enumerate(("Mix S", "Mix M", "Mix D")):
                        if x.get("mix"):
                            foglio.put(r, C[col], _n(x["mix"][i]), F_PCT, inp=True)
                        else:
                            foglio.put(r, C[col], "=" + pos["mix"][i], F_PCT)
                    for i, (cn, cm, cg) in enumerate((("n S", "Mix S", "gg S"), ("n M", "Mix M", "gg M"), ("n D", "Mix D", "gg D"))):
                        foglio.put(r, C[cn], f"={ref('Quantità')}*{ref(cm)}", F_NUM)
                        foglio.put(r, C[cg], "=" + pos["gg"][i], F_NUM)
                    foglio.put(r, C["gg grezzi"], f"={ref('n S')}*{ref('gg S')}+{ref('n M')}*{ref('gg M')}+{ref('n D')}*{ref('gg D')}", F_NUM)
                    foglio.put(r, C["% BE"], "=" + pos["be"], F_PCT)
                    foglio.put(r, C["gg BE"], "=" + R(f"{ref('gg grezzi')}*{pos['be']}"), F_GG)
                    foglio.put(r, C["gg FE"], "=" + R(f"{ref('gg grezzi')}*{pos['fe']}"), F_GG)
                else:
                    be = x.get("gg_be") if x.get("gg_be") is not None else t.get("corpo_be")
                    fe = x.get("gg_fe") if x.get("gg_fe") is not None else t.get("corpo_fe")
                    foglio.put(r, C["Input BE"], _n(be) or 0, F_NUM, inp=True)
                    foglio.put(r, C["Input FE"], _n(fe) or 0, F_NUM, inp=True)
                    foglio.put(r, C["gg BE"], "=" + R(ref("Input BE")), F_GG)
                    foglio.put(r, C["gg FE"], "=" + R(ref("Input FE")), F_GG)
                foglio.put(r, C["Totale"], f"={ref('gg BE')}+{ref('gg FE')}", F_GG)
                r += 1
            foglio.put(r, 2, f"Totale {m.get('nome')}", bold=True)
            for col in ("gg BE", "gg FE", "Totale"):
                c = C[col]
                foglio.put(r, c, f"=SUM({foglio.ref(prima, c, False)}:{foglio.ref(r - 1, c, False)})", F_GG, bold=True)
            sub[m["codice"]] = (m.get("blocco") or "Implementazione", foglio.ref(r, C["gg BE"]), foglio.ref(r, C["gg FE"]))
            celle[f"{prefisso}MOD_{m['codice']}_TOT"] = foglio.ext(r, C["Totale"])
            r += 2
        return r, sub

    righe_prog = [x for x in righe_valide if (x.get("contesto") or "progetto") == "progetto"]
    r, sub = righe_tabella(S, 5, righe_prog, "")
    cBE, cFE, cT, cX = C["gg BE"], C["gg FE"], C["Totale"], C["gg grezzi"]
    somma = lambda refs: "+".join(refs) if refs else "0"

    def riga_bt(etich, f_be, f_fe, bold=False, extra=None):
        nonlocal r
        S.put(r, 2, etich, bold=bold)
        if extra is not None:
            S.put(r, cX, extra, F_NUM)
        S.put(r, cBE, f_be, F_GG, bold=bold)
        S.put(r, cFE, f_fe, F_GG, bold=bold)
        S.put(r, cT, f"={S.ref(r, cBE, False)}+{S.ref(r, cFE, False)}", F_GG, bold=bold)
        out = (S.ref(r, cBE), S.ref(r, cFE), S.ref(r, cT))
        r += 1
        return out

    S.put(r, 1, "Calcolo del progetto", bold=True, fill=GRUPPO_FILL)
    r += 1
    impl_mod = riga_bt("Implementazione dei moduli", "=" + somma([v[1] for v in sub.values() if v[0] != "Architettura"]),
                       "=" + somma([v[2] for v in sub.values() if v[0] != "Architettura"]), bold=True)
    S.put(r, 2, "Somma dei moduli (base della sicurezza)")
    S.put(r, cT, f"={impl_mod[2]}", F_GG)
    base_moduli = S.ref(r, cT)
    r += 1
    arch = riga_bt("Moduli del blocco Architettura", "=" + somma([v[1] for v in sub.values() if v[0] == "Architettura"]),
                   "=" + somma([v[2] for v in sub.values() if v[0] == "Architettura"]))
    sec = fase_pos.get("SEC")
    if sec:
        S.put(r, cX, f"={base_moduli}*{sec['pct']}", F_NUM)
        xs = S.ref(r, cX)
        sicur = riga_bt("Sicurezza (somma dei moduli × %)", "=" + R(f"{xs}*{sec['be']}"), "=" + R(f"{xs}*{sec['fe']}"))
    else:
        sicur = riga_bt("Sicurezza", "=0", "=0")
    S.put(r, 1, "Attività a corpo", bold=True)
    r += 1
    voci = []
    for v in stima.get("voci_corpo") or []:
        S.put(r, 3, v.get("nome") or "")
        S.put(r, C["Input BE"], _n(v.get("gg_be")) or 0, F_NUM, inp=True)
        S.put(r, C["Input FE"], _n(v.get("gg_fe")) or 0, F_NUM, inp=True)
        voci.append(riga_bt("Attività a corpo", "=" + R(S.ref(r, C["Input BE"], False)), "=" + R(S.ref(r, C["Input FE"], False))))
    S.put(r, C["Input BE"], _n(stima.get("training_be")) or 0, F_NUM, inp=True)
    S.put(r, C["Input FE"], _n(stima.get("training_fe")) or 0, F_NUM, inp=True)
    training = riga_bt("Training", "=" + R(S.ref(r, C["Input BE"], False)), "=" + R(S.ref(r, C["Input FE"], False)))
    implB = riga_bt("Implementazione (B): moduli + sicurezza + attività a corpo", f"={impl_mod[0]}+{sicur[0]}" + "".join("+" + v[0] for v in voci),
                    f"={impl_mod[1]}+{sicur[1]}" + "".join("+" + v[1] for v in voci), bold=True)
    B = implB[2]
    celle["B"] = S.ext(r - 1, cT)
    r += 1
    S.put(r, 1, "Fasi", bold=True)
    r += 1
    fasi_calc = {}
    for f in snap["fasi"]:
        cod = f["codice"]
        if cod in ("SEC", "PM", "CONT"):
            continue
        pos = fase_pos[cod]
        if f.get("base") == "Moduli_team":
            fasi_calc[cod] = (f.get("blocco"), riga_bt(f.get("nome"), "=" + R(f"{impl_mod[0]}*{pos['pct']}"), "=" + R(f"{impl_mod[1]}*{pos['pct']}")))
        elif f.get("base") == "B":
            S.put(r, cX, f"={B}*{pos['pct']}", F_NUM)
            x = S.ref(r, cX)
            fasi_calc[cod] = (f.get("blocco"), riga_bt(f.get("nome"), "=" + R(f"{x}*{pos['be']}"), "=" + R(f"{x}*{pos['fe']}")))
    r += 1
    S.put(r, 1, "Blocchi", bold=True)
    r += 1
    contributi = {b: [] for b in BLOCCHI}
    for blocco, refs in fasi_calc.values():
        if blocco in contributi:
            contributi[blocco].append(refs)
    contributi["Architettura"].insert(0, arch)
    contributi["Implementazione"].insert(0, implB)
    contributi["Training"].insert(0, training)
    blocchi = {}
    for b in BLOCCHI:
        refs = contributi[b]
        blocchi[b] = riga_bt(b, "=" + somma([x[0] for x in refs]), "=" + somma([x[1] for x in refs]))
        celle[f"BLK_{b}"] = S.ext(r - 1, cT)
    TP = riga_bt("Totale progetto (TP)", "=" + somma([x[0] for x in blocchi.values()]), "=" + somma([x[1] for x in blocchi.values()]), bold=True)
    celle["TP"] = S.ext(r - 1, cT)
    S.put(r, 2, "Project management (TP × % PM)")
    S.put(r, cT, "=" + R(f"{TP[2]}*PctPM"), F_GG)
    PM = S.ref(r, cT)
    celle["PM"] = S.ext(r, cT)
    r += 1
    CONT = riga_bt("Contingency (TP per team × %)", "=" + R(f"{TP[0]}*PctContingency"), "=" + R(f"{TP[1]}*PctContingency"))
    celle["CONT"] = S.ext(r - 1, cT)
    S.put(r, 2, "Totale complessivo", bold=True)
    S.put(r, cT, f"={TP[2]}+{PM}+{CONT[2]}", F_GG, bold=True)
    TOT = S.ref(r, cT)
    celle["TOTALE"] = S.ext(r, cT)
    S.stampa("D5")
    sx = lambda ref: f"'Stima'!{ref}"

    # ================================================================ Ripartizione BE-FE
    Q = fogli["Ripartizione BE-FE"]
    Q.put(1, 1, "Ripartizione delle giornate per figura", font=TITOLO)
    Q.testa(3, ["Blocco", "gg BE", "gg FE", "gg PM", "Totale"])
    r = 4
    prima = r
    for b in BLOCCHI:
        Q.put(r, 1, b)
        Q.put(r, 2, "=" + sx(blocchi[b][0]), F_GG); Q.put(r, 3, "=" + sx(blocchi[b][1]), F_GG); Q.put(r, 4, 0, F_GG)
        Q.put(r, 5, f"=SUM(B{r}:D{r})", F_GG)
        r += 1
    Q.put(r, 1, "Project management"); Q.put(r, 2, 0, F_GG); Q.put(r, 3, 0, F_GG); Q.put(r, 4, "=" + sx(PM), F_GG); Q.put(r, 5, f"=SUM(B{r}:D{r})", F_GG)
    r += 1
    Q.put(r, 1, "Contingency"); Q.put(r, 2, "=" + sx(CONT[0]), F_GG); Q.put(r, 3, "=" + sx(CONT[1]), F_GG); Q.put(r, 4, 0, F_GG); Q.put(r, 5, f"=SUM(B{r}:D{r})", F_GG)
    r += 1
    Q.put(r, 1, "Giornate con contingency", bold=True)
    for c in range(2, 6):
        Q.put(r, c, f"=SUM({get_column_letter(c)}{prima}:{get_column_letter(c)}{r - 1})", F_GG, bold=True)
    rgg = r
    r += 1
    Q.put(r, 1, "Costo giornaliero")
    Q.put(r, 2, "=CostoBE", F_EUR2); Q.put(r, 3, "=CostoFE", F_EUR2); Q.put(r, 4, "=CostoPM", F_EUR2)
    r += 1
    Q.put(r, 1, "Costo", bold=True)
    for c in range(2, 5):
        L = get_column_letter(c)
        Q.put(r, c, f"={L}{rgg}*{L}{r - 1}", F_EUR2, bold=True)
    Q.put(r, 5, f"=SUM(B{r}:D{r})", F_EUR2, bold=True)
    rcosto = r
    r += 1
    Q.put(r, 1, "FTE (giornate / (durata × giornate al mese))")
    for c in range(2, 5):
        L = get_column_letter(c)
        Q.put(r, c, f'=IF(Durata="","",IF(Durata*GgMese=0,"",{L}{rgg}/(Durata*GgMese)))', F_FTE)
    Q.put(r, 5, f'=IF(B{r}="","",B{r}+C{r}+D{r})', F_FTE)
    for c, k in ((2, "FTE_BE"), (3, "FTE_FE"), (4, "FTE_PM"), (5, "FTE_TOT")):
        celle[k] = Q.ext(r, c)
    rfte = r
    r += 2
    Q.put(r, 1, "Controllo di quadratura con il foglio Stima (deve essere 0)")
    Q.put(r, 5, f"=E{rgg}-{sx(TOT)}", F_GG)
    celle["QUADRATURA"] = Q.ext(r, 5)
    Q.stampa("A4")
    qx = lambda r_, c_: Q.ext(r_, c_)

    # ================================================================ AM
    M = fogli["AM"]
    M.put(1, 1, "Application Management", font=TITOLO)
    am_tot = None
    am_anni = []
    if modo == "manuale":
        M.testa(3, ["Figura", "gg al mese", "Mesi", "Giornate", "Costo", "Prezzo", "FTE"])
        r = 4
        for t in ("BE", "FE"):
            M.put(r, 1, t)
            M.put(r, 2, f"=AmGgMese{t}", F_NUM); M.put(r, 3, f"=AmMesi{t}", F_NUM)
            M.put(r, 4, "=" + R(f"B{r}*C{r}"), F_GG)
            M.put(r, 5, f"=D{r}*Costo{t}", F_EUR2)
            M.put(r, 6, f'=IF(MargineAM>=1,"",E{r}/(1-MargineAM))', F_EUR2)
            M.put(r, 7, f'=IF(GgMese=0,"",B{r}/GgMese)', F_FTE)
            r += 1
        M.put(r, 1, "Totale", bold=True)
        M.put(r, 4, "=D4+D5", F_GG, bold=True); M.put(r, 5, "=E4+E5", F_EUR2, bold=True)
        M.put(r, 6, '=IF(MargineAM>=1,"",E{0}/(1-MargineAM))'.format(r), F_EUR2, bold=True)
        am_tot = (M.ext(r, 4), M.ext(r, 5), M.ext(r, 6))
        r += 1
        M.put(r, 1, "Prezzo medio mensile")
        M.put(r, 6, f'=IF(MAX(C4:C5)=0,"",IF(F{r - 1}="","",F{r - 1}/MAX(C4:C5)))', F_EUR2)
        celle["AM_MENSILE"] = M.ext(r, 6)
    elif modo == "driver":
        d = am_cfg.get("driver") or {}
        r = 3
        if (d.get("fonte") or "progetto") == "progetto":
            M.put(r, 1, "Build equivalente: implementazione del progetto (foglio Stima)")
            r += 1
            M.put(r, 1, "BE"); M.put(r, 2, "=" + sx(implB[0]), F_GG); r += 1
            M.put(r, 1, "FE"); M.put(r, 2, "=" + sx(implB[1]), F_GG); r += 1
            beq_be, beq_fe = M.ref(r - 2, 2), M.ref(r - 1, 2)
        else:
            M.put(r, 1, "Build equivalente: oggetti in esercizio (le quantità sono input)")
            M.testa(r + 1, INTEST)
            righe_es = [x for x in righe_valide if x.get("contesto") == "am_esercizio"]
            r, sub_es = righe_tabella(M, r + 2, righe_es, "AM_")
            M.put(r, 1, "BE"); M.put(r, 2, "=" + somma([v[1] for v in sub_es.values()]), F_GG); r += 1
            M.put(r, 1, "FE"); M.put(r, 2, "=" + somma([v[2] for v in sub_es.values()]), F_GG); r += 1
            beq_be, beq_fe = M.ref(r - 2, 2), M.ref(r - 1, 2)
        M.put(r, 1, "Totale build equivalente", bold=True); M.put(r, 2, f"={beq_be}+{beq_fe}", F_GG, bold=True)
        beq = M.ref(r, 2)
        celle["AM_BEQ"] = M.ext(r, 2)
        r += 1
        M.put(r, 1, "Quota BE"); M.put(r, 2, f"=IF({beq}=0,0,{beq_be}/{beq})", F_PCT); qbe = M.ref(r, 2); r += 1
        M.put(r, 1, "Quota FE"); M.put(r, 2, f"=IF({beq}=0,0,{beq_fe}/{beq})", F_PCT); qfe = M.ref(r, 2); r += 1
        M.put(r, 1, "Coefficiente di servizio"); M.put(r, 2, '=IF(AmServizio="H24",CoeffH24,IF(AmServizio="H12",CoeffH12,CoeffH8))', F_NUM)
        coeff = M.ref(r, 2)
        r += 1
        M.put(r, 1, f'=IF({beq}=0,"AM non calcolabile: il build equivalente è zero","")', font=ROSSO)
        r += 2
        M.testa(r, ["Anno", "Correttiva base", "Correttiva BE", "Correttiva FE", "Evolutiva BE", "Evolutiva FE", "Presa BE", "Presa FE",
                    "gg BE", "gg FE", "gg Totale", "Costo", "Prezzo", "Mensile", "FTE"])
        r += 1
        prima = r
        for k in range(1, anni_max + 1):
            v = lambda expr: f'=IF({k}>AmAnni,"",{expr})'
            M.put(r, 1, k)
            M.put(r, 2, v(f"{beq}*PctCorrettiva*{coeff}*(1-Decalage)^{k - 1}"), F_NUM)
            M.put(r, 3, v(R(f"B{r}*{qbe}")), F_GG); M.put(r, 4, v(R(f"B{r}*{qfe}")), F_GG)
            M.put(r, 5, v(R(f"AmEvolutiva*{qbe}")), F_GG); M.put(r, 6, v(R(f"AmEvolutiva*{qfe}")), F_GG)
            presa = lambda q: f'IF(AmPresa="Sì",{R(f"{beq}*PctPresa*{q}")},0)' if k == 1 else "0"
            M.put(r, 7, v(presa(qbe)), F_GG); M.put(r, 8, v(presa(qfe)), F_GG)
            M.put(r, 9, v(f"C{r}+E{r}+G{r}"), F_GG); M.put(r, 10, v(f"D{r}+F{r}+H{r}"), F_GG); M.put(r, 11, v(f"I{r}+J{r}"), F_GG)
            M.put(r, 12, v(f"I{r}*CostoBE+J{r}*CostoFE"), F_EUR2)
            M.put(r, 13, v(f'IF(MargineAM>=1,"",L{r}/(1-MargineAM))'), F_EUR2)
            M.put(r, 14, v(f'IF(M{r}="","",M{r}/12)'), F_EUR2)
            M.put(r, 15, v(f'IF(GgMese=0,"",K{r}/(12*GgMese))'), F_FTE)
            am_anni.append({"gg": M.ext(r, 11), "costo": M.ext(r, 12), "prezzo": M.ext(r, 13), "mensile": M.ext(r, 14), "fte": M.ext(r, 15)})
            r += 1
        M.put(r, 1, "Totale", bold=True)
        for c, f_ in ((11, F_GG), (12, F_EUR2), (13, F_EUR2)):
            L = get_column_letter(c)
            M.put(r, c, f"=SUM({L}{prima}:{L}{r - 1})", f_, bold=True)
        am_tot = (M.ext(r, 11), M.ext(r, 12), M.ext(r, 13))
    else:
        M.put(3, 1, "Nessuna AM prevista in questa stima.")
    if am_tot:
        celle["AM_GG"], celle["AM_COSTO"], celle["AM_PREZZO"] = am_tot
    for i, a in enumerate(am_anni, start=1):
        for k_, ref in a.items():
            celle[f"AM_Y{i}_{k_.upper()}"] = ref
    M.stampa("A3")

    # ================================================================ Riepilogo (primo foglio: solo formule che rimandano agli altri)
    W = fogli["Riepilogo"]
    gara = stima.get("gara") or {}
    W.put(1, 1, "Stimometro: riepilogo della stima", font=TITOLO)
    intest = [("Stima", stima.get("nome") or ""), ("Cliente", stima.get("cliente") or ""),
              ("Gara", f"{gara.get('ss')} · {gara.get('anno')} · {gara.get('oggetto') or ''}" if gara else "—"),
              ("Versione", stima.get("versione") or 1), ("Data dell'export", (oggi or dt.date.today()).strftime("%d/%m/%Y"))]
    for i, (k, v) in enumerate(intest):
        W.put(3 + i, 1, k, bold=True)
        W.put(3 + i, 2, v)
    r = 9
    W.testa(r, ["Blocco", "gg BE", "gg FE", "Totale", "Peso"])
    r += 1
    tp = sx(TP[2])
    for b in BLOCCHI:
        W.put(r, 1, b)
        W.put(r, 2, "=" + sx(blocchi[b][0]), F_GG); W.put(r, 3, "=" + sx(blocchi[b][1]), F_GG); W.put(r, 4, "=" + sx(blocchi[b][2]), F_GG)
        W.put(r, 5, f'=IF({tp}=0,"",D{r}/{tp})', F_PCT)
        celle[f"PESO_{b}"] = W.ext(r, 5)
        r += 1
    W.put(r, 1, "Totale progetto", bold=True)
    W.put(r, 2, "=" + sx(TP[0]), F_GG, bold=True); W.put(r, 3, "=" + sx(TP[1]), F_GG, bold=True); W.put(r, 4, "=" + tp, F_GG, bold=True)
    W.put(r, 5, f'=IF({tp}=0,"",1)', F_PCT, bold=True)
    r += 1
    W.put(r, 1, "Project management"); W.put(r, 4, "=" + sx(PM), F_GG); W.put(r, 5, f'=IF({tp}=0,"",D{r}/{tp})', F_PCT)
    r += 1
    W.put(r, 1, "Contingency"); W.put(r, 2, "=" + sx(CONT[0]), F_GG); W.put(r, 3, "=" + sx(CONT[1]), F_GG); W.put(r, 4, "=" + sx(CONT[2]), F_GG)
    W.put(r, 5, f'=IF({tp}=0,"",D{r}/{tp})', F_PCT)
    r += 1
    W.put(r, 1, "Totale complessivo", bold=True); W.put(r, 4, "=" + sx(TOT), F_GG, bold=True)
    rtot = r
    # economia
    r = 9
    W.testa(r, ["Economia", "Valore"], c0=7)
    righe_eco = [("Costo BE", f"={qx(rcosto, 2)}", F_EUR2, "COSTO_BE"), ("Costo FE", f"={qx(rcosto, 3)}", F_EUR2, "COSTO_FE"),
                 ("Costo PM", f"={qx(rcosto, 4)}", F_EUR2, "COSTO_PM"), ("Costo", f"={qx(rcosto, 5)}", F_EUR2, "COSTO"),
                 ("Margine", "=MargineProgetto", F_PCT, None)]
    eco = {}
    for etich, form, fmt, chiave in righe_eco:
        r += 1
        W.put(r, 7, etich, bold=etich == "Costo"); W.put(r, 8, form, fmt, bold=etich == "Costo")
        eco[etich] = W.ref(r, 8, False)
        if chiave:
            celle[chiave] = W.ext(r, 8)
    r += 1
    W.put(r, 7, "Prezzo", bold=True); W.put(r, 8, f'=IF(MargineProgetto>=1,"",{eco["Costo"]}/(1-MargineProgetto))', F_EUR2, bold=True)
    prezzo = W.ref(r, 8, False)
    celle["PREZZO"] = W.ext(r, 8)
    r += 1
    W.put(r, 7, "Costo medio al giorno"); W.put(r, 8, f'=IF(D{rtot}=0,"",{eco["Costo"]}/D{rtot})', F_EUR2); celle["COSTO_MEDIO"] = W.ext(r, 8)
    r += 1
    W.put(r, 7, "Prezzo medio al giorno"); W.put(r, 8, f'=IF(D{rtot}=0,"",IF({prezzo}="","",{prezzo}/D{rtot}))', F_EUR2); celle["PREZZO_MEDIO"] = W.ext(r, 8)
    r += 1
    W.put(r, 7, "Prezzo obiettivo"); W.put(r, 8, '=IF(PrezzoObiettivo="","",PrezzoObiettivo)', F_EUR2)
    r += 1
    W.put(r, 7, "Margine risultante"); W.put(r, 8, f'=IF(PrezzoObiettivo="","",IF(PrezzoObiettivo>0,1-{eco["Costo"]}/PrezzoObiettivo,""))', F_PCT)
    celle["MARG_RIS"] = W.ext(r, 8)
    W.ws.conditional_formatting.add(f"H{r}", FormulaRule(formula=[f'IF(H{r}="",FALSE,H{r}<MargineProgetto)'], font=ROSSO))
    r += 1
    W.put(r, 7, "Scostamento dal prezzo"); W.put(r, 8, f'=IF(PrezzoObiettivo="","",IF({prezzo}="","",PrezzoObiettivo-{prezzo}))', F_EUR2)
    celle["SCOST"] = W.ext(r, 8)
    r += 2
    W.put(r, 7, "Durata (mesi)"); W.put(r, 8, '=IF(Durata="","",Durata)', F_NUM)
    for etich, k in (("FTE BE", "FTE_BE"), ("FTE FE", "FTE_FE"), ("FTE PM", "FTE_PM"), ("FTE totale", "FTE_TOT")):
        r += 1
        W.put(r, 7, etich, bold=k == "FTE_TOT"); W.put(r, 8, "=" + celle[k], F_FTE, bold=k == "FTE_TOT")
    r += 2
    W.put(r, 7, "AM", bold=True)
    if am_tot:
        for etich, ref, fmt in (("Giornate AM", am_tot[0], F_GG), ("Costo AM", am_tot[1], F_EUR2), ("Prezzo AM", am_tot[2], F_EUR2)):
            r += 1
            W.put(r, 7, etich); W.put(r, 8, "=" + ref, fmt)
        for i, a in enumerate(am_anni, start=1):
            r += 1
            W.put(r, 7, f"Prezzo AM anno {i}"); W.put(r, 8, "=" + a["prezzo"], F_EUR2)
    else:
        W.put(r, 8, "nessuna")
    W.stampa()
    for ws in wb.worksheets:
        ws.sheet_view.showGridLines = ws.title != "Riepilogo"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue(), nome_file(stima, oggi), celle
