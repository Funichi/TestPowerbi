"""Gare & Offerte — app locale.

Archivio di lavoro: database SQLite locale (monitoraggio.db), caricato dal file Excel con "Aggiorna dall'Excel".
L'Excel viene scritto SOLO quando si preme "Esporta in Excel" (righe nuove accodate, righe modificate aggiornate).
"""
import datetime as dt
import json
import os
import sys
import threading
import webbrowser

from flask import Flask, jsonify, request, send_from_directory

from core import logic
from core.db import Store
from core.reader import DATE_FIELDS, FIELDS, clean_text, read_excel, row_sig, to_date
from core.writer import WriteError, get_writer

FROZEN = getattr(sys, "frozen", False)
RES_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
BASE_DIR = os.path.dirname(sys.executable) if FROZEN else os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.environ.get("GARE_CONFIG", os.path.join(BASE_DIR, "config.json"))
BACKUP_DIR = os.path.join(os.path.dirname(CONFIG_PATH), "backup")
DEFAULT_DB = os.path.join(os.path.dirname(CONFIG_PATH), "monitoraggio.db")
DEFAULT_EXCEL_PATH = r"C:\Users\ngrando\OneDrive - Engineering Ingegneria Informatica S.p.A\Solution - Documenti\Clienti\01 Amministrazione\HISTORY.xlsx"

app = Flask(__name__, static_folder=os.path.join(RES_DIR, "static"), static_url_path="/static")
_cache = {"v": None, "path": None, "data": None}
_store = {"obj": None}


# ------------------------------------------------------------------ config, database, dati

def load_config():
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def excel_path():
    p = load_config().get("excel_path") or DEFAULT_EXCEL_PATH
    return p if os.path.isfile(p) else None


def db_path():
    return load_config().get("db_path") or DEFAULT_DB


def store():
    p = db_path()
    if _store["obj"] is None or _store["obj"].path != p:
        _store["obj"] = Store(p)
    return _store["obj"]


def do_import():
    p = excel_path()
    if not p:
        raise FileNotFoundError("File Excel non configurato o non trovato")
    store().import_all(read_excel(p), p)


def get_data():
    st = store()
    if not st.has_data():
        do_import()                                    # primo avvio: carica l'Excel nel database
    if _cache["v"] != st.version or _cache["path"] != st.path:
        _cache.update(data=st.load(), v=st.version, path=st.path)
        _cache["loaded"] = st.meta("imported_at")
    return _cache["data"]


def writer():
    p = excel_path()
    if not p:
        raise FileNotFoundError("File Excel non trovato: controlla il percorso nelle Impostazioni")
    return get_writer(p, BACKUP_DIR, load_config().get("writer", "auto"))


@app.errorhandler(Exception)
def on_error(e):
    code = 500
    if isinstance(e, WriteError):
        code = 409
    elif isinstance(e, FileNotFoundError):
        code = 404
    elif isinstance(e, ValueError):
        code = 400
    elif hasattr(e, "code") and isinstance(e.code, int):
        code = e.code
    return jsonify({"error": str(e)}), code


# ------------------------------------------------------------------ pagine / stato

@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/favicon.ico")
def favicon():
    return "", 204


@app.get("/api/state")
def state():
    cfg = load_config()
    st = store()
    return jsonify({"path": cfg.get("excel_path") or DEFAULT_EXCEL_PATH, "excel_ok": bool(excel_path()), "db_path": st.path,
                    "exists": bool(excel_path()) or st.has_data(), "imported": st.has_data(), "imported_at": st.meta("imported_at"),
                    "pending": st.counts(), "oggi": dt.date.today().isoformat()})


@app.post("/api/config")
def set_config():
    b = request.json or {}
    cfg = load_config()
    if "excel_path" in b:
        p = (b["excel_path"] or "").strip().strip('"')
        if not os.path.isfile(p):
            raise FileNotFoundError(f"File non trovato: {p}")
        cfg["excel_path"] = p
    if b.get("db_path"):
        d = b["db_path"].strip().strip('"')
        if not os.path.isdir(os.path.dirname(os.path.abspath(d))):
            raise FileNotFoundError(f"La cartella del database non esiste: {os.path.dirname(d)}")
        cfg["db_path"] = d
    save_config(cfg)
    _cache["v"] = None
    return jsonify({"ok": True})


@app.post("/api/browse")
def browse():
    try:
        import tkinter
        from tkinter import filedialog
        root = tkinter.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        path = filedialog.askopenfilename(title="Scegli il file Excel", filetypes=[("Excel", "*.xlsx *.xlsm")])
        root.destroy()
        return jsonify({"path": path})
    except Exception as e:
        raise ValueError(f"Selettore file non disponibile, scrivi il percorso a mano ({e})")


@app.get("/api/data")
def data():
    d = get_data()
    rows = d["rows"]
    solutions = {}
    for r in rows:
        for s in logic.split_solutions(r["Solution D&A"]):
            solutions[s.casefold()] = solutions.get(s.casefold(), s)
    clienti = {}
    for r in rows:  # ultimo inserito per ogni cliente: serve a precompilare Vertical/Market
        if r["Cliente"]:
            clienti[logic.client_key(r["Cliente"])] = {"Cliente": r["Cliente"], "Vertical": r["Vertical"], "Market": r["Market"]}
    dom = d["domini"]
    return jsonify({"rows": rows, "loaded": _cache.get("loaded"), "pending": store().counts(),
                    "domini": {"vertical": dom["vertical"], "market": dom["market"], "tipo": dom["tipo"], "stato": logic.STATI,
                               "solutions": sorted(solutions.values(), key=str.casefold), "clienti": sorted(clienti.values(), key=lambda c: c["Cliente"].casefold())}})


@app.get("/api/dashboard")
def dashboard():
    m = request.args.get("months", "12")
    months = None if m == "all" else int(m)
    d = get_data()
    return jsonify(logic.dashboard(d["rows"], d["domini"], dt.date.today(), months))


# ------------------------------------------------------------------ inserimento / modifica (solo database locale)

REQUIRED_NEW = ["Cliente", "Vertical", "Market", "Oggetto", "tipo", "Data ins.", "Stato"]


@app.post("/api/suggest")
def suggest():
    b = request.json or {}
    d = get_data()
    ss = logic.suggest_ss(d["rows"], b.get("Cliente"))
    ss["commessa"] = logic.suggest_commessa(d["domini"], b.get("Vertical"), b.get("Data consegna"), b.get("Data ins."))
    return jsonify(ss)


def _sanitize(values, domini):
    out = {}
    for f, v in values.items():
        if f not in FIELDS:
            continue
        if f in DATE_FIELDS:
            if v in (None, ""):
                out[f] = None
            elif to_date(v) is None:
                raise ValueError(f"Data non valida in '{f}'")
            else:
                out[f] = to_date(v).isoformat()
        else:
            v = clean_text(v) if f != "Oggetto" else (str(v).strip() or None if v else None)
            if f == "Stato" and v:
                v = logic.norm_stato(v) or v
                if v not in logic.STATI:
                    raise ValueError(f"Stato non ammesso: {v}")
            if f in ("Vertical", "Market", "tipo") and v:
                lista = domini[f.lower()]
                match = next((x for x in lista if x.casefold() == v.casefold()), None)
                if not match:
                    raise ValueError(f"Valore non presente in Domini per {f}: {v}")
                v = match
            out[f] = v
    return out


@app.post("/api/rows")
def create_row():
    b = request.json or {}
    d = get_data()
    vals = _sanitize(b, d["domini"])
    mancanti = [f for f in REQUIRED_NEW if not vals.get(f)]
    if mancanti:
        raise ValueError("Campi obbligatori mancanti: " + ", ".join(mancanti))
    dup = [r for r in d["rows"] if r["_sig"] == row_sig(vals["Cliente"], vals["Oggetto"], vals["Data ins."])]
    if dup and not b.get("_force"):
        return jsonify({"error": f"Esiste già una riga identica (Seq {dup[0]['Seq']}). Salva comunque?", "duplicato": True}), 409
    rid = store().insert(vals)
    return jsonify({"ok": True, "id": rid})


@app.put("/api/rows/<int:rid>")
def update_row(rid):
    b = request.json or {}
    d = get_data()
    cur = next((r for r in d["rows"] if r["_row"] == rid), None)
    if not cur:
        raise ValueError("Riga non trovata, aggiorna i dati")
    vals = _sanitize(b.get("changes", {}), d["domini"])
    changes = {f: v for f, v in vals.items() if (v or None) != (cur.get(f) or None)}
    if not changes:
        return jsonify({"ok": True, "nessuna_modifica": True})
    store().update(rid, changes)
    return jsonify({"ok": True})


@app.delete("/api/rows/<int:rid>")
def delete_row(rid):
    store().delete(rid)
    return jsonify({"ok": True})


@app.post("/api/rows/<int:rid>/revert")
def revert_row(rid):
    store().revert(rid)
    return jsonify({"ok": True})


# ------------------------------------------------------------------ import / export

@app.post("/api/import")
def import_now():
    st = store()
    pend = st.counts()
    n = pend["new"] + pend["mod"]
    if n and not (request.json or {}).get("force"):
        return jsonify({"error": f"Ci sono {n} modifiche non ancora esportate: l'aggiornamento le elimina.", "conferma": True, "pending": pend}), 409
    backup = st.backup(BACKUP_DIR) if n else None
    do_import()
    return jsonify({"ok": True, "backup": backup, "righe": len(get_data()["rows"])})


@app.get("/api/pending")
def pending():
    p = store().pending_items()
    rows = {r["_row"]: r for r in get_data()["rows"]}
    nuove = [{"id": x["id"], "Cliente": x["values"].get("Cliente"), "Oggetto": x["values"].get("Oggetto"), "Stato": x["values"].get("Stato")} for x in p["new"]]
    mod = [{"id": x["id"], "xl": x["xl"], "Cliente": x["cliente"], "Oggetto": x["oggetto"],
            "campi": [{"campo": f, "prima": x["before"].get(f), "dopo": v} for f, v in x["changes"].items()]} for x in p["mod"]]
    return jsonify({"nuove": nuove, "modificate": mod})


@app.post("/api/export")
def export_now():
    st = store()
    p = st.pending_items()
    if not p["new"] and not p["mod"]:
        raise ValueError("Non c'è niente da esportare")
    rows = writer().export([x["values"] for x in p["new"]], [(x["xl"], x["sig"], x["changes"]) for x in p["mod"]])
    avviso = None
    try:
        do_import()                                    # rilegge l'Excel: il database torna identico al file
    except Exception as e:
        avviso = f"Esportazione riuscita, ma non sono riuscito a rileggere il file: {e}. Premi “Aggiorna dall'Excel”."
    return jsonify({"ok": True, "nuove": len(p["new"]), "modificate": len(p["mod"]), "righe": rows, "avviso": avviso})


# ------------------------------------------------------------------ pulizia (solo suggerimenti)

@app.get("/api/clean/preview")
def clean_preview():
    d = get_data()
    return jsonify(logic.clean_preview(d["rows"], d["domini"]))


@app.get("/api/clean/summary")
def clean_summary():
    return jsonify(logic.normalization_summary(get_data()["rows"]))


# ------------------------------------------------------------------ avvio

def main():
    port = int(os.environ.get("GARE_PORT", "8765"))
    url = f"http://127.0.0.1:{port}"
    print("=" * 60)
    print(" Gare & Offerte — app avviata")
    print(f" Apri il browser su {url}")
    print(f" Database locale: {db_path()}")
    print(" Per chiudere l'app chiudi questa finestra.")
    print("=" * 60)
    if not os.environ.get("GARE_NO_BROWSER"):
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    from werkzeug.serving import run_simple
    run_simple("127.0.0.1", port, app, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
