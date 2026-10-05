// =============================================
// PWA: Service Worker, Updates, Installation
// Die Versionsnummer steht nur in sw.js (VERSION); laufende und wartende Version werden
// per MessageChannel beim jeweiligen Worker erfragt und über „version-geaendert“ gemeldet.
// =============================================
import { zeigeToast, registriereAktionen } from './hilfen.js';

const LS_INSTALL_AUSGEBLENDET = 'va_install_ausgeblendet';
const INSTALL_PAUSE_TAGE = 14;
const CACHE_PRAEFIX = 'vereinsauslagen-mu-';

let installAufforderung = null;
let wartenderWorker     = null;
let updateAngefordert   = false;
let versionLaufend      = null;   // Version der App, die gerade läuft
let versionNeu          = null;   // Version des wartenden Updates
let versionErmittelt    = false;

const istStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const istIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ---------------------------------------------
// Service Worker & Updates
// ---------------------------------------------
async function registriereServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext) {
    console.warn('[VereinsAuslagen] Service Worker benötigt HTTPS oder localhost – Offline-Modus deaktiviert.');
    return;
  }

  // Nach einem vom Nutzer bestätigten Update einmalig neu laden
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateAngefordert) location.reload();
  });

  try {
    const registrierung = await navigator.serviceWorker.register('./sw.js');

    if (registrierung.waiting && navigator.serviceWorker.controller) {
      await zeigeUpdateHinweis(registrierung.waiting);
    }
    registrierung.addEventListener('updatefound', () => {
      const neuerWorker = registrierung.installing;
      neuerWorker?.addEventListener('statechange', () => {
        if (neuerWorker.state === 'installed' && navigator.serviceWorker.controller) {
          zeigeUpdateHinweis(neuerWorker);
        }
      });
    });

    // Beim Zurückkehren in die App nach Updates suchen
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registrierung.update().catch(() => {});
    });
  } catch (err) {
    console.warn('[VereinsAuslagen] Service Worker konnte nicht registriert werden:', err);
  }
}

async function zeigeUpdateHinweis(worker) {
  wartenderWorker = worker;
  document.getElementById('updateBanner').hidden = false;
  meldeVersion();
  versionNeu = await frageVersion(worker);
  meldeVersion();
}

// ---------------------------------------------
// Versionsanzeige (Profil)
// ---------------------------------------------
function meldeVersion() {
  document.dispatchEvent(new CustomEvent('version-geaendert'));
}

function frageVersion(worker) {
  return new Promise((resolve) => {
    const kanal = new MessageChannel();
    // Worker vor 3.0.6 kennen die Abfrage nicht und antworten nie
    const zeitlimit = setTimeout(() => resolve(null), 2000);
    kanal.port1.onmessage = (e) => {
      clearTimeout(zeitlimit);
      resolve(typeof e.data?.version === 'string' ? e.data.version : null);
    };
    worker.postMessage({ typ: 'VERSION' }, [kanal.port2]);
  });
}

// Rückfall für ältere Worker: Cache-Name enthält die Version (der des Updates zählt nicht)
async function versionAusCache() {
  try {
    const versionen = (await caches.keys())
      .filter((k) => k.startsWith(CACHE_PRAEFIX))
      .map((k) => k.slice(CACHE_PRAEFIX.length))
      .filter((v) => v !== versionNeu);
    return versionen.length === 1 ? versionen[0] : null;
  } catch {
    return null;
  }
}

// Ohne Service Worker kommt alles direkt vom Server – dessen sw.js nennt also die laufende Version
async function versionAusSkript() {
  try {
    const antwort = await fetch('./sw.js', { cache: 'no-store' });
    return (await antwort.text()).match(/const VERSION\s*=\s*'([^']+)'/)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function ermittleLaufendeVersion() {
  const controller = navigator.serviceWorker?.controller;
  versionLaufend = controller
    ? (await frageVersion(controller)) ?? (await versionAusCache())
    : await versionAusSkript();
  versionErmittelt = true;
  meldeVersion();
}

export function versionsInfo() {
  return { laufend: versionLaufend, neu: versionNeu, ermittelt: versionErmittelt, updateBereit: !!wartenderWorker };
}

// ---------------------------------------------
// Installations-Hinweis
// ---------------------------------------------
function installHinweisPausiert() {
  try {
    const zeitpunkt = Number(localStorage.getItem(LS_INSTALL_AUSGEBLENDET) || 0);
    return Date.now() - zeitpunkt < INSTALL_PAUSE_TAGE * 86_400_000;
  } catch {
    return false;
  }
}

function blendeInstallHinweisAus() {
  document.getElementById('installBanner').hidden = true;
}

function richteInstallationEin() {
  if (istStandalone()) return;

  // Chrome, Edge, Samsung Internet …
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installAufforderung = e;
    if (!installHinweisPausiert()) {
      document.getElementById('installBtn').hidden = false;
      document.getElementById('installBanner').hidden = false;
    }
  });

  window.addEventListener('appinstalled', () => {
    installAufforderung = null;
    blendeInstallHinweisAus();
    zeigeToast('✓ App erfolgreich installiert!');
  });

  // iOS/iPadOS kennt kein beforeinstallprompt → Anleitung zeigen
  if (istIOS() && !installHinweisPausiert()) {
    document.getElementById('installText').textContent =
      'In Safari auf „Teilen“ tippen und „Zum Home-Bildschirm“ wählen.';
    document.getElementById('installBtn').hidden = true;
    document.getElementById('installBanner').hidden = false;
  }
}

registriereAktionen({
  'installieren': async () => {
    if (!installAufforderung) return;
    installAufforderung.prompt();
    const { outcome } = await installAufforderung.userChoice;
    installAufforderung = null;
    if (outcome === 'accepted') blendeInstallHinweisAus();
  },

  'install-ausblenden': () => {
    blendeInstallHinweisAus();
    try { localStorage.setItem(LS_INSTALL_AUSGEBLENDET, String(Date.now())); } catch { /* egal */ }
  },

  'update-installieren': () => {
    if (!wartenderWorker) { location.reload(); return; }
    updateAngefordert = true;
    wartenderWorker.postMessage({ typ: 'SKIP_WAITING' });
  }
});

export function initPWA() {
  richteInstallationEin();
  registriereServiceWorker().finally(ermittleLaufendeVersion);
}
