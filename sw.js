// Välimuisti: sovellus toimii myös ilman verkkoa mökillä.
const VERSION = "kalakartta-v6";
const TILES = "kalakartta-tiilet";   // MML:n karttatiilet omassa välimuistissaan, säilyy versiopäivitysten yli
const MAX_TILES = 6000;
const SHELL = ["./", "index.html", "css/app.css", "js/app.js", "js/proj.js", "js/shp.js", "js/store.js", "js/weather.js", "js/astro.js", "js/model.js", "js/hotspots.js", "js/config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
let trimming = false;
async function trimTiles(c) {
  if (trimming) return; trimming = true;
  try { const ks = await c.keys(); if (ks.length > MAX_TILES) for (const k of ks.slice(0, ks.length - MAX_TILES + 500)) await c.delete(k); } finally { trimming = false; }
}
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.hostname.includes("open-meteo.com")) return; // sää: sovellus hoitaa oman välimuistinsa
  if (url.hostname.endsWith("maanmittauslaitos.fi")) {   // karttatiilet: välimuisti ensin
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const r = await fetch(req);
      if (r.ok) { c.put(req, r.clone()).then(() => trimTiles(c)); }
      return r;
    }));
    return;
  }
  if (url.origin === location.origin && url.pathname.endsWith("/data/layers.json")) {
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); return r; }).catch(() => caches.match(req)));
    return;
  }
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r.ok || r.type === "opaque") { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
