# Startet den ComfyUI-Server ohne Fenster im Hintergrund (ohne ComfyUI Desktop).
# Gleiches Python, gleiche Modelle, gleicher Ausgabeordner wie die Desktop-App.
# Antwortet die API schon (eigener Server oder Desktop-App), wird nichts gestartet.
#
# Aufruf:   .\scripts\comfy\start.ps1            (Claude Code, /grafik)
#           .\scripts\comfy\start.ps1 -Fenster   (Verknuepfung auf dem Desktop: wartet am Ende auf Enter)
# Beenden:  .\scripts\comfy\stop.ps1

param(
    [string]$Installation = "D:\Projekte-KI\ComfyUI (1)",
    [string]$Daten        = "D:\Projekte-KI\ComfyUI",
    [int]$Port            = 8188,
    [int]$Wartezeit       = 180,
    # Weitere Argumente fuer ComfyUI. DynamicVRAM (comfy-aimdo) bricht hier beim Laden von FLUX ab
    # (Windows-Fehler 1450 beim Lesen der Modelldatei, 2026-10-09), deshalb standardmaessig aus.
    [string]$Zusatz       = "--disable-dynamic-vram",
    [switch]$Fenster
)

$Status = Join-Path $env:LOCALAPPDATA "ki-lokal"
$PidDatei = Join-Path $Status "comfy-server.pid"
$Log = Join-Path $Status "comfy-server.log"
$Api = "http://127.0.0.1:$Port"

function Ende([int]$Code) {
    if ($Fenster) { Read-Host "`nEnter zum Schliessen" | Out-Null }
    exit $Code
}

function Erreichbar {
    try {
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "$Api/system_stats" | Out-Null
        return $true
    } catch { return $false }
}

Write-Host "ComfyUI starten" -ForegroundColor Cyan

if (Erreichbar) {
    Write-Host "  laeuft schon: $Api" -ForegroundColor Green
    Ende 0
}

$belegt = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($belegt) {
    $p = Get-Process -Id $belegt[0].OwningProcess -ErrorAction SilentlyContinue
    Write-Host "ABBRUCH: Port $Port ist belegt ($($p.ProcessName)), die API antwortet aber nicht." -ForegroundColor Red
    Write-Host "Startet ComfyUI gerade? Kurz warten und erneut versuchen."
    Ende 1
}

# Wie die Desktop-App: Python der venv in der Installation (dort liegt PyTorch), Start im Installationsordner
$python = Join-Path $Installation "ComfyUI\.venv\Scripts\python.exe"
$comfy  = Join-Path $Installation "ComfyUI"
foreach ($pfad in $python, (Join-Path $comfy "main.py"), (Join-Path $Daten "models")) {
    if (-not (Test-Path $pfad)) {
        Write-Host "ABBRUCH: $pfad fehlt." -ForegroundColor Red
        Ende 1
    }
}

# Modellordner: die Datei der Desktop-App fuer diese Installation, sonst jeder Unterordner von <Daten>\models
New-Item -ItemType Directory -Force -Path $Status | Out-Null
$yaml = $null
$inst = Get-Content "$env:APPDATA\Comfy Desktop\installations.json" -Raw -ErrorAction SilentlyContinue |
    ConvertFrom-Json -ErrorAction SilentlyContinue | Where-Object { $_.installPath -eq $Installation }
if ($inst) {
    $yaml = "$env:APPDATA\Comfy Desktop\instance-model-paths\$($inst.id).yaml"
}
if (-not $yaml -or -not (Test-Path $yaml)) {
    $yaml = Join-Path $Status "comfy-pfade.yaml"
    $zeilen = @("ki_lokal:", "  base_path: $($Daten -replace '\\', '/')/")
    Get-ChildItem (Join-Path $Daten "models") -Directory | ForEach-Object {
        $zeilen += "  $($_.Name): models/$($_.Name)/"
    }
    Set-Content -Path $yaml -Value $zeilen -Encoding UTF8
}

$argumente = @(
    '-s', '"ComfyUI\main.py"',
    '--listen', '127.0.0.1',
    '--port', $Port,
    '--enable-manager',
    '--extra-model-paths-config', "`"$yaml`"",
    '--output-directory', "`"$(Join-Path $Daten 'output')`"",
    '--input-directory', "`"$(Join-Path $Daten 'input')`""
) -join ' '
if ($Zusatz) { $argumente += " $Zusatz" }

$prozess = Start-Process -FilePath $python -ArgumentList $argumente -WorkingDirectory $Installation `
    -WindowStyle Hidden -RedirectStandardOutput $Log -RedirectStandardError "$Log.err" -PassThru
Set-Content -Path $PidDatei -Value $prozess.Id
Write-Host "  Server gestartet (Prozess $($prozess.Id)), warte auf $Api ..."

$bis = (Get-Date).AddSeconds($Wartezeit)
while ((Get-Date) -lt $bis) {
    if (Erreichbar) {
        Write-Host "  bereit: $Api" -ForegroundColor Green
        Write-Host "  Protokoll: $Log(.err)"
        Ende 0
    }
    if ($prozess.HasExited) {
        Write-Host "ABBRUCH: Der Server hat sich beendet (Code $($prozess.ExitCode)). Letzte Zeilen:" -ForegroundColor Red
        Get-Content "$Log.err" -Tail 15 -ErrorAction SilentlyContinue
        Remove-Item $PidDatei -ErrorAction SilentlyContinue
        Ende 1
    }
    Start-Sleep -Seconds 2
}
Write-Host "ABBRUCH: Keine Antwort nach $Wartezeit Sekunden. Protokoll: $Log.err" -ForegroundColor Red
Ende 1
