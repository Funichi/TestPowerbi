import datetime as dt
import hashlib
import json
import os
import shutil
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_app import client  # noqa: E402,F401  (fixture: app con Excel e database di prova)

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "referenze_finte.json")


@pytest.fixture()
def ref(client, tmp_path):
    c, x, tmp = client
    p = tmp_path / "referenze_test.json"
    shutil.copyfile(FIX, p)
    cfg = json.loads((tmp / "config.json").read_text())
    cfg["referenze_json"] = str(p)
    (tmp / "config.json").write_text(json.dumps(cfg))
    return c, tmp, p


def test_senza_database_la_vista_chiede_il_file(ref):
    c, tmp, p = ref
    os.remove(p)
    d = c.get("/api/referenze").get_json()
    assert d["stato"] == "da_caricare" and d["file_esiste"] is False and d["percorso_json"].endswith("referenze_test.json")
    assert c.post("/api/referenze/carica", json={}).status_code == 404           # file mancante: errore chiaro, non un crash
    assert not (tmp / "referenze.db").exists()


def test_primo_caricamento_crea_il_database_accanto_a_monitoraggio(ref):
    c, tmp, p = ref
    c.get("/api/data")                                                            # crea monitoraggio.db
    h = lambda f: hashlib.sha256(open(f, "rb").read()).hexdigest()
    prima = h(tmp / "monitoraggio.db")
    r = c.post("/api/referenze/carica", json={})
    assert r.status_code == 200 and r.get_json()["caricate"] == 3
    assert (tmp / "referenze.db").exists() and h(tmp / "monitoraggio.db") == prima        # database separato: l'altro non si tocca
    d = c.get("/api/referenze").get_json()
    assert d["stato"] == "ok" and d["totale"] == 3
    ids = [x["id"] for x in d["referenze"]]
    assert ids[:2] == ["REF-001", "REF-002"] and ids[2] == "REF-003"                # senza id: primo numero libero
    r1 = d["referenze"][0]
    assert r1["tipologie"] == ["Forecasting & Modelli predittivi"] and r1["esteso"][1]["testo"][0].startswith("Quali dati")
    assert r1["archiviata"] is False and r1["creata_il"] and r1["modificata_il"] and "cats" not in r1
    assert c.post("/api/referenze/carica", json={}).status_code == 400            # non si ricarica sopra un database popolato


def test_database_percorso_configurabile(ref):
    c, tmp, p = ref
    cfg = json.loads((tmp / "config.json").read_text())
    cfg["referenze_db"] = str(tmp / "altro" / "r.db")
    (tmp / "config.json").write_text(json.dumps(cfg))
    assert c.post("/api/referenze/carica", json={}).status_code == 200 and (tmp / "altro" / "r.db").exists() and not (tmp / "referenze.db").exists()


def test_backup_tiene_le_ultime_20(ref):
    from core.referenze import RefStore
    c, tmp, p = ref
    c.post("/api/referenze/carica", json={})
    st = RefStore(str(tmp / "referenze.db"))
    t0 = dt.datetime(2026, 1, 1, 10, 0)
    for i in range(25):
        assert os.path.isfile(st.backup(t0 + dt.timedelta(minutes=i)))
    files = sorted(os.listdir(tmp / "backup_referenze"))
    assert len(files) == 20 and files[0] == "referenze_20260101_1005.db" and files[-1] == "referenze_20260101_1024.db"
    assert RefStore(str(tmp / "referenze.db"), str(tmp / "bk")).count() == 3 and RefStore(str(tmp / "nuovo.db")).backup() is None


def test_cliente_abbinato_senza_maiuscole_punteggiatura_e_spa(ref):
    from core.referenze import cliente_key
    c, tmp, p = ref
    assert c.get("/api/referenze/cliente", query_string={"nome": "ACME ENERGIA"}).get_json() == {"n": 0, "attivo": False}      # nessun database ancora
    c.post("/api/referenze/carica", json={})
    for nome in ("ACME ENERGIA", "Acme Energia S.p.A.", "acme energia spa", "AcmeEnergia"):
        assert c.get("/api/referenze/cliente", query_string={"nome": nome}).get_json()["n"] == 1
    assert c.get("/api/referenze/cliente", query_string={"nome": "Altro"}).get_json()["n"] == 0
    assert cliente_key("AliaAmbiente") == cliente_key("Alia Ambiente") == "aliaambiente" and cliente_key("ENEL") == cliente_key("Enel S.p.A.")


def test_config_unica_con_domini_e_sinonimi(ref):
    c, *_ = ref
    cfg = c.get("/api/referenze/config").get_json()
    assert len(cfg["tipologie"]["AI"]) == 12 and len(cfg["tipologie"]["Data Management & Reporting"]) == 6 and len(cfg["mercati"]) == 12
    assert "Forecasting & Modelli predittivi" in cfg["tipologie"]["AI"] and "previsione" in cfg["sinonimi"]["forecast"] and len(cfg["campi_mancanti"]) == 7


def test_caricamento_solo_dal_pc_locale_e_modulo_non_nelle_altre_viste(ref):
    c, tmp, p = ref
    c.post("/api/password", json={"password": "una-password-lunga"})
    remote = {"environ_overrides": {"REMOTE_ADDR": "192.168.1.50"}}
    c.post("/login", data={"password": "una-password-lunga"}, **remote)
    assert c.post("/api/referenze/carica", json={}, **remote).status_code == 403
    base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static")
    index, appjs = (open(os.path.join(base, f), encoding="utf-8").read() for f in ("index.html", "app.js"))
    assert "referenze.js" not in index and "referenze.css" not in index                  # caricato solo alla prima apertura della vista
    assert "sinonimi" not in appjs.lower() and "punteggio(" not in appjs and "loadReferenze" in appjs


@pytest.mark.skipif(shutil.which("node") is None, reason="serve node")
def test_ricerca_sinonimi_e_ordinamento_per_pertinenza():
    js = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static", "referenze.js")
    prog = r'''
const R = require(process.argv[1]);
const SIN = R.indicizzaSinonimi({forecast: ["forecast", "previsione", "previsioni", "serie storic"], chatbot: ["chatbot", "assistente virtuale"], genai: ["genai", "chatbot", "rag"]});
const base = {cliente: "", titolo: "", titolo_excel: "", segmento: "", pitch: "", tipologie: [], temi: [], tecnologie: [], descrizione_excel: "", ambito: "AI", mercato: "Sanità", materiale: "medio"};
const D = [
  {...base, id: "D", materiale: "scarso", tipologie: ["Forecasting & Modelli predittivi"]},                         // solo tipologia: 1
  {...base, id: "C", descrizione_excel: "Modello di FORECAST sui carichi"},                                          // descrizione: 2
  {...base, id: "B", materiale: "ricco", pitch: "abbiamo costruito le previsioni dei consumi"},                      // pitch (sinonimo): 3
  {...base, id: "A", titolo: "Forecast della domanda", materiale: "scarso"},                                         // titolo: 4
  {...base, id: "B2", materiale: "medio", pitch: "previsioni dei consumi"},                                          // pari merito di B, meno completa
  {...base, id: "X", titolo: "Assistente virtuale", mercato: "Telco & Media"},
  {...base, id: "Y", titolo: "Piattaforma RAG sui documenti", mercato: "Telco & Media"},
];
const ids = f => R.cerca(D, {q: "", cliente: "", ambito: "", tipologia: "", mercato: "", ...f}, SIN).map(r => r.id);
const out = {
  forecast: ids({q: "Forecast"}),                         // ordinamento per pertinenza, a parità prima le schede più complete
  maiuscole_accenti: ids({q: "PREVISIONÌ"}),
  chatbot: ids({q: "chatbot"}), genai: ids({q: "genai"}),            // l'espansione vale in una sola direzione
  and_parole: ids({q: "piattaforma documenti"}), mercato: ids({q: "forecast", mercato: "Telco & Media"}),
  conteggi: (() => { const f = {q: "chatbot", cliente: "", ambito: "", tipologia: "", mercato: ""}; const c = R.conteggi(D, f, SIN); return [c.ambito(""), c.mercato("Telco & Media"), c.mercato("Sanità")]; })(),
};
console.log(JSON.stringify(out));
'''
    r = subprocess.run(["node", "-e", prog, js], capture_output=True, text=True, check=True)
    o = json.loads(r.stdout)
    assert o["forecast"] == ["A", "B", "B2", "C", "D"]
    assert o["maiuscole_accenti"] == ["B", "B2"] and o["chatbot"] == ["X"] and o["genai"] == ["Y"]
    assert o["and_parole"] == ["Y"] and o["mercato"] == [] and o["conteggi"] == [1, 1, 0]
