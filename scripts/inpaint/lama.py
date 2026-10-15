"""Inhalte entfernen und auffüllen mit LaMa (big-lama.pt, TorchScript) – nur auf der Grafikkarte.

Aufruf mit dem Python von ComfyUI (dort liegt PyTorch mit CUDA):
    "D:/Projekte-KI/ComfyUI (1)/ComfyUI/.venv/Scripts/python.exe" scripts/inpaint/lama.py \
        --bild foto.jpg --maske maske.png --aus foto-entfernt.png

Maske: weiß = entfernen, schwarz = behalten; wird auf die Bildgröße gebracht.
Große Bilder: nur die Bereiche um die markierten Stellen werden (einzeln) bearbeitet (bei Bedarf verkleinert) und
weich wieder eingesetzt, der Rest des Bildes bleibt Pixel für Pixel unverändert.
"""
import argparse
import os
import sys

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image, ImageFilter
from scipy import ndimage

MODELL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "ComfyUI", "models", "inpaint", "big-lama.pt")
MAX_SEITE = 2048  # längste Seite für LaMa; größere Ausschnitte werden dafür verkleinert


def auf8(x):
    return (x + 7) // 8 * 8


def lama(modell, bild, maske):
    """bild: HxWx3 uint8, maske: HxW bool -> HxWx3 uint8"""
    h, w = maske.shape
    t_bild = torch.from_numpy(bild).permute(2, 0, 1)[None].float().div(255).cuda()
    t_maske = torch.from_numpy(maske.astype(np.float32))[None, None].cuda()
    ph, pw = auf8(h) - h, auf8(w) - w
    t_bild = F.pad(t_bild, (0, pw, 0, ph), mode="reflect")
    t_maske = F.pad(t_maske, (0, pw, 0, ph), mode="reflect")
    with torch.inference_mode():
        aus = modell(t_bild, t_maske)
    return aus[0, :, :h, :w].permute(1, 2, 0).clamp(0, 1).mul(255).round().byte().cpu().numpy()


def main():
    p = argparse.ArgumentParser(description="Inhalte entfernen und auffüllen (LaMa)")
    p.add_argument("--bild", required=True)
    p.add_argument("--maske", required=True)
    p.add_argument("--aus", required=True)
    p.add_argument("--modell", default=MODELL)
    a = p.parse_args()

    if not torch.cuda.is_available():
        sys.exit("Keine CUDA-Grafikkarte verfügbar – Abbruch statt Rechnen auf der CPU.")
    if not os.path.exists(a.modell):
        sys.exit(f"Modell fehlt: {os.path.abspath(a.modell)}")

    original = Image.open(a.bild)
    alpha = original.getchannel("A") if "A" in original.getbands() else None
    rgb = original.convert("RGB")
    W, H = rgb.size

    # Maske auf Bildgröße, leicht erweitern, damit Ränder des Objekts mit wegfallen
    m = Image.open(a.maske).convert("L").resize((W, H), Image.BILINEAR).point(lambda v: 255 if v > 127 else 0)
    m = m.filter(ImageFilter.MaxFilter(max(3, (min(W, H) // 300) | 1)))
    maske = np.array(m) > 0
    if not maske.any():
        sys.exit("Die Maske ist leer – nichts markiert.")

    modell = torch.jit.load(a.modell, map_location="cuda").eval()
    ergebnis = rgb.copy()

    # Jede markierte Stelle einzeln: eigener, möglichst kleiner Ausschnitt -> wenig Verkleinern, mehr Details.
    # Nah beieinander liegende Striche (Abstand < 3 % der Bildgröße) zählen als eine Stelle.
    # Gruppieren auf einer verkleinerten Kopie (max. 512 px), sonst dauert das Erweitern bei 24 MP Minuten.
    s = max(1, max(W, H) // 512)
    klein = np.array(m.resize((max(1, W // s), max(1, H // s)), Image.BOX)) > 0
    naehe = max(3, int(min(klein.shape) * 0.03))
    gruppen_k, anzahl = ndimage.label(ndimage.binary_dilation(klein, structure=np.ones((naehe, naehe))))
    gruppen = np.array(Image.fromarray(gruppen_k.astype(np.int32)).resize((W, H), Image.NEAREST))
    for nr in range(1, anzahl + 1):
        teil = maske & (gruppen == nr)
        if not teil.any():
            continue
        ys, xs = np.nonzero(teil)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        # Rand um die Stelle: Umgebung als Vorlage fürs Auffüllen
        rand = max(64, int(max(y1 - y0, x1 - x0) * 0.35))
        y0, y1 = max(0, y0 - rand), min(H, y1 + rand)
        x0, x1 = max(0, x0 - rand), min(W, x1 + rand)
        ausschnitt = ergebnis.crop((x0, y0, x1, y1))
        m_aus = Image.fromarray((teil[y0:y1, x0:x1] * 255).astype(np.uint8))
        cw, ch = ausschnitt.size
        faktor = min(1.0, MAX_SEITE / max(cw, ch))
        if faktor < 1:
            klein = (max(8, round(cw * faktor)), max(8, round(ch * faktor)))
            ausschnitt_k = ausschnitt.resize(klein, Image.LANCZOS)
            m_k = m_aus.resize(klein, Image.BILINEAR).point(lambda v: 255 if v > 64 else 0)
        else:
            ausschnitt_k, m_k = ausschnitt, m_aus
        gefuellt = Image.fromarray(lama(modell, np.array(ausschnitt_k), np.array(m_k) > 0))
        if faktor < 1:
            gefuellt = gefuellt.resize((cw, ch), Image.LANCZOS)
        # Nur die markierte Fläche (weich auslaufend) zurück ins Bild setzen
        weich = m_aus.filter(ImageFilter.GaussianBlur(max(2, min(cw, ch) // 200)))
        ergebnis.paste(Image.composite(gefuellt, ausschnitt, weich), (x0, y0))
        print(f"Stelle {nr}/{anzahl}: {cw}x{ch} px" + (f", für LaMa verkleinert auf {faktor:.0%}" if faktor < 1 else ""), file=sys.stderr)

    if alpha is not None:
        ergebnis.putalpha(alpha)
    ergebnis.save(a.aus)
    print(a.aus)


if __name__ == "__main__":
    main()
