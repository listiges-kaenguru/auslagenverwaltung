// =============================================
// PWA: Service Worker, Updates, Installation
// =============================================
import { zeigeToast, registriereAktionen } from './hilfen.js';

const LS_INSTALL_AUSGEBLENDET = 'va_install_ausgeblendet';
const INSTALL_PAUSE_TAGE = 14;

let installAufforderung = null;
let wartenderWorker     = null;
let updateAngefordert   = false;

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
      zeigeUpdateHinweis(registrierung.waiting);
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

function zeigeUpdateHinweis(worker) {
  wartenderWorker = worker;
  document.getElementById('updateBanner').hidden = false;
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
  registriereServiceWorker();
}
