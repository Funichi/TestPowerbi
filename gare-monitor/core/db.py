"""Database locale SQLite (modulo 'sqlite3' di Python: nessuna installazione, un solo file).

Una sola tabella, 'offerte', con TUTTE le colonne del foglio Excel più quattro colonne di servizio:
  __id     numero progressivo interno (identifica la riga nell'app)
  __xl     numero di riga nell'Excel al momento dell'import (NULL per le righe inserite qui)
  __state  'orig' = come nell'Excel · 'mod' = modificata qui · 'new' = inserita qui (da esportare)
  __orig   JSON con i valori importati dall'Excel (serve a sapere cosa è cambiato)
  __att    livello di attenzione 0-3 (colore della cella Cliente: giallo=1, arancione=2, rosso=3)
Ogni import svuota la tabella e la ricarica: le modifiche non esportate vengono scartate.
"""
import contextlib
import glob
import json
import os
import shutil
import sqlite3
import threading
import datetime as dt

from .normalize import normalize_rows
from .reader import DATE_FIELDS, FIELDS, build_row, clean_text, optional_columns, row_sig, to_iso

KEEP_DB_BACKUPS = 20


def _q(name):
    return '"' + name.replace('"', '""') + '"'


def _cmp(field, v):
    """Valore normalizzato per confrontare 'prima' e 'dopo' ignorando spazi e formati di data."""
    return to_iso(v) if field in DATE_FIELDS else clean_text(v)


class Store:
    def __init__(self, path):
        self.path = path
        self.version = 0                  # cambia a ogni modifica: serve alla cache dell'app
        self._lock = threading.Lock()
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with self.conn() as c:
            c.execute("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)")

    @contextlib.contextmanager
    def conn(self):
        c = sqlite3.connect(self.path, timeout=15)
        c.row_factory = sqlite3.Row
        try:
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise
        finally:
            c.close()

    # ------------------------------------------------------------ meta
    def meta(self, key, default=None):
        with self.conn() as c:
            r = c.execute("SELECT v FROM meta WHERE k=?", (key,)).fetchone()
        return json.loads(r["v"]) if r else default

    def _set_meta(self, c, key, value):
        c.execute("INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (key, json.dumps(value, ensure_ascii=False)))

    def has_data(self):
        return self.meta("headers") is not None

    def info(self):
        return {"imported_at": self.meta("imported_at"), "source": self.meta("source"), "pending": self.counts()}

    # ------------------------------------------------------------ import (svuota e ricarica)
    def import_all(self, data, source):
        headers = data["headers"]
        with self._lock, self.conn() as c:
            c.execute("DROP TABLE IF EXISTS offerte")
            cols = ", ".join(_q(h) for h in headers)
            c.execute(f'CREATE TABLE offerte ("__id" INTEGER PRIMARY KEY AUTOINCREMENT, "__xl" INTEGER, "__state" TEXT NOT NULL DEFAULT \'orig\', "__orig" TEXT, "__att" INTEGER NOT NULL DEFAULT 0, {cols})')
            ph = ", ".join("?" for _ in headers)
            for r in data["rows"]:
                vals = [r["cells"].get(h) for h in headers]
                att = int(r.get("att") or 0)
                c.execute(f'INSERT INTO offerte ("__xl", "__state", "__orig", "__att", {cols}) VALUES (?, \'orig\', ?, ?, {ph})',
                          [r["xl"], json.dumps({**r["cells"], "__att": att}, ensure_ascii=False), att] + vals)
            self._set_meta(c, "headers", headers)
            self._set_meta(c, "domini", data["domini"])
            self._set_meta(c, "imported_at", dt.datetime.now().isoformat(timespec="seconds"))
            self._set_meta(c, "source", source)
        self.version += 1

    # ------------------------------------------------------------ lettura
    def _rows(self, c):
        headers = self.meta("headers", [])
        out = []
        for r in c.execute('SELECT * FROM offerte ORDER BY "__id"'):
            out.append((r, {h: r[h] for h in headers}, json.loads(r["__orig"]) if r["__orig"] else None))
        return out

    def load(self):
        domini = self.meta("domini", {})
        with self.conn() as c:
            opt = optional_columns(self.meta("headers", []))
            rows = [build_row(r["__id"], r["__xl"], cells, orig, r["__state"], r["__att"], opt) for r, cells, orig in self._rows(c)]
        return {"rows": normalize_rows(rows, domini), "domini": domini}

    def counts(self):
        if not self.has_data():
            return {"new": 0, "mod": 0}
        with self.conn() as c:
            q = dict(c.execute('SELECT "__state", COUNT(*) FROM offerte GROUP BY "__state"').fetchall())
        return {"new": q.get("new", 0), "mod": q.get("mod", 0)}

    # ------------------------------------------------------------ scrittura locale
    def _clean_values(self, values, headers):
        out = {}
        for f, v in values.items():
            if f in headers and f in FIELDS:
                out[f] = to_iso(v) if f in DATE_FIELDS else clean_text(v) if f not in ("Oggetto", "Note") else (str(v).strip() or None if v else None)
        return out

    def insert(self, values):
        headers = self.meta("headers", [])
        vals = self._clean_values(values, headers)
        att = int(values.get("Attenzione") or 0)
        with self._lock, self.conn() as c:
            cols = list(vals)
            c.execute(f'INSERT INTO offerte ("__state", "__att"{"".join(", " + _q(k) for k in cols)}) VALUES (\'new\', ?{"".join(", ?" for _ in cols)})', [att] + [vals[k] for k in cols])
            rid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
        self.version += 1
        return rid

    def _get(self, c, rid):
        r = c.execute('SELECT * FROM offerte WHERE "__id"=?', (rid,)).fetchone()
        if not r:
            raise ValueError("Riga non trovata, aggiorna i dati")
        headers = self.meta("headers", [])
        return r, {h: r[h] for h in headers}, (json.loads(r["__orig"]) if r["__orig"] else None)

    def update(self, rid, changes):
        headers = self.meta("headers", [])
        vals = self._clean_values(changes, headers)
        with self._lock, self.conn() as c:
            r, cells, orig = self._get(c, rid)
            att = r["__att"]
            if "Attenzione" in changes:
                att = int(changes["Attenzione"] or 0)
                c.execute('UPDATE offerte SET "__att"=? WHERE "__id"=?', (att, rid))
            if vals:
                c.execute(f'UPDATE offerte SET {", ".join(_q(k) + "=?" for k in vals)} WHERE "__id"=?', list(vals.values()) + [rid])
                cells.update(vals)
            if r["__state"] != "new":
                state = "mod" if self._diff(cells, orig, att) else "orig"
                c.execute('UPDATE offerte SET "__state"=? WHERE "__id"=?', (state, rid))
        self.version += 1

    def delete(self, rid):
        with self._lock, self.conn() as c:
            r, _, _ = self._get(c, rid)
            if r["__state"] != "new":
                raise ValueError("Si possono eliminare solo le righe inserite qui e non ancora esportate")
            c.execute('DELETE FROM offerte WHERE "__id"=?', (rid,))
        self.version += 1

    def revert(self, rid):
        headers = self.meta("headers", [])
        with self._lock, self.conn() as c:
            r, _, orig = self._get(c, rid)
            if r["__state"] != "mod":
                raise ValueError("Questa riga non ha modifiche da annullare")
            c.execute(f'UPDATE offerte SET {", ".join(_q(h) + "=?" for h in headers)}, "__att"=?, "__state"=\'orig\' WHERE "__id"=?',
                      [orig.get(h) for h in headers] + [int(orig.get("__att") or 0), rid])
        self.version += 1

    # ------------------------------------------------------------ cosa esportare
    @staticmethod
    def _diff(cells, orig, att=0):
        d = {f: _cmp(f, cells.get(f)) for f in FIELDS if f in cells and _cmp(f, cells.get(f)) != _cmp(f, orig.get(f))}
        if int(att or 0) != int(orig.get("__att") or 0):
            d["Attenzione"] = int(att or 0)
        return d

    def pending_items(self):
        """{'new': [{'id', 'values'}], 'mod': [{'id', 'xl', 'sig', 'changes', 'before', 'cliente', 'oggetto'}]}"""
        new, mod = [], []
        with self.conn() as c:
            for r, cells, orig in self._rows(c):
                if r["__state"] == "new":
                    vals = {f: _cmp(f, cells.get(f)) for f in FIELDS if f in cells and _cmp(f, cells.get(f)) is not None}
                    if r["__att"]:
                        vals["Attenzione"] = r["__att"]
                    new.append({"id": r["__id"], "values": vals})
                elif r["__state"] == "mod":
                    ch = self._diff(cells, orig, r["__att"])
                    mod.append({"id": r["__id"], "xl": r["__xl"], "changes": ch,
                                "before": {f: (int(orig.get("__att") or 0) if f == "Attenzione" else _cmp(f, orig.get(f))) for f in ch},
                                "sig": row_sig(orig.get("Cliente"), orig.get("Oggetto"), orig.get("Data ins.")),
                                "cliente": clean_text(orig.get("Cliente")), "oggetto": clean_text(orig.get("Oggetto"))})
        return {"new": new, "mod": mod}

    # ------------------------------------------------------------ backup del database
    def backup(self, dest_dir):
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, f"monitoraggio_{dt.datetime.now():%Y%m%d_%H%M%S}.db")
        src = sqlite3.connect(self.path)
        try:
            dst = sqlite3.connect(dest)
            try:
                src.backup(dst)
            finally:
                dst.close()
        finally:
            src.close()
        for f in sorted(glob.glob(os.path.join(dest_dir, "monitoraggio_*.db")), key=os.path.getmtime)[:-KEEP_DB_BACKUPS]:
            try:
                os.remove(f)
            except OSError:
                pass
        return dest
