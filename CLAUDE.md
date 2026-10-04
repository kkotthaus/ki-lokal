# ki-lokal: Medien-Werkzeuge auf der RTX 5070 Ti (16 GB VRAM)

Dieses Repo ist der zentrale Werkzeugkasten. Webprojekte verweisen hierher.
Rechner-spezifische Werte (Port, Pfade) stehen in CLAUDE.local.md.

## Ordner (Standard)
- D:\Projekte-KI\ki-lokal: dieses Repo
- D:\Projekte-KI\ComfyUI: ComfyUI-Daten (models, output, custom_nodes)
- D:\Projekte-KI\medien\raw: Originale. Nie verändern oder löschen.
- D:\Projekte-KI\medien\renders: Blender-Ausgaben

## Werkzeuge
- ComfyUI läuft lokal, Port siehe CLAUDE.local.md. API-Workflows in scripts/comfy/
- Bildmodell: FLUX.1 schnell (fp8), 4 Steps, CFG 1.0. Für Kundenprojekte nur
  gewerblich nutzbare Modelle verwenden (kein FLUX.1 dev).
- Videos: FFmpeg immer mit NVENC (h264_nvenc oder av1_nvenc), nie libx264.
  Hintergrundvideos stumm (-an), max. 1920 px, mit Posterbild.
- Bilder: node D:/Projekte-KI/ki-lokal/scripts/optimize-images.mjs --src <ordner> --out <ordner>
- 3D: Blender mit Cycles + OptiX, Export als .glb, danach
  gltf-transform optimize mit --compress draco --texture-compress webp
- Blender ohne Oberfläche: blender -b datei.blend -P skript.py

## Regeln
- Neue Skripte nach scripts/ legen, kurz im README.md eintragen.
- Keine Kundendaten, Zugangsdaten oder Mediendateien committen.
- Vor großen Batch-Jobs (mehr als 20 Dateien oder mehr als 5 Minuten) bestätigen lassen.
