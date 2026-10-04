# Verknuepft die Ordner von ComfyUI Desktop (C:) mit D:\Projekte-KI\ComfyUI
# per Junction. Vorhandene Dateien werden nach D: verschoben.
# Darf mehrfach laufen: bestehende Verknuepfungen werden uebersprungen.
#
# Aufruf aus dem Repo-Ordner (ComfyUI vorher komplett beenden):
#   .\scripts\comfy-verknuepfen.ps1

param(
    [string]$Ziel   = "D:\Projekte-KI\ComfyUI",
    [string]$Shared = "$env:LOCALAPPDATA\Comfy-Desktop\ComfyUI-Shared",
    [string[]]$Ordner = @("models", "output", "input")
)

Write-Host "ComfyUI-Ordner verknuepfen" -ForegroundColor Cyan
Write-Host "  von: $Shared"
Write-Host "  auf: $Ziel`n"

# 1. ComfyUI darf nicht laufen
$laeuft = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in 8000, 8188 }
if ($laeuft) {
    Write-Host "ABBRUCH: ComfyUI laeuft noch (Port $($laeuft[0].LocalPort))." -ForegroundColor Red
    Write-Host "Bitte ComfyUI komplett beenden, auch im Infobereich neben der Uhr."
    exit 1
}

if (-not (Test-Path $Shared)) {
    Write-Host "ABBRUCH: $Shared nicht gefunden. Ist ComfyUI Desktop installiert?" -ForegroundColor Red
    exit 1
}

# 2. Ordner verschieben und verknuepfen
foreach ($o in $Ordner) {
    $quelle = Join-Path $Shared $o
    $neu    = Join-Path $Ziel $o
    New-Item -ItemType Directory -Force -Path $neu | Out-Null

    if (Test-Path $quelle) {
        if ((Get-Item $quelle -Force).LinkType -eq "Junction") {
            Write-Host "  $o ist schon verknuepft" -ForegroundColor DarkGray
            continue
        }
        Write-Host "  $o wird nach D: verschoben ..."
        robocopy $quelle $neu /E /MOVE /NFL /NDL /NJH /NJS | Out-Null
        $rest = Get-ChildItem $quelle -Recurse -File -Force -ErrorAction SilentlyContinue
        if ($rest.Count -gt 0) {
            Write-Host "ABBRUCH: In $quelle liegen noch $($rest.Count) Dateien." -ForegroundColor Red
            Write-Host "Wahrscheinlich sind sie in Benutzung. ComfyUI beenden und erneut starten."
            exit 1
        }
        Remove-Item $quelle -Recurse -Force
    }

    New-Item -ItemType Junction -Path $quelle -Target $neu | Out-Null
    Write-Host "  $o  ->  $neu" -ForegroundColor Green
}

# 3. Ergebnis
Write-Host "`nFertig. Modelle in $Ziel\models\checkpoints:" -ForegroundColor Cyan
Get-ChildItem "$Ziel\models\checkpoints" -File -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Host ("  {0}  ({1:N1} GB)" -f $_.Name, ($_.Length / 1GB)) }
Write-Host "`nJetzt ComfyUI starten und pruefen mit:"
Write-Host "  curl.exe http://127.0.0.1:8188/models/checkpoints"
