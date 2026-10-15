// Zugriff von anderen Rechnern im Netz: Zugangsschlüssel (nur auf diesem Rechner gespeichert) und Anmeldung per Cookie.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { crc32 } from 'node:zlib';
import path from 'node:path';
import { STATUS } from './pfade.mjs';

const DATEI = path.join(STATUS, 'bildwerkstatt-schluessel.txt');
const COOKIE = 'bildwerkstatt';

// Schlüssel lesen oder beim ersten Start anlegen
export async function schluessel() {
  try { return (await readFile(DATEI, 'utf8')).trim(); } catch { /* neu anlegen */ }
  const neu = randomBytes(18).toString('base64url');
  await mkdir(STATUS, { recursive: true });
  await writeFile(DATEI, neu);
  return neu;
}

export function lokal(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function gleich(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function angemeldet(req, s) {
  const c = (req.headers.cookie || '').split(';').map(t => t.trim().split('=')).find(([k]) => k === COOKIE);
  return Boolean(c && gleich(decodeURIComponent(c[1] || ''), s));
}

export function anmeldeCookie(s) {
  return `${COOKIE}=${encodeURIComponent(s)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`;
}

export function pruefen(eingabe, s) { return gleich(String(eingabe || '').trim(), s); }

export const ANMELDESEITE = (fehler = '') => `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Bildwerkstatt – Anmelden</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.45 system-ui,"Segoe UI",sans-serif;background:#f4f5f7;color:#1d2330}
form{background:#fff;border:1px solid #dfe3ea;border-radius:12px;padding:24px;width:min(420px,calc(100vw - 32px))}
h1{font-size:18px;margin:0 0 8px}input{width:100%;box-sizing:border-box;font:inherit;padding:8px 10px;border:1px solid #dfe3ea;border-radius:8px;margin:12px 0}
button{font:inherit;background:#2f6fde;color:#fff;border:0;border-radius:8px;padding:8px 14px;cursor:pointer}.f{color:#c23a3a}
@media (prefers-color-scheme: dark){body{background:#14171c;color:#e6e9ef}form{background:#1d2128;border-color:#2e343e}input{background:#14171c;color:inherit;border-color:#2e343e}}</style></head>
<body><form method="post" action="/anmelden"><h1>Bildwerkstatt</h1>
<p>Zugangsschlüssel eingeben (Vaultwarden: „ki-lokal – Bildwerkstatt“). Der Browser merkt ihn sich danach.</p>
${fehler ? `<p class="f">${fehler}</p>` : ''}<input name="schluessel" type="password" autocomplete="current-password" autofocus required>
<button>Anmelden</button></form></body></html>`;

// Einfaches ZIP ohne Kompression (AVIF/WebP sind schon komprimiert)
export function zip(eintraege) {
  const teile = [], verzeichnis = [];
  let pos = 0;
  for (const { name, daten } of eintraege) {
    const n = Buffer.from(name, 'utf8');
    const crc = crc32(daten) >>> 0;
    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(0x04034b50, 0); kopf.writeUInt16LE(20, 4); kopf.writeUInt16LE(0x0800, 6); // UTF-8-Namen
    kopf.writeUInt32LE(crc, 14); kopf.writeUInt32LE(daten.length, 18); kopf.writeUInt32LE(daten.length, 22);
    kopf.writeUInt16LE(n.length, 26);
    const z = Buffer.alloc(46);
    z.writeUInt32LE(0x02014b50, 0); z.writeUInt16LE(20, 4); z.writeUInt16LE(20, 6); z.writeUInt16LE(0x0800, 8);
    z.writeUInt32LE(crc, 16); z.writeUInt32LE(daten.length, 20); z.writeUInt32LE(daten.length, 24);
    z.writeUInt16LE(n.length, 28); z.writeUInt32LE(pos, 42);
    teile.push(kopf, n, daten);
    verzeichnis.push(z, n);
    pos += 30 + n.length + daten.length;
  }
  const vz = Buffer.concat(verzeichnis);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0); ende.writeUInt16LE(eintraege.length, 8); ende.writeUInt16LE(eintraege.length, 10);
  ende.writeUInt32LE(vz.length, 12); ende.writeUInt32LE(pos, 16);
  return Buffer.concat([...teile, vz, ende]);
}
