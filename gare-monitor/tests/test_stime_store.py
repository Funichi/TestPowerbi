"""Stimometro, fase 2: catalogo, stime, snapshot, versioni, clonazione, riallineamento, versione corrente per gara."""
import copy
import os
import sqlite3

import pytest

from core import stime
from core.stime import StimaError, StimeStore, chiave_gara, differenze
from test_app import client  # noqa: F401  (fixture: app con Excel e database di prova)
from test_stime_motore import tc1

GARA = {"ss": "ter3 ", "data_ins": "2026-03-10", "cliente": "Terna", "oggetto": "Data platform"}


@pytest.fixture()
def st(tmp_path):
    return StimeStore(str(tmp_path / "stime.db"))


def dati_tc1():
    s = tc1()
    return {k: s[k] for k in ("righe", "voci_corpo", "training_be", "training_fe", "durata_mesi", "prezzo_obiettivo", "am")}


def test_chiave_della_gara():
    assert chiave_gara(" ter3", "2026-03-10") == "TER3|2026"
    assert chiave_gara("TER3", None) is None and chiave_gara("", "2026-01-01") is None
    assert chiave_gara("ABC 12", "2025-12-31T00:00:00") == "ABC12|2025"


def test_seed_del_catalogo_e_database_separato(st, tmp_path):
    k = st.catalogo()
    assert [t["codice"] for t in k["team"]] == ["BE", "FE", "PM"] and k["team"][2]["costo"] == 468
    assert len(k["moduli"]) == 9 and len(k["tipi"]) == 10 and len(k["fasi"]) == 11
    assert k["generali"]["margine_progetto"] == 0.3 and k["am"]["coeff"]["H24"] == 1.5
    assert [f["codice"] for f in k["fasi"]][:2] == ["ANA", "DIS"] and not any(m["codice"] == "ARC" for m in k["moduli"])
    assert os.listdir(tmp_path) == ["stime.db"]                                       # nessun altro file toccato
    st2 = StimeStore(st.path)                                                           # riapertura: il seed non si ripete
    assert st2.catalogo() == k


def test_crea_salva_e_ricalcola_i_totali(st):
    s = st.crea({"nome": "Data platform", "cliente": "Acme", **dati_tc1()})
    assert s["versione"] == 1 and s["corrente"] and s["famiglia"] == s["id"]
    assert s["totali"]["gg"] == 1556.5 and round(s["totali"]["prezzo"], 2) == 773966.43 and s["totali"]["margine"] == 0.3
    assert round(s["totali"]["am_prezzo"], 2) == 217297.30
    r = st.calcola(s["id"])
    assert r["risultati"]["progetto"]["TP"]["tot"] == 1276 and r["differenze"] == []
    # salvataggio: modifiche alle righe e al nome
    righe = s["righe"][:1]
    x = st.salva(s["id"], {"nome": "DP v1", "righe": righe})
    assert x["nome"] == "DP v1" and len(x["righe"]) == 1 and x["totali"]["gg"] < 1556.5
    # anche con errori di validazione il salvataggio è consentito
    righe[0]["mix"] = [0.5, 0.3, 0.1]
    y = st.salva(s["id"], {"righe": righe})
    assert y["righe"][0]["mix"] == [0.5, 0.3, 0.1] and st.calcola(s["id"])["risultati"]["export_bloccato"] is True


def test_nuova_stima_con_i_default_e_valori_non_validi(st):
    s = st.crea({"nome": "Vuota"})
    assert s["voci_corpo"] == [{"id": s["voci_corpo"][0]["id"], "nome": "Altre attività", "gg_be": 10, "gg_fe": 10}]
    assert (s["training_be"], s["training_fe"]) == (10, 10) and s["am"] == {"modalita": None}
    with pytest.raises(StimaError):
        st.salva(s["id"], {"durata_mesi": "dieci"})
    with pytest.raises(StimaError):
        st.salva(s["id"], {"righe": [{"tipo": "", "quantita": 1}]})
    assert st.salva(s["id"], {"durata_mesi": "6,5"})["durata_mesi"] == 6.5          # virgola accettata
    with pytest.raises(StimaError):
        st.leggi(9999)


def test_il_catalogo_modificato_non_cambia_le_stime_esistenti(st):
    s = st.crea({"nome": "A", **dati_tc1()})
    k = st.catalogo()
    k["team"][0]["costo"] = 400
    next(f for f in k["fasi"] if f["codice"] == "UAT")["pct"] = 0.08
    st.salva_catalogo(k)
    assert st.leggi(s["id"])["totali"]["gg"] == 1556.5                                # la stima usa il suo snapshot
    r = st.calcola(s["id"])
    assert round(r["risultati"]["progetto"]["prezzo"], 2) == 773966.43
    campi = {(d["sezione"], d["codice"], d["campo"]) for d in r["differenze"]}
    assert campi == {("team", "BE", "costo"), ("fasi", "UAT", "pct")}               # indicatore "diverso dal default"
    nuova = st.crea({"nome": "B"})
    assert nuova["snapshot"]["team"][0]["costo"] == 400                              # le stime nuove prendono il catalogo corrente


def test_regole_del_catalogo(st):
    k = st.catalogo()
    k2 = copy.deepcopy(k)
    k2["moduli"].append({"codice": "ML", "nome": "Machine learning", "blocco": "Implementazione", "pct_analisi": 0.05, "pct_disegno": 0.05})
    k2["tipi"].append({"codice": "ML.MODELLO", "modulo": "ML", "nome": "Modello", "unita": "modello", "modalita": "quantita",
                       "mix": [0.3, 0.4, 0.3], "gg": [5, 10, 20], "pct_be": 1, "pct_fe": 0})
    next(t for t in k2["tipi"] if t["codice"] == "CDC.FLUSSO")["attivo"] = False
    nuovo = st.salva_catalogo(k2)
    assert nuovo["moduli"][-1]["codice"] == "ML" and nuovo["tipi"][-1]["codice"] == "ML.MODELLO"
    assert next(t for t in nuovo["tipi"] if t["codice"] == "CDC.FLUSSO")["attivo"] is False
    errori = []
    for modifica in (
        lambda c: c["tipi"].pop(),                                                      # non si elimina
        lambda c: c["moduli"].append(dict(c["moduli"][0])),                             # codice duplicato
        lambda c: c["tipi"].append({**c["tipi"][0], "codice": "x y"}),                 # codice non valido
        lambda c: c["tipi"].append({**c["tipi"][0], "codice": "Z.Z", "modulo": "NO"}), # modulo inesistente
        lambda c: c["team"].pop(),
        lambda c: c["fasi"].pop(),
        lambda c: c["generali"].update(margine_progetto=1),
        lambda c: c["generali"].update(passo=0),
        lambda c: c["team"][0].update(costo=-1),
        lambda c: next(t for t in c["tipi"] if t["codice"] == "STG.FLUSSO").update(modulo="DWH"),
    ):
        c = copy.deepcopy(nuovo)
        modifica(c)
        with pytest.raises(StimaError):
            st.salva_catalogo(c)
        errori.append(1)
    assert len(errori) == 10 and st.catalogo() == nuovo                              # nessuna modifica parziale


def test_versioni_e_versione_corrente_per_gara(st):
    a1 = st.crea({"nome": "DP", "cliente": "Terna", "gara": GARA, **dati_tc1()})
    assert a1["gara"]["chiave"] == "TER3|2026" and a1["gara"]["oggetto"] == "Data platform" and a1["corrente"]
    a2 = st.nuova_versione(a1["id"])
    assert (a2["versione"], a2["famiglia"], a2["nome"], a2["gara"]["chiave"]) == (2, a1["famiglia"], "DP", "TER3|2026")
    assert a2["corrente"] and not st.leggi(a1["id"])["corrente"]                      # al massimo una corrente per gara
    assert len(a2["righe"]) == len(a1["righe"]) and a2["snapshot"] == a1["snapshot"] and a2["am"] == a1["am"]
    assert {r["id"] for r in a2["righe"]}.isdisjoint({r["id"] for r in a1["righe"]})  # copia, non condivisione
    st.salva(a2["id"], {"righe": []})
    assert len(st.leggi(a1["id"])["righe"]) == 5                                     # la versione 1 resta com'era
    # un'altra stima sulla stessa gara: non ruba la corrente; impostarla toglie il flag alle altre
    b = st.crea({"nome": "Alternativa", "gara": GARA})
    assert not b["corrente"]
    st.imposta_corrente(b["id"])
    corr = [x["id"] for x in st.stime_per_gara("TER3|2026") if x["corrente"]]
    assert corr == [b["id"]] and len(st.stime_per_gara("TER3|2026")) == 3
    assert st.stime_per_gara("TER3|2026")[0]["id"] == b["id"]                         # corrente per prima
    # versione 3 della famiglia DP: diventa corrente della gara
    a3 = st.nuova_versione(a1["id"])
    assert a3["versione"] == 3 and [x["id"] for x in st.stime_per_gara("TER3|2026") if x["corrente"]] == [a3["id"]]


def test_corrente_per_famiglia_senza_gara_e_cambio_gara(st):
    x1 = st.crea({"nome": "Senza gara"})
    x2 = st.nuova_versione(x1["id"])
    y = st.crea({"nome": "Altra senza gara"})
    assert x2["corrente"] and not st.leggi(x1["id"])["corrente"] and y["corrente"]    # una per famiglia
    z = st.salva(y["id"], {"gara": GARA})                                              # collegata ora a una gara senza correnti
    assert z["corrente"] and z["gara"]["chiave"] == "TER3|2026"
    with pytest.raises(StimaError):
        st.salva(y["id"], {"gara": {"ss": "TER3"}})                                    # manca la data: niente chiave


def test_clonazione(st):
    a = st.crea({"nome": "DP", "cliente": "Terna", "gara": GARA, **dati_tc1()})
    k = st.catalogo()
    k["team"][0]["costo"] = 999
    st.salva_catalogo(k)
    c = st.clona(a["id"], gara={"ss": "ENE1", "data_ins": "2026-05-01", "cliente": "Enel"}, nome="DP Enel", cliente="Enel")
    assert (c["versione"], c["nome"], c["cliente"], c["gara"]["chiave"]) == (1, "DP Enel", "Enel", "ENE1|2026")
    assert c["famiglia"] != a["famiglia"] and c["corrente"]
    assert c["snapshot"] == a["snapshot"] and c["snapshot"]["team"][0]["costo"] == 335   # stesso snapshot della sorgente, non il catalogo
    d = st.clona(a["id"])
    assert d["gara"] is None and d["nome"] == "DP (copia)"


def test_riallineamento_e_tipi_disattivati(st):
    a = st.crea({"nome": "DP", **dati_tc1()})
    a = st.salva(a["id"], {"righe": a["righe"] + [{"tipo": "CDC.FLUSSO", "etichetta": "IoT", "quantita": 10}]})
    k = st.catalogo()
    k["team"][0]["costo"] = 400
    cdc = next(t for t in k["tipi"] if t["codice"] == "CDC.FLUSSO")
    cdc["attivo"] = False
    cdc["gg"] = [9, 9, 9]
    st.salva_catalogo(k)
    anteprima = st.riallinea(a["id"])
    assert {(d["codice"], d["campo"]) for d in anteprima["differenze"]} >= {("BE", "costo"), ("CDC.FLUSSO", "attivo"), ("CDC.FLUSSO", "gg")}
    assert st.leggi(a["id"])["snapshot"]["team"][0]["costo"] == 335                    # senza conferma non cambia nulla
    r = st.riallinea(a["id"], conferma=True)
    snap = r["stima"]["snapshot"]
    assert snap["team"][0]["costo"] == 400
    t = next(t for t in snap["tipi"] if t["codice"] == "CDC.FLUSSO")
    assert t["gg"] == [1, 2, 4] and t["attivo"] is False                               # resta con i parametri precedenti
    res = st.calcola(a["id"])["risultati"]
    assert any(m["codice"] == "tipo_disattivato" for m in res["messaggi"])
    assert {(d["codice"], d["campo"]) for d in st.calcola(a["id"])["differenze"]} == {("CDC.FLUSSO", "gg")}


def test_elenco_filtri_ed_eliminazione(st):
    a = st.crea({"nome": "Data platform", "cliente": "Terna", "gara": GARA})
    b = st.crea({"nome": "Report", "cliente": "Enel"})
    assert [x["id"] for x in st.elenco()] == [b["id"], a["id"]]
    assert [x["id"] for x in st.elenco(cliente="ter")] == [a["id"]]
    assert [x["id"] for x in st.elenco(gara="TER3|2026")] == [a["id"]]
    assert [x["id"] for x in st.elenco(q="TER3")] == [a["id"]] and [x["id"] for x in st.elenco(q="report")] == [b["id"]]
    st.elimina(a["id"])
    assert [x["id"] for x in st.elenco()] == [b["id"]]
    with sqlite3.connect(st.path) as c:
        assert c.execute("SELECT COUNT(*) FROM righe_stima WHERE stima_id=?", (a["id"],)).fetchone()[0] == 0


def test_backup_tiene_le_ultime_20(st):
    import datetime as dt
    st.crea({"nome": "x"})
    for i in range(23):
        st.backup(ora=dt.datetime(2026, 11, 1, 10, 0) + dt.timedelta(minutes=i))
    assert len(os.listdir(st.backup_dir)) == 20


def test_differenze():
    from core.stime_catalogo import catalogo_default
    a, b = catalogo_default(), catalogo_default()
    assert differenze(a, b) == []
    a["generali"]["margine_progetto"] = 0.28
    assert differenze(a, b) == [{"sezione": "generali", "codice": None, "campo": "margine_progetto", "stima": 0.28, "default": 0.3}]


# ------------------------------------------------------------------ API

def test_api_stime_e_database_accanto_a_monitoraggio(client):
    c, x, tmp = client
    k = c.get("/api/stime/catalogo").get_json()
    assert len(k["tipi"]) == 10 and os.path.isfile(tmp / "stime.db")                 # accanto a monitoraggio.db
    s = c.post("/api/stime", json={"nome": "DP", "cliente": "Terna", "gara": GARA, **dati_tc1()}).get_json()
    r = c.get(f"/api/stime/{s['id']}").get_json()
    assert r["risultati"]["progetto"]["totale"] == 1556.5 and r["stima"]["gara"]["chiave"] == "TER3|2026"
    # ricalcolo in tempo reale senza salvare
    bozza = {**r["stima"], "durata_mesi": 5}
    calc = c.post("/api/stime/calcola", json=bozza).get_json()
    assert calc["progetto"]["fte"]["BE"] == pytest.approx(6.325) and c.get(f"/api/stime/{s['id']}").get_json()["stima"]["durata_mesi"] == 10
    assert c.post("/api/stime/calcola", json={}).status_code == 400
    # salva, versione, clona, corrente, riallinea, elimina
    assert c.put(f"/api/stime/{s['id']}", json={"durata_mesi": 5}).get_json()["stima"]["durata_mesi"] == 5
    v2 = c.post(f"/api/stime/{s['id']}/versione").get_json()
    assert v2["versione"] == 2 and v2["corrente"]
    assert c.post(f"/api/stime/{s['id']}/corrente").get_json()["corrente"] is True
    cl = c.post(f"/api/stime/{s['id']}/clona", json={"nome": "Copia"}).get_json()
    assert cl["nome"] == "Copia" and cl["gara"] is None
    assert c.post(f"/api/stime/{s['id']}/riallinea", json={}).get_json() == {"differenze": []}
    assert len(c.get("/api/stime?gara=TER3|2026").get_json()["stime"]) == 2
    assert c.delete(f"/api/stime/{cl['id']}").status_code == 200
    assert c.get(f"/api/stime/{cl['id']}").status_code == 400
    assert c.put("/api/stime/catalogo", json={**k, "team": k["team"][:2]}).status_code == 400
    assert c.put(f"/api/stime/{s['id']}", json={"durata_mesi": "x"}).get_json()["error"].startswith("Durata")
    # le gare dell'app restano intatte
    assert c.get("/api/data").status_code == 200


def test_api_stime_da_fuori_con_password(client):
    c, x, tmp = client
    remote = {"environ_overrides": {"REMOTE_ADDR": "192.168.1.50"}}
    assert c.get("/api/stime", **remote).status_code in (401, 403)                   # dietro lo stesso controllo d'accesso dell'app


def test_interfaccia_stime_collegata():
    """Voce di menu, icone usate e sintassi dei file dell'interfaccia (il modulo si carica solo all'apertura della vista)."""
    import shutil
    import subprocess
    base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static")
    assert 'data-view="stime"' in open(os.path.join(base, "index.html"), encoding="utf-8").read()
    js = open(os.path.join(base, "stime.js"), encoding="utf-8").read()
    icone = open(os.path.join(base, "icons.js"), encoding="utf-8").read()
    import re
    for n in set(re.findall(r'icona\("([a-z0-9-]+)"\)', js)) | {"calculator"}:
        assert f'"{n}":' in icone, n
    assert "loadStime" in open(os.path.join(base, "app.js"), encoding="utf-8").read()
    if shutil.which("node"):
        for f in ("stime.js", "app.js", "icons.js"):
            subprocess.run(["node", "--check", os.path.join(base, f)], check=True, capture_output=True)


def test_database_creato_prima_del_percorso_si_aggiorna(tmp_path):
    """Schema 1 (analisi e disegno per modulo, modulo Architettura): all'apertura il catalogo prende le fasi ANA e DIS con la
    percentuale dei moduli e disattiva Architettura; le stime salvate si adeguano alla lettura con i loro numeri."""
    import json as _json
    from core.stime_catalogo import catalogo_default
    vecchio = catalogo_default()
    vecchio["fasi"] = [f for f in vecchio["fasi"] if f["codice"] not in ("ANA", "DIS")]
    for m in vecchio["moduli"]:
        m.update(pct_analisi=0.06, pct_disegno=0.06)
    vecchio["moduli"].append({"codice": "ARC", "nome": "Architettura", "blocco": "Architettura", "pct_analisi": 0, "pct_disegno": 0, "attivo": True})
    vecchio["tipi"].append({"codice": "ARC.AMBIENTE", "modulo": "ARC", "nome": "Ambiente", "unita": "ambiente", "modalita": "quantita",
                            "mix": [0.4, 0.4, 0.2], "gg": [2, 3, 5], "pct_be": 1, "pct_fe": 0, "corpo_be": None, "corpo_fe": None, "attivo": True})
    path = str(tmp_path / "stime.db")
    with sqlite3.connect(path) as c:
        c.executescript(stime.SCHEMA)
        stime._scrivi_catalogo(c, vecchio)
        c.execute("INSERT INTO meta VALUES ('seed', 'x')")
        c.execute("INSERT INTO meta VALUES ('schema', '1')")
        c.execute("INSERT INTO stime (famiglia, versione, corrente, nome, snapshot, am, training_be, training_fe) VALUES (1, 1, 1, 'vecchia', ?, '{}', 10, 10)",
                  (_json.dumps(vecchio),))
        c.execute("INSERT INTO righe_stima (stima_id, contesto, codice_tipo, quantita, ordine) VALUES (1, 'progetto', 'STG.FLUSSO', 35, 0)")
        c.execute("INSERT INTO righe_stima (stima_id, contesto, codice_tipo, quantita, ordine) VALUES (1, 'progetto', 'ARC.AMBIENTE', 3, 1)")
    st = StimeStore(path)
    k = st.catalogo()
    assert [f["codice"] for f in k["fasi"]][:2] == ["ANA", "DIS"] and k["fasi"][0]["pct"] == 0.06
    assert next(m for m in k["moduli"] if m["codice"] == "ARC")["attivo"] is False
    assert next(t for t in k["tipi"] if t["codice"] == "ARC.AMBIENTE")["attivo"] is False
    assert "pct_analisi" not in k["moduli"][0]
    s = st.leggi(1)
    assert [f["codice"] for f in s["snapshot"]["fasi"]][:2] == ["ANA", "DIS"]
    p = st.calcola(1)["risultati"]["progetto"]
    assert p["fasi"]["ANA"]["BE"] == 1.5 and p["blocchi"]["Architettura"]["tot"] == 9    # l'Ambiente già inserito resta, con i suoi parametri
    StimeStore(path).catalogo()                                                          # la migrazione non si ripete
