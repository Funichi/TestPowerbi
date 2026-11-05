"""Stimometro: stime di tipo Assessment (workstream e attività con deliverable).
Motore (caso TCA1 con passo 0,5 e con passo 1), archivio e migrazione, API ed export Excel ricalcolato con LibreOffice."""
import io
import json
import sqlite3
from decimal import Decimal

import openpyxl
import pytest

from core import stime
from core.stime import StimeStore
from core.stime_catalogo import MODELLO_ASSESSMENT, catalogo_default, stima_nuova
from core.stime_motore import calcola
from core.stime_xlsx import esporta
from test_app import client  # noqa: F401  (fixture)
from test_stime_xlsx import SOFFICE, errori_di_formula, num, ricalcola, valore

g = lambda x: Decimal(str(x).replace(",", "."))


def tca1(passo=0.5):
    """Modello predefinito senza modifiche e senza attività accessorie; costi 460/380/380, contingency 5%, margine 25%;
    4 mesi, 20 giornate al mese."""
    s = stima_nuova(tipo="assessment")
    s["durata_mesi"] = 4
    s["snapshot"]["generali"]["passo"] = passo
    s["snapshot"]["generali"]["gg_mese"] = 20
    return s


def test_tca1_passo_mezza_giornata():
    a = calcola(tca1())["assessment"]
    ws = [(w["PM"], w["BE"], w["FE"], w["tot"]) for w in a["workstream"]]
    assert ws == [(g(22), g(8), 0, g(30)), (0, g(61), 0, g(61)), (0, g(66), 0, g(66)), (0, g(58), 0, g(58)), (0, g(32), 0, g(32))]
    assert (a["totale"]["PM"], a["totale"]["BE"], a["totale"]["FE"], a["totale"]["tot"]) == (g(22), g(225), 0, g(247))
    assert (a["contingency"]["PM"], a["contingency"]["BE"], a["contingency"]["FE"], a["contingency"]["tot"]) == (g(1), g("11,5"), 0, g("12,5"))
    tc = a["totale_cont"]
    assert (tc["PM"], tc["BE"], tc["FE"], tc["tot"]) == (g(23), g("236,5"), 0, g("259,5"))
    assert (a["costi"]["PM"], a["costi"]["BE"], a["costi"]["FE"], a["costi"]["tot"]) == (g(10580), g(89870), 0, g(100450))
    assert round(a["prezzo"], 2) == g("133933.33")
    f = a["fte"]
    assert (round(f["PM"], 2), round(f["BE"], 2), f["FE"], round(f["tot"], 2)) == (g("0.29"), g("2.96"), 0, g("3.24"))
    assert round(a["workstream"][1]["peso"], 4) == round(g(61) / g(247), 4)
    assert not [m for m in calcola(tca1())["messaggi"] if m["livello"] == "errore"]


def test_tca1_passo_una_giornata():
    """Con passo 1 i valori del foglio originale: 236 giornate di delivery, 100.260 € di costo, 133.680 € di ricavi."""
    a = calcola(tca1(1))["assessment"]
    assert a["totale_cont"]["BE"] == 236 and a["costi"]["tot"] == 100260 and a["prezzo"] == 133680


def test_accessorie_negativi_e_margine():
    s = tca1()
    s["voci_corpo"] = [{"nome": "Workshop extra", "gg_pm": 1, "gg_be": 2.3, "gg_fe": 4}]
    a = calcola(s)["assessment"]
    assert (a["acc"]["PM"], a["acc"]["BE"], a["acc"]["FE"]) == (1, g("2.5"), 4)
    assert a["totale"]["tot"] == g(247) + g("7.5")
    s["voci_corpo"][0]["gg_be"] = -1
    s["snapshot"]["assessment"]["margine"] = 1
    res = calcola(s)
    assert res["export_bloccato"] and res["assessment"]["prezzo"] is None
    s = tca1()
    s["durata_mesi"] = None
    assert calcola(s)["assessment"]["fte"] is None


# ------------------------------------------------------------------ archivio, migrazione, API

@pytest.fixture()
def st(tmp_path):
    return StimeStore(str(tmp_path / "stime.db"))


def test_creazione_versione_clona_ed_elenco(st):
    p = st.crea({"nome": "Progetto"})
    a = st.crea({"nome": "Assessment dati", "tipo": "assessment", "durata_mesi": 4})
    assert p["tipo"] == "progetto" and p["workstream"] == [] and "assessment" not in p["snapshot"]
    assert a["tipo"] == "assessment" and a["snapshot"]["assessment"]["costo_be"] == 380 and "modello" not in a["snapshot"]["assessment"]
    assert [w["codice"] for w in a["workstream"]] == ["WS0", "WS1", "WS2", "WS3", "WS4"]
    assert sum(len(w["attivita"]) for w in a["workstream"]) == 28 and a["workstream"][1]["attivita"][2]["id"] == "1.3"        # ID per posizione
    assert a["voci_corpo"] == []
    assert st.leggi(a["id"])["workstream"] == a["workstream"]
    el = {x["nome"]: x for x in st.elenco()}
    assert el["Assessment dati"]["tipo"] == "assessment" and el["Assessment dati"]["gg"] == 259.5 and el["Assessment dati"]["am_prezzo"] is None
    assert [x["nome"] for x in st.elenco(tipo="assessment")] == ["Assessment dati"]
    # modifica: un workstream in meno, un'attività accessoria con le giornate PM
    ws = a["workstream"][:2]
    ws[1]["attivita"] = ws[1]["attivita"][:1]
    s = st.salva(a["id"], {"workstream": ws, "voci_corpo": [{"nome": "Extra", "gg_pm": 2, "gg_be": 1, "gg_fe": 0}], "tipo": "progetto"})
    assert s["tipo"] == "assessment"                                                  # il tipo non si cambia
    assert len(s["workstream"]) == 2 and s["voci_corpo"][0]["gg_pm"] == 2
    assert [x["id"] for x in s["workstream"][1]["attivita"]] == ["1.1"]
    ws2 = s["workstream"]
    ws2[0]["attivita"].reverse()                                                      # sposto le attività: gli ID seguono la posizione
    s = st.salva(a["id"], {"workstream": ws2})
    assert [x["id"] for x in s["workstream"][0]["attivita"]] == ["0.1", "0.2"] and s["workstream"][0]["attivita"][0]["attivita"].startswith("SAL")
    assert s["workstream"][0]["attivita"][0]["deliverable"] == "Verbali SAL e SteCo"   # il deliverable non è più usato ma resta
    v2 = st.nuova_versione(a["id"])
    cl = st.clona(a["id"])
    for x in (v2, cl):
        assert x["tipo"] == "assessment" and x["workstream"] == s["workstream"] and x["voci_corpo"][0]["gg_pm"] == 2
    st.elimina(cl["id"])
    with sqlite3.connect(st.path) as c:
        assert c.execute("SELECT COUNT(*) FROM workstream WHERE stima_id=?", (cl["id"],)).fetchone()[0] == 0
    with pytest.raises(stime.StimaError):
        st.crea({"tipo": "altro"})


def test_modello_dal_catalogo_e_riallineamento(st):
    k = st.catalogo()
    assert k["assessment"]["contingency"] == 0.05 and len(k["assessment"]["modello"]) == 5
    k["assessment"]["costo_be"] = 400
    k["assessment"]["modello"] = [{"codice": "WS0", "nome": "WS0 – Unico", "attivita": [{"id": "A.0.1", "attivita": "Tutto", "deliverable": "Report",
                                                                                       "gg_pm": 1, "gg_be": 2, "gg_fe": 3}]}]
    st.salva_catalogo(k)
    a = st.crea({"tipo": "assessment"})
    assert a["snapshot"]["assessment"]["costo_be"] == 400 and a["workstream"][0]["nome"] == "WS0 – Unico"
    k["assessment"]["margine"] = 0.3
    st.salva_catalogo(k)
    diff = st.riallinea(a["id"])["differenze"]
    assert [(d["sezione"], d["campo"]) for d in diff] == [("assessment", "margine")]
    s = st.riallinea(a["id"], conferma=True)["stima"]
    assert s["snapshot"]["assessment"]["margine"] == 0.3 and s["workstream"][0]["nome"] == "WS0 – Unico"   # le righe non cambiano
    p = st.crea({})
    assert st.riallinea(p["id"])["differenze"] == []                                  # il progetto ignora i parametri Assessment


def test_schema_3_diventa_4_e_le_stime_restano_progetto(tmp_path):
    vecchio = catalogo_default()
    vecchio.pop("assessment")
    schema3 = stime.SCHEMA.replace(", tipo TEXT DEFAULT 'progetto'", "").replace(",\n  gg_pm REAL);", ");")
    assert "DEFAULT 'progetto'" not in schema3 and "gg_pm REAL);" not in schema3
    path = str(tmp_path / "stime.db")
    with sqlite3.connect(path) as c:
        c.executescript(schema3)
        stime._scrivi_catalogo(c, vecchio)
        c.execute("DELETE FROM parametri WHERE chiave LIKE 'ass.%'")
        c.execute("INSERT INTO meta VALUES ('seed', 'x')")
        c.execute("INSERT INTO meta VALUES ('schema', '3')")
        c.execute("INSERT INTO stime (famiglia, versione, corrente, nome, snapshot, am, training_be, training_fe) VALUES (1, 1, 1, 'vecchia', ?, '{}', 0, 0)",
                  (json.dumps(vecchio),))
        c.execute("INSERT INTO voci_corpo (stima_id, nome, gg_be, gg_fe, ordine) VALUES (1, 'Altre attività', 10, 10, 0)")
    st = StimeStore(path)
    s = st.leggi(1)
    assert s["tipo"] == "progetto" and s["voci_corpo"] == [{"id": 1, "nome": "Altre attività", "gg_be": 10, "gg_fe": 10}]
    assert st.calcola(1)["risultati"]["progetto"]["voci_corpo"][0]["BE"] == 10
    k = st.catalogo()
    assert k["assessment"]["costo_pm"] == 460 and [w["codice"] for w in k["assessment"]["modello"]] == [w["codice"] for w in MODELLO_ASSESSMENT]
    with sqlite3.connect(path) as c:
        assert c.execute("SELECT v FROM meta WHERE k='schema'").fetchone()[0] == "5"         # sempre allo schema più recente
    assert st.crea({"tipo": "assessment"})["tipo"] == "assessment"


def test_api_assessment(client):  # noqa: F811
    c, x, tmp = client
    s = c.post("/api/stime", json={"nome": "Assessment", "tipo": "assessment", "durata_mesi": 4}).get_json()
    assert s["tipo"] == "assessment"
    r = c.post("/api/stime/calcola", json=s).get_json()
    assert r["tipo"] == "assessment" and r["assessment"]["totale_cont"]["tot"] == 259.5
    assert [x["tipo"] for x in c.get("/api/stime?tipo=assessment").get_json()["stime"]] == ["assessment"]
    assert c.get("/api/stime?tipo=progetto").get_json()["stime"] == []
    d = c.get(f"/api/stime/{s['id']}").get_json()
    assert d["risultati"]["assessment"]["prezzo"] == pytest.approx(133933.333, abs=0.01)
    e = c.get(f"/api/stime/{s['id']}/export")
    assert e.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(e.data))
    assert wb.sheetnames == ["Stima"]


# ------------------------------------------------------------------ export Excel

def _atteso(a):
    out = {}
    for i, w in enumerate(a["workstream"]):
        for t in ("PM", "BE", "FE", "tot"):
            out[f"WS{i}_{t.upper()}"] = w[t]
    if a["accessorie"]:
        out["ACC_TOT"] = a["acc"]["tot"]
    for t in ("PM", "BE", "FE", "tot"):
        out[f"TOT_{t.upper()}"] = a["totale"][t]
        out[f"TC_{t.upper()}"] = a["totale_cont"][t]
        out[f"COSTO_{t.upper()}" if t != "tot" else "COSTO"] = a["costi"][t]
    out.update(PREZZO=a["prezzo"], COSTO_MEDIO=a["costo_medio"], PREZZO_MEDIO=a["prezzo_medio"])
    if a["obiettivo"]:
        out.update(MARG_RIS=a["obiettivo"]["margine"], SCOST=a["obiettivo"]["scostamento"])
    f = a["fte"] or {}
    for t in ("PM", "BE", "FE", "tot"):
        out[f"FTE_{t.upper()}"] = f.get(t)
    return out


@pytest.mark.skipif(not SOFFICE, reason="serve LibreOffice (soffice) per ricalcolare l'Excel")
@pytest.mark.parametrize("variante", ["passo_0_5", "passo_1_accessorie_obiettivo"])
def test_export_ricalcolato_uguale_al_motore(variante, tmp_path):
    s = tca1(0.5 if variante == "passo_0_5" else 1)
    s.update(nome="TCA1", cliente="Acme", versione=1)
    if variante != "passo_0_5":
        s["voci_corpo"] = [{"nome": "Workshop extra", "gg_pm": 1, "gg_be": 2.3, "gg_fe": 4}]
        s["prezzo_obiettivo"] = 140000
    contenuto, nome, celle = esporta(s)
    assert nome.startswith("Stima_Acme_TCA1_v1_")
    wb = ricalcola(contenuto, tmp_path)
    assert wb.sheetnames == ["Stima"] and errori_di_formula(wb) == []
    attesi = _atteso(calcola(s)["assessment"])
    for chiave, v in attesi.items():
        got, v = num(valore(wb, celle[chiave])), num(v)
        if v is None:
            assert got is None, chiave
        else:
            assert got is not None and abs(got - v) <= 0.01, f"{chiave}: Excel {got} · motore {v}"
    testi = {str(c.value) for r in wb["Stima"].iter_rows() for c in r if isinstance(c.value, str)}
    assert "Deliverable / output" not in testi
    for etichetta in ("Stima Assessment", "ID", "Workstream", "Attività", "Giornate PM", "Giornate BE", "Giornate FE",
                      "Subtotale", "Totale Progetto", "Contingency", "Costo Unitario", "Costi totale", "Margine", "Ricavi", "Prezzo obiettivo",
                      "Margine risultante", "Stima mesi progetto", "FTE", "WS1 – Diagnostico"):
        assert etichetta in testi, etichetta


@pytest.mark.skipif(not SOFFICE, reason="serve LibreOffice (soffice) per ricalcolare l'Excel")
def test_export_formule_vive(tmp_path):
    """Cambio nell'Excel le giornate BE di un'attività e la contingency: i risultati seguono il motore."""
    s = tca1()
    contenuto, _, celle = esporta(s)
    wb = openpyxl.load_workbook(io.BytesIO(contenuto))
    ws = wb["Stima"]
    riga = next(r for r in range(1, ws.max_row + 1) if ws.cell(r, 1).value == "1.2")
    assert ws.cell(4, 2).value == "WS0 – Governo progetto" and ws.cell(5, 1).value == "0.1"
    ws.cell(riga, 5).value = 20.2                                                     # Giornate BE
    riga = next(r for r in range(1, ws.max_row + 1) if ws.cell(r, 1).value == "Contingency")
    ws.cell(riga, 2).value = 0.1
    buf = io.BytesIO()
    wb.save(buf)
    wb2 = ricalcola(buf.getvalue(), tmp_path)
    s["workstream"][1]["attivita"][1]["gg_be"] = 20.2
    s["snapshot"]["assessment"]["contingency"] = 0.1
    a = calcola(s)["assessment"]
    assert errori_di_formula(wb2) == []
    for chiave in ("TC_TOT", "COSTO", "PREZZO", "FTE_TOT"):
        assert abs(num(valore(wb2, celle[chiave])) - float(_atteso(a)[chiave])) <= 0.01, chiave
