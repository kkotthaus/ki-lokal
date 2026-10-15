// Bildwerkstatt: Bild ablegen, auswählen was passieren soll, alles mit der lokalen KI.
// Start: app\start.ps1 (öffnet http://127.0.0.1:8190 im Browser)
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile, rename, unlink, stat, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import sharp from 'sharp';
import { MEDIEN, PROJEKTE, STATUS, EINSTELLUNGEN, KI_LOKAL } from './lib/pfade.mjs';
import * as comfy from './lib/comfy.mjs';
import * as sprachmodell from './lib/sprachmodell.mjs';
import { webVarianten } from '../scripts/bilder-web.mjs';

const PORT = 8190;
const OEFFENTLICH = path.join(KI_LOKAL, 'app', 'oeffentlich');
const FORMATE = { hero: [16, 9], teaser: [3, 2], quadrat: [1, 1], hoch: [2, 3] };

// ---------- Einstellungen (gemerkt in %LOCALAPPDATA%\ki-lokal\bildwerkstatt.json) ----------
const STANDARD = { modus: 'projekt', projekt: '', ablage: '', ablagen: [], modell: 'qwen/qwen3.5-9b' };
let einstellungen = { ...STANDARD };
try { einstellungen = { ...STANDARD, ...JSON.parse(await readFile(EINSTELLUNGEN, 'utf8')) }; } catch { /* erster Start */ }
async function speichern() {
  await mkdir(STATUS, { recursive: true });
  await writeFile(EINSTELLUNGEN, JSON.stringify(einstellungen, null, 2));
}

async function projekte() {
  try {
    const d = JSON.parse(await readFile(path.join(PROJEKTE, 'windows-dev', 'projekte.json'), 'utf8'));
    return d.projekte.map(p => ({ kurz: p.kurz, name: p.name, gruppe: p.gruppe || '' }));
  } catch { return []; }
}

function zielordner() {
  if (einstellungen.modus === 'ablage') {
    if (!einstellungen.ablage) throw new Error('Keine Ablage gewählt.');
    return einstellungen.ablage;
  }
  if (!einstellungen.projekt) throw new Error('Kein Projekt gewählt.');
  return path.join(MEDIEN, 'raw', einstellungen.projekt);
}

// Nur Dateien unter medien\ oder einer gemerkten Ablage lesen oder ändern
function erlaubt(datei) {
  const p = path.resolve(datei).toLowerCase();
  return [MEDIEN, ...einstellungen.ablagen].some(w => p.startsWith(path.resolve(w).toLowerCase() + path.sep));
}

// Von der Bildwerkstatt angelegte Dateien: nur diese dürfen umbenannt oder verworfen werden
const angelegt = new Set();

async function existiert(p) { try { await access(p); return true; } catch { return false; } }
async function freierName(ordner, basis, endung) {
  let p = path.join(ordner, `${basis}${endung}`);
  for (let n = 2; await existiert(p); n++) p = path.join(ordner, `${basis}-${n}${endung}`);
  return p;
}
const md5 = buf => createHash('md5').update(buf).digest('hex');

// ---------- Grafikspeicher: immer nur ein Modell auf der Karte ----------
async function fuerComfy() { await sprachmodell.entladen(); }
async function fuerSprachmodell() { await comfy.freigeben(); await sprachmodell.bereit(einstellungen.modell); }

// ---------- Arbeitsschritte ----------
async function schritt(datei, s) {
  const ordner = path.dirname(datei);
  const basis = path.parse(datei).name;
  const meta = await sharp(datei).metadata();

  switch (s.schritt) {
    case 'freistellen': {
      await fuerComfy();
      const ziel = await freierName(ordner, `${basis}-freigestellt`, '.png');
      await comfy.ausfuehren('rmbg_api.json', datei, ziel);
      return { datei: ziel, info: 'Hintergrund entfernt' };
    }
    case 'vergroessern': {
      const faktor = s.faktor === 4 ? 4 : 2;
      const lang = Math.max(meta.width, meta.height) * faktor;
      if (lang > 8192) throw new Error(`Das Bild ist schon ${meta.width}×${meta.height} px; ×${faktor} ergäbe ${lang} px an der langen Seite (Grenze 8192). Vergrößern lohnt nur bei kleinen Bildern.`);
      await fuerComfy();
      const ziel = await freierName(ordner, `${basis}-x${faktor}`, '.png');
      await comfy.ausfuehren('upscale_api.json', datei, ziel, w => { w['4'].inputs.scale_by = faktor / 4; });
      if (meta.hasAlpha) {
        // Real-ESRGAN kennt keinen Alphakanal: Alpha des Originals hochskaliert wieder einsetzen
        const groesse = await sharp(ziel).metadata();
        const alpha = await sharp(datei).extractChannel('alpha').resize(groesse.width, groesse.height).toBuffer();
        const rgb = await sharp(ziel).removeAlpha().toBuffer();
        await sharp(rgb).joinChannel(alpha).png().toFile(ziel + '.tmp');
        await rename(ziel + '.tmp', ziel);
      }
      return { datei: ziel, info: `vergrößert ×${faktor} (Real-ESRGAN)` };
    }
    case 'zuschneiden': {
      const [rw, rh] = FORMATE[s.format] || FORMATE.hero;
      const r = rw / rh;
      const png = meta.hasAlpha || meta.format === 'png';
      const ziel = await freierName(ordner, `${basis}-${s.format || 'hero'}`, png ? '.png' : '.jpg');
      if (meta.hasAlpha) {
        // Freigestellt: Motiv ganz behalten, auf leeren Rand beschneiden und transparent aufs Format auffüllen
        const { data, info } = await sharp(datei).trim().toBuffer({ resolveWithObject: true });
        let w = info.width, h = info.height;
        if (w / h > r) h = Math.round(w / r); else w = Math.round(h * r);
        await sharp(data).resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(ziel);
        return { datei: ziel, info: `auf ${rw}:${rh} gebracht, Motiv vollständig (${w}×${h} px)` };
      }
      let w = meta.width, h = meta.height;
      if (w / h > r) w = Math.round(h * r); else h = Math.round(w / r);
      const bild = sharp(datei).resize(w, h, { fit: 'cover', position: sharp.strategy.attention });
      await (png ? bild.png() : bild.jpeg({ quality: 92 })).toFile(ziel);
      return { datei: ziel, info: `zugeschnitten ${rw}:${rh} (${w}×${h} px)` };
    }
    case 'aufhellen':
    case 'schwarzweiss': {
      const png = meta.hasAlpha || meta.format === 'png';
      const stark = s.faktor === 2;
      const zusatz = s.schritt === 'schwarzweiss' ? 'sw' : stark ? 'heller-stark' : 'heller';
      const ziel = await freierName(ordner, `${basis}-${zusatz}`, png ? '.png' : '.jpg');
      let bild = sharp(datei);
      // Aufhellen über Gamma: hebt Mitteltöne an, Lichter brennen nicht aus
      // (2.2 → 2.6 ≈ +12 % mittlere Helligkeit, 2.2 → 3.0 ≈ +24 %; gemessen an einem Foto)
      bild = s.schritt === 'schwarzweiss' ? bild.grayscale() : bild.gamma(2.2, stark ? 3.0 : 2.6);
      await (png ? bild.png() : bild.jpeg({ quality: 92 })).toFile(ziel);
      return { datei: ziel, info: s.schritt === 'schwarzweiss' ? 'in Schwarzweiß umgewandelt' : `aufgehellt (${stark ? 'stark' : 'leicht'})` };
    }
    case 'web': {
      const webOrdner = path.join(ordner, 'web');
      const { dateien, breiten } = await webVarianten(datei, webOrdner);
      dateien.forEach(d => angelegt.add(d));
      return { datei, info: `Web: AVIF + WebP in ${breiten.join(', ')} px`, dateien };
    }
    case 'alttext': {
      await fuerSprachmodell();
      const kontext = einstellungen.modus === 'projekt' ? `Website-Projekt ${einstellungen.projekt}` : '';
      const a = await sprachmodell.alttext(datei, kontext);
      return { datei, info: 'Alt-Text vorgeschlagen', alt: a.alt, dateiname: a.dateiname };
    }
    default:
      throw new Error(`Unbekannter Schritt: ${s.schritt}`);
  }
}

// Ein Auftrag nach dem anderen (die Grafikkarte kann nur eins)
let kette = Promise.resolve();
const nacheinander = fn => (kette = kette.then(fn, fn));

// Ordnerdialog von Windows (pwsh 7: moderner Dialog). Der Prozess startet verborgen; Windows wendet
// „verborgen“ auf das erste Fenster an. Deshalb zuerst ein unsichtbares Hilfsfenster zeigen, das
// diese Vorgabe verbraucht, dann den Dialog im Vordergrund darüber öffnen.
// Das Hilfsfenster sitzt mittig auf dem Bildschirm des Vordergrundfensters (der Browser, in dem
// gerade geklickt wurde), damit der Dialog dort erscheint und nicht auf dem Hauptbildschirm.
function ordnerWaehlen(start) {
  const ps = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms;
Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();'
$b = [System.Windows.Forms.Screen]::FromHandle([W.U]::GetForegroundWindow()).WorkingArea
$f = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Opacity = 0;
  FormBorderStyle = 'None'; StartPosition = 'Manual'; Width = 1; Height = 1;
  Location = New-Object System.Drawing.Point(
    [Math]::Max($b.X, $b.X + [int]($b.Width / 2) - 600), [Math]::Max($b.Y, $b.Y + [int]($b.Height / 2) - 360)) }  # Dialog ca. 1200×720
$f.Show(); $f.Activate()
$d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Ablage für die Bildwerkstatt wählen'
$d.UseDescriptionForTitle = $true; if ($env:START) { $d.SelectedPath = $env:START }
if ($d.ShowDialog($f) -eq 'OK') { $d.SelectedPath }; $f.Close()`;
  return new Promise(ok => execFile('pwsh', ['-STA', '-NoProfile', '-Command', ps],
    { env: { ...process.env, START: start || '' }, windowsHide: true, timeout: 10 * 60 * 1000 },
    (_, aus) => ok((aus || '').trim())));
}

// ---------- HTTP ----------
async function koerper(req) {
  const teile = [];
  for await (const t of req) teile.push(t);
  return Buffer.concat(teile);
}
function json(res, code, daten) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(daten));
}

const routen = {
  'GET /api/status': async () => ({ einstellungen, projekte: await projekte(), ziel: (() => { try { return zielordner(); } catch { return ''; } })() }),

  'POST /api/einstellungen': async (_, b) => {
    const e = JSON.parse(b);
    if (e.modus) einstellungen.modus = e.modus === 'ablage' ? 'ablage' : 'projekt';
    if (e.projekt !== undefined) einstellungen.projekt = e.projekt;
    if (e.ablage) {
      const p = path.resolve(e.ablage);
      if (!(await stat(p).catch(() => null))?.isDirectory()) throw new Error(`Ordner nicht gefunden: ${p}`);
      einstellungen.ablage = p;
      einstellungen.ablagen = [p, ...einstellungen.ablagen.filter(a => a.toLowerCase() !== p.toLowerCase())].slice(0, 8);
    }
    await speichern();
    return { einstellungen, ziel: zielordner() };
  },

  'POST /api/ordner-waehlen': async () => ({ ordner: await ordnerWaehlen(einstellungen.ablage) }),

  // Original in den Zielordner kopieren (nie verändern); gleiche Datei wird wiederverwendet
  'POST /api/ablegen': async (req, b) => {
    const name = path.basename(decodeURIComponent(req.headers['x-dateiname'] || 'bild.png'));
    const ordner = zielordner();
    await mkdir(ordner, { recursive: true });
    const vorhanden = path.join(ordner, name);
    if (await existiert(vorhanden) && md5(await readFile(vorhanden)) === md5(b)) return { datei: vorhanden, neu: false };
    const { name: basis, ext } = path.parse(name);
    const ziel = await freierName(ordner, basis, ext.toLowerCase());
    await writeFile(ziel, b);
    angelegt.add(ziel);
    return { datei: ziel, neu: true };
  },

  'POST /api/plan': (_, b) => nacheinander(async () => {
    await fuerSprachmodell();
    return sprachmodell.plan(JSON.parse(b).text);
  }),

  'POST /api/schritt': (_, b) => nacheinander(async () => {
    const { datei, ...s } = JSON.parse(b);
    if (!erlaubt(datei)) throw new Error('Datei liegt nicht im Zielordner.');
    const start = Date.now();
    const erg = await schritt(datei, s);
    if (erg.datei !== datei) angelegt.add(erg.datei);
    return { ...erg, sekunden: Math.round((Date.now() - start) / 100) / 10 };
  }),

  'POST /api/umbenennen': async (_, b) => {
    const { datei, name } = JSON.parse(b);
    if (!angelegt.has(datei)) throw new Error('Nur Dateien aus der Bildwerkstatt werden umbenannt.');
    const ziel = await freierName(path.dirname(datei), name.replace(/[^a-z0-9-]/gi, ''), path.extname(datei));
    await rename(datei, ziel);
    angelegt.delete(datei); angelegt.add(ziel);
    return { datei: ziel };
  },

  'POST /api/verwerfen': async (_, b) => {
    const { datei } = JSON.parse(b);
    if (!angelegt.has(datei)) throw new Error('Nur Dateien aus der Bildwerkstatt werden verworfen.');
    await unlink(datei);
    angelegt.delete(datei);
    return { ok: true };
  },

  'POST /api/beenden': async () => {
    await sprachmodell.entladen();
    await comfy.stoppen();
    setTimeout(() => process.exit(0), 200);
    return { ok: true };
  },
};

const TYPEN = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    // Vorschaubild, verkleinert
    if (req.method === 'GET' && url.pathname === '/api/bild') {
      const datei = url.searchParams.get('pfad');
      if (!erlaubt(datei)) return json(res, 403, { fehler: 'nicht erlaubt' });
      const buf = await sharp(datei).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
      const m = await sharp(datei).metadata();
      res.writeHead(200, { 'Content-Type': 'image/webp', 'X-Groesse': `${m.width}x${m.height}`, 'Cache-Control': 'no-store' });
      return res.end(buf);
    }
    const route = routen[`${req.method} ${url.pathname}`];
    if (route) return json(res, 200, await route(req, req.method === 'POST' ? await koerper(req) : null));
    if (req.method === 'GET') {
      const datei = path.join(OEFFENTLICH, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
      if (!datei.startsWith(OEFFENTLICH)) return json(res, 403, { fehler: 'nicht erlaubt' });
      const inhalt = await readFile(datei).catch(() => null);
      if (inhalt) { res.writeHead(200, { 'Content-Type': TYPEN[path.extname(datei)] || 'application/octet-stream' }); return res.end(inhalt); }
    }
    json(res, 404, { fehler: 'nicht gefunden' });
  } catch (e) {
    json(res, 500, { fehler: e.message });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Bildwerkstatt: http://127.0.0.1:${PORT}`));
