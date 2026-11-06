// うみくる：日付と時刻（日本時間）。今日から何日目・○時の切り出し
// 読まれるところ：app.js と js/ の部品
import { TZ } from "./sources.js";

export function tokyoParts(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
export function dayLabel(i) {
  const ymd = addDays(tokyoParts().ymd, i);
  const [y, m, d] = ymd.split("-").map(Number);
  const w = WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const head = i === 0 ? "今日" : i === 1 ? "明日" : `${m}/${d}`;
  return { ymd, text: `${head}（${w}）`, short: `${m}月${d}日（${w}）` };
}
export const hm = t => { const [h, m] = t.trim().split(":").map(Number); return h + m / 60; };
export const hmText = x => { const h = Math.floor(x), m = Math.round((x - h) * 60); return `${h}:${String(m).padStart(2, "0")}`; };

export const sliceDay = (arr, day) => arr ? arr.slice(day * 24, day * 24 + 25) : [];
export const hourlyPoints = (arr, day) => sliceDay(arr, day).map((y, x) => ({ x, y: y ?? null }));
