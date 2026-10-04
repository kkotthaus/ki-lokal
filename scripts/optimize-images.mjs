// Bilder webtauglich machen: AVIF + WebP in mehreren Breiten.
// Aufruf:
//   node D:/Projekte-KI/ki-lokal/scripts/optimize-images.mjs --src D:/Projekte-KI/medien/raw/kunde --out public/img
// Optionen: --widths 640,1280,1920  --avif 50  --webp 78
import sharp from 'sharp';
import { readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SRC = arg('src', 'D:/Projekte-KI/medien/raw');
const OUT = arg('out', 'public/img');
const WIDTHS = arg('widths', '640,1280,1920').split(',').map(Number);
const AVIF_Q = Number(arg('avif', 50));
const WEBP_Q = Number(arg('webp', 78));

await mkdir(OUT, { recursive: true });
const files = (await readdir(SRC)).filter(f => /\.(png|jpe?g|webp|tiff?)$/i.test(f));
if (files.length === 0) {
  console.log(`Keine Bilder in ${SRC} gefunden.`);
  process.exit(0);
}

for (const file of files) {
  const name = path.parse(file).name;
  const input = sharp(path.join(SRC, file));
  const { width } = await input.metadata();
  const targets = WIDTHS.filter(w => w <= width);
  if (targets.length === 0) targets.push(width);
  for (const w of targets) {
    const img = input.clone().resize({ width: w });
    await img.clone().avif({ quality: AVIF_Q }).toFile(path.join(OUT, `${name}-${w}.avif`));
    await img.clone().webp({ quality: WEBP_Q }).toFile(path.join(OUT, `${name}-${w}.webp`));
  }
  console.log(`fertig: ${name} (${targets.join(', ')} px)`);
}
