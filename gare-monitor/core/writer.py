"""Scrittura sull'Excel.

Backend principale: Excel stesso (COM, solo Windows). Così tabelle, formule, pivot e menu a tendina
del file restano intatti e, se il file è già aperto in Excel, viene aggiornato quello.
Backend di ripiego: openpyxl (usato nei test; perde pivot e validazioni "estese", quindi va richiesto
esplicitamente con "writer": "openpyxl" in config.json).
Prima di ogni scrittura viene sempre creata una copia di backup.
"""
import datetime as dt
import glob
import os
import shutil
import sys
import threading
import warnings

from .reader import DATE_FIELDS, SHEET_MAIN, clean_text, row_sig, to_date

TABLE_NAME = "Tabella4"
KEEP_BACKUPS = 40
_lock = threading.Lock()


class WriteError(Exception):
    pass


def make_backup_name(path, backup_dir):
    os.makedirs(backup_dir, exist_ok=True)
    base = os.path.splitext(os.path.basename(path))[0]
    return os.path.join(backup_dir, f"{base}_{dt.datetime.now():%Y%m%d_%H%M%S}.xlsx")


def prune_backups(backup_dir):
    files = sorted(glob.glob(os.path.join(backup_dir, "*.xlsx")), key=os.path.getmtime)
    for f in files[:-KEEP_BACKUPS]:
        try:
            os.remove(f)
        except OSError:
            pass


def _value_for(field, value):
    """Valore da scrivere nella cella."""
    if value in (None, ""):
        return None
    if field in DATE_FIELDS:
        d = to_date(value)
        if d is None:
            raise WriteError(f"Data non valida per '{field}': {value!r}")
        return dt.datetime(d.year, d.month, d.day)
    return str(value)


def _check_sig(cur_cliente, cur_oggetto, cur_ins, sig, row):
    if sig is not None and row_sig(cur_cliente, cur_oggetto, cur_ins) != sig:
        raise WriteError(f"La riga {row} è cambiata nel file dall'ultima lettura (qualcuno l'ha modificata o spostata). Premi 'Ricarica' e riprova.")


# ------------------------------------------------------------------ Excel (COM)

class ExcelWriter:
    name = "excel"

    def __init__(self, path, backup_dir, table_name=TABLE_NAME):
        self.path, self.backup_dir, self.table_name = path, backup_dir, table_name

    def _open(self):
        import pythoncom
        import win32com.client
        pythoncom.CoInitialize()
        target = os.path.normcase(os.path.abspath(self.path))
        base = os.path.basename(target)
        try:
            app = win32com.client.GetActiveObject("Excel.Application")
            for wb in app.Workbooks:
                full = os.path.normcase(str(wb.FullName))
                if full == target or (full.startswith("http") and os.path.normcase(str(wb.Name)) == base):
                    return app, wb, False
        except Exception:
            pass
        app = win32com.client.DispatchEx("Excel.Application")
        app.Visible = False
        app.DisplayAlerts = False
        wb = app.Workbooks.Open(self.path, UpdateLinks=0)
        return app, wb, True

    def _close(self, app, wb, owned):
        try:
            if owned:
                wb.Close(SaveChanges=False)
                app.Quit()
        finally:
            import pythoncom
            pythoncom.CoUninitialize()

    def _run(self, fn):
        with _lock:
            app = wb = None
            owned = False
            try:
                app, wb, owned = self._open()
                if wb.ReadOnly:
                    raise WriteError("Il file è aperto in sola lettura (bloccato da un altro utente o da SharePoint). Chiudilo dove è aperto e riprova.")
                ws = wb.Worksheets(SHEET_MAIN)
                lo = self._table(ws)
                cols = {str(lo.ListColumns(i).Name).strip(): lo.ListColumns(i).Range.Column for i in range(1, lo.ListColumns.Count + 1)}
                wb.SaveCopyAs(make_backup_name(self.path, self.backup_dir))
                prune_backups(self.backup_dir)
                res = fn(ws, lo, cols)
                wb.Save()
                return res
            except WriteError:
                raise
            except Exception as e:  # errori COM
                raise WriteError(f"Errore di Excel: {e}") from e
            finally:
                if app is not None:
                    self._close(app, wb, owned)

    def _table(self, ws):
        try:
            return ws.ListObjects(self.table_name)
        except Exception:
            if ws.ListObjects.Count:
                return ws.ListObjects(1)
            raise WriteError(f"Nel foglio '{SHEET_MAIN}' non trovo la tabella '{self.table_name}'.")

    @staticmethod
    def _cell_val(v):
        return v.date().isoformat() if hasattr(v, "year") and hasattr(v, "hour") else v

    def _check(self, ws, cols, row, sig):
        g = lambda f: self._cell_val(ws.Cells(row, cols[f]).Value) if f in cols else None
        _check_sig(g("Cliente"), g("Oggetto"), g("Data ins."), sig, row)

    def append(self, values):
        def fn(ws, lo, cols):
            lr = lo.ListRows.Add()
            row = lr.Range.Row
            for f, v in values.items():
                if f in cols:
                    ws.Cells(row, cols[f]).Value = _value_for(f, v)
            if "Seq" in cols and not ws.Cells(row, cols["Seq"]).HasFormula:
                ws.Cells(row, cols["Seq"]).Formula = "=ROW()-1"
            if "Valore" in cols and not ws.Cells(row, cols["Valore"]).HasFormula:
                for r in range(row - 1, max(row - 30, 1), -1):
                    if ws.Cells(r, cols["Valore"]).HasFormula:
                        ws.Cells(row, cols["Valore"]).Formula = ws.Cells(r, cols["Valore"]).Formula
                        break
            return row
        return self._run(fn)

    def update_many(self, items):
        """items: [(row, sig, {campo: valore})]"""
        def fn(ws, lo, cols):
            for row, sig, changes in items:
                self._check(ws, cols, row, sig)
            for row, sig, changes in items:
                for f, v in changes.items():
                    if f in cols:
                        ws.Cells(row, cols[f]).Value = _value_for(f, v)
            return len(items)
        return self._run(fn)


# ------------------------------------------------------------------ openpyxl (ripiego / test)

class OpenpyxlWriter:
    name = "openpyxl"

    def __init__(self, path, backup_dir, table_name=TABLE_NAME):
        self.path, self.backup_dir, self.table_name = path, backup_dir, table_name

    def _run(self, fn):
        import openpyxl
        with _lock:
            try:
                shutil.copyfile(self.path, make_backup_name(self.path, self.backup_dir))
                prune_backups(self.backup_dir)
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    wb = openpyxl.load_workbook(self.path)
                ws = wb[SHEET_MAIN]
                cols = {str(c.value).strip(): c.column for c in ws[1] if c.value}
                res = fn(ws, cols)
                wb.save(self.path)
                return res
            except WriteError:
                raise
            except PermissionError as e:
                raise WriteError("Il file è bloccato (aperto in Excel?). Chiudilo e riprova.") from e

    def _check(self, ws, cols, row, sig):
        g = lambda f: ws.cell(row, cols[f]).value if f in cols else None
        _check_sig(g("Cliente"), g("Oggetto"), g("Data ins."), sig, row)

    def append(self, values):
        def fn(ws, cols):
            from copy import copy
            tab = ws.tables.get(self.table_name)
            last = tab.ref.split(":")[1] if tab else None
            last_row = int("".join(ch for ch in last if ch.isdigit())) if last else ws.max_row
            row = last_row + 1
            for c in range(1, ws.max_column + 1):
                src, dst = ws.cell(last_row, c), ws.cell(row, c)
                dst._style = copy(src._style)
            if tab:
                tab.ref = f"{tab.ref.split(':')[0]}:{last[:len(last) - len(str(last_row))]}{row}"
            for f, v in values.items():
                if f in cols:
                    ws.cell(row, cols[f]).value = _value_for(f, v)
            if "Seq" in cols:
                ws.cell(row, cols["Seq"]).value = "=ROW()-1"
            if "Valore" in cols:
                for r in range(last_row, max(last_row - 30, 1), -1):
                    v = ws.cell(r, cols["Valore"]).value
                    if isinstance(v, str) and v.startswith("="):
                        ws.cell(row, cols["Valore"]).value = v
                        break
            return row
        return self._run(fn)

    def update_many(self, items):
        def fn(ws, cols):
            for row, sig, changes in items:
                self._check(ws, cols, row, sig)
            for row, sig, changes in items:
                for f, v in changes.items():
                    if f in cols:
                        ws.cell(row, cols[f]).value = _value_for(f, v)
            return len(items)
        return self._run(fn)


def get_writer(path, backup_dir, preference="auto"):
    if preference == "openpyxl":
        return OpenpyxlWriter(path, backup_dir)
    if sys.platform.startswith("win"):
        try:
            import win32com.client  # noqa: F401
            return ExcelWriter(path, backup_dir)
        except ImportError:
            raise WriteError("Manca il componente per parlare con Excel (pywin32).")
    raise WriteError("La scrittura tramite Excel è disponibile solo su Windows (per test usa \"writer\": \"openpyxl\").")
