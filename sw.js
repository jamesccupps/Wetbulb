/* Service worker for the Wet-Bulb Calculator.
   Caches the static shell for offline use. Weather/geocoding API calls are
   cross-origin and always go straight to the network — never cached, so a
   reading is never silently stale. HTML is network-first, and same-origin
   assets are stale-while-revalidate: served instantly from cache but refreshed
   in the background, so a redeploy self-heals on the next load without needing
   a build step. Bumping VERSION forces an immediate full refresh. */
'use strict';

var VERSION = 'wetbulb-v1';
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

function put(req, res) { if (res && res.ok) caches.open(VERSION).then(function (c) { c.put(req, res); }); }

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;              // let API calls pass through

  if (req.mode === 'navigate') {                                // network-first HTML
    e.respondWith(
      fetch(req).then(function (r) { put(req, r.clone()); return r; })
        .catch(function () { return caches.match(req).then(function (m) { return m || caches.match('./index.html'); }); })
    );
    return;
  }
  e.respondWith(                                                // stale-while-revalidate assets
    caches.match(req).then(function (m) {
      var net = fetch(req).then(function (r) { put(req, r.clone()); return r; }).catch(function () { return m; });
      return m || net;                                         // cache now, refresh for next load
    })
  );
});
