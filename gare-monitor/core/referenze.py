"""Modulo Referenze: database SQLite SEPARATO (referenze.db), primo caricamento da referenze.json, backup all'avvio, lettura."""
import datetime as dt
import json
import os
import re
import sqlite3
import threading
import unicodedata

from . import referenze_cfg as cfg

KEEP_BACKUPS = 20
LISTE = ("tipologie", "temi", "tecnologie", "fonti", "documenti", "campi_mancanti")
TESTI = ("origine", "cliente", "titolo", "titolo_excel", "ambito", "mercato", "segmento", "anno", "pitch", "confidenza", "materiale", "note",
         "descrizione_excel", "tecnologie_excel", "referente_aidata", "referente_mercato", "referente_progetto", "owner")
FORME_SOCIETARIE = {"spa", "srl", "sas", "snc", "scarl", "scpa", "srls", "sapa", "ss"}


class RefError(Exception):
    pass


def cliente_key(nome):
    """Chiave per confrontare i nomi cliente: ignora maiuscole, accenti, punteggiatura, parentesi, S.p.A./S.r.l. e spazi
    ('ENEL' = 'Enel', 'AliaAmbiente' = 'Alia Ambiente')."""
    s = unicodedata.normalize("NFKD", str(nome or "")).encode("ascii", "ignore").decode().casefold()
    s = re.sub(r"\([^)]*\)", " ", s)
    s = re.sub(r"\b([a-z])\.(?=[a-z]\.|\s|$)", r"\1", s.replace("&", " e "))
    toks = [t for t in re.sub(r"[^a-z0-9 ]", " ", s.replace(".", "")).split() if t not in FORME_SOCIETARIE]
    return "".join(toks)


def _lista(v):
    if v is None or v == "":
        return []
    if isinstance(v, (list, tuple)):
        return [str(x).strip() for x in v if str(x).strip()]
    return [x.strip() for x in str(v).split(";") if x.strip()]


def _esteso(v):
    out = []
    for s in (v if isinstance(v, list) else []):
        if isinstance(s, dict) and s.get("sezione"):
            t = s.get("testo")
            out.append({"sezione": str(s["sezione"]), "testo": [str(x) for x in t] if isinstance(t, list) else str(t or "")})
    return out


def _ora():
    return dt.datetime.now().isoformat(timespec="seconds")


def normalizza(r, ora=None):
    """Referenza qualsiasi (dal JSON) -> dizionario con tutti i campi del modello."""
    ora = ora or _ora()
    o = {"id": str(r.get("id") or "").strip(), "contatore": r.get("contatore") if isinstance(r.get("contatore"), int) else None}
    for k in TESTI:
        v = r.get(k)
        o[k] = "" if v is None else str(v).strip() if k != "pitch" else str(v).strip()
    for k in LISTE:
        o[k] = _lista(r.get(k))
    o["esteso"] = _esteso(r.get("esteso"))
    o["da_verificare"] = bool(r.get("da_verificare"))
    o["archiviata"] = bool(r.get("archiviata"))
    o["creata_il"] = r.get("creata_il") or ora
    o["modificata_il"] = r.get("modificata_il") or ora
    return o


SCHEMA = """
CREATE TABLE IF NOT EXISTS referenze (
  id TEXT PRIMARY KEY, origine TEXT, contatore INTEGER, cliente TEXT, cliente_key TEXT, titolo TEXT, titolo_excel TEXT,
  ambito TEXT, tipologie TEXT, mercato TEXT, segmento TEXT, anno TEXT, temi TEXT, tecnologie TEXT, pitch TEXT, esteso TEXT,
  fonti TEXT, documenti TEXT, confidenza TEXT, materiale TEXT, campi_mancanti TEXT, da_verificare INTEGER DEFAULT 0, note TEXT,
  descrizione_excel TEXT, tecnologie_excel TEXT, referente_aidata TEXT, referente_mercato TEXT, referente_progetto TEXT, owner TEXT,
  archiviata INTEGER DEFAULT 0, creata_il TEXT, modificata_il TEXT);
CREATE INDEX IF NOT EXISTS ix_ref_cliente ON referenze(cliente_key);
CREATE TABLE IF NOT EXISTS referenze_log (n INTEGER PRIMARY KEY AUTOINCREMENT, id_referenza TEXT, data_ora TEXT, campo TEXT, valore_precedente TEXT);
CREATE INDEX IF NOT EXISTS ix_log_ref ON referenze_log(id_referenza);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
"""
COLONNE = ["id", "origine", "contatore", "cliente", "titolo", "titolo_excel", "ambito", "tipologie", "mercato", "segmento", "anno", "temi", "tecnologie",
           "pitch", "esteso", "fonti", "documenti", "confidenza", "materiale", "campi_mancanti", "da_verificare", "note", "descrizione_excel",
           "tecnologie_excel", "referente_aidata", "referente_mercato", "referente_progetto", "owner", "archiviata", "creata_il", "modificata_il"]
JSON_COLS = LISTE + ("esteso",)


class RefStore:
    def __init__(self, path, backup_dir=None):
        self.path = path
        self.backup_dir = backup_dir or os.path.join(os.path.dirname(os.path.abspath(path)), "backup_referenze")
        self._lock = threading.RLock()

    def exists(self):
        return os.path.isfile(self.path)

    def conn(self):
        c = sqlite3.connect(self.path, timeout=20)
        c.row_factory = sqlite3.Row
        return c

    def init(self):
        os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
        with self._lock, self.conn() as c:
            c.executescript(SCHEMA)

    def count(self, archiviate=True):
        if not self.exists():
            return 0
        with self.conn() as c:
            return c.execute("SELECT COUNT(*) FROM referenze" + ("" if archiviate else " WHERE archiviata=0")).fetchone()[0]

    # ---------------------------------------------------------------- backup
    def backup(self, ora=None):
        """Copia coerente (API di backup di SQLite) in backup_referenze/referenze_YYYYMMDD_HHMM.db; tiene le ultime 20."""
        if not self.exists():
            return None
        os.makedirs(self.backup_dir, exist_ok=True)
        dest = os.path.join(self.backup_dir, f"referenze_{(ora or dt.datetime.now()).strftime('%Y%m%d_%H%M')}.db")
        with self._lock:
            src = sqlite3.connect(self.path)
            try:
                dst = sqlite3.connect(dest)
                try:
                    src.backup(dst)
                finally:
                    dst.close()
            finally:
                src.close()
        vecchi = sorted(f for f in os.listdir(self.backup_dir) if re.fullmatch(r"referenze_\d{8}_\d{4}\.db", f))
        for f in vecchi[:-KEEP_BACKUPS]:
            try:
                os.remove(os.path.join(self.backup_dir, f))
            except OSError:
                pass
        return dest

    # ---------------------------------------------------------------- primo caricamento
    def prossimo_id(self, c, usati=()):
        n = 0
        for (i,) in c.execute("SELECT id FROM referenze"):
            m = re.fullmatch(r"REF-(\d+)", i or "")
            n = max(n, int(m.group(1)) if m else 0)
        for i in usati:
            m = re.fullmatch(r"REF-(\d+)", i or "")
            n = max(n, int(m.group(1)) if m else 0)
        return n

    def inserisci(self, c, r):
        c.execute(f"INSERT INTO referenze ({', '.join(COLONNE)}, cliente_key) VALUES ({', '.join('?' * (len(COLONNE) + 1))})",
                  [json.dumps(r[k], ensure_ascii=False) if k in JSON_COLS else int(r[k]) if k in ("da_verificare", "archiviata") else r[k] for k in COLONNE]
                  + [cliente_key(r["cliente"])])

    def carica_json(self, path):
        """Crea il database (se non esiste) e importa il JSON. Non sovrascrive mai un database già popolato."""
        if self.exists() and self.count():
            raise RefError("Il database delle referenze esiste già: il primo caricamento si fa una volta sola.")
        try:
            with open(path, encoding="utf-8-sig") as f:
                dati = json.load(f)
        except OSError as e:
            raise RefError(f"Non riesco a leggere il file: {e}") from e
        except ValueError as e:
            raise RefError(f"Il file non è un JSON valido: {e}") from e
        if isinstance(dati, dict):
            dati = dati.get("referenze", [])
        if not isinstance(dati, list) or not dati:
            raise RefError("Il file non contiene referenze (mi aspetto un elenco, oppure {\"referenze\": [...]}).")
        self.init()
        ora = _ora()
        with self._lock, self.conn() as c:
            c.execute("DELETE FROM referenze")
            recs = [normalizza(r, ora) for r in dati if isinstance(r, dict)]
            usati = {r["id"] for r in recs if r["id"]}
            n = self.prossimo_id(c, usati)
            visti = set()
            for r in recs:
                if not r["id"] or r["id"] in visti:
                    n += 1
                    r["id"] = f"REF-{n:03d}"
                visti.add(r["id"])
                self.inserisci(c, r)
            c.execute("INSERT OR REPLACE INTO meta VALUES ('caricato_il', ?)", (ora,))
            c.execute("INSERT OR REPLACE INTO meta VALUES ('caricato_da', ?)", (os.path.basename(path),))
        return len(recs)

    # ---------------------------------------------------------------- lettura
    @staticmethod
    def _riga(row):
        r = dict(row)
        for k in JSON_COLS:
            try:
                r[k] = json.loads(r[k]) if r[k] else []
            except ValueError:
                r[k] = []
        r["da_verificare"] = bool(r["da_verificare"])
        r["archiviata"] = bool(r["archiviata"])
        r.pop("cliente_key", None)
        return r

    def elenco(self, archiviate=False):
        with self.conn() as c:
            q = "SELECT * FROM referenze" + ("" if archiviate else " WHERE archiviata=0") + " ORDER BY contatore IS NULL, contatore, id"
            return [self._riga(x) for x in c.execute(q)]

    def per_cliente(self, nome):
        k = cliente_key(nome)
        if not k or not self.exists():
            return []
        with self.conn() as c:
            return [self._riga(x) for x in c.execute("SELECT * FROM referenze WHERE cliente_key=? AND archiviata=0", (k,))]


# ================================================================ regole di completezza (un solo posto)
MODIFICABILI = ["cliente", "titolo", "titolo_excel", "ambito", "tipologie", "mercato", "segmento", "anno", "temi", "tecnologie", "pitch", "esteso", "fonti",
                "documenti", "confidenza", "materiale", "campi_mancanti", "da_verificare", "note", "descrizione_excel", "tecnologie_excel",
                "referente_aidata", "referente_mercato", "referente_progetto", "owner"]


def _sezioni(r):
    return {str(s.get("sezione", "")).strip().casefold() for s in r.get("esteso") or []}


def mancanti_automatici(r):
    """Campi mancanti che si ricavano dai dati della scheda (regole semplici, nell'ordine dei domini)."""
    sez, out = _sezioni(r), []
    if not str(r.get("anno") or "").strip():
        out.append("anno")
    if not r.get("tecnologie"):
        out.append("tecnologie")
    if "la soluzione nel dettaglio" not in sez and not (r.get("descrizione_excel") or "").strip():
        out.append("descrizione dettagliata")
    if "il valore per il cliente" not in sez:
        out.append("risultati/benefici")
    if not any((r.get(k) or "").strip() for k in ("referente_aidata", "referente_mercato", "referente_progetto", "owner")):
        out.append("referente interno")
    if not (r.get("mercato") or "").strip():
        out.append("mercato")
    if not r.get("fonti") and not r.get("documenti"):
        out.append("materiale di presentazione (slide/Word)")
    return [v for v in cfg.CAMPI_MANCANTI if v in out]


def risolvi_mancanti(prec, nuovo, inviati):
    """Campi mancanti finali = quelli calcolati sui dati nuovi + le voci inserite a mano.
    Una voce è 'a mano' se è tra quelle inviate e non era una voce calcolata sui dati precedenti (così quelle importate dall'Excel restano)."""
    auto_prec = set(mancanti_automatici(prec)) if prec else set()
    manuali = {v for v in (inviati or []) if v in cfg.CAMPI_MANCANTI and v not in auto_prec}
    return [v for v in cfg.CAMPI_MANCANTI if v in manuali or v in set(mancanti_automatici(nuovo))]


def materiale_proposto(r):
    n, so = len(r.get("esteso") or []), cfg.SOGLIE_MATERIALE
    fonti = bool(r.get("fonti"))
    if n >= so["ricco_sezioni"] and fonti:
        return "ricco"
    if n >= so["medio_sezioni"] or (n >= so["medio_sezioni_con_fonti"] and fonti):
        return "medio"
    return "scarso"


def punti_completezza(r):
    """Più è alto, più la scheda è completa (serve a ordinare la vista 'Da completare')."""
    return (min(len(r.get("esteso") or []), 7) * 2 + (2 if r.get("fonti") else 0) + (1 if r.get("pitch") else 0) + (1 if r.get("tecnologie") else 0)
            + (1 if (r.get("descrizione_excel") or "").strip() else 0) - len(r.get("campi_mancanti") or []))


def valida(r, prec=None):
    """Controlla una referenza (già normalizzata). I valori già presenti nella scheda precedente restano ammessi anche se fuori dominio."""
    err = []
    for k, nome in (("cliente", "Cliente"), ("titolo", "Titolo"), ("ambito", "Ambito"), ("mercato", "Mercato")):
        if not str(r.get(k) or "").strip():
            err.append(f"{nome} è obbligatorio")
    if r.get("ambito") and r["ambito"] not in cfg.AMBITI:
        err.append(f"Ambito non ammesso: {r['ambito']}")
    if r.get("mercato") and r["mercato"] not in cfg.MERCATI and r["mercato"] != (prec or {}).get("mercato"):
        err.append(f"Mercato non ammesso: {r['mercato']}")
    ammesse = cfg.TIPOLOGIE.get(r.get("ambito"), [])
    for t in r.get("tipologie") or []:
        if t not in ammesse and t not in ((prec or {}).get("tipologie") or []):
            err.append(f"Tipologia '{t}' non ammessa per l'ambito {r.get('ambito')}")
    if r.get("anno") and not re.fullmatch(r"\d{4}", r["anno"]):
        err.append("L'anno deve essere di 4 cifre (es. 2024) oppure vuoto")
    if r.get("materiale") and r["materiale"] not in cfg.MATERIALE:
        err.append(f"Materiale non ammesso: {r['materiale']}")
    if r.get("confidenza") and r["confidenza"] not in cfg.CONFIDENZE and r["confidenza"] != (prec or {}).get("confidenza"):
        err.append(f"Confidenza non ammessa: {r['confidenza']}")
    for v in r.get("campi_mancanti") or []:
        if v not in cfg.CAMPI_MANCANTI:
            err.append(f"Campo mancante non ammesso: {v}")
    if err:
        raise RefError("; ".join(err))


def _ordina_completezza(rs):
    ordine = {"scarso": 0, "medio": 1, "ricco": 2}
    return sorted(rs, key=lambda r: (ordine.get(r["materiale"], 1), punti_completezza(r), -len(r["campi_mancanti"]), r["id"]))


class RefStoreMod(RefStore):
    """Scrittura: creazione, modifica, archiviazione, verifica, eliminazione e storico delle modifiche."""

    def leggi(self, rid):
        with self.conn() as c:
            x = c.execute("SELECT * FROM referenze WHERE id=?", (rid,)).fetchone()
        if not x:
            raise RefError(f"Referenza {rid} non trovata")
        return self._riga(x)

    def _salva(self, c, r):
        sets = ", ".join(f"{k}=?" for k in COLONNE if k != "id") + ", cliente_key=?"
        c.execute(f"UPDATE referenze SET {sets} WHERE id=?",
                  [json.dumps(r[k], ensure_ascii=False) if k in JSON_COLS else int(r[k]) if k in ("da_verificare", "archiviata") else r[k] for k in COLONNE if k != "id"]
                  + [cliente_key(r["cliente"]), r["id"]])

    @staticmethod
    def _log(c, rid, ora, campo, prima):
        c.execute("INSERT INTO referenze_log (id_referenza, data_ora, campo, valore_precedente) VALUES (?,?,?,?)", (rid, ora, campo, json.dumps(prima, ensure_ascii=False)))

    def calcola(self, bozza, rid=None):
        """Per la scheda di modifica: campi mancanti e materiale proposto per i dati correnti della bozza."""
        r = normalizza({**bozza, "id": rid or "bozza"})
        prec = self.leggi(rid) if rid and self.exists() else None
        return {"campi_mancanti": risolvi_mancanti(prec, r, bozza.get("campi_mancanti")), "materiale_proposto": materiale_proposto(r),
                "automatici": mancanti_automatici(r)}

    def crea(self, dati, ora=None, origine=None):
        ora = ora or _ora()
        self.init()
        r = normalizza({k: v for k, v in dati.items() if k in MODIFICABILI}, ora)
        r.update(origine=origine or cfg.ORIGINE_MANUALE, contatore=None, archiviata=False, creata_il=ora, modificata_il=ora)
        if not r["materiale"]:
            r["materiale"] = materiale_proposto(r)
        r["campi_mancanti"] = risolvi_mancanti(None, r, dati.get("campi_mancanti"))
        valida(r)
        with self._lock, self.conn() as c:
            r["id"] = f"REF-{self.prossimo_id(c) + 1:03d}"
            self.inserisci(c, r)
            self._log(c, r["id"], ora, "_creata", None)
        return self.leggi(r["id"])

    def aggiorna(self, rid, cambi, ora=None):
        ora = ora or _ora()
        with self._lock, self.conn() as c:
            x = c.execute("SELECT * FROM referenze WHERE id=?", (rid,)).fetchone()
            if not x:
                raise RefError(f"Referenza {rid} non trovata")
            prec = self._riga(x)
            nuovo = normalizza({**prec, **{k: v for k, v in cambi.items() if k in MODIFICABILI}}, ora)
            nuovo.update(id=rid, origine=prec["origine"], contatore=prec["contatore"], archiviata=prec["archiviata"], creata_il=prec["creata_il"])
            nuovo["campi_mancanti"] = risolvi_mancanti(prec, nuovo, cambi.get("campi_mancanti", prec["campi_mancanti"]))
            if "materiale" in cambi and not nuovo["materiale"]:
                nuovo["materiale"] = prec["materiale"]
            valida(nuovo, prec)
            diff = [k for k in MODIFICABILI if nuovo[k] != prec[k]]
            if not diff:
                return prec
            nuovo["modificata_il"] = ora
            self._salva(c, nuovo)
            for k in diff:
                self._log(c, rid, ora, k, prec[k])
        return self.leggi(rid)

    def archivia(self, rid, archiviata=True, ora=None):
        ora = ora or _ora()
        with self._lock, self.conn() as c:
            r = self.leggi(rid)
            if r["archiviata"] != bool(archiviata):
                c.execute("UPDATE referenze SET archiviata=?, modificata_il=? WHERE id=?", (int(bool(archiviata)), ora, rid))
                self._log(c, rid, ora, "archiviata", r["archiviata"])
        return self.leggi(rid)

    def verifica(self, rid, ora=None):
        return self.aggiorna(rid, {"da_verificare": False}, ora)

    def elimina(self, rid, ora=None):
        ora = ora or _ora()
        with self._lock, self.conn() as c:
            r = self.leggi(rid)
            self._log(c, rid, ora, "_eliminata", r)                            # la scheda intera resta nello storico: si può recuperare
            c.execute("DELETE FROM referenze WHERE id=?", (rid,))

    def storico(self, rid):
        with self.conn() as c:
            return [{"data_ora": x["data_ora"], "campo": x["campo"], "valore_precedente": json.loads(x["valore_precedente"])}
                    for x in c.execute("SELECT * FROM referenze_log WHERE id_referenza=? ORDER BY n DESC", (rid,))]

    def da_completare(self, mancante=None, solo_da_verificare=False, materiale=None):
        base = self.elenco(archiviate=False)
        facce = {"mancanti": {v: sum(1 for r in base if v in r["campi_mancanti"]) for v in cfg.CAMPI_MANCANTI},
                 "da_verificare": sum(1 for r in base if r["da_verificare"]), "materiale": {m: sum(1 for r in base if r["materiale"] == m) for m in cfg.MATERIALE}}
        sel = [r for r in base if (not mancante or mancante in r["campi_mancanti"]) and (not solo_da_verificare or r["da_verificare"]) and (not materiale or r["materiale"] == materiale)]
        sel = [r for r in sel if r["campi_mancanti"] or r["da_verificare"] or r["materiale"] != "ricco"]
        for r in sel:
            r["punti"] = punti_completezza(r)
        return {"referenze": _ordina_completezza(sel), "facce": facce}
