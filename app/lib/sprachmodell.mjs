// Lokales Sprachmodell über LM Studio: laden (ganz auf der Grafikkarte), fragen, entladen.
import { execFile } from 'node:child_process';
import path from 'node:path';
import sharp from 'sharp';

const LMS = path.join(process.env.USERPROFILE || '', '.lmstudio', 'bin', 'lms.exe');
const SERVER = 'http://127.0.0.1:1234';
const KENNUNG = 'bildwerkstatt';

function lms(...args) {
  return new Promise((ok, fehler) =>
    execFile(LMS, args, { windowsHide: true, timeout: 180000 }, (err, aus, feh) =>
      err ? fehler(new Error(`lms ${args[0]}: ${feh || aus || err.message}`)) : ok(aus)));
}

async function geladen() {
  const liste = JSON.parse((await lms('ps', '--json')) || '[]');
  return liste.find(m => m.identifier === KENNUNG);
}

export async function bereit(modell) {
  try { await fetch(`${SERVER}/v1/models`, { signal: AbortSignal.timeout(2000) }); }
  catch { await lms('server', 'start'); }
  if (await geladen()) return;
  // --gpu max: alle Schichten auf die Grafikkarte, nichts auf den Prozessor
  await lms('load', modell, '--gpu', 'max', '--context-length', '8192', '--identifier', KENNUNG, '-y');
}

export async function entladen() {
  try { if (await geladen()) await lms('unload', KENNUNG); } catch { /* LM Studio nicht da: nichts zu tun */ }
}

async function frage(nachrichten, schema) {
  const r = await fetch(`${SERVER}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: KENNUNG,
      messages: nachrichten,
      temperature: 0.2,
      max_tokens: 2000,
      // Ohne Denkmodus: sonst verbraucht Qwen über 1000 Tokens, bevor die Antwort kommt
      reasoning_effort: 'none',
      response_format: { type: 'json_schema', json_schema: { name: 'antwort', strict: true, schema } },
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) throw new Error(`LM Studio meldet HTTP ${r.status}: ${await r.text()}`);
  const wahl = (await r.json()).choices[0];
  const inhalt = (wahl.message.content || '').replace(/^[\s\S]*<\/think>/, '').trim();
  if (!inhalt) throw new Error(`Das Sprachmodell hat keine Antwort geliefert (Abbruch: ${wahl.finish_reason}).`);
  return JSON.parse(inhalt);
}

const FORMATE = ['hero', 'teaser', 'quadrat', 'hoch'];

// Freien Text in eine Folge von Schritten übersetzen.
// Das Modell entscheidet je Schritt einzeln (ohne Denkmodus treffsicherer als eine freie Liste),
// die Reihenfolge legt die Bildwerkstatt fest.
export async function plan(text) {
  const schema = {
    type: 'object',
    properties: {
      freistellen: { type: 'boolean' },
      zuschneiden: { type: 'string', enum: ['nein', ...FORMATE] },
      vergroessern: { type: 'integer', enum: [0, 2, 4] },
      web: { type: 'boolean' },
      alttext: { type: 'boolean' },
      hinweis: { type: 'string' },
    },
    required: ['freistellen', 'zuschneiden', 'vergroessern', 'web', 'alttext', 'hinweis'],
    additionalProperties: false,
  };
  const system = `Du liest eine Anweisung für die Bearbeitung eines Bildes und entscheidest für jeden Schritt,
ob der Nutzer ihn verlangt. Im Zweifel nein: nur was ausdrücklich gesagt wird.
- freistellen: true nur wenn der Hintergrund weg/transparent soll oder „freistellen“ gesagt wird.
- zuschneiden: hero (16:9, Banner, Titelbild, Querformat), teaser (3:2), quadrat (1:1), hoch (2:3, Hochformat), sonst "nein".
- vergroessern: 2 oder 4 wenn größer/hochskaliert werden soll („doppelt“ = 2, „vierfach“ = 4, ohne Zahl 2), sonst 0.
- web: true wenn es für Website/Internet optimiert oder fertig gemacht werden soll.
- alttext: true wenn Alt-Text, Bildbeschreibung oder Dateiname gewünscht ist.
- hinweis: Verlangt der Nutzer etwas, das keiner dieser Schritte kann (etwa Farben ändern, aufhellen,
  Text einfügen), nenne genau diesen Wunsch: „<Wunsch> kann die Bildwerkstatt noch nicht.“ Sonst "".`;
  const a = await frage([{ role: 'system', content: system }, { role: 'user', content: text }], schema);
  const schritte = [];
  if (a.freistellen) schritte.push({ schritt: 'freistellen', format: '', faktor: 0 });
  if (FORMATE.includes(a.zuschneiden)) schritte.push({ schritt: 'zuschneiden', format: a.zuschneiden, faktor: 0 });
  if (a.vergroessern) schritte.push({ schritt: 'vergroessern', format: '', faktor: a.vergroessern });
  if (a.web) schritte.push({ schritt: 'web', format: '', faktor: 0 });
  if (a.alttext) schritte.push({ schritt: 'alttext', format: '', faktor: 0 });
  return { schritte, hinweis: a.hinweis };
}

// Alt-Text und Dateinamen für ein Bild vorschlagen.
export async function alttext(datei, kontext = '') {
  const vorschau = await sharp(datei).resize({ width: 1024, height: 1024, fit: 'inside' })
    .flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
  const schema = {
    type: 'object',
    properties: { alt: { type: 'string' }, dateiname: { type: 'string' } },
    required: ['alt', 'dateiname'],
    additionalProperties: false,
  };
  const a = await frage([
    {
      role: 'system',
      content: `Du schreibst Alt-Texte für Bilder auf deutschen Websites.
alt: ein sachlicher Satz auf Deutsch, höchstens 125 Zeichen, beschreibt was zu sehen ist, ohne "Bild von" oder "Foto von".
dateiname: 2 bis 5 deutsche Wörter in Kleinbuchstaben mit Bindestrich, ohne Umlaute (ae, oe, ue, ss), ohne Endung.${kontext ? `\nZusammenhang: ${kontext}` : ''}`,
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Schlage Alt-Text und Dateinamen für dieses Bild vor.' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${vorschau.toString('base64')}` } },
      ],
    },
  ], schema);
  a.dateiname = a.dateiname.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/-(jpe?g|png|webp|avif)$/, '').replace(/^-|-$/g, '');
  return a;
}
