// El marcador de versión de la línea siguiente se sustituye en el build por la versión de package.json:
// al subirla, el navegador detecta un sw.js distinto, lo instala y borra las cachés de versiones anteriores.
const CACHE = 'euribor-hipoteca-v__APP_VERSION__';
const BASE = '/euribor-hipoteca/';
const PRECACHE = [BASE, `${BASE}index.html`];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Solo cachea GET de recursos propios y las fuentes; Firebase y demás APIs pasan directas.
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  const isOwn = url.startsWith(self.location.origin);
  const isFont = url.startsWith('https://fonts.googleapis.com') || url.startsWith('https://fonts.gstatic.com');
  if (!isOwn && !isFont) return;

  // Red primero para no servir versiones obsoletas; la caché solo es el respaldo sin conexión.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy).catch(() => {}));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
