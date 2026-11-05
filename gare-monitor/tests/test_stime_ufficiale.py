"""Stima ufficiale: flag sulla stima chiusa e certificata, con il valore totale (progetto + AM, o prezzo dell'Assessment)
scritto nella colonna "TCV Offerta Economica" della riga della gara, come modifica da esportare nell'Excel."""
import json

import openpyxl
import pytest

from test_app import client, make_xlsx  # noqa: F401  (fixture)
from test_stime_motore import tc1

TCV = "TCV Offerta Economica"


@pytest.fixture()
def cli(tmp_path, monkeypatch):
    """App con un Excel che ha la colonna TCV (TER2 ha già un valore)."""
    x = tmp_path / "t.xlsx"
    make_xlsx(x)
    wb = openpyxl.load_workbook(x)
    ws = wb["gare e offerte"]
    ws.cell(1, 20).value = TCV
    ws.cell(3, 20).value = 100000                                             # TER2
    ws.tables["Tabella4"].ref = "A1:T7"
    wb.save(x)
    cfg = tmp_path / "config.json"
    cfg.write_text(json.dumps({"excel_path": str(x), "db_path": str(tmp_path / "monitoraggio.db"), "writer": "openpyxl"}))
    monkeypatch.setenv("GARE_CONFIG", str(cfg))
    import importlib
    import app as appmod
    importlib.reload(appmod)
    appmod.app.testing = True
    return appmod.app.test_client(), x


def nuova(c, chiave="TER1|2026", **extra):
    s = tc1()
    corpo = {k: s[k] for k in ("righe", "voci_corpo", "training_be", "training_fe", "durata_mesi", "am")}
    return c.post("/api/stime", json={"nome": "Stima", "cliente": "Terna", "gara": {"chiave": chiave} if chiave else None, **corpo, **extra}).get_json()


def test_ufficiale_scrive_il_tcv_progetto_piu_am_e_blocca_la_stima(cli):
    c, x = cli
    c.get("/api/data")
    s = nuova(c)
    r = c.post(f"/api/stime/{s['id']}/ufficiale", json={})
    assert r.status_code == 200, r.get_json()
    j = r.get_json()
    atteso = round(s["totali"]["prezzo"] + s["totali"]["am_prezzo"], 2)                 # sempre progetto + AM
    assert j["tcv"] == atteso and j["scritto"] and j["stima"]["ufficiale"] and j["stima"]["corrente"]
    riga = next(r for r in c.get("/api/data").get_json()["rows"] if r["SS"] == "TER1")
    assert riga[TCV] == atteso and riga["_state"] == "mod"
    pend = c.get("/api/pending").get_json()
    assert any(f["campo"] == TCV and f["dopo"] == atteso for m in pend["modificate"] for f in m["campi"])
    # in sola lettura finché è ufficiale
    r = c.put(f"/api/stime/{s['id']}", json={"nome": "altro"})
    assert r.status_code == 400 and "sola lettura" in r.get_json()["error"]
    # esportata nell'Excel
    assert c.post("/api/export").status_code == 200
    ws = openpyxl.load_workbook(x)["gare e offerte"]
    assert ws.cell(2, 20).value == pytest.approx(atteso)
    # una sola ufficiale per gara: la nuova versione ufficiale toglie il flag alla precedente
    v2 = c.post(f"/api/stime/{s['id']}/versione").get_json()
    assert not v2["ufficiale"]
    assert c.post(f"/api/stime/{v2['id']}/ufficiale", json={}).status_code == 200
    el = {x["id"]: x for x in c.get("/api/stime").get_json()["stime"]}
    assert el[v2["id"]]["ufficiale"] and not el[s["id"]]["ufficiale"] and el[v2["id"]]["ufficiale_tcv"] == atteso
    # togliendo il flag torna modificabile (il TCV nella riga resta)
    assert not c.delete(f"/api/stime/{v2['id']}/ufficiale").get_json()["ufficiale"]
    assert c.put(f"/api/stime/{v2['id']}", json={"nome": "altro"}).status_code == 200


def test_valore_diverso_chiede_conferma_e_assessment(cli):
    c, x = cli
    c.get("/api/data")
    a = c.post("/api/stime", json={"nome": "Assessment", "tipo": "assessment", "gara": {"chiave": "TER2|2026"}, "durata_mesi": 4}).get_json()
    r = c.post(f"/api/stime/{a['id']}/ufficiale", json={})
    assert r.status_code == 409 and r.get_json()["prima"] == 100000 and r.get_json()["dopo"] == pytest.approx(133933.33, abs=0.01)
    assert not c.get(f"/api/stime/{a['id']}").get_json()["stima"]["ufficiale"]
    r = c.post(f"/api/stime/{a['id']}/ufficiale", json={"conferma": True})
    assert r.status_code == 200 and r.get_json()["tcv"] == pytest.approx(133933.33, abs=0.01)
    riga = next(r for r in c.get("/api/data").get_json()["rows"] if r["SS"] == "TER2")
    assert riga[TCV] == pytest.approx(133933.33, abs=0.01)


def test_senza_gara_o_gara_non_trovata(cli):
    c, _ = cli
    c.get("/api/data")
    s = nuova(c, chiave=None)
    r = c.post(f"/api/stime/{s['id']}/ufficiale", json={})
    assert r.status_code == 400 and "collegata a una gara" in r.get_json()["error"]
    s = nuova(c, chiave="ZZZ9|2026")
    r = c.post(f"/api/stime/{s['id']}/ufficiale", json={})
    assert r.status_code == 400 and "non è nella tabella" in r.get_json()["error"]


def test_excel_senza_colonna_tcv(client):  # noqa: F811
    c2, _, _ = client                                                        # Excel senza la colonna TCV
    c2.get("/api/data")
    s = nuova(c2)
    r = c2.post(f"/api/stime/{s['id']}/ufficiale", json={})
    assert r.status_code == 400 and TCV in r.get_json()["error"]
