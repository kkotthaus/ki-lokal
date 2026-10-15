// ComfyUI: starten, GPU prüfen, Workflows ausführen, Grafikspeicher freigeben.
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { KI_LOKAL } from './pfade.mjs';

const SERVER = 'http://127.0.0.1:8188';
const WORKFLOWS = path.join(KI_LOKAL, 'scripts', 'comfy');

async function api(pfad, { methode = 'GET', json, body, headers = {}, timeout = 30000 } = {}) {
  const r = await fetch(SERVER + pfad, {
    method: methode,
    headers: json ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: json ? JSON.stringify(json) : body,
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) throw new Error(`ComfyUI meldet HTTP ${r.status} für ${pfad}: ${await r.text()}`);
  return r;
}

export async function laeuft() {
  try { await api('/system_stats', { timeout: 3000 }); return true; } catch { return false; }
}

function pwsh(skript) {
  return new Promise((ok, fehler) => {
    const p = spawn('pwsh', ['-NoProfile', '-File', path.join(WORKFLOWS, skript)], { windowsHide: true });
    let aus = '';
    p.stdout.on('data', d => (aus += d));
    p.stderr.on('data', d => (aus += d));
    // 'exit' statt 'close': der gestartete ComfyUI-Server erbt die Ausgabe, 'close' käme erst mit seinem Ende
    p.on('exit', code => setTimeout(() => (code === 0 ? ok(aus) : fehler(new Error(`${skript} fehlgeschlagen:\n${aus}`))), 100));
  });
}

// Startet ComfyUI bei Bedarf und bricht ab, wenn es nicht auf der Grafikkarte läuft.
export async function bereit() {
  if (!(await laeuft())) await pwsh('start.ps1');
  const stats = await (await api('/system_stats')).json();
  const geraete = (stats.devices || []).map(d => d.type);
  if (!geraete.includes('cuda')) throw new Error(`ComfyUI läuft nicht auf der Grafikkarte (Geräte: ${geraete.join(', ') || 'keine'}). Abbruch.`);
}

export async function stoppen() {
  await pwsh('stop.ps1').catch(() => {});
}

// Modelle aus dem Grafikspeicher werfen, damit das Sprachmodell Platz hat.
export async function freigeben() {
  if (await laeuft()) await api('/free', { methode: 'POST', json: { unload_models: true, free_memory: true } });
}

async function hochladen(datei) {
  const form = new FormData();
  form.append('image', new Blob([await readFile(datei)]), path.basename(datei));
  form.append('overwrite', 'true');
  return (await (await api('/upload/image', { methode: 'POST', body: form })).json()).name;
}

// Führt einen Workflow mit Bild-Eingabe (Knoten "1") aus und schreibt das Ergebnis von Knoten "6".
export async function ausfuehren(workflowDatei, eingabe, ausgabe, anpassen = () => {}) {
  await bereit();
  const workflow = JSON.parse(await readFile(path.join(WORKFLOWS, workflowDatei), 'utf8'));
  workflow['1'].inputs.image = await hochladen(eingabe);
  anpassen(workflow);
  return lauf(workflow, '6', ausgabe);
}

// Text zu Bild mit FLUX.1 schnell (flux_api.json): Ergebnis von Knoten "9" als PNG.
export async function erzeugen(prompt, breite, hoehe, ausgabe) {
  await bereit();
  const workflow = JSON.parse(await readFile(path.join(WORKFLOWS, 'flux_api.json'), 'utf8'));
  workflow['6'].inputs.text = prompt;
  Object.assign(workflow['5'].inputs, { width: breite, height: hoehe, batch_size: 1 });
  workflow['3'].inputs.seed = Math.floor(Math.random() * 2 ** 48);  // jedes Mal eine neue Variante
  return lauf(workflow, '9', ausgabe);
}

async function lauf(workflow, knoten, ausgabe) {
  const { prompt_id } = await (await api('/prompt', { methode: 'POST', json: { prompt: workflow } })).json();
  const bis = Date.now() + 15 * 60 * 1000;
  while (Date.now() < bis) {
    const verlauf = await (await api(`/history/${prompt_id}`)).json();
    const eintrag = verlauf[prompt_id];
    if (eintrag) {
      if (eintrag.status?.status_str === 'error') {
        const meldung = eintrag.status.messages?.find(m => m[0] === 'execution_error')?.[1]?.exception_message;
        throw new Error(`ComfyUI-Fehler: ${meldung || JSON.stringify(eintrag.status)}`);
      }
      const bild = eintrag.outputs[knoten].images[0];
      const q = new URLSearchParams({ filename: bild.filename, subfolder: bild.subfolder, type: bild.type });
      await writeFile(ausgabe, Buffer.from(await (await api(`/view?${q}`)).arrayBuffer()));
      return ausgabe;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('ComfyUI: Zeitüberschreitung');
}
