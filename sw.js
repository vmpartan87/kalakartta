// Välimuisti: sovellus toimii myös ilman verkkoa mökillä.
// Päivitysperiaate: sovelluksen omat tiedostot haetaan verkosta aina kun verkko toimii (välimuisti vain varalla),
// joten uusi versio näkyy heti. Nosta VERSION (ja js/config.js:n APP_VERSION) aina kun tiedostot muuttuvat.
const VERSION = "kalakartta-v7";
const TILES = "kalakartta-tiilet";   // MML:n karttatiilet omassa välimuistissaan, säilyy versiopäivitysten yli
const MAX_TILES = 6000;
const SHELL = ["./", "index.html", "css/app.css", "js/app.js", "js/proj.js", "js/shp.js", "js/store.js", "js/weather.js", "js/astro.js", "js/model.js", "js/hotspots.js", "js/config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

// cache: "reload" ohittaa selaimen HTTP-välimuistin (GitHub Pages: max-age 10 min), jotta asennus saa varmasti uudet tiedostot.
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

let trimming = false;
async function trimTiles(c) {
  if (trimming) return; trimming = true;
  try { const ks = await c.keys(); if (ks.length > MAX_TILES) for (const k of ks.slice(0, ks.length - MAX_TILES + 500)) await c.delete(k); } finally { trimming = false; }
}
const put = (req, r) => { if (r && (r.ok || r.type === "opaque")) { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); } return r; };

// Verkko ensin, aikaraja 4 s; jos verkko ei vastaa, välimuisti.
function networkFirst(req) {
  return new Promise(resolve => {
    let done = false;
    const fromCache = () => caches.match(req, { ignoreSearch: true }).then(hit => hit);
    const timer = setTimeout(() => fromCache().then(hit => { if (hit && !done) { done = true; resolve(hit); } }), 4000);
    fetch(req, { cache: "no-cache" }).then(r => { clearTimeout(timer); put(req, r); if (!done) { done = true; resolve(r); } })
      .catch(() => { clearTimeout(timer); fromCache().then(hit => { if (!done) { done = true; resolve(hit || Response.error()); } }); });
  });
}
// Välimuisti ensin, päivitys taustalla (isot datatiedostot, fontit, kirjastot).
function staleWhileRevalidate(req) {
  return caches.match(req).then(hit => {
    const net = fetch(req).then(r => put(req, r)).catch(() => hit);
    return hit || net;
  });
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
  if (url.origin === location.origin) {
    const isData = url.pathname.includes("/data/") && !url.pathname.endsWith("/data/layers.json");
    e.respondWith(isData ? staleWhileRevalidate(req) : networkFirst(req));
    return;
  }
  e.respondWith(staleWhileRevalidate(req));
});
