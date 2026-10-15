# Startet die Bildwerkstatt im Hintergrund (falls nicht schon aktiv) und öffnet sie im Browser.
# Beenden über den Knopf „Beenden“ in der Oberfläche (entlädt die Modelle und beendet ComfyUI).
$Adresse = "http://127.0.0.1:8190"
$Status = Join-Path $env:LOCALAPPDATA "ki-lokal"
$Log = Join-Path $Status "bildwerkstatt.log"

function Laeuft {
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "$Adresse/api/status" | Out-Null; return $true } catch { return $false }
}

if (-not (Laeuft)) {
    New-Item -ItemType Directory -Force -Path $Status | Out-Null
    $server = Join-Path $PSScriptRoot "server.mjs"
    Start-Process -FilePath "node" -ArgumentList "`"$server`"" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden `
        -RedirectStandardOutput $Log -RedirectStandardError "$Log.err"
    for ($i = 0; $i -lt 30 -and -not (Laeuft); $i++) { Start-Sleep -Milliseconds 300 }
    if (-not (Laeuft)) {
        Write-Host "Bildwerkstatt startet nicht. Protokoll: $Log.err" -ForegroundColor Red
        Get-Content "$Log.err" -Tail 15 -ErrorAction SilentlyContinue
        Read-Host "Enter zum Schliessen" | Out-Null
        exit 1
    }
}
Start-Process $Adresse
