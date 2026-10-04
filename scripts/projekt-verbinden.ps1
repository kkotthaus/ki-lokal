# Verbindet ein Webprojekt mit dem Werkzeugkasten ki-lokal.
# Darf mehrfach laufen, bestehende Eintraege werden nicht doppelt angelegt.
#
# Aufruf:
#   .\scripts\projekt-verbinden.ps1 D:\Projekte\KBS
#
# Was passiert:
#   1. Medienordner D:\Projekte-KI\medien\raw\<Projektname> anlegen
#   2. Abschnitt "Medien (ki-lokal)" in die CLAUDE.md des Projekts eintragen
#   3. Claude Code erlauben, auf D:\Projekte-KI zuzugreifen
#      (.claude\settings.local.json im Projekt)
#   4. settings.local.json in die .gitignore des Projekts eintragen

param(
    [Parameter(Mandatory = $true)][string]$Projekt,
    [string]$KiRoot = "D:\Projekte-KI"
)

$utf8 = New-Object System.Text.UTF8Encoding $false   # UTF-8 ohne BOM

if (-not (Test-Path $Projekt)) {
    Write-Host "ABBRUCH: Projektordner $Projekt nicht gefunden." -ForegroundColor Red
    exit 1
}
$Projekt = (Resolve-Path $Projekt).Path
$name    = Split-Path $Projekt -Leaf
$kiFwd   = $KiRoot -replace '\\', '/'
Write-Host "Verbinde $name mit ki-lokal" -ForegroundColor Cyan

# 1. Medienordner
$medien = Join-Path $KiRoot "medien\raw\$name"
New-Item -ItemType Directory -Force -Path $medien | Out-Null
Write-Host "  Medienordner: $medien"

# 2. CLAUDE.md
$claudeMd = Join-Path $Projekt "CLAUDE.md"
$marker   = "## Medien (ki-lokal)"
$block = @"

$marker
Werkzeuge und Regeln fuer Bilder, Videos und 3D auf der lokalen RTX 5070 Ti:
@$kiFwd/ki-lokal/CLAUDE.md
@$kiFwd/ki-lokal/CLAUDE.local.md

- Originale fuer dieses Projekt: $kiFwd/medien/raw/$name/
  (neu erzeugte KI-Bilder nach dem Erzeugen dorthin verschieben)
- Bilder erzeugen: python $kiFwd/ki-lokal/scripts/comfy/generate.py
- Bilder optimieren: node $kiFwd/ki-lokal/scripts/optimize-images.mjs --src $kiFwd/medien/raw/$name --out <Bildordner des Projekts>
- Den Bildordner (z. B. public/img, static/img, assets/img) an die Struktur dieses Projekts anpassen.
- Originale in medien/raw nie veraendern oder loeschen.
"@

if (Test-Path $claudeMd) {
    $inhalt = [System.IO.File]::ReadAllText($claudeMd)
    if ($inhalt -match [regex]::Escape($marker)) {
        Write-Host "  CLAUDE.md: Abschnitt schon vorhanden" -ForegroundColor DarkGray
    } else {
        [System.IO.File]::AppendAllText($claudeMd, $block, $utf8)
        Write-Host "  CLAUDE.md: Abschnitt ergaenzt" -ForegroundColor Green
    }
} else {
    [System.IO.File]::WriteAllText($claudeMd, "# $name`r`n$block", $utf8)
    Write-Host "  CLAUDE.md: neu angelegt" -ForegroundColor Green
}

# 3. Zugriff auf D:\Projekte-KI erlauben
$claudeDir = Join-Path $Projekt ".claude"
New-Item -ItemType Directory -Force -Path $claudeDir | Out-Null
$settings = Join-Path $claudeDir "settings.local.json"

if (Test-Path $settings) {
    $s = [System.IO.File]::ReadAllText($settings) | ConvertFrom-Json
} else {
    $s = New-Object PSObject
}
if (-not ($s.PSObject.Properties.Name -contains "permissions")) {
    $s | Add-Member -NotePropertyName permissions -NotePropertyValue (New-Object PSObject)
}
$dirs = @(@($s.permissions.additionalDirectories) | Where-Object { $_ })
if ($dirs -notcontains $kiFwd) { $dirs += $kiFwd }
if ($s.permissions.PSObject.Properties.Name -contains "additionalDirectories") {
    $s.permissions.additionalDirectories = $dirs
} else {
    $s.permissions | Add-Member -NotePropertyName additionalDirectories -NotePropertyValue $dirs
}
[System.IO.File]::WriteAllText($settings, ($s | ConvertTo-Json -Depth 10), $utf8)
Write-Host "  Zugriff auf $kiFwd erlaubt (.claude\settings.local.json)"

# 4. .gitignore des Projekts
$gitignore = Join-Path $Projekt ".gitignore"
$eintrag   = ".claude/settings.local.json"
$vorhanden = (Test-Path $gitignore) -and (Select-String -Path $gitignore -SimpleMatch $eintrag -Quiet)
if (-not $vorhanden) {
    [System.IO.File]::AppendAllText($gitignore, "`r`n# Lokale Claude-Einstellungen`r`n$eintrag`r`n", $utf8)
    Write-Host "  .gitignore: $eintrag ergaenzt"
}

Write-Host "`nFertig. Test: cd `"$Projekt`"; claude" -ForegroundColor Cyan
