import { TM } from "./proj.js";
// ---- core: shapefile + dbf parsing, clipping, compaction ----
export const CORE = (() => {
  const GEOM = {0:null,1:'P',11:'P',21:'P',8:'MP',18:'MP',28:'MP',3:'L',13:'L',23:'L',5:'A',15:'A',25:'A'};
  function parseDbfHeader(u8, enc) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const n = dv.getUint32(4, true), hlen = dv.getUint16(8, true), rlen = dv.getUint16(10, true);
    const fields = []; let off = 32, pos = 1;
    const dec = new TextDecoder(enc);
    while (off < hlen - 1 && u8[off] !== 0x0D) {
      let end = off; while (end < off + 11 && u8[end] !== 0) end++;
      const name = dec.decode(u8.subarray(off, end)).trim();
      const type = String.fromCharCode(u8[off + 11]);
      const len = u8[off + 16], decs = u8[off + 17];
      fields.push({ name, type, len, decs, pos }); pos += len; off += 32;
    }
    return { n, hlen, rlen, fields, dec };
  }
  function readDbfRecord(u8, h, i) {
    const base = h.hlen + i * h.rlen, out = {};
    if (base + h.rlen > u8.length) return out;
    for (const f of h.fields) {
      const raw = h.dec.decode(u8.subarray(base + f.pos, base + f.pos + f.len)).trim();
      if (f.type === 'N' || f.type === 'F') { const v = parseFloat(raw); out[f.name] = isNaN(v) ? null : v; }
      else if (f.type === 'L') out[f.name] = /^[YyTt]/.test(raw);
      else out[f.name] = raw.length > 60 ? raw.slice(0, 60) : raw;
    }
    return out;
  }
  const inter = (a, b) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
  // returns {kind, features, fields, count, total}
  async function processShapefile({ shp, dbf, cpg, name, bbox, minStep = 2, onProgress }) {
    const enc = cpg && /utf-?8/i.test(cpg) ? 'utf-8' : 'windows-1252';
    const dh = dbf ? parseDbfHeader(dbf, enc) : null;
    const dv = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
    if (dv.getInt32(0, false) !== 9994) throw new Error('Tiedosto ei ole shapefile (.shp)');
    const fileType = dv.getInt32(32, true);
    const fb = [dv.getFloat64(36, true), dv.getFloat64(44, true), dv.getFloat64(52, true), dv.getFloat64(60, true)];
    const geo = fb[2] <= 180 && fb[3] <= 90; // degrees?
    const toTM = geo ? (x, y) => TM.fwd(x, y) : (x, y) => [x, y];
    const clip = bbox;
    const ox = clip[0], oy = clip[1];
    const feats = []; let off = 100, idx = 0, total = 0;
    const len = shp.byteLength; let lastYield = performance.now();
    while (off + 8 <= len) {
      const clen = dv.getInt32(off + 4, false) * 2; const c = off + 8;
      if (c + 4 > len) break;
      const st = dv.getInt32(c, true); const g = GEOM[st];
      total++;
      if (g === 'P') {
        let x = dv.getFloat64(c + 4, true), y = dv.getFloat64(c + 12, true);
        const z = st === 11 ? dv.getFloat64(c + 20, true) : null;
        [x, y] = toTM(x, y);
        if (x >= clip[0] && x <= clip[2] && y >= clip[1] && y <= clip[3]) {
          const p = dh ? readDbfRecord(dbf, dh, idx) : {};
          if (z !== null && Math.abs(z) < 1e6) p._z = Math.round(z * 100) / 100;
          feats.push({ t: 'P', p, r: [[Math.round(x - ox), Math.round(y - oy)]] });
        }
      } else if (g === 'L' || g === 'A' || g === 'MP') {
        let b = [dv.getFloat64(c + 4, true), dv.getFloat64(c + 12, true), dv.getFloat64(c + 20, true), dv.getFloat64(c + 28, true)];
        if (geo) { const a1 = toTM(b[0], b[1]), a2 = toTM(b[2], b[3]); b = [Math.min(a1[0], a2[0]) - 2000, Math.min(a1[1], a2[1]), Math.max(a1[0], a2[0]) + 2000, Math.max(a1[1], a2[1])]; }
        if (inter(b, clip)) {
          const rings = [];
          if (g === 'MP') {
            const np = dv.getInt32(c + 36, true);
            for (let k = 0; k < np; k++) { let [x, y] = toTM(dv.getFloat64(c + 40 + k * 16, true), dv.getFloat64(c + 48 + k * 16, true)); rings.push([Math.round(x - ox), Math.round(y - oy)]); }
            const p = dh ? readDbfRecord(dbf, dh, idx) : {};
            for (const r of rings) feats.push({ t: 'P', p, r: [r] });
          } else {
            const nparts = dv.getInt32(c + 36, true), npts = dv.getInt32(c + 40, true);
            const pstart = c + 44, ptStart = pstart + nparts * 4;
            for (let k = 0; k < nparts; k++) {
              const s = dv.getInt32(pstart + k * 4, true), e = k + 1 < nparts ? dv.getInt32(pstart + (k + 1) * 4, true) : npts;
              const ring = []; let px = 1e18, py = 1e18;
              for (let q = s; q < e; q++) {
                let [x, y] = toTM(dv.getFloat64(ptStart + q * 16, true), dv.getFloat64(ptStart + q * 16 + 8, true));
                x = Math.round(x - ox); y = Math.round(y - oy);
                if (q === e - 1 || Math.abs(x - px) + Math.abs(y - py) >= minStep) { ring.push(x, y); px = x; py = y; }
              }
              if (ring.length >= (g === 'A' ? 6 : 4)) rings.push(ring);
            }
            if (rings.length) feats.push({ t: g, p: dh ? readDbfRecord(dbf, dh, idx) : {}, r: rings });
          }
        }
      }
      idx++; off = c + clen;
      if (performance.now() - lastYield > 40) { lastYield = performance.now(); onProgress && onProgress(off / len, feats.length); await new Promise(r => setTimeout(r, 0)); }
    }
    onProgress && onProgress(1, feats.length);
    const kinds = { P: 0, L: 0, A: 0 }; feats.forEach(f => kinds[f.t]++);
    const fields = dh ? dh.fields.map(f => ({ name: f.name, num: f.type === 'N' || f.type === 'F' })) : [];
    if (feats.some(f => f.p && f.p._z != null)) fields.push({ name: '_z', num: true });
    return { name, features: feats, fields, total, origin: [ox, oy], geomType: GEOM[fileType] || (kinds.A ? 'A' : kinds.L ? 'L' : 'P') };
  }
  function guessKind(name, geomType, fields) {
    const n = name.toLowerCase();
    if (/syvyysalue|depare|syvyysalu/.test(n)) return 'alueet';
    if (/syvyyskayr|syvyyskäyr|depcnt|kayra/.test(n)) return 'kayrat';
    if (/luotaus|syvyyspiste|sounding|piste/.test(n)) return 'pisteet';
    if (/ranta|jarv|järv|joet|uoma|vesi/.test(n)) return 'vesi';
    if (geomType === 'P') return 'pisteet';
    if (geomType === 'L') return 'kayrat';
    return fields.some(f => f.num && /syv|dep|drval/i.test(f.name)) ? 'alueet' : 'vesi';
  }
  function guessDepthField(fields, kind) {
    const nums = fields.filter(f => f.num).map(f => f.name);
    if (kind === 'pisteet' && nums.includes('_z')) { const s = nums.find(n => /syv|dep|valsdp/i.test(n)); return s || '_z'; }
    const pref = kind === 'alueet' ? [/max|ala|drval2|syv.*2|yla/i, /syv|dep|drval/i] : [/syv|dep|valdco|korkeus|arvo/i];
    for (const re of pref) { const m = nums.find(n => re.test(n)); if (m) return m; }
    return nums[0] || null;
  }
  return { processShapefile, guessKind, guessDepthField, parseDbfHeader, readDbfRecord };
})();
