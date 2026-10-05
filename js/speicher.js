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

/** Status einer ganzen Einreichung setzen (Mitglied: „erstattet“ bzw. zurück) */
export async function setzeEinreichungStatus(einreichungId, status) {
  await apiPost('einreichungen/status', { id: einreichungId, status });
  const jetzt = new Date().toISOString();
  cache = cache.map((a) => (a.einreichungId === einreichungId ? { ...a, status, geaendertAm: jetzt } : a));
}

/** Offene Auslagen als Einreichung bündeln (→ „eingereicht“); liefert die Einreichungs-ID */
export async function reicheEin(ids) {
  const { einreichung, auslagen } = await apiPost('einreichungen', { ids });
  for (const a of auslagen) ersetzeImCache(a);
  return einreichung.id;
}

/** Einreichungs-PDF zur Einreichung speichern (einmalig, direkt nach dem Einreichen) */
export async function speichereEinreichungsPdf(einreichungId, blob) {
  await api(mitId('einreichungen/pdf', einreichungId), { methode: 'PUT', body: blob });
  cache = cache.map((a) => (a.einreichungId === einreichungId ? { ...a, hatPdf: true } : a));
}

/** Gespeichertes Einreichungs-PDF laden */
export function holeEinreichungsPdf(einreichungId) {
  return api(mitId('einreichungen/pdf', einreichungId), { blob: true });
}

/** Einreichung zurückziehen – die Auslagen sind danach wieder offen */
export async function zieheEinreichungZurueck(einreichungId) {
  await apiDelete(mitId('einreichungen', einreichungId));
  const jetzt = new Date().toISOString();
  cache = cache.map((a) => (a.einreichungId === einreichungId
    ? { ...a, status: 'offen', einreichungId: null, eingereichtAm: null, uebernommen: false, hatPdf: false, geaendertAm: jetzt }
    : a));
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
 * Auslagen importieren (Backup). Vorhandene IDs werden übersprungen. Nicht offene Auslagen werden
 * danach wieder gebündelt – nach ihrer ursprünglichen Einreichung, sonst je Status.
 * @param {Array<{auslage: object, beleg: Blob|null}>} eintraege
 */
export async function importiereAuslagen(eintraege, fortschritt = () => {}) {
  let importiert = 0;
  let uebersprungen = 0;
  let zurueckgestuft = 0; // „Erstattung veranlasst“ → „eingereicht“
  const fehler = [];
  const gruppen = new Map(); // Schlüssel → IDs der neu angelegten Auslagen
  for (const [i, { auslage, beleg }] of eintraege.entries()) {
    fortschritt(i + 1, eintraege.length);
    try {
      const status = auslage.status === 'veranlasst' ? 'eingereicht' : (auslage.status || 'offen');
      const neu = await legeAuslageAn({
        id: String(auslage.id), datum: auslage.datum, haendler: auslage.haendler,
        betrag: Number(auslage.betrag), notiz: auslage.notiz || '',
        // „Erstattung veranlasst“ kann nur der Kassenwart setzen → als eingereicht übernehmen
        status, erstelltAm: auslage.erstelltAm
      }, beleg);
      importiert++;
      if (status !== 'offen') {
        const schluessel = `${auslage.einreichungId || 'ohne'}|${status}`;
        gruppen.set(schluessel, [...(gruppen.get(schluessel) || []), neu.id]);
      }
      if (auslage.status === 'veranlasst') zurueckgestuft++;
    } catch (err) {
      if (err instanceof ApiFehler && err.status === 409) uebersprungen++;
      else fehler.push(`${auslage.haendler || auslage.id}: ${err.message}`);
    }
  }
  for (const ids of gruppen.values()) {
    // Schlägt das fehl, bündelt der Server beim nächsten Laden je Status (Rückfallebene)
    await apiPost('einreichungen/uebernahme', { ids }).catch((err) => fehler.push(err.message));
  }
  if (gruppen.size) await aktualisiereVomServer();
  return { importiert, uebersprungen, zurueckgestuft, fehler };
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
