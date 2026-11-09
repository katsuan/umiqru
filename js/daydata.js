// うみくる：日記に残す「その日1日ぶん」の予報・潮・観測（day）と、その中の ○時○分 の値（atTime）
// 写真・釣果の時刻の潮位や風を見る・分析用に書き出すのに使う
// 読まれるところ：js/diary.js、app.js（mazume）
import { DAYS, WAVE_MODELS, WIND_MODELS } from "./sources.js";
import { state } from "./state.js";
import { hm, hmText, sliceDay, tokyoParts } from "./time.js";
import { meanDir, range, tideRange, wxName } from "./format.js";
import { loadForecasts, loadTide, tideFor } from "./forecast.js";
import { placeContext } from "./place.js";

export const PAST_DAYS = 92; // 予報を、あとから読める日数（Open-Meteo の過去の値）
const CORE = ["msm", "wind", "waves", "sea", "wx"]; // これが全部届いていたら、ページで読んだ予報をそのまま使う

// まづめ：薄明のはじまり〜日の出の1時間後、日の入りの1時間前〜薄明のおわり（めやす）
export function mazume(tide) {
  if (!tide?.sun) return null;
  const s = tide.sun;
  const rise = hm(s.rise), set = hm(s.set);
  const [tw0, tw1] = (s.regular_twilight || []).map(hm);
  return { rise, set, morning: [tw0 ?? rise - 0.5, rise + 1], evening: [set - 1, tw1 ?? set + 0.5] };
}

// 今日から何日目か
export const dayIndex = ymd => Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${tokyoParts().ymd}T00:00:00Z`)) / 864e5);
// その日の予報を読めるか（約3か月前〜6日先）
export const canKeepDay = ymd => { const i = dayIndex(ymd); return i >= -PAST_DAYS && i <= DAYS - 1; };

// 1日ぶん（0〜23時）を小さくまとめる。d … loadForecasts の結果、i … その中の何日目
function pack(d, i, ymd, tide, port, extra) {
  const cut = a => Array.isArray(a) ? sliceDay(a, i).slice(0, 24).map(v => v ?? null) : null;
  const has = a => !!a && a.some(v => v != null);
  const wh = d.waves?.hourly || {}, wd = d.wind?.hourly || {}, x = d.wx?.hourly || {}, s = d.sea?.hourly || {};
  const wave = {}, wind = {};
  WAVE_MODELS.forEach(k => {
    const h = cut(wh[`wave_height_${k}`]);
    if (has(h)) wave[k] = { h, p: cut(wh[`wave_period_${k}`]), d: cut(wh[`wave_direction_${k}`]), s: cut(wh[`swell_wave_height_${k}`]) };
  });
  WIND_MODELS.forEach(k => {
    const sp = cut(wd[`wind_speed_10m_${k}`]);
    if (has(sp)) wind[k] = { s: sp, d: cut(wd[`wind_direction_10m_${k}`]), g: cut(wd[`wind_gusts_10m_${k}`]) };
  });
  const dl = d.wx?.daily;
  return {
    v: 1, ymd, saved: Date.now(), wave, wind,
    wx: { code: cut(x.weather_code), temp: cut(x.temperature_2m), pop: cut(x.precipitation_probability), rain: cut(x.precipitation) },
    sea: { sst: cut(s.sea_surface_temperature), cur: cut(s.ocean_current_velocity), curDir: cut(s.ocean_current_direction), level: cut(s.sea_level_height_msl) },
    sun: dl?.sunrise?.[i] && dl?.sunset?.[i] ? { rise: dl.sunrise[i].slice(11), set: dl.sunset[i].slice(11) } : null,
    // 潮汐表：20分ごとの潮位（cm）と満潮・干潮・月・日の出入り
    tide: tide ? {
      port, moon: { age: tide.moon?.age, title: tide.moon?.title, name: tide.moon?.name }, sun: tide.sun,
      flood: tide.flood.map(({ time, cm }) => ({ time, cm })), edd: tide.edd.map(({ time, cm }) => ({ time, cm })),
      cm: tide.tide.map(t => t.cm),
    } : null,
    ...extra,
  };
}

// その場所・その日の1日ぶん。ページで同じ場所・日を読んであればそれを、なければ読みなおす。読めなければ null
export async function getDay(place, ymd) {
  if (!canKeepDay(ymd)) return null;
  const i = dayIndex(ymd), d = state.data;
  const here = state.place && Math.abs(state.place.lat - place.lat) < 1e-4 && Math.abs(state.place.lon - place.lon) < 1e-4;
  if (here && d && i >= 0 && CORE.every(k => d.done.includes(k))) {
    const port = state.ctx?.port;
    const tide = tideFor(ymd) || (port ? await loadTide(port, ymd).catch(() => null) : null);
    return pack(d, i, ymd, tide, port?.name || null, { jma: d.text?.[ymd]?.wave || null, amedas: i === 0 ? d.amedas || null : null });
  }
  const ctx = await placeContext(place);
  const [f, tide] = await Promise.all([
    loadForecasts(place, Promise.resolve(ctx), () => {}, { ymd }),
    ctx.port ? loadTide(ctx.port, ymd).catch(() => null) : null,
  ]);
  if (CORE.every(k => f.errors.includes(k)) && !tide) return null;
  return pack(f, 0, ymd, tide, ctx.port?.name || null, { later: i < 0 });
}

// ---- ○時○分 の値 ----
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const near = (list, m) => list.reduce((b, e) => !b || Math.abs(e.m - m) < Math.abs(b.m - m) ? e : b, null);

// 潮：潮位（20分ごとをつないで）、上げ・下げと「上げ3分」（干潮から満潮までを10に分けて）、満潮から何分、その日の高さの中の割合
function tideAt(t, min) {
  if (!t?.cm?.length) return null;
  const k = min / 20, i = Math.max(0, Math.min(Math.floor(k), t.cm.length - 2)), f = k - i;
  const cm = t.cm[i] + (t.cm[i + 1] - t.cm[i]) * f;
  const ev = [...t.flood.map(e => ({ ...e, k: "満潮" })), ...t.edd.map(e => ({ ...e, k: "干潮" }))]
    .map(e => ({ ...e, m: hm(e.time) * 60 })).sort((a, b) => a.m - b.m);
  const prev = [...ev].reverse().find(e => e.m <= min), next = ev.find(e => e.m > min);
  const phase = next ? (next.k === "満潮" ? "上げ" : "下げ") : prev ? (prev.k === "満潮" ? "下げ" : "上げ") : null;
  const stage = prev && next ? Math.max(1, Math.min(9, Math.round((min - prev.m) / (next.m - prev.m) * 10))) : null;
  const close = near(ev, min);
  const stageText = close && Math.abs(close.m - min) <= 15 ? `${close.k}ごろ` : phase ? `${phase}${stage ? `${stage}分` : ""}` : "";
  const high = near(ev.filter(e => e.k === "満潮"), min);
  const lo = Math.min(...t.cm), hi = Math.max(...t.cm);
  return {
    cm, pct: hi > lo ? Math.round((cm - lo) / (hi - lo) * 100) : null,
    phase, stage, stageText, fromHigh: high ? Math.round(min - high.m) : null,
    moon: t.moon?.title || "", age: t.moon?.age != null ? Number(t.moon.age) : null,
    diff: tideRange(t), port: t.port, events: ev.map(e => `${e.k} ${e.time}`).join("・"),
  };
}

// day の中の min 分（0:00 からの分）の値。予報は近い時刻の値、潮は20分ごとをつないだ値
export function atTime(day, min) {
  if (!day) return null;
  const h = Math.max(0, Math.min(23, Math.round(min / 60)));
  const at = a => a?.[h] ?? null;
  const W = Object.values(day.wave || {}), V = Object.values(day.wind || {});
  const waves = W.map(m => at(m.h)).filter(v => v != null);
  const winds = V.map(m => ({ sp: at(m.s), dir: at(m.d) })).filter(m => m.sp != null);
  const gusts = V.map(m => at(m.g)).filter(v => v != null);
  const md = meanDir(winds);
  const wd = meanDir(W.map(m => ({ sp: at(m.h), dir: at(m.d) })));
  const mz = mazume(day.tide), x = min / 60;
  const sun = day.tide?.sun || day.sun;
  const cur = at(day.sea?.cur), code = at(day.wx?.code);
  return {
    h, min,
    tide: tideAt(day.tide, min),
    mazume: mz ? `朝 ${hmText(mz.morning[0])}〜${hmText(mz.morning[1])}・夕 ${hmText(mz.evening[0])}〜${hmText(mz.evening[1])}` : null,
    inMazume: mz ? (x >= mz.morning[0] && x <= mz.morning[1] ? "朝まづめ" : x >= mz.evening[0] && x <= mz.evening[1] ? "夕まづめ" : "") : null,
    night: sun ? x < hm(sun.rise) || x > hm(sun.set) : null,
    wave: range(waves), waveMean: mean(waves), period: mean(W.map(m => at(m.p)).filter(v => v != null)),
    waveDir: wd?.deg ?? null, waveJma: day.jma || null,
    wind: range(winds.map(m => m.sp)), windMean: mean(winds.map(m => m.sp)),
    windDir: md ? md.deg : null, gust: gusts.length ? Math.max(...gusts) : null,
    sst: at(day.sea?.sst), cur: cur == null ? null : { kn: cur / 1.852, dir: at(day.sea?.curDir) },
    code, wx: code != null ? wxName(code) : null, rain: at(day.wx?.pop), rainMm: at(day.wx?.rain), temp: at(day.wx?.temp),
    // アメダスは残したときの観測なので、その時刻に近い（1時間以内）ときだけ
    amedas: day.amedas && Math.abs(hm(day.amedas.time) * 60 - min) <= 60 ? day.amedas : null,
    later: !!day.later,
  };
}
