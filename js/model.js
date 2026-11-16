// Kalaonni-arvio. Heuristinen malli: jokainen tekijä antaa arvon 0–1, ja painotettu keskiarvo skaalataan 0–100.
// Painot ja käyrät on koottu yleisestä kalastustiedosta, eivät mitatusta aineistosta. Säädä vapaasti (ks. README).
import { sunAltitude, moonIllumination, phaseName } from "./astro.js";
import { hourAt } from "./weather.js";

export const WEIGHTS = { vesi: 25, valo: 25, paine: 12, tuuli: 10, saa: 10, kalenteri: 8, istutus: 15 };
export const SPECIES = { kuha: "Kuha", ahven: "Ahven", hauki: "Hauki", kirjolohi: "Kirjolohi" };
const lerp = (pts, x) => { if (x <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return pts[pts.length - 1][1]; };
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const f1 = v => (Math.round(v * 10) / 10).toLocaleString("fi-FI");

/** Eteläsuomalaisen ison järven pintaveden tyypillinen lämpötila päivän numeron mukaan. */
export function climWater(doy) {
  return lerp([[1, 1], [100, 1], [120, 3], [135, 8], [150, 12], [165, 16], [185, 19], [205, 20.5], [225, 19], [245, 16], [265, 12], [285, 8], [305, 4], [330, 1.5], [366, 1]], doy);
}
export const doyOf = t => { const d = new Date(t); return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000); };

/** Veden lämpötila-arvio: mitattu arvo (±4 vrk), muuten ilman lämpötilan 10 vrk liukuva keskiarvo yhdistettynä tyypilliseen. */
export function waterTemp(t, weather, manual) {
  if (manual && Math.abs(manual.t - t) < 4 * 86400000) return { v: manual.v, src: "mitattu" };
  const clim = climWater(doyOf(t));
  if (weather && weather.hours.length) {
    const h0 = weather.hours[0].t, end = Math.min(weather.hours.length - 1, Math.round((t - h0) / 3600000));
    if (end > 24 * 7) {
      let ema = null; const a = 1 / (24 * 10);
      for (let i = 0; i <= end; i++) { const v = weather.hours[i].temp; if (v == null) continue; ema = ema == null ? v : ema + a * (v - ema); }
      if (ema != null) return { v: Math.max(0.5, 0.5 * clim + 0.5 * Math.max(0.5, ema)), src: "arvio" };
    }
  }
  return { v: clim, src: "tyypillinen" };
}
function compass(deg) { const n = ["pohjoisesta", "koillisesta", "idästä", "kaakosta", "etelästä", "lounaasta", "lännestä", "luoteesta"]; return n[Math.round(((deg % 360) + 360) % 360 / 45) % 8]; }
export function shoreToward(deg) { const n = ["pohjois", "koillis", "itä", "kaakkois", "etelä", "lounais", "länsi", "luoteis"]; return n[Math.round((((deg + 180) % 360) + 360) % 360 / 45) % 8] + "rannat"; }

function pressureTrend(w, i) {
  if (!w || i == null || i < 24) return null;
  const p = w.hours[i].p, p3 = w.hours[i - 3].p, p24 = w.hours[i - 24].p;
  if (p == null || p3 == null || p24 == null) return null;
  return { p, d3: p - p3, d24: p - p24 };
}

/** Arvio yhdelle tunnille. ctx = {lat, lon, weather, manualWater, solunar:{major,minor}} */
export function scoreHour(species, t, ctx) {
  const F = [], notes = [];
  const add = (key, label, v, text) => F.push({ key, label, v: clamp(v), w: WEIGHTS[key], text });
  const W = hourAt(ctx.weather, t);
  const wt = waterTemp(t, ctx.weather, ctx.manualWater);
  const month = new Date(t).getMonth() + 1;

  // 1. Veden lämpötila
  const curve = {
    kuha: [[2, .08], [4, .15], [8, .45], [12, .7], [16, .9], [19, 1], [24, 1], [27, .8], [30, .6]],
    ahven: [[1, .3], [4, .4], [8, .6], [12, .85], [15, 1], [22, 1], [25, .85], [30, .6]],
    hauki: [[1, .35], [4, .55], [8, .8], [12, 1], [19, 1], [22, .8], [25, .6], [28, .45]],
    kirjolohi: [[1, .45], [4, .65], [8, .9], [11, 1], [16, 1], [18, .75], [20, .5], [23, .3], [26, .15]]
  }[species];
  const vw = lerp(curve, wt.v);
  add("vesi", "Veden lämpötila", vw, `${f1(wt.v)} °C (${wt.src}). ` + (vw > .85 ? "Lajille sopiva, aineenvaihdunta vilkasta." : vw > .5 ? "Kohtalainen, kala liikkuu maltillisesti." : "Kylmä vesi, kala on hidas ja syö vähän."));

  // 2. Valo ja vuorokaudenaika
  const alt = sunAltitude(t, ctx.lat, ctx.lon);
  const cloud = W?.cloud ?? 50, wind = W?.wind ?? 3;
  let vl, tl;
  if (species === "kuha") {
    if (alt < -12) { vl = .7; tl = "Yö. Kuha saalistaa pimeässäkin, mutta hämärä on parempi."; }
    else if (alt < 4) { vl = 1; tl = "Hämärä: kuhan silmä on sopeutunut hämärään, ja se saalistaa nyt aktiivisimmin."; }
    else if (alt < 15) { vl = .75; tl = "Matala aurinko, valoa vielä vähän."; }
    else { vl = .3 + .4 * cloud / 100 + (wind >= 3 && wind <= 8 ? .2 : 0); tl = `Päivä. Kuha karttaa kirkasta valoa; ${cloud > 70 ? "pilvisyys auttaa" : "aurinkoisella säällä se on syvemmällä"}${wind >= 3 && wind <= 8 ? ", ja aallokko himmentää valoa." : "."}`; }
  } else if (species === "kirjolohi") {
    if (alt < -12) { vl = .35; tl = "Yö, kirjolohi syö harvakseltaan."; }
    else if (alt < 4) { vl = 1; tl = "Hämärä: kirjolohen parasta syöntiaikaa."; }
    else if (wt.v < 8) { vl = .85; tl = "Kylmässä vedessä kirjolohi syö hyvin myös päivällä."; }
    else { vl = Math.min(.95, .5 + .35 * cloud / 100 + (wind >= 3 ? .1 : 0)); tl = cloud > 70 ? "Pilvinen päivä, kirjolohi syö." : "Kirkas päivä, kirjolohi on varovaisempi; vaimeat värit ja ohuempi siima auttavat."; }
  } else if (species === "hauki") {
    const ev = ctx.dayEv;
    const fromRise = ev?.sunrise ? (t - ev.sunrise) / 3600000 : 99, toSet = ev?.sunset ? (ev.sunset - t) / 3600000 : 99;
    if (alt < -6) { vl = .15; tl = "Pimeää. Hauki on näköön perustuva päiväsaalistaja."; }
    else if (alt < 4) { vl = .7; tl = "Hämärä, hauki on liikkeellä."; }
    else if ((fromRise >= 0 && fromRise <= 3) || (toSet >= 0 && toSet <= 3)) { vl = 1; tl = "Aamu tai ilta: hauen syöntihuippu."; }
    else if (alt > 40 && cloud < 30 && wt.v > 18) { vl = .6; tl = "Kirkas ja lämmin keskipäivä, isot hauet viileämmässä syvemmällä."; }
    else { vl = .85; tl = cloud > 60 ? "Pilvinen päivä on hyvää haukisäätä." : "Päivä, hauki väijyy reunoilla."; }
  } else {
    if (alt < -6) { vl = .08; tl = "Pimeää. Ahven on päiväsaalistaja ja lepää yöllä."; }
    else if (alt < 4) { vl = .5; tl = "Hämärä, ahven aktivoituu tai rauhoittuu."; }
    else {
      const ev = ctx.dayEv;
      const fromRise = ev?.sunrise ? (t - ev.sunrise) / 3600000 : 99, toSet = ev?.sunset ? (ev.sunset - t) / 3600000 : 99;
      if (fromRise >= .5 && fromRise <= 4) { vl = 1; tl = "Aamupäivä: ahvenen syönnin huippuaikaa."; }
      else if (toSet >= 0 && toSet <= 4) { vl = .95; tl = "Iltapäivä–ilta: toinen ahvenen syöntihuippu."; }
      else if (alt > 45 && cloud < 30) { vl = .65; tl = "Kirkas keskipäivä, parvet hakeutuvat varjoon ja syvemmälle."; }
      else { vl = .8; tl = "Päivä, ahven on liikkeellä."; }
    }
  }
  add("valo", "Valo ja kellonaika", vl, tl);

  // 3. Ilmanpaine
  const pt = W ? pressureTrend(ctx.weather, W.i) : null;
  if (pt) {
    let v, tx;
    const s3 = (pt.d3 > 0 ? "+" : "") + f1(pt.d3), s24 = (pt.d24 > 0 ? "+" : "") + f1(pt.d24);
    if (pt.d3 <= -3) { v = .55; tx = "Paine laskee jyrkästi: myrskyrintama tulossa."; }
    else if (pt.d3 <= -.6) { v = 1; tx = "Paine laskee tasaisesti ennen rintamaa, mitä kalastajat pitävät parhaana aikana."; }
    else if (pt.d3 < .6) { v = pt.d24 > 6 ? .4 : pt.d24 < -4 ? .85 : .65; tx = pt.d24 > 6 ? "Paine on noussut vuorokaudessa reilusti (kylmän rintaman jälkeinen sää), syönti usein heikkoa." : "Paine on vakaa."; }
    else if (pt.d3 < 1.5) { v = .5; tx = "Paine nousee."; }
    else { v = .3; tx = "Paine nousee nopeasti rintaman jälkeen, mikä usein hiljentää syönnin."; }
    add("paine", "Ilmanpaine", v, `${Math.round(pt.p)} hPa, 3 h ${s3}, 24 h ${s24}. ${tx}`);
  }

  // 4. Tuuli
  if (W) {
    const v = lerp({
      kuha: [[0, .55], [2, .85], [3, 1], [7, 1], [9, .6], [12, .2]],
      ahven: [[0, 1], [5, 1], [7, .7], [10, .3], [13, .15]],
      hauki: [[0, .7], [2, .9], [6, 1], [9, .6], [12, .2]],
      kirjolohi: [[0, .8], [3, 1], [8, .85], [11, .4], [14, .15]]
    }[species], W.wind);
    add("tuuli", "Tuuli", v, `${f1(W.wind)} m/s ${compass(W.dir)}, puuskat ${f1(W.gust)} m/s. ` + ((species === "kuha" || species === "hauki") && W.wind >= 3 && W.wind <= 8 ? "Aallokko himmentää valoa ja tuo saaliskalat tuulen puoleisille rannoille." : W.wind > 9 ? "Kova tuuli vaikeuttaa kalastusta." : W.wind < 2 ? "Tyyntä." : ""));
    if (W.gust >= 12) notes.push({ warn: true, t: `Puuskat ${f1(W.gust)} m/s: veneellä liikkuminen voi olla vaarallista.` });
  }

  // 5. Sade ja ukkonen
  if (W) {
    let v = .85, tx = "Poutaa.";
    if (W.code >= 95) { v = .15; tx = "Ukkosta."; notes.push({ warn: true, t: "Ukkosta: pysy poissa vedeltä." }); }
    else if (W.prec >= 4) { v = .45; tx = `Rankkasadetta ${f1(W.prec)} mm/h.`; }
    else if (W.prec >= 1) { v = .75; tx = `Sadetta ${f1(W.prec)} mm/h.`; }
    else if (W.prec > 0) { v = species === "kuha" || species === "kirjolohi" ? 1 : .9; tx = "Heikkoa sadetta, pilvistä."; }
    add("saa", "Sade", v, tx);
  }

  // 6. Kalakalenteri (solunaariteoria)
  const sol = ctx.solunar; let vk = .45, tk = "Ei kalakalenterin jaksoa.";
  if (sol) {
    const near = (arr, lim) => { let best = null; for (const p of arr) { const d = Math.abs(t - p.center) / 60000; if (d <= lim && (!best || d < best.d)) best = { d, p }; } return best; };
    const mj = near(sol.major, 90), mn = near(sol.minor, 45);
    if (mj) { vk = 1 - .4 * mj.d / 90; tk = `Suuri jakso (${mj.p.kind}).`; }
    else if (mn) { vk = .85 - .3 * mn.d / 45; tk = `Pieni jakso (${mn.p.kind}).`; }
  }
  const il = moonIllumination(t);
  if (il.fraction < .1 || il.fraction > .9) { vk = Math.min(1, vk + .1); tk += ` ${phaseName(il.phase)[0].toUpperCase() + phaseName(il.phase).slice(1)} vahvistaa kalenterin mukaan.`; }
  add("kalenteri", "Kalakalenteri", vk, tk + " Tutkimusnäyttö on heikkoa, siksi pieni paino.");

  // 7. Kirjolohen istutus
  if (species === "kirjolohi") {
    if (ctx.stocking) {
      const d = (t - ctx.stocking) / 86400000;
      let v, tx;
      if (d < 0) { v = .45; tx = "Istutus on vasta tulossa."; }
      else if (d < 3) { v = .8; tx = "Istutettu juuri: kalat totuttelevat uuteen paikkaan."; }
      else if (d <= 21) { v = 1; tx = `Istutuksesta ${Math.round(d)} vrk: kaloja on paljon ja ne syövät innokkaasti.`; }
      else if (d <= 60) { v = lerp([[21, 1], [60, .55]], d); tx = `Istutuksesta ${Math.round(d)} vrk: kaloja on jo pyydetty, ja jäljelle jääneet ovat varovaisempia.`; }
      else { v = .45; tx = `Istutuksesta ${Math.round(d)} vrk: jäljellä lähinnä varovaisia kaloja.`; }
      add("istutus", "Istutus", v, tx);
    } else notes.push({ t: "Syötä viimeisimmän kirjolohi-istutuksen päivä alla, niin arvio huomioi istutuksen. Ensimmäiset viikot istutuksen jälkeen ovat parhaita." });
    if (wt.v > 19) notes.push({ t: "Lämmin vesi: kirjolohi syö huonosti. Kokeile aamuja ja virran viileämpää, syvempää vettä." });
    notes.push({ t: "Virtapaikassa voimalaitoksen juoksutus vaikuttaa syöntiin, eikä sitä ole mallissa. Tarkista myös lupa-alue ja virtapaikan säännöt." });
  }

  // Kutu- ja vuodenaikahuomiot
  let mult = 1;
  if (species === "kuha" && wt.v >= 10 && wt.v <= 15 && month >= 5 && month <= 6) { mult = .85; notes.push({ t: "Kuhan kutuaika: koiras vartioi pesää 2–5 m kovilla pohjilla. Päästä kutukalat takaisin." }); }
  if (species === "hauki" && wt.v >= 3 && wt.v <= 9 && month >= 4 && month <= 5) { mult = .9; notes.push({ t: "Hauen kutuaika heti jäiden lähdön jälkeen matalissa lahdissa ja tulvarannoilla. Päästä kutuhauet takaisin ja tarkista paikalliset kutuajan rauhoitukset." }); }
  if (species === "ahven" && wt.v >= 7 && wt.v <= 12 && month >= 4 && month <= 6) notes.push({ t: "Ahvenen kutuaika: parvet matalissa lämpenevissä lahdissa ja kaislikoissa." });
  if (wt.v < 2 && (month <= 4 || month >= 12)) notes.push({ t: "Todennäköisesti jääaikaa: arvio koskee pilkkimistä. Tarkista jään kestävyys." });
  if (!W) notes.push({ t: "Sääennuste ei ulotu tähän ajankohtaan. Arvio perustuu vain vuodenaikaan, valoon ja kalakalenteriin." });

  const sw = F.reduce((a, f) => a + f.w, 0), mean = F.reduce((a, f) => a + f.w * f.v, 0) / sw;
  const score = Math.round(clamp((mean * mult - .38) / (.95 - .38)) * 100);
  return { score, label: score >= 75 ? "Erinomainen" : score >= 55 ? "Hyvä" : score >= 35 ? "Kohtalainen" : "Heikko", factors: F, notes, weather: W, water: wt, moon: il, sunAlt: alt };
}

/** Mihin mennä -vihjeet säännöillä. */
export function whereToGo(species, r) {
  const out = [], W = r.weather, wt = r.water.v, alt = r.sunAlt;
  if (species === "kuha") {
    if (wt < 8) out.push("Kylmässä vedessä hidas jigi syvänteiden reunoilla 6–10 m.");
    else if (alt < 4) out.push("Hämärässä kuha nousee matalikkojen ja pudotusten reunoille 2–5 m.");
    else out.push("Päivällä syvemmät reunat ja syvänteiden laidat 5–8 m.");
    if (W && W.wind >= 3) out.push(`Tuuli puhaltaa ${compass(W.dir)}: ${shoreToward(W.dir)} ja niemenkärjet, joihin aallot lyövät, kannattaa kokeilla.`);
  } else if (species === "hauki") {
    const m = new Date().getMonth() + 1;
    if (wt < 4) out.push("Kylmässä vedessä hidas uistelu tai jigi syvempien reunojen tuntumassa.");
    else if (wt < 12 && m <= 6) out.push("Keväällä matalat kaislalahdet ja tulvarannat, joissa vesi lämpenee ensin.");
    else if (wt >= 12 && m <= 8) out.push("Kaislikon ja vesikasvillisuuden reunat sekä karien kärjet; isot hauet viileämmässä syvemmällä.");
    else out.push("Syksyllä syvemmät reunat ja syvänteiden laidat, joissa saaliskalaparvet ovat: isojen haukien aikaa.");
    if (W && W.wind >= 3) out.push(`Tuuli puhaltaa ${compass(W.dir)}: tuulen puoleiset kaislikot ja ${shoreToward(W.dir)} kannattaa kokeilla.`);
  } else if (species === "kirjolohi") {
    out.push("Mankalan voimalaitoksen edustan virta: virran reunat, pyörteet ja niskat, joihin ruoka ajautuu.");
    if (wt > 18) out.push("Lämpimällä vedellä syvempi ja voimakkaampi virta, aamut ja illat.");
    else if (wt < 6) out.push("Kylmällä vedellä hitaasti uitettu viehe tai mato virran hiljaisemmissa kohdissa.");
  } else {
    if (wt < 2) out.push("Pilki karien reunoilta 3–5 m.");
    else if (wt < 12) out.push("Matalat lämpenevät lahdet ja kaislikon reunat.");
    else if (wt < 19) out.push("Karit, kivikot ja kaislikon reunat 2–5 m.");
    else out.push("Lämpimällä vedellä syvemmät karit ja reunat 4–8 m; seuraa kalastavia lintuja.");
    if (W && W.wind >= 5) out.push(`Kovalla tuulella suojaisat lahdet tai ${shoreToward(W.dir)}, joihin ruoka ajautuu.`);
  }
  return out;
}
