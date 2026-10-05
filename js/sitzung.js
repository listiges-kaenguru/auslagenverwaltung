// =============================================
// SITZUNG: Serverstatus und angemeldeter Benutzer
// Ereignisse: „benutzer-geaendert“ (Profil/Stammdaten neu), „angemeldet“, „abgemeldet“
// =============================================
import { apiGet, apiPost } from './api.js';

let status = { eingerichtet: true, benutzer: null, mfaAusstehend: false, maxBelegBytes: 15 * 1024 * 1024, maxPdfBytes: 0, passkeysMoeglich: false };

export async function ladeStatus() {
  status = await apiGet('status', { still401: true });
  return status;
}

export const serverStatus     = () => status;
export const aktuellerBenutzer = () => status.benutzer;
export const istAdmin          = () => status.benutzer?.rolle === 'admin';
/** Kassenwart oder Vorstand → Ansicht „Kasse“ (Vorstand nur lesend) */
export const hatKassenrolle    = () => ['kassenwart', 'vorstand'].includes(status.benutzer?.kassenrolle);
export const istKassenwart     = () => status.benutzer?.kassenrolle === 'kassenwart';
export const maxBelegBytes     = () => status.maxBelegBytes;
export const maxPdfBytes       = () => status.maxPdfBytes;
/** Backup speichern/einspielen nur, wenn in der Server-Konfiguration eingeschaltet (für Tests) */
export const datensicherungAktiv = () => status.datensicherung === true;

/** Passkeys brauchen HTTPS (oder localhost) und Browser-Unterstützung */
export const passkeysMoeglich = () => status.passkeysMoeglich && !!window.PublicKeyCredential;

export function setzeBenutzer(benutzer) {
  status = { ...status, benutzer, mfaAusstehend: false };
  document.dispatchEvent(new CustomEvent('benutzer-geaendert'));
}

export async function meldeAb() {
  try { await apiPost('abmeldung', undefined, { still401: true }); } catch { /* trotzdem lokal abmelden */ }
  status = { ...status, benutzer: null, mfaAusstehend: false };
  document.dispatchEvent(new CustomEvent('abgemeldet'));
}

/** Anzeigename: „Vorname Nachname“ oder Benutzername */
export function anzeigeName(benutzer = status.benutzer) {
  if (!benutzer) return '';
  const { vorname, nachname } = benutzer.stammdaten;
  return `${vorname} ${nachname}`.trim() || benutzer.benutzername;
}
