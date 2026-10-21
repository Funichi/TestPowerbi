@echo off
rem Scarica l'ultima versione da GitHub e sostituisce i file dell'app (config, database e backup restano). Serve il token salvato nelle Impostazioni.
rem Si usa se l'app non parte piu' o per aggiornare senza aprirla. Esegui dalla cartella dell'app.
set "APP=%~dp0"
if "%APP:~-1%"=="\" set "APP=%APP:~0,-1%"
copy /y "%~dp0Aggiorna.ps1" "%TEMP%\gare_aggiorna.ps1" >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP%\gare_aggiorna.ps1" -AppDir "%APP%"
