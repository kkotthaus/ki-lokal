# ComfyUI-Workflows

Hier liegen Workflows im API-Format (ComfyUI: Menü > Workflow > Export (API)).

| Datei | Zweck |
|---|---|
| flux_api.json | Text-zu-Bild mit FLUX.1 schnell |
| rmbg_api.json | Hintergrund entfernen (noch exportieren) |

Skripte, die Claude Code dafür schreibt (z. B. generate.py, remove_bg.py),
ebenfalls hier ablegen. Port der API steht in CLAUDE.local.md.

## generate.py

Erzeugt Bilder mit `flux_api.json` und speichert sie als
`D:/Projekte-KI/medien/raw/<name>-<nummer>.png` (vorhandene Dateien werden nie
überschrieben, die Nummer läuft weiter). Nur Python-Standardbibliothek.

```powershell
python scripts/comfy/generate.py --prompt "helles Büro mit Pflanzen, Morgenlicht" --count 3 --name buero
```

| Parameter | Standard | Bedeutung |
|---|---|---|
| `--prompt` | (Pflicht) | positiver Prompt |
| `--count` | 1 | Anzahl Bilder, jedes mit zufälligem Seed |
| `--width` / `--height` | 1344 / 768 | Bildgröße (durch 16 teilbar) |
| `--name` | bild | Dateiname-Präfix |
| `--server` | http://127.0.0.1:8188 | ComfyUI-API |

Prompt-, Größen- und Sampler-Knoten werden über die Verbindungen des KSamplers
gefunden, die Knoten-IDs im Workflow dürfen sich also ändern.
