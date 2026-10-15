# ki-lokal

Lokale KI-Werkzeuge für die Webseiten-Entwicklung auf der RTX 5070 Ti (16 GB).
Alles liegt unter `D:\Projekte-KI`. Dieses Repo enthält nur Skripte, Workflows
und Einstellungen. Modelle, ComfyUI und Mediendateien liegen daneben und
werden nicht versioniert.

## Ordnerstruktur

```
D:\Projekte-KI\
├─ ki-lokal\      <- dieses Repo (Skripte, Workflows, CLAUDE.md, Vorlagen)
├─ ComfyUI\       <- ComfyUI-Daten: models, output, custom_nodes (nicht im Git)
├─ medien\
│  ├─ raw\        <- Originale, KI-Bilder, Kundenmaterial (nicht im Git)
│  └─ renders\    <- Blender-Ausgaben (nicht im Git)
└─ cache\         <- Download-Cache für Modelle (nicht im Git)
```

## Einrichtung auf einem neuen Rechner

```powershell
cd D:\Projekte-KI
git clone https://github.com/kkotthaus/ki-lokal.git
cd ki-lokal
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

Danach ComfyUI Desktop installieren (https://www.comfy.org/download), einmal
starten und wieder komplett beenden. Dann die Modell-, Eingabe- und Ausgabeordner
nach D: verknüpfen:

```powershell
.\scripts\comfy-verknuepfen.ps1
```

Prüfen bei laufendem ComfyUI: `curl.exe http://127.0.0.1:8188/models/checkpoints`

## Benötigte Modelle (nicht im Repo)

| Modell | Ordner | Download |
|---|---|---|
| FLUX.1 schnell fp8 (Apache 2.0) | `ComfyUI\models\checkpoints` | https://huggingface.co/Comfy-Org/flux1-schnell |
| BiRefNet (MIT) | `ComfyUI\models\background_removal` | https://huggingface.co/Comfy-Org/BiRefNet |
| Real-ESRGAN x4plus (BSD-3) | `ComfyUI\models\upscale_models` | https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth |
| Qwen3.5 9B mit Bilderkennung (Apache 2.0) | LM Studio | `lms get qwen/qwen3.5-9b` |
| LaMa big-lama.pt (Code Apache 2.0, trainiert auf Places2) | `ComfyUI\models\inpaint` | https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt (MD5 e3aa4aaa15225a33ec84f9f4bc47e500) |

## Werkzeuge

- `app/` – **Bildwerkstatt**: Bild per Drag & Drop ablegen, dann per Knopf oder freiem Text
  freistellen, Inhalte entfernen (markieren mit dem Pinsel), vergrößern, zuschneiden, aufhellen,
  schwarzweiß, fürs Web optimieren, Alt-Text und
  Dateinamen vorschlagen.
  Alles lokal auf der Grafikkarte (ComfyUI, LM Studio). Start: Verknüpfung „Bildwerkstatt“ auf dem
  Desktop bzw. `app\start.ps1` (http://127.0.0.1:8190), Beenden über den Knopf in der Oberfläche.
  Ziel ist ein Projekt (`medien\raw\<projekt>`) oder eine frei gewählte Ablage; die Wahl wird in
  `%LOCALAPPDATA%\ki-lokal\bildwerkstatt.json` gemerkt. Das Original wird nur kopiert, nie verändert.
  Auf der Grafikkarte liegt immer nur ein Modell: vor ComfyUI wird das Sprachmodell entladen und umgekehrt.
- `scripts/optimize-images.mjs` – Bilder in AVIF + WebP, 640/1280/1920 px (Kern in `scripts/bilder-web.mjs`)
- `scripts/inpaint/lama.py` – markierte Inhalte entfernen und auffüllen (LaMa, läuft mit dem Python
  von ComfyUI auf CUDA; jede markierte Stelle wird einzeln mit eigenem Ausschnitt bearbeitet)
- `scripts/comfy/remove_bg.py` – freistellen, `scripts/comfy/upscale_api.json` – vergrößern mit Real-ESRGAN
- `scripts/comfy/` – ComfyUI-Workflows (API-Export) und Skripte dafür
- `scripts/comfy/generate.py` – Text-zu-Bild mit FLUX.1 schnell über die ComfyUI-API,
  speichert nach `medien\raw\<name>-<nummer>.png`
- `scripts/blender/` – Blender-Python-Skripte
- `vorlagen/webprojekt/` – CLAUDE.md für neue Webprojekte

