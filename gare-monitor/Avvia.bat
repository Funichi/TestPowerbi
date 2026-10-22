@echo off
rem Avvio senza .exe: serve Python gia' installato (non servono permessi di amministratore).
cd /d "%~dp0"
python -m pip install --user -q -r requirements.txt
python app.py
pause
