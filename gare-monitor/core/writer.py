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
import time
import warnings

from .reader import DATE_FIELDS, SHEET_MAIN, clean_text, row_sig, to_date

TABLE_NAME = "Tabella4"
KEEP_BACKUPS = 40
_lock = threading.Lock()


class WriteError(Exception):
    pass


_BUSY = (-2147418111, -2147417846)  # RPC_E_CALL_REJECTED, RPC_E_SERVERCALL_RETRYLATER
BUSY_MSG = ("Excel è occupato: probabilmente hai una cella in modifica o una finestra di dialogo aperta "
            "(o OneDrive sta sincronizzando). Esci dalla modifica della cella, chiudi le finestre e riprova.")


def _retry(fn, tries=20, delay=0.75):
    """Excel rifiuta le chiamate COM mentre è occupato: si riprova per qualche secondo."""
    for i in range(tries):
        try:
            return fn()
        except Exception as e:
            if getattr(e, "hresult", None) in _BUSY and i < tries - 1:
                time.sleep(delay)
                continue
            raise


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

    def _find_open_workbook(self, target, base):
        """Cerca il file tra quelli già aperti in QUALSIASI istanza di Excel (tabella degli oggetti in esecuzione)."""
        import pythoncom
        import win32com.client
        try:
            rot = pythoncom.GetRunningObjectTable()
            ctx = pythoncom.CreateBindCtx(0)
            for mk in rot.EnumRunning():
                try:
                    name = mk.GetDisplayName(ctx, None)
                except Exception:
                    continue
                low = os.path.normcase(name)
                from urllib.parse import unquote
                if not (low == target or (low.startswith("http") and unquote(low).endswith(base))):
                    continue
                    obj = rot.GetObject(mk).QueryInterface(pythoncom.IID_IDispatch)
                    wb = win32com.client.Dispatch(obj)
                    if str(wb.Name).lower() == base:
                        return wb.Application, wb
        except Exception as e:
            if getattr(e, "hresult", None) in _BUSY:
                raise
        return None, None

    def _open(self):
        import pythoncom
        import win32com.client
        pythoncom.CoInitialize()
        target = os.path.normcase(os.path.abspath(self.path))
        base = os.path.basename(target)
        app, wb = self._find_open_workbook(target, base)
        if wb is not None:
            # se l'istanza è invisibile (rimasta in background) la chiudiamo noi a fine lavoro
            return app, wb, not _retry(lambda: app.Visible)
        app = win32com.client.DispatchEx("Excel.Application")
        try:
            app.Visible = False
            app.DisplayAlerts = False
            wb = _retry(lambda: app.Workbooks.Open(self.path, UpdateLinks=0))
        except Exception:
            try:
                app.Quit()
            except Exception:
                pass
            raise
        return app, wb, True

    def _close(self, app, wb, owned):
        try:
            if owned:
                try:
                    wb.Close(SaveChanges=False)
                finally:
                    if app.Workbooks.Count == 0:
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
                if _retry(lambda: wb.ReadOnly):
                    raise WriteError("Il file è aperto in sola lettura (bloccato da un altro utente o da SharePoint). Chiudilo dove è aperto e riprova.")
                ws = _retry(lambda: wb.Worksheets(SHEET_MAIN))
                lo = _retry(lambda: self._table(ws))
                cols = _retry(lambda: {str(lo.ListColumns(i).Name).strip(): lo.ListColumns(i).Range.Column for i in range(1, lo.ListColumns.Count + 1)})
                _retry(lambda: wb.SaveCopyAs(make_backup_name(self.path, self.backup_dir)))
                prune_backups(self.backup_dir)
                res = fn(ws, lo, cols)
                _retry(lambda: wb.Save())
                return res
            except WriteError:
                raise
            except Exception as e:  # errori COM
                if getattr(e, "hresult", None) in _BUSY:
                    raise WriteError(BUSY_MSG) from e
                if "Impossibile accedere al file" in str(e):
                    raise WriteError("Il file è aperto o bloccato da un altro Excel. Chiudi il file in Excel; se non basta, apri Gestione attività, "
                                     "termina eventuali processi 'Microsoft Excel' rimasti in background e riprova.") from e
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

    @staticmethod
    def _set(ws, row, col, value):
        _retry(lambda: setattr(ws.Cells(row, col), "Value", value))

    def _check(self, ws, cols, row, sig):
        g = lambda f: self._cell_val(_retry(lambda: ws.Cells(row, cols[f]).Value)) if f in cols else None
        _check_sig(g("Cliente"), g("Oggetto"), g("Data ins."), sig, row)

    def _append_one(self, ws, lo, cols, values):
        lr = _retry(lambda: lo.ListRows.Add())
        row = _retry(lambda: lr.Range.Row)
        for f, v in values.items():
            if f in cols:
                self._set(ws, row, cols[f], _value_for(f, v))
        if "Seq" in cols and not _retry(lambda: ws.Cells(row, cols["Seq"]).HasFormula):
            _retry(lambda: setattr(ws.Cells(row, cols["Seq"]), "Formula", "=ROW()-1"))
        if "Valore" in cols and not _retry(lambda: ws.Cells(row, cols["Valore"]).HasFormula):
            for r in range(row - 1, max(row - 30, 1), -1):
                if _retry(lambda: ws.Cells(r, cols["Valore"]).HasFormula):
                    frm = _retry(lambda: ws.Cells(r, cols["Valore"]).Formula)
                    _retry(lambda: setattr(ws.Cells(row, cols["Valore"]), "Formula", frm))
                    break
        return row

    def append(self, values):
        return self._run(lambda ws, lo, cols: self._append_one(ws, lo, cols, values))

    def export(self, new_rows, updates):
        """Una sola sessione di Excel: prima controlla che le righe da modificare siano ancora quelle, poi accoda le
        righe nuove dopo l'ultima e aggiorna le modificate. Ritorna i numeri di riga delle righe accodate."""
        def fn(ws, lo, cols):
            for row, sig, _ in updates:
                self._check(ws, cols, row, sig)
            appended = [self._append_one(ws, lo, cols, v) for v in new_rows]
            for row, _, changes in updates:
                for f, v in changes.items():
                    if f in cols:
                        self._set(ws, row, cols[f], _value_for(f, v))
            return appended
        return self._run(fn)

    def update_many(self, items):
        """items: [(row, sig, {campo: valore})]"""
        def fn(ws, lo, cols):
            for row, sig, changes in items:
                self._check(ws, cols, row, sig)
            for row, sig, changes in items:
                for f, v in changes.items():
                    if f in cols:
                        self._set(ws, row, cols[f], _value_for(f, v))
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

    def _append_one(self, ws, cols, values):
        from copy import copy
        tab = ws.tables.get(self.table_name)
        last = tab.ref.split(":")[1] if tab else None
        last_row = int("".join(ch for ch in last if ch.isdigit())) if last else ws.max_row
        row = last_row + 1
        for c in range(1, ws.max_column + 1):
            ws.cell(row, c)._style = copy(ws.cell(last_row, c)._style)
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

    def append(self, values):
        return self._run(lambda ws, cols: self._append_one(ws, cols, values))

    def export(self, new_rows, updates):
        def fn(ws, cols):
            for row, sig, _ in updates:
                self._check(ws, cols, row, sig)
            appended = [self._append_one(ws, cols, v) for v in new_rows]
            for row, _, changes in updates:
                for f, v in changes.items():
                    if f in cols:
                        ws.cell(row, cols[f]).value = _value_for(f, v)
            return appended
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
