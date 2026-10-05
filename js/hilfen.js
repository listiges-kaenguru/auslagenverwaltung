// =============================================
// HILFSFUNKTIONEN (ohne DOM-Zustand der App)
// =============================================

/**
 * Status-Definitionen (Reihenfolge = Arbeitsablauf). „veranlasst“ setzt nur der Kassenwart;
 * kurz = Beschriftung für enge Stellen (Filter-Chips, Summenkarte).
 */
export const STATUS = {
  offen:       { label: 'Offen',                 kurz: 'Offen',       icon: '○' },
  eingereicht: { label: 'Eingereicht',           kurz: 'Eingereicht', icon: '◐' },
  veranlasst:  { label: 'Erstattung veranlasst', kurz: 'Veranlasst',  icon: '◕' },
  erstattet:   { label: 'Erstattet',             kurz: 'Erstattet',   icon: '●' }
};
export const STATUS_LISTE = Object.keys(STATUS);

/** Status-Informationen inkl. Schlüssel (unbekannte Werte → "offen") */
export function statusInfo(status) {
  const key = STATUS[status] ? status : 'offen';
  return { key, ...STATUS[key] };
}

/** Heutiges Datum (lokale Zeit) als YYYY-MM-DD für <input type="date"> */
export function heuteISO() {
  const jetzt = new Date();
  const j = jetzt.getFullYear();
  const m = String(jetzt.getMonth() + 1).padStart(2, '0');
  const t = String(jetzt.getDate()).padStart(2, '0');
  return `${j}-${m}-${t}`;
}

/** ISO-Datum (YYYY-MM-DD) in deutsches Format (DD.MM.YYYY) umwandeln */
export function formatiereDatum(iso) {
  const treffer = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!treffer) return '—';
  return `${treffer[3]}.${treffer[2]}.${treffer[1]}`;
}

/** ISO-Zeitpunkt (UTC) als lokales Datum mit Uhrzeit, z. B. „05.10.2026, 14:30“ */
export function formatiereZeitpunkt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const euroFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/** Zahl als Euro-Betrag formatieren (de-DE) */
export function formatiereBetrag(betrag) {
  return euroFormat.format(Number(betrag) || 0);
}

/** Betrag für Eingabefelder / CSV: 1234.5 → "1234,50" */
export function betragAlsText(betrag) {
  return (Number(betrag) || 0).toFixed(2).replace('.', ',');
}

/**
 * Betrag aus Benutzereingabe lesen – akzeptiert deutsches und englisches Format:
 * "12,50", "12.50", "1.234,56", "1234", "€ 12,5". Gibt NaN bei ungültiger Eingabe zurück.
 */
export function parseBetrag(eingabe) {
  let s = String(eingabe ?? '').trim().replace(/[\s€]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) {
    // Komma = Dezimaltrenner, Punkte = Tausendertrenner
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // "1.234" → deutsche Tausendertrennung
    s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return Math.round(parseFloat(s) * 100) / 100;
}

/** „1 Auslage“ / „3 Auslagen“ */
export function plural(anzahl, einzahl, mehrzahl) {
  return `${anzahl} ${anzahl === 1 ? einzahl : mehrzahl}`;
}

/** Summe der Beträge einer Liste */
export function summe(auslagen) {
  return auslagen.reduce((s, a) => s + (a.betrag || 0), 0);
}

/** Dateigröße lesbar formatieren */
export function formatiereGroesse(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1).replace('.', ',')} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
}

/** HTML-Sonderzeichen escapen – sicher für Text UND Attributwerte */
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Eindeutige ID (UUID, falls verfügbar) */
export function neueId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Dateinamen bereinigen (Umlaute bleiben erhalten) */
export function sichererDateiname(text, maxLaenge = 80) {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.]+|_+$/g, '')
    .slice(0, maxLaenge) || 'Datei';
}

/** Dateiendung zum MIME-Typ */
export function dateiEndung(mimeTyp) {
  const typ = String(mimeTyp || '').toLowerCase();
  if (typ.includes('pdf'))  return 'pdf';
  if (typ.includes('png'))  return 'png';
  if (typ.includes('webp')) return 'webp';
  if (typ.includes('gif'))  return 'gif';
  if (typ.includes('heic')) return 'heic';
  return 'jpg';
}

/**
 * Aus Firefox für Android installierte App (PWA): PDFs lassen sich dort nicht per Download-Link
 * speichern (ZIP/CSV schon; auch als application/octet-stream führt der Link nur zu about:blank).
 * Das Öffnen der PDF in Firefox funktioniert (dort speicherbar). Nur in diesem Fall gibt es für PDFs
 * deshalb ausschließlich „PDF öffnen“. Firefox-Browser, Chrome und Desktop bleiben unverändert.
 */
function istFirefoxAndroidApp() {
  const ua = navigator.userAgent || '';
  return /Android/i.test(ua) && /Firefox\//.test(ua) &&
    !!window.matchMedia?.('(display-mode: standalone)').matches;
}

/**
 * Blob als Datei anbieten.
 * Kein automatischer Download: Firefox für Android verwirft ihn nach längerer Berechnung
 * (z. B. einer PDF). Stattdessen erscheint ein Fenster mit einem echten Download-Link –
 * ein Tipp des Nutzers darauf funktioniert in allen Browsern.
 * @returns {Promise<boolean>} true, wenn „Herunterladen“ oder „Öffnen“ angetippt wurde
 */
export function ladeDateiHerunter(blob, dateiname) {
  document.querySelector('.datei-bereit')?.dispatchEvent(new CustomEvent('schliessen'));

  // Als benannte Datei anlegen – manche Browser übernehmen den Namen daraus
  const url    = URL.createObjectURL(new File([blob], dateiname, { type: blob.type }));
  const istPdf = blob.type === 'application/pdf';
  const vorher = document.activeElement;
  const nurOeffnen = istPdf && istFirefoxAndroidApp();
  // Firefox' PDF-Viewer liest den Speichernamen aus der URL (auch aus dem Fragment);
  // ohne ihn heißt die Datei „document.pdf“. Die Form „schlüssel=wert“ ignoriert der Viewer beim Blättern.
  const oeffnenUrl = istPdf ? `${url}#filename=${encodeURIComponent(dateiname)}` : url;

  const herunterladen = nurOeffnen ? '' : `<a class="btn btn-primaer" href="${url}"
    download="${escapeHtml(dateiname)}" data-ergebnis="ja">⬇ Herunterladen</a>`;
  const oeffnen = istPdf
    ? `<a class="btn ${nurOeffnen ? 'btn-primaer' : 'btn-sekundaer'}" href="${oeffnenUrl}" target="_blank"
        rel="noopener" data-ergebnis="ja">📄 ${nurOeffnen ? 'PDF öffnen' : 'Im Browser öffnen'}</a>`
    : '';

  const fenster = document.createElement('div');
  fenster.className = 'modal-hintergrund offen datei-bereit';
  fenster.innerHTML = `
    <div class="modal-blatt" role="dialog" aria-modal="true" aria-labelledby="dateiBereitTitel">
      <div class="modal-griff" aria-hidden="true"></div>
      <h2 class="modal-titel" id="dateiBereitTitel">Datei ist fertig</h2>
      <p class="modal-untertitel datei-bereit__name">${escapeHtml(dateiname)} · ${formatiereGroesse(blob.size)}</p>
      ${nurOeffnen
        ? '<p class="datei-bereit__tipp">Die PDF öffnet sich in Firefox. Dort über das Download-Symbol ⬇ speichern.</p>'
        : ''}
      <div class="modal-aktionen datei-bereit__aktionen">
        ${herunterladen}${oeffnen}
        <button type="button" class="btn btn-sekundaer" data-ergebnis="nein">Abbrechen</button>
      </div>
    </div>`;

  return new Promise((resolve) => {
    let fertig = false;
    const schliessen = (ergebnis) => {
      if (fertig) return;
      fertig = true;
      document.body.classList.remove('modal-offen');
      // Erst nach dem Klick entfernen, damit der Browser den Link noch ausführt
      setTimeout(() => fenster.remove(), 400);
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
      vorher?.focus?.({ preventScroll: true });
      resolve(ergebnis);
    };

    fenster.addEventListener('click', (e) => {
      const ziel = e.target.closest('[data-ergebnis]');
      if (ziel) schliessen(ziel.dataset.ergebnis === 'ja');
      else if (e.target === fenster) schliessen(false);
    });
    fenster.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); schliessen(false); }
    });
    fenster.addEventListener('schliessen', () => schliessen(false));

    document.getElementById('toast')?.classList.remove('sichtbar'); // „wird erstellt …“ nicht über den Knöpfen
    document.body.appendChild(fenster);
    document.body.classList.add('modal-offen');
    fenster.querySelector('[data-ergebnis="ja"]').focus({ preventScroll: true });
  });
}

// ---------------------------------------------
// Bibliotheken bei Bedarf laden (schnellerer App-Start)
// ---------------------------------------------
const skripte = new Map();

/** Klassisches Skript nachladen und die globale Variable `globalName` liefern */
export function ladeSkript(src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (!skripte.has(src)) {
    skripte.set(src, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload  = () => resolve(window[globalName]);
      script.onerror = () => {
        skripte.delete(src);
        script.remove();
        reject(new Error('Bibliothek konnte nicht geladen werden'));
      };
      document.head.appendChild(script);
    }));
  }
  return skripte.get(src);
}

// ---------------------------------------------
// Toast
// ---------------------------------------------
let toastTimer = null;

/** Kurze Meldung unten einblenden */
export function zeigeToast(text, dauer = 2500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('sichtbar');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('sichtbar'), dauer);
}

// ---------------------------------------------
// Button-Ladezustand
// ---------------------------------------------

/** Button während einer asynchronen Aktion sperren und Spinner zeigen */
export async function mitLadezustand(btn, aktion) {
  if (!btn || btn.disabled) return;
  const vorher = btn.innerHTML;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.innerHTML = '<span class="lade-kreis" aria-hidden="true"></span><span class="visuell-versteckt">Bitte warten …</span>';
  try {
    return await aktion();
  } finally {
    // Button kann inzwischen durch Neu-Rendern ersetzt worden sein
    if (btn.isConnected) {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.innerHTML = vorher;
    }
  }
}

// ---------------------------------------------
// Aktionen (Event-Delegation statt Inline-Handler → CSP-tauglich)
// ---------------------------------------------
const aktionen = new Map();

/** Handler für data-aktion="…" registrieren */
export function registriereAktionen(objekt) {
  for (const [name, handler] of Object.entries(objekt)) aktionen.set(name, handler);
}

export function aktionFuer(name) {
  return aktionen.get(name);
}

/** App-weit melden, dass sich Daten geändert haben */
export function meldeDatenAenderung() {
  document.dispatchEvent(new CustomEvent('daten-geaendert'));
}

/** Zu einer Ansicht wechseln (Hash-Routing → Zurück-Taste funktioniert) */
export function navigiere(view) {
  if (location.hash === `#${view}`) {
    document.dispatchEvent(new CustomEvent('ansicht-rendern'));
  } else {
    location.hash = view;
  }
}
