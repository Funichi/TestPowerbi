@echo off
powershell -NoProfile -Command "Remove-Item ([Environment]::GetFolderPath('Startup')+'\GareOfferte.lnk') -ErrorAction SilentlyContinue"
echo Avvio automatico disattivato.
pause
