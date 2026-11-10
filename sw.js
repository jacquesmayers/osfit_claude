/* Service worker di OS_FIT Diario.
 * Mette in cache i file dell'app per l'apertura offline. I dati del diario NON
 * passano da qui: stanno in IndexedDB e non vengono toccati dagli aggiornamenti.
 * Ad ogni rilascio cambia VERSION (stesso valore di APP_VERSION in app.js).
 */
const VERSION = '1.4.0';
const CACHE = 'osfit-diario-' + VERSION;
const ASSETS = [
  './',
  'index.html',
  'app.js',
  'scanner.js',
  'catalog.js',
  'style.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  // cache: 'reload' evita di copiare in cache versioni vecchie dalla cache HTTP
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
  // Nessun skipWaiting automatico: la nuova versione si attiva quando l'utente tocca "Aggiorna".
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // elimina le versioni vecchie e la cache della libreria esterna usata dalla 1.1.0 (non più necessaria)
    await Promise.all(keys.filter(k => (k.startsWith('osfit-diario-') && k !== CACHE) || k.startsWith('osfit-ext-')).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // es. Open Food Facts: direttamente in rete

  if (req.mode === 'navigate') {
    // Apertura dell'app: sempre dalla cache, così funziona anche offline.
    event.respondWith(
      caches.match('index.html', { cacheName: CACHE }).then(r => r || fetch(req))
    );
    return;
  }
  event.respondWith(
    caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then(r => r || fetch(req))
  );
});
