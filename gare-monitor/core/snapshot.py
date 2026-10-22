"""Ripiego di lettura: se Windows/OneDrive non lasciano aprire il file direttamente (Permission denied),
si fa fare a Excel una copia (SaveCopyAs). Excel ha sempre accesso e, se il file è già aperto, la copia
include anche le modifiche non ancora salvate."""
import os

from .writer import ExcelWriter, _retry


def snapshot_via_excel(path, dest):
    import pythoncom
    import win32com.client
    pythoncom.CoInitialize()
    app = None
    try:
        target = os.path.normcase(os.path.abspath(path))
        found_app, wb = ExcelWriter(path, "")._find_open_workbook(target, os.path.basename(target))
        if wb is not None:
            _retry(lambda: wb.SaveCopyAs(dest))
            return
        app = win32com.client.DispatchEx("Excel.Application")
        app.Visible = False
        app.DisplayAlerts = False
        wb = _retry(lambda: app.Workbooks.Open(path, UpdateLinks=0, ReadOnly=True))
        try:
            _retry(lambda: wb.SaveCopyAs(dest))
        finally:
            wb.Close(SaveChanges=False)
    finally:
        if app is not None:
            try:
                app.Quit()
            except Exception:
                pass
        pythoncom.CoUninitialize()
