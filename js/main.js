// =============================================
// VereinsAuslagen (Mehrbenutzer) – Einstiegspunkt
// Ablauf: Serverstatus laden → Einrichtung/Anmeldung → Daten laden → App
// Routing (Hash), Event-Delegation, Tastenkürzel
// =============================================
import {
  aktionFuer, registriereAktionen, zeigeToast, navigiere, escapeHtml, mitLadezustand, meldeDatenAenderung
} from './hilfen.js';
import { aktualisiereVomServer, leereSpeicher } from './speicher.js';
import { ladeStatus, aktuellerBenutzer, anzeigeName, hatKassenrolle } from './sitzung.js';
import { anmeldeSchritt, rendereAnmeldeSchritt } from './ansicht-anmeldung.js';
import { rendereNeu } from './ansicht-neu.js';
import { rendereUebersicht } from './ansicht-uebersicht.js';
import { rendereExport } from './ansicht-export.js';
import { rendereProfil, vergissProfilZustand } from './ansicht-profil.js';
import { rendereKasse, vergissKassenDaten, aktualisiereKasse } from './ansicht-kasse.js';
import { vergissKommentare, veraltenVerlaeufe } from './kommentare.js';
import { vergissKlappZustand } from './klappen.js';
import { apiGet } from './api.js';
import { initDetail, istDetailOffen, schliesseDetail } from './detail.js';
import { initPWA } from './pwa.js';
import './einreichen.js';
import './stammdaten.js';

const ANSICHTEN = {
  neu:        rendereNeu,
  uebersicht: rendereUebersicht,
  export:     rendereExport,
  kasse:      rendereKasse,
  profil:     rendereProfil
};

const container = document.getElementById('hauptInhalt');
let aktuelleAnsicht = null;
let appBereit = false; // angemeldet und Daten geladen

// ---------------------------------------------
// Routing
// ---------------------------------------------
function ansichtAusHash() {
  const name = location.hash.slice(1);
  // Nur eigene Einträge – sonst würden z. B. #__proto__ oder #constructor durchrutschen
  if (!Object.hasOwn(ANSICHTEN, name)) return 'neu';
  if (name === 'kasse' && !hatKassenrolle()) return 'neu';
  return name;
}

function rendereAnsicht({ nachOben = false } = {}) {
  document.body.classList.toggle('ohne-anmeldung', !appBereit);
  if (!appBereit) {
    aktuelleAnsicht = null;
    rendereAnmeldeSchritt(container);
    return;
  }

  const name = ansichtAusHash();
  const wechsel = name !== aktuelleAnsicht;
  aktuelleAnsicht = name;

  for (const btn of document.querySelectorAll('.nav-btn')) {
    if (btn.dataset.view === name) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }

  ANSICHTEN[name](container);
  if (wechsel || nachOben) window.scrollTo({ top: 0, behavior: 'instant' });
}

window.addEventListener('hashchange', () => rendereAnsicht({ nachOben: true }));
document.addEventListener('ansicht-rendern', () => rendereAnsicht());

// Nach Datenänderungen die sichtbare Ansicht aktualisieren.
// Das Formular „Neu“ wird nicht neu gerendert, damit Eingaben und Fokus erhalten bleiben.
document.addEventListener('daten-geaendert', () => {
  if (appBereit && aktuelleAnsicht !== 'neu') rendereAnsicht();
});

// ---------------------------------------------
// Anmeldung & Sitzung
// ---------------------------------------------
async function weiterNachStatus() {
  if (anmeldeSchritt()) {
    appBereit = false;
    leereSpeicher();
    if (istDetailOffen()) schliesseDetail();
  } else {
    try {
      await aktualisiereVomServer();
    } catch (err) {
      zeigeToast(`⚠ ${err.message}`, 5000);
    }
    appBereit = !anmeldeSchritt(); // Sitzung kann währenddessen abgelaufen sein
  }
  aktualisiereKopf();
  aktualisiereHinweise();
  rendereAnsicht({ nachOben: true });
}

document.addEventListener('angemeldet', weiterNachStatus);
document.addEventListener('anmelde-schritt', weiterNachStatus);
function vergissSitzungsDaten() {
  vergissProfilZustand();
  vergissKassenDaten();
  vergissKommentare();
  vergissKlappZustand();
}

document.addEventListener('abgemeldet', () => {
  vergissSitzungsDaten();
  weiterNachStatus();
});

// Server meldet 401 (Sitzung abgelaufen, Passwort anderswo geändert, Konto gesperrt …)
document.addEventListener('nicht-angemeldet', async () => {
  if (!appBereit) return;
  appBereit = false;
  zeigeToast('Sitzung beendet – bitte erneut anmelden', 5000);
  await ladeStatus().catch(() => {});
  vergissSitzungsDaten();
  weiterNachStatus();
});

document.addEventListener('benutzer-geaendert', () => {
  aktualisiereKopf();
  if (appBereit && aktuelleAnsicht === 'profil') rendereAnsicht();
});

// Beim Zurückkehren in die App Änderungen von anderen Geräten holen
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !appBereit) return;
  try {
    await aktualisiereVomServer();
    veraltenVerlaeufe();
    document.dispatchEvent(new CustomEvent('daten-geaendert'));
    aktualisiereHinweise();
  } catch { /* offline o. Ä. – beim nächsten Mal */ }
});

// ---------------------------------------------
// Hinweis-Punkte an der Navigation: ungelesene Kommentare (eigene Einreichungen bzw. Kasse)
// ---------------------------------------------
async function aktualisiereHinweise() {
  const setze = (el, anzahl) => {
    if (!el) return;
    el.classList.toggle('nav-btn--hinweis', anzahl > 0);
    if (anzahl > 0) el.title = `${anzahl} ungelesene Kommentare`;
    else el.removeAttribute('title');
  };
  if (!appBereit) return;
  try {
    const { eigene, kasse } = await apiGet('kommentare/ungelesen');
    setze(document.querySelector('.nav-btn[data-view="uebersicht"]'), eigene);
    setze(document.getElementById('navKasse'), kasse);
  } catch { /* nicht kritisch */ }
}
document.addEventListener('hinweise-aktualisieren', aktualisiereHinweise);

function aktualisiereKopf() {
  const untertitel = document.getElementById('kopfzeileUntertitel');
  const b = aktuellerBenutzer();
  untertitel.textContent = b && appBereit ? `Angemeldet als ${anzeigeName(b)}` : 'Ausgabenverwaltung';
  document.getElementById('navKasse').hidden = !(appBereit && hatKassenrolle());
  document.getElementById('aktualisierenKnopf').hidden = !appBereit;
}

// ---------------------------------------------
// Event-Delegation (keine Inline-Handler → strikte CSP möglich)
// ---------------------------------------------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-aktion]');
  if (!el || el.disabled) return;
  const handler = aktionFuer(el.dataset.aktion);
  if (handler) handler(el, e);
});

document.addEventListener('change', (e) => {
  const aktion = e.target.dataset?.dateiAktion;
  if (!aktion) return;
  aktionFuer(aktion)?.(e.target, e);
});

// Formulare mit data-formular="x" → Handler "formular:x"
document.addEventListener('submit', (e) => {
  const form = e.target.closest?.('form[data-formular]');
  if (!form) return;
  e.preventDefault();
  aktionFuer(`formular:${form.dataset.formular}`)?.(form, e);
});

registriereAktionen({
  navigiere: (btn) => navigiere(btn.dataset.view),
  'design-wechseln': () => {
    const design = window.VADesign;
    if (!design) return;
    const { WAHLEN } = design;
    const neu = WAHLEN[(WAHLEN.indexOf(design.holeWahl()) + 1) % WAHLEN.length];
    design.setzeWahl(neu);
    zeigeToast(`Farbschema: ${DESIGN_NAMEN[neu]}`);
  },
  'erneut-laden': () => starte(),

  /** Kopfzeile: eigene Daten, Kasse und Verläufe frisch vom Server – in jeder Ansicht */
  aktualisieren: (btn) => mitLadezustand(btn, async () => {
    try {
      await aktualisiereVomServer();
      veraltenVerlaeufe();
      if (hatKassenrolle()) await aktualisiereKasse();
      zeigeToast('✓ Aktualisiert');
    } catch (err) {
      zeigeToast(`⚠ ${err.message}`, 5000);
    }
    aktualisiereHinweise();
    meldeDatenAenderung();
  })
});

// ---------------------------------------------
// Farbschema-Umschalter (Logik in design.js, läuft vor dem ersten Zeichnen)
// ---------------------------------------------
const DESIGN_NAMEN = { system: 'wie System', light: 'Hell', dark: 'Dunkel' };

function aktualisiereDesignKnopf() {
  const btn  = document.getElementById('designUmschalter');
  const wahl = window.VADesign?.holeWahl() || 'system';
  if (!btn) return;
  btn.setAttribute('aria-label', `Farbschema: ${DESIGN_NAMEN[wahl]} – tippen zum Wechseln`);
  btn.title = `Farbschema: ${DESIGN_NAMEN[wahl]}`;
}
document.addEventListener('design-geaendert', aktualisiereDesignKnopf);

// ---------------------------------------------
// Tastenkürzel (Desktop)
// ---------------------------------------------
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && istDetailOffen()) {
    schliesseDetail();
    return;
  }
  if (!appBereit || !e.altKey || e.ctrlKey || e.metaKey || istDetailOffen()) return;
  const ziel = { 1: 'neu', 2: 'uebersicht', 3: 'export', 4: 'profil', 5: hatKassenrolle() ? 'kasse' : null }[e.key];
  if (ziel) {
    e.preventDefault();
    navigiere(ziel);
  }
});

// ---------------------------------------------
// Start
// ---------------------------------------------
async function starte() {
  document.body.classList.add('ohne-anmeldung');
  container.innerHTML = '<div class="ansicht"><p class="lade-hinweis">Verbinde mit dem Server …</p></div>';
  try {
    await ladeStatus();
  } catch (err) {
    container.innerHTML = `
      <div class="ansicht">
        <div class="leer-zustand">
          <div class="leer-zustand__icon" aria-hidden="true">🔌</div>
          <div class="leer-zustand__titel">Server nicht erreichbar</div>
          <div class="leer-zustand__text">${escapeHtml(err.message)}<br>
            Die App braucht eine Internetverbindung und einen Webserver mit PHP 8.1+.</div>
        </div>
        <button type="button" class="btn btn-primaer" data-aktion="erneut-laden">Erneut versuchen</button>
      </div>`;
    return;
  }
  await weiterNachStatus();
}

initDetail();
aktualisiereDesignKnopf();
starte();
initPWA();
