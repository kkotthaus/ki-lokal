"""Bild-zu-Bild über die lokale ComfyUI-API mit FLUX.1 schnell: eine Vorlage (z. B. eine eigene Skizze mit der
richtigen Form) gibt Aufbau und Umriss vor, der Prompt den Stil. Für Motive, die FLUX allein nicht richtig zeichnet.

Beispiel:
    python scripts/comfy/img2img.py --bild skizze.png --prompt "copperplate engraving of ..." --staerke 0.65 --count 4 --name rehbock

--staerke (denoise): 0.4 = nah an der Vorlage, 0.8 = freier. Ausgabe wie generate.py nach D:/Projekte-KI/medien/raw/.
Nur Python-Standardbibliothek.
"""

import argparse
import copy
import json
import random
import sys
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from generate import DEFAULT_SERVER, MAX_SEED, OUT_DIR, ComfyError, next_free_path, request, wait_for_result

CKPT = "flux1-schnell-fp8.safetensors"

WORKFLOW = {
    "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
    "10": {"class_type": "LoadImage", "inputs": {"image": ""}},
    "11": {"class_type": "VAEEncode", "inputs": {"pixels": ["10", 0], "vae": ["4", 2]}},
    "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["4", 1]}},
    "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["4", 1]}},
    "3": {
        "class_type": "KSampler",
        "inputs": {
            "seed": 42, "steps": 4, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 0.65,
            "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["11", 0],
        },
    },
    "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
    "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "ki-lokal-img2img", "images": ["8", 0]}},
}


def upload(server, pfad):
    """Vorlage an ComfyUI hochladen (multipart, ohne Fremdbibliothek); liefert den Namen im input-Ordner."""
    grenze = uuid.uuid4().hex
    daten = Path(pfad).read_bytes()
    teile = (
        f"--{grenze}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{Path(pfad).name}\"\r\n"
        "Content-Type: image/png\r\n\r\n"
    ).encode() + daten + f"\r\n--{grenze}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n--{grenze}--\r\n".encode()
    req = urllib.request.Request(
        server.rstrip("/") + "/upload/image", data=teile,
        headers={"Content-Type": f"multipart/form-data; boundary={grenze}"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())["name"]


def main():
    parser = argparse.ArgumentParser(description="Bild-zu-Bild mit FLUX.1 schnell über ComfyUI.")
    parser.add_argument("--bild", required=True, help="Vorlage (PNG/JPEG); ihre Größe bestimmt die Ausgabegröße")
    parser.add_argument("--prompt", required=True, help="Bildbeschreibung (Stil und Inhalt)")
    parser.add_argument("--staerke", type=float, default=0.65, help="denoise 0..1 (Standard 0.65)")
    parser.add_argument("--count", type=int, default=1, help="Anzahl Bilder (Standard 1)")
    parser.add_argument("--name", default="bild", help='Dateiname-Präfix (Standard "bild")')
    parser.add_argument("--server", default=DEFAULT_SERVER, help=f"ComfyUI-API (Standard {DEFAULT_SERVER})")
    args = parser.parse_args()

    try:
        stats = json.loads(request(args.server, "/system_stats", timeout=5))
        # Nur auf der Grafikkarte erzeugen: läuft ComfyUI auf der CPU, abbrechen
        devices = [d.get("type") for d in stats.get("devices", [])]
        if "cuda" not in devices:
            raise ComfyError(f"ComfyUI läuft nicht auf der Grafikkarte (Geräte: {devices or 'keine'}). Abbruch.")
        name_im_input = upload(args.server, args.bild)
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        client_id = str(uuid.uuid4())
        number = 1
        for i in range(args.count):
            wf = copy.deepcopy(WORKFLOW)
            wf["10"]["inputs"]["image"] = name_im_input
            wf["6"]["inputs"]["text"] = args.prompt
            wf["3"]["inputs"]["denoise"] = max(0.05, min(1.0, args.staerke))
            seed = random.randint(0, MAX_SEED)
            wf["3"]["inputs"]["seed"] = seed
            started = time.monotonic()
            resp = json.loads(request(args.server, "/prompt", {"prompt": wf, "client_id": client_id}))
            outputs = wait_for_result(args.server, resp["prompt_id"])
            images = [img for out in outputs.values() for img in out.get("images", []) if img.get("type") == "output"]
            if not images:
                raise ComfyError("Auftrag fertig, aber ComfyUI hat kein Bild geliefert.")
            for img in images:
                query = urllib.parse.urlencode({"filename": img["filename"], "subfolder": img.get("subfolder", ""), "type": img["type"]})
                path, number = next_free_path(args.name, number)
                path.write_bytes(request(args.server, f"/view?{query}", timeout=60))
                number += 1
                print(f"[{i + 1}/{args.count}] {path}  (Seed {seed}, Stärke {args.staerke}, {time.monotonic() - started:.1f} s)")
    except ComfyError as e:
        print(f"Fehler: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
