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
    assert c.get("/api/referenze/cliente", query_string={"nome": "ACME ENERGIA"}).get_json() == {"n": 0, "ids": [], "attivo": False}      # nessun database ancora
    c.post("/api/referenze/carica", json={})
    for nome in ("ACME ENERGIA", "Acme Energia S.p.A.", "acme energia spa", "AcmeEnergia"):
        assert c.get("/api/referenze/cliente", query_string={"nome": nome}).get_json()["ids"] == ["REF-001"]
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


# ---------------------------------------------------------------- passo 2: creazione, modifica, archiviazione, storico, completezza

@pytest.fixture()
def rc(ref):
    c, tmp, p = ref
    assert c.post("/api/referenze/carica", json={}).status_code == 200
    return c, tmp


NUOVA = {"cliente": "Delta Trasporti", "titolo": "Ottimizzazione dei turni", "ambito": "AI", "mercato": "Trasporti & Infrastrutture",
         "tipologie": ["Ottimizzazione & Simulazione"], "pitch": "Abbiamo ottimizzato i turni.", "tecnologie": ["Python"], "anno": "2025"}


def test_crea_referenza_con_id_libero_campi_mancanti_e_materiale_automatici(rc):
    c, tmp = rc
    r = c.post("/api/referenze", json=NUOVA)
    assert r.status_code == 200
    n = r.get_json()
    assert n["id"] == "REF-004" and n["origine"] == "Inserita a mano" and n["archiviata"] is False and n["contatore"] is None
    # nessun esteso, nessuna fonte, nessun referente: le regole li segnalano da sole; anno e tecnologie sono presenti
    assert n["campi_mancanti"] == ["descrizione dettagliata", "risultati/benefici", "referente interno", "materiale di presentazione (slide/Word)"]
    assert n["materiale"] == "scarso"
    assert c.get("/api/referenze/REF-004/storico").get_json()[0]["campo"] == "_creata"
    assert c.get("/api/referenze").get_json()["totale"] == 4
    for dati, msg in (({**NUOVA, "cliente": ""}, "Cliente"), ({**NUOVA, "mercato": "Marte"}, "Mercato"), ({**NUOVA, "ambito": "Boh"}, "Ambito"), ({**NUOVA, "titolo": " "}, "Titolo"),
                      ({**NUOVA, "tipologie": ["Data Platform & Lakehouse"]}, "Tipologia"), ({**NUOVA, "anno": "20"}, "anno")):
        x = c.post("/api/referenze", json=dati)
        assert x.status_code == 400 and msg in x.get_json()["error"], dati
    assert c.get("/api/referenze").get_json()["totale"] == 4                       # nessuna scheda creata dagli errori


def test_modifica_salva_storico_e_ricalcola_i_campi_mancanti_mantenendo_quelli_a_mano(rc):
    c, tmp = rc
    r2 = [x for x in c.get("/api/referenze").get_json()["referenze"] if x["id"] == "REF-002"][0]
    assert "anno" in r2["campi_mancanti"] and "referente interno" in r2["campi_mancanti"]       # importati dal JSON
    # l'utente inserisce una voce a mano ("tecnologie") e compila anno e un referente
    cambi = {"anno": "2022", "referente_aidata": "Anna Verdi", "campi_mancanti": r2["campi_mancanti"] + ["mercato"], "pitch": "Pitch nuovo"}
    x = c.put("/api/referenze/REF-002", json=cambi).get_json()
    assert "anno" not in x["campi_mancanti"] and "referente interno" not in x["campi_mancanti"]      # sistemati: spariscono
    assert "mercato" in x["campi_mancanti"]                                                          # a mano: resta
    assert x["modificata_il"] >= r2["modificata_il"] and x["pitch"] == "Pitch nuovo"
    log = c.get("/api/referenze/REF-002/storico").get_json()
    campi = {e["campo"]: e["valore_precedente"] for e in log}
    assert campi["anno"] == "" and campi["pitch"].startswith("Per Beta Ospedali") and "campi_mancanti" in campi
    assert c.put("/api/referenze/REF-002", json={"pitch": "Pitch nuovo"}).status_code == 200
    assert len(c.get("/api/referenze/REF-002/storico").get_json()) == len(log)                       # nessuna modifica: nessuna riga di storico
    assert c.put("/api/referenze/REF-002", json={"mercato": "Marte"}).status_code == 400
    assert c.put("/api/referenze/REF-999", json={"pitch": "x"}).status_code == 400
    # il valore del materiale lo decide l'utente
    assert c.put("/api/referenze/REF-002", json={"materiale": "ricco"}).get_json()["materiale"] == "ricco"


def test_calcola_per_la_scheda_di_modifica(rc):
    c, tmp = rc
    r = c.post("/api/referenze/calcola", json={"dati": {**NUOVA, "anno": "", "esteso": [{"sezione": s, "testo": "x"} for s in ("Il contesto e la sfida", "Il valore per il cliente", "La soluzione nel dettaglio", "Dati e tecnologie")], "fonti": ["Deck"], "referente_progetto": "Mario"}}).get_json()
    assert r["campi_mancanti"] == ["anno"] and r["materiale_proposto"] == "medio"
    six = [{"sezione": f"S{i}", "testo": "x"} for i in range(6)]
    assert c.post("/api/referenze/calcola", json={"dati": {**NUOVA, "esteso": six, "fonti": ["Deck"]}}).get_json()["materiale_proposto"] == "ricco"
    assert c.post("/api/referenze/calcola", json={"dati": {**NUOVA, "esteso": six}}).get_json()["materiale_proposto"] == "medio"        # senza fonti non è ricco


def test_archivia_verifica_elimina_e_non_compare_piu(rc):
    c, tmp = rc
    assert c.post("/api/referenze/REF-001/archivia", json={"archiviata": True}).get_json()["archiviata"] is True
    assert [x["id"] for x in c.get("/api/referenze").get_json()["referenze"]] == ["REF-002", "REF-003"]
    assert len(c.get("/api/referenze", query_string={"archiviate": 1}).get_json()["referenze"]) == 3
    assert c.get("/api/referenze/cliente", query_string={"nome": "Acme Energia"}).get_json()["n"] == 0          # le archiviate non contano
    assert c.post("/api/referenze/REF-001/archivia", json={"archiviata": False}).get_json()["archiviata"] is False
    v = c.post("/api/referenze/REF-002/verifica").get_json()
    assert v["da_verificare"] is False
    assert any(e["campo"] == "da_verificare" and e["valore_precedente"] is True for e in c.get("/api/referenze/REF-002/storico").get_json())
    assert c.delete("/api/referenze/REF-003").status_code == 200
    assert [x["id"] for x in c.get("/api/referenze").get_json()["referenze"]] == ["REF-001", "REF-002"]
    el = c.get("/api/referenze/REF-003/storico").get_json()[0]
    assert el["campo"] == "_eliminata" and el["valore_precedente"]["cliente"] == "Gamma Telecom"                # la scheda intera resta recuperabile
    assert c.post("/api/referenze", json=NUOVA).get_json()["id"] == "REF-003"                                  # il primo numero libero


def test_vista_da_completare_ordinata_e_filtrata(rc):
    c, tmp = rc
    d = c.get("/api/referenze/da-completare").get_json()
    assert [r["id"] for r in d["referenze"]][0] == "REF-003"                          # la meno completa (materiale scarso) per prima
    assert d["facce"]["da_verificare"] == 1 and d["facce"]["materiale"] == {"ricco": 1, "medio": 1, "scarso": 1} and d["facce"]["mancanti"]["anno"] == 1
    assert [r["id"] for r in c.get("/api/referenze/da-completare", query_string={"da_verificare": 1}).get_json()["referenze"]] == ["REF-002"]
    assert [r["id"] for r in c.get("/api/referenze/da-completare", query_string={"mancante": "anno"}).get_json()["referenze"]] == ["REF-002"]
    assert [r["id"] for r in c.get("/api/referenze/da-completare", query_string={"materiale": "scarso"}).get_json()["referenze"]] == ["REF-003"]
    assert all("punti" in r for r in d["referenze"])


def test_le_modifiche_restano_dopo_il_riavvio(rc):
    import importlib
    c, tmp = rc
    c.put("/api/referenze/REF-001", json={"titolo": "Titolo cambiato", "segmento": "Elettrico"})
    import app as appmod
    importlib.reload(appmod)                                                           # come riavviare l'app
    appmod.app.testing = True
    c2 = appmod.app.test_client()
    r1 = [x for x in c2.get("/api/referenze").get_json()["referenze"] if x["id"] == "REF-001"][0]
    assert r1["titolo"] == "Titolo cambiato" and r1["segmento"] == "Elettrico"
    assert {e["campo"] for e in c2.get("/api/referenze/REF-001/storico").get_json()} == {"titolo", "segmento", "campi_mancanti"}      # i campi mancanti si ricalcolano da soli (qui: manca "risultati/benefici")


# ---------------------------------------------------------------- passo 3: export/import Excel e importa scheda

import io  # noqa: E402

import openpyxl  # noqa: E402


def _scarica(c):
    r = c.get("/api/referenze/export")
    assert r.status_code == 200 and "spreadsheetml" in r.mimetype and "Referenze_" in r.headers["Content-Disposition"]
    return r.data


def _carica_file(c, dati, nome="r.xlsx"):
    return c.post("/api/referenze/import/anteprima", data={"file": (io.BytesIO(dati), nome)}, content_type="multipart/form-data")


def _modifica(dati, fn):
    wb = openpyxl.load_workbook(io.BytesIO(dati))
    fn(wb["Referenze"])
    buf = io.BytesIO(); wb.save(buf)
    return buf.getvalue()


def _col(ws, nome):
    return [c.value for c in ws[1]].index(nome) + 1


INTESTAZIONI_FILE_CONSOLIDATO = ["ID", "Origine", "Contatore Excel", "Cliente", "Titolo", "Ambito", "Tipologie", "Mercato", "Segmento", "Anno", "Temi", "Tecnologie", "Pitch 30 secondi",
                                 "Racconto esteso", "Fonti", "Confidenza abbinamento", "Materiale", "Campi mancanti", "Da verificare", "Note di verifica", "Titolo originale Excel",
                                 "Descrizione originale Excel", "Referente AI&Data", "Referente Mercato", "Referente di progetto", "Owner"]


def test_export_formato_colonne_liste_e_racconto_esteso(rc):
    c, tmp = rc
    wb = openpyxl.load_workbook(io.BytesIO(_scarica(c)))
    assert wb.sheetnames == ["Referenze", "Domini", "Leggimi"]
    ws = wb["Referenze"]
    intest = [x.value for x in ws[1]]
    assert intest == INTESTAZIONI_FILE_CONSOLIDATO                              # stesse colonne e stesso ordine di Referenze_Consolidate.xlsx
    assert ws["A1"].fill.start_color.rgb == "FFFFF2CC" and ws["B1"].fill.start_color.rgb == "FFC2187A" and ws.freeze_panes == "E2"
    assert [x.value for x in wb["Domini"][1]] == ["Ambito", "Tipologie AI", "Tipologie Data", "Mercato", "Campi mancanti", "Confidenza", "Materiale"]
    riga = {intest[i]: ws.cell(2, i + 1).value for i in range(len(intest))}
    assert riga["ID"] == "REF-001" and riga["Cliente"] == "Acme Energia S.p.A." and riga["Da verificare"] == "No"
    assert riga["Tecnologie"] == "Python ; Azure ML" and riga["Temi"] == "Forecast ; Serie storiche"
    assert riga["Racconto esteso"] == ("## Il contesto e la sfida\nAcme doveva anticipare i picchi di consumo.\n\n"
                                       "## Spunti per la conversazione\n• Quali dati storici avete?\n• Che orizzonte di previsione serve?")
    assert ws.cell(3, intest.index("Da verificare") + 1).value == "Sì"                                  # REF-002
    dm = wb["Domini"]
    assert dm["A2"].value == "AI" and dm["B2"].value == "Chatbot & Assistenti virtuali" and dm["C2"].value == "Data Platform & Lakehouse" and "Sanità" in [x.value for x in dm["D"]]
    assert any("Celle gialle" in str(x.value) for x in wb["Leggimi"]["A"])


def test_export_poi_import_dello_stesso_file_non_cambia_niente(rc):
    c, tmp = rc
    # dati "difficili": paragrafi su più righe, testo che inizia con "=", anno numerico, accenti, scheda archiviata
    c.post("/api/referenze", json={**NUOVA, "pitch": "= non è una formula", "note": "riga 1\nriga 2", "esteso": [
        {"sezione": "Il contesto e la sfida", "testo": "Primo paragrafo.\n\nSecondo paragrafo, più lungo: perché sì."}, {"sezione": "Dati e tecnologie", "testo": ["Python", "Azure ML — è già qui"]}]})
    c.post("/api/referenze/REF-003/archivia", json={"archiviata": True})
    r = _carica_file(c, _scarica(c))                                                        # senza archiviate: 3 referenze, nessuna colonna "Archiviata"
    a = r.get_json()
    assert r.status_code == 200 and (len(a["nuove"]), len(a["aggiornate"]), len(a["errori"]), a["invariate"]) == (0, 0, 0, 3) and a["avvisi"] == []
    con = c.get("/api/referenze/export", query_string={"archiviate": 1}).data                # con archiviate: 4 righe e colonna "Archiviata" (Sì per REF-003)
    ws = openpyxl.load_workbook(io.BytesIO(con))["Referenze"]
    assert ws.max_row == 5 and [x.value for x in ws[1]][-1] == "Archiviata" and [ws.cell(r, 27).value for r in range(2, 6)] == ["No", "No", "Sì", "No"]
    b = _carica_file(c, con).get_json()
    assert (len(b["nuove"]), len(b["aggiornate"]), len(b["errori"]), b["invariate"]) == (0, 0, 0, 4)


def test_import_anteprima_e_applicazione_con_errori_nuove_e_aggiornate(rc):
    c, tmp = rc
    base = _scarica(c)

    def edit(ws):
        pitch, esteso, mercato, cliente = (_col(ws, x) for x in ("Pitch 30 secondi", "Racconto esteso", "Mercato", "Cliente"))
        ws.cell(2, pitch).value = "Pitch aggiornato da Excel"                                        # REF-001: cambia il pitch
        ws.cell(2, esteso).value = ws.cell(2, esteso).value + "\n\n## Il valore per il cliente\n• -12% di errore"      # e aggiunge una sezione
        ws.append([None] * len(ws[1]))
        n = ws.max_row
        for nome, v in (("Cliente", "Omega Retail"), ("Titolo", "Previsione vendite"), ("Ambito", "AI"), ("Mercato", "Retail & GDO"), ("Tipologie", "Forecasting & Modelli predittivi ; Computer Vision"), ("Anno", 2024)):
            ws.cell(n, _col(ws, nome)).value = v                                                     # nuova (senza ID); tipologia Computer Vision è valida per AI
        ws.append([None] * len(ws[1])); n += 1
        for nome, v in (("ID", "REF-999"), ("Cliente", "X"), ("Titolo", "Y"), ("Ambito", "AI"), ("Mercato", "Sanità")):
            ws.cell(n, _col(ws, nome)).value = v                                                     # ID inesistente
        ws.append([None] * len(ws[1])); n += 1
        for nome, v in (("Cliente", "Senza mercato"), ("Titolo", "T"), ("Ambito", "AI")):
            ws.cell(n, _col(ws, nome)).value = v                                                     # manca il mercato
        ws.append([None] * len(ws[1])); n += 1
        for nome, v in (("Cliente", "Mercato sbagliato"), ("Titolo", "T"), ("Ambito", "AI"), ("Mercato", "Marte")):
            ws.cell(n, _col(ws, nome)).value = v
        ws.cell(1, ws.max_column + 1).value = "Colonna inventata"
    a = _carica_file(c, _modifica(base, edit)).get_json()
    assert [x["cliente"] for x in a["nuove"]] == ["Omega Retail"] and [x["id"] for x in a["aggiornate"]] == ["REF-001"] and a["invariate"] == 2
    assert {e["n"] for e in a["errori"]} == {6, 7, 8} and any("REF-999" in e["errore"] for e in a["errori"]) and any("Marte" in e["errore"] for e in a["errori"])
    assert any("Mercato è obbligatorio" in e["errore"] for e in a["errori"]) and a["avvisi"] == ["Colonna ignorata: «Colonna inventata»"]
    campi = {x["campo"]: x for x in a["aggiornate"][0]["campi"]}
    assert set(campi) == {"pitch", "esteso"} and campi["pitch"]["prima"].startswith("Per Acme") and campi["pitch"]["dopo"] == "Pitch aggiornato da Excel"
    assert campi["esteso"]["dopo"][-1]["sezione"] == "Il valore per il cliente" and campi["esteso"]["dopo"][-1]["testo"] == ["-12% di errore"]
    # niente è cambiato finché non si applica
    assert c.get("/api/referenze").get_json()["totale"] == 3
    r = c.post("/api/referenze/import/applica", json={"token": a["token"]}).get_json()
    assert (r["creati"], r["aggiornati"], r["errori"]) == (1, 1, [])
    tutte = {x["id"]: x for x in c.get("/api/referenze").get_json()["referenze"]}
    assert tutte["REF-001"]["pitch"] == "Pitch aggiornato da Excel" and "risultati/benefici" not in tutte["REF-001"]["campi_mancanti"]      # ricalcolato: ora c'è "Il valore per il cliente"
    nuova = tutte["REF-004"]
    assert nuova["cliente"] == "Omega Retail" and nuova["origine"] == "Import Excel" and nuova["anno"] == "2024" and nuova["tipologie"] == ["Forecasting & Modelli predittivi", "Computer Vision"]
    assert {e["campo"] for e in c.get("/api/referenze/REF-001/storico").get_json()} >= {"pitch", "esteso"}
    assert os.listdir(tmp / "backup_referenze")                                                       # backup prima di applicare
    assert c.post("/api/referenze/import/applica", json={"token": a["token"]}).status_code == 400    # l'anteprima si usa una volta sola
    # ri-esportando e reimportando di nuovo: ancora nessuna differenza
    b = _carica_file(c, _scarica(c)).get_json()
    assert (len(b["nuove"]), len(b["aggiornate"]), len(b["errori"])) == (0, 0, 0)


def test_import_riconosce_intestazioni_alternative_e_colonne_mancanti(rc):
    c, tmp = rc
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Foglio1"
    ws.append(["id referenza", "CLIENTE", "In 30 secondi", "Anno"]); ws.append(["REF-002", "Beta Ospedali", "Nuovo pitch breve", 2021])
    buf = io.BytesIO(); wb.save(buf)
    a = _carica_file(c, buf.getvalue()).get_json()                       # solo 4 colonne: le altre non si toccano
    assert [x["id"] for x in a["aggiornate"]] == ["REF-002"] and {f["campo"] for f in a["aggiornate"][0]["campi"]} == {"pitch", "anno"} and a["errori"] == []
    assert _carica_file(c, b"non e' un excel").status_code == 400


def test_importa_scheda_candidati_unione_e_nuova(rc):
    c, tmp = rc
    schede = [{"cliente": "ACME ENERGIA SPA", "titolo": "Forecast della domanda elettrica per la rete di distribuzione", "ambito": "AI", "mercato": "Energy & Utilities",
               "pitch": "Pitch dal nuovo documento", "tecnologie": ["Databricks"], "fonti": ["Word nuovo"]},
              {"cliente": "Nuovo Cliente", "titolo": "Qualcosa di nuovo", "ambito": "AI", "mercato": "Servizi & IT"},
              {"cliente": "Rotta", "titolo": "Senza mercato", "ambito": "AI"}]
    a = c.post("/api/referenze/scheda/anteprima", json={"referenze": schede}).get_json()["schede"]
    assert a[0]["suggerimento"] == "REF-001" and a[0]["candidati"][0]["id"] == "REF-001" and a[0]["errori"] == []
    assert a[1]["suggerimento"] == "nuova" and a[2]["errori"] == ["Mercato è obbligatorio"]
    assert c.post("/api/referenze/scheda/anteprima", json={"x": 1}).status_code == 200                       # una singola scheda (oggetto)
    assert c.post("/api/referenze/scheda/anteprima", json=[]).status_code == 400
    r = c.post("/api/referenze/scheda/applica", json={"azioni": [
        {"tipo": "unisci", "id": "REF-001", "campi": {"tecnologie": ["Python", "Azure ML", "Databricks"], "fonti": ["Deck demo slide 1", "Word nuovo"]}},
        {"tipo": "nuova", "scheda": a[1]["scheda"]}, {"tipo": "salta", "scheda": a[2]["scheda"]},
        {"tipo": "nuova", "scheda": a[2]["scheda"]}]}).get_json()
    assert (r["creati"], r["uniti"], r["saltati"]) == (1, 1, 1) and len(r["errori"]) == 1 and "Mercato" in r["errori"][0]["errore"]
    tutte = {x["id"]: x for x in c.get("/api/referenze").get_json()["referenze"]}
    assert tutte["REF-001"]["tecnologie"] == ["Python", "Azure ML", "Databricks"] and tutte["REF-004"]["origine"] == "Import scheda" and len(tutte) == 4
    assert {e["campo"] for e in c.get("/api/referenze/REF-001/storico").get_json()} >= {"tecnologie", "fonti"}


@pytest.mark.skipif(shutil.which("node") is None, reason="serve node")
def test_testo_da_copiare_e_filtro_per_elenco_di_id():
    js = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static", "referenze.js")
    prog = r'''
const R = require(process.argv[1]);
const r = {id: "R1", cliente: "Acme", titolo: "Forecast domanda", anno: "2024", pitch: " Per Acme un modello. ", mercato: "Energy & Utilities", ambito: "AI",
  esteso: [{sezione: "Il contesto e la sfida", testo: "Troppi picchi."}, {sezione: "Spunti per la conversazione", testo: ["Quali dati?", "Che orizzonte?"]}]};
const base = {cliente: "", titolo: "", titolo_excel: "", segmento: "", pitch: "", tipologie: [], temi: [], tecnologie: [], descrizione_excel: "", ambito: "AI", mercato: "Sanità", materiale: "medio"};
const D = [{...base, id: "A", cliente: "Alia Ambiente"}, {...base, id: "B", cliente: "AliaAmbiente (Gruppo Plures)"}, {...base, id: "C", cliente: "Altro"}];
const f = o => ({q: "", cliente: "", ambito: "", tipologia: "", mercato: "", ...o});
console.log(JSON.stringify({
  testo: R.testoPerCopia(r), vuoto: R.testoPerCopia({...r, esteso: []}),
  testo_cliente: R.cerca(D, f({cliente: "alia ambiente"}), {}).map(x => x.id),                       // per testo: "Alia Ambiente" non trova "AliaAmbiente"
  per_ids: R.cerca(D, f({cliente: "Alia Ambiente", ids: new Set(["A", "B"])}), {}).map(x => x.id),   // per elenco di ID (calcolato dal server con la chiave del nome): li trova entrambi
  conteggi: (() => { const c = R.conteggi(D, f({ids: new Set(["B"])}), {}); return [c.ambito(""), c.mercato("Sanità")]; })(),
}));
'''
    o = json.loads(subprocess.run(["node", "-e", prog, js], capture_output=True, text=True, check=True).stdout)
    assert o["testo"] == ("Forecast domanda — Acme (2024)\n\nIN 30 SECONDI\nPer Acme un modello.\n\nRACCONTO ESTESO\n\nIl contesto e la sfida\nTroppi picchi.\n\n"
                          "Spunti per la conversazione\n• Quali dati?\n• Che orizzonte?\n")
    assert o["vuoto"] == "Forecast domanda — Acme (2024)\n\nIN 30 SECONDI\nPer Acme un modello.\n"
    assert o["testo_cliente"] == ["A"] and o["per_ids"] == ["A", "B"] and o["conteggi"] == [1, 1]
