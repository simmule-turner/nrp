"use strict";
/* NRP service worker.
   Only responsibility: make the app shell (index.html) available offline.
   All Miniflux / NewsBlur / Wallabag / Readeck / image traffic is
   cross-origin and is deliberately left untouched here -- it's handled by
   the app's own IndexedDB cache, not by this file. */

// Bump this whenever index.html (or this file) changes and you want
// clients to pick up the update. This is what drives cache invalidation:
// CACHE_NAME is derived from it, so a version bump builds a fresh cache
// under a brand new name. install() only deletes nothing and activate()
// only removes OTHER (old-versioned) caches once the new one has fully,
// successfully populated -- so a partial/failed cache.addAll() can never
// leave clients with a mix of old and new shell files under one name, the
// way overwriting a single fixed cache name in place could.
const SW_VERSION = "4";
const CACHE_NAME = `nrp-shell-v${SW_VERSION}`;
const SHELL_URLS = ["./", "./index.html"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_URLS))
    // Deliberately NOT calling self.skipWaiting() here. A newly installed
    // worker sits in "waiting" state until the page explicitly tells it to
    // take over (see the message listener below) -- so an update never
    // silently yanks the app out from under someone mid-read. The app's
    // registration code prompts the user and only sends that message once
    // they've agreed.
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Sent by the page once the user has agreed to update (see the
// "Update available" prompt in index.html's registration code). Only then
// does this worker actually activate and start serving.
self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // never intercept API/image traffic
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
