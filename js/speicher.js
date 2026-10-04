// =============================================
// DATENHALTUNG (Server)
// Die Auslagen des angemeldeten Benutzers werden nach der Anmeldung geladen und im Speicher
// gehalten, damit die Ansichten synchron rendern können. Jede Änderung geht sofort an den
// Server; erst nach dessen Bestätigung wird der lokale Stand aktualisiert.
// Belege werden bei Bedarf geladen und kurz zwischengespeichert.
// =============================================
import { api, apiGet, apiPost, apiPut, apiDelete, mitId, ApiFehler } from './api.js';

let cache = [];
const belegCache = new Map(); // id → Blob (nur für diese Sitzung)
const MAX_BELEG_CACHE = 30;

/** Alle Auslagen (nur lesen – nicht direkt verändern!) */
export function ladeAuslagen() {
  return cache;
}

/** Auslagen sortiert: neuestes Belegdatum zuerst, dann Erfassungszeitpunkt */
export function ladeAuslagenSortiert() {
  return [...cache].sort((a, b) =>
    (b.datum || '').localeCompare(a.datum || '') ||
    (b.erstelltAm || '').localeCompare(a.erstelltAm || ''));
}

export function findeAuslage(id) {
  return cache.find((a) => a.id === id) || null;
}

/** Stand vom Server holen (nach Anmeldung und beim Zurückkehren in die App) */
export async function aktualisiereVomServer() {
  const { auslagen } = await apiGet('auslagen');
  cache = auslagen;
  return cache;
}

/** Beim Abmelden alles vergessen */
export function leereSpeicher() {
  cache = [];
  belegCache.clear();
}

function ersetzeImCache(auslage) {
  const idx = cache.findIndex((a) => a.id === auslage.id);
  cache = idx === -1 ? [auslage, ...cache] : cache.map((a) => (a.id === auslage.id ? auslage : a));
  return auslage;
}

/** Neue Auslage anlegen; scheitert der Beleg-Upload, wird die Auslage wieder entfernt */
export async function legeAuslageAn(daten, beleg) {
  const { auslage } = await apiPost('auslagen', daten);
  if (!beleg) return ersetzeImCache(auslage);
  try {
    return await setzeBeleg(auslage.id, beleg);
  } catch (err) {
    await apiDelete(mitId('auslagen', auslage.id)).catch(() => {});
    throw err;
  }
}

/** Felder einer Auslage ändern */
export async function aktualisiereAuslage(id, aenderungen) {
  const { auslage } = await apiPut(mitId('auslagen', id), aenderungen);
  return ersetzeImCache(auslage);
}

/** Status mehrerer Auslagen in einem Schritt setzen */
export async function setzeStatus(ids, status) {
  await apiPost('auslagen/status', { ids, status });
  const ziel = new Set(ids);
  const jetzt = new Date().toISOString();
  cache = cache.map((a) => (ziel.has(a.id) ? { ...a, status, geaendertAm: jetzt } : a));
}

/** Auslage samt Beleg löschen */
export async function loescheAuslage(id) {
  await apiDelete(mitId('auslagen', id));
  cache = cache.filter((a) => a.id !== id);
  belegCache.delete(id);
}

/** Beleg hinzufügen, ersetzen (Blob) oder entfernen (null) */
export async function setzeBeleg(id, blob) {
  const { auslage } = blob
    ? await api(mitId('beleg', id), { methode: 'PUT', body: blob })
    : await apiDelete(mitId('beleg', id));
  if (blob) merkeBeleg(id, blob);
  else belegCache.delete(id);
  return ersetzeImCache(auslage);
}

function merkeBeleg(id, blob) {
  belegCache.set(id, blob);
  if (belegCache.size > MAX_BELEG_CACHE) belegCache.delete(belegCache.keys().next().value);
}

/** Beleg als Blob laden */
export async function holeBeleg(id) {
  if (belegCache.has(id)) return belegCache.get(id);
  try {
    const blob = await api(mitId('beleg', id), { blob: true });
    merkeBeleg(id, blob);
    return blob;
  } catch (err) {
    if (err instanceof ApiFehler && err.status === 404) return null;
    throw err;
  }
}

/**
 * Auslagen importieren (Backup der Einzelplatz-App). Vorhandene IDs werden übersprungen.
 * @param {Array<{auslage: object, beleg: Blob|null}>} eintraege
 */
export async function importiereAuslagen(eintraege, fortschritt = () => {}) {
  let importiert = 0;
  let uebersprungen = 0;
  const fehler = [];
  for (const [i, { auslage, beleg }] of eintraege.entries()) {
    fortschritt(i + 1, eintraege.length);
    try {
      await legeAuslageAn({
        id: String(auslage.id), datum: auslage.datum, haendler: auslage.haendler,
        betrag: Number(auslage.betrag), notiz: auslage.notiz || '',
        status: auslage.status, erstelltAm: auslage.erstelltAm
      }, beleg);
      importiert++;
    } catch (err) {
      if (err instanceof ApiFehler && err.status === 409) uebersprungen++;
      else fehler.push(`${auslage.haendler || auslage.id}: ${err.message}`);
    }
  }
  return { importiert, uebersprungen, fehler };
}

// ---------------------------------------------
// Datensicherung: Zeitpunkt merken (pro Gerät, nur als Erinnerung)
// ---------------------------------------------
const LS_LETZTES_BACKUP = 'va_mu_letztes_backup';

export function letztesBackup() {
  try { return localStorage.getItem(LS_LETZTES_BACKUP); } catch { return null; }
}
export function merkeBackup() {
  try { localStorage.setItem(LS_LETZTES_BACKUP, new Date().toISOString()); } catch { /* egal */ }
}
