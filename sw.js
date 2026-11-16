/*
 * Service worker for the hosted dashboard (registered by js/online.js once someone is signed in).
 * It keeps a copy of the app's files, the uni data and the last headlines on the device, so the
 * app opens at once and without a connection. Sync of the user's data stays in js/online.js.
 *
 * Files are answered from the copy and refreshed in the background.
 * shortcut: after a deploy one launch can run the previous version, and a refresh that only
 * partly succeeds can mix file versions for one launch; add a versioned cache if that ever bites.
 */
'use strict';

var SHELL = 'pd-shell'; // the app's own files and the "/" page
var DATA = 'pd-data';   // the signed-in user's uni data and headlines; js/online.js and js/login.js delete it

// Every file the app loads, including the ones it loads late. server/test/static.test.mjs checks
// that each one exists and is served: a single miss fails the install and offline never turns on.
var FILES = [
  '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png',
  '/fonts/Geist-Variable.woff2', '/fonts/GeistMono-Variable.woff2',
  '/css/tokens.css', '/css/app.css', '/css/online.css', '/css/tutor.css',
  '/js/online.js', '/js/store.js', '/js/core.js', '/js/app.js', '/js/tabs.js', '/js/tooltip.js', '/js/tutor.js',
  '/js/modules/uni.js', '/js/modules/meals.js', '/js/modules/news.js',
  '/modules/meals/meals.js', '/modules/meals/meals.css',
  '/modules/workouts/workouts.css', '/modules/workouts/insights.css', '/modules/workouts/exercises.js',
  '/modules/workouts/workouts.js', '/modules/workouts/insights.js', '/modules/workouts/transfer.js',
  '/modules/workouts/register.js', '/modules/workouts/exercise-howto.js',
  '/modules/uni/panel.js', '/modules/news/news-panel.js'
];

// Only this server's own, direct answers are kept. Every answer of server/server.mjs carries the
// policy header; a host's "waking up" page or a redirect to the sign-in page does not qualify.
function ours(res) {
  return res.status === 200 && !res.redirected && res.headers.has('content-security-policy');
}

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) {
    return Promise.all(FILES.map(function (f) {
      return fetch(f, { cache: 'no-cache' }).then(function (res) {
        if (!ours(res)) throw new Error('not served: ' + f);
        return c.put(f, res);
      });
    })).then(function () {
      // The page itself: only a signed-in answer is the app (signed out, "/" redirects).
      return fetch('/', { cache: 'no-cache' }).then(function (res) { return ours(res) ? c.put('/', res) : null; }, function () {});
    });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', function (e) {
  var req = e.request;
  var url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  var p = url.pathname === '/index.html' ? '/' : url.pathname;
  var news = p === '/api/news';
  var data = news || p === '/modules/uni/data/uni.js';
  // Everything else under these paths is live, per-user or about signing in: never from a copy.
  if (!data && (p.indexOf('/api/') === 0 || p.indexOf('/modules/uni/data/') === 0 || p === '/login' || p === '/login.html' || p === '/sw.js')) return;

  e.respondWith(caches.open(data ? DATA : SHELL).then(function (c) {
    return c.match(p).then(function (hit) {
      var fresh = fetch(req).then(function (res) {
        return ours(res) ? c.put(p, res.clone()).then(function () { return res; }) : res;
      });
      // Headlines: the newest when there is a connection, the last ones seen when there is none.
      if (news) return fresh.catch(function (err) { if (hit) return hit; throw err; });
      if (!hit) return fresh;
      e.waitUntil(fresh.catch(function () {})); // a slow answer still lands, for the next launch
      return hit;
    });
  }));
});
