import datetime as dt
import json
import os
import shutil
import sys

import openpyxl
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

HEAD = ["Seq", "Vertical", "Market", "Cliente", "Commessa", "SS", "Valore", "Oggetto", "Legal Entity", "tipo",
        "Data ins.", "Data Opt review", "Data consegna", "Solution D&A", "Stato", "Salesman", "Referenti vertical",
        "Tecnologie di riferimento D&A", "Note"]


def make_xlsx(path):
    from openpyxl.worksheet.table import Table
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "gare e offerte"
    ws.append(HEAD)
    d = dt.datetime
    data = [
        ["=ROW()-1", "Enterprise", "Energy&Utility", "Terna", "$EII4506", "TER1", 1, "Uno", None, "Gara", d(2026, 9, 1), None, d(2026, 10, 16), "Melloncelli / Scamuzzo", "WIP"],
        ["=ROW()-1", "Enterprise", "Energy&Utility", "TERNA ", None, "TER2", 1, "Due", None, "Gara", d(2026, 5, 1), None, d(2026, 5, 20), "Scamuzzo", "won"],
        ["=ROW()-1", "Finance", "Finance", "Generali", None, "GEN4", 1, "Tre", None, "RFI", d(2026, 8, 1), None, d(2026, 8, 10), "Grando", "Waiting For response"],
        ["=ROW()-1", "Finance", "Finance", "Intesa", None, None, 1, "Quattro", None, "RFI", None, None, None, None, "Closed"],
        ["=ROW()-1", "Public sector", " public  sector ", "Inps", None, "INP1", 1, "Cinque", None, "Gara", d(2026, 3, 2), None, d(2026, 3, 9), "Grando", "No bid"],
        ["=ROW()-1", "Enterprise", None, "Enel", None, "ENE1", 1, "Sei", None, "Offerta diretta", d(2025, 3, 2), None, d(2025, 3, 20), "Grando", "Lost"],
    ]
    for r in data:
        ws.append(r)
    ws.add_table(Table(displayName="Tabella4", ref=f"A1:S{len(data) + 1}"))
    dm = wb.create_sheet("Domini")
    dm.append([None, "Chiave", "Settore", "Codice", "Anno", None, "Vertical", None, "Market", None, "tipo", None, "Stato"])
    rows = [("Enterprise2026", "Enterprise", "$EII4506", 2026), ("Finance2026", "Finance", "$EII4505", 2026)]
    verts = ["Enterprise", "Public sector", "Finance"]
    mk = ["Energy&Utility", "Finance", "Public Sector"]
    tp = ["Gara", "RFI", "Offerta diretta"]
    st = ["Waiting For response", "NoBID", "Sospeso", "WIP", "Won", "Lost"]
    for i in range(6):
        r = rows[i] if i < len(rows) else (None, None, None, None)
        dm.append([None, r[0], r[1], r[2], r[3], None, verts[i] if i < 3 else None, None, mk[i] if i < 3 else None, None,
                   tp[i] if i < 3 else None, None, st[i]])
    wb.save(path)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    x = tmp_path / "t.xlsx"
    make_xlsx(x)
    cfg = tmp_path / "config.json"
    cfg.write_text(json.dumps({"excel_path": str(x), "writer": "openpyxl"}))
    monkeypatch.setenv("GARE_CONFIG", str(cfg))
    import importlib
    import app as appmod
    importlib.reload(appmod)
    appmod.app.testing = True
    return appmod.app.test_client(), x, tmp_path


def test_data_and_suggest(client):
    c, x, _ = client
    d = c.get("/api/data").get_json()
    assert len(d["rows"]) == 6
    assert d["domini"]["vertical"] == ["Enterprise", "Public sector", "Finance"]
    s = c.post("/api/suggest", json={"Cliente": "terna", "Vertical": "Enterprise", "Data consegna": "2026-11-01"}).get_json()
    assert s["ss"] == "TER3" and s["commessa"] == "$EII4506"
    s = c.post("/api/suggest", json={"Cliente": "Nuovo Cliente"}).get_json()
    assert s["ss"] == "NUO1"


def test_create_update_and_backup(client):
    c, x, tmp = client
    body = {"Cliente": "Terna", "Vertical": "enterprise", "Market": "Finance", "Oggetto": "Nuova", "tipo": "Gara",
            "Data ins.": "2026-10-10", "Data consegna": "2026-10-20", "Solution D&A": "Grando", "Stato": "WIP", "SS": "TER3", "Commessa": "$EII4506"}
    r = c.post("/api/rows", json=body)
    assert r.status_code == 200, r.get_json()
    assert c.post("/api/rows", json=body).status_code == 409  # duplicato
    d = c.get("/api/data").get_json()
    new = d["rows"][-1]
    assert new["Cliente"] == "Terna" and new["SS"] == "TER3" and new["Data consegna"] == "2026-10-20" and new["Vertical"] == "Enterprise"
    wb = openpyxl.load_workbook(x)
    assert wb["gare e offerte"].tables["Tabella4"].ref == "A1:S8"
    assert wb["gare e offerte"].cell(8, 1).value == "=ROW()-1"
    assert len(list((tmp / "backup").glob("*.xlsx"))) >= 1
    # modifica con firma sbagliata -> rifiutata
    u = c.put(f"/api/rows/{new['_row']}", json={"sig": "sbagliata", "changes": {"Stato": "Won"}})
    assert u.status_code == 409
    u = c.put(f"/api/rows/{new['_row']}", json={"changes": {"Stato": "Won", "Note": "ok"}})
    assert u.status_code == 200
    d = c.get("/api/data").get_json()
    assert d["rows"][-1]["Stato"] == "Won" and d["rows"][-1]["Note"] == "ok"
    assert c.post("/api/rows", json={**body, "Stato": "Boh", "Oggetto": "x"}).status_code == 400


def test_dashboard_and_clean(client):
    c, x, _ = client
    p = c.get("/api/clean/preview").get_json()
    kinds = {(i["kind"], i["new"]) for i in p}
    assert ("Stato uniformato", "Won") in kinds and ("Stato uniformato", "NoBID") in kinds
    assert not any(k[1] == "Sospeso" for k in kinds)          # Closed resta uno stato a sé
    assert ("Maiuscole/elenco", "Public Sector") in kinds
    assert any(i["kind"] == "Cliente scritto in modi diversi" for i in p)
    sel = [i for i in p if i["default"]]
    r = c.post("/api/clean/apply", json={"items": sel})
    assert r.status_code == 200
    d = c.get("/api/data").get_json()
    assert {r["Stato"] for r in d["rows"]} <= set(d["domini"]["stato"])
    db = c.get("/api/dashboard?months=all").get_json()
    assert db["kpi"]["wip"] == 1
    assert any(a["titolo"] == "Senza Data ins." for a in db["attenzioni"])


def test_normalizzazione_in_lettura(client):
    c, x, _ = client
    rows = {r["Cliente"]: r for r in c.get("/api/data").get_json()["rows"]}
    assert rows["Terna"]["Stato"] == "WIP" and rows["TERNA"]["Stato"] == "Won"
    assert rows["Inps"]["Stato"] == "NoBID" and rows["Inps"]["Market"] == "Public Sector"
    assert rows["Intesa"]["Stato"] == "Closed"                  # stato a sé, non Sospeso
    assert rows["Enel"]["Market"] == "(non indicato)"
    summ = c.get("/api/clean/summary").get_json()
    assert {"campo": "Stato", "da": "No bid", "a": "NoBID", "righe": 1, "scrivibile": True} in summ
    assert {"campo": "Market", "da": "(vuoto)", "a": "(non indicato)", "righe": 1, "scrivibile": False} in summ
    import openpyxl
    ws = openpyxl.load_workbook(x)["gare e offerte"]
    assert ws.cell(6, 15).value == "No bid"                      # il file non è stato toccato dalla lettura


def test_cruscotto_kpi_trend_esito_eta(client):
    import datetime as dt
    from core.reader import read_workbook
    from core.logic import dashboard
    c, x, _ = client
    d = read_workbook(str(x))
    db = dashboard(d["rows"], d["domini"], dt.date(2026, 10, 15), 12)
    k = db["kpi"]
    assert k["wip"] == 1 and k["waiting"] == 1
    assert k["inserite_ytd"] == {"cur": 4, "prev": 1} and k["won_ytd"] == {"cur": 1, "prev": 0}
    assert k["winrate12"]["won"] == 1 and k["winrate12"]["chiuse"] == 1      # Closed e NoBID esclusi
    t = db["trend"]
    assert t["mese"] == 10 and t["inserite"]["cur"][8] == 1 and t["inserite"]["prev"][2] == 1 and t["won"]["cur"][4] == 1
    tipi = {e["nome"]: e for e in dashboard(d["rows"], d["domini"], dt.date(2026, 10, 15), None)["esito_tipo"]}   # periodo: tutto
    assert tipi["Gara"]["totale"] == 3 and tipi["Gara"]["rate"] is None      # meno di 5 chiuse: nessun win rate
    assert tipi["RFI"]["Closed"] == 1 and tipi["Offerta diretta"]["Lost"] == 1
    eta = {f["k"]: f["n"] for f in db["eta_attesa"]["fasce"]}
    assert eta["31-90"] == 1 and eta["nd"] == 0 and db["eta_attesa"]["totale"] == 1   # Generali: consegna 10/08 -> 66 gg
    assert db["pillole"]["imminenti"] == 1 and db["pillole"]["scadute"] == 0
