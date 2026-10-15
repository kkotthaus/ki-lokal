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

**Lizenz LaMa (Stand 2026-10-15):** Code Apache 2.0. Die Gewichte tragen auf Hugging Face
„apache-2.0“, eingetragen vom Weiterverteiler, nicht vom LaMa-Team. Trainiert auf Places2:
dessen Bilder sind nur für nicht-kommerzielle Forschung freigegeben (MIT CSAIL besitzt die
Bildrechte nicht); zu daraus trainierten Modellen sagen die Bedingungen nichts. LaMa füllt nur aus
dem jeweiligen Foto auf und übernimmt keine Trainingsbilder. Einschätzung: für eigene und
Kundenfotos vertretbar und verbreitet (z. B. IOPaint), aber nicht als „lizenzrechtlich geprüft“
angeben; verbindlich klärt das nur eine juristische Prüfung.

## Werkzeuge

- `app/` – **Bildwerkstatt**: **Neu erstellen** nach Beschreibung („Erstelle ein SVG, das einen Handball darstellt“):
  das Sprachmodell wählt Art (Bild/SVG) und Format und schreibt den englischen Prompt, FLUX erzeugt das Bild;
  bei SVG wird es nachgezeichnet (`scripts/vektor/svg.py`), mit Knopf „SVG-Code kopieren“. Jeder Klick ergibt eine neue Variante.
  **Farben von einer Website** (`app/lib/farben.mjs`): Adresse eingeben (auch Local-Seiten wie https://paas.local, die
  Bildwerkstatt fragt sie am Platz 1 ab). Ist ein Projekt gewählt, kommen die Farben automatisch von dessen Seite
  laut `windows-dev/projekte.json`: lokal, sonst Staging, sonst Live – die erste erreichbare (je Projekt einmal geladen).
  Gelesen werden theme-color, Hauptfarben als CSS-Variablen (ACSS `--primary` usw., WordPress-Palette) und häufige Farben.
  Gewählte Farben gehen in den Prompt (Bild: ungefähr) und werden im SVG exakt gesetzt (`svg.py --palette`).
  **Logo einsetzen:** Logo als Datei ablegen oder über „Logo holen“ von der Website wählen (Kandidaten aus `<img>` mit
  „logo“ und den Icons); es wird im Zielordner unter `logos\` gespeichert. Position, Größe (12/20/35 % der Breite) und
  helle/dunkle Fläche dahinter wählbar. In Bildern wird es eingerechnet, in SVGs als Vektor (bzw. eingebettetes PNG) eingefügt.
  Fremde Logos nur mit Zustimmung des Inhabers verwenden.
  Oder ein Bild per Drag & Drop ablegen, dann per Knopf oder freiem Text
  freistellen, Inhalte entfernen (markieren mit dem Pinsel), vergrößern, zuschneiden, aufhellen,
  schwarzweiß, fürs Web optimieren, Alt-Text und
  Dateinamen vorschlagen.
  Alles lokal auf der Grafikkarte (ComfyUI, LM Studio). Start: Verknüpfung „Bildwerkstatt“ auf dem
  Desktop bzw. `app\start.ps1` (http://127.0.0.1:8190), Beenden über den Knopf in der Oberfläche.
  Ziel ist ein Projekt (`medien\raw\<projekt>`) oder eine frei gewählte Ablage; die Wahl wird in
  `%LOCALAPPDATA%\ki-lokal\bildwerkstatt.json` gemerkt. Das Original wird nur kopiert, nie verändert.
  Auf der Grafikkarte liegt immer nur ein Modell: vor ComfyUI wird das Sprachmodell entladen und umgekehrt.
  **Vom anderen Arbeitsplatz:** In den Einstellungen `"netzwerk": true` und unter `"rechner"` die erlaubten
  IP-Adressen (Platz 2: 192.168.110.51). Dann erreichbar unter http://192.168.110.50:8190, beim ersten Mal mit
  Zugangsschlüssel (liegt in `%LOCALAPPDATA%\ki-lokal\bildwerkstatt-schluessel.txt`, Kopie in Vaultwarden;
  am Rechner selbst über „Schlüssel kopieren“). Von außen: Ergebnisse über „Herunterladen“ bzw. „Web-Größen (ZIP)“,
  kein Ordnerdialog, keine neuen Ablagen, kein Beenden. Firewall-Regel (einmal, als Administrator):
  `New-NetFirewallRule -DisplayName "Bildwerkstatt (Port 8190, nur Platz 2)" -Direction Inbound -Protocol TCP -LocalPort 8190 -RemoteAddress 192.168.110.51 -Action Allow -Profile Domain,Private`
- `scripts/optimize-images.mjs` – Bilder in AVIF + WebP, 640/1280/1920 px (Kern in `scripts/bilder-web.mjs`)
- `scripts/inpaint/lama.py` – markierte Inhalte entfernen und auffüllen (LaMa, läuft mit dem Python
  von ComfyUI auf CUDA; jede markierte Stelle wird einzeln mit eigenem Ausschnitt bearbeitet)
- `scripts/vektor/svg.py` – Bild in SVG umwandeln (vtracer): heller Hintergrund fällt vom Rand aus weg (weiße Flächen im
  Motiv bleiben), wenige Farben per k-Means, Ergebnis mit viewBox. Taugt für flache Grafiken und Icons, nicht für Fotos.
  vtracer liegt in der Python-Umgebung von ComfyUI: `uv pip install --python "<ComfyUI>\.venv\Scripts\python.exe" vtracer`
- `scripts/comfy/remove_bg.py` – freistellen, `scripts/comfy/upscale_api.json` – vergrößern mit Real-ESRGAN
- `scripts/comfy/` – ComfyUI-Workflows (API-Export) und Skripte dafür
- `scripts/comfy/generate.py` – Text-zu-Bild mit FLUX.1 schnell über die ComfyUI-API,
  speichert nach `medien\raw\<name>-<nummer>.png`
- `scripts/blender/` – Blender-Python-Skripte
- `vorlagen/webprojekt/` – CLAUDE.md für neue Webprojekte

