// Ottipaikat: karttanäkymän syvyysaineistosta lasketaan lajikohtaisesti parhaat kohdat.
// Heuristiikka: syvyys vuodenajan mukaan, pudotusreunat, matalikot, syvänteen läheisyys, etäisyys rantaan ja virta.
// Kaikki koordinaatit ovat kartan koordinaatteja (metrejä ORIGIN-pisteestä), y kasvaa pohjoiseen.

export const HOT_SPECIES = { kuha: "Kuha", ahven: "Ahven", hauki: "Hauki", kirjolohi: "Kirjolohi" };
const f1 = v => (Math.round(v * 10) / 10).toLocaleString("fi-FI");
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const fit = (d, lo, hi, soft) => d >= lo && d <= hi ? 1 : clamp(1 - (d < lo ? lo - d : d - hi) / soft);

/** Lajin tavoitesyvyys vuodenajan (veden lämpötilan) mukaan. */
export function seasonDepth(sp, wt, month) {
  const w = f1(wt);
  if (sp === "kuha") {
    if (wt < 6) return { lo: 7, hi: 14, text: `Kylmässä vedessä (${w} °C) kuha on syvänteissä ja niiden reunoilla 7–14 m.` };
    if (wt < 10) return { lo: 5, hi: 10, text: `Viileässä vedessä (${w} °C) kuha on syvemmillä reunoilla 5–10 m.` };
    if (wt < 16) return { lo: 3, hi: 8, text: `Vesi ${w} °C: kuha liikkuu pudotusten reunoilla 3–8 m.` };
    return { lo: 3, hi: 8, text: `Lämpimässä vedessä (${w} °C) kuha saalistaa pudotusten ja matalikkojen reunoilla 3–8 m, hämärässä matalammalla.` };
  }
  if (sp === "ahven") {
    if (wt < 4) return { lo: 4, hi: 9, text: `Kylmässä vedessä (${w} °C) ahven parveilee karien ja syvempien reunojen tuntumassa 4–9 m.` };
    if (wt < 12 && month <= 6) return { lo: 1, hi: 3, shore: true, text: `Keväällä (vesi ${w} °C) ahven hakeutuu mataliin, lämpeneviin lahtiin 1–3 m.` };
    if (wt < 12) return { lo: 3, hi: 8, text: `Syksyllä (vesi ${w} °C) ahven siirtyy syvemmille reunoille ja kareille 3–8 m.` };
    if (wt < 19) return { lo: 2, hi: 5, text: `Vesi ${w} °C: ahven on karien, kivikoiden ja reunojen tuntumassa 2–5 m.` };
    return { lo: 3, hi: 7, text: `Lämpimässä vedessä (${w} °C) ahven on syvempien karien ja reunojen tuntumassa 3–7 m.` };
  }
  if (sp === "hauki") {
    if (wt < 4) return { lo: 3, hi: 7, text: `Kylmässä vedessä (${w} °C) hauki väijyy syvempien reunojen tuntumassa 3–7 m.` };
    if (wt < 12 && month <= 6) return { lo: .5, hi: 2.5, shore: true, text: `Keväällä (vesi ${w} °C) hauki on matalissa rantalahdissa 0,5–2,5 m.` };
    if (month <= 8) return { lo: 1.5, hi: 4, text: `Kesällä hauki väijyy matalan ja syvemmän rajalla, kasvillisuuden reunoissa 1,5–4 m.` };
    return { lo: 3, hi: 7, text: `Syksyllä (vesi ${w} °C) hauki seuraa saaliskaloja syvemmille reunoille 3–7 m.` };
  }
  if (wt > 18) return { lo: 4, hi: 10, river: true, text: `Lämpimässä vedessä (${w} °C) kirjolohi hakeutuu syvempään, virtaavaan veteen 4–10 m.` };
  return { lo: 1.5, hi: 6, river: true, text: `Kirjolohta saa lähinnä istutuspaikoilta ja virrasta, syvyys 1,5–6 m.` };
}

/**
 * Laskee ottipaikat.
 * @param {object} o { layers: Iterable<{meta, feats}>, box: [x0,y0,x1,y1], species: string[], wt: veden lämpötila, month, perSpecies }
 * @returns {{spots: Array, spacing: number, cell: number, hasDepth: boolean, notes: string[]}}
 */
export function findHotspots(o) {
  const [x0, y0, x1, y1] = o.box, Wm = x1 - x0, Hm = y1 - y0, perSpecies = o.perSpecies || 8;
  const cell = clamp(Math.max(Wm, Hm) / 140, 15, 150);
  const GW = Math.max(4, Math.ceil(Wm / cell)), GH = Math.max(4, Math.ceil(Hm / cell)), N = GW * GH;
  const cx = i => x0 + (i + .5) * cell, cy = j => y1 - (j + .5) * cell;
  const layers = [...o.layers];
  const vis = b => !(b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1);

  // --- rasterointi piilotetulle canvasille ---
  const cvs = document.createElement("canvas"); cvs.width = GW; cvs.height = GH;
  const g = cvs.getContext("2d", { willReadFrequently: true });
  const begin = () => { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, GW, GH); g.setTransform(1 / cell, 0, 0, -1 / cell, -x0 / cell, y1 / cell); };
  const fillAreas = (pred) => { begin(); g.fillStyle = "#fff"; for (const L of layers) { if (!pred(L.meta)) continue; for (const f of L.feats) if (f.t === "A" && f.path && vis(f.b)) g.fill(f.path, "evenodd"); } return g.getImageData(0, 0, GW, GH).data; };

  const water = new Uint8Array(N), river = new Uint8Array(N);
  let px = fillAreas(m => m.kind === "vesi");
  for (let k = 0; k < N; k++) if (px[k * 4 + 3] > 127) water[k] = 1;
  px = fillAreas(m => m.kind === "vesi" && /joki/i.test((m.name || "") + (m.id || "")));
  for (let k = 0; k < N; k++) if (px[k * 4 + 3] > 127) river[k] = 1;

  // syvyysalueet: R = ylärajan syvyys*4, G = alarajan syvyys*4, B = merkki
  const aLo = new Float32Array(N).fill(NaN), aHi = new Float32Array(N).fill(NaN);
  const areas = [];
  for (const L of layers) if (L.meta.kind === "alueet") for (const f of L.feats) if (f.t === "A" && f.path && f.d != null && vis(f.b)) areas.push(f);
  areas.sort((a, b) => Math.min(a.d, a.d2 ?? a.d) - Math.min(b.d, b.d2 ?? b.d));
  begin();
  for (const f of areas) { const lo = Math.min(f.d, f.d2 ?? f.d), hi = Math.max(f.d, f.d2 ?? f.d); g.fillStyle = `rgb(${Math.min(255, Math.round(lo * 4))},${Math.min(255, Math.round(hi * 4))},255)`; g.fill(f.path, "evenodd"); }
  px = g.getImageData(0, 0, GW, GH).data;
  for (let k = 0; k < N; k++) if (px[k * 4 + 3] > 200 && px[k * 4 + 2] > 200) { aLo[k] = px[k * 4] / 4; aHi[k] = px[k * 4 + 1] / 4; water[k] = 1; }

  // luotauspisteet soluihin
  const sum = new Float32Array(N), cnt = new Uint16Array(N);
  for (const L of layers) if (L.meta.kind === "pisteet") for (const f of L.feats) {
    if (f.d == null) continue; const x = f.rings[0][0], y = f.rings[0][1];
    const i = Math.floor((x - x0) / cell), j = Math.floor((y1 - y) / cell);
    if (i < 0 || j < 0 || i >= GW || j >= GH) continue;
    const k = j * GW + i; sum[k] += Math.abs(f.d); cnt[k]++; water[k] = 1;
  }

  // --- syvyys soluittain: mittaus > lähimmät mittaukset > syvyysalueen keskikohta ---
  const D0 = new Float32Array(N).fill(NaN), src = new Uint8Array(N);
  for (let k = 0; k < N; k++) if (cnt[k]) { D0[k] = sum[k] / cnt[k]; src[k] = 2; }
  const R2 = Math.max(1, Math.round(40 / cell));
  const D1 = D0.slice();
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const k = j * GW + i; if (cnt[k] || !water[k]) continue;
    let s = 0, w = 0;
    for (let b = -R2; b <= R2; b++) for (let a = -R2; a <= R2; a++) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= GW || jj >= GH) continue; const kk = jj * GW + ii; if (!cnt[kk]) continue; const ww = 1 / (a * a + b * b); s += ww * D0[kk]; w += ww; }
    if (w > 0) { D1[k] = s / w; src[k] = 2; }
    else if (!isNaN(aLo[k])) { D1[k] = (aLo[k] + aHi[k]) / 2; src[k] = 1; }
  }
  // 3x3-tasoitus
  const D = new Float32Array(N).fill(NaN);
  let hasDepth = false;
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const k = j * GW + i; if (isNaN(D1[k])) continue; hasDepth = true;
    let s = 0, n = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= GW || jj >= GH) continue; const v = D1[jj * GW + ii]; if (!isNaN(v)) { s += v; n++; } }
    D[k] = s / n;
  }
  if (!hasDepth) return { spots: [], spacing: 0, cell, hasDepth: false, notes: [] };

  // --- etäisyys rantaan (kaksivaiheinen chamfer-etäisyysmuunnos) ---
  const dist = new Float32Array(N);
  for (let k = 0; k < N; k++) dist[k] = water[k] ? 1e9 : 0;
  const S2 = Math.SQRT2;
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) { const k = j * GW + i; if (!dist[k]) continue; let v = dist[k]; if (i > 0) v = Math.min(v, dist[k - 1] + 1); if (j > 0) { v = Math.min(v, dist[k - GW] + 1); if (i > 0) v = Math.min(v, dist[k - GW - 1] + S2); if (i < GW - 1) v = Math.min(v, dist[k - GW + 1] + S2); } dist[k] = v; }
  for (let j = GH - 1; j >= 0; j--) for (let i = GW - 1; i >= 0; i--) { const k = j * GW + i; if (!dist[k]) continue; let v = dist[k]; if (i < GW - 1) v = Math.min(v, dist[k + 1] + 1); if (j < GH - 1) { v = Math.min(v, dist[k + GW] + 1); if (i < GW - 1) v = Math.min(v, dist[k + GW + 1] + S2); if (i > 0) v = Math.min(v, dist[k + GW - 1] + S2); } dist[k] = v; }

  // --- lähiympäristön tunnusluvut ---
  const rE = Math.max(1, Math.round(50 / cell)), rS = Math.max(2, Math.round(120 / cell)), rD = Math.max(2, Math.round(150 / cell));
  const at = (i, j) => (i < 0 || j < 0 || i >= GW || j >= GH) ? NaN : D[j * GW + i];
  const dirs = Array.from({ length: 16 }, (_, q) => [Math.cos(q * Math.PI / 8), Math.sin(q * Math.PI / 8)]);
  function env(i, j) {
    let mn = Infinity, mx = -Infinity;
    for (let b = -rE; b <= rE; b++) for (let a = -rE; a <= rE; a++) { const v = at(i + a, j + b); if (!isNaN(v)) { if (v < mn) mn = v; if (v > mx) mx = v; } }
    let rs = 0, rn = 0; for (const [dx, dy] of dirs) { const v = at(i + Math.round(dx * rS), j + Math.round(dy * rS)); if (!isNaN(v)) { rs += v; rn++; } }
    let deep = -Infinity; for (let b = -rD; b <= rD; b += 1) for (let a = -rD; a <= rD; a += 1) { if (a * a + b * b > rD * rD) continue; const v = at(i + a, j + b); if (v > deep) deep = v; }
    return { mn, mx, steep: (mx - mn) / (2 * rE * cell) * 100, ring: rn >= 8 ? rs / rn : NaN, deep };
  }

  // --- pisteytys ---
  const month = o.month, cand = {};
  const prof = {}; for (const sp of o.species) { prof[sp] = seasonDepth(sp, o.wt, month); cand[sp] = []; }
  const anyRiver = river.some(v => v);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const k = j * GW + i, d = D[k]; if (isNaN(d) || !water[k]) continue;
    const e = env(i, j), shoreM = dist[k] * cell, conf = src[k] === 2 ? 1 : .8;
    const edge = clamp(e.steep / 6), shoal = isNaN(e.ring) ? 0 : e.ring - d, shoalFit = clamp((shoal - .5) / 3), deepFit = clamp((e.deep - d) / 4);
    for (const sp of o.species) {
      const P = prof[sp], df = fit(d, P.lo, P.hi, Math.max(1.5, (P.hi - P.lo) * .5));
      if (df < .3) continue;
      let s, kind;
      // Pelkkä sopiva syvyys ei riitä (enintään 0,35): paikalla pitää olla myös rakenne (reuna, matalikko, syvänne, ranta tai virta).
      if (sp === "kuha") { s = .35 * df + .45 * edge + .2 * deepFit; kind = edge >= .5 ? "edge" : deepFit >= .6 ? "deep" : "depth"; }
      else if (sp === "ahven") {
        if (P.shore) { const sf = clamp(1 - (shoreM - 30) / 200); s = .35 * df + .35 * sf + .3 * Math.max(edge, shoalFit); kind = sf >= .5 ? "bay" : shoalFit >= .4 ? "shoal" : "edge"; }
        else { s = .3 * df + .4 * shoalFit + .3 * edge; kind = shoalFit >= .4 ? "shoal" : edge >= .5 ? "edge" : "depth"; }
      }
      else if (sp === "hauki") {
        if (P.shore) { const sf = clamp(1 - (shoreM - 30) / 150); s = .35 * df + .4 * sf + .25 * edge; kind = sf >= .5 ? "bay" : "edge"; }
        else { s = .35 * df + .5 * edge + .15 * shoalFit; kind = edge >= .5 ? "edge" : shoalFit >= .4 ? "shoal" : "depth"; }
      }
      else { s = .35 * df + .45 * (river[k] ? 1 : 0) + .2 * edge; if (!river[k]) s *= .5; kind = river[k] ? "river" : "depth"; }
      if (kind === "depth" && edge >= .25) kind = "slope";
      s *= conf;
      if (s >= .45) cand[sp].push({ i, j, k, s, kind, d, e, shoal, shoreM, river: !!river[k], src: src[k], lo: aLo[k], hi: aHi[k] });
    }
  }

  // --- parhaat, riittävän kaukana toisistaan ---
  const spacing = Math.max(120, Math.max(Wm, Hm) / 9), picked = [], notes = [];
  for (const sp of o.species) {
    const c = cand[sp].sort((a, b) => b.s - a.s); let n = 0;
    for (const p of c) {
      if (n >= perSpecies) break;
      const x = cx(p.i), y = cy(p.j);
      if (picked.some(q => { const dd = Math.hypot(q.x - x, q.y - y); return q.sp === sp ? dd < spacing : dd < spacing * .35; })) continue;
      picked.push({ sp, x, y, score: Math.round(p.s * 100), ...describe(sp, p, prof[sp], cell) }); n++;
    }
    if (!n) notes.push(sp === "kirjolohi" && !anyRiver ? "Kirjolohelle ei löytynyt virta-alueita tästä näkymästä." : `${HOT_SPECIES[sp]}: näkymästä ei löytynyt lajille sopivaa syvyyttä.`);
  }
  return { spots: picked, spacing, cell, hasDepth: true, notes };
}

function describe(sp, p, P, cell) {
  const titles = { edge: "Pudotusreuna", slope: "Loiva reuna", deep: "Syvänteen reuna", depth: "Sopiva syvyys", shoal: "Matalikko", bay: "Matala rantavesi", river: "Virtapaikka" };
  const t = [];
  const srcTxt = p.src === 2 ? "luotauspisteistä" : `syvyysalueelta ${f1(p.lo)}–${f1(p.hi)} m`;
  t.push(`Syvyys noin ${f1(p.d)} m (${srcTxt}).`);
  if (p.e.steep >= 1.5 && isFinite(p.e.mn)) t.push(`Pohja viettää ${f1(p.e.mn)} m:stä ${f1(p.e.mx)} m:iin noin ${Math.round(Math.max(50, 2 * Math.max(1, Math.round(50 / cell)) * cell) / 50) * 50} metrin matkalla.`);
  if (p.shoal >= 1.5) t.push(`Ympäröivä vesi on noin ${f1(p.shoal)} m syvempää, joten kohta on matalikko tai kari.`);
  if (sp === "kuha" && p.e.deep - p.d >= 2) t.push(`Lähellä on syvänne (noin ${f1(p.e.deep)} m), josta kuha nousee saalistamaan.`);
  if (p.river) t.push("Kohta on virta-alueella, jossa virta tuo ruokaa.");
  t.push(p.shoreM < 1e6 ? `Rantaan noin ${Math.round(p.shoreM / 10) * 10} m.` : "");
  t.push(P.text);
  return { title: titles[p.kind] || "Sopiva syvyys", desc: t.filter(Boolean) };
}
