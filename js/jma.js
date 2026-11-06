// うみくる：気象庁の府県天気予報の文・降水確率・警報と注意報を読む
// 読まれるところ：app.js と js/ の部品
import { WARN_NAMES } from "./sources.js";

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
