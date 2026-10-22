@echo off
rem Sostituisce i file dell'app con l'ultima versione. Due modi:
rem   - senza argomenti (doppio clic): scarica da GitHub con il token salvato nelle Impostazioni (serve se l'app non parte piu');
rem   - con argomenti "<zip>" <pid dell'app>: li usa l'app stessa per l'aggiornamento con un clic (zip gia' scaricato).
set "APP=%~dp0"
if "%APP:~-1%"=="\" set "APP=%APP:~0,-1%"
copy /y "%~dp0Aggiorna.ps1" "%TEMP%\gare_aggiorna.ps1" >nul
if "%~1"=="" goto manuale
if not exist "%APP%\update" mkdir "%APP%\update"
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%TEMP%\gare_aggiorna.ps1" -AppDir "%APP%" -Zip "%~1" -WaitPid %2 >> "%APP%\update\powershell.txt" 2>&1
goto :eof
:manuale
powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP%\gare_aggiorna.ps1" -AppDir "%APP%"
