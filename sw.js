// =============================================
// VereinsAuslagen (Mehrbenutzer) – Service Worker
// Strategie: App-Shell wird bei der Installation vorab gecacht (Cache-First).
// Daten kommen immer live vom Server: Anfragen an api/ werden nie gecacht.
// Ein Update entsteht durch Erhöhen von VERSION; die App zeigt dann einen „Aktualisieren“-Hinweis.
// =============================================
const VERSION = '3.1.0';
const CACHE   = `vereinsauslagen-mu-${VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/fonts.css',
  './js/design.js',
  './js/main.js',
  './js/api.js',
  './js/sitzung.js',
  './js/webauthn.js',
  './js/ansicht-anmeldung.js',
  './js/ansicht-profil.js',
  './js/hilfen.js',
  './js/speicher.js',
  './js/bild.js',
  './js/beleg-ui.js',
  './js/ansicht-neu.js',
  './js/ansicht-uebersicht.js',
  './js/ansicht-export.js',
  './js/ansicht-kasse.js',
  './js/export.js',
  './js/pdf.js',
  './js/einreichen.js',
  './js/stammdaten.js',
  './js/detail.js',
  './js/pwa.js',
  './vendor/jszip.min.js',
  './vendor/pdf-lib.min.js',
  './vendor/qrcode.js',
  './fonts/atkinson-next-latin.woff2',
  './fonts/atkinson-next-latin-ext.woff2',
  './favicon.ico',
  './app-icons/favicon-16.png',
  './app-icons/favicon-32.png',
  './app-icons/favicon-48.png',
  './app-icons/icon-192.png',
  './app-icons/icon-512.png',
  './app-icons/icon-maskable-192.png',
  './app-icons/icon-maskable-512.png',
  './app-icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  // cache: 'reload' umgeht den HTTP-Cache, damit wirklich die neue Version landet
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' })))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((schluessel) => Promise.all(
        schluessel
          .filter((k) => k.startsWith('vereinsauslagen-mu-') && k !== CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Vom Nutzer bestätigtes Update sofort aktivieren; Versionsabfrage fürs Profil
self.addEventListener('message', (event) => {
  if (event.data?.typ === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.typ === 'VERSION') event.ports[0]?.postMessage({ version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Server-API nie aus dem Cache bedienen (Daten sind benutzerbezogen und live)
  if (url.pathname.startsWith(new URL('./api/', self.location).pathname)) return;

  // Seitenaufrufe (auch mit ?source=… oder #hash) → App-Shell
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html', { ignoreSearch: true })
        .then((antwort) => antwort || fetch(request))
        .catch(() => fetch(request))
    );
    return;
  }

  // Statische Dateien: Cache zuerst, sonst Netz (und für später ablegen)
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((treffer) => {
      if (treffer) return treffer;
      return fetch(request).then((antwort) => {
        if (antwort.ok && antwort.type === 'basic') {
          const kopie = antwort.clone();
          caches.open(CACHE).then((cache) => cache.put(request, kopie));
        }
        return antwort;
      });
    })
  );
});
