---
description: Grafik für die Webseite erstellen (3D-Rendering, KI-Bild oder SVG) – fragt nach, was gebraucht wird
argument-hint: [optional: Motiv, z. B. "Flatlay mit Laptop und Notizbuch"]
---

# Grafik erstellen

Du hilfst, eine Grafik für das aktuelle Webprojekt zu erstellen. Werkzeuge, Pfade
und Regeln stehen in D:/Projekte-KI/ki-lokal/CLAUDE.md und CLAUDE.local.md.
Lies beide zuerst, falls sie nicht schon geladen sind.

Projektname = Name des aktuellen Arbeitsordners (z. B. KBS).
Motiv aus dem Aufruf: $ARGUMENTS

## Schritt 1: Nachfragen

Stelle die Fragen mit dem AskUserQuestion-Tool (Auswahl zum Anklicken), nicht als Fließtext.
Alle vier Fragen in einem Aufruf:

1. Art der Grafik: 3D-Rendering mit Blender (klar als Rendering erkennbar) / KI-Bild mit FLUX / SVG-Grafik (Icon, Illustration, Diagramm)
2. Einsatz und Format: Hero 16:9 / Teaser 3:2 / Quadrat 1:1 / Hochformat 2:3
3. Personen: Keine Personen / Stilisierte, abstrakte Figuren
4. Varianten: 1 / 2 / 4

Wenn $ARGUMENTS leer ist, frage in einer kurzen Textzeile: „Was soll zu sehen sein?“
Wenn $ARGUMENTS ein Motiv enthält, nutze es und frage nicht erneut.

Auflösungen: Blender 16:9 = 1920x1080, 3:2 = 1500x1000, 1:1 = 1200x1200, 2:3 = 1000x1500.
FLUX 16:9 = 1344x768, 3:2 = 1216x832, 1:1 = 1024x1024, 2:3 = 832x1216.

## Schritt 2: Stil des Projekts ermitteln

Suche im Projekt nach Farben und Stil (CSS-Variablen, Tailwind-Config, CLAUDE.md, vorhandene Bilder).
Fasse in zwei Sätzen zusammen, welche Farben und welche Anmutung du verwendest, und arbeite damit weiter.

## Schritt 3: Erstellen – immer erst eine Vorschau

### 3D-Rendering (Blender)
- Skript nach D:/Projekte-KI/ki-lokal/scripts/blender/<projekt>-<motiv>.py schreiben oder ein passendes vorhandenes anpassen.
- Szenen aus Grundformen bauen: Möbel, Geräte, Pflanzen, Papier, Tassen. Keine realistischen Menschen.
  Bei „stilisierte Figuren“ bewusst abstrakt (z. B. glatte Kapselformen).
- Cycles, Device GPU, OptiX, Denoising an.
- Vorschau: halbe Auflösung, 64 Samples: blender -b -P <skript> -- --preview
- Ausgabe: D:/Projekte-KI/medien/renders/<projekt>/<motiv>-preview.png

### KI-Bild (FLUX)
- ComfyUI starten bzw. prüfen: pwsh -NoProfile -File D:/Projekte-KI/ki-lokal/scripts/comfy/start.ps1 (startet den Server im Hintergrund, wenn die API nicht antwortet; läuft er schon, passiert nichts). Scheitert der Start: Fehler zeigen und Nutzer fragen.
- Wenn keine weiteren Bilder anstehen: pwsh -NoProfile -File D:/Projekte-KI/ki-lokal/scripts/comfy/stop.ps1 (beendet nur einen von start.ps1 gestarteten Server).
- Englischen Prompt formulieren und kurz zeigen.
- python D:/Projekte-KI/ki-lokal/scripts/comfy/generate.py --prompt "..." --count <n> --width .. --height .. --name <projekt>-<motiv>
- Danach nach D:/Projekte-KI/medien/raw/<projekt>/ verschieben.
- Bei fotorealistischen Bildern mit Personen oder realen Orten auf mögliche Kennzeichnungspflicht (Art. 50 AI Act) hinweisen.

### SVG-Grafik
- SVG direkt schreiben, Farben aus Schritt 2, passende viewBox, keine eingebetteten Bitmaps.
- Ablegen unter D:/Projekte-KI/medien/raw/<projekt>/<motiv>.svg

Pfade der Vorschau zeigen und mit AskUserQuestion fragen: Passt, final erstellen / Anpassen / Verwerfen

## Schritt 4: Final erstellen und einbinden

- Blender: volle Auflösung, 256 Samples, nach D:/Projekte-KI/medien/raw/<projekt>/<motiv>.png
- Bitmaps optimieren: node D:/Projekte-KI/ki-lokal/scripts/optimize-images.mjs --src D:/Projekte-KI/medien/raw/<projekt> --out <Bildordner des Projekts>
- SVG mit sinnvollem Namen in den Bildordner des Projekts kopieren.

Mit AskUserQuestion fragen, ob und wo eingebunden werden soll (Vorschläge plus „Noch nicht einbinden“).
Beim Einbinden: <picture> mit AVIF, WebP und Fallback, width/height, deutscher Alt-Text.
Zum Schluss in drei Zeilen melden: erzeugte Dateien, Größe nach Optimierung, wo eingebunden.