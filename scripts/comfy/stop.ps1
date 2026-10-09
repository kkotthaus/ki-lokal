# Beendet den ComfyUI-Server, den start.ps1 gestartet hat (gibt den Grafikspeicher frei).
# Einen Server aus der Desktop-App beendet es nicht - den in der App schliessen.
#
# Aufruf:   .\scripts\comfy\stop.ps1
#           .\scripts\comfy\stop.ps1 -Fenster   (Verknuepfung auf dem Desktop: wartet am Ende auf Enter)

param(
    [string]$Installation = "D:\Projekte-KI\ComfyUI (1)",
    [int]$Port            = 8188,
    [switch]$Fenster
)

$PidDatei = Join-Path $env:LOCALAPPDATA "ki-lokal\comfy-server.pid"

function Ende([int]$Code) {
    if ($Fenster) { Read-Host "`nEnter zum Schliessen" | Out-Null }
    exit $Code
}

Write-Host "ComfyUI beenden" -ForegroundColor Cyan

$prozess = $null
if (Test-Path $PidDatei) {
    $prozess = Get-Process -Id ([int](Get-Content $PidDatei)) -ErrorAction SilentlyContinue
    # Nur das venv-Python der Installation (die Prozessnummer kann inzwischen vergeben sein)
    if ($prozess -and $prozess.Path -ne (Join-Path $Installation "ComfyUI\.venv\Scripts\python.exe")) {
        $prozess = $null
    }
}

if (-not $prozess) {
    Remove-Item $PidDatei -ErrorAction SilentlyContinue
    $belegt = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if ($belegt) {
        Write-Host "  Port $Port gehoert nicht zu start.ps1 (wohl ComfyUI Desktop) - dort beenden." -ForegroundColor Yellow
    } else {
        Write-Host "  laeuft nicht" -ForegroundColor DarkGray
    }
    Ende 0
}

# Das venv-Python startet das eigentliche Python als Unterprozess: beide beenden
Get-CimInstance Win32_Process -Filter "ParentProcessId=$($prozess.Id)" -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Stop-Process -Id $prozess.Id -Force -ErrorAction SilentlyContinue
$prozess.WaitForExit(15000) | Out-Null
Remove-Item $PidDatei -ErrorAction SilentlyContinue
Write-Host "  beendet (Prozess $($prozess.Id))" -ForegroundColor Green
Ende 0
