// うみくる：予報を読む（波・風・天気・水温・海面・気象庁・警報・潮汐表）。届いたものから順に渡す
// 読まれるところ：app.js と js/ の部品
import { DAYS, TZ, WAVE_MODELS, WIND_MODELS } from "./sources.js";
import { state } from "./state.js";
import { getJSON } from "./net.js";
import { km } from "./place.js";
import { jmaPops, jmaText } from "./jma.js";

// 届いたものから順に state.data に入れて描き直す
export async function loadForecasts(place, ctxP, onPart) {
  const q = `latitude=${place.lat}&longitude=${place.lon}&timezone=${encodeURIComponent(TZ)}&forecast_days=${DAYS}`;
  const windUrl = models => `https://api.open-meteo.com/v1/forecast?${q}&hourly=wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=ms&models=${models.join(",")}`;
  // done … 届いた（読めなかったものも）出どころ。まだ届いていないグラフは「読みこみ中」と出すため
  const out = { errors: [], done: [], text: {}, pops: [], wind: { hourly: {} } };
  const finish = key => { out.done.push(key); onPart(out); };
  const part = (key, p, use, later = false) => p.then(v => { use(v); if (later) onPart(out); else finish(key); }, () => { out.errors.push(key); finish(key); });
  const jobs = [
    // 1つだけのときは名前に予報の名前が付かないので付けなおす
    part("msm", getJSON(windUrl(["jma_msm"])), v => Object.entries(v.hourly).forEach(([k, a]) => { out.wind.hourly[k === "time" ? k : `${k}_jma_msm`] = a; })),
    part("wind", getJSON(windUrl(WIND_MODELS.filter(m => m !== "jma_msm"))), v => Object.assign(out.wind.hourly, v.hourly)),
    part("waves", getJSON(`https://marine-api.open-meteo.com/v1/marine?${q}&cell_selection=sea&hourly=wave_height,wave_period,wave_direction,swell_wave_height&models=${WAVE_MODELS.join(",")}`),
      v => { out.waves = v; }, true).then(() => out.waves && fillOffshore(place, out)).then(() => { if (!out.done.includes("waves")) finish("waves"); }),
    part("sea", getJSON(`https://marine-api.open-meteo.com/v1/marine?${q}&cell_selection=sea&hourly=sea_surface_temperature,sea_level_height_msl`), v => { out.sea = v; }),
    part("wx", getJSON(`https://api.open-meteo.com/v1/forecast?${q}&hourly=weather_code,temperature_2m,precipitation_probability,precipitation&daily=sunrise,sunset`), v => { out.wx = v; }),
  ];
  const ctx = await ctxP;
  if (ctx.jma) {
    jobs.push(part("jma", getJSON(`https://www.jma.go.jp/bosai/forecast/data/forecast/${ctx.jma.office}.json`), v => {
      out.jma = v; out.text = jmaText(v, ctx.jma.c10); out.pops = jmaPops(v, ctx.jma.c10);
    }));
    jobs.push(part("warn", getJSON(`https://www.jma.go.jp/bosai/warning/data/warning/${ctx.jma.office}.json`), v => { out.warn = v; }));
  }
  await Promise.all(jobs);
  out.errors = [...new Set(out.errors)];
  return out;
}

// 岸に近くて値の出ない予報は、まわりの少し沖の点で読む
export async function fillOffshore(place, out) {
  const h = out.waves.hourly;
  const empty = WAVE_MODELS.filter(k => !(h[`wave_height_${k}`] || []).some(v => v != null));
  out.offshore = {};
  if (!empty.length) return;
  const pts = [];
  for (const dy of [-0.25, 0, 0.25]) for (const dx of [-0.25, 0, 0.25]) if (dx || dy) pts.push({ lat: +(place.lat + dy).toFixed(3), lon: +(place.lon + dx).toFixed(3) });
  const vars = ["wave_height", "wave_period", "wave_direction", "swell_wave_height"];
  try {
    const res = await getJSON(`https://marine-api.open-meteo.com/v1/marine?latitude=${pts.map(p => p.lat).join(",")}&longitude=${pts.map(p => p.lon).join(",")}`
      + `&timezone=${encodeURIComponent(TZ)}&forecast_days=${DAYS}&cell_selection=sea&hourly=${vars.join(",")}&models=${empty.join(",")}`);
    const list = Array.isArray(res) ? res : [res];
    empty.forEach(k => {
      // 1つだけ頼んだときは、名前に予報の名前が付かない
      const col = (r, v) => r.hourly?.[`${v}_${k}`] ?? (empty.length === 1 ? r.hourly?.[v] : undefined);
      let pick = null, best = Infinity;
      list.forEach(r => {
        if (!(col(r, "wave_height") || []).some(v => v != null)) return;
        const d = km(place, { lat: r.latitude, lon: r.longitude });
        if (d < best) { best = d; pick = r; }
      });
      if (!pick) return;
      vars.forEach(v => { h[`${v}_${k}`] = col(pick, v); });
      out.offshore[k] = Math.round(best);
    });
  } catch {}
}

export async function loadTide(port, ymd) {
  const key = `${port.pc}-${port.hc}:${ymd}`;
  if (state.tideCache[key]) return state.tideCache[key];
  const [y, m, d] = ymd.split("-").map(Number);
  state.tideWait.add(key);
  try {
    const j = await getJSON(`https://tide736.net/api/get_tide.php?pc=${port.pc}&hc=${port.hc}&yr=${y}&mn=${m}&dy=${d}&rg=day`);
    const c = j?.tide?.chart?.[ymd];
    if (!c) throw new Error("no tide");
    state.tideCache[key] = c;
    return c;
  } finally {
    state.tideWait.delete(key);
  }
}
// 潮汐表をまだ読んでいる最中か（その日）
export const tideWaiting = ymd => !!state.ctx?.port && state.tideWait.has(`${state.ctx.port.pc}-${state.ctx.port.hc}:${ymd}`);
export const tideFor = ymd => state.ctx?.port ? state.tideCache[`${state.ctx.port.pc}-${state.ctx.port.hc}:${ymd}`] : null;
