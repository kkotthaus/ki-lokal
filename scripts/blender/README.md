# Blender-Skripte

Python-Skripte für Blender im Hintergrundmodus:

    blender -b -P scripts/blender/<skript>.py

Renders nach D:\Projekte-KI\medien\renders\ schreiben.

## Skripte

- `weka-e-notebook-frontal.py` – Notebook frontal, freigestellt, ohne Schatten, Bildschirminhalt als Textur (`--screen`). `--elev` = Kamerahöhe in Grad (Deckel wird mitgeneigt), Kamera passt sich automatisch ans Bild an. `--name` für Varianten, `--preview` für die Vorschau.
