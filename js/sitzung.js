// =============================================
// SITZUNG: Serverstatus und angemeldeter Benutzer
// Ereignisse: „benutzer-geaendert“ (Profil/Stammdaten neu), „angemeldet“, „abgemeldet“
// =============================================
import { apiGet, apiPost } from './api.js';

let status = { eingerichtet: true, benutzer: null, mfaAusstehend: false, maxBelegBytes: 15 * 1024 * 1024, passkeysMoeglich: false };

export async function ladeStatus() {
  status = await apiGet('status', { still401: true });
  return status;
}

export const serverStatus     = () => status;
export const aktuellerBenutzer = () => status.benutzer;
export const istAdmin          = () => status.benutzer?.rolle === 'admin';
export const maxBelegBytes     = () => status.maxBelegBytes;

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
