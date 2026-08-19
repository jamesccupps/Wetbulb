/* Service worker for the Wet-Bulb Calculator.
   Caches the static shell for offline use. Weather/geocoding API calls are
   cross-origin and always go straight to the network — never cached, so a
   reading is never silently stale. HTML is network-first, and same-origin
   assets are stale-while-revalidate: served instantly from cache but refreshed
   in the background, so a redeploy self-heals on the next load without needing
   a build step. Bumping VERSION forces an immediate full refresh. */
'use strict';

var VERSION = 'wetbulb-v2';
var SHELL = [
  './', './index.html', './css/styles.css',
  './js/psychro.js', './js/app.js',
  './manifest.webmanifest', './assets/icon.svg', './assets/icon-maskable.svg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function put(req, res) {
  if (!res || !res.ok) return Promise.resolve();
  return caches.open(VERSION).then(function (c) { return c.put(req, res); });
}

// Last resort so respondWith() always settles with a real Response. Resolving it
// with undefined (cold cache + offline) surfaces as an opaque network error with
// no diagnostic, which is worse than an explicit one.
function offlineResponse() {
  return new Response('', { status: 504, statusText: 'Offline and not cached' });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;              // let API calls pass through

  if (req.mode === 'navigate') {                                // network-first HTML
    e.respondWith(
      fetch(req).then(function (r) {
        e.waitUntil(put(req, r.clone()));
        return r;
      }).catch(function () {
        return caches.match(req).then(function (m) {
          return m || caches.match('./index.html').then(function (i) { return i || offlineResponse(); });
        });
      })
    );
    return;
  }
  e.respondWith(                                                // stale-while-revalidate assets
    caches.match(req).then(function (m) {
      var net = fetch(req).then(function (r) {
        return put(req, r.clone()).then(function () { return r; });
      }).catch(function () { return m || offlineResponse(); });
      // Hold the SW alive for the background refresh. This has to be registered
      // here, while respondWith's promise is still pending and the event is
      // therefore still active — moving it inside net's .then() would run after
      // respondWith already settled with the cached copy and throw
      // InvalidStateError. Without it the worker can be killed the moment the
      // cached copy is handed back, so a redeploy never self-heals.
      e.waitUntil(net);
      return m || net;                                         // cache now, refresh for next load
    })
  );
});
