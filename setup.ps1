# Einrichtung von ki-lokal unter D:\Projekte-KI
# Aufruf aus dem Repo-Ordner:
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1

param([string]$Root = "D:\Projekte-KI")

$Repo = $PSScriptRoot
Write-Host "Richte ki-lokal unter $Root ein ..." -ForegroundColor Cyan

# 1. Ordner anlegen
$dirs = @("ComfyUI", "medien\raw", "medien\renders", "cache\huggingface")
foreach ($d in $dirs) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Root $d) | Out-Null
    Write-Host "  Ordner: $Root\$d"
}

# 2. Modell-Downloads auf D: statt C: lenken (gilt fuer den Benutzer)
[Environment]::SetEnvironmentVariable("HF_HOME", "$Root\cache\huggingface", "User")
[Environment]::SetEnvironmentVariable("KI_LOKAL", $Repo, "User")
Write-Host "  HF_HOME  = $Root\cache\huggingface"
Write-Host "  KI_LOKAL = $Repo"

# 3. Lokale Claude-Einstellungen anlegen
$local = Join-Path $Repo "CLAUDE.local.md"
if (-not (Test-Path $local)) {
    Copy-Item (Join-Path $Repo "CLAUDE.local.md.example") $local
    Write-Host "  CLAUDE.local.md angelegt (bitte Port pruefen)"
}

# 4. Node-Pakete (sharp) installieren
Push-Location $Repo
npm install --silent
Pop-Location
Write-Host "  sharp installiert"

# 5. Pruefung
Write-Host "`nPruefung:" -ForegroundColor Cyan
function Check($name, $block) {
    try { $r = & $block 2>$null; if ($r) { Write-Host "  OK      $name" -ForegroundColor Green } else { throw } }
    catch { Write-Host "  FEHLT   $name" -ForegroundColor Yellow }
}
Check "NVIDIA-Treiber"      { nvidia-smi --query-gpu=name --format=csv,noheader }
Check "FFmpeg mit AV1-NVENC" { ffmpeg -hide_banner -encoders | Select-String av1_nvenc }
Check "Blender"             { blender --version | Select-Object -First 1 }
Check "gltf-transform"      { gltf-transform --version }
Check "Claude Code"         { claude --version }
Check "ComfyUI-Modell"      { Get-ChildItem "$Root\ComfyUI\models\checkpoints\*.safetensors" -ErrorAction Stop }

Write-Host "`nFertig. Terminal neu oeffnen, damit HF_HOME und KI_LOKAL gelten." -ForegroundColor Cyan

