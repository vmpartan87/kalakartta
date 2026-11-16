// Sää Open-Meteo-palvelusta (ilmainen, ei API-avainta). Ajat haetaan unix-aikoina (UTC).
import { LS } from "./store.js";
const KEY = "weather";
export async function getWeather(lat, lon, { force = false } = {}) {
  const cached = LS.get(KEY, null);
  const fresh = cached && Math.abs(cached.lat - lat) < 0.05 && Math.abs(cached.lon - lon) < 0.05 && Date.now() - cached.fetchedAt < 60 * 60000;
  if (fresh && !force) return cached;
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + lat.toFixed(3) + "&longitude=" + lon.toFixed(3) +
    "&hourly=temperature_2m,pressure_msl,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,weather_code" +
    "&past_days=14&forecast_days=10&wind_speed_unit=ms&timeformat=unixtime&timezone=GMT";
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json(), h = j.hourly, hours = [];
    for (let i = 0; i < h.time.length; i++) hours.push({
      t: h.time[i] * 1000, temp: h.temperature_2m[i], p: h.pressure_msl[i], cloud: h.cloud_cover[i],
      wind: h.wind_speed_10m[i], gust: h.wind_gusts_10m[i], dir: h.wind_direction_10m[i], prec: h.precipitation[i], code: h.weather_code[i]
    });
    const out = { lat, lon, fetchedAt: Date.now(), hours };
    LS.set(KEY, out);
    return out;
  } catch (e) {
    if (cached) return { ...cached, stale: true, error: e.message };
    throw e;
  }
}
/** Tunnin sää ajanhetkelle t (lähin tunti), tai null jos ennuste ei kata. */
export function hourAt(w, t) {
  if (!w || !w.hours.length) return null;
  const h0 = w.hours[0].t, i = Math.round((t - h0) / 3600000);
  return i >= 0 && i < w.hours.length ? { ...w.hours[i], i } : null;
}
