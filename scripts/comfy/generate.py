"""Text-zu-Bild über die lokale ComfyUI-API mit scripts/comfy/flux_api.json.

Beispiel:
    python scripts/comfy/generate.py --prompt "helles Büro mit Pflanzen" --count 2 --name buero

Bilder landen als D:/Projekte-KI/medien/raw/<name>-<nummer>.png. Vorhandene
Dateien werden nie überschrieben, die Nummerierung läuft weiter.
Nur Python-Standardbibliothek.
"""

import argparse
import copy
import json
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

WORKFLOW = Path(__file__).with_name("flux_api.json")
OUT_DIR = Path("D:/Projekte-KI/medien/raw")
DEFAULT_SERVER = "http://127.0.0.1:8188"
LATENT_TYPES = ("EmptyLatentImage", "EmptySD3LatentImage")
MAX_SEED = 2**63 - 1  # Obergrenze, die ComfyUI für seed akzeptiert


class ComfyError(Exception):
    pass


def request(server, path, data=None, timeout=30):
    url = server.rstrip("/") + path
    body = None
    headers = {}
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise ComfyError(f"ComfyUI meldet HTTP {e.code} für {path}:\n{detail}") from None
    except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
        reason = getattr(e, "reason", e)
        raise ComfyError(
            f"ComfyUI ist unter {server} nicht erreichbar ({reason}).\n"
            "Läuft ComfyUI Desktop? Port prüfen (CLAUDE.local.md) oder --server angeben."
        ) from None


def find_nodes(workflow):
    """Liefert (KSampler-ID, positiver Prompt-ID, Latent-ID) anhand der Verbindungen."""
    samplers = [nid for nid, n in workflow.items() if n.get("class_type") == "KSampler"]
    if len(samplers) != 1:
        raise ComfyError(f"Erwarte genau einen KSampler im Workflow, gefunden: {len(samplers)}")
    sampler_id = samplers[0]
    inputs = workflow[sampler_id]["inputs"]

    positive = inputs.get("positive")
    if not isinstance(positive, list):
        raise ComfyError("KSampler-Eingang 'positive' ist mit keinem Knoten verbunden.")
    positive_id = str(positive[0])
    if workflow.get(positive_id, {}).get("class_type") != "CLIPTextEncode":
        raise ComfyError(
            f"KSampler 'positive' zeigt auf Knoten {positive_id} "
            f"({workflow.get(positive_id, {}).get('class_type')}), nicht auf CLIPTextEncode."
        )

    latent = inputs.get("latent_image")
    latent_id = str(latent[0]) if isinstance(latent, list) else None
    if workflow.get(latent_id, {}).get("class_type") not in LATENT_TYPES:
        candidates = [nid for nid, n in workflow.items() if n.get("class_type") in LATENT_TYPES]
        if len(candidates) != 1:
            raise ComfyError(f"Kein eindeutiger {' / '.join(LATENT_TYPES)}-Knoten gefunden.")
        latent_id = candidates[0]

    return sampler_id, positive_id, latent_id


def wait_for_result(server, prompt_id, timeout=600):
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        history = json.loads(request(server, f"/history/{prompt_id}"))
        entry = history.get(prompt_id)
        if entry:
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                msgs = [m for m in status.get("messages", []) if m[0] == "execution_error"]
                detail = msgs[0][1].get("exception_message", "") if msgs else ""
                raise ComfyError(f"ComfyUI-Fehler bei der Ausführung: {detail}".strip())
            if status.get("completed", True):
                return entry.get("outputs", {})
        time.sleep(0.5)
    raise ComfyError(f"Kein Ergebnis nach {timeout} s (prompt_id {prompt_id}).")


def next_free_path(name, start):
    n = start
    while True:
        path = OUT_DIR / f"{name}-{n}.png"
        if not path.exists():
            return path, n
        n += 1


def main():
    parser = argparse.ArgumentParser(description="Bilder mit FLUX.1 schnell über ComfyUI erzeugen.")
    parser.add_argument("--prompt", required=True, help="Bildbeschreibung (positiver Prompt)")
    parser.add_argument("--count", type=int, default=1, help="Anzahl Bilder (Standard 1)")
    parser.add_argument("--width", type=int, default=1344, help="Breite in px (Standard 1344)")
    parser.add_argument("--height", type=int, default=768, help="Höhe in px (Standard 768)")
    parser.add_argument("--name", default="bild", help='Dateiname-Präfix (Standard "bild")')
    parser.add_argument("--server", default=DEFAULT_SERVER, help=f"ComfyUI-API (Standard {DEFAULT_SERVER})")
    args = parser.parse_args()

    if args.count < 1:
        parser.error("--count muss mindestens 1 sein")
    if args.width % 16 or args.height % 16:
        print("Hinweis: Breite/Höhe sollten durch 16 teilbar sein.", file=sys.stderr)

    try:
        template = json.loads(WORKFLOW.read_text(encoding="utf-8"))
        sampler_id, positive_id, latent_id = find_nodes(template)
        request(server=args.server, path="/system_stats", timeout=5)  # Erreichbarkeit früh prüfen
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        client_id = str(uuid.uuid4())
        number = 1

        for i in range(args.count):
            workflow = copy.deepcopy(template)
            workflow[positive_id]["inputs"]["text"] = args.prompt
            workflow[latent_id]["inputs"]["width"] = args.width
            workflow[latent_id]["inputs"]["height"] = args.height
            seed = random.randint(0, MAX_SEED)
            workflow[sampler_id]["inputs"]["seed"] = seed

            started = time.monotonic()
            resp = json.loads(request(args.server, "/prompt", {"prompt": workflow, "client_id": client_id}))
            prompt_id = resp["prompt_id"]
            outputs = wait_for_result(args.server, prompt_id)

            images = [img for out in outputs.values() for img in out.get("images", [])
                      if img.get("type") == "output"]
            if not images:
                raise ComfyError("Auftrag fertig, aber ComfyUI hat kein Bild geliefert.")
            for img in images:
                query = urllib.parse.urlencode(
                    {"filename": img["filename"], "subfolder": img.get("subfolder", ""), "type": img["type"]}
                )
                data = request(args.server, f"/view?{query}", timeout=60)
                path, number = next_free_path(args.name, number)
                path.write_bytes(data)
                number += 1
                print(f"[{i + 1}/{args.count}] {path}  (Seed {seed}, {time.monotonic() - started:.1f} s)")
    except ComfyError as e:
        print(f"Fehler: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Abgebrochen.", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
