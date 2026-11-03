"""Stimometro, fase 4: l'Excel esportato, ricalcolato con LibreOffice, dà gli stessi risultati del motore (specifica §8.4).
Per ogni caso: genera l'Excel, lo ricalcola in modalità headless, confronta le celle chiave (tolleranza 0,01) e cerca errori di formula."""
import io
import shutil
import subprocess

import openpyxl
import pytest

from core.stime_motore import calcola
from core.stime_xlsx import esporta, nome_file
from test_app import client  # noqa: F401  (fixture)
from test_stime_motore import tc1, tc2, tc3

SOFFICE = shutil.which("soffice") or shutil.which("libreoffice")
con_libreoffice = pytest.mark.skipif(not SOFFICE, reason="serve LibreOffice (soffice) per ricalcolare l'Excel")


def ricalcola(contenuto, tmp_path):
    src = tmp_path / "stima.xlsx"
    src.write_bytes(contenuto)
    out = tmp_path / "ricalcolato"
    out.mkdir(exist_ok=True)
    subprocess.run([SOFFICE, "--headless", "--norestore", f"-env:UserInstallation=file://{tmp_path}/profilo_lo",
                    "--convert-to", "xlsx", "--outdir", str(out), str(src)], check=True, capture_output=True, timeout=240)
    return openpyxl.load_workbook(out / "stima.xlsx", data_only=True)


def valore(wb, ref):
    foglio, cella = ref.rsplit("!", 1)
    return wb[foglio.strip("'")][cella.replace("$", "")].value


def errori_di_formula(wb):
    return [f"{ws.title}!{c.coordinate}={c.value}" for ws in wb.worksheets for riga in ws.iter_rows() for c in riga
            if isinstance(c.value, str) and (c.value.startswith("#") or c.value.startswith("Err:"))]


def num(x):
    return None if x is None or x == "" else float(x)


def confronta(wb, celle, res):
    p, am = res["progetto"], res["am"]
    attesi = {"B": p["B"], "TP": p["TP"]["tot"], "PM": p["PM"], "CONT": p["contingency"]["tot"], "TOTALE": p["totale"],
              "COSTO_BE": p["costi"]["BE"], "COSTO_FE": p["costi"]["FE"], "COSTO_PM": p["costi"]["PM"], "COSTO": p["costi"]["tot"],
              "PREZZO": p["prezzo"], "COSTO_MEDIO": p["costo_medio"], "PREZZO_MEDIO": p["prezzo_medio"], "QUADRATURA": 0}
    for b, v in p["blocchi"].items():
        attesi[f"BLK_{b}"] = v["tot"]
        attesi[f"PESO_{b}"] = v["peso"]
    if p["obiettivo"]:
        attesi["MARG_RIS"], attesi["SCOST"] = p["obiettivo"]["margine"], p["obiettivo"]["scostamento"]
    if p["fte"]:
        attesi.update(FTE_BE=p["fte"]["BE"], FTE_FE=p["fte"]["FE"], FTE_PM=p["fte"]["PM"], FTE_TOT=p["fte"]["tot"])
    else:
        attesi.update(FTE_BE=None, FTE_TOT=None)
    if am:
        attesi.update(AM_GG=am["gg"], AM_COSTO=am["costo"], AM_PREZZO=am["prezzo"])
        for i, a in enumerate(am.get("anni") or [], start=1):
            attesi.update({f"AM_Y{i}_GG": a["gg"]["tot"], f"AM_Y{i}_COSTO": a["costo"], f"AM_Y{i}_PREZZO": a["prezzo"],
                           f"AM_Y{i}_MENSILE": a["mensile"], f"AM_Y{i}_FTE": a["fte"]})
    controllate = 0
    for chiave, atteso in attesi.items():
        got = num(valore(wb, celle[chiave]))
        atteso = num(atteso)
        if atteso is None:
            assert got is None, f"{chiave}: atteso vuoto (n/d), trovato {got}"
        else:
            assert got is not None and abs(got - atteso) <= 0.01, f"{chiave}: Excel {got} · motore {atteso}"
        controllate += 1
    return controllate


@con_libreoffice
@pytest.mark.parametrize("caso", [tc1, tc2, tc3], ids=["TC1", "TC2", "TC3"])
def test_excel_ricalcolato_uguale_al_motore(caso, tmp_path):
    s = caso()
    s.update(nome=caso.__name__.upper(), cliente="Acme", versione=1)
    contenuto, nome, celle = esporta(s)
    wb = ricalcola(contenuto, tmp_path)
    assert errori_di_formula(wb) == []
    assert confronta(wb, celle, calcola(s)) >= 25
    assert wb.sheetnames == ["Riepilogo", "Parametri", "Stima", "Ripartizione BE-FE", "AM"]


@con_libreoffice
def test_le_formule_sono_vive_cambiando_un_input_nell_excel(tmp_path):
    """Cambio la quantità dello Staging e il margine direttamente nell'Excel: dopo il ricalcolo i risultati sono quelli
    che il motore dà con gli stessi input."""
    s = tc1()
    s.update(nome="TC1", cliente="Acme", versione=1)
    contenuto, _, celle = esporta(s)
    wb = openpyxl.load_workbook(io.BytesIO(contenuto))
    ws = wb["Stima"]
    riga = next(r for r in range(1, ws.max_row + 1) if ws.cell(r, 1).value == "STG")
    ws.cell(riga, 4).value = 50
    wb.defined_names["MargineProgetto"]                                                    # nome definito presente
    p = wb["Parametri"]
    cella_margine = next(c for riga_ in p.iter_rows() for c in riga_ if c.value == "Margine del progetto")
    p.cell(cella_margine.row, 3).value = 0.25
    buf = io.BytesIO()
    wb.save(buf)
    wb2 = ricalcola(buf.getvalue(), tmp_path)
    s["righe"][0]["quantita"] = 50
    s["snapshot"]["generali"]["margine_progetto"] = 0.25
    assert errori_di_formula(wb2) == []
    confronta(wb2, celle, calcola(s))


def test_export_bloccato_dagli_errori_e_nome_del_file():
    s = tc1()
    s["righe"][0]["mix"] = [0.5, 0.3, 0.1]
    with pytest.raises(ValueError, match="Export bloccato"):
        esporta(s)
    import datetime as dt
    assert nome_file({"cliente": "Terna S.p.A.", "nome": "Data platform / v2", "versione": 3}, dt.date(2026, 11, 2)) == "Stima_Terna_S_p_A_Data_platform_v2_v3_2026-11-02.xlsx"


def test_struttura_del_file_senza_libreoffice():
    """Formule (non valori) nelle celle calcolate, nomi definiti, input evidenziati, nessun collegamento esterno."""
    s = tc2()
    contenuto, _, celle = esporta(s)
    wb = openpyxl.load_workbook(io.BytesIO(contenuto))
    for nome in ("Passo", "MargineProgetto", "MargineAM", "GgMese", "CostoBE", "CostoFE", "CostoPM", "PctPM", "PctContingency"):
        assert nome in wb.defined_names, nome
    for chiave in ("TP", "TOTALE", "PREZZO", "AM_PREZZO", "AM_Y1_GG"):
        foglio, cella = celle[chiave].rsplit("!", 1)
        v = wb[foglio.strip("'")][cella.replace("$", "")].value
        assert isinstance(v, str) and v.startswith("="), chiave
    testo = " ".join(str(c.value) for ws in wb.worksheets for r in ws.iter_rows() for c in r if isinstance(c.value, str) and c.value.startswith("="))
    for vietata in ("XLOOKUP", "LET(", "LAMBDA", "FILTER(", "[", "http"):
        assert vietata not in testo, vietata
    assert "ROUND(ROUND(" in testo


def test_api_export(client):  # noqa: F811
    c, x, tmp = client
    s = tc1()
    corpo = {k: s[k] for k in ("righe", "voci_corpo", "training_be", "training_fe", "durata_mesi", "prezzo_obiettivo", "am")}
    st = c.post("/api/stime", json={"nome": "Data platform", "cliente": "Terna", **corpo}).get_json()
    r = c.get(f"/api/stime/{st['id']}/export")
    assert r.status_code == 200 and r.mimetype.endswith("spreadsheetml.sheet")
    assert "Stima_Terna_Data_platform_v1_" in r.headers["Content-Disposition"]
    wb = openpyxl.load_workbook(io.BytesIO(r.data))
    assert wb.sheetnames[0] == "Riepilogo"
    righe = st["righe"]
    righe[0]["mix"] = [0.5, 0.3, 0.1]
    c.put(f"/api/stime/{st['id']}", json={"righe": righe})
    r = c.get(f"/api/stime/{st['id']}/export")
    assert r.status_code == 400 and "Export bloccato" in r.get_json()["error"]


@con_libreoffice
def test_excel_con_giornate_fisse_uguale_al_motore(tmp_path):
    """Giornate fisse su UAT, analisi, PM e contingency: l'Excel le applica come il motore; svuotandole torna la percentuale."""
    s = tc1()
    s.update(nome="TC1 fisse", cliente="Acme", versione=1)
    fasi = {f["codice"]: f for f in s["snapshot"]["fasi"]}
    fasi["UAT"]["gg_fissi"], fasi["ANA"]["gg_fissi"], fasi["PM"]["gg_fissi"], fasi["CONT"]["gg_fissi"] = 40.3, 30, 100.2, 50
    contenuto, _, celle = esporta(s)
    wb = ricalcola(contenuto, tmp_path)
    assert errori_di_formula(wb) == []
    confronta(wb, celle, calcola(s))
    # nell'Excel svuoto le giornate fisse di UAT: torna la percentuale
    wb2 = openpyxl.load_workbook(io.BytesIO(contenuto))
    p = wb2["Parametri"]
    riga = next(r for r in range(1, p.max_row + 1) if p.cell(r, 1).value == "UAT")
    p.cell(riga, 8).value = None
    buf = io.BytesIO()
    wb2.save(buf)
    fasi["UAT"]["gg_fissi"] = None
    wb3 = ricalcola(buf.getvalue(), tmp_path / "b") if (tmp_path / "b").mkdir() is None else None
    confronta(wb3, celle, calcola(s))
