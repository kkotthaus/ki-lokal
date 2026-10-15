// Bildwerkstatt: Bild ablegen, auswählen was passieren soll, alles mit der lokalen KI.
// Start: app\start.ps1 (öffnet http://127.0.0.1:8190 im Browser)
// Mit "netzwerk": true in den Einstellungen auch von anderen Rechnern im Netz erreichbar (mit Zugangsschlüssel).
import http from 'node:http';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile, rename, unlink, stat, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import sharp from 'sharp';
import { MEDIEN, PROJEKTE, STATUS, EINSTELLUNGEN, KI_LOKAL, COMFY_PYTHON } from './lib/pfade.mjs';
import * as comfy from './lib/comfy.mjs';
import * as sprachmodell from './lib/sprachmodell.mjs';
import { webVarianten } from '../scripts/bilder-web.mjs';
import * as zugang from './lib/zugang.mjs';
import * as farben from './lib/farben.mjs';

const PORT = 8190;
const OEFFENTLICH = path.join(KI_LOKAL, 'app', 'oeffentlich');
const FORMATE = { hero: [16, 9], teaser: [3, 2], quadrat: [1, 1], hoch: [2, 3] };
// Bildgrößen für FLUX je Format (Vielfache von 64, um 1 Megapixel)
const FLUX = { hero: [1344, 768], teaser: [1216, 832], quadrat: [1024, 1024], hoch: [832, 1216] };

// ---------- Einstellungen (gemerkt in %LOCALAPPDATA%\ki-lokal\bildwerkstatt.json) ----------
const STANDARD = { modus: 'projekt', projekt: '', ablage: '', ablagen: [], modell: 'qwen/qwen3.5-9b', netzwerk: false, rechner: [] };
// netzwerk: auch im Netz erreichbar; rechner: IP-Adressen, die zugreifen dürfen (leer = keiner von außen)
let einstellungen = { ...STANDARD };
try { einstellungen = { ...STANDARD, ...JSON.parse(await readFile(EINSTELLUNGEN, 'utf8')) }; } catch { /* erster Start */ }
async function speichern() {
  await mkdir(STATUS, { recursive: true });
  await writeFile(EINSTELLUNGEN, JSON.stringify(einstellungen, null, 2));
}

async function projekte() {
  try {
    const d = JSON.parse(await readFile(path.join(PROJEKTE, 'windows-dev', 'projekte.json'), 'utf8'));
    // seiten: Adressen für Farben und Logo in dieser Reihenfolge – lokal, Staging, Live
    const seiten = p => ['Lokal', 'Staging', 'Live'].map(u => (p.seiten || []).find(s => s.umgebung === u)?.adresse).filter(Boolean);
    return d.projekte.map(p => ({ kurz: p.kurz, name: p.name, gruppe: p.gruppe || '', seite: seiten(p)[0] || '', seiten: seiten(p) }));
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

function python(skript, args) {
  return new Promise((ok, fehler) => execFile(COMFY_PYTHON, [path.join(KI_LOKAL, 'scripts', ...skript), ...args],
    { windowsHide: true, timeout: 5 * 60 * 1000 },
    (err, aus, feh) => (err ? fehler(new Error((feh || err.message).trim().split('\n').pop())) : ok(aus))));
}

// ---------- Neu erstellen: Text → Bild (FLUX), bei SVG weiter nachzeichnen ----------
async function erstellen({ text, art = 'auto', format = 'auto', farben: vorgabe = [] }) {
  if (!String(text || '').trim()) throw new Error('Bitte beschreiben, was entstehen soll.');
  const ordner = zielordner();
  await mkdir(ordner, { recursive: true });
  await fuerSprachmodell();
  // Farbvorgabe nur als saubere Hexwerte annehmen (gehen in Prompt und Kommandozeile)
  vorgabe = (Array.isArray(vorgabe) ? vorgabe : []).filter(f => /^#[0-9a-f]{6}$/i.test(f?.hex)).slice(0, 8);
  const e = await sprachmodell.entwurf(text, art, format, vorgabe);
  await fuerComfy();
  const [w, h] = FLUX[e.format];
  const bild = await freierName(ordner, e.dateiname, '.png');
  await comfy.erzeugen(e.prompt, w, h, bild);
  const ergebnisse = [{ datei: bild, titel: 'Erstellt' }];
  if (e.art === 'svg') {
    // Weißer Hintergrund fällt beim Nachzeichnen weg (vom Rand aus, weiße Flächen im Motiv bleiben)
    const svg = await freierName(ordner, path.parse(bild).name, '.svg');
    const palette = vorgabe.length ? ['--palette', vorgabe.map(f => f.hex).join(',')] : [];
    await python(['vektor', 'svg.py'], ['--bild', bild, '--aus', svg, ...palette]);
    ergebnisse.push({ datei: svg, titel: 'SVG' });
  }
  ergebnisse.forEach(r => angelegt.add(r.datei));
  return { ergebnisse, art: e.art, format: e.format, prompt: e.prompt };
}

// ---------- Logo einsetzen ----------
// Position als Anteil [x, y] (0 = links/oben, 1 = rechts/unten)
const LOGO_POS = { ol: [0, 0], or: [1, 0], ul: [0, 1], ur: [1, 1], mitte: [0.5, 0.5] };
const LOGO_NAMEN = { ol: 'oben links', or: 'oben rechts', ul: 'unten links', ur: 'unten rechts', mitte: 'Mitte' };
const FLAECHEN = { hell: 'rgba(255,255,255,0.88)', dunkel: 'rgba(20,23,28,0.78)' };
const logoAnteil = s => Math.min(0.6, Math.max(0.05, Number(s.groesse) || 0.2));  // Logobreite als Anteil der Bildbreite
function logoLage(W, H, ew, eh, s) {
  const [fx, fy] = LOGO_POS[s.position] || LOGO_POS.ur;
  const rand = Math.min(W, H) * 0.04;
  return [rand + fx * (W - ew - 2 * rand), rand + fy * (H - eh - 2 * rand)];
}

async function logoInBild(datei, ziel, s, meta) {
  const W = meta.width, H = meta.height;
  const lw = Math.round(W * logoAnteil(s));
  // SVG-Logos scharf rendern: Dichte so wählen, dass das Logo mindestens in Zielbreite vorliegt
  const lmeta = await sharp(s.logo).metadata();
  const dichte = lmeta.format === 'svg' ? Math.min(2400, Math.max(72, 72 * lw / (lmeta.width || 100) * 1.5)) : 0;
  let logo = await sharp(s.logo, dichte ? { density: dichte } : {})
    .resize({ width: lw, height: Math.round(H * 0.4), fit: 'inside' }).png().toBuffer();
  let { width: ew, height: eh } = await sharp(logo).metadata();
  if (FLAECHEN[s.flaeche]) {
    // Fläche hinter dem Logo, damit es auf unruhigen Fotos lesbar bleibt
    const pad = Math.round(Math.min(ew, eh) * 0.3 + 6);
    const flaeche = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${ew + 2 * pad}" height="${eh + 2 * pad}"><rect width="100%" height="100%" rx="${pad}" fill="${FLAECHEN[s.flaeche]}"/></svg>`);
    logo = await sharp(flaeche).composite([{ input: logo, left: pad, top: pad }]).png().toBuffer();
    ew += 2 * pad; eh += 2 * pad;
  }
  const [x, y] = logoLage(W, H, ew, eh, s).map(Math.round);
  const bild = sharp(datei).composite([{ input: logo, left: x, top: y }]);
  await (path.extname(ziel) === '.jpg' ? bild.jpeg({ quality: 92 }) : bild.png()).toFile(ziel);
}

// SVG in SVG: Vektor-Logo als verschachteltes <svg>, Bild-Logo als eingebettetes <image>
async function logoInSvg(datei, ziel, s) {
  const basis = await readFile(datei, 'utf8');
  const vb = (basis.match(/viewBox="([^"]+)"/) || [])[1]?.trim().split(/[\s,]+/).map(Number);
  if (!vb || vb.length !== 4) throw new Error('Die SVG hat keine viewBox.');
  const [, , W, H] = vb;
  const lw = W * logoAnteil(s);
  let lvb, logoTeil;  // logoTeil(x, y, w, h) liefert das Element
  if (path.extname(s.logo).toLowerCase() === '.svg') {
    const logo = (await readFile(s.logo, 'utf8')).replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->/gi, '');
    const kopf = logo.match(/<svg\b[^>]*>/i)?.[0];
    if (!kopf) throw new Error('Das Logo ist keine gültige SVG.');
    const mass = n => parseFloat((kopf.match(new RegExp(`\\s${n}="([\\d.]+)`)) || [])[1]);
    lvb = (kopf.match(/viewBox="([^"]+)"/i) || [])[1]?.trim().split(/[\s,]+/).map(Number) || [0, 0, mass('width') || 100, mass('height') || 100];
    const innen = logo.slice(logo.indexOf(kopf) + kopf.length, logo.lastIndexOf('</svg>'));
    logoTeil = (x, y, w, h) => `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${lvb.join(' ')}" preserveAspectRatio="xMidYMid meet">${innen}</svg>`;
  } else {
    const m = await sharp(s.logo).metadata();
    lvb = [0, 0, m.width, m.height];
    const png = await sharp(s.logo).resize({ width: Math.min(m.width, 1200), withoutEnlargement: true }).png().toBuffer();
    logoTeil = (x, y, w, h) => `<image x="${x}" y="${y}" width="${w}" height="${h}" href="data:image/png;base64,${png.toString('base64')}"/>`;
  }
  const lh = Math.min(lw * lvb[3] / lvb[2], H * 0.4);
  const lwEcht = lh * lvb[2] / lvb[3];
  const pad = FLAECHEN[s.flaeche] ? Math.min(lwEcht, lh) * 0.3 + 6 : 0;
  const ew = lwEcht + 2 * pad, eh = lh + 2 * pad;
  const r = n => Math.round(n * 100) / 100;
  const [x, y] = logoLage(W, H, ew, eh, s).map((v, i) => v + vb[i]);
  const flaeche = pad ? `<rect x="${r(x)}" y="${r(y)}" width="${r(ew)}" height="${r(eh)}" rx="${r(pad)}" fill="${FLAECHEN[s.flaeche]}"/>` : '';
  const block = `<g class="logo">${flaeche}${logoTeil(r(x + pad), r(y + pad), r(lwEcht), r(lh))}</g>`;
  await writeFile(ziel, basis.slice(0, basis.lastIndexOf('</svg>')) + block + '</svg>\n');
}

// Logo speichern: im Zielordner unter logos\ (gleiche Datei wird wiederverwendet)
async function logoSpeichern(name, daten) {
  const ordner = path.join(zielordner(), 'logos');
  await mkdir(ordner, { recursive: true });
  const { name: roh, ext } = path.parse(path.basename(name));
  const basis = roh.replace(/[^\w.-]+/g, '-') || 'logo';
  const vorhanden = path.join(ordner, basis + ext.toLowerCase());
  if (await existiert(vorhanden) && md5(await readFile(vorhanden)) === md5(daten)) return vorhanden;
  const ziel = await freierName(ordner, basis, ext.toLowerCase());
  await writeFile(ziel, daten);
  angelegt.add(ziel);
  return ziel;
}

// ---------- Arbeitsschritte ----------
async function schritt(datei, s) {
  const ordner = path.dirname(datei);
  const basis = path.parse(datei).name;
  if (path.extname(datei).toLowerCase() === '.svg' && !['alttext', 'logo'].includes(s.schritt))
    throw new Error('Eine SVG kann hier nur Alt-Text und Logo bekommen. Zum Bearbeiten das PNG im Verlauf wählen.');
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
    case 'entfernen': {
      // Maske kommt als PNG (weiß = entfernen) in Größe der Vorschau, das Skript skaliert sie aufs Bild
      if (!s.maske?.startsWith('data:image/png;base64,')) throw new Error('Erst im Bild markieren, was weg soll.');
      const maske = path.join(STATUS, `maske-${Date.now()}.png`);
      await mkdir(STATUS, { recursive: true });
      await writeFile(maske, Buffer.from(s.maske.split(',')[1], 'base64'));
      const ziel = await freierName(ordner, `${basis}-entfernt`, meta.hasAlpha || meta.format === 'png' ? '.png' : '.jpg');
      const roh = ziel.replace(/\.jpg$/, '.tmp.png');
      try {
        await fuerComfy();
        await python(['inpaint', 'lama.py'], ['--bild', datei, '--maske', maske, '--aus', roh]);
        if (roh !== ziel) { await sharp(roh).jpeg({ quality: 92 }).toFile(ziel); await unlink(roh); }
      } finally { await unlink(maske).catch(() => {}); }
      return { datei: ziel, info: 'Markiertes entfernt und aufgefüllt (LaMa)' };
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
    case 'logo': {
      if (!s.logo || !erlaubt(s.logo)) throw new Error('Erst ein Logo wählen (Datei oder von der Website).');
      const svg = path.extname(datei).toLowerCase() === '.svg';
      const ext = svg ? '.svg' : meta.hasAlpha || meta.format === 'png' ? '.png' : '.jpg';
      const ziel = await freierName(ordner, `${basis}-logo`, ext);
      await (svg ? logoInSvg : logoInBild)(datei, ziel, s, meta);
      return { datei: ziel, info: `Logo eingesetzt (${LOGO_NAMEN[s.position] || LOGO_NAMEN.ur}, ${Math.round(logoAnteil(s) * 100)} % breit)` };
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
  'GET /api/status': async (req) => ({
    einstellungen, projekte: await projekte(), ziel: (() => { try { return zielordner(); } catch { return ''; } })(),
    fern: !zugang.lokal(req),
    // Nur am Rechner selbst: Adresse und Schlüssel für den Zugriff vom anderen Arbeitsplatz
    netzwerk: einstellungen.netzwerk && zugang.lokal(req) ? { adresse: `http://${eigeneAdresse()}:${PORT}`, schluessel: SCHLUESSEL } : null,
  }),

  'POST /api/einstellungen': async (req, b) => {
    const e = JSON.parse(b);
    // Von außen nur eine der gemerkten Ablagen wählen, keine neuen Ordner dieses Rechners freigeben
    if (e.ablage && !zugang.lokal(req) && !einstellungen.ablagen.some(a => a.toLowerCase() === path.resolve(e.ablage).toLowerCase())) throw new Error('Neue Ablagen nur am Rechner selbst wählen.');
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

  'POST /api/ordner-waehlen': async (req) => {
    if (!zugang.lokal(req)) throw new Error('Der Ordnerdialog öffnet sich nur am Rechner selbst.');
    return { ordner: await ordnerWaehlen(einstellungen.ablage) };
  },

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

  // Logos einer Website: Kandidaten mit kleiner Vorschau (vom anderen Arbeitsplatz ist die Seite evtl. nicht erreichbar)
  'POST /api/logos': async (_, b) => {
    const r = await farben.logosVonWebsite(String(JSON.parse(b).url || '').trim());
    const logos = await Promise.all(r.logos.map(async l => {
      try {
        const { daten } = await farben.logoHolen(l.url);
        const png = await sharp(daten, { density: 150 }).resize({ width: 200, height: 90, fit: 'inside' }).png().toBuffer();
        return { ...l, vorschau: `data:image/png;base64,${png.toString('base64')}` };
      } catch { return null; }
    }));
    return { url: r.url, logos: logos.filter(Boolean) };
  },
  'POST /api/logo-holen': async (_, b) => {
    const { daten, endung, name } = await farben.logoHolen(String(JSON.parse(b).url || ''));
    return { datei: await logoSpeichern(name + endung, daten) };
  },
  'POST /api/logo-ablegen': async (req, b) => {
    const name = decodeURIComponent(req.headers['x-dateiname'] || 'logo.png');
    if (!/\.(svg|png|jpe?g|webp|avif|gif)$/i.test(name)) throw new Error('Logo bitte als SVG, PNG, JPG, WebP oder AVIF.');
    return { datei: await logoSpeichern(name, b) };
  },

  // Farben einer Website (auch *.local) auslesen
  // Mit { projekt }: die Seiten des Projekts der Reihe nach probieren (lokal, Staging, Live), erste erreichbare zählt
  'POST /api/farben': async (_, b) => {
    const { url, projekt } = JSON.parse(b);
    if (!projekt) return farben.vonWebsite(String(url || '').trim());
    const seiten = (await projekte()).find(p => p.kurz === projekt)?.seiten || [];
    if (!seiten.length) throw new Error(`Für ${projekt} ist keine Website in projekte.json eingetragen.`);
    const fehler = [];
    for (const s of seiten) {
      try { return await farben.vonWebsite(s); } catch (e) { fehler.push(e.message); }
    }
    throw new Error(`Keine Seite erreichbar: ${fehler.join('; ')}`);
  },

  'POST /api/erstellen': (_, b) => nacheinander(async () => {
    const start = Date.now();
    const erg = await erstellen(JSON.parse(b));
    return { ...erg, sekunden: Math.round((Date.now() - start) / 100) / 10 };
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

  'POST /api/beenden': async (req) => {
    if (!zugang.lokal(req)) throw new Error('Beenden nur am Rechner selbst.');
    await sprachmodell.entladen();
    await comfy.stoppen();
    setTimeout(() => process.exit(0), 200);
    return { ok: true };
  },
};

const TYPEN = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const SCHLUESSEL = await zugang.schluessel();
// IPv4-Adresse dieses Rechners im Netz (für die Anzeige am Rechner selbst): bevorzugt im Netz der eingetragenen Rechner
const eigeneAdresse = () => {
  const alle = Object.values(os.networkInterfaces()).flat().filter(a => a.family === 'IPv4' && !a.internal).map(a => a.address);
  const netz = (einstellungen.rechner[0] || '').split('.').slice(0, 3).join('.') + '.';
  return alle.find(a => a.startsWith(netz)) || alle[0] || os.hostname();
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    // Andere Rechner: erst anmelden (Schlüssel einmal eingeben, dann Cookie)
    if (!zugang.lokal(req)) {
      // Nur die eingetragenen Rechner (z. B. Arbeitsplatz 2), alle anderen gar nicht erst bedienen
      const von = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      if (!einstellungen.rechner.includes(von)) { res.writeHead(403); return res.end(); }
      if (req.method === 'POST' && url.pathname === '/anmelden') {
        const eingabe = new URLSearchParams((await koerper(req)).toString()).get('schluessel');
        if (!zugang.pruefen(eingabe, SCHLUESSEL)) {
          await new Promise(r => setTimeout(r, 1000));  // Raten bremsen
          res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(zugang.ANMELDESEITE('Der Schlüssel stimmt nicht.'));
        }
        res.writeHead(303, { 'Set-Cookie': zugang.anmeldeCookie(SCHLUESSEL), Location: '/' });
        return res.end();
      }
      if (!zugang.angemeldet(req, SCHLUESSEL)) {
        if (url.pathname.startsWith('/api/')) return json(res, 401, { fehler: 'Nicht angemeldet – Seite neu laden.' });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(zugang.ANMELDESEITE());
      }
    }
    // Schutz gegen fremde Webseiten im Browser: Aufrufe der Oberfläche tragen diesen Kopf, fremde Seiten können ihn nicht setzen
    if (req.method === 'POST' && url.pathname.startsWith('/api/') && req.headers['x-bildwerkstatt'] !== '1') return json(res, 403, { fehler: 'nicht erlaubt' });

    // Datei herunterladen (z. B. am anderen Arbeitsplatz)
    if (req.method === 'GET' && url.pathname === '/api/datei') {
      const datei = url.searchParams.get('pfad');
      if (!erlaubt(datei)) return json(res, 403, { fehler: 'nicht erlaubt' });
      const inhalt = await readFile(datei);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(datei))}` });
      return res.end(inhalt);
    }
    // Mehrere Dateien als ZIP (Web-Größen)
    if (req.method === 'POST' && url.pathname === '/api/zip') {
      const { dateien, name } = JSON.parse(await koerper(req));
      if (!dateien?.length || !dateien.every(erlaubt)) return json(res, 403, { fehler: 'nicht erlaubt' });
      const eintraege = await Promise.all(dateien.map(async d => ({ name: path.basename(d), daten: await readFile(d) })));
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent((name || 'web') + '.zip')}` });
      return res.end(zugang.zip(eintraege));
    }
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
}).listen(PORT, einstellungen.netzwerk ? '0.0.0.0' : '127.0.0.1', () => console.log(
  `Bildwerkstatt: http://127.0.0.1:${PORT}` + (einstellungen.netzwerk ? ` und im Netz http://${eigeneAdresse()}:${PORT} für ${einstellungen.rechner.join(', ') || 'niemanden'}` : '')));
