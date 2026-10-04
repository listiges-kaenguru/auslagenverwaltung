// =============================================
// API-ZUGRIFF (PHP-Backend unter api/)
// - Alle Änderungen senden den Header X-VA-Anfrage (CSRF-Schutz auf dem Server)
// - 401 → Ereignis „nicht-angemeldet“ (App zeigt die Anmeldung)
// =============================================

export class ApiFehler extends Error {
  constructor(text, status) {
    super(text);
    this.name = 'ApiFehler';
    this.status = status;
  }
}

/**
 * @param {string} route z. B. "auslagen" oder "auslagen&id=…"
 * @param {{methode?: string, json?: any, body?: Blob, blob?: boolean, still401?: boolean}} optionen
 */
export async function api(route, { methode = 'GET', json, body, blob = false, still401 = false } = {}) {
  const headers = { 'X-VA-Anfrage': '1' };
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (body instanceof Blob) {
    headers['Content-Type'] = body.type || 'application/octet-stream';
  }

  let antwort;
  try {
    antwort = await fetch(`api/?r=${route}`, {
      method: methode, headers, body, credentials: 'same-origin', cache: 'no-store'
    });
  } catch {
    throw new ApiFehler('Keine Verbindung zum Server. Bitte Internetverbindung prüfen.', 0);
  }

  if (antwort.status === 401 && !still401) {
    document.dispatchEvent(new CustomEvent('nicht-angemeldet'));
  }

  if (blob && antwort.ok) return antwort.blob();

  let daten = null;
  try { daten = await antwort.json(); } catch { /* keine JSON-Antwort */ }
  if (!antwort.ok || !daten?.ok) {
    const text = daten?.fehler
      || (antwort.status === 413 ? 'Die Datei ist zu groß für den Server.' : `Serverfehler (${antwort.status}).`);
    throw new ApiFehler(text, antwort.status);
  }
  return daten;
}

export const apiGet    = (route, opt)       => api(route, { ...opt, methode: 'GET' });
export const apiPost   = (route, json, opt) => api(route, { ...opt, methode: 'POST', json });
export const apiPut    = (route, json, opt) => api(route, { ...opt, methode: 'PUT', json });
export const apiDelete = (route, opt)       => api(route, { ...opt, methode: 'DELETE' });

/** ID sicher in eine Route einsetzen */
export const mitId = (route, id) => `${route}&id=${encodeURIComponent(id)}`;
