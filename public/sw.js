/* Maps -> GPX service worker
 * - Caches the app shell so the PWA loads offline.
 * - Intercepts POSTs to /share-target and rewrites them as GETs to / with prefilled query.
 * - Always passes /api/* through to the network (no caching of conversions).
 */
const CACHE = 'maps-gpx-v1';
const APP_SHELL = ['/', '/index.html', '/app.js', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(handleShareTarget(req));
    return;
  }

  if (url.pathname.startsWith('/api/')) return; // network only

  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req)
          .then((res) => {
            if (res && res.status === 200 && url.origin === location.origin) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => caches.match('/'))
    )
  );
});

async function handleShareTarget(req) {
  try {
    const form = await req.formData();
    const text = form.get('text') || '';
    const url = form.get('url') || '';
    const title = form.get('title') || '';
    const combined = [url, text, title].filter(Boolean).join('\n');
    const target = '/?shared=' + encodeURIComponent(combined) + '&auto=1';
    return Response.redirect(target, 303);
  } catch (e) {
    return Response.redirect('/', 303);
  }
}
