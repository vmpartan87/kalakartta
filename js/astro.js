// Auringon ja kuun laskenta (SunCalc-tyyppiset kaavat, tarkkuus muutamia minuutteja).
const PI = Math.PI, rad = PI / 180, dayMs = 86400000, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397;
const toDays = t => t / dayMs - 0.5 + J1970 - J2000;
const ra = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
const dec = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
const alt = (H, phi, d) => Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H));
const sidereal = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
function sunCoords(d) {
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + PI;
  return { dec: dec(L, 0), ra: ra(L, 0) };
}
function moonCoords(d) {
  const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.229350 * d);
  const l = L + rad * 6.289 * Math.sin(M), b = rad * 5.128 * Math.sin(F), dist = 385001 - 20905 * Math.cos(M);
  return { ra: ra(l, b), dec: dec(l, b), dist };
}
/** Auringon korkeus asteina. */
export function sunAltitude(t, lat, lon) {
  const d = toDays(t), c = sunCoords(d), H = sidereal(d, rad * -lon) - c.ra;
  return alt(H, rad * lat, c.dec) / rad;
}
/** Kuun korkeus (astetta) ja tuntikulma (rad, -π..π). */
export function moonPos(t, lat, lon) {
  const d = toDays(t), c = moonCoords(d);
  let H = sidereal(d, rad * -lon) - c.ra;
  H = Math.atan2(Math.sin(H), Math.cos(H));
  return { alt: alt(H, rad * lat, c.dec) / rad, H };
}
/** Kuun valaistu osuus (0–1) ja vaihe (0 uusi, 0.5 täysi). */
export function moonIllumination(t) {
  const d = toDays(t), s = sunCoords(d), m = moonCoords(d), sd = 149598000;
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sd * Math.sin(phi), m.dist - sd * Math.cos(phi));
  const ang = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
  return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (ang < 0 ? -1 : 1) / PI };
}
export function phaseName(p) {
  if (p < 0.03 || p > 0.97) return "uusikuu";
  if (p < 0.22) return "kasvava sirppi";
  if (p < 0.28) return "ensimmäinen neljännes";
  if (p < 0.47) return "kasvava kuu";
  if (p < 0.53) return "täysikuu";
  if (p < 0.72) return "vähenevä kuu";
  if (p < 0.78) return "viimeinen neljännes";
  return "vähenevä sirppi";
}
function crossings(f, t0, t1, step) {
  const out = []; let pt = t0, pv = f(t0);
  for (let t = t0 + step; t <= t1; t += step) {
    const v = f(t);
    if ((pv < 0) !== (v < 0)) { let a = pt, b = t, fa = pv; for (let i = 0; i < 12; i++) { const m = (a + b) / 2, fm = f(m); if ((fa < 0) !== (fm < 0)) b = m; else { a = m; fa = fm; } } out.push({ t: (a + b) / 2, rising: v > pv }); }
    pt = t; pv = v;
  }
  return out;
}
/** Vuorokauden tapahtumat aikavälillä [t0, t1]. */
export function dayEvents(t0, t1, lat, lon) {
  const step = 10 * 60000;
  const sun = h => crossings(t => sunAltitude(t, lat, lon) - h, t0, t1, step);
  const sr = sun(-0.833), cv = sun(-6);
  const moonHor = crossings(t => moonPos(t, lat, lon).alt - 0.133, t0, t1, step);
  const tr = crossings(t => Math.sin(moonPos(t, lat, lon).H), t0, t1, step)
    .map(c => ({ t: c.t, upper: Math.cos(moonPos(c.t, lat, lon).H) > 0 }));
  return {
    sunrise: sr.find(c => c.rising)?.t ?? null, sunset: sr.find(c => !c.rising)?.t ?? null,
    dawn: cv.find(c => c.rising)?.t ?? null, dusk: cv.find(c => !c.rising)?.t ?? null,
    moonrise: moonHor.find(c => c.rising)?.t ?? null, moonset: moonHor.find(c => !c.rising)?.t ?? null,
    transits: tr
  };
}
/** Kalakalenterin (solunaariteorian) jaksot: suuret = kuun ylä- ja alakulminaatio ±1 h, pienet = kuunnousu ja -lasku ±30 min. */
export function solunarPeriods(t0, t1, lat, lon) {
  const ev = dayEvents(t0 - 3 * 3600000, t1 + 3 * 3600000, lat, lon);
  const major = ev.transits.map(x => ({ center: x.t, half: 60, kind: x.upper ? "kuu ylimmillään" : "kuu alimmillaan" }));
  const minor = [];
  const mh = crossings(t => moonPos(t, lat, lon).alt - 0.133, t0 - 3 * 3600000, t1 + 3 * 3600000, 10 * 60000);
  for (const c of mh) minor.push({ center: c.t, half: 30, kind: c.rising ? "kuunnousu" : "kuunlasku" });
  return { major, minor };
}
