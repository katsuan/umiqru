// うみくる：数・向き・天気の言葉の見た目と、HTML に入れる文字の esc
// 読まれるところ：app.js と js/ の部品

// ---- 外から来る文字（入力した場所の名前・港や市町村の名前・気象庁の文）は、HTML に入れる前に esc ----
export const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Open-Meteo の天気の番号（WMO）を、短い言葉に
export function wxName(code) {
  if (code == null) return "—";
  if (code <= 1) return "晴れ";
  if (code === 2) return "晴れ時々くもり";
  if (code === 3) return "くもり";
  if (code === 45 || code === 48) return "霧";
  if (code >= 51 && code <= 57) return "霧雨";
  if (code >= 61 && code <= 67) return "雨";
  if (code >= 71 && code <= 77) return "雪";
  if (code >= 80 && code <= 82) return "にわか雨";
  if (code >= 85 && code <= 86) return "にわか雪";
  if (code >= 95) return "雷雨";
  return "—";
}
export const wxShort = code => ({ "晴れ時々くもり": "晴/曇", "にわか雨": "にわか", "にわか雪": "雪", "くもり": "くもり" }[wxName(code)] || wxName(code));

// ---- 数の見た目 ----
// 潮位差：その日のいちばん高い満潮といちばん低い干潮の差。見せ方は SQriptable の SEA.tideRangeText と同じ（m で小数1けた）
export function tideRange(tide) {
  if (!tide?.flood.length || !tide.edd.length) return "";
  const cm = Math.round(Math.max(...tide.flood.map(t => t.cm)) - Math.min(...tide.edd.map(t => t.cm)));
  return `潮位差 ${(Math.round(cm / 10) / 10).toFixed(1)}m`;
}
// その日の満潮・干潮を時刻の順に（k は「満潮」「干潮」）。hm … "4:57" を時間（4.95）に
export const tideEvents = (tide, hm) => tide
  ? [...tide.flood.map(t => ({ ...t, k: "満潮" })), ...tide.edd.map(t => ({ ...t, k: "干潮" }))].sort((a, b) => hm(a.time) - hm(b.time))
  : [];
export const fmt = (v, d = 1) => v == null || Number.isNaN(v) ? "—" : v.toFixed(d);
export const DIRS = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
// 風の向き：16方位（北北西）か角度（331°）。ボタンで切りかえる
export const dirName = deg => deg == null ? "" : DIRS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
// 来る向きの値。下向きの矢印を値ぶん回すと、進む向き（来る向き＋180°）を指す
export function arrow(deg) {
  if (deg == null) return "";
  return `<svg class="arrow" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style="transform:rotate(${deg}deg)"><path d="M8 2v12M4 10l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
export const valueAt = (s, h) => s.points.find(p => p.x === h)?.y ?? null;
export function range(vals) {
  const v = vals.filter(x => x != null);
  return v.length ? { lo: Math.min(...v), hi: Math.max(...v), n: v.length } : null;
}

// 表のマスの色。降水確率・雨は青1色の濃淡（高いほど濃い）。気温は 18℃を白に、寒いほど青・暑いほど橙
// 色の上の字は、濃いときだけ白に（うすい色ではふつうの字の色のまま）
export function rainCell(pct) {
  if (pct == null || pct <= 0) return "";
  const a = Math.min(0.85, 0.12 + (pct / 100) * 0.73);
  return ` style="background:rgba(42,120,214,${a.toFixed(2)})${a >= 0.55 ? ";color:#fff" : ""}"`;
}
// 雨：表に出す数（小数1けた）で決める（同じ数なら同じ色）
export function rainMmCell(mm) {
  const v = mm == null ? null : Math.round(mm * 10) / 10;
  if (v == null || v <= 0) return "";
  return rainCell(Math.min(100, 30 + v * 14));
}
// 気温：表に出す数（整数）で決め、濃さは段で（同じ数なら同じ色）。18℃ のまわり（17〜19℃）は色なし
//   18℃ からの差 2〜4・5〜8・9〜12・13〜 で4段。寒いと青、暑いと橙
export function tempCell(t) {
  if (t == null) return "";
  const diff = Math.round(t) - 18;
  const d = Math.abs(diff);
  const step = d <= 1 ? 0 : d <= 4 ? 1 : d <= 8 ? 2 : d <= 12 ? 3 : 4;
  if (!step) return "";
  const a = step * 0.17;
  const rgb = diff < 0 ? "42,120,214" : "235,104,52";
  return ` style="background:rgba(${rgb},${a.toFixed(2)})${a >= 0.55 ? ";color:#fff" : ""}"`;
}
