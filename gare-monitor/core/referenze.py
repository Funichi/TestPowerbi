"""Modulo Referenze: database SQLite SEPARATO (referenze.db), primo caricamento da referenze.json, backup all'avvio, lettura."""
import datetime as dt
import json
import os
import re
import sqlite3
import threading
import unicodedata

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
