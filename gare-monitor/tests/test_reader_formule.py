"""Excel con formule salvate senza valore (file scritto senza Excel, per esempio da openpyxl): l'app ricostruisce SS e
Commessa con le stesse regole delle formule del file, invece di vederle vuote."""
import datetime as dt
import json

import openpyxl
from openpyxl.worksheet.table import Table

from core.reader import read_excel

HEAD = ["Seq", "Vertical", "Market", "Cliente", "Commessa", "SS", "Valore", "Oggetto", "Legal Entity", "tipo",
        "Data ins.", "Data Opt review", "Data consegna", "Solution D&A", "Stato"]
F_SS = ('=_xlfn.LET(_xlpm.c,Tabella4[[#This Row],[Cliente]],_xlpm.d,Tabella4[[#This Row],[Data ins.]],'
        '_xlpm.p,_xlfn.XLOOKUP(_xlpm.c,MappaSS[Cliente],MappaSS[Prefisso SS],""),"…")')


def f_com(r, col_anno="K"):
    return f'=_xlfn.IFNA(VLOOKUP(_xlfn.CONCAT(B{r},YEAR({col_anno}{r})),Tabella1[#All],3,FALSE),"")'


def crea(path):
    d = dt.datetime
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "gare e offerte"
    ws.append(HEAD)
    righe = [  # Vertical, Cliente, SS, Data ins., Data consegna, commessa sull'anno di consegna?
        ("Enterprise", "Terna", F_SS, d(2026, 9, 1), d(2026, 10, 1), False),
        ("Enterprise", "Terna", F_SS, d(2026, 5, 1), d(2026, 6, 1), False),
        ("Finance", "Generali", F_SS, d(2026, 8, 1), d(2026, 8, 20), False),
        ("Finance", "Pippo spa", F_SS, d(2026, 8, 2), d(2026, 8, 20), False),
        ("Enterprise", "TERNA", F_SS, d(2025, 3, 1), d(2026, 1, 15), True),         # anno della commessa = anno di consegna
        ("Enterprise", "Enel", "ABC9", d(2026, 2, 1), None, False),                 # SS scritto a mano: resta com'è
        ("Enterprise", "Terna", F_SS, None, None, False),                           # senza data: vuoto
    ]
    for i, (v, cli, ss, ins, cons, su_m) in enumerate(righe, start=2):
        ws.append([f"=ROW()-1", v, None, cli, f_com(i, "M" if su_m else "K"), ss, None, f"Oggetto {i}", None, "Gara", ins, None, cons, None, "WIP"])
    ws.add_table(Table(displayName="Tabella4", ref=f"A1:O{len(righe) + 1}"))
    cn = wb.create_sheet("Clienti Nuovo")
    cn.append(["Cliente", "Prefisso SS"])
    for c, p in (("Terna", "TER"), ("Generali", "GEN"), ("terna", "XXX")):      # maiuscole indifferenti: vince la prima
        cn.append([c, p])
    cn.add_table(Table(displayName="MappaSS", ref="A1:B4"))
    dm = wb.create_sheet("Domini")
    dm.append(["Chiave", "Settore", "Codice", "Anno"])
    for s, cod, a in (("Enterprise", "$E25", 2025), ("Enterprise", "$E26", 2026), ("Finance", "$F26", 2026), ("Enterprise", "$E26bis", 2026)):
        dm.append([f"=B{dm.max_row + 1}&D{dm.max_row + 1}", s, cod, a])
    dm.add_table(Table(displayName="Tabella1", ref="A1:D5"))
    wb.save(path)


def test_ss_e_commessa_ricalcolati_come_le_formule(tmp_path):
    p = tmp_path / "h.xlsx"
    crea(p)
    d = read_excel(str(p))
    r = {x["xl"]: x["cells"] for x in d["rows"]}
    assert [r[i]["SS"] for i in range(2, 9)] == ["TER1", "TER2", "GEN1", "DA CENSIRE", "TER1", "ABC9", None]
    # commessa: prima riga di Domini con quel settore e quell'anno; la riga 6 usa l'anno della data di consegna (2026)
    assert [r[i]["Commessa"] for i in range(2, 9)] == ["$E26", "$E26", "$F26", "$F26", "$E26", "$E26", None]
    assert d["ricalcolati"] == {"SS": 5, "Commessa": 6}


def test_file_con_i_valori_salvati_non_si_tocca(tmp_path):
    """Se le celle hanno il valore salvato da Excel, l'app usa quello (nessun ricalcolo)."""
    from test_app import make_xlsx
    p = tmp_path / "t.xlsx"
    make_xlsx(p)
    d = read_excel(str(p))
    assert d["ricalcolati"] == {} and [x["cells"]["SS"] for x in d["rows"]][:3] == ["TER1", "TER2", "GEN4"]


def test_avviso_nello_stato_dell_app(tmp_path, monkeypatch):
    p = tmp_path / "h.xlsx"
    crea(p)
    cfg = tmp_path / "config.json"
    cfg.write_text(json.dumps({"excel_path": str(p), "db_path": str(tmp_path / "m.db"), "writer": "openpyxl"}))
    monkeypatch.setenv("GARE_CONFIG", str(cfg))
    import importlib
    import app as appmod
    importlib.reload(appmod)
    c = appmod.app.test_client()
    righe = c.get("/api/data").get_json()["rows"]
    assert [x["SS"] for x in righe][:3] == ["TER1", "TER2", "GEN1"]
    assert c.get("/api/state").get_json()["ricalcolati"] == {"SS": 5, "Commessa": 6}
