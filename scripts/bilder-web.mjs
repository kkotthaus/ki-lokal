// Ein Bild webtauglich machen: AVIF + WebP in mehreren Breiten.
// Gemeinsam genutzt von optimize-images.mjs und der Bildwerkstatt (app/).
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export const STANDARD = { widths: [640, 1280, 1920], avif: 50, webp: 78 };

// Gibt die geschriebenen Dateien zurück.
export async function webVarianten(datei, ziel, { widths = STANDARD.widths, avif = STANDARD.avif, webp = STANDARD.webp } = {}) {
  await mkdir(ziel, { recursive: true });
  const name = path.parse(datei).name;
  const input = sharp(datei);
  const { width } = await input.metadata();
  const breiten = widths.filter(w => w <= width);
  if (breiten.length === 0) breiten.push(width);
  const dateien = [];
  for (const w of breiten) {
    const img = input.clone().resize({ width: w });
    const a = path.join(ziel, `${name}-${w}.avif`);
    const b = path.join(ziel, `${name}-${w}.webp`);
    await img.clone().avif({ quality: avif }).toFile(a);
    await img.clone().webp({ quality: webp }).toFile(b);
    dateien.push(a, b);
  }
  return { breiten, dateien };
}
