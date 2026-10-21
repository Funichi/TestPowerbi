# Sostituisce i file dell'app con quelli di un nuovo zip, senza toccare config.json, il database e i backup, poi riavvia l'app.
# Uso (lo lancia l'app o Aggiorna.bat):  Aggiorna.ps1 -AppDir <cartella dell'app> [-Zip <file zip>] [-WaitPid <pid dell'app>]
# Se -Zip manca, scarica l'ultima versione da GitHub usando repository e token salvati in config.json.
param([Parameter(Mandatory = $true)][string]$AppDir, [string]$Zip = "", [int]$WaitPid = 0)
$ErrorActionPreference = "Stop"
$log = Join-Path $AppDir "aggiornamento.log"
function Log($m) { "$(Get-Date -Format s) $m" | Add-Content -Path $log }
try {
    if ($WaitPid -gt 0) { try { Wait-Process -Id $WaitPid -Timeout 30 } catch {} }
    Get-Process GareOfferte -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 1
    if (-not $Zip) {
        $cfg = Get-Content (Join-Path $AppDir "config.json") -Raw | ConvertFrom-Json
        $repo = if ($cfg.github_repo) { $cfg.github_repo } else { "Funichi/TestPowerbi" }
        if (-not $cfg.github_token) { throw "Manca il token GitHub: impostalo nelle Impostazioni dell'app." }
        $h = @{ Authorization = "Bearer $($cfg.github_token)"; "User-Agent" = "GareOfferte-updater"; "X-GitHub-Api-Version" = "2022-11-28" }
        $rel = Invoke-RestMethod -Headers $h -Uri "https://api.github.com/repos/$repo/releases/tags/latest"
        $asset = $rel.assets | Where-Object { $_.name -like "GareOfferte-*.zip" } | Select-Object -First 1
        if (-not $asset) { throw "Nessun file dell'app nell'ultima versione." }
        $Zip = Join-Path $env:TEMP "GareOfferte-update.zip"
        $loc = $null
        try { $x = Invoke-WebRequest -UseBasicParsing -Headers ($h + @{ Accept = "application/octet-stream" }) -Uri $asset.url -MaximumRedirection 0 -ErrorAction Stop; $loc = $x.Headers["Location"] }
        catch { $resp = $_.Exception.Response; $loc = if ($resp.Headers.Location) { $resp.Headers.Location.ToString() } else { $resp.Headers["Location"] } }
        if (-not $loc) { throw "GitHub non ha indicato dove scaricare il file." }
        Invoke-WebRequest -UseBasicParsing -Uri $loc -OutFile $Zip       # senza token: il link è già firmato
    }
    $stage = Join-Path $env:TEMP "gare_stage"
    if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
    Expand-Archive -LiteralPath $Zip -DestinationPath $stage -Force
    & robocopy $stage $AppDir /E /XF config.json monitoraggio.db "*.db-wal" "*.db-shm" aggiornamento.log /XD backup update /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copia dei file non riuscita (robocopy $LASTEXITCODE)." }
    Remove-Item $stage -Recurse -Force
    Remove-Item $Zip -Force -ErrorAction SilentlyContinue
    Log "Aggiornamento completato."
    $env:GARE_NO_BROWSER = "1"
    Start-Process -FilePath (Join-Path $AppDir "GareOfferte.exe") -WorkingDirectory $AppDir -WindowStyle Minimized
} catch {
    Log "ERRORE: $_"
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Aggiornamento non riuscito: $_`nDettagli in aggiornamento.log nella cartella dell'app.", "Gare e Offerte") | Out-Null
}
