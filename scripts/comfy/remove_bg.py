"""Hintergrund entfernen mit ComfyUI (BiRefNet, Workflow rmbg_api.json).

Lädt ein Bild nach ComfyUI hoch, erzeugt die Freistell-Maske und speichert das
Ergebnis als PNG mit Alphakanal. Vorhandene Dateien werden nie überschrieben.
Nur Python-Standardbibliothek.

    python scripts/comfy/remove_bg.py --src bild.png --out D:/Projekte-KI/medien/raw/<projekt>
"""
import argparse
import json
import os
import time
import urllib.parse
import urllib.request
import uuid

HIER = os.path.dirname(os.path.abspath(__file__))


def hochladen(server, pfad):
    grenze = uuid.uuid4().hex
    name = os.path.basename(pfad)
    with open(pfad, 'rb') as f:
        daten = f.read()
    koerper = (
        f'--{grenze}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\n'
        'Content-Type: application/octet-stream\r\n\r\n'
    ).encode() + daten + (
        f'\r\n--{grenze}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--{grenze}--\r\n'
    ).encode()
    anfrage = urllib.request.Request(f'{server}/upload/image', data=koerper,
                                     headers={'Content-Type': f'multipart/form-data; boundary={grenze}'})
    with urllib.request.urlopen(anfrage) as r:
        return json.load(r)['name']


def ziel_frei(ordner, basis):
    pfad = os.path.join(ordner, f'{basis}.png')
    n = 2
    while os.path.exists(pfad):
        pfad = os.path.join(ordner, f'{basis}-{n}.png')
        n += 1
    return pfad


def main():
    p = argparse.ArgumentParser(description='Hintergrund entfernen (ComfyUI, BiRefNet)')
    p.add_argument('--src', required=True, help='Eingabebild')
    p.add_argument('--out', required=True, help='Zielordner')
    p.add_argument('--name', help='Dateiname ohne Endung (Standard: <eingabe>-freigestellt)')
    p.add_argument('--server', default='http://127.0.0.1:8188')
    a = p.parse_args()

    with open(os.path.join(HIER, 'rmbg_api.json'), encoding='utf-8') as f:
        workflow = json.load(f)
    # Nur auf der Grafikkarte freistellen: läuft ComfyUI auf der CPU, abbrechen
    with urllib.request.urlopen(f'{a.server}/system_stats', timeout=5) as r:
        geraete = [g.get('type') for g in json.load(r).get('devices', [])]
    if 'cuda' not in geraete:
        raise SystemExit(f'ComfyUI läuft nicht auf der Grafikkarte (Geräte: {geraete or "keine"}). Abbruch.')
    workflow['1']['inputs']['image'] = hochladen(a.server, a.src)

    anfrage = urllib.request.Request(f'{a.server}/prompt', data=json.dumps({'prompt': workflow}).encode(),
                                     headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(anfrage) as r:
        prompt_id = json.load(r)['prompt_id']

    for _ in range(600):
        with urllib.request.urlopen(f'{a.server}/history/{prompt_id}') as r:
            verlauf = json.load(r)
        if prompt_id in verlauf:
            eintrag = verlauf[prompt_id]
            if eintrag.get('status', {}).get('status_str') == 'error':
                raise SystemExit(f'ComfyUI-Fehler: {eintrag["status"]}')
            bilder = eintrag['outputs']['6']['images']
            break
        time.sleep(1)
    else:
        raise SystemExit('Zeitüberschreitung')

    os.makedirs(a.out, exist_ok=True)
    basis = a.name or os.path.splitext(os.path.basename(a.src))[0] + '-freigestellt'
    for b in bilder:
        q = urllib.parse.urlencode({'filename': b['filename'], 'subfolder': b['subfolder'], 'type': b['type']})
        ziel = ziel_frei(a.out, basis)
        with urllib.request.urlopen(f'{a.server}/view?{q}') as r, open(ziel, 'wb') as f:
            f.write(r.read())
        print(ziel)


if __name__ == '__main__':
    main()
