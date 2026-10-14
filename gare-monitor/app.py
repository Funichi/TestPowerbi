"""Gare & Offerte — app locale che usa l'Excel come archivio principale."""
import datetime as dt
import json
import os
import sys
import threading
import webbrowser

from flask import Flask, jsonify, request, send_from_directory

from core import logic
from core.reader import DATE_FIELDS, FIELDS, clean_text, read_workbook, row_sig, to_date
from core.writer import WriteError, get_writer

FROZEN = getattr(sys, "frozen", False)
RES_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
BASE_DIR = os.path.dirname(sys.executable) if FROZEN else os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.environ.get("GARE_CONFIG", os.path.join(BASE_DIR, "config.json"))
BACKUP_DIR = os.path.join(os.path.dirname(CONFIG_PATH), "backup")

app = Flask(__name__, static_folder=os.path.join(RES_DIR, "static"), static_url_path="/static")
_cache = {"key": None, "data": None}
DEFAULT_EXCEL_PATH = r"C:\Users\ngrando\OneDrive - Engineering Ingegneria Informatica S.p.A\Solution - Documenti\Clienti\01 Amministrazione\HISTORY.xlsx"


# ------------------------------------------------------------------ config e dati

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


def get_data(force=False):
    p = excel_path()
    if not p:
        raise FileNotFoundError("File Excel non configurato o non trovato")
    st = os.stat(p)
    key = (p, st.st_mtime_ns, st.st_size)
    if force or _cache["key"] != key:
        _cache["data"] = read_workbook(p)
        _cache["key"] = key
        _cache["loaded"] = dt.datetime.now().isoformat(timespec="seconds")
    return _cache["data"]


def writer():
    cfg = load_config()
    return get_writer(excel_path(), BACKUP_DIR, cfg.get("writer", "auto"))


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
    p = cfg.get("excel_path") or DEFAULT_EXCEL_PATH
    return jsonify({"path": p, "exists": bool(excel_path()), "loaded": _cache.get("loaded"), "writer": cfg.get("writer", "auto"), "oggi": dt.date.today().isoformat()})


@app.post("/api/config")
def set_config():
    p = (request.json or {}).get("excel_path", "").strip().strip('"')
    if not os.path.isfile(p):
        raise FileNotFoundError(f"File non trovato: {p}")
    cfg = load_config()
    cfg["excel_path"] = p
    save_config(cfg)
    _cache["key"] = None
    read_workbook(p)  # fallisce subito se il formato non è quello atteso
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
    force = request.args.get("force") == "1"
    d = get_data(force)
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
    return jsonify({"rows": rows, "loaded": _cache.get("loaded"),
                    "domini": {"vertical": dom["vertical"], "market": dom["market"], "tipo": dom["tipo"], "stato": logic.STATI,
                               "solutions": sorted(solutions.values(), key=str.casefold), "clienti": sorted(clienti.values(), key=lambda c: c["Cliente"].casefold())}})


@app.get("/api/dashboard")
def dashboard():
    m = request.args.get("months", "12")
    months = None if m == "all" else int(m)
    d = get_data()
    return jsonify(logic.dashboard(d["rows"], d["domini"], dt.date.today(), months))


# ------------------------------------------------------------------ inserimento / modifica

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
    row = writer().append(vals)
    _cache["key"] = None
    return jsonify({"ok": True, "row": row, "ss": vals.get("SS")})


@app.put("/api/rows/<int:row>")
def update_row(row):
    b = request.json or {}
    d = get_data()
    cur = next((r for r in d["rows"] if r["_row"] == row), None)
    if not cur:
        raise ValueError("Riga non trovata, ricarica i dati")
    vals = _sanitize(b.get("changes", {}), d["domini"])
    changes = {f: v for f, v in vals.items() if (v or None) != (cur.get(f) or None)}
    if not changes:
        return jsonify({"ok": True, "nessuna_modifica": True})
    writer().update_many([(row, b.get("sig") or cur["_sig"], changes)])
    _cache["key"] = None
    return jsonify({"ok": True})


# ------------------------------------------------------------------ pulizia

@app.get("/api/clean/preview")
def clean_preview():
    d = get_data()
    return jsonify(logic.clean_preview(d["rows"], d["domini"]))


@app.post("/api/clean/apply")
def clean_apply():
    items = (request.json or {}).get("items", [])
    d = get_data()
    cur = {r["_row"]: r for r in d["rows"]}
    grouped = {}
    for it in items:
        r = cur.get(it["row"])
        if not r:
            continue
        grouped.setdefault(it["row"], (it["sig"], {}))[1][it["field"]] = it["new"]
    if not grouped:
        raise ValueError("Niente da applicare")
    writer().update_many([(row, sig, ch) for row, (sig, ch) in grouped.items()])
    _cache["key"] = None
    return jsonify({"ok": True, "righe": len(grouped), "modifiche": len(items)})


# ------------------------------------------------------------------ avvio

def main():
    port = int(os.environ.get("GARE_PORT", "8765"))
    url = f"http://127.0.0.1:{port}"
    print("=" * 60)
    print(" Gare & Offerte — app avviata")
    print(f" Apri il browser su {url}")
    print(" Per chiudere l'app chiudi questa finestra.")
    print("=" * 60)
    if not os.environ.get("GARE_NO_BROWSER"):
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    from werkzeug.serving import run_simple
    run_simple("127.0.0.1", port, app, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
