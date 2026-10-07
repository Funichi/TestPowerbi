<#
.SYNOPSIS
    Verifica se le cartelle in OFFERTE e PRESENTAZIONI sono gia presenti (e aggiornate)
    dentro OFFERTE E PRESENTAZIONI\<Cliente>\ prima della migrazione manuale.

.DESCRIPTION
    - Indicizza tutte le sottocartelle di primo livello dei clienti in "OFFERTE E PRESENTAZIONI"
      (es. OFFERTE E PRESENTAZIONI\Acea\2026-06-25 - Acea).
    - Per ogni cartella in OFFERTE e PRESENTAZIONI (es. "2026-06-25 - Acea") cerca la cartella
      con lo STESSO NOME sotto un qualsiasi cliente.
    - Data di una cartella = data di modifica piu recente tra TUTTI i file contenuti (ricorsivo).
    - Esiti riportati nel CSV (le cartelle a posto non compaiono, salvo -IncludiOk):
        MANCANTE                       cartella non trovata, ma esiste un cliente probabile
        CLIENTE MANCANTE               cartella non trovata e nessun cliente sembra corrispondere
        PIU AGGIORNATO IN ORIGINE      in OFFERTE/PRESENTAZIONI c'e un file piu recente di quelli
                                       in OFFERTE E PRESENTAZIONI (o file che li' non esistono)
#>
param(
    [string]$Base = 'C:\Users\ngrando\Engineering Ingegneria Informatica S.p.A\Sales & Solutions - DATA & ANALYTICS - General',
    [string]$CartellaCompleta = 'OFFERTE E PRESENTAZIONI',
    [string[]]$CartelleOrigine = @('OFFERTE', 'PRESENTAZIONI'),
    [string]$Output = (Join-Path ([Environment]::GetFolderPath('Desktop')) ("confronto_offerte_{0:yyyyMMdd_HHmm}.csv" -f (Get-Date))),
    [switch]$IncludiOk
)

$ErrorActionPreference = 'Stop'

function Get-FileMap([string]$root) {
    # relativePath -> LastWriteTime, solo file
    $map = @{}
    $prefix = $root.TrimEnd('\') + '\'
    Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
        $map[$_.FullName.Substring($prefix.Length).ToLowerInvariant()] = $_.LastWriteTime
    }
    return $map
}

function Get-LatestDate($map, [string]$folder) {
    if ($map.Count -gt 0) { return ($map.Values | Measure-Object -Maximum).Maximum }
    return (Get-Item -LiteralPath $folder).LastWriteTime
}

$pathCompleta = Join-Path $Base $CartellaCompleta
if (-not (Test-Path -LiteralPath $pathCompleta)) { throw "Cartella non trovata: $pathCompleta" }

# 1) Indice delle cartelle sotto i clienti: nome (minuscolo) -> elenco {Cliente, Path}
Write-Host "Indicizzo '$CartellaCompleta'..."
$clienti = Get-ChildItem -LiteralPath $pathCompleta -Directory
$indice = @{}
foreach ($c in $clienti) {
    foreach ($sub in Get-ChildItem -LiteralPath $c.FullName -Directory -ErrorAction SilentlyContinue) {
        $k = $sub.Name.Trim().ToLowerInvariant()
        if (-not $indice.ContainsKey($k)) { $indice[$k] = @() }
        $indice[$k] += [pscustomobject]@{ Cliente = $c.Name; Path = $sub.FullName }
    }
}
Write-Host ("  {0} clienti, {1} cartelle indicizzate" -f $clienti.Count, $indice.Count)

# Nomi cliente ordinati dal piu lungo, per indovinare il cliente di una cartella mancante
$clientiOrdinati = $clienti | Sort-Object { $_.Name.Length } -Descending

$righe = New-Object System.Collections.Generic.List[object]

foreach ($origine in $CartelleOrigine) {
    $pathOrigine = Join-Path $Base $origine
    if (-not (Test-Path -LiteralPath $pathOrigine)) { Write-Warning "Origine non trovata: $pathOrigine"; continue }

    $cartelle = Get-ChildItem -LiteralPath $pathOrigine -Directory
    $i = 0
    foreach ($f in $cartelle) {
        $i++
        Write-Progress -Activity "Confronto $origine" -Status $f.Name -PercentComplete (100 * $i / [Math]::Max(1, $cartelle.Count))

        $mapO = Get-FileMap $f.FullName
        $dataO = Get-LatestDate $mapO $f.FullName
        $k = $f.Name.Trim().ToLowerInvariant()

        $esito = $null; $cliente = ''; $pathD = ''; $dataD = $null; $nuovi = ''; $piuRecenti = ''; $note = ''

        if (-not $indice.ContainsKey($k)) {
            # Cliente probabile: nome cliente contenuto nel nome della cartella
            $match = $clientiOrdinati | Where-Object { $f.Name -like ('*' + [WildcardPattern]::Escape($_.Name) + '*') } | Select-Object -First 1
            if ($match) { $esito = 'MANCANTE'; $cliente = $match.Name }
            else        { $esito = 'CLIENTE MANCANTE' }
        }
        else {
            # Se la stessa cartella e' in piu clienti, prendi quella con data piu recente
            $best = $null; $bestMap = $null; $bestDate = [datetime]::MinValue
            foreach ($cand in $indice[$k]) {
                $m = Get-FileMap $cand.Path
                $d = Get-LatestDate $m $cand.Path
                if ($null -eq $best -or $d -gt $bestDate) { $best = $cand; $bestMap = $m; $bestDate = $d }
            }
            if ($indice[$k].Count -gt 1) { $note = 'Presente in piu clienti: ' + (($indice[$k].Cliente) -join ', ') }
            $cliente = $best.Cliente; $pathD = $best.Path; $dataD = $bestDate

            $nNuovi = 0; $nRecenti = 0
            foreach ($rel in $mapO.Keys) {
                if (-not $bestMap.ContainsKey($rel)) { $nNuovi++ }
                elseif ($mapO[$rel] -gt $bestMap[$rel].AddSeconds(2)) { $nRecenti++ }   # tolleranza 2s (arrotondamenti sync)
            }
            $nuovi = $nNuovi; $piuRecenti = $nRecenti

            if ($dataO -gt $dataD.AddSeconds(2) -or $nNuovi -gt 0 -or $nRecenti -gt 0) { $esito = 'PIU AGGIORNATO IN ORIGINE' }
            else { $esito = 'OK' }
        }

        if ($esito -eq 'OK' -and -not $IncludiOk) { continue }

        $righe.Add([pscustomobject][ordered]@{
            Esito                 = $esito
            Origine               = $origine
            Cartella              = $f.Name
            Cliente               = $cliente
            DataOrigine           = $dataO.ToString('yyyy-MM-dd HH:mm:ss')
            DataDestinazione      = if ($dataD) { $dataD.ToString('yyyy-MM-dd HH:mm:ss') } else { '' }
            FileOrigine           = $mapO.Count
            FileNuoviInOrigine    = $nuovi
            FilePiuRecentiOrigine = $piuRecenti
            PathOrigine           = $f.FullName
            PathDestinazione      = $pathD
            Note                  = $note
        })
    }
}
Write-Progress -Activity 'Confronto' -Completed

$righe | Sort-Object Esito, Origine, Cartella |
    Export-Csv -LiteralPath $Output -NoTypeInformation -Delimiter ';' -Encoding UTF8

Write-Host ""
Write-Host "Righe nel report: $($righe.Count)"
$righe | Group-Object Esito | ForEach-Object { Write-Host ("  {0}: {1}" -f $_.Name, $_.Count) }
Write-Host "CSV salvato in: $Output"
