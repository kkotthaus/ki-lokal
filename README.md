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

Danach ComfyUI Desktop installieren (https://www.comfy.org/download) und als
Speicherort `D:\Projekte-KI\ComfyUI` wählen.

## Benötigte Modelle (nicht im Repo)

| Modell | Ordner | Download |
|---|---|---|
| FLUX.1 schnell fp8 (Apache 2.0) | `ComfyUI\models\checkpoints` | https://huggingface.co/Comfy-Org/flux1-schnell |
| RMBG-2.0 / BiRefNet | lädt ComfyUI-RMBG selbst | https://github.com/1038lab/ComfyUI-RMBG |

## Werkzeuge

- `scripts/optimize-images.mjs` – Bilder in AVIF + WebP, 640/1280/1920 px
- `scripts/comfy/` – ComfyUI-Workflows (API-Export) und Skripte dafür
- `scripts/blender/` – Blender-Python-Skripte
- `vorlagen/webprojekt/` – CLAUDE.md für neue Webprojekte
