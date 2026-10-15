// Bilder webtauglich machen: AVIF + WebP in mehreren Breiten.
// Aufruf:
//   node D:/Projekte-KI/ki-lokal/scripts/optimize-images.mjs --src D:/Projekte-KI/medien/raw/kunde --out public/img
// Optionen: --widths 640,1280,1920  --avif 50  --webp 78
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { webVarianten, STANDARD } from './bilder-web.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SRC = arg('src', 'D:/Projekte-KI/medien/raw');
const OUT = arg('out', 'public/img');
const optionen = {
  widths: arg('widths', STANDARD.widths.join(',')).split(',').map(Number),
  avif: Number(arg('avif', STANDARD.avif)),
  webp: Number(arg('webp', STANDARD.webp)),
};

const files = (await readdir(SRC)).filter(f => /\.(png|jpe?g|webp|tiff?)$/i.test(f));
if (files.length === 0) {
  console.log(`Keine Bilder in ${SRC} gefunden.`);
  process.exit(0);
}

for (const file of files) {
  const { breiten } = await webVarianten(path.join(SRC, file), OUT, optionen);
  console.log(`fertig: ${path.parse(file).name} (${breiten.join(', ')} px)`);
}
