import { TM } from "./proj.js";
import { CORE } from "./shp.js";
import { LS, IDB } from "./store.js";
import { getWeather, hourAt } from "./weather.js";
import { dayEvents, solunarPeriods, phaseName } from "./astro.js";
import { scoreHour, whereToGo, waterTemp, SPECIES as FC_SPECIES } from "./model.js";
import { findHotspots, HOT_SPECIES } from "./hotspots.js";
import { MML_KEY, APP_VERSION } from "./config.js";

/* ---------- asetukset ---------- */
const ORIGIN = [453000, 6742500];                   // karttakoordinaatiston nollapiste (ETRS-TM35FIN)
const REGION_DEFAULT = [453000, 6742500, 490000, 6778000]; // Iitti–Jaala-rajaus
const [LON, LAT] = TM.inv((REGION_DEFAULT[0] + REGION_DEFAULT[2]) / 2, (REGION_DEFAULT[1] + REGION_DEFAULT[3]) / 2);
const KINDS = { vesi: "Vesialue / ranta", alueet: "Syvyysalueet", kayrat: "Syvyyskäyrät", pisteet: "Luotauspisteet" };
const SPECIES = { kuha: "Kuha", ahven: "Ahven", molemmat: "Kuha ja ahven", hauki: "Hauki", kirjolohi: "Kirjolohi", muu: "Muu" };
const SP_KEYS = ["kuha", "ahven", "molemmat", "hauki", "kirjolohi", "muu"];
const SP_ABBR = { kuha: "K", ahven: "A", hauki: "H", kirjolohi: "Kl", molemmat: "KA", muu: "?" };
const SUGGESTIONS = [
  { n: 1, name: "Ruumisniemen edusta", sp: "kuha", note: "6 m käyrä kaartaa lähelle niemeä (6,2–6,7 m). Pudotus 3→6 m kuhalle, niemen kivikot 2–4 m ahvenelle." },
  { n: 2, name: "Hiekkaniemi – Kymijoen virta", sp: "molemmat", note: "Virtaus tuo ruokaa; virran reunoilta sekä kuhaa että ahventa." },
  { n: 3, name: "Myllyniemi – väylämerkki", sp: "kuha", note: "Tasainen 4,5–6,5 m alue. Kuhan iltavetouistelu 6 m käyrää seuraten." },
  { n: 4, name: "Keidaslahti", sp: "ahven", note: "Matala kaislalahti (2–3 m), lämpenee keväällä ensimmäisenä. Toukokuun ahvenpaikka." },
  { n: 5, name: "Niittylahti / Marlebäckin pohjoisranta", sp: "ahven", note: "Matala lahti (n. 1,9 m) kaislikon reunoineen. Kevään ahvenet." },
  { n: 6, name: "Sonnanniemen edustan pikkukari", sp: "ahven", note: "Matalikko keskellä 4,3 m vettä. Ahvenkari, kalasta reunoja." },
  { n: 7, name: "Pelinginselän syvä kieli (5,5–8,1 m)", sp: "kuha", note: "Näkyvän alueen syvin kohta. Kuhan kesä- ja syyspaikka, etenkin reunat." },
  { n: 8, name: "Ukonsaari – Pyykkiniemi", sp: "ahven", note: "Matalan reuna 2 → 3 m → syvempi. Ahventa reunalta." },
  { n: 9, name: "Sipkoivistonkärki – Eevaskivi", sp: "ahven", note: "Niemenkärki, jossa 3 m käyrä tulee lähelle rantaa. Ahventa kärjen pudotuksesta." },
  { n: 10, name: "Mankalan voimalaitoksen edusta (Kaurakoski)", sp: "kirjolohi", note: "Kirjolohi-istutusten paikka. Virran reunat, pyörteet ja niskat. Tarkista lupa-alue ja virtapaikan säännöt." }];

const $ = id => document.getElementById(id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = v => (Math.round(v * 10) / 10).toLocaleString("fi-FI");
const HOUR = 3600000, DAY = 86400000;
const wd = t => new Intl.DateTimeFormat("fi-FI", { weekday: "short" }).format(t);
const dm = t => { const d = new Date(t); return d.getDate() + "." + (d.getMonth() + 1) + "."; };
const hm = t => { const d = new Date(t); return d.getHours() + "." + String(d.getMinutes()).padStart(2, "0"); };
const midnight = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const atHour = (day, h) => { const d = new Date(day); d.setHours(h, 0, 0, 0); return d.getTime(); };
const newId = p => (p || "s") + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- tila ---------- */
const S = {
  layers: new Map(), spots: [], catches: [], vis: { vesi: true, alueet: true, kayrat: true, pisteet: true, ottipaikat: true, paikat: true, saaliit: true },
  hot: null, hotSel: null, hotPick: ["kuha", "ahven"], bg: "", mmlKey: "",
  view: null, mode: null, placing: null, sel: null, gps: null, gpsWatch: null, region: REGION_DEFAULT.slice(), pending: [], maxDepth: 12,
  weather: null, manualWater: null, fc: { sp: "kuha", day: midnight(Date.now()), hour: new Date().getHours() }
};
const W2 = (E, N) => [E - ORIGIN[0], N - ORIGIN[1]];   // absoluuttinen -> kartta

/* ---------- kartta ---------- */
const cv = $("map"), ctx = cv.getContext("2d"); let W = 0, H = 0, DPR = 1, raf = 0;
function resize() { const r = cv.getBoundingClientRect(); DPR = Math.min(window.devicePixelRatio || 1, 2.5); W = r.width; H = r.height; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); if (!S.view) fitAll(); draw(); }
function req() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
const toScr = (x, y) => [(x - S.view.cx) * S.view.s + W / 2, H / 2 - (y - S.view.cy) * S.view.s];
const toW = (X, Y) => [(X - W / 2) / S.view.s + S.view.cx, (H / 2 - Y) / S.view.s + S.view.cy];
function fitBox(b, pad = 30) { if (!W || !H) return; const w = Math.max(b[2] - b[0], 200), h = Math.max(b[3] - b[1], 200); S.view = { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, s: Math.min((W - pad * 2) / w, (H - pad * 2) / h) }; saveView(); }
function dataBox() { let b = null; for (const L of S.layers.values()) { if (!L.box) continue; b = b ? [Math.min(b[0], L.box[0]), Math.min(b[1], L.box[1]), Math.max(b[2], L.box[2]), Math.max(b[3], L.box[3])] : L.box.slice(); } return b; }
function fitAll() { const b = dataBox(); if (b) fitBox(b); else { const R = S.region; fitBox([R[0] - ORIGIN[0], R[1] - ORIGIN[1], R[2] - ORIGIN[0], R[3] - ORIGIN[1]]); } req(); }
let saveT = 0; function saveView() { clearTimeout(saveT); saveT = setTimeout(() => LS.set("view", S.view), 400); }
function hex2rgb(h) { h = h.replace("#", ""); if (h.length === 3) h = h.split("").map(c => c + c).join(""); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function mix(a, b, t) { const A = hex2rgb(a), B = hex2rgb(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`; }
function depthColor(d) { let t = Math.max(0, Math.min(1, (d || 0) / S.maxDepth)); return mix(css("--w0") || "#D3ECF4", css("--w1") || "#123F63", Math.pow(t, .75)); }
const spColor = sp => css("--" + (SP_KEYS.includes(sp) ? sp : "muu"));
function buildLegend() { const steps = 6, mx = S.maxDepth; for (const [bar, nums] of [["legendBar", "legendNums"], ["legendBar2", "legendNums2"]]) { const B = $(bar), N = $(nums); B.innerHTML = ""; N.innerHTML = ""; for (let i = 0; i < steps; i++) { const e = document.createElement("i"); e.style.background = depthColor(mx * (i + .5) / steps); B.appendChild(e); } ["0 m", fmt(mx / 2) + " m", fmt(mx) + "+ m"].forEach(t => { const s = document.createElement("span"); s.textContent = t; N.appendChild(s); }); } }

function prepLayer(meta, data) {
  const off = [data.origin[0] - ORIGIN[0], data.origin[1] - ORIGIN[1]];
  const feats = []; let box = null; const df = meta.depthField, df2 = meta.depthField2;
  for (const f of data.features) {
    const b = [1e15, 1e15, -1e15, -1e15];
    const rings = f.r.map(r => { const o = new Float64Array(r.length); for (let i = 0; i < r.length; i += 2) { const x = r[i] + off[0], y = r[i + 1] + off[1]; o[i] = x; o[i + 1] = y; if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; } return o; });
    let path = null;
    if (f.t !== "P") { path = new Path2D(); for (const r of rings) { path.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) path.lineTo(r[i], r[i + 1]); if (f.t === "A") path.closePath(); } }
    const d = df && f.p ? f.p[df] : null, d2 = df2 && f.p ? f.p[df2] : null;
    feats.push({ t: f.t, rings, path, b, d: typeof d === "number" ? d : null, d2: typeof d2 === "number" ? d2 : null });
    box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b.slice();
  }
  return { meta, feats, box };
}
function recalcDepth() { let mx = 0; for (const L of S.layers.values()) if (L.meta.kind !== "vesi") for (const f of L.feats) { const v = Math.max(f.d ?? 0, f.d2 ?? 0); if (v > mx && v < 200) mx = v; } S.maxDepth = mx > 0 ? Math.max(4, Math.ceil(mx)) : 12; buildLegend(); }

/* ---------- MML:n taustakartta (avoin WMTS, ETRS-TM35FIN) ---------- */
const MML = { x0: -548576, y0: 8388608, url: "https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/" };
const tiles = new Map(); let tileErr = false, tileGood = false;
const bgOn = () => !!(S.bg && S.mmlKey);
function tileAt(layer, z, r, c) {
  const k = `${layer}/${z}/${r}/${c}`; let t = tiles.get(k);
  if (t) { tiles.delete(k); tiles.set(k, t); return t; }   // viimeksi käytetty loppuun
  const img = new Image(); t = { img, ok: false, bad: false };
  img.crossOrigin = "anonymous";
  img.onload = () => { t.ok = true; tileErr = false; tileGood = true; req(); };
  img.onerror = () => {
    // varmuuden vuoksi uusi yritys ilman CORS-tilaa (kuva näkyy, mutta ei tallennu offline-välimuistiin)
    if (img.crossOrigin && navigator.onLine !== false) { img.removeAttribute("crossorigin"); img.src = img.src; return; }
    t.bad = true; if (!tileErr) { tileErr = true; flash(navigator.onLine === false ? "Ei verkkoyhteyttä: taustakarttaa näkyy vain aiemmin katsotuilta alueilta." : "Taustakarttaa ei saatu ladattua. Tarkista API-avain Aineisto-välilehdeltä."); } };
  img.src = `${MML.url}${layer}/default/ETRS-TM35FIN/${z}/${r}/${c}.${layer === "ortokuva" ? "jpg" : "png"}?api-key=${encodeURIComponent(S.mmlKey)}`;
  tiles.set(k, t);
  if (tiles.size > 500) for (const kk of tiles.keys()) { if (tiles.size <= 400) break; tiles.delete(kk); }
  return t;
}
function drawTiles() {
  const layer = S.bg, z = Math.max(0, Math.min(13, Math.round(13 + Math.log2(S.view.s))));
  const span = 256 * Math.pow(2, 13 - z);
  const [a, b] = toW(0, H), [c, d] = toW(W, 0);
  const c0 = Math.floor((a + ORIGIN[0] - MML.x0) / span), c1 = Math.floor((c + ORIGIN[0] - MML.x0) / span);
  const r0 = Math.floor((MML.y0 - d - ORIGIN[1]) / span), r1 = Math.floor((MML.y0 - b - ORIGIN[1]) / span);
  if ((c1 - c0 + 1) * (r1 - r0 + 1) > 150) return;
  const sz = span * S.view.s + .6;
  for (let r = r0; r <= r1; r++) for (let col = c0; col <= c1; col++) {
    const [X, Y] = toScr(MML.x0 + col * span - ORIGIN[0], MML.y0 - r * span - ORIGIN[1]);
    const t = tileAt(layer, z, r, col);
    if (t.ok) { ctx.drawImage(t.img, X, Y, sz, sz); continue; }
    for (let up = 1; up <= 5 && z - up >= 0; up++) {   // väliaikaisesti karkeampi taso
      const f = 1 << up, pr = Math.floor(r / f), pc = Math.floor(col / f), pt = tiles.get(`${layer}/${z - up}/${pr}/${pc}`);
      if (pt && pt.ok) { const sub = 256 / f; ctx.drawImage(pt.img, (col - pc * f) * sub, (r - pr * f) * sub, sub, sub, X, Y, sz, sz); break; }
    }
  }
}

function draw() {
  if (!S.view) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.fillStyle = css("--land"); ctx.fillRect(0, 0, W, H);
  if (bgOn()) drawTiles();
  const bg = bgOn() && tileGood; $("attr").hidden = !bg;   // jos tiiliä ei saada, piirretään omat vesialueet kuten ennenkin
  const s = S.view.s, vb = [S.view.cx - W / 2 / s, S.view.cy - H / 2 / s, S.view.cx + W / 2 / s, S.view.cy + H / 2 / s];
  const vis = b => !(b[2] < vb[0] || b[0] > vb[2] || b[3] < vb[1] || b[1] > vb[3]);
  ctx.setTransform(DPR * s, 0, 0, -DPR * s, DPR * (W / 2 - S.view.cx * s), DPR * (H / 2 + S.view.cy * s));
  const by = k => [...S.layers.values()].filter(L => L.meta.kind === k);
  const hasWater = by("vesi").length > 0;
  if (S.vis.vesi && !bg) for (const L of by("vesi")) { ctx.fillStyle = css("--w0"); for (const f of L.feats) if (f.path && f.t === "A" && vis(f.b)) ctx.fill(f.path, "evenodd"); ctx.strokeStyle = css("--shore"); ctx.lineWidth = 1.2 / s; for (const f of L.feats) if (f.path && vis(f.b)) ctx.stroke(f.path); }
  if (S.vis.alueet) { ctx.globalAlpha = bg ? (S.bg === "ortokuva" ? .55 : .75) : 1; for (const L of by("alueet")) for (const f of L.feats) if (f.path && f.t === "A" && vis(f.b)) { ctx.fillStyle = depthColor(f.d ?? 0); ctx.fill(f.path, "evenodd"); } ctx.globalAlpha = 1; }
  if (S.vis.alueet && !hasWater && !bg) for (const L of by("alueet")) { ctx.strokeStyle = css("--shore"); ctx.lineWidth = .6 / s; for (const f of L.feats) if (f.path && f.t === "A" && vis(f.b) && (f.d ?? 0) <= .01) ctx.stroke(f.path); }
  const labels = [];
  if (S.vis.kayrat) for (const L of by("kayrat")) { ctx.strokeStyle = css("--contour"); ctx.lineWidth = 1 / s; for (const f of L.feats) if (f.path && vis(f.b)) { ctx.globalAlpha = .85; ctx.stroke(f.path); ctx.globalAlpha = 1; if (f.d != null && s > .04) { const r = f.rings[0], m = (r.length >> 2) << 1; labels.push([r[m], r[m + 1], fmt(f.d)]); } } }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (labels.length) { const used = new Set(), g = 70; ctx.font = "600 13px " + css("--fc"); ctx.textAlign = "center"; ctx.textBaseline = "middle"; for (const [x, y, t] of labels) { const [X, Y] = toScr(x, y); if (X < 0 || Y < 0 || X > W || Y > H) continue; const k = Math.floor(X / g) + ":" + Math.floor(Y / g); if (used.has(k)) continue; used.add(k); const w = ctx.measureText(t).width + 6; ctx.fillStyle = css("--panel"); ctx.globalAlpha = .85; ctx.fillRect(X - w / 2, Y - 8, w, 16); ctx.globalAlpha = 1; ctx.fillStyle = css("--contour"); ctx.fillText(t, X, Y); } }
  if (S.vis.pisteet && s > .08) { ctx.font = "500 12px " + css("--fc"); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = css("--contour"); let n = 0; const used = new Set(), g = s > .4 ? 22 : 34; for (const L of by("pisteet")) for (const f of L.feats) { if (n > 900) break; const r = f.rings[0]; const [X, Y] = toScr(r[0], r[1]); if (X < 0 || Y < 0 || X > W || Y > H) continue; const k = Math.floor(X / g) + ":" + Math.floor(Y / g); if (used.has(k)) continue; used.add(k); n++; ctx.fillText(f.d != null ? fmt(f.d) : "·", X, Y); } }
  if (S.vis.saaliit) for (const c of S.catches) { if (c.E == null) continue; const [x, y] = W2(c.E, c.N); const [X, Y] = toScr(x, y); if (X < -20 || Y < -20 || X > W + 20 || Y > H + 20) continue; ctx.save(); ctx.translate(X, Y); ctx.rotate(Math.PI / 4); ctx.fillStyle = "#fff"; ctx.fillRect(-7, -7, 14, 14); ctx.fillStyle = spColor(c.sp); ctx.fillRect(-5, -5, 10, 10); ctx.restore(); }
  if (S.vis.ottipaikat && S.hot) drawHot();
  if (S.vis.paikat) for (const sp of S.spots) { const [x, y] = W2(sp.E, sp.N); const [X, Y] = toScr(x, y); if (X < -30 || Y < -30 || X > W + 30 || Y > H + 30) continue; const sel = S.sel === sp.id, r = sel ? 17 : 14; ctx.beginPath(); ctx.arc(X, Y, r + 3, 0, 7); ctx.fillStyle = "#fff"; ctx.fill(); ctx.beginPath(); ctx.arc(X, Y, r, 0, 7); ctx.fillStyle = spColor(sp.sp); ctx.fill(); ctx.fillStyle = "#fff"; ctx.font = "600 " + (sel ? 17 : 15) + "px " + css("--fc"); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(sp.n ?? ""), X, Y + 1); }
  if (S.gps) { const [x, y] = W2(S.gps.E, S.gps.N); const [X, Y] = toScr(x, y); const ar = Math.max(8, S.gps.acc * s); ctx.beginPath(); ctx.arc(X, Y, ar, 0, 7); ctx.fillStyle = css("--gps"); ctx.globalAlpha = .15; ctx.fill(); ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(X, Y, 8, 0, 7); ctx.fillStyle = "#fff"; ctx.fill(); ctx.beginPath(); ctx.arc(X, Y, 6, 0, 7); ctx.fillStyle = css("--gps"); ctx.fill(); }
  const target = 110 / s, p = Math.pow(10, Math.floor(Math.log10(target))); let m = p; for (const k of [1, 2, 5, 10]) if (k * p <= target) m = k * p; $("scaleBar").style.width = Math.round(m * s) + "px"; $("scaleTxt").textContent = m >= 1000 ? fmt(m / 1000) + " km" : m + " m";
}

/* ---------- kosketus ---------- */
const ptrs = new Map(); let tapStart = null, lastTap = 0;
cv.addEventListener("pointerdown", e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); tapStart = ptrs.size === 1 ? { x: e.offsetX, y: e.offsetY, t: performance.now(), moved: false } : null; });
cv.addEventListener("pointermove", e => {
  if (!ptrs.has(e.pointerId) || !S.view) return; const prev = ptrs.get(e.pointerId), cur = { x: e.offsetX, y: e.offsetY };
  if (ptrs.size === 1) { if (tapStart && Math.hypot(cur.x - tapStart.x, cur.y - tapStart.y) > 6) tapStart.moved = true; if (!tapStart || tapStart.moved) { S.view.cx -= (cur.x - prev.x) / S.view.s; S.view.cy += (cur.y - prev.y) / S.view.s; req(); saveView(); } }
  else if (ptrs.size === 2) { const ids = [...ptrs.keys()], o = ptrs.get(ids[0] === e.pointerId ? ids[1] : ids[0]); const d0 = Math.hypot(prev.x - o.x, prev.y - o.y), d1 = Math.hypot(cur.x - o.x, cur.y - o.y); if (d0 > 0) zoomAt(d1 / d0, toW((prev.x + o.x) / 2, (prev.y + o.y) / 2), [(cur.x + o.x) / 2, (cur.y + o.y) / 2]); }
  ptrs.set(e.pointerId, cur);
});
function endPtr(e) { if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId); if (tapStart && !tapStart.moved && ptrs.size === 0 && performance.now() - tapStart.t < 450) { const now = performance.now(); if (now - lastTap < 300 && !S.mode) { zoomAt(2, toW(e.offsetX, e.offsetY), [e.offsetX, e.offsetY]); lastTap = 0; } else { lastTap = now; onTap(e.offsetX, e.offsetY); } } tapStart = null; }
cv.addEventListener("pointerup", endPtr); cv.addEventListener("pointercancel", e => { ptrs.delete(e.pointerId); tapStart = null; });
cv.addEventListener("wheel", e => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * .0015), toW(e.offsetX, e.offsetY), [e.offsetX, e.offsetY]); }, { passive: false });
function zoomAt(f, w, scr) { const s = Math.max(.002, Math.min(20, S.view.s * f)); S.view.s = s; S.view.cx = w[0] - (scr[0] - W / 2) / s; S.view.cy = w[1] + (scr[1] - H / 2) / s; req(); saveView(); }
function pip(x, y, rings) { let inside = false; for (const r of rings) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) { const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; } return inside; }
function onTap(X, Y) {
  const [x, y] = toW(X, Y);
  if (S.mode === "place") { placeSpot(x + ORIGIN[0], y + ORIGIN[1]); return; }
  if (S.vis.paikat) { let best = null, bd = 24; for (const sp of S.spots) { const [a, b] = toScr(...W2(sp.E, sp.N)); const d = Math.hypot(a - X, b - Y); if (d < bd) { bd = d; best = sp; } } if (best) { selectSpot(best.id, false); return; } }
  if (S.vis.ottipaikat && S.hot) { let best = null, bd = 22; for (const h of S.hot.spots) { const [a, b] = toScr(...W2(h.E, h.N)); const d = Math.hypot(a - X, b - Y); if (d < bd) { bd = d; best = h; } } if (best) { selectHot(best.n, false); return; } }
  if (S.hotSel != null) { S.hotSel = null; renderHot(); req(); }
  readDepth(x, y);
}
function depthAt(x, y) {
  let area = null; for (const L of S.layers.values()) if (L.meta.kind === "alueet") for (const f of L.feats) if (f.t === "A" && x >= f.b[0] && x <= f.b[2] && y >= f.b[1] && y <= f.b[3] && pip(x, y, f.rings)) { if (!area || (f.d ?? 0) > (area.d ?? 0)) area = f; }
  let pt = null, pd = Math.min(28 / S.view.s, 80); for (const L of S.layers.values()) if (L.meta.kind === "pisteet") for (const f of L.feats) { const d = Math.hypot(f.rings[0][0] - x, f.rings[0][1] - y); if (d < pd) { pd = d; pt = f; } }
  return { area, pt };
}
function readDepth(x, y) {
  const { area, pt } = depthAt(x, y); let html = "";
  if (area && area.d != null) { const lo = Math.min(area.d, area.d2 ?? area.d), hi = Math.max(area.d, area.d2 ?? area.d); html = `<b>${lo === hi ? fmt(lo) : fmt(lo) + "–" + fmt(hi)} m</b><small>Syvyysalue</small>`; }
  if (pt && pt.d != null) html += html ? `<br><small>Lähin luotaus ${fmt(pt.d)} m</small>` : `<b>${fmt(pt.d)} m</b><small>Lähin luotauspiste</small>`;
  if (!html) html = S.layers.size ? "<small>Ei syvyystietoa tässä kohdassa.</small>" : "<small>Lisää syvyysaineisto nähdäksesi syvyydet.</small>";
  flash(html, true);
}
function flash(t, isHtml, ms) { const R = $("readout"); if (isHtml) R.innerHTML = t; else R.textContent = t; R.hidden = false; clearTimeout(R._t); R._t = setTimeout(() => R.hidden = true, ms || 6000); }

/* ---------- ottipaikat ---------- */
function viewBox() { const [a, b] = toW(0, H), [c, d] = toW(W, 0); return [a, b, c, d]; }
function computeHot() {
  const pick = [...document.querySelectorAll("#hotPop input[data-hs]")].filter(c => c.checked).map(c => c.dataset.hs);
  S.hotPick = pick; LS.set("hotPick", pick);
  if (!pick.length) { flash("Valitse vähintään yksi laji."); return; }
  if (!S.layers.size) { flash("Syvyysaineisto puuttuu, joten ottipaikkoja ei voi laskea."); return; }
  const t = Date.now(), wt = waterTemp(t, S.weather, S.manualWater).v;
  const r = findHotspots({ layers: S.layers.values(), box: viewBox(), species: pick, wt, month: new Date(t).getMonth() + 1 });
  if (!r.hasDepth) { flash("Tässä näkymässä ei ole syvyysaineistoa. Siirry vesialueen kohdalle."); return; }
  // numerointi lukujärjestyksessä: ylhäältä alas riveittäin, rivin sisällä vasemmalta oikealle
  const arr = r.spots.slice().sort((a, b) => b.y - a.y), band = r.spacing * .5, rows = [];
  for (const h of arr) { const row = rows[rows.length - 1]; if (row && row.y0 - h.y <= band) row.items.push(h); else rows.push({ y0: h.y, items: [h] }); }
  const out = []; for (const row of rows) for (const h of row.items.sort((a, b) => a.x - b.x)) out.push(h);
  S.hot = { t, wt: Math.round(wt * 10) / 10, spacing: r.spacing, species: pick, notes: r.notes,
    spots: out.map((h, i) => ({ n: i + 1, sp: h.sp, E: Math.round(h.x + ORIGIN[0]), N: Math.round(h.y + ORIGIN[1]), score: h.score, title: h.title, desc: h.desc })) };
  S.hotSel = null; LS.set("hot", S.hot); renderHot(); req();
  const per = pick.map(sp => `${HOT_SPECIES[sp].toLowerCase()} ${S.hot.spots.filter(h => h.sp === sp).length}`).join(", ");
  flash(S.hot.spots.length ? `Ottipaikkoja ${S.hot.spots.length} (${per}). Numerot näkyvät, kun zoomaat lähemmäs. Napauta pallukkaa nähdäksesi kuvauksen.` : "Näkymästä ei löytynyt sopivia ottipaikkoja. " + r.notes.join(" "), false, 8000);
}
function drawHot() {
  const showNum = S.view.s * S.hot.spacing >= 34;
  for (const h of S.hot.spots) {
    const [X, Y] = toScr(...W2(h.E, h.N)); if (X < -20 || Y < -20 || X > W + 20 || Y > H + 20) continue;
    const sel = S.hotSel === h.n, r = showNum ? (sel ? 14 : 11) : (sel ? 9 : 6);
    ctx.beginPath(); ctx.arc(X, Y, r + 2, 0, 7); ctx.fillStyle = sel ? css("--ink") : "#fff"; ctx.fill();
    ctx.beginPath(); ctx.arc(X, Y, r, 0, 7); ctx.fillStyle = spColor(h.sp); ctx.fill();
    if (showNum) { ctx.fillStyle = "#fff"; ctx.font = "600 " + (h.n >= 100 ? 11 : 13) + "px " + css("--fc"); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(h.n), X, Y + 1); }
  }
}
function hotHtml(h) { return `<strong>${h.n}. ${esc(HOT_SPECIES[h.sp])}: ${esc(h.title)}</strong>` + h.desc.map(d => `<span>${esc(d)}</span>`).join(""); }
function selectHot(n, fly) {
  const h = S.hot?.spots.find(x => x.n === n); if (!h) return; S.hotSel = n;
  if (fly) { [S.view.cx, S.view.cy] = W2(h.E, h.N); S.view.s = Math.max(S.view.s, 40 / S.hot.spacing); saveView(); }
  flash(`<div class="hotro">${hotHtml(h)}</div>`, true, 15000); renderHot(); req();
}
function renderHot() {
  const L = $("hotList"); L.innerHTML = "";
  if (!S.hot || !S.hot.spots.length) { $("hotMeta").innerHTML = S.hot ? "Viimeisimmästä näkymästä ei löytynyt sopivia ottipaikkoja. " + esc((S.hot.notes || []).join(" ")) : "Paina kartalla <b>Lisää ottipaikat</b> ja valitse lajit. Paikat numeroidaan ylhäältä alas ja vasemmalta oikealle."; return; }
  const d = new Date(S.hot.t);
  $("hotMeta").textContent = `Laskettu ${d.getDate()}.${d.getMonth() + 1}. klo ${hm(S.hot.t)}, veden lämpötila ${fmt(S.hot.wt)} °C. Numerointi ylhäältä alas ja vasemmalta oikealle.` + (S.hot.notes?.length ? " " + S.hot.notes.join(" ") : "");
  for (const h of S.hot.spots) {
    const li = document.createElement("li"); if (h.n === S.hotSel) li.className = "sel"; li.id = "hot-" + h.n;
    li.innerHTML = `<span class="dot sm" style="background:${spColor(h.sp)}">${h.n}</span><div class="li-main">${hotHtml(h)}<div class="row" style="margin-top:6px"><button class="btn" data-a="show">Näytä</button><button class="btn" data-a="save">Tallenna omaksi</button></div></div>`;
    li.querySelector("[data-a=show]").onclick = () => { selectHot(h.n, true); if (innerWidth < 900) setSheet(false); };
    li.querySelector("[data-a=save]").onclick = async () => { const n = Math.max(SUGGESTIONS.length, ...S.spots.map(s => s.n || 0)) + 1; await saveSpot({ id: newId(), n, name: `${HOT_SPECIES[h.sp]}: ${h.title.toLowerCase()}`, sp: h.sp, note: h.desc.join(" "), E: h.E, N: h.N, t: Date.now() }); flash(`Tallennettu omaksi paikaksi ${n}.`); };
    L.appendChild(li);
  }
  if (S.hotSel != null) $("hot-" + S.hotSel)?.scrollIntoView({ block: "nearest" });
}
function toggleHotPop(open) { const P = $("hotPop"); P.hidden = open === undefined ? !P.hidden : !open; $("hotBtn").setAttribute("aria-expanded", String(!P.hidden)); $("fabs").style.visibility = P.hidden ? "" : "hidden"; if (!P.hidden) { $("layerPop").hidden = true; $("layersBtn").setAttribute("aria-expanded", "false"); } }

/* ---------- paikat ---------- */
async function saveSpot(sp) { await IDB.put("spots", sp.id, sp); const i = S.spots.findIndex(s => s.id === sp.id); if (i >= 0) S.spots[i] = sp; else S.spots.push(sp); renderSpots(); req(); }
async function deleteSpot(id) { await IDB.del("spots", id); S.spots = S.spots.filter(s => s.id !== id); if (S.sel === id) S.sel = null; $("editBox").hidden = true; renderSpots(); req(); }
function startPlace(sug, moving) { S.mode = "place"; S.placing = sug || null; S.moving = moving || null; $("placeHint").hidden = false; $("placeText").textContent = moving ? "Napauta paikan uusi kohta" : sug ? `Napauta kohta: ${sug.n}. ${sug.name}` : "Napauta uuden paikan kohta kartalla"; $("addBtn").classList.add("on"); if (innerWidth < 900) setSheet(false); }
function endPlace() { S.mode = null; S.placing = null; S.moving = null; $("placeHint").hidden = true; $("addBtn").classList.remove("on"); }
async function placeSpot(E, N) {
  const g = S.placing, mv = S.moving; let sp;
  if (mv) sp = { ...mv, E: Math.round(E), N: Math.round(N) };
  else if (g) sp = { id: "sug" + g.n, n: g.n, name: g.name, sp: g.sp, note: g.note, E: Math.round(E), N: Math.round(N), sug: g.n, t: Date.now() };
  else { const n = Math.max(SUGGESTIONS.length, ...S.spots.map(s => s.n || 0)) + 1; sp = { id: newId(), n, name: "Paikka " + n, sp: "ahven", note: "", E: Math.round(E), N: Math.round(N), t: Date.now() }; }
  endPlace(); await saveSpot(sp); selectSpot(sp.id, false, !g && !mv);
}
function selectSpot(id, fly, focusName) {
  const sp = S.spots.find(s => s.id === id); if (!sp) return; S.sel = id;
  if (fly) { [S.view.cx, S.view.cy] = W2(sp.E, sp.N); if (S.view.s < .08) S.view.s = .12; }
  req(); showTab("pPaikat"); setSheet(true);
  const { area } = depthAt(...W2(sp.E, sp.N));
  const depth = area && area.d != null ? `Syvyysalue ${fmt(Math.min(area.d, area.d2 ?? area.d))}–${fmt(Math.max(area.d, area.d2 ?? area.d))} m` : "";
  const E = $("editBox"); E.hidden = false;
  E.innerHTML = `<h3>Paikka ${esc(sp.n)}</h3>${depth ? `<p class="muted">${depth}</p>` : ""}<label class="f" for="eName">Nimi</label><input type="text" id="eName" value="${esc(sp.name)}">
  <label class="f" for="eSp">Kohdekala</label><select id="eSp">${SP_KEYS.map(k => `<option value="${k}"${k === sp.sp ? " selected" : ""}>${SPECIES[k]}</option>`).join("")}</select>
  <label class="f" for="eNote">Muistiinpanot</label><textarea id="eNote">${esc(sp.note)}</textarea>
  <div class="row" style="margin-top:10px"><button class="btn primary" id="eSave">Tallenna</button><button class="btn" id="eMove">Siirrä</button><button class="btn danger" id="eDel">Poista</button><button class="btn" id="eClose">Sulje</button></div>`;
  $("eSave").onclick = async () => { await saveSpot({ ...sp, name: $("eName").value.trim() || sp.name, sp: $("eSp").value, note: $("eNote").value }); E.hidden = true; S.sel = null; req(); };
  $("eDel").onclick = () => { if (confirm("Poistetaanko paikka " + sp.name + "?")) deleteSpot(sp.id); };
  $("eClose").onclick = () => { E.hidden = true; S.sel = null; req(); };
  $("eMove").onclick = () => startPlace(null, sp);
  if (focusName) setTimeout(() => { $("eName").focus(); $("eName").select(); }, 50);
  $("pPaikat").scrollTop = 0;
}
function renderSpots() {
  const L = $("spotList"), arr = S.spots.slice().sort((a, b) => (a.n || 0) - (b.n || 0)); L.innerHTML = ""; $("spotEmpty").hidden = arr.length > 0;
  for (const sp of arr) { const li = document.createElement("li"); li.innerHTML = `<span class="dot" style="background:${spColor(sp.sp)}">${esc(sp.n)}</span><div class="li-main"><strong>${esc(sp.name)}</strong><span>${esc(SPECIES[sp.sp] || "")}${sp.note ? ", " + esc(sp.note.length > 90 ? sp.note.slice(0, 90) + "…" : sp.note) : ""}</span></div><button class="btn">Näytä</button>`; li.querySelector("button").onclick = () => selectSpot(sp.id, true); L.appendChild(li); }
  const G = $("sugList"); G.innerHTML = ""; const placed = new Set(S.spots.map(s => s.sug).filter(Boolean));
  for (const g of SUGGESTIONS) { const li = document.createElement("li"), done = placed.has(g.n); li.innerHTML = `<span class="dot" style="background:${spColor(g.sp)}">${g.n}</span><div class="li-main"><strong>${esc(g.name)}</strong><span>${esc(g.note)}</span></div><button class="btn"${done ? " disabled" : ""}>${done ? "Kartalla" : "Sijoita"}</button>`; if (!done) li.querySelector("button").onclick = () => startPlace(g); G.appendChild(li); }
  const sel = $("cSpot"), cur = sel.value; sel.innerHTML = `<option value="">Ei paikkaa</option>` + (S.gps ? `<option value="gps">Nykyinen sijainti</option>` : "") + arr.map(s => `<option value="${esc(s.id)}">${esc(s.n)}. ${esc(s.name)}</option>`).join(""); sel.value = cur;
}

/* ---------- ennuste ---------- */
const dayCache = new Map();
function dayCtx(day) {
  if (!dayCache.has(day)) dayCache.set(day, { dayEv: dayEvents(day, day + DAY, LAT, LON), solunar: solunarPeriods(day, day + DAY, LAT, LON) });
  return dayCache.get(day);
}
function score(sp, t) { const d = dayCtx(midnight(t)); return scoreHour(sp, t, { lat: LAT, lon: LON, weather: S.weather, manualWater: S.manualWater, stocking: S.stocking, ...d }); }
let heatRange = [0, 100];
const heatColor = v => { const rel = (v - heatRange[0]) / Math.max(10, heatRange[1] - heatRange[0]); const t = Math.max(0, Math.min(1, .5 * v / 100 + .5 * rel)); return mix(css("--bg"), css("--accent"), Math.pow(t, 1.1)); };
function renderForecast() {
  const { sp, day, hour } = S.fc, t = atHour(day, hour), r = score(sp, t), dc = dayCtx(day);
  { const t0 = midnight(Date.now()); let lo = 100, hi = 0; for (let k = 0; k < 7 * 24; k += 2) { const v = score(sp, t0 + k * HOUR).score; lo = Math.min(lo, v); hi = Math.max(hi, v); } heatRange = [lo, hi]; }
  $("fcScore").textContent = r.score; $("fcLabel").textContent = r.label + ", " + FC_SPECIES[sp].toLowerCase();
  $("fcWhen").textContent = `${wd(t)} ${dm(t)} klo ${hour}`;
  $("fcHourTxt").textContent = `${hour}.00`; $("fcHour").value = hour;
  $("stockRow").hidden = sp !== "kirjolohi";
  $("fcDate").value = new Date(day - new Date(day).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  // päivät
  const D = $("fcDays"); D.innerHTML = ""; const today = midnight(Date.now());
  for (let i = 0; i < 10; i++) { const d = midnight(today + i * DAY + 2 * HOUR); let best = 0; for (let h = 0; h < 24; h += 2) best = Math.max(best, score(sp, atHour(d, h)).score); const b = document.createElement("button"); b.className = "day"; b.setAttribute("aria-pressed", String(d === day)); b.innerHTML = `<small>${i === 0 ? "tänään" : wd(d)}</small><b>${dm(d)}</b><i style="background:${heatColor(best)}"></i>`; b.onclick = () => { S.fc.day = d; renderForecast(); }; D.appendChild(b); }
  // huomiot
  $("fcNotes").innerHTML = r.notes.map(n => `<div class="note${n.warn ? " warn" : ""}">${esc(n.t)}</div>`).join("");
  // olosuhteet
  const w = r.weather, il = r.moon, ev = dc.dayEv;
  const cell = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
  $("fcWx").innerHTML = (w ? cell("Ilma", fmt(w.temp) + " °C") + cell("Paine", Math.round(w.p) + " hPa") + cell("Tuuli", fmt(w.wind) + " m/s") + cell("Pilvisyys", Math.round(w.cloud) + " %") : "") +
    cell("Vesi", fmt(r.water.v) + " °C, " + r.water.src) + cell("Kuu", phaseName(il.phase) + ", " + Math.round(il.fraction * 100) + " %") +
    cell("Aurinko", (ev.sunrise ? hm(ev.sunrise) : "–") + "–" + (ev.sunset ? hm(ev.sunset) : "–")) +
    cell("Kalenterin suuret jaksot", dc.solunar.major.filter(p => p.center >= day && p.center < day + DAY).map(p => hm(p.center)).join(", ") || "–");
  $("fcFactors").innerHTML = r.factors.map(f => `<div class="fac"><div class="fh">${esc(f.label)}<span>paino ${f.w}</span></div><div class="bar"><i style="width:${Math.round(f.v * 100)}%"></i></div><p>${esc(f.text)}</p></div>`).join("");
  const where = whereToGo(sp, r); const fit = S.spots.filter(s => s.sp === sp || s.sp === "molemmat");
  if (fit.length) where.push("Omista paikoista lajille sopivat: " + fit.map(s => s.n).sort((a, b) => a - b).join(", ") + ".");
  $("fcWhere").innerHTML = where.map(x => `<li>${esc(x)}</li>`).join("");
  renderBest(); renderHeat();
}
function renderBest() {
  const sp = S.fc.sp, now = Date.now(), start = Math.ceil(now / HOUR) * HOUR, hrs = [];
  for (let t = start; t < start + 7 * DAY; t += HOUR) hrs.push({ t, s: score(sp, t).score });
  const picked = [];
  for (const h of hrs.slice().sort((a, b) => b.s - a.s)) { if (picked.length >= 5) break; if (picked.some(p => Math.abs(p.t - h.t) < 4 * HOUR)) continue; picked.push(h); }
  picked.sort((a, b) => a.t - b.t);
  $("fcBest").innerHTML = picked.map(p => { const run = hrs.filter(h => Math.abs(h.t - p.t) <= 2 * HOUR && h.s >= p.s - 10); const a = Math.min(...run.map(h => h.t)), b = Math.max(...run.map(h => h.t)) + HOUR; return `<li><span class="tag" style="background:${heatColor(p.s)};color:${p.s > 55 ? "var(--accentInk)" : "var(--ink)"}">${p.s}</span> ${wd(p.t)} ${dm(p.t)} klo ${new Date(a).getHours()}–${new Date(b).getHours()}</li>`; }).join("");
}
function renderHeat() {
  const G = $("fcHeat"), sp = S.fc.sp, today = midnight(Date.now()); G.innerHTML = "";
  G.insertAdjacentHTML("beforeend", "<span></span>" + Array.from({ length: 24 }, (_, h) => `<span class="hl">${h % 6 === 0 ? h : ""}</span>`).join(""));
  for (let i = 0; i < 7; i++) {
    const d = midnight(today + i * DAY + 2 * HOUR); G.insertAdjacentHTML("beforeend", `<span class="rl">${wd(d)}</span>`);
    for (let h = 0; h < 24; h++) { const s = score(sp, atHour(d, h)).score; const b = document.createElement("button"); b.className = "c" + (d === S.fc.day && h === S.fc.hour ? " sel" : ""); b.style.background = heatColor(s); b.title = `${wd(d)} ${dm(d)} klo ${h}: ${s}`; b.setAttribute("aria-label", b.title); b.onclick = () => { S.fc.day = d; S.fc.hour = h; renderForecast(); }; G.appendChild(b); }
  }
}
async function loadWeather(force) {
  $("fcLabel").textContent = "Haetaan säätä…";
  try { S.weather = await getWeather(LAT, LON, { force }); if (S.weather.stale) flash("Ei verkkoyhteyttä: käytetään aiemmin haettua säätä."); }
  catch (e) { S.weather = null; flash("Säätä ei saatu haettua. Arvio perustuu vain ajankohtaan."); }
  dayCache.clear(); renderForecast();
}

/* ---------- saaliit ---------- */
function snapshot(sp, t) {
  const w = hourAt(S.weather, t); const out = {};
  if (w) Object.assign(out, { ilma: w.temp, paine: w.p, tuuli: w.wind, suunta: w.dir, pilvi: w.cloud, sade: w.prec });
  if (w && w.i >= 3) out.paine3h = Math.round((w.p - S.weather.hours[w.i - 3].p) * 10) / 10;
  if (FC_SPECIES[sp]) { const r = score(sp, t); out.arvio = r.score; out.vesi = Math.round(r.water.v * 10) / 10; }
  return out;
}
async function saveCatch() {
  const sp = $("cSp").value, tv = $("cTime").value, t = tv ? new Date(tv).getTime() : Date.now();
  const spotId = $("cSpot").value; let E = null, N = null, place = "";
  if (spotId === "gps" && S.gps) { E = Math.round(S.gps.E); N = Math.round(S.gps.N); place = "GPS"; }
  else if (spotId) { const s = S.spots.find(x => x.id === spotId); if (s) { E = s.E; N = s.N; place = s.n + ". " + s.name; } }
  const num = v => { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? null : n; };
  const c = { id: newId("c"), sp, t, len: num($("cLen").value), wt: num($("cW").value), lure: $("cLure").value.trim(), note: $("cNote").value.trim(), spotId, place, E, N, ...snapshot(sp, t) };
  await IDB.put("catches", c.id, c); S.catches.push(c);
  ["cLen", "cW", "cNote"].forEach(id => $(id).value = ""); setNow(); renderCatches(); req(); flash("Saalis tallennettu.");
}
function setNow() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); $("cTime").value = d.toISOString().slice(0, 16); }
function renderCatches() {
  const L = $("cList"), arr = S.catches.slice().sort((a, b) => b.t - a.t); L.innerHTML = ""; $("cEmpty").hidden = arr.length > 0;
  for (const c of arr) { const li = document.createElement("li"); li.innerHTML = `<span class="dot" style="background:${spColor(c.sp)}">${esc(SP_ABBR[c.sp] || "?")}</span><div class="li-main"><strong>${esc(SPECIES[c.sp])}${c.len ? " " + fmt(c.len) + " cm" : ""}${c.wt ? ", " + Math.round(c.wt) + " g" : ""}</strong><span>${wd(c.t)} ${dm(c.t)} klo ${hm(c.t)}${c.place ? ", " + esc(c.place) : ""}${c.paine ? `, ${Math.round(c.paine)} hPa` : ""}${c.arvio != null ? `, arvio ${c.arvio}` : ""}${c.lure ? ", " + esc(c.lure) : ""}</span></div><button class="btn danger">Poista</button>`; li.querySelector("button").onclick = async () => { if (!confirm("Poistetaanko kirjaus?")) return; await IDB.del("catches", c.id); S.catches = S.catches.filter(x => x.id !== c.id); renderCatches(); req(); }; L.appendChild(li); }
  const scored = arr.filter(c => c.arvio != null), St = $("cStats");
  if (scored.length >= 3 && S.weather) {
    const avg = scored.reduce((a, c) => a + c.arvio, 0) / scored.length;
    const sps = [...new Set(scored.map(c => c.sp))], hs = S.weather.hours.filter((_, i) => i % 3 === 0);
    const base = sps.map(sp => hs.reduce((a, h) => a + score(sp, h.t).score, 0) / hs.length);
    St.hidden = false; St.textContent = `Saalishetkien keskimääräinen arvio on ${Math.round(avg)}/100. Tavallisen tunnin arvio samoille lajeille on noin ${Math.round(base.reduce((a, b) => a + b, 0) / base.length)}/100. Jos saaliit osuvat selvästi keskitasoa korkeammille arvioille, malli toimii vesilläsi.`;
  } else St.hidden = true;
}
function exportCsv() {
  const cols = ["aika", "laji", "pituus_cm", "paino_g", "paikka", "E", "N", "viehe", "muistiinpano", "ilma", "paine", "paine3h", "tuuli", "suunta", "pilvi", "sade", "vesi", "arvio"];
  const q = v => v == null ? "" : /[;"\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const rows = S.catches.slice().sort((a, b) => a.t - b.t).map(c => [new Date(c.t).toISOString(), c.sp, c.len, c.wt, c.place, c.E, c.N, c.lure, c.note, c.ilma, c.paine, c.paine3h, c.tuuli, c.suunta, c.pilvi, c.sade, c.vesi, c.arvio].map(q).join(";"));
  const blob = new Blob(["\ufeff" + cols.join(";") + "\n" + rows.join("\n")], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "saaliskirja.csv"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------- aineisto ---------- */
function setStatus(t) { $("procStatus").textContent = t || ""; }
function setProg(f) { const P = $("prog"); if (f == null) { P.hidden = true; return; } P.hidden = false; $("progBar").style.width = Math.round(f * 100) + "%"; }
const tick = () => new Promise(r => setTimeout(r, 30));
async function handleFiles(list) {
  if (!list || !list.length) return; const groups = new Map(), geo = [];
  const add = (name, bytesP) => { const m = name.match(/^(.*?)([^\/\\]+)\.(shp|dbf|cpg|prj|shx|geojson|json)$/i); if (!m) return; const ext = m[3].toLowerCase(), base = m[2]; if (ext === "geojson" || ext === "json") { geo.push({ name: base, bytesP }); return; } if (ext === "shx" || ext === "prj") return; const g = groups.get(m[1] + base) || { name: base }; g[ext] = bytesP; groups.set(m[1] + base, g); };
  for (const f of list) {
    if (/\.zip$/i.test(f.name)) {
      if (typeof fflate === "undefined") { setStatus("Zip-purkukirjasto ei latautunut. Pura zip ja valitse .shp- ja .dbf-tiedostot."); continue; }
      setStatus(`Puretaan ${f.name} (${fmt(f.size / 1048576)} Mt)…`); setProg(.02); await tick();
      try { const ent = fflate.unzipSync(new Uint8Array(await f.arrayBuffer()), { filter: x => /\.(shp|dbf|cpg|geojson|json)$/i.test(x.name) && !/__MACOSX/.test(x.name) }); for (const [n, b] of Object.entries(ent)) add(n, Promise.resolve(/\.cpg$/i.test(n) ? new TextDecoder().decode(b) : b)); }
      catch (e) { setStatus(`Zip-tiedoston ${f.name} purku epäonnistui (${e.message}). Pura se ja valitse .shp + .dbf suoraan, tai käytä tools/rajaa_syke.py-skriptiä.`); setProg(null); continue; }
    } else if (/\.cpg$/i.test(f.name)) add(f.name, f.text()); else add(f.name, f.arrayBuffer().then(b => new Uint8Array(b)));
  }
  for (const g of groups.values()) { if (!g.shp) continue; try { setStatus(`Rajataan ${g.name}…`); setProg(0); await tick(); const r = await CORE.processShapefile({ shp: await g.shp, dbf: g.dbf ? await g.dbf : null, cpg: g.cpg ? await g.cpg : null, name: g.name, bbox: S.region, minStep: 2, onProgress: (f, n) => { setProg(f); setStatus(`Rajataan ${g.name}: ${Math.round(f * 100)} %, alueella ${n.toLocaleString("fi-FI")} kohdetta`); } }); queuePending(r); } catch (e) { setStatus(`${g.name}: ${e.message}`); } }
  for (const g of geo) { try { const b = await g.bytesP; queuePending(geojsonToLayer(JSON.parse(typeof b === "string" ? b : new TextDecoder().decode(b)), g.name)); } catch (e) { setStatus(`${g.name}: GeoJSON-tiedostoa ei voitu lukea (${e.message})`); } }
  setProg(null); renderPending();
}
function geojsonToLayer(j, name) {
  const R = S.region, ox = R[0], oy = R[1], feats = [], fl = j.type === "FeatureCollection" ? j.features : [j], fs = new Map();
  const conv = c => { let [x, y] = c; if (Math.abs(x) <= 180 && Math.abs(y) <= 90) [x, y] = TM.fwd(x, y); return [Math.round(x - ox), Math.round(y - oy)]; };
  const inR = (x, y) => x >= 0 && y >= 0 && x <= R[2] - ox && y <= R[3] - oy;
  for (const f of fl) { const g = f.geometry; if (!g) continue; const p = f.properties || {}; for (const [k, v] of Object.entries(p)) if (!fs.has(k) || typeof v === "number") fs.set(k, typeof v === "number");
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : null, lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : null, pts = g.type === "Point" ? [g.coordinates] : g.type === "MultiPoint" ? g.coordinates : null;
    if (polys) for (const poly of polys) { const rings = poly.map(r => r.flatMap(conv)); if (rings[0].some((v, i) => i % 2 === 0 && inR(v, rings[0][i + 1]))) feats.push({ t: "A", p, r: rings }); }
    if (lines) for (const l of lines) { const r = l.flatMap(conv); if (r.some((v, i) => i % 2 === 0 && inR(v, r[i + 1]))) feats.push({ t: "L", p, r: [r] }); }
    if (pts) for (const pt of pts) { const [x, y] = conv(pt); if (inR(x, y)) feats.push({ t: "P", p, r: [[x, y]] }); } }
  const k = { A: 0, L: 0, P: 0 }; feats.forEach(f => k[f.t]++);
  return { name, features: feats, fields: [...fs].map(([name, num]) => ({ name, num })), total: fl.length, origin: [ox, oy], geomType: k.A ? "A" : k.L ? "L" : "P" };
}
function guessFields(fields, kind) { const nums = fields.filter(f => f.num).map(f => f.name); let f1 = CORE.guessDepthField(fields, kind), f2 = null; if (kind === "alueet") { const mn = nums.find(n => /min|drval1|syv.*1/i.test(n)), mx = nums.find(n => /max|drval2|syv.*2|yla|ylä/i.test(n)); if (mn && mx && mn !== mx) { f1 = mn; f2 = mx; } } if (kind === "vesi") f1 = null; return [f1, f2]; }
function queuePending(r) { if (!r.features.length) { setStatus(`${r.name}: rajausalueella ei ollut kohteita (${r.total.toLocaleString("fi-FI")} kohdetta tutkittu).`); return; } const kind = CORE.guessKind(r.name, r.geomType, r.fields); const [f1, f2] = guessFields(r.fields, kind); S.pending.push({ ...r, kind, depthField: f1, depthField2: f2 }); setStatus(`${r.name}: alueelta löytyi ${r.features.length.toLocaleString("fi-FI")} kohdetta.`); }
function renderPending() {
  const L = $("pendList"); L.innerHTML = "";
  for (const p of S.pending) { const li = document.createElement("li"), nums = p.fields.filter(f => f.num).map(f => f.name), opt = sel => `<option value="">(ei)</option>` + nums.map(n => `<option${n === sel ? " selected" : ""}>${esc(n)}</option>`).join("");
    li.innerHTML = `<div class="li-main"><strong>${esc(p.name)}</strong><span>${p.features.length.toLocaleString("fi-FI")} kohdetta alueella</span><label class="f">Tason tyyppi</label><select data-a="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}"${k === p.kind ? " selected" : ""}>${v}</option>`).join("")}</select><label class="f">Syvyyskenttä</label><select data-a="f1">${opt(p.depthField)}</select><label class="f">Toinen syvyyskenttä (alueen alaraja)</label><select data-a="f2">${opt(p.depthField2)}</select><div class="row" style="margin-top:10px"><button class="btn primary" data-a="save">Tallenna kartalle</button><button class="btn" data-a="drop">Hylkää</button></div></div>`;
    li.querySelector("[data-a=kind]").onchange = e => p.kind = e.target.value; li.querySelector("[data-a=f1]").onchange = e => p.depthField = e.target.value || null; li.querySelector("[data-a=f2]").onchange = e => p.depthField2 = e.target.value || null;
    li.querySelector("[data-a=drop]").onclick = () => { S.pending = S.pending.filter(x => x !== p); renderPending(); };
    li.querySelector("[data-a=save]").onclick = () => commitPending(p); L.appendChild(li); }
}
async function commitPending(p) {
  const keep = [p.depthField, p.depthField2].filter(Boolean), slim = q => { const o = {}; for (const k of keep) if (q[k] != null) o[k] = q[k]; return o; };
  const data = { v: 1, kind: p.kind, name: p.name, origin: p.origin, features: p.features.map(f => ({ t: f.t, p: slim(f.p), r: f.r })) };
  const id = ("L-" + p.kind + "-" + p.name).replace(/[^A-Za-z0-9_\-.]/g, "_");
  const meta = { id, kind: p.kind, name: p.name, count: p.features.length, depthField: p.depthField || null, depthField2: p.depthField2 || null, src: "laite" };
  await IDB.put("layers", id, { meta, data }); const L = prepLayer(meta, data); S.layers.set(id, L);
  S.pending = S.pending.filter(x => x !== p); renderPending(); recalcDepth(); renderLayerList(); $("empty").hidden = true; setStatus("Taso " + p.name + " tallennettu tälle laitteelle.");
  if (S.layers.size === 1) fitAll(); req();
}
function renderLayerList() {
  const L = $("layerList"); L.innerHTML = ""; $("layerEmpty").hidden = S.layers.size > 0;
  for (const [id, Lr] of S.layers) { const m = Lr.meta, li = document.createElement("li"); li.innerHTML = `<div class="li-main"><strong>${esc(m.name)}</strong><span>${esc(KINDS[m.kind] || m.kind)}, ${Lr.feats.length.toLocaleString("fi-FI")} kohdetta, ${m.src === "repo" ? "repositoriosta" : "tällä laitteella"}</span></div>${m.src === "repo" ? "" : '<button class="btn danger">Poista</button>'}`;
    const b = li.querySelector("button"); if (b) b.onclick = async () => { if (!confirm("Poistetaanko taso " + m.name + "?")) return; await IDB.del("layers", id); S.layers.delete(id); recalcDepth(); renderLayerList(); $("empty").hidden = S.layers.size > 0; req(); };
    L.appendChild(li); }
}
async function loadRepoLayers() {
  try { const r = await fetch("data/layers.json", { cache: "no-cache" }); if (!r.ok) return; const j = await r.json();
    for (const m of j.layers || []) { try { const d = await (await fetch("data/" + m.file)).json(); S.layers.set("repo-" + m.id, prepLayer({ ...m, src: "repo" }, d)); } catch (e) { console.warn("Taso", m.file, e); } } }
  catch (e) { /* ei repodataa */ }
}

/* ---------- gps ---------- */
function toggleGps() {
  const B = $("locBtn");
  if (S.gpsWatch != null) { navigator.geolocation.clearWatch(S.gpsWatch); S.gpsWatch = null; S.gps = null; B.classList.remove("on"); B.setAttribute("aria-pressed", "false"); renderSpots(); req(); return; }
  if (!navigator.geolocation) { flash("Sijaintia ei voi käyttää tällä laitteella."); return; }
  let first = true; B.classList.add("on"); B.setAttribute("aria-pressed", "true");
  S.gpsWatch = navigator.geolocation.watchPosition(p => { const [E, N] = TM.fwd(p.coords.longitude, p.coords.latitude); const had = !!S.gps; S.gps = { E, N, acc: p.coords.accuracy || 20 }; if (!had) renderSpots(); if (first) { first = false; [S.view.cx, S.view.cy] = W2(E, N); if (S.view.s < .1) S.view.s = .15; } req(); },
    err => { flash(err.code === 1 ? "Sijainnin käyttö estettiin. Salli sijainti selaimen asetuksista." : "Sijaintia ei saatu."); navigator.geolocation.clearWatch(S.gpsWatch); S.gpsWatch = null; B.classList.remove("on"); B.setAttribute("aria-pressed", "false"); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}

/* ---------- käyttöliittymä ---------- */
function showTab(id) { document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", String(t.dataset.p === id))); document.querySelectorAll(".panel").forEach(p => p.hidden = p.id !== id); }
function setSheet(open) { $("sheet").classList.toggle("min", !open); $("sheetToggle").textContent = open ? "▾" : "▴"; $("sheetToggle").setAttribute("aria-label", open ? "Pienennä paneeli" : "Avaa paneeli"); $("sheetToggle").setAttribute("aria-expanded", String(open)); setTimeout(resize, 280); }
document.querySelectorAll(".tab").forEach(t => t.onclick = () => { showTab(t.dataset.p); setSheet(true); });
$("sheetToggle").onclick = () => setSheet($("sheet").classList.contains("min"));
$("addBtn").onclick = () => S.mode ? endPlace() : startPlace(null);
$("hotBtn").onclick = () => toggleHotPop();
$("bgSel").onchange = e => { S.bg = e.target.value; LS.set("bg", S.bg); tileErr = false; if (S.bg && !S.mmlKey) { flash("Lisää ensin Maanmittauslaitoksen API-avain Aineisto-välilehdellä."); showTab("pAineisto"); setSheet(true); $("mmlKey").focus(); } req(); };
$("mmlSave").onclick = () => { const own = $("mmlKey").value.trim(); LS.set("mmlKey", own); S.mmlKey = own || MML_KEY; tiles.clear(); tileErr = false; tileGood = false; flash(own ? "Oma API-avain tallennettu tälle laitteelle." : "Käytetään sovelluksen omaa API-avainta."); req(); };
$("hotClose").onclick = () => toggleHotPop(false);
$("hotGo").onclick = () => { toggleHotPop(false); computeHot(); };
$("hotClear").onclick = () => { S.hot = null; S.hotSel = null; LS.set("hot", null); renderHot(); req(); toggleHotPop(false); };
$("placeCancel").onclick = endPlace;
$("locBtn").onclick = toggleGps;
$("layersBtn").onclick = () => { if (!$("hotPop").hidden) toggleHotPop(false); const P = $("layerPop"); P.hidden = !P.hidden; $("layersBtn").setAttribute("aria-expanded", String(!P.hidden)); $("fabs").style.visibility = P.hidden ? "" : "hidden"; };
$("layerClose").onclick = () => $("layersBtn").click();
$("fitBtn").onclick = () => { fitAll(); $("layersBtn").click(); };
document.querySelectorAll("#layerPop input[data-k]").forEach(c => c.onchange = () => { S.vis[c.dataset.k] = c.checked; LS.set("vis", S.vis); req(); });
$("emptyGo").onclick = () => { showTab("pAineisto"); setSheet(true); };
$("fileIn").onchange = e => { handleFiles([...e.target.files]); e.target.value = ""; };
const DR = $("drop"); ["dragenter", "dragover"].forEach(ev => DR.addEventListener(ev, e => { e.preventDefault(); DR.classList.add("over"); })); ["dragleave", "drop"].forEach(ev => DR.addEventListener(ev, e => { e.preventDefault(); DR.classList.remove("over"); })); DR.addEventListener("drop", e => handleFiles([...e.dataTransfer.files]));
$("bboxIn").onchange = () => { const v = $("bboxIn").value.split(/[,;\s]+/).map(Number).filter(n => !isNaN(n)); if (v.length === 4 && v[2] > v[0] && v[3] > v[1]) { S.region = v; LS.set("region", v); setStatus("Rajausalue päivitetty seuraaville tiedostoille."); } else { setStatus("Anna neljä lukua."); $("bboxIn").value = S.region.join(", "); } };
$("bboxReset").onclick = () => { S.region = REGION_DEFAULT.slice(); LS.set("region", S.region); $("bboxIn").value = S.region.join(", "); };
document.querySelectorAll("#spSeg button").forEach(b => b.onclick = () => { S.fc.sp = b.dataset.sp; document.querySelectorAll("#spSeg button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); renderForecast(); });
$("fcHour").oninput = e => { S.fc.hour = +e.target.value; renderForecast(); };
$("fcDate").onchange = e => { if (!e.target.value) return; const [y, m, d] = e.target.value.split("-").map(Number); S.fc.day = new Date(y, m - 1, d).getTime(); renderForecast(); };
$("wxRefresh").onclick = () => loadWeather(true);
$("wtSave").onclick = () => { const v = parseFloat($("wtIn").value.replace(",", ".")); if (isNaN(v) || v < 0 || v > 35) { flash("Anna veden lämpötila asteina, esim. 12,5."); return; } S.manualWater = { v, t: atHour(S.fc.day, S.fc.hour) }; LS.set("water", S.manualWater); renderForecast(); };
$("wtClear").onclick = () => { S.manualWater = null; LS.set("water", null); $("wtIn").value = ""; renderForecast(); };
$("stockIn").onchange = e => { const v = e.target.value; if (v) { const [y, m, d] = v.split("-").map(Number); S.stocking = new Date(y, m - 1, d, 12).getTime(); } else S.stocking = null; LS.set("stocking", S.stocking); renderForecast(); };
$("cSave").onclick = saveCatch; $("cExport").onclick = exportCsv;
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { buildLegend(); renderSpots(); renderForecast(); req(); });
addEventListener("resize", resize);

/* ---------- käynnistys ---------- */
(async function boot() {
  S.region = LS.get("region", REGION_DEFAULT.slice()); S.vis = { ...S.vis, ...LS.get("vis", {}) }; S.manualWater = LS.get("water", null); S.stocking = LS.get("stocking", null);
  if (S.stocking) { const d = new Date(S.stocking); $("stockIn").value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  document.querySelectorAll("#layerPop input[data-k]").forEach(c => c.checked = S.vis[c.dataset.k]);
  S.bg = LS.get("bg", ""); const ownKey = LS.get("mmlKey", ""); S.mmlKey = ownKey || MML_KEY; $("bgSel").value = S.bg; $("mmlKey").value = ownKey;
  S.hot = LS.get("hot", null); S.hotPick = LS.get("hotPick", S.hotPick);
  document.querySelectorAll("#hotPop input[data-hs]").forEach(c => c.checked = S.hotPick.includes(c.dataset.hs));
  renderHot();
  if (S.manualWater) $("wtIn").value = String(S.manualWater.v).replace(".", ",");
  $("bboxIn").value = S.region.join(", "); setNow();
  const v = LS.get("view", null); if (v && isFinite(v.s)) S.view = v;
  buildLegend(); resize(); renderForecast();
  for (const [, sp] of await IDB.all("spots")) S.spots.push(sp);
  for (const [, c] of await IDB.all("catches")) S.catches.push(c);
  renderSpots(); renderCatches();
  await loadRepoLayers();
  for (const [id, rec] of await IDB.all("layers")) S.layers.set(id, prepLayer(rec.meta, rec.data));
  recalcDepth(); renderLayerList(); $("empty").hidden = S.layers.size > 0; if (!v && S.layers.size) fitAll(); req();
  loadWeather(false).then(renderCatches);
  $("appVer").textContent = "Versio " + APP_VERSION;
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    // Kun uusi versio otetaan käyttöön, sivu ladataan kerran uudelleen (ei ensiasennuksessa).
    const hadCtrl = !!navigator.serviceWorker.controller; let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadCtrl && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(reg => {
      reg.update().catch(() => { });
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => { }); });
    }).catch(() => { });
  }
})();
