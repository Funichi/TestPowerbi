@echo off
rem Fa partire l'app da sola quando accendi il PC (senza aprire il browser). Non servono permessi di amministratore.
rem Esegui questo file dalla cartella dove si trova GareOfferte.exe. Per toglierlo: Disattiva-avvio-automatico.bat
set "APP=%~dp0GareOfferte.exe"
if not exist "%APP%" (echo GareOfferte.exe non trovato in %~dp0 & pause & exit /b 1)
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\GareOfferte.lnk'); $s.TargetPath='cmd.exe'; $s.Arguments='/c set GARE_NO_BROWSER=1&& \"%APP%\"'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"
echo Fatto: l'app partira' da sola all'accensione del PC (indirizzo http://127.0.0.1:8765).
pause
