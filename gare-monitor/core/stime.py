"""Stimometro: persistenza (stime.db, database indipendente accanto a monitoraggio.db).

Catalogo dei parametri in tabelle (seed dal §5 alla creazione), stime con la copia congelata dei parametri (snapshot),
versioni, clonazione, riallineamento ai default e versione corrente per gara. I risultati non si salvano come dati
di riferimento: si ricalcolano sempre con il motore; si memorizzano solo i totali per l'elenco e la scheda gara.

Collegamento alle gare: la tabella delle gare si ricrea a ogni import dall'Excel, quindi non ha un id stabile.
La chiave è "SS|anno della Data ins." (il codice SS è progressivo per anno); con la chiave si salva una fotografia
della gara (cliente, oggetto...) per mostrarla anche se dopo un reimport non si ritrova più.
"""
import contextlib
import copy
import datetime as dt
import json
import os
import re
import sqlite3
import threading
from decimal import Decimal

from . import stime_catalogo as cat
from .stime_motore import calcola, in_json

KEEP_BACKUP = 20

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS team (codice TEXT PRIMARY KEY, nome TEXT, contenuto TEXT, costo REAL, ordine INTEGER);
CREATE TABLE IF NOT EXISTS parametri (chiave TEXT PRIMARY KEY, valore TEXT);
CREATE TABLE IF NOT EXISTS moduli (codice TEXT PRIMARY KEY, nome TEXT, blocco TEXT, pct_analisi REAL, pct_disegno REAL,
  min_analisi REAL, max_analisi REAL, min_disegno REAL, max_disegno REAL, ordine INTEGER, attivo INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS tipi_oggetto (codice TEXT PRIMARY KEY, modulo TEXT, nome TEXT, unita TEXT, modalita TEXT,
  mix_s REAL, mix_m REAL, mix_d REAL, gg_s REAL, gg_m REAL, gg_d REAL, pct_be REAL, pct_fe REAL, corpo_be REAL, corpo_fe REAL,
  ordine INTEGER, attivo INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS fasi (codice TEXT PRIMARY KEY, nome TEXT, blocco TEXT, base TEXT, pct REAL, pct_be REAL, pct_fe REAL,
  min REAL, max REAL, ordine INTEGER);
CREATE TABLE IF NOT EXISTS stime (id INTEGER PRIMARY KEY AUTOINCREMENT, famiglia INTEGER, versione INTEGER, corrente INTEGER DEFAULT 0,
  nome TEXT, cliente TEXT, gara_chiave TEXT, gara_info TEXT, durata_mesi REAL, prezzo_obiettivo REAL, training_be REAL, training_fe REAL,
  note TEXT, snapshot TEXT, am TEXT, tot_gg REAL, tot_costo REAL, tot_prezzo REAL, tot_margine REAL, tot_am_prezzo REAL,
  creata_il TEXT, modificata_il TEXT);
CREATE INDEX IF NOT EXISTS ix_stime_gara ON stime(gara_chiave);
CREATE INDEX IF NOT EXISTS ix_stime_famiglia ON stime(famiglia);
CREATE TABLE IF NOT EXISTS righe_stima (id INTEGER PRIMARY KEY AUTOINCREMENT, stima_id INTEGER, contesto TEXT, codice_tipo TEXT, etichetta TEXT,
  quantita REAL, mix_s REAL, mix_m REAL, mix_d REAL, gg_be REAL, gg_fe REAL, ordine INTEGER);
CREATE INDEX IF NOT EXISTS ix_righe_stima ON righe_stima(stima_id);
CREATE TABLE IF NOT EXISTS voci_corpo (id INTEGER PRIMARY KEY AUTOINCREMENT, stima_id INTEGER, nome TEXT, gg_be REAL, gg_fe REAL, ordine INTEGER);
CREATE INDEX IF NOT EXISTS ix_voci_stima ON voci_corpo(stima_id);
"""
CODICE_RE = re.compile(r"^[A-Z0-9][A-Z0-9_]*(\.[A-Z0-9_]+)?$")


class StimaError(Exception):
    """Errore di dati o di regola: si mostra all'utente così com'è."""


def _ora():
    return dt.datetime.now().isoformat(timespec="seconds")


def _num(v, nome="valore", vuoto=None):
    """Numero da input (accetta la virgola). Vuoto -> vuoto; non numerico -> errore."""
    if v is None or v == "":
        return vuoto
    if isinstance(v, bool):
        raise StimaError(f"{nome}: numero non valido")
    if isinstance(v, (int, float, Decimal)):
        return float(v)
    try:
        return float(str(v).strip().replace(",", "."))
    except ValueError:
        raise StimaError(f"{nome}: numero non valido ({v!r})") from None


def _testo(v, massimo=500):
    return " ".join(str(v or "").split())[:massimo]


def chiave_gara(ss, data_ins):
    """Chiave stabile di una gara: codice SS (maiuscolo, senza spazi) + anno della Data ins. None se manca uno dei due."""
    s = re.sub(r"\s+", "", str(ss or "")).upper()
    anno = None
    if isinstance(data_ins, (dt.date, dt.datetime)):
        anno = data_ins.year
    elif data_ins:
        m = re.match(r"^(\d{4})-\d{2}-\d{2}", str(data_ins))
        anno = int(m.group(1)) if m else None
    return f"{s}|{anno}" if s and anno else None


# ------------------------------------------------------------------ catalogo <-> tabelle

def _catalogo_da_tabelle(c):
    par = {r["chiave"]: json.loads(r["valore"]) for r in c.execute("SELECT * FROM parametri")}
    generali = {k[4:]: v for k, v in par.items() if k.startswith("gen.")}
    am = {k[3:]: v for k, v in par.items() if k.startswith("am.")}
    team = [{"codice": r["codice"], "nome": r["nome"], "contenuto": r["contenuto"], "costo": r["costo"]}
            for r in c.execute("SELECT * FROM team ORDER BY ordine")]
    moduli = [{"codice": r["codice"], "nome": r["nome"], "blocco": r["blocco"], "attivo": bool(r["attivo"])}       # analisi e disegno: fasi ANA e DIS
              for r in c.execute("SELECT * FROM moduli ORDER BY ordine")]
    tipi = []
    for r in c.execute("SELECT * FROM tipi_oggetto ORDER BY ordine"):
        q = r["modalita"] == "quantita"
        tipi.append({"codice": r["codice"], "modulo": r["modulo"], "nome": r["nome"], "unita": r["unita"], "modalita": r["modalita"],
                     "mix": [r["mix_s"], r["mix_m"], r["mix_d"]] if q else None, "gg": [r["gg_s"], r["gg_m"], r["gg_d"]] if q else None,
                     "pct_be": r["pct_be"], "pct_fe": r["pct_fe"], "corpo_be": r["corpo_be"], "corpo_fe": r["corpo_fe"], "attivo": bool(r["attivo"])})
    fasi = [{"codice": r["codice"], "nome": r["nome"], "blocco": r["blocco"], "base": r["base"], "pct": r["pct"], "pct_be": r["pct_be"],
             "pct_fe": r["pct_fe"], "min": r["min"], "max": r["max"]} for r in c.execute("SELECT * FROM fasi ORDER BY ordine")]
    return {"team": team, "generali": generali, "moduli": moduli, "tipi": tipi, "fasi": fasi, "am": am}


def _scrivi_catalogo(c, k):
    c.execute("DELETE FROM team")
    c.executemany("INSERT INTO team VALUES (?,?,?,?,?)", [(t["codice"], t.get("nome"), t.get("contenuto"), t.get("costo"), i) for i, t in enumerate(k["team"])])
    c.execute("DELETE FROM parametri")
    c.executemany("INSERT INTO parametri VALUES (?,?)", [("gen." + a, json.dumps(v, ensure_ascii=False)) for a, v in k["generali"].items()]
                  + [("am." + a, json.dumps(v, ensure_ascii=False)) for a, v in k["am"].items()])
    c.execute("DELETE FROM moduli")
    c.executemany("INSERT INTO moduli VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                  [(m["codice"], m.get("nome"), m.get("blocco"), m.get("pct_analisi"), m.get("pct_disegno"), m.get("min_analisi"), m.get("max_analisi"),
                    m.get("min_disegno"), m.get("max_disegno"), i, int(m.get("attivo", True))) for i, m in enumerate(k["moduli"])])
    c.execute("DELETE FROM tipi_oggetto")
    rows = []
    for i, t in enumerate(k["tipi"]):
        mix, gg = t.get("mix") or [None] * 3, t.get("gg") or [None] * 3
        rows.append((t["codice"], t["modulo"], t.get("nome"), t.get("unita"), t.get("modalita"), *mix, *gg, t.get("pct_be"), t.get("pct_fe"),
                     t.get("corpo_be"), t.get("corpo_fe"), i, int(t.get("attivo", True))))
    c.executemany("INSERT INTO tipi_oggetto VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    c.execute("DELETE FROM fasi")
    c.executemany("INSERT INTO fasi VALUES (?,?,?,?,?,?,?,?,?,?)",
                  [(f["codice"], f.get("nome"), f.get("blocco"), f.get("base"), f.get("pct"), f.get("pct_be"), f.get("pct_fe"), f.get("min"), f.get("max"), i)
                   for i, f in enumerate(k["fasi"])])


def _pct(v, nome, vuoto=None):
    x = _num(v, nome, vuoto)
    if x is not None and x < 0:
        raise StimaError(f"{nome}: non può essere negativo")
    return x


def valida_catalogo(nuovo, attuale):
    """Controlla e normalizza un catalogo da salvare. Regole (§6.1): codici univoci e immutabili, moduli e tipi oggetto
    si aggiungono o si disattivano ma non si eliminano, team e fasi restano quelli previsti."""
    k = copy.deepcopy(nuovo)
    for sez in ("team", "generali", "moduli", "tipi", "fasi", "am"):
        if sez not in k:
            raise StimaError(f"Catalogo incompleto: manca la sezione {sez}")
    if [t["codice"] for t in k["team"]] != [t["codice"] for t in attuale["team"]]:
        raise StimaError("I team sono BE, FE e PM: non si aggiungono né si tolgono")
    if sorted(f["codice"] for f in k["fasi"]) != sorted(f["codice"] for f in attuale["fasi"]):
        raise StimaError("Le fasi non si aggiungono né si tolgono")
    for t in k["team"]:
        t["costo"] = _pct(t.get("costo"), f"Costo {t['codice']}", 0)
    for sez, nome in (("moduli", "modulo"), ("tipi", "tipo oggetto")):
        codici = [x.get("codice") for x in k[sez]]
        if len(set(codici)) != len(codici):
            raise StimaError(f"Codici {nome} duplicati")
        for x in k[sez]:
            if not CODICE_RE.match(str(x.get("codice") or "")):
                raise StimaError(f"Codice {nome} non valido: {x.get('codice')!r} (lettere maiuscole, numeri, _ e un punto)")
            if not _testo(x.get("nome")):
                raise StimaError(f"Il {nome} {x['codice']} deve avere un nome")
        mancanti = {x["codice"] for x in attuale[sez]} - set(codici)
        if mancanti:
            raise StimaError(f"Un {nome} non si elimina, si disattiva: {', '.join(sorted(mancanti))}")
    moduli = {m["codice"]: m for m in k["moduli"]}
    for m in k["moduli"]:
        if m.get("blocco") not in cat.BLOCCHI_MODULO:
            raise StimaError(f"Modulo {m['codice']}: il blocco è Implementazione o Architettura")
        for f in ("pct_analisi", "pct_disegno", "min_analisi", "max_analisi", "min_disegno", "max_disegno"):
            m.pop(f, None)                                   # analisi e disegno sono fasi (ANA, DIS) con una percentuale unica
        m["attivo"] = bool(m.get("attivo", True))
    vecchi = {t["codice"]: t for t in attuale["tipi"]}
    for t in k["tipi"]:
        if t.get("modulo") not in moduli:
            raise StimaError(f"Tipo oggetto {t['codice']}: modulo {t.get('modulo')!r} inesistente")
        if t["codice"] in vecchi and vecchi[t["codice"]]["modulo"] != t["modulo"]:
            raise StimaError(f"Tipo oggetto {t['codice']}: il modulo non si cambia dopo la creazione")
        if t.get("modalita") not in ("quantita", "corpo"):
            raise StimaError(f"Tipo oggetto {t['codice']}: modalità quantita o corpo")
        if t["modalita"] == "quantita":
            t["mix"] = [_pct(v, f"{t['codice']} mix", 0) for v in (t.get("mix") or [0, 0, 0])][:3]
            t["gg"] = [_pct(v, f"{t['codice']} giornate", 0) for v in (t.get("gg") or [0, 0, 0])][:3]
            t["pct_be"], t["pct_fe"] = _pct(t.get("pct_be"), f"{t['codice']} %BE", 0), _pct(t.get("pct_fe"), f"{t['codice']} %FE", 0)
            t["corpo_be"] = t["corpo_fe"] = None
        else:
            t["mix"] = t["gg"] = t["pct_be"] = t["pct_fe"] = None
            t["corpo_be"], t["corpo_fe"] = _pct(t.get("corpo_be"), f"{t['codice']} BE", 0), _pct(t.get("corpo_fe"), f"{t['codice']} FE", 0)
        t["attivo"] = bool(t.get("attivo", True))
    vf = {f["codice"]: f for f in attuale["fasi"]}
    for f in k["fasi"]:
        for campo in ("blocco", "base"):                               # struttura delle fasi fissa: cambiano solo le percentuali
            f[campo] = vf[f["codice"]][campo]
        f["pct"] = _pct(f.get("pct"), f"{f['codice']} %", 0)
        f.pop("gg_fissi", None)                                # nel catalogo valgono solo le percentuali
        for campo in ("pct_be", "pct_fe", "min", "max"):
            f[campo] = _pct(f.get(campo), f"{f['codice']} {campo}")
    g = k["generali"]
    for a in ("margine_progetto", "margine_am"):
        g[a] = _pct(g.get(a), a, 0)
        if g[a] >= 1:
            raise StimaError("Il margine deve essere inferiore al 100%")
    for a in ("gg_mese", "passo"):
        g[a] = _pct(g.get(a), a, 0)
        if g[a] <= 0:
            raise StimaError(f"{a}: deve essere maggiore di zero")
    for a in ("training_be", "training_fe"):
        g[a] = _pct(g.get(a), a, 0)
    g["voci_corpo"] = [{"nome": _testo(v.get("nome"), 120), "gg_be": _pct(v.get("gg_be"), "voce a corpo", 0), "gg_fe": _pct(v.get("gg_fe"), "voce a corpo", 0)}
                       for v in g.get("voci_corpo") or [] if _testo(v.get("nome"))]
    a = k["am"]
    for x in ("pct_correttiva", "pct_presa", "decalage"):
        a[x] = _pct(a.get(x), x, 0)
    a["coeff"] = {s: _pct((a.get("coeff") or {}).get(s), f"coefficiente {s}", 1) for s in cat.SERVIZI_AM}
    a["anni_max"] = int(_pct(a.get("anni_max"), "anni massimi", 5))
    return k


# ------------------------------------------------------------------ differenze tra snapshot e catalogo corrente

def _canon(v):
    if isinstance(v, bool) or v is None or isinstance(v, str):
        return v
    if isinstance(v, (int, float, Decimal)):
        return float(v)
    if isinstance(v, dict):
        return {k: _canon(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_canon(x) for x in v]
    return v


def differenze(snap, catalogo):
    """Valori dello snapshot diversi dal default corrente: [{sezione, codice, campo, stima, default}] (§4.13, §6.3)."""
    out = []

    def conf(sezione, codice, campo, a, b):
        if _canon(a) != _canon(b):                       # 10 e 10.0 sono lo stesso valore
            out.append({"sezione": sezione, "codice": codice, "campo": campo, "stima": a, "default": b})

    for sez in ("team", "moduli", "tipi", "fasi"):
        cur = {x["codice"]: x for x in catalogo.get(sez, [])}
        for x in snap.get(sez, []):
            d = cur.get(x["codice"])
            if d is None:
                out.append({"sezione": sez, "codice": x["codice"], "campo": None, "stima": "presente", "default": "assente"})
                continue
            for campo in sorted(set(x) | set(d)):
                if campo not in ("codice", "ordine", "gg_fissi"):
                    conf(sez, x["codice"], campo, x.get(campo), d.get(campo))
    for sez in ("generali", "am"):
        a, b = snap.get(sez, {}), catalogo.get(sez, {})
        for campo in sorted(set(a) | set(b)):
            conf(sez, None, campo, a.get(campo), b.get(campo))
    return out


def snapshot_riallineato(snap, catalogo, codici_usati):
    """Nuovo snapshot = catalogo corrente; i tipi oggetto usati dalle righe ma disattivati o assenti nel catalogo restano
    con i parametri precedenti (e il loro modulo), così la stima resta calcolabile e il motore lo segnala con un avviso."""
    nuovo = copy.deepcopy(catalogo)
    fissi = {f["codice"]: f.get("gg_fissi") for f in snap.get("fasi", []) if f.get("gg_fissi") is not None}
    for f in nuovo["fasi"]:
        if f["codice"] in fissi:
            f["gg_fissi"] = fissi[f["codice"]]                 # le giornate fisse sono una scelta della stima: restano
    tipi = {t["codice"]: t for t in nuovo["tipi"]}
    moduli = {m["codice"]: m for m in nuovo["moduli"]}
    vecchi_t = {t["codice"]: t for t in snap.get("tipi", [])}
    vecchi_m = {m["codice"]: m for m in snap.get("moduli", [])}
    for codice in codici_usati:
        t = tipi.get(codice)
        if (t is None or not t.get("attivo", True)) and codice in vecchi_t:
            vecchio = copy.deepcopy(vecchi_t[codice])
            vecchio["attivo"] = False
            if t is None:
                nuovo["tipi"].append(vecchio)
            else:
                nuovo["tipi"][nuovo["tipi"].index(t)] = vecchio
            if vecchio["modulo"] not in moduli and vecchio["modulo"] in vecchi_m:
                nuovo["moduli"].append(copy.deepcopy(vecchi_m[vecchio["modulo"]]))
                moduli[vecchio["modulo"]] = nuovo["moduli"][-1]
    return nuovo


# ------------------------------------------------------------------ archivio

class StimeStore:
    def __init__(self, path, backup_dir=None):
        self.path = path
        self.backup_dir = backup_dir or os.path.join(os.path.dirname(os.path.abspath(path)), "backup_stime")
        self._lock = threading.RLock()
        self._pronto = False

    @contextlib.contextmanager
    def conn(self):
        if not self._pronto:
            self.init()
        c = sqlite3.connect(self.path, timeout=20)
        c.row_factory = sqlite3.Row
        try:
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise
        finally:
            c.close()

    def init(self):
        """Crea tabelle e seed del catalogo (solo la prima volta). Non tocca mai altri database."""
        os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
        with self._lock:
            c = sqlite3.connect(self.path, timeout=20)
            try:
                c.row_factory = sqlite3.Row
                c.executescript(SCHEMA)
                if not c.execute("SELECT 1 FROM meta WHERE k='seed'").fetchone():
                    _scrivi_catalogo(c, cat.catalogo_default())
                    c.execute("INSERT INTO meta VALUES ('seed', ?)", (_ora(),))
                    c.execute("INSERT OR REPLACE INTO meta VALUES ('schema', '3')")
                self._migra(c)
                self._migra3(c)
                c.commit()
            finally:
                c.close()
        self._pronto = True

    @staticmethod
    def _migra(c):
        """Schema 2 (percorso): analisi e disegno diventano fasi a percentuale unica (ANA, DIS) e il modulo Architettura
        si disattiva (al suo posto, se serve, un'attività a corpo). Le stime esistenti si adeguano alla lettura."""
        r = c.execute("SELECT v FROM meta WHERE k='schema'").fetchone()
        if r and r[0] >= "2":
            return
        pa = c.execute("SELECT pct_analisi, pct_disegno FROM moduli WHERE pct_analisi IS NOT NULL ORDER BY ordine LIMIT 1").fetchone()
        k = _catalogo_da_tabelle(c)
        k["moduli"] = [{**m, "pct_analisi": pa[0] if pa else 0.06, "pct_disegno": pa[1] if pa else 0.06} for m in k["moduli"]]
        cat.migra_snapshot(k)
        for m in k["moduli"]:
            m.pop("pct_analisi", None), m.pop("pct_disegno", None)
            if m["codice"] == "ARC":
                m["attivo"] = False
        for t in k["tipi"]:
            if t["modulo"] == "ARC":
                t["attivo"] = False
        _scrivi_catalogo(c, k)
        c.execute("INSERT OR REPLACE INTO meta VALUES ('schema', '2')")

    @staticmethod
    def _migra3(c):
        """Schema 3: la sicurezza non è più una percentuale sui moduli ma un'attività a corpo; nel catalogo spariscono la fase SEC
        e compaiono le attività di base (setup degli ambienti, gestione della sicurezza del dato). Le stime già salvate restano
        come sono (la loro copia dei parametri conserva la sicurezza in percentuale)."""
        r = c.execute("SELECT v FROM meta WHERE k='schema'").fetchone()
        if r and r[0] >= "3":
            return
        k = _catalogo_da_tabelle(c)
        k["fasi"] = [f for f in k["fasi"] if f["codice"] != "SEC"]
        voci = k["generali"].get("voci_corpo") or []
        nomi = {v.get("nome") for v in voci}
        base = [v for v in cat.catalogo_default()["generali"]["voci_corpo"] if v["nome"] != "Altre attività" and v["nome"] not in nomi]
        k["generali"]["voci_corpo"] = base + voci
        _scrivi_catalogo(c, k)
        c.execute("INSERT OR REPLACE INTO meta VALUES ('schema', '3')")

    def backup(self, ora=None):
        """Copia coerente in backup_stime/stime_AAAAMMGG_HHMM.db; tiene le ultime 20."""
        if not os.path.isfile(self.path):
            return None
        os.makedirs(self.backup_dir, exist_ok=True)
        dest = os.path.join(self.backup_dir, f"stime_{(ora or dt.datetime.now()).strftime('%Y%m%d_%H%M')}.db")
        with self._lock:
            src, dst = sqlite3.connect(self.path), sqlite3.connect(dest)
            try:
                src.backup(dst)
            finally:
                dst.close()
                src.close()
        vecchi = sorted(f for f in os.listdir(self.backup_dir) if re.fullmatch(r"stime_\d{8}_\d{4}\.db", f))
        for f in vecchi[:-KEEP_BACKUP]:
            os.remove(os.path.join(self.backup_dir, f))
        return dest

    # ---------------------------------------------------------------- catalogo
    def catalogo(self):
        with self.conn() as c:
            return _catalogo_da_tabelle(c)

    def salva_catalogo(self, nuovo):
        """Sostituisce il catalogo (dopo la validazione). Le stime esistenti non cambiano: hanno il loro snapshot."""
        with self._lock, self.conn() as c:
            k = valida_catalogo(nuovo, _catalogo_da_tabelle(c))
            _scrivi_catalogo(c, k)
            c.execute("INSERT OR REPLACE INTO meta VALUES ('catalogo_modificato_il', ?)", (_ora(),))
            return _catalogo_da_tabelle(c)

    # ---------------------------------------------------------------- lettura
    @staticmethod
    def _stima(c, r):
        righe = []
        for x in c.execute("SELECT * FROM righe_stima WHERE stima_id=? ORDER BY ordine, id", (r["id"],)):
            mix = [x["mix_s"], x["mix_m"], x["mix_d"]]
            righe.append({"id": x["id"], "contesto": x["contesto"], "tipo": x["codice_tipo"], "etichetta": x["etichetta"] or "", "quantita": x["quantita"],
                          "mix": mix if all(v is not None for v in mix) else None, "gg_be": x["gg_be"], "gg_fe": x["gg_fe"]})
        voci = [{"id": x["id"], "nome": x["nome"], "gg_be": x["gg_be"], "gg_fe": x["gg_fe"]}
                for x in c.execute("SELECT * FROM voci_corpo WHERE stima_id=? ORDER BY ordine, id", (r["id"],))]
        info = json.loads(r["gara_info"]) if r["gara_info"] else None
        return {"id": r["id"], "famiglia": r["famiglia"], "versione": r["versione"], "corrente": bool(r["corrente"]), "nome": r["nome"] or "",
                "cliente": r["cliente"] or "", "gara": ({**info, "chiave": r["gara_chiave"]} if r["gara_chiave"] else None),
                "durata_mesi": r["durata_mesi"], "prezzo_obiettivo": r["prezzo_obiettivo"], "training_be": r["training_be"], "training_fe": r["training_fe"],
                "note": r["note"] or "", "snapshot": StimeStore._snapshot(r["snapshot"]), "am": json.loads(r["am"]) if r["am"] else {"modalita": None},
                "righe": righe, "voci_corpo": voci, "creata_il": r["creata_il"], "modificata_il": r["modificata_il"],
                "totali": {"gg": r["tot_gg"], "costo": r["tot_costo"], "prezzo": r["tot_prezzo"], "margine": r["tot_margine"], "am_prezzo": r["tot_am_prezzo"]}}

    @staticmethod
    def _snapshot(testo):
        snap = json.loads(testo)
        if snap.get("tipi"):
            cat.migra_snapshot(snap)                         # stime create prima della percentuale unica di analisi e disegno
        return snap

    def _riga_stima(self, c, sid):
        r = c.execute("SELECT * FROM stime WHERE id=?", (sid,)).fetchone()
        if not r:
            raise StimaError("Stima non trovata")
        return r

    def leggi(self, sid):
        with self.conn() as c:
            return self._stima(c, self._riga_stima(c, sid))

    def elenco(self, cliente=None, gara=None, q=None):
        """Righe dell'elenco stime (§6.2), dalla più recente. Filtri: cliente, chiave gara, testo libero."""
        sql, par = "SELECT * FROM stime WHERE 1=1", []
        if cliente:
            sql += " AND lower(cliente) LIKE ?"
            par.append(f"%{cliente.strip().lower()}%")
        if gara:
            sql += " AND gara_chiave=?"
            par.append(gara)
        out = []
        with self.conn() as c:
            for r in c.execute(sql + " ORDER BY modificata_il DESC, id DESC", par):
                info = json.loads(r["gara_info"]) if r["gara_info"] else None
                x = {"id": r["id"], "famiglia": r["famiglia"], "nome": r["nome"], "cliente": r["cliente"], "versione": r["versione"],
                     "corrente": bool(r["corrente"]), "gara": ({**info, "chiave": r["gara_chiave"]} if r["gara_chiave"] else None),
                     "gg": r["tot_gg"], "costo": r["tot_costo"], "prezzo": r["tot_prezzo"], "margine": r["tot_margine"], "am_prezzo": r["tot_am_prezzo"],
                     "modificata_il": r["modificata_il"]}
                if q:
                    testo = " ".join(str(v or "") for v in (x["nome"], x["cliente"], (info or {}).get("ss"), (info or {}).get("oggetto"))).lower()
                    if q.strip().lower() not in testo:
                        continue
                out.append(x)
        return out

    def calcola(self, sid):
        """Stima letta dal database + risultati del motore + differenze dal catalogo corrente."""
        s = self.leggi(sid)
        return {"stima": s, "risultati": in_json(calcola(s)), "differenze": differenze(s["snapshot"], self.catalogo())}

    # ---------------------------------------------------------------- scrittura
    @staticmethod
    def _gara(gara):
        """Dal client: {ss, data_ins|anno, cliente, oggetto} o {chiave, ...}. Restituisce (chiave, fotografia) o (None, None)."""
        if not gara:
            return None, None
        chiave = gara.get("chiave") or chiave_gara(gara.get("ss"), gara.get("data_ins") or (f"{gara['anno']}-01-01" if gara.get("anno") else None))
        if not chiave:
            raise StimaError("Per collegare una gara servono il codice SS e la data di inserimento")
        ss, anno = chiave.split("|")
        info = {"ss": ss, "anno": int(anno), "cliente": _testo(gara.get("cliente"), 200), "oggetto": _testo(gara.get("oggetto"), 300)}
        return chiave, json.dumps(info, ensure_ascii=False)

    @staticmethod
    def _righe_pulite(righe):
        out = []
        for i, r in enumerate(righe or []):
            contesto = r.get("contesto") or "progetto"
            if contesto not in ("progetto", "am_esercizio"):
                raise StimaError(f"Riga {i + 1}: contesto non valido")
            if not r.get("tipo"):
                raise StimaError(f"Riga {i + 1}: manca il tipo oggetto")
            mix = r.get("mix")
            mix = [_num(v, f"Riga {i + 1} mix", 0) for v in mix][:3] if mix else [None, None, None]
            out.append((contesto, str(r["tipo"]), _testo(r.get("etichetta"), 200), _num(r.get("quantita"), f"Riga {i + 1} quantità"), *mix,
                        _num(r.get("gg_be"), f"Riga {i + 1} giornate BE"), _num(r.get("gg_fe"), f"Riga {i + 1} giornate FE"), i))
        return out

    def _scrivi(self, c, sid, s, ora):
        """Scrive campi, righe e voci della stima e ricalcola i totali memorizzati."""
        chiave, info = self._gara(s.get("gara"))
        snap = s["snapshot"]
        am = s.get("am") or {"modalita": None}
        if am.get("modalita") not in (None, "manuale", "driver"):
            raise StimaError("Modalità AM non valida")
        campi = {"nome": _testo(s.get("nome"), 200) or "Stima senza nome", "cliente": _testo(s.get("cliente"), 200),
                 "gara_chiave": chiave, "gara_info": info, "durata_mesi": _num(s.get("durata_mesi"), "Durata"),
                 "prezzo_obiettivo": _num(s.get("prezzo_obiettivo"), "Prezzo obiettivo"),
                 "training_be": _num(s.get("training_be"), "Training BE", 0), "training_fe": _num(s.get("training_fe"), "Training FE", 0),
                 "note": str(s.get("note") or "")[:5000], "snapshot": json.dumps(snap, ensure_ascii=False), "am": json.dumps(am, ensure_ascii=False),
                 "modificata_il": ora}
        c.execute(f"UPDATE stime SET {', '.join(k + '=?' for k in campi)} WHERE id=?", [*campi.values(), sid])
        c.execute("DELETE FROM righe_stima WHERE stima_id=?", (sid,))
        c.executemany("INSERT INTO righe_stima (stima_id, contesto, codice_tipo, etichetta, quantita, mix_s, mix_m, mix_d, gg_be, gg_fe, ordine) "
                      "VALUES (?,?,?,?,?,?,?,?,?,?,?)", [(sid, *r) for r in self._righe_pulite(s.get("righe"))])
        c.execute("DELETE FROM voci_corpo WHERE stima_id=?", (sid,))
        c.executemany("INSERT INTO voci_corpo (stima_id, nome, gg_be, gg_fe, ordine) VALUES (?,?,?,?,?)",
                      [(sid, _testo(v.get("nome"), 120), _num(v.get("gg_be"), "Voce a corpo", 0), _num(v.get("gg_fe"), "Voce a corpo", 0), i)
                       for i, v in enumerate(s.get("voci_corpo") or [])])
        self._totali(c, sid)

    def _totali(self, c, sid):
        """Totali memorizzati per l'elenco e la scheda gara (solo progetto; l'AM a parte)."""
        s = self._stima(c, self._riga_stima(c, sid))
        res = calcola(s)
        p, am = res["progetto"], res["am"]
        f = lambda x: None if x is None else float(x)
        c.execute("UPDATE stime SET tot_gg=?, tot_costo=?, tot_prezzo=?, tot_margine=?, tot_am_prezzo=? WHERE id=?",
                  (f(p["totale"]), f(p["costi"]["tot"]), f(p["prezzo"]), f(p["margine"]), f(am["prezzo"]) if am else None, sid))

    def _rendi_corrente(self, c, sid):
        """Al massimo una versione corrente per gara; per le stime senza gara, una per famiglia."""
        r = self._riga_stima(c, sid)
        if r["gara_chiave"]:
            c.execute("UPDATE stime SET corrente=0 WHERE gara_chiave=?", (r["gara_chiave"],))
        else:
            c.execute("UPDATE stime SET corrente=0 WHERE famiglia=? AND gara_chiave IS NULL", (r["famiglia"],))
        c.execute("UPDATE stime SET corrente=1 WHERE id=?", (sid,))

    def _nessuna_corrente(self, c, sid):
        r = self._riga_stima(c, sid)
        if r["gara_chiave"]:
            return not c.execute("SELECT 1 FROM stime WHERE gara_chiave=? AND corrente=1 AND id<>?", (r["gara_chiave"], sid)).fetchone()
        return not c.execute("SELECT 1 FROM stime WHERE famiglia=? AND gara_chiave IS NULL AND corrente=1 AND id<>?", (r["famiglia"], sid)).fetchone()

    def _inserisci(self, c, famiglia, versione, ora):
        sid = c.execute("INSERT INTO stime (famiglia, versione, corrente, creata_il, modificata_il, snapshot) VALUES (?,?,0,?,?,'{}')",
                        (famiglia, versione, ora, ora)).lastrowid
        if famiglia is None:
            c.execute("UPDATE stime SET famiglia=? WHERE id=?", (sid, sid))
        return sid

    def crea(self, dati=None, ora=None):
        """Nuova stima: snapshot = copia del catalogo corrente; training e voci a corpo dai default. Versione 1.
        Diventa la corrente se la sua gara (o la sua famiglia) non ne ha già una."""
        ora = ora or _ora()
        dati = dati or {}
        with self._lock, self.conn() as c:
            s = cat.stima_nuova(_catalogo_da_tabelle(c))
            for k in ("nome", "cliente", "gara", "durata_mesi", "prezzo_obiettivo", "note", "am", "righe", "voci_corpo", "training_be", "training_fe"):
                if k in dati:
                    s[k] = dati[k]
            sid = self._inserisci(c, None, 1, ora)
            self._scrivi(c, sid, s, ora)
            if self._nessuna_corrente(c, sid):
                self._rendi_corrente(c, sid)
            return self._stima(c, self._riga_stima(c, sid))

    def salva(self, sid, dati, ora=None):
        """Aggiorna la versione aperta. Il salvataggio è sempre consentito, anche con errori di validazione (bloccano solo l'export)."""
        ora = ora or _ora()
        with self._lock, self.conn() as c:
            prima = self._stima(c, self._riga_stima(c, sid))
            s = {**prima, **{k: v for k, v in dati.items() if k in ("nome", "cliente", "gara", "durata_mesi", "prezzo_obiettivo", "note", "am", "righe",
                                                                       "voci_corpo", "training_be", "training_fe", "snapshot")}}
            if not isinstance(s.get("snapshot"), dict) or not s["snapshot"].get("tipi"):
                raise StimaError("Parametri della stima mancanti")
            gara_prima = prima["gara"]["chiave"] if prima["gara"] else None
            self._scrivi(c, sid, s, ora)
            r = self._riga_stima(c, sid)
            if r["gara_chiave"] != gara_prima:                       # cambiata la gara: la corrente si valuta sulla nuova
                c.execute("UPDATE stime SET corrente=0 WHERE id=?", (sid,))
                if self._nessuna_corrente(c, sid):
                    self._rendi_corrente(c, sid)
            return self._stima(c, self._riga_stima(c, sid))

    def _copia(self, c, sorgente, famiglia, versione, ora, **cambi):
        sid = self._inserisci(c, famiglia, versione, ora)
        s = {**sorgente, **cambi}
        self._scrivi(c, sid, s, ora)
        return sid

    def nuova_versione(self, sid, ora=None):
        """Copia completa (righe, voci, snapshot, AM) con versione + 1, stessa gara e stesso nome; diventa la corrente."""
        ora = ora or _ora()
        with self._lock, self.conn() as c:
            s = self._stima(c, self._riga_stima(c, sid))
            v = c.execute("SELECT MAX(versione) FROM stime WHERE famiglia=?", (s["famiglia"],)).fetchone()[0] or 0
            nid = self._copia(c, s, s["famiglia"], v + 1, ora)
            self._rendi_corrente(c, nid)
            return self._stima(c, self._riga_stima(c, nid))

    def clona(self, sid, gara=None, nome=None, cliente=None, ora=None):
        """Stima indipendente in versione 1 con lo stesso snapshot della sorgente; la gara si sceglie ora (anche nessuna)."""
        ora = ora or _ora()
        with self._lock, self.conn() as c:
            s = self._stima(c, self._riga_stima(c, sid))
            cambi = {"gara": gara, "nome": nome if nome is not None else f"{s['nome']} (copia)"}
            if cliente is not None:
                cambi["cliente"] = cliente
            nid = self._copia(c, s, None, 1, ora, **cambi)
            if self._nessuna_corrente(c, nid):
                self._rendi_corrente(c, nid)
            return self._stima(c, self._riga_stima(c, nid))

    def imposta_corrente(self, sid):
        with self._lock, self.conn() as c:
            self._rendi_corrente(c, sid)
            return self._stima(c, self._riga_stima(c, sid))

    def elimina(self, sid):
        with self._lock, self.conn() as c:
            self._riga_stima(c, sid)
            c.execute("DELETE FROM righe_stima WHERE stima_id=?", (sid,))
            c.execute("DELETE FROM voci_corpo WHERE stima_id=?", (sid,))
            c.execute("DELETE FROM stime WHERE id=?", (sid,))

    def riallinea(self, sid, conferma=False, ora=None):
        """Senza conferma: elenco delle differenze dal catalogo corrente. Con conferma: sostituisce lo snapshot con il
        catalogo corrente (i tipi oggetto disattivati usati dalle righe restano con i parametri precedenti) e salva."""
        with self._lock, self.conn() as c:
            s = self._stima(c, self._riga_stima(c, sid))
            catalogo = _catalogo_da_tabelle(c)
            diff = differenze(s["snapshot"], catalogo)
            if not conferma:
                return {"differenze": diff}
            usati = {r["tipo"] for r in s["righe"]}
            s["snapshot"] = snapshot_riallineato(s["snapshot"], catalogo, usati)
            self._scrivi(c, sid, s, ora or _ora())
            return {"differenze": diff, "stima": self._stima(c, self._riga_stima(c, sid))}

    def stime_per_gara(self, chiave):
        """Versioni collegate a una gara, per la scheda gara (corrente per prima)."""
        return sorted(self.elenco(gara=chiave), key=lambda x: (not x["corrente"], -(x["versione"] or 0)))
