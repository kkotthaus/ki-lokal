// Pfade relativ zum Repo: <Projekte-KI>\ki-lokal\app\lib -> <Projekte-KI>
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const KI_LOKAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROJEKTE_KI = path.dirname(KI_LOKAL);
export const MEDIEN = path.join(PROJEKTE_KI, 'medien');
// Projekte-Ordner liegt neben Projekte-KI (D:\Projekte bzw. C:\Projekte)
export const PROJEKTE = path.join(path.dirname(PROJEKTE_KI), 'Projekte');
export const STATUS = path.join(process.env.LOCALAPPDATA || PROJEKTE_KI, 'ki-lokal');
export const EINSTELLUNGEN = path.join(STATUS, 'bildwerkstatt.json');
