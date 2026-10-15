// Farben und Logos einer Website lesen (auch Local-Seiten *.local): CSS-Variablen (ACSS, WordPress-Palette),
// theme-color, sonst die häufigsten bunten Farben; Logos aus <img> mit „logo“ und Icons.
import http from 'node:http';
import https from 'node:https';

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_CSS = 12;
// Farbnamen, die Design-Systeme für die Hauptfarben verwenden (ACSS, Etch, Themes)
const HAUPTNAMEN = ['primary', 'secondary', 'tertiary', 'accent', 'action', 'brand', 'base', 'neutral'];
// Palette, die WordPress auf jeder Seite mitbringt – sagt nichts über das Design
const WP_STANDARD = new Set(['black', 'cyan-bluish-gray', 'white', 'pale-pink', 'vivid-red', 'luminous-vivid-orange',
  'luminous-vivid-amber', 'light-green-cyan', 'vivid-green-cyan', 'pale-cyan-blue', 'vivid-cyan-blue', 'vivid-purple']);

// Seite holen; Local-Seiten haben ein eigenes Zertifikat, nur dort wird es nicht geprüft
export function holen(adresse, umleitungen = 5) {
  return new Promise((ok, fehler) => {
    const url = new URL(adresse);
    if (!['http:', 'https:'].includes(url.protocol)) return fehler(new Error('Nur http- und https-Adressen.'));
    const lokal = url.hostname.endsWith('.local') || url.hostname.endsWith('.test') || url.hostname === 'localhost';
    const req = (url.protocol === 'https:' ? https : http).get(url, {
      rejectUnauthorized: !lokal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Bildwerkstatt)', Accept: 'text/html,text/css,*/*' },
      timeout: 15000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && umleitungen > 0) {
        res.resume();
        return ok(holen(new URL(res.headers.location, url).href, umleitungen - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        const tipp = lokal && res.statusCode === 502 ? ' – ist die Seite in Local gestartet?' : '';
        return fehler(new Error(`${url.host} antwortet mit HTTP ${res.statusCode}${tipp}`));
      }
      const teile = []; let laenge = 0;
      res.on('data', d => { laenge += d.length; if (laenge > MAX_BYTES) req.destroy(new Error('Antwort zu groß')); else teile.push(d); });
      res.on('end', () => {
        const daten = Buffer.concat(teile);
        ok({ daten, text: daten.toString('utf8'), url: url.href, typ: String(res.headers['content-type'] || '').split(';')[0] });
      });
      res.on('error', fehler);
    });
    req.on('timeout', () => req.destroy(new Error(`${url.host} antwortet nicht (Zeitüberschreitung)`)));
    req.on('error', e => fehler(e.code === 'ENOTFOUND' ? new Error(`${url.host} nicht gefunden${lokal ? ' – ist die Seite in Local angelegt?' : ''}`) : e));
  });
}

// ---------- Farbwerte lesen ----------
const hex2 = n => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
const alsHex = ([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
const zahl = (t, voll = 1) => (t.endsWith('%') ? parseFloat(t) / 100 * voll : parseFloat(t));

function oklchZuRgb(L, C, H) {
  const a = C * Math.cos(H * Math.PI / 180), b = C * Math.sin(H * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  return lin.map(x => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(0, x) ** (1 / 2.4) - 0.055));
}

function hslZuRgb(h, s, l) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map(n => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
}

// Einen CSS-Farbwert in [r, g, b] übersetzen (null, wenn es keiner ist oder er fast durchsichtig ist)
export function farbwert(wert) {
  let v = wert.trim().toLowerCase();
  const ld = v.match(/^light-dark\(\s*([^,]+?(?:\([^)]*\))?)\s*,/);  // helle Variante nehmen
  if (ld) v = ld[1].trim();
  let m;
  if ((m = v.match(/^#([0-9a-f]{3,8})$/))) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    if (h.length === 8 && parseInt(h.slice(6), 16) < 128) return null;
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }
  if (!(m = v.match(/^(rgba?|hsla?|oklch)\(([^)]*)\)$/))) return null;
  const teile = m[2].replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
  if (teile.length < 3 || teile.slice(0, 3).some(t => isNaN(parseFloat(t)))) return null;
  if (teile[3] && zahl(teile[3]) < 0.5) return null;
  if (m[1].startsWith('rgb')) return teile.slice(0, 3).map(t => zahl(t, 255));
  if (m[1].startsWith('hsl')) return hslZuRgb(parseFloat(teile[0]), zahl(teile[1]) / (teile[1].endsWith('%') ? 1 : 100), zahl(teile[2]) / (teile[2].endsWith('%') ? 1 : 100));
  return oklchZuRgb(zahl(teile[0]), zahl(teile[1], 0.4), parseFloat(teile[2]));
}

const abstand = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const bunt = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) > 40;

// ---------- Website auslesen ----------
export async function vonWebsite(adresse) {
  if (!/^https?:\/\//i.test(adresse)) adresse = 'https://' + adresse.trim();
  const seite = await holen(adresse);
  const html = seite.text;
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
  // Eigene Stylesheets (keine Schriften von Google)
  const links = [...html.matchAll(/<link[^>]+>/gi)].map(m => m[0])
    .filter(l => /rel=["']?stylesheet/i.test(l))
    .map(l => (l.match(/href=["']([^"']+)/i) || [])[1]).filter(Boolean)
    .map(h => new URL(h.replace(/&amp;/g, '&'), seite.url).href)
    .filter(h => !/fonts\.googleapis|fonts\.bunny/.test(h)).slice(0, MAX_CSS);
  css.push(...(await Promise.all(links.map(l => holen(l).then(r => r.text, () => '')))));
  const alles = css.join('\n');

  const gefunden = [];  // { rgb, name, gewicht }
  const merken = (rgb, name, gewicht) => {
    if (!rgb) return;
    const da = gefunden.find(f => abstand(f.rgb, rgb) < 18);
    if (da) { da.gewicht += gewicht; if (!da.name && name) da.name = name; } else gefunden.push({ rgb, name, gewicht });
  };

  // 1. theme-color
  const theme = html.match(/<meta[^>]+name=["']theme-color["'][^>]*>/i)?.[0].match(/content=["']([^"']+)/i)?.[1];
  if (theme) merken(farbwert(theme), 'theme-color', 1000);
  // 2. Hauptfarben als CSS-Variablen (--primary, --wp--preset--color--<slug>, …)
  const variablen = new Map();
  for (const [, name, wert] of alles.matchAll(/--([\w-]+)\s*:\s*([^;{}]+)/g)) if (!variablen.has(name)) variablen.set(name, wert);
  for (const name of HAUPTNAMEN) merken(variablen.has(name) ? farbwert(variablen.get(name)) : null, name, 500);
  for (const [name, wert] of variablen) {
    const slug = name.match(/^wp--preset--color--(.+)$/)?.[1];
    if (slug && !WP_STANDARD.has(slug)) merken(farbwert(wert), slug, 300);
  }
  // 3. Sonst: häufige bunte Farben aus dem CSS
  const zaehler = new Map();
  for (const [w] of alles.matchAll(/#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch)\([^)]*\)/gi)) zaehler.set(w.toLowerCase(), (zaehler.get(w.toLowerCase()) || 0) + 1);
  for (const [w, n] of zaehler) { const rgb = farbwert(w); if (rgb && bunt(rgb)) merken(rgb, '', n); }

  // Benannte Farben zuerst (primary vor secondary …), dann nach Häufigkeit; nur benannte sind vorausgewählt
  const rang = f => f.name === 'theme-color' ? -1 : HAUPTNAMEN.includes(f.name) ? HAUPTNAMEN.indexOf(f.name) : f.name ? 50 : 100;
  const farben = gefunden.sort((a, b) => rang(a) - rang(b) || b.gewicht - a.gewicht).slice(0, 8)
    .map(f => ({ hex: alsHex(f.rgb), name: f.name || '', haupt: Boolean(f.name) }));
  if (!farben.length) throw new Error('Auf der Seite keine Farben gefunden.');
  return { url: seite.url, farben };
}

// ---------- Logos ----------
const MAX_LOGOS = 6;

// Logo-Kandidaten einer Seite: <img> mit „logo“ in Klasse, Name oder Alt-Text, dazu die Icons (apple-touch-icon, icon)
export async function logosVonWebsite(adresse) {
  if (!/^https?:\/\//i.test(adresse)) adresse = 'https://' + adresse.trim();
  const seite = await holen(adresse);
  const html = seite.text.replace(/\\\//g, '/').replace(/\\"/g, '"');  // auch JSON-maskiertes HTML (\/ und \")
  const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}=["']([^"']*)`, 'i')) || [])[1] || '';
  const kandidaten = [];
  const dazu = (src, art, rang) => {
    if (!src || src.startsWith('data:')) return;
    try { src = new URL(src.replace(/&amp;/g, '&'), seite.url).href; } catch { return; }
    if (!kandidaten.some(k => k.url === src)) kandidaten.push({ url: src, art, rang: rang - (/\.svg(\?|$)/i.test(src) ? 1 : 0) });
  };
  for (const [tag] of html.matchAll(/<img\s[^>]*>/gi)) {
    const text = `${attr(tag, 'class')} ${attr(tag, 'id')} ${attr(tag, 'alt')} ${attr(tag, 'src')}`;
    if (!/logo|wortbildmarke|bildmarke|brand/i.test(text)) continue;
    // größte Variante aus srcset, sonst src (bei Lazy-Loading data-src)
    const set = attr(tag, 'srcset').split(',').map(t => t.trim().split(/\s+/)).filter(t => t[0])
      .sort((a, b) => parseFloat(b[1] || 0) - parseFloat(a[1] || 0));
    dazu(set[0]?.[0] || attr(tag, 'data-src') || attr(tag, 'src'), 'Logo', /custom-logo|site-logo/i.test(text) ? 0 : 2);
  }
  for (const [tag] of html.matchAll(/<link\s[^>]*>/gi)) {
    const rel = attr(tag, 'rel').toLowerCase();
    if (rel.includes('apple-touch-icon')) dazu(attr(tag, 'href'), 'Icon', 5);
    else if (rel.split(/\s+/).includes('icon')) dazu(attr(tag, 'href'), 'Icon', 6 - (parseInt(attr(tag, 'sizes')) || 0) / 1000);
  }
  if (!kandidaten.length) throw new Error('Auf der Seite kein Logo gefunden – Logo als Datei ablegen.');
  return { url: seite.url, logos: kandidaten.sort((a, b) => a.rang - b.rang).slice(0, MAX_LOGOS).map(({ url, art }) => ({ url, art })) };
}

// Ein Logo holen; liefert Daten und Endung (nur Bildformate)
export async function logoHolen(adresse) {
  const r = await holen(adresse);
  const endung = { 'image/svg+xml': '.svg', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
    'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico', 'image/avif': '.avif' }[r.typ]
    || (/<svg[\s>]/i.test(r.text.slice(0, 2000)) ? '.svg' : '');
  if (!endung || endung === '.ico') throw new Error(`Kein verwendbares Bild (${r.typ || 'unbekannter Typ'}).`);
  return { daten: r.daten, endung, name: decodeURIComponent(new URL(r.url).pathname.split('/').pop() || 'logo').replace(/\.[^.]+$/, '') };
}
