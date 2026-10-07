<#
.SYNOPSIS
    Per le righe "PIU AGGIORNATO IN ORIGINE" del report di Confronta-Offerte.ps1, copia in
    OFFERTE E PRESENTAZIONI\<Cliente>\<cartella> i file nuovi o piu recenti presenti in
    OFFERTE / PRESENTAZIONI.

.DESCRIPTION
    - Parte dal CSV (o XLSX) del report: modifica/rimuovi le righe che hai gia sistemato a mano.
    - Copia SOLO file mancanti o piu recenti in origine (robocopy /XO). Non cancella mai nulla
      in destinazione e non tocca i file piu recenti in destinazione.
    - Per sicurezza di default e' una SIMULAZIONE: non copia niente. Aggiungi -Esegui per copiare.
    - Scrive un log CSV con l'esito di ogni riga.

.EXAMPLE
    .\Aggiorna-Destinazione.ps1 -Report C:\Temp\confronto_offerte.csv            # simulazione
    .\Aggiorna-Destinazione.ps1 -Report C:\Temp\confronto_offerte.csv -Esegui    # copia davvero
#>
param(
    [Parameter(Mandatory)][string]$Report,
    [switch]$Esegui,
    [string]$Log = (Join-Path ([Environment]::GetFolderPath('Desktop')) ("aggiorna_destinazione_{0:yyyyMMdd_HHmm}.csv" -f (Get-Date)))
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Report)) { throw "Report non trovato: $Report" }

# Lettura report (CSV con ';' oppure XLSX)
if ($Report -match '\.xlsx$') {
    if (-not (Get-Module -ListAvailable -Name ImportExcel)) {
        throw "Per leggere .xlsx serve il modulo ImportExcel (Install-Module ImportExcel -Scope CurrentUser) oppure salva il file come CSV (delimitato da punto e virgola)."
    }
    $righe = Import-Excel -Path $Report
} else {
    $righe = Import-Csv -LiteralPath $Report -Delimiter ';' -Encoding UTF8
}

$daFare = @($righe | Where-Object { $_.Esito -eq 'PIU AGGIORNATO IN ORIGINE' })
Write-Host ("Righe 'PIU AGGIORNATO IN ORIGINE': {0}  (modalita: {1})" -f $daFare.Count, $(if ($Esegui) { 'COPIA' } else { 'SIMULAZIONE' }))

$esiti = New-Object System.Collections.Generic.List[object]
$i = 0
foreach ($r in $daFare) {
    $i++
    $src = $r.PathOrigine; $dst = $r.PathDestinazione
    $stato = ''; $dettaglio = ''

    if (-not (Test-Path -LiteralPath $src)) { $stato = 'SALTATO'; $dettaglio = 'origine non trovata' }
    elseif (-not (Test-Path -LiteralPath $dst)) { $stato = 'SALTATO'; $dettaglio = 'destinazione non trovata (spostata o rinominata?)' }
    else {
        Write-Host ("[{0}/{1}] {2}" -f $i, $daFare.Count, $r.Cartella)
        # /E sottocartelle (anche vuote)  /XO salta file con data origine <= destinazione
        # /COPY:DAT dati+attributi+date  /L = solo elenco (simulazione)  nessun /MIR: non cancella nulla
        $opts = @('/E', '/XO', '/COPY:DAT', '/DCOPY:DAT', '/R:2', '/W:2', '/NP', '/NDL', '/NJH', '/NJS', '/FP')
        if (-not $Esegui) { $opts += '/L' }
        $out = & robocopy $src $dst @opts
        $code = $LASTEXITCODE
        $copiati = @($out | Where-Object { $_ -match 'Nuovo file|New File|Più recente|Newer|\bPi.\s+recente' }).Count
        if ($code -ge 8) { $stato = 'ERRORE'; $dettaglio = "robocopy exit code $code" }
        else {
            $stato = if ($Esegui) { 'COPIATO' } else { 'SIMULATO' }
            $dettaglio = if ($code -eq 0) { 'niente da copiare' } else { "$copiati file" }
        }
    }

    $esiti.Add([pscustomobject]@{
        Cartella = $r.Cartella; Cliente = $r.Cliente; Stato = $stato; Dettaglio = $dettaglio
        PathOrigine = $src; PathDestinazione = $dst
    })
}

$esiti | Export-Csv -LiteralPath $Log -NoTypeInformation -Delimiter ';' -Encoding UTF8
Write-Host ""
$esiti | Group-Object Stato | ForEach-Object { Write-Host ("  {0}: {1}" -f $_.Name, $_.Count) }
Write-Host "Log salvato in: $Log"
if (-not $Esegui) { Write-Host "Era una simulazione: rilancia con -Esegui per copiare davvero." }
