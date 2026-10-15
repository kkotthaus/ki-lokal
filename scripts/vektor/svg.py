"""Bild in eine SVG-Grafik umwandeln (vtracer) – für flache Grafiken mit wenigen Farben, z. B. Icons.

Aufruf mit dem Python von ComfyUI (dort ist vtracer installiert):
    "D:/Projekte-KI/ComfyUI (1)/ComfyUI/.venv/Scripts/python.exe" scripts/vektor/svg.py \
        --bild icon-freigestellt.png --aus icon.svg [--farben 8]

Hintergrund: Hat das Bild keine Transparenz, fällt der helle Hintergrund weg, soweit er mit dem Rand verbunden ist
(weiße Flächen innerhalb des Motivs bleiben – anders als beim Freistellen mit BiRefNet). Das Bild wird auf das Motiv zugeschnitten,
auf wenige Farben reduziert und nachgezeichnet; die SVG skaliert über viewBox.
Reine Umwandlung von Pixeln in Pfade (Prozessor), das Bild selbst entsteht vorher auf der Grafikkarte.
"""
import argparse
import os
import re
import sys
import tempfile

import numpy as np
import vtracer
from PIL import Image, ImageFilter
from scipy import ndimage

ZIEL_SEITE = 1024  # längste Seite fürs Nachzeichnen: genug Details, nicht zu viele Pfade
SCHLUESSEL = [(255, 0, 255), (0, 255, 0), (0, 255, 255), (255, 255, 0)]  # Kandidaten für die Farbe „leer“
HELL = 225  # ab dieser Helligkeit (alle drei Kanäle) zählt ein Pixel zum Hintergrund


def hintergrund_weg(bild):
    """Helle Flächen, die mit dem Bildrand verbunden sind, transparent machen."""
    rgb = np.array(bild.convert("RGB"))
    hell = (rgb >= HELL).all(axis=2)
    flaechen, _ = ndimage.label(hell)
    rand = np.unique(np.concatenate([flaechen[0], flaechen[-1], flaechen[:, 0], flaechen[:, -1]]))
    weg = np.isin(flaechen, rand[rand > 0])
    # Den hellen Saum an der Kante (Kantenglättung des Bildes) mit wegnehmen
    weg = ndimage.binary_dilation(weg, iterations=2) & (rgb.min(axis=2) >= HELL - 40) | weg
    bild = bild.convert("RGBA")
    bild.putalpha(Image.fromarray(np.where(weg, 0, 255).astype(np.uint8)))
    return bild


def farben(rgb, anzahl, abstand=60):
    """Bild auf wenige Farben bringen: k-Means (Start: Median-Cut), danach fast gleiche Farben zusammenlegen.
    Liefert (Farbnummer je Pixel, Palette). Pillows Octree setzt die Mitte dunkler Gruppen teils auf Schwarz."""
    px = rgb.reshape(-1, 3).astype(np.float32)
    start = Image.fromarray(rgb).quantize(colors=anzahl, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal = np.array(start.getpalette()[: 3 * anzahl], dtype=np.float32).reshape(-1, 3)
    probe = px[np.random.default_rng(0).choice(len(px), min(len(px), 60000), replace=False)]
    for _ in range(15):
        nr = ((probe[:, None] - pal[None]) ** 2).sum(2).argmin(1)
        pal = np.array([probe[nr == k].mean(0) if (nr == k).any() else pal[k] for k in range(len(pal))])
    # Fast gleiche Farben zusammenlegen (gewichtetes Mittel)
    nr = ((probe[:, None] - pal[None]) ** 2).sum(2).argmin(1)
    gewicht = np.bincount(nr, minlength=len(pal)).astype(float)
    gruppen = [[k] for k in range(len(pal)) if gewicht[k] > 0]
    while True:
        mitte = [np.average(pal[g], axis=0, weights=gewicht[g]) for g in gruppen]
        paar = min(((np.linalg.norm(mitte[i] - mitte[j]), i, j) for i in range(len(gruppen)) for j in range(i)), default=None)
        if not paar or paar[0] >= abstand:
            break
        gruppen[paar[2]] += gruppen.pop(paar[1])
    pal = np.array(mitte)
    nummern = np.empty(len(px), dtype=np.uint8)
    for i in range(0, len(px), 262144):  # in Stücken, sonst braucht die Abstandstabelle zu viel Speicher
        nummern[i:i + 262144] = ((px[i:i + 262144, None] - pal[None]) ** 2).sum(2).argmin(1)
    return nummern.reshape(rgb.shape[:2]), pal


def main():
    p = argparse.ArgumentParser(description="Bild in SVG umwandeln")
    p.add_argument("--bild", required=True)
    p.add_argument("--aus", required=True)
    p.add_argument("--farben", type=int, default=6, help="höchstens so viele Farben (ohne Transparenz)")
    a = p.parse_args()

    bild = Image.open(a.bild).convert("RGBA")
    if bild.getchannel("A").getextrema()[0] == 255:
        bild = hintergrund_weg(bild)
    # Auf das Motiv zuschneiden, etwas Rand lassen
    alpha = bild.getchannel("A").point(lambda v: 255 if v >= 128 else 0)
    box = alpha.getbbox()
    if not box:
        sys.exit("Das Bild ist ganz transparent – nichts zum Nachzeichnen.")
    rand = max(4, int(max(box[2] - box[0], box[3] - box[1]) * 0.02))
    box = (max(0, box[0] - rand), max(0, box[1] - rand), min(bild.width, box[2] + rand), min(bild.height, box[3] + rand))
    bild, alpha = bild.crop(box), alpha.crop(box)
    # Auf feste Größe bringen (auch hoch): mehr Pixel ergeben glattere Kurven, die Pfadzahl hängt am Motiv
    faktor = ZIEL_SEITE / max(bild.size)
    if faktor != 1:
        groesse = (round(bild.width * faktor), round(bild.height * faktor))
        bild, alpha = bild.resize(groesse, Image.LANCZOS), alpha.resize(groesse, Image.NEAREST)
    # Außenkante glätten (sonst Pixeltreppen im Umriss)
    alpha = alpha.filter(ImageFilter.GaussianBlur(2)).point(lambda v: 255 if v >= 128 else 0)

    # Wenige, klare Farben ergeben saubere Flächen statt vieler Farbstufen,
    # danach Flächenränder glätten, sonst zeichnet vtracer jede Pixeltreppe nach
    # (geglättet auf den Farbnummern – auf RGB arbeitet der Filter je Kanal und mischt neue Farben)
    nummern, pal = farben(np.array(bild.convert("RGB")), a.farben)
    nummern = np.array(Image.fromarray(nummern.astype(np.uint8)).filter(ImageFilter.ModeFilter(7)))
    # Transparenz als eigene, im Bild nicht vorkommende Farbe; deren Pfade fallen danach weg
    # (vtracers eigene Behandlung transparenter Pixel verfälscht dunkle Flächen)
    leer = max(SCHLUESSEL, key=lambda k: np.linalg.norm(pal - k, axis=1).min())
    rgb = pal[nummern].astype(np.uint8)
    rgb[np.array(alpha) == 0] = leer
    fertig = Image.fromarray(rgb)

    with tempfile.TemporaryDirectory() as tmp:
        ein, aus = os.path.join(tmp, "ein.png"), os.path.join(tmp, "aus.svg")
        fertig.save(ein)
        vtracer.convert_image_to_svg_py(
            ein, aus, colormode="color", hierarchical="cutout", mode="spline",
            filter_speckle=12, color_precision=8, layer_difference=8,
            corner_threshold=60, length_threshold=4.0, max_iterations=10, splice_threshold=45, path_precision=1,
        )
        svg = open(aus, encoding="utf-8").read()

    # Pfade in der Farbe „leer“ entfernen (vtracer mittelt Farben, daher mit etwas Spielraum)
    def leer_pfad(m):
        f = re.search(r'fill="#([0-9A-Fa-f]{6})"', m.group(0))
        return "" if f and np.linalg.norm(np.array(list(bytes.fromhex(f.group(1)))) - np.array(leer)) < 24 else m.group(0)
    svg = re.sub(r'<path[^>]*/>\s*', leer_pfad, svg)
    # Feste Größe durch viewBox ersetzen, damit die Grafik frei skaliert
    w, h = fertig.size
    svg = re.sub(r'<svg[^>]*>', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">', svg, count=1)
    svg = re.sub(r'<\?xml[^>]*>\s*|<!--.*?-->\s*', '', svg, flags=re.S)
    with open(a.aus, "w", encoding="utf-8") as f:
        f.write(svg)
    print(f"{a.aus}: {svg.count('<path')} Pfade, {len(svg) // 1024} KB", file=sys.stderr)
    print(a.aus)


if __name__ == "__main__":
    main()
