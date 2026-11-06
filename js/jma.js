// うみくる：気象庁の府県天気予報の文・降水確率・警報と注意報を読む
// 読まれるところ：app.js と js/ の部品
import { WARN_NAMES } from "./sources.js";
import { getJSON } from "./net.js";
import { km } from "./place.js";

// ---- 気象庁の文 ----
export const toHalf = s => s.replace(/[０-９．]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/　/g, " ").replace(/\s+/g, " ").trim();
// 日ごとの { weather, wind, wave, nums }（3日先まで）
export function jmaText(json, c10) {
  const map = {};
  try {
    const ts = json[0].timeSeries[0];
    const a = ts.areas.find(x => x.area.code === c10);
    if (!a) return map;
    ts.timeDefines.forEach((t, i) => {
      const wave = a.waves?.[i] ? toHalf(a.waves[i]) : "";
      map[t.slice(0, 10)] = {
        weather: a.weathers?.[i] ? toHalf(a.weathers[i]) : "",
        wind: a.winds?.[i] ? toHalf(a.winds[i]) : "",
        wave,
        nums: [...wave.matchAll(/(\d+(?:\.\d+)?)\s*メートル/g)].map(m => Number(m[1])),
      };
    });
  } catch {}
  return map;
}
// 6時間ごとの降水確率 [{ ymd, from, pop }]
export function jmaPops(json, c10) {
  try {
    const ts = json[0].timeSeries[1];
    const a = ts.areas.find(x => x.area.code === c10);
    return ts.timeDefines.map((t, i) => ({ ymd: t.slice(0, 10), from: Number(t.slice(11, 13)), pop: a?.pops?.[i] })).filter(p => p.pop !== "" && p.pop != null);
  } catch { return []; }
}
export function jmaWarnings(json, c20) {
  try {
    const a = json.areaTypes[1].areas.find(x => x.code === c20);
    return (a?.warnings || []).filter(w => (w.status === "発表" || w.status === "継続") && WARN_NAMES[w.code]).map(w => WARN_NAMES[w.code]);
  } catch { return []; }
}

// ---- アメダス（いまの観測） ----
export const AMEDAS_MAX_KM = 30; // これより遠い観測点は使わない
const AMEDAS = "https://www.jma.go.jp/bosai/amedas";
// 16方位の番号（1=北北東 … 16=北、0=静穏）を角度に
const amedasDeg = n => n == null || n === 0 ? null : (n % 16) * 22.5;
const val = v => Array.isArray(v) && v[1] === 0 ? v[0] : null; // [値, 品質]。品質 0 だけ使う
// いちばん近い、風を測っている観測点の、さいごの10分の観測。{ name, km, time, wind, dir, temp } か null
export async function loadAmedas(place) {
  const table = await getJSON(`${AMEDAS}/const/amedastable.json`);
  let best = null;
  for (const [id, s] of Object.entries(table)) {
    if (s.elems?.[2] !== "1") continue; // 3文字め … 風
    const d = km(place, { lat: s.lat[0] + s.lat[1] / 60, lon: s.lon[0] + s.lon[1] / 60 });
    if (!best || d < best.km) best = { id, name: s.kjName, km: d };
  }
  if (!best || best.km > AMEDAS_MAX_KM) return null;
  const latest = new Date((await (await fetch(`${AMEDAS}/data/latest_time.txt`)).text()).trim());
  // 3時間ごとのファイル（日本時間の 0・3・6…時）
  const jst = new Date(latest.getTime() + 9 * 3600000);
  const ymd = jst.toISOString().slice(0, 10).replace(/-/g, "");
  const hh = String(Math.floor(jst.getUTCHours() / 3) * 3).padStart(2, "0");
  const obs = await getJSON(`${AMEDAS}/data/point/${best.id}/${ymd}_${hh}.json`);
  const key = Object.keys(obs).sort().pop();
  const o = key && obs[key];
  if (!o) return null;
  return {
    name: best.name, km: best.km, time: `${Number(key.slice(8, 10))}:${key.slice(10, 12)}`,
    wind: val(o.wind), dir: amedasDeg(val(o.windDirection)), temp: val(o.temp),
  };
}
