"""Gare & Offerte — app locale.

Archivio di lavoro: database SQLite locale (monitoraggio.db), caricato dal file Excel con "Aggiorna dall'Excel".
L'Excel viene scritto SOLO quando si preme "Esporta in Excel" (righe nuove accodate, righe modificate aggiornate).
"""
import calendar
import datetime as dt
import json
import os
import sys
import threading
import webbrowser

import secrets
import time

from flask import Flask, jsonify, redirect, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

from core import clienti, logic, metrics, updater
from core.db import Store
from core.reader import ATT_LABELS, DATE_FIELDS, FIELDS, clean_text, read_excel, row_sig, to_date
from core.writer import WriteError, get_writer

FROZEN = getattr(sys, "frozen", False)
RES_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
BASE_DIR = os.path.dirname(sys.executable) if FROZEN else os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.environ.get("GARE_CONFIG", os.path.join(BASE_DIR, "config.json"))
BACKUP_DIR = os.path.join(os.path.dirname(CONFIG_PATH), "backup")
DEFAULT_DB = os.path.join(os.path.dirname(CONFIG_PATH), "monitoraggio.db")
DEFAULT_CLIENTI_DIR = r"C:\Users\ngrando\OneDrive - Engineering Ingegneria Informatica S.p.A\Solution - Documenti\Clienti"
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


def clienti_dir():
    d = load_config().get("clienti_dir", DEFAULT_CLIENTI_DIR)
    return d if d and os.path.isdir(d) else None


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


# ------------------------------------------------------------------ accesso da altre reti / internet
# Dal PC stesso (127.0.0.1, senza intermediari) l'app si apre senza password. Qualunque altra richiesta (rete locale, tunnel internet)
# richiede la password impostata dal PC; senza password l'accesso esterno è rifiutato.

LOCAL_ONLY = {"set_config", "browse", "cliente_cartella", "set_password", "update_check", "update_apply"}       # operazioni sul PC che ospita l'app
_fails = {}                                                                       # ip -> (tentativi, blocco fino a)


def is_local():
    host = (request.host or "").split(":")[0]
    return (request.remote_addr in ("127.0.0.1", "::1") and host in ("127.0.0.1", "localhost", "[::1]")
            and not request.headers.get("X-Forwarded-For") and not request.headers.get("Forwarded"))


def _secret_key():
    cfg = load_config()
    if not cfg.get("secret_key"):
        cfg["secret_key"] = secrets.token_hex(32)
        save_config(cfg)
    return cfg["secret_key"]


app.secret_key = _secret_key()          # la sessione si apre PRIMA di before_request: la chiave deve esistere già dal primo accesso


@app.before_request
def guard():
    if request.path.startswith("/static/") or request.path == "/favicon.ico" or is_local():
        return None
    app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax", PERMANENT_SESSION_LIFETIME=dt.timedelta(days=30),
                      SESSION_COOKIE_SECURE=request.headers.get("X-Forwarded-Proto") == "https")
    pw = load_config().get("password_hash")
    if request.path == "/login":
        return None if pw else (_login_page("L'accesso da altre reti non è attivo: imposta prima una password dalle Impostazioni, sul PC dove gira l'app.", False), 403)
    if not pw:
        return jsonify({"error": "Accesso da altre reti non attivo: imposta una password dalle Impostazioni, sul PC dove gira l'app."}), 403
    if session.get("ok"):
        if request.endpoint in LOCAL_ONLY:
            return jsonify({"error": "Questa operazione si può fare solo dal PC su cui gira l'app."}), 403
        return None
    if request.path.startswith("/api/"):
        return jsonify({"error": "Accesso richiesto", "login": True}), 401
    return redirect("/login")


def _login_page(msg="", form=True):
    return f"""<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Accesso — Gare e Offerte</title>
<link rel="stylesheet" href="/static/app.css"></head><body style="display:grid;place-items:center;min-height:100vh;background:var(--bg)">
<main class="card" style="width:min(380px,92vw)"><h2>Gare &amp; Offerte</h2><p class="muted">{msg or "Inserisci la password."}</p>
{'<form method="post" action="/login"><label for="p">Password</label><input id="p" name="password" type="password" autofocus autocomplete="current-password"><div class="foot"><button class="primary" type="submit">Entra</button></div></form>' if form else ''}</main></body></html>"""


@app.route("/login", methods=["GET", "POST"])
def login():
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip()
    n, until = _fails.get(ip, (0, 0))
    if request.method == "GET":
        return _login_page()
    if until > time.time():
        return _login_page(f"Troppi tentativi. Riprova tra {int(until - time.time()) + 1} secondi."), 429
    h = load_config().get("password_hash")
    if h and check_password_hash(h, request.form.get("password", "")):
        _fails.pop(ip, None)
        session.permanent = True
        session["ok"] = True
        return redirect("/")
    n += 1
    _fails[ip] = (n, time.time() + 60 if n >= 5 else 0)
    time.sleep(1)
    return _login_page("Password errata."), 401


@app.get("/logout")
def logout():
    session.clear()
    return redirect("/login")


@app.post("/api/password")
def set_password():
    """Imposta (o toglie, se vuota) la password per l'accesso da altre reti. Solo dal PC locale."""
    b = request.json or {}
    cfg = load_config()
    if "password" in b:
        pw = b["password"] or ""
        if pw:
            if len(pw) < 8:
                raise ValueError("La password deve avere almeno 8 caratteri")
            cfg["password_hash"] = generate_password_hash(pw)
        else:
            cfg.pop("password_hash", None)
        cfg["secret_key"] = secrets.token_hex(32)          # chiude le sessioni già aperte
        app.secret_key = cfg["secret_key"]
    if "listen_all" in b:
        cfg["listen_all"] = bool(b["listen_all"])
    save_config(cfg)
    return jsonify({"ok": True})


# ------------------------------------------------------------------ aggiornamento dell'app da GitHub (Release privata)

@app.get("/api/update/check")
def update_check():
    cfg = load_config()
    try:
        lat = updater.latest(cfg.get("github_repo") or updater.DEFAULT_REPO, cfg.get("github_token"))
    except updater.UpdateError as e:
        return jsonify({"error": str(e)}), 400
    cur = updater.current_version(BASE_DIR)
    return jsonify({"current": cur, "latest": lat["version"], "name": lat["name"], "size": lat["size"],
                    "newer": bool(lat["version"] and (cur is None or lat["version"] > cur))})


@app.post("/api/update/apply")
def update_apply():
    """Scarica l'ultima versione e lancia lo script che chiude l'app, sostituisce i file e la riavvia."""
    if not (FROZEN and os.name == "nt"):
        raise ValueError("L'aggiornamento automatico funziona solo con l'app installata (GareOfferte.exe su Windows).")
    cfg = load_config()
    try:
        lat = updater.latest(cfg.get("github_repo") or updater.DEFAULT_REPO, cfg.get("github_token"))
        zip_path = updater.download(lat["asset_url"], cfg.get("github_token"), os.path.join(BASE_DIR, "update", "app.zip"))
    except updater.UpdateError as e:
        return jsonify({"error": str(e)}), 400
    import shutil
    import subprocess
    script = os.path.join(os.environ.get("TEMP", BASE_DIR), "gare_aggiorna.ps1")      # copia: lo script originale viene sostituito durante l'aggiornamento
    shutil.copyfile(os.path.join(BASE_DIR, "Aggiorna.ps1"), script)
    subprocess.Popen(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script,
                      "-AppDir", BASE_DIR, "-Zip", zip_path, "-WaitPid", str(os.getpid())],
                     creationflags=0x00000008 | 0x00000200, close_fds=True)               # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    threading.Timer(1.0, lambda: os._exit(0)).start()
    return jsonify({"ok": True})


# ------------------------------------------------------------------ pagine / stato

@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/favicon.ico")
def favicon():
    return "", 204


def excel_newer():
    """True se il file Excel è stato modificato dopo l'ultimo import."""
    p, ts = excel_path(), store().meta("imported_at")
    try:
        return bool(p and ts and os.path.getmtime(p) > dt.datetime.fromisoformat(ts).timestamp() + 2)
    except (OSError, ValueError):
        return False


@app.get("/api/state")
def state():
    cfg = load_config()
    st = store()
    auto = False
    newer = st.has_data() and excel_newer()
    if newer and cfg.get("auto_import", True) and not any(st.counts().values()):
        try:                                           # Excel sostituito e nessuna modifica locale da perdere: rileggo da solo
            do_import()
            auto, newer = True, False
        except Exception:                              # file in copia o bloccato: riprova alla prossima richiesta
            pass
    return jsonify({"local": is_local(), "password_set": bool(cfg.get("password_hash")), "listen_all": bool(cfg.get("listen_all")),
                    "excel_newer": newer, "auto_imported": auto, "version": updater.current_version(BASE_DIR), "update_token_set": bool(cfg.get("github_token")),
                    "github_repo": cfg.get("github_repo") or updater.DEFAULT_REPO, "can_update": FROZEN and os.name == "nt","path": cfg.get("excel_path") or DEFAULT_EXCEL_PATH, "excel_ok": bool(excel_path()), "db_path": st.path,
                    "exists": bool(excel_path()) or st.has_data(), "imported": st.has_data(), "imported_at": st.meta("imported_at"),
                    "pending": st.counts(), "oggi": dt.date.today().isoformat(), "clienti_dir": clienti_dir()})


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
    for k in ("github_repo", "github_token"):
        if k in b and (b[k] or "").strip():                   # il token non si vede mai nell'interfaccia: un campo vuoto lo lascia com'è
            cfg[k] = b[k].strip()
    if "clienti_dir" in b:
        d = (b["clienti_dir"] or "").strip().strip('"')
        if d and not os.path.isdir(d):
            raise FileNotFoundError(f"Cartella clienti non trovata: {d}")
        cfg["clienti_dir"] = d
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
    per_cliente = {}
    for r in rows:  # ultimo inserito per ogni cliente: serve a precompilare Vertical/Market
        if r["Cliente"]:
            per_cliente[logic.client_key(r["Cliente"])] = {"Cliente": r["Cliente"], "Vertical": r["Vertical"], "Market": r["Market"]}
    dom = d["domini"]
    return jsonify({"rows": rows, "opzionali": clienti._opzionali(rows), "loaded": _cache.get("loaded"), "pending": store().counts(),
                    "domini": {"vertical": dom["vertical"], "market": dom["market"], "tipo": dom["tipo"], "stato": logic.STATI,
                               "solutions": sorted(solutions.values(), key=str.casefold), "clienti": sorted(per_cliente.values(), key=lambda c: c["Cliente"].casefold())}})


@app.post("/api/metrics")
def metrics_for():
    """Metriche (core/metrics.py) di un insieme di righe: serve alla riga di sintesi dell'elenco filtrato."""
    ids = set((request.json or {}).get("ids", []))
    rows = [r for r in get_data()["rows"] if r["_row"] in ids]
    return jsonify(metrics.summary(rows))


@app.get("/api/dashboard")
def dashboard():
    m = request.args.get("months", "12")
    months = None if m == "all" else int(m)
    d = get_data()
    return jsonify(logic.dashboard(d["rows"], d["domini"], dt.date.today(), months, request.args.get("anno", type=int)))


# ------------------------------------------------------------------ clienti, tempi

def _mappa_cartelle():
    return load_config().get("cartelle_clienti", {})


@app.get("/api/cliente")
def cliente():
    nome = request.args.get("nome", "")
    sc = clienti.scheda(get_data()["rows"], nome, request.args.get("anno", type=int))
    sc["cartella"] = clienti.trova_cartella(clienti_dir(), sc["nome"], _mappa_cartelle())
    return jsonify(sc)


def open_folder(path):
    """Apre la cartella in Esplora risorse (Windows); sugli altri sistemi con il visualizzatore di default."""
    if hasattr(os, "startfile"):
        os.startfile(path)
    else:
        import subprocess
        subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", path])


@app.post("/api/cliente/cartella")
def cliente_cartella():
    b = request.json or {}
    base = clienti_dir()
    if not base:
        raise FileNotFoundError("Cartella dei clienti non configurata o non raggiungibile (vedi Impostazioni)")
    nome = b.get("cartella")
    if nome:                                                     # scelta fatta dall'utente: la ricordo per questo cliente
        if nome not in clienti._cartelle(base):
            raise FileNotFoundError("Cartella non trovata")
        cfg = load_config()
        cfg.setdefault("cartelle_clienti", {})[logic.client_key(b.get("cliente"))] = nome
        save_config(cfg)
    else:
        t = clienti.trova_cartella(base, b.get("cliente"), _mappa_cartelle())
        if t["stato"] != "ok":
            raise FileNotFoundError("Cartella non trovata per questo cliente")
        nome = t["nome"]
    open_folder(os.path.join(base, nome))
    return jsonify({"ok": True, "cartella": nome})


@app.get("/api/tempi")
def tempi():
    m = request.args.get("months", "all")
    return jsonify(clienti.tempi(get_data()["rows"], dt.date.today(), None if m == "all" else int(m)))


@app.get("/api/clienti/varianti")
def clienti_varianti():
    return jsonify(clienti.varianti_clienti(get_data()["rows"]))


@app.post("/api/clienti/unisci")
def clienti_unisci():
    """Porta tutte le grafie indicate sul nome scelto: modifica solo il database locale (poi 'Esporta in Excel')."""
    b = request.json or {}
    target = clean_text(b.get("in"))
    chiavi = {logic.client_key(n) for n in b.get("nomi", [])}
    if not target or not chiavi:
        raise ValueError("Indica il nome da tenere e le grafie da unire")
    n = 0
    for r in get_data()["rows"]:
        if logic.client_key(r["Cliente"]) in chiavi and r["Cliente"] != target:
            store().update(r["_row"], {"Cliente": target})
            n += 1
    return jsonify({"ok": True, "righe": n})


# ------------------------------------------------------------------ inserimento / modifica (solo database locale)

REQUIRED_NEW = ["Cliente", "Vertical", "Market", "Oggetto", "tipo", "Data ins.", "Stato"]


@app.post("/api/suggest")
def suggest():
    b = request.json or {}
    d = get_data()
    ss = logic.suggest_ss(d["rows"], b.get("Cliente"), b.get("Data ins."))
    ss["commessa"] = logic.suggest_commessa(d["domini"], b.get("Vertical"), b.get("Data consegna"), b.get("Data ins."))
    return jsonify(ss)


def _sanitize(values, domini):
    out = {}
    for f, v in values.items():
        if f == "Attenzione":                          # 0 nessuna · 1 giallo · 2 arancione · 3 rosso
            try:
                lvl = int(v or 0)
            except (TypeError, ValueError):
                raise ValueError("Livello di attenzione non valido")
            if lvl not in (0, 1, 2, 3):
                raise ValueError("Livello di attenzione non valido")
            out[f] = lvl
            continue
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
    if not vals.get("Data consegna"):                    # senza data di consegna: fine mese (del mese di apertura)
        di = to_date(vals["Data ins."])
        vals["Data consegna"] = di.replace(day=calendar.monthrange(di.year, di.month)[1]).isoformat()
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
    nuove = [{"id": x["id"], "Cliente": x["values"].get("Cliente"), "Oggetto": x["values"].get("Oggetto"), "Stato": x["values"].get("Stato"),
              "Attenzione": ATT_LABELS[x["values"].get("Attenzione") or 0]} for x in p["new"]]
    mod = [{"id": x["id"], "xl": x["xl"], "Cliente": x["cliente"], "Oggetto": x["oggetto"],
            "campi": [{"campo": f, "prima": ATT_LABELS[x["before"].get(f) or 0] if f == "Attenzione" else x["before"].get(f),
                       "dopo": ATT_LABELS[v or 0] if f == "Attenzione" else v} for f, v in x["changes"].items()]} for x in p["mod"]]
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
    lan = bool(load_config().get("listen_all"))
    if lan:
        print(" Accesso dalla rete locale attivo (serve la password impostata nelle Impostazioni).")
    run_simple("0.0.0.0" if lan else "127.0.0.1", port, app, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
