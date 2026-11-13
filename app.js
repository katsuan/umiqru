// うみくる（UmiQru）：画面の入口。部品（js/）をつないで、場所・日・時刻の切りかえと描き直しをする
// 読まれるところ：index.html
import { NAMES } from "./js/names.js";
import { DAYS, DEFAULT_PLACE, PORT_MAX_KM, SOURCES, WAVE_MODELS, WIND_MODELS } from "./js/sources.js";
import { store } from "./js/store.js";
import { setHour, state } from "./js/state.js";
import { dayLabel, hm, hmText, hourlyPoints, sliceDay, tokyoParts } from "./js/time.js";
import { findPlace, km, placeContext } from "./js/place.js";
import { loadForecasts, loadTide, tideFor, tideWaiting } from "./js/forecast.js";
import { jmaWarnings } from "./js/jma.js";
import { arrow, baseName, dirName, esc, fmt, icon, meanDir, rainCell, rainMmCell, range, spread, tempCell, tideEvents, tideRange, valueAt, wxName, wxShort } from "./js/format.js";
import { dashSwatch, drawChart, legend, timeline, tlScroll } from "./js/chart.js";
import { diaryNow, diaryPrefill, drawDiary, drawDiaryShell, initDiary, prefillFromUrl, rememberBot } from "./js/diary.js";
import { openTideSend, tideFromUrl } from "./js/tidesend.js";
import { canCard, oqrnCardUrl, pageUrl } from "./js/card.js";
import { mazume } from "./js/daydata.js";
import { initMapPick, openMapPick } from "./js/mappick.js";
import { ferriesOf, ferryShort, ferryStyle, groupFirst, isoOn, isoUntil, islandFor, loadIso, myFerries, setMyFerries } from "./js/iso.js";

// ---- 線 ----
function windSeries(d) {
  const h = d.wind?.hourly;
  if (!h) return [];
  return WIND_MODELS.map(k => ({
    key: k, label: SOURCES[k].label, color: SOURCES[k].color, dash: !!SOURCES[k].dash,
    points: hourlyPoints(h[`wind_speed_10m_${k}`], state.day),
    dir: sliceDay(h[`wind_direction_10m_${k}`], state.day),
    rain: sliceDay(h[`precipitation_${k}`], state.day),
    gust: sliceDay(h[`wind_gusts_10m_${k}`], state.day), // 突風（GFS・IFS だけ）
  }));
}
// 沖の海流（Open-Meteo の km/h をノットに）。dir … 流れていく向き
function currentAt(d, h) {
  const v = sliceDay(d.sea?.hourly?.ocean_current_velocity, state.day)[h];
  const dir = sliceDay(d.sea?.hourly?.ocean_current_direction, state.day)[h];
  return v == null ? null : { kn: v / 1.852, dir };
}
function waveSeries(d) {
  const h = d.waves?.hourly;
  if (!h) return [];
  return WAVE_MODELS.map(k => ({
    key: k, label: SOURCES[k].label, color: SOURCES[k].color, dash: !!SOURCES[k].dash,
    points: hourlyPoints(h[`wave_height_${k}`], state.day),
    period: sliceDay(h[`wave_period_${k}`], state.day),
    dir: sliceDay(h[`wave_direction_${k}`], state.day),
    swell: sliceDay(h[`swell_wave_height_${k}`], state.day),
  }));
}
const avg = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
// 3時間ごとに、予報を横に並べる表

// 向き（波・風）：16方位（北北西）か角度（331°）。波と風の欄のボタンで、どちらもいっしょに切りかえる
const windDirText = deg => deg == null ? "" : state.windDir === "deg" ? `${Math.round(((deg % 360) + 360) % 360)}°` : dirName(deg);

// ---- 表示 ----

function render() {
  const d = state.data, ctx = state.ctx;
  if (!d || !ctx) return;
  const day = dayLabel(state.day);
  const h = state.hour;
  document.querySelectorAll("#days button").forEach((b, i) => b.setAttribute("aria-pressed", String(i === state.day)));
  const tide = tideFor(day.ymd);
  const mz = mazume(tide);
  // 夜（日の入り〜日の出）：潮汐表の日の出入り。なければ Open-Meteo の日の出入り（日本の外も）
  const sunFrom = mz ? { rise: mz.rise, set: mz.set } : (() => {
    const dl = d.wx?.daily;
    const rise = dl?.sunrise?.[state.day], set = dl?.sunset?.[state.day];
    return rise && set ? { rise: hm(rise.slice(11)), set: hm(set.slice(11)) } : null;
  })();
  const bands = sunFrom ? [{ from: 0, to: sunFrom.rise }, { from: sunFrom.set, to: 24 }] : [];
  const text = d.text[day.ymd];
  // まだ届いていない出どころ（グラフが空でも「この日のデータはありません」と出さない）
  const waiting = (...keys) => keys.some(k => !d.done.includes(k));
  const waveWait = waiting("waves"), windWait = waiting("msm", "wind"), tideWait = tideWaiting(day.ymd) || waiting("sea");

  // 警報・注意報（いま出ているもの）
  const warns = d.warn && ctx.jma ? jmaWarnings(d.warn, ctx.jma.c20) : [];
  document.getElementById("alert").innerHTML = warns.length
    ? `<div class="alert" role="alert"><span class="ls-icon" data-icon="warn" aria-hidden="true"></span><div><strong>いま ${esc(ctx.jma.muniName)}：${warns.join("・")}</strong><br><span class="sub small">${NAMES.jma}の発表</span></div></div>`
    : "";

  // 波（気象庁の文。3日先まで）
  const days3 = [0, 1, 2].map(i => ({ i, label: dayLabel(i), t: d.text[dayLabel(i).ymd] })).filter(x => x.t?.wave);
  const maxM = Math.max(3, ...days3.flatMap(x => x.t.nums));
  document.getElementById("waves").innerHTML = days3.length ? `
    <div class="waverows">${days3.map(x => {
      const top = Math.max(...x.t.nums, 0);
      return `<div class="waverow${x.i === state.day ? " on" : ""}">
        <div class="wr-day">${x.label.text}</div>
        <div class="wr-bar"><span style="width:${(top / maxM * 100).toFixed(0)}%"></span></div>
        <div class="wr-num">${x.t.nums.length ? fmt(top) : "—"}<span class="unit">m</span></div>
        <div class="wr-text">${esc(x.t.wave)}</div>
      </div>`;
    }).join("")}</div>
    <p class="muted small" style="margin:8px 0 0">${NAMES.jma}の${esc(ctx.jma.name)}の予報（いちばん高い値を棒に）。${state.day > 2 ? "この日のぶんはまだ出ていません。" : ""}</p>`
    : `<p class="muted small" style="margin:0">${ctx.jma ? `${NAMES.jma}の波の予報を読めませんでした。` : `${NAMES.jma}の予報は日本だけです。`}</p>`;
  const waves = waveSeries(d);
  const off = d.offshore || {};
  const nightKey = bands.length ? [{ label: "夜", kind: "band" }] : [];
  legend(document.getElementById("wave-legend"), [...waves.map(s => ({ label: s.label, color: s.color, dash: s.dash })), ...nightKey]);
  drawChart(document.getElementById("wave-chart"), { series: waves, bands, yFloor: 0, unit: "m", waiting: waveWait });
  document.getElementById("wave-table").innerHTML = `
    <thead><tr><th>${h}時</th><th class="num">波 m</th><th class="num">周期 秒</th><th class="num">うねり m</th><th>来る向き</th></tr></thead>
    <tbody>${waves.map(s => `<tr>
      <th><span class="key"><i style="background:var(${s.color})"></i>${s.label}${off[s.key] ? `<span class="muted small">（${off[s.key]}km沖）</span>` : ""}</span></th>
      <td class="num">${fmt(valueAt(s, h))}</td><td class="num">${fmt(s.period[h])}</td><td class="num">${fmt(s.swell[h])}</td>
      <td>${arrow(s.dir[h])} ${windDirText(s.dir[h])}</td></tr>`).join("")}</tbody>`;
  timeline("wave-tl", waves, 1, windDirText);

  // 風（気象庁の2つの計算）
  const wind = windSeries(d);
  // アメダスの実況は、今日を見ているときだけ
  const amedas = state.day === 0 ? d.amedas : null;
  legend(document.getElementById("wind-legend"), [...wind.map(s => ({ label: s.label, color: s.color, dash: s.dash })), ...nightKey]);
  drawChart(document.getElementById("wind-chart"), { series: wind, bands, yFloor: 0, unit: "m/s", waiting: windWait });
  document.getElementById("wind-table").innerHTML = `
    <thead><tr><th>${h}時</th><th class="num">風速 m/s</th><th class="num">突風 m/s</th><th>吹いてくる向き</th></tr></thead>
    <tbody>${wind.map(s => `<tr>
      <th><span class="key"><i style="background:var(${s.color})"></i>${s.label}</span></th>
      <td class="num">${fmt(valueAt(s, h))}</td><td class="num">${fmt(s.gust[h])}</td>
      <td>${arrow(s.dir[h])} ${windDirText(s.dir[h])}</td></tr>`).join("")}
      ${amedas ? `<tr><th>実況</th><td colspan="3" class="wrap">${NAMES.amedas} ${esc(amedas.name)}（${amedas.km.toFixed(0)}km・${esc(amedas.time)}）　${amedas.wind == null ? "—" : `${arrow(amedas.dir)} ${windDirText(amedas.dir)} ${fmt(amedas.wind)} m/s`}${amedas.temp == null ? "" : `・${fmt(amedas.temp)}℃`}</td></tr>` : ""}
      <tr><th>文の予報</th><td colspan="3" class="wrap">${text?.wind ? esc(text.wind) : `<span class="muted">${state.day <= 2 ? "なし" : "3日先まで"}</span>`}</td></tr>
    </tbody>`;
  timeline("wind-tl", wind, 1, windDirText);
  document.querySelectorAll("[data-dir]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.dir === state.windDir)));

  // 潮（夜をうすく。満潮・干潮に印）
  // 基準の高さがちがうので、どちらも「その日の平均からの差」
  const tideS = [];
  let tideMean = 0;
  if (tide) {
    tideMean = avg(tide.tide.map(p => p.cm));
    tideS.push({ key: "tide736", label: SOURCES.tide736.label, color: SOURCES.tide736.color, points: tide.tide.map((p, i) => ({ x: i / 3, y: p.cm - tideMean })) });
  }
  const seaCm = sliceDay(d.sea?.hourly?.sea_level_height_msl, state.day).map(v => v == null ? null : v * 100);
  if (seaCm.some(v => v != null)) {
    const mean = avg(seaCm.filter(v => v != null));
    tideS.push({ key: "om_sea", label: SOURCES.om_sea.label, color: SOURCES.om_sea.color, points: seaCm.map((y, x) => ({ x, y: y == null ? null : y - mean })) });
  }
  const marks = tide ? [
    ...tide.flood.map(t => ({ x: hm(t.time), y: t.cm - tideMean, label: esc(t.time), up: true })),
    ...tide.edd.map(t => ({ x: hm(t.time), y: t.cm - tideMean, label: esc(t.time), up: false })),
  ] : [];
  legend(document.getElementById("tide-legend"), [
    ...tideS.map(s => ({ label: s.key === "tide736" ? `${s.label}（${esc(ctx.port.name)}）` : s.label, color: s.color })),
    ...(bands.length ? [{ label: "日の入り〜日の出", kind: "band" }] : []),
  ]);
  drawChart(document.getElementById("tide-chart"), { series: tideS, bands, marks, unit: "cm（平均からの差）", endLabels: false, waiting: tideWait });
  const tideDiff = tideRange(tide);
  const cur = currentAt(d, h);
  const curText = cur ? `${cur.dir == null ? "" : `${windDirText(cur.dir)}へ `}${fmt(cur.kn)}ノット` : "";
  const tideTimes = list => list.map(t => `${esc(t.time)}（${Math.round(t.cm)}cm）`).join("・") || "—";
  document.getElementById("tide-list").innerHTML = tide
    ? `<span>満潮 ${tideTimes(tide.flood)}</span><span>干潮 ${tideTimes(tide.edd)}</span><span>${esc(tide.moon.title)}（月齢 ${esc(tide.moon.age)}）</span>${tideDiff ? `<span>${tideDiff}</span>` : ""}${cur ? `<span>沖の流れ ${curText}（${h}時・${NAMES.openMeteo}）</span>` : ""}`
    : `<span class="muted">${ctx.port ? (tideWaiting(day.ymd) ? "読みこみ中…" : "潮汐表を読めませんでした") : `潮汐表は日本の港（${PORT_MAX_KM}km 以内）だけです`}</span>`;

  // 天気：気象庁の文と6時間ごとの降水確率（3日先まで）、1時間ごとの表
  const jmaDays = [0, 1, 2].map(i => ({ i, label: dayLabel(i), t: d.text[dayLabel(i).ymd] })).filter(x => x.t?.weather);
  // 日ごとに、天気の文の行と、6時間ごとの降水確率を1行ずつ
  document.getElementById("wx-jma").innerHTML = jmaDays.length ? `<div class="table-wrap"><table class="jma-days">
    <thead><tr><th>${NAMES.jma}</th><th>時間</th><th class="num">降水確率</th></tr></thead>
    <tbody>${jmaDays.map(x => {
      const pops = d.pops.filter(p => p.ymd === x.label.ymd);
      const on = x.i === state.day ? " on" : "";
      const head = `<tr class="day-head${on}"><th rowspan="${pops.length + 1}">${x.label.text}</th><td colspan="2" class="wrap">${esc(x.t.weather)}</td></tr>`;
      const rows = pops.map(p => {
        const cur = x.i === state.day && h >= p.from && h < p.from + 6 ? " on" : "";
        return `<tr class="pop${cur}"><td>${p.from}〜${p.from + 6}時</td><td class="num pct"${rainCell(Number(p.pop))}>${esc(p.pop)}%</td></tr>`;
      }).join("");
      return head + (rows || `<tr class="pop"><td colspan="2" class="muted">降水確率はまだ出ていません</td></tr>`);
    }).join("")}</tbody></table></div>`
    : `<p class="muted small" style="margin:0">${ctx.jma ? `${NAMES.jma}の天気を読めませんでした。` : `${NAMES.jma}の天気は日本だけです。`}</p>`;
  const wh = d.wx?.hourly;
  if (wh) {
    const at = (k, t) => sliceDay(wh[k], state.day)[t];
    // paint … マスの色（降水確率・気温）。色を付けたマスは、えらんだ時刻の印を枠で出す
    const row = (name, cell, paint = () => "") => `<tr><th class="stick">${name}</th>${Array.from({ length: 24 }, (_, t) => `<td data-h="${t}" class="${t === h ? "on" : ""}"${paint(t)}>${cell(t)}</td>`).join("")}</tr>`;
    const el = document.getElementById("wx-tl");
    const keep = el.firstElementChild ? el.firstElementChild.scrollLeft : 0;
    el.innerHTML = `<div class="timeline-in" style="overflow-x:auto"><table class="tl">
      <thead><tr><th class="stick">時刻</th>${Array.from({ length: 24 }, (_, t) => `<th class="${t === h ? "on" : ""}">${t}時</th>`).join("")}</tr></thead>
      <tbody>
        ${row("天気", t => esc(wxShort(at("weather_code", t))))}
        ${row("気温 ℃", t => fmt(at("temperature_2m", t), 0), t => tempCell(at("temperature_2m", t)))}
        ${row("降水確率 %", t => at("precipitation_probability", t) ?? "—", t => rainCell(at("precipitation_probability", t)))}
        ${row("雨 mm", t => { const v = at("precipitation", t); return v == null ? "—" : v ? fmt(v) : "0"; }, t => rainMmCell(at("precipitation", t)))}
      </tbody></table></div>`;
    const box = el.firstElementChild;
    const key = `${state.place?.name}:${state.day}`;
    if (tlScroll["wx-tl"] !== key) { tlScroll["wx-tl"] = key; box.scrollLeft = Math.max(0, h - 1) * 40; } else box.scrollLeft = keep;
    box.onclick = ev => { const td = ev.target.closest("td[data-h]"); if (td) setHour(Number(td.dataset.h)); };
  } else document.getElementById("wx-tl").innerHTML = `<p class="muted small">読みこみ中…</p>`;

  // まとめ・場所の行・送るカードに使う、えらんだ時刻の値
  const pop = d.pops.find(p => p.ymd === day.ymd && h >= p.from && h < p.from + 6);
  const gusts = wind.map(s => s.gust[h]).filter(v => v != null);
  // つぎの満潮・干潮。その日にもうなければ、つぎの日のいちばん早いもの（「あす 満潮 4:57」）
  let nextTide = tideEvents(tide, hm).find(t => hm(t.time) >= h) || null;
  if (!nextTide && tide) {
    const first = tideEvents(tideFor(dayLabel(state.day + 1).ymd), hm)[0] || null;
    if (first) nextTide = { ...first, when: state.day === 0 ? "あす " : `${dayLabel(state.day + 1).text.replace(/（.）$/, "")} ` };
  }
  const at = (key, t = h) => wh ? sliceDay(wh[key], state.day)[t] : null;
  const v = {
    day, h, tide, tideDiff, nextTide, mz, cur, curText, amedas, pop, text,
    sst: sliceDay(d.sea?.hourly?.sea_surface_temperature, state.day)[h],
    code: at("weather_code"), rain: at("precipitation_probability"), temp: at("temperature_2m"),
    wr: range(waves.map(s => valueAt(s, h))),
    waveTop: text?.nums.length ? Math.max(...text.nums) : null,
    wind: range(wind.map(s => valueAt(s, h))),
    windCount: wind.filter(s => valueAt(s, h) != null).length,
    windDir: wind.map(s => s.dir[h]).find(x => x != null),
    gustMax: gusts.length ? Math.max(...gusts) : null,
  };
  drawPlaceInfo(v);
  drawSummary(v);
  drawShare(v);
  diaryNow(diaryContext(v));
  // ウィジェットと同じ小さいグラフ（押すと詳しい欄へ）
  drawChart(document.getElementById("mini-wave"), { series: waves, bands, yFloor: 0, unit: "m", mini: true, waiting: waveWait });
  drawChart(document.getElementById("mini-wind"), { series: wind, bands, yFloor: 0, unit: "m/s", mini: true, waiting: windWait, arrows: windArrows(wind) });
  if (tideS.length) drawChart(document.getElementById("mini-tide"), { series: tideS.slice(0, 1), bands, marks, unit: "cm", mini: true });
  // qcheck-ok: W1 決まった文字だけ
  else document.getElementById("mini-tide").innerHTML = `<p class="muted small" style="margin:8px 0 0">${tideWait ? "読みこみ中…" : "潮汐表は日本の港だけ"}</p>`;
}

// ---- まとめ・場所の行・送る ----
const GO = `<span class="go ls-icon" data-icon="next" aria-hidden="true"></span>`;
// まとめの数字のカード（押すとその欄へ）
const fact = ({ href, ic, title, value, unit = "", note = "", text = false }) =>
  `<a class="fact" href="${href}"><span class="dt">${icon(ic)}${title}</span><span class="dd${text ? " text" : ""}">${value}${unit ? `<span class="unit">${unit}</span>` : ""}<span class="note">${note}</span></span>${GO}</a>`;
// グラフ1つと、その下の数字のカード
const group = (href, ic, title, chartId, facts) => `<div class="sum-group">
    <a class="mini" href="${href}"><span class="mini-title">${icon(ic)}${title}${GO}</span><div id="${chartId}"></div></a>
    <div class="facts">${facts.join("")}</div>
  </div>`;
// 見出しに出す場所の名前（同じ名前がほかにもある・位置で選んだときは市町村を添える）
function placeTitle() {
  const p = state.place, jma = state.ctx?.jma;
  return `${p.alts ? baseName(p.name) : p.name}${(p.coords || p.alts || p.pinned) && jma ? `（${jma.muniName}）` : ""}`;
}
// 3時間ごとに、予報をならした向き（ウィジェットと同じ。45° より割れていればうすく）
function windArrows(wind) {
  const list = [];
  for (let t = 0; t <= 24; t += 3) {
    const k = Math.min(23, t);
    const md = meanDir(wind.map(s => ({ sp: valueAt(s, k), dir: s.dir[k] })));
    if (md) list.push({ x: t, deg: md.deg, faint: md.spread > 45, calm: md.calm });
  }
  return list;
}

function drawPlaceInfo({ day, h }) {
  const p = state.place, ctx = state.ctx;
  document.getElementById("place-info").innerHTML = `
    <div class="summary-head"><strong>${esc(placeTitle())}</strong><span class="sub">${day.short} ${h}時${ctx.jma ? "" : "（日本時間）"}</span></div>
    <p class="where">潮：${ctx.port ? `${esc(ctx.port.name)}の港（${ctx.port.km.toFixed(0)}km）` : "—"}　${NAMES.jma}：${ctx.jma ? esc(ctx.jma.name) : "—"}</p>
    ${p.alts ? `<details class="alts"${altsOpen ? " open" : ""}><summary>ほかにも「${esc(baseName(p.name))}」があります（${p.alts.length}か所）</summary>
      <ul>${p.alts.map((a, i) => `<li><button type="button" data-alt="${i}"><span>${esc(a.label)}</span>${GO}</button></li>`).join("")}</ul></details>` : ""}`;
}

// 潮（天気も）→ 波 → 風 の順に（ウィジェットと同じ）、グラフ → 数字のカード
function drawSummary(v) {
  const ctx = state.ctx, { tide, nextTide, mz, h } = v;
  const tideNote = !tide ? (tideWaiting(v.day.ymd) ? "読みこみ中…" : ctx.port ? "読めませんでした" : "日本の港だけ")
    : nextTide ? `${v.tideDiff ? `${v.tideDiff}<br>` : ""}つぎ ${nextTide.when || ""}${nextTide.k} ${esc(nextTide.time)}` : "満潮・干潮の時刻を読めませんでした";
  const windNote = [
    v.windDir != null ? (state.windDir === "deg" ? `向き ${windDirText(v.windDir)}` : `${dirName(v.windDir)}の風`) : "",
    v.gustMax != null ? `突風 ${fmt(v.gustMax, 0)} m/s まで` : "",
    v.amedas?.wind != null ? `実況 ${fmt(v.amedas.wind)} m/s（${esc(v.amedas.name)} ${esc(v.amedas.time)}）` : "",
  ].filter(Boolean).join("<br>");
  document.getElementById("summary").innerHTML = `<div class="sum-groups">
  ${group("#sec-tide", "moon", `潮${tide ? ` ${esc(tide.moon.title)}` : ""}`, "mini-tide", [
    fact({ href: "#sec-tide", ic: "moon", title: "潮", value: tide ? esc(tide.moon.title) : "—", note: tideNote }),
    fact({ href: "#sec-tide", ic: "sunrise", title: "朝まづめ（めやす）", value: mz ? `${hmText(mz.morning[0])}〜${hmText(mz.morning[1])}` : "—", note: mz ? `夕まづめ ${hmText(mz.evening[0])}〜${hmText(mz.evening[1])}` : "日本の港だけ" }),
    fact({ href: "#sec-wave", ic: "thermometer", title: "水温", value: fmt(v.sst), unit: "℃", note: v.cur ? `沖の流れ ${v.curText}` : NAMES.openMeteo }),
    fact({ href: "#sec-weather", ic: "cloud-sun", title: `天気（${h}時）`, value: v.code != null ? esc(wxName(v.code)) : "—", text: true,
      note: `${v.rain != null ? `降水確率 ${v.rain}%` : ""}${v.pop ? `・${NAMES.jma} ${esc(v.pop.pop)}%（${v.pop.from}〜${v.pop.from + 6}時）` : ""}` }),
  ])}
  ${group("#sec-wave", "waves", "波 m", "mini-wave", [
    fact({ href: "#sec-wave", ic: "waves", title: "波（4つの予報）", value: v.wr ? spread(v.wr) : "—", unit: "m", note: v.wr && v.wr.n > 1 ? `いちばん大きい差 ${fmt(v.wr.hi - v.wr.lo)} m` : "" }),
    fact({ href: "#waves", ic: "waves", title: `波（${NAMES.jma}）`, value: v.waveTop == null ? "—" : fmt(v.waveTop), unit: v.waveTop == null ? "" : "m まで",
      note: v.text?.wave ? esc(v.text.wave) : !ctx.jma ? "日本だけ" : state.day > 2 ? "3日先まで" : "" }),
  ])}
  ${group("#sec-wind", "wind", "風 m/s", "mini-wind", [
    fact({ href: "#sec-wind", ic: "wind", title: `風（${v.windCount}つの予報）`, value: v.wind ? spread(v.wind) : "—", unit: "m/s", note: windNote }),
  ])}
  </div>${isoHtml(v)}`;
}

// ---- 磯割（data/isowari.json の島だけ）：その日の渡船ごとの磯と、7日ぶんの磯・昼の波・風 ----
// その日の昼（5〜15時）の、予報をならした値のいちばん大きいもの
function dayTop(h, keys, i) {
  if (!h) return null;
  let top = null;
  for (let t = 5; t <= 15; t++) {
    const vals = keys.map(k => h[k]?.[i * 24 + t]).filter(x => x != null);
    if (vals.length) top = Math.max(top ?? -Infinity, avg(vals));
  }
  return top;
}
function isoHtml(v) {
  const isl = islandFor(state.place);
  if (!isl) return "";
  const d = state.data, ferries = ferriesOf(isl), mine = myFerries(isl);
  // 表は選んだ渡船だけ（選んでいなければ全部）。1つだけなら、まとまりの名前を全部
  const cols = mine.length ? ferries.filter(f => mine.includes(f)) : ferries;
  const one = cols.length === 1 ? cols[0] : null;
  const today = isoOn(isl, v.day.ymd);
  const until = isoUntil(isl);
  const untilText = until ? `${Number(until.slice(5, 7))}月${Number(until.slice(8))}日` : "";
  // 渡船のピル：船の色の丸・渡船の名前・その日の磯。押すと、いつもの渡船に入れる・外す（いくつでも）
  const pill = f => {
    const g = today?.find(x => x.ferry === f)?.group;
    return `<button type="button" class="ls-chip is-small iso-pill" data-ferry="${esc(f)}" aria-pressed="${mine.includes(f)}"${ferryStyle(isl, f)}><i class="ferry-dot"></i><span class="iso-pill-ferry">${esc(ferryShort(f))}</span>${g ? `<strong>${esc(g)}</strong>` : ""}</button>`;
  };
  const none = today ? "" : `<p class="muted small iso-none">${v.day.short}の磯割は、まだ発表されていません（${untilText}まで）。</p>`;
  const rows = Array.from({ length: DAYS }, (_, i) => {
    const day = dayLabel(i), iso = isoOn(isl, day.ymd);
    return { i, day, iso,
      wave: dayTop(d.waves?.hourly, WAVE_MODELS.map(k => `wave_height_${k}`), i),
      wind: dayTop(d.wind?.hourly, WIND_MODELS.map(k => `wind_speed_10m_${k}`), i) };
  });
  const cell = (r, f) => { const x = r.iso?.find(y => y.ferry === f); return x ? esc(one ? x.group : groupFirst(x.group)) : "—"; };
  // 渡船の列は船の色でうすく塗る（磯割表と同じ色分け）
  const tint = f => { const st = ferryStyle(isl, f); return st ? ` class="is-ferry"${st}` : ""; };
  // qcheck-ok: W1 島のデータ（このリポジトリの data/isowari.json）は esc する
  return `<div class="iso" id="iso">
    <h3 class="iso-title">${icon("place")}磯割（${esc(isl.name)}）<span class="sub small">${v.day.short}</span></h3>
    <div class="ls-chips iso-pills" role="group" aria-label="いつもの渡船（いくつでも）">${ferries.map(pill).join("")}</div>
    ${none}
    <div class="table-wrap"><table class="compact iso-days">
      <thead><tr><th>日</th>${cols.map(f => `<th${tint(f)}>${esc(ferryShort(f))}${one ? "の磯" : ""}</th>`).join("")}<th class="num">波 m</th><th class="num">風 m/s</th></tr></thead>
      <tbody>${rows.map(r => `<tr data-iso-day="${r.i}" class="${r.i === state.day ? "on" : ""}"><th>${r.i < 2 ? r.day.text.replace(/（.）$/, "") : r.day.text.replace(/（(.)）$/, "$1")}</th>${cols.map(f => `<td${tint(f)}>${cell(r, f)}</td>`).join("")}<td class="num">${fmt(r.wave)}</td><td class="num">${fmt(r.wind)}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="muted small iso-note">波と風は、昼（5〜15時）の予報をならした値のいちばん大きいもの。行を押すとその日に。磯割は渡船の発表（${untilText}まで）を、毎日くり返す順番として出しています。当日の磯は渡船屋さんに確かめてください。</p>
    <div class="muted small iso-note">出どころ<ul class="iso-src">${isl.sources.map(x => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a></li>`).join("")}</ul></div>
  </div>`;
}

// おくるんのカード（いま見ている日・時刻のめやす）と、リンクの共有。カードのボタンは、受けとった人がその場所のいまの予報を開くリンク
function drawShare(v) {
  const box = document.getElementById("share");
  box.hidden = false;
  box.innerHTML = `<h2 class="share-title">${esc(baseName(state.place.name))}の海を送る</h2>
    <div class="share-row">${canCard() ? `<a class="ls-button line is-oqrn" id="send-card" href="${esc(cardUrl(v))}">カードでおくるん</a>` : ""}<button type="button" class="ls-button" id="share-link">${icon(navigator.share ? "share" : "link")}${navigator.share ? "リンクを共有" : "リンクをコピー"}</button></div>
    <p class="muted small share-note">カードには ${v.day.short} ${v.h}時のめやす（波・風・潮・天気・水温）が入り、カードのボタンからこの場所の${NAMES.app}が開きます。</p>`;
}
function cardUrl(v) {
  const lines = [
    v.wr ? `🌊 波 ${spread(v.wr)} m` : "",
    v.wind ? `💨 風 ${v.windDir != null ? `${dirName(v.windDir)} ` : ""}${spread(v.wind)} m/s${v.gustMax != null ? `（突風 ${fmt(v.gustMax, 0)}）` : ""}` : "",
    v.tide ? `🌙 ${v.tide.moon.title}${v.tideDiff ? `・${v.tideDiff}` : ""}${v.nextTide ? `\n　 つぎ ${v.nextTide.when || ""}${v.nextTide.k} ${v.nextTide.time}` : ""}` : "",
    v.code != null ? `☁️ ${wxName(v.code)}${v.rain != null ? `・降水確率 ${v.rain}%` : ""}` : "",
    v.sst != null ? `🌡️ 水温 ${fmt(v.sst)}℃` : "",
  ].filter(Boolean);
  return oqrnCardUrl({
    header: `🌊 ${NAMES.app}`,
    date: `🕒 ${v.day.short} ${v.h}時のめやす`,
    title: placeTitle(),
    detail: lines.join("\n") || "予報を読みこめませんでした",
    actionUrl: shareUrl(),
  });
}

// 日記に渡す、いま見ている場所・日時（日記はこの場所で書き、その日1日ぶんの予報・潮・観測を残す）
function diaryContext(v) {
  const p = state.place;
  return {
    day: v.day, h: v.h,
    place: { name: p.alts ? baseName(p.name) : p.name, lat: p.lat, lon: p.lon, pinned: true },
    placeTitle: placeTitle(),
  };
}

// ---- 流れ ----
const statusEl = () => document.getElementById("status");
// 読みこみ中の知らせ：ボタンを「さがし中…」に、知らせの行に動く線、前の場所の表示はうすく。text が null で終わり
let doneTimer = 0;
function busy(text, { dim = false, button = "" } = {}) {
  const st = statusEl(), btn = document.getElementById("place-go");
  clearTimeout(doneTimer);
  st.classList.toggle("is-busy", text != null);
  if (text != null) st.textContent = text;
  document.body.classList.toggle("is-loading", text != null && dim);
  btn.disabled = text != null && !!button;
  btn.classList.toggle("is-busy", text != null);
  btn.textContent = text != null && button ? button : "見る";
}
// 終わりの知らせ（少しして消す）
function doneNote(text, keep = false) {
  busy(null);
  statusEl().textContent = text;
  if (!keep) doneTimer = setTimeout(() => { statusEl().textContent = ""; }, 2500);
}
// ask … さがして開いたとき。同じ名前のほかの場所があれば、トーストで知らせる
async function go(place, { ask = false } = {}) {
  const name = place.alts ? baseName(place.name) : place.name;
  busy(`${name}を読みこみ中…`, { dim: true });
  try {
    const ctxP = placeContext(place);
    const token = state.token = {};
    const tideP = ctxP.then(ctx => { state.ctx = ctx; return ctx.port ? loadTide(ctx.port, dayLabel(state.day).ymd).catch(() => null) : null; });
    const data = await loadForecasts(place, ctxP, part => {
      if (token !== state.token || !state.ctx) return;
      state.place = place; state.data = part;
      busy(`${name}を読みこみ中…（届いたものから表示）`);
      render();
    });
    if (token !== state.token) return;
    state.ctx = await ctxP; await tideP;
    state.place = place; state.data = data;
    remember(place);
    // アドレス欄も、いま見ている場所のリンクにする（ブラウザの共有・再読みこみで同じ場所が開く）
    history.replaceState(null, "", `?q=${encodeURIComponent(placeParam())}${location.hash}`);
    drawHowto();
    await refreshTide();
    // MSM は日本のまわりだけなので、日本の外では読めなくてよい
    const names = { wx: "天気", wind: "風", msm: state.ctx.jma ? "風（MSM）" : null, waves: "波", sea: "水温・海流・海面", jma: `${NAMES.jma}の予報`, amedas: NAMES.amedas, warn: `${NAMES.jma}の警報` };
    const errs = data.errors.map(k => names[k]).filter(Boolean);
    doneNote(errs.length ? `読めなかったもの：${errs.join("・")}` : `${name}を表示しました`, errs.length > 0);
    if (ask && place.alts?.length) altsToast(place);
  } catch (e) {
    doneNote("読みこめませんでした。通信を確かめてください。", true);
  }
}
async function refreshTide() {
  // その日と、つぎの日（その日の満潮・干潮が終わっていたら、つぎの日の分を出すため）
  if (state.ctx?.port) await Promise.all([state.day, state.day + 1].map(i => loadTide(state.ctx.port, dayLabel(i).ymd).catch(() => null)));
  render();
}
function remember(place) {
  const list = (store.get("umiqru:recent") || []).filter(p => p.name !== place.name);
  list.unshift(place);
  store.set("umiqru:recent", list.slice(0, 6));
  drawRecent();
}
// いま見ている場所を開くリンク（?q= はウィジェットの Parameter と同じ書き方）
const shareUrl = () => pageUrl(placeParam());
// 同じ名前のほかの場所（開け閉めの欄から選ぶ）。選んだあとも、もとの場所を候補に残す
let altsOpen = false;
const placeInfo = document.getElementById("place-info");
placeInfo.addEventListener("toggle", ev => { if (ev.target.matches("details.alts")) altsOpen = ev.target.open; }, true);
document.getElementById("share").addEventListener("click", ev => {
  const share = ev.target.closest("#share-link");
  if (!share) return;
  const url = shareUrl();
  if (navigator.share) navigator.share({ title: `${baseName(state.place.name)}の海｜${NAMES.app}`, url }).catch(() => {});
  else copyText(() => url, share);
});
placeInfo.addEventListener("click", ev => {
  const b = ev.target.closest("[data-alt]");
  const cur = state.place, a = b && cur?.alts?.[Number(b.dataset.alt)];
  if (!a) return;
  altsOpen = false;
  const { alts, ...me } = cur;
  go({ ...a, alts: [me, ...alts.filter(x => x !== a)] });
});
// 同じ名前のほかの場所があることを、トーストで（Q キット）。押すと、えらびなおす欄を開く
function altsToast(place) {
  if (state.place !== place) return; // とちゅうでほかの場所に変えたとき
  const n = place.alts.length;
  window.LineShareUI?.toast(`ほかにも「${baseName(place.name)}」が${n}か所あります。いまは ${placeTitle()}`, {
    actionLabel: "えらびなおす", ms: 8000,
    onAction: () => { altsOpen = true; render(); placeInfo.scrollIntoView({ block: "start", behavior: "smooth" }); },
  });
}
function drawRecent() {
  const list = store.get("umiqru:recent") || [];
  const el = document.getElementById("recent");
  el.innerHTML = list.map((p, i) => `<button type="button" class="recent" data-i="${i}" aria-pressed="${state.place?.name === p.name}">${esc(p.name)}</button>`).join("");
  el.onclick = ev => { const b = ev.target.closest("button"); if (b) go(list[Number(b.dataset.i)]); };
}

// ---- iPhone のウィジェットにする ----
const SCRIPT_FILE = "SQriptableSea.js";
let scriptText = null;
const loadScript = () => scriptText ? Promise.resolve(scriptText) : fetch(SCRIPT_FILE).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }).then(t => (scriptText = t));
// いま見ている場所の Parameter（座標は4けたまで）
function placeParam(p = state.place) {
  if (!p) return "城ヶ島";
  if (p.coords || p.name === "今いる場所") return `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
  // 同じ名前の場所がほかにもあるときは、選んだ位置を名前つきで渡す（ウィジェットが別の場所を選ばないように）
  if (p.alts || p.pinned || /（.+）$/.test(p.name)) return `${p.lat.toFixed(4)},${p.lon.toFixed(4)}=${baseName(p.name)}`;
  return p.name;
}
async function copyText(get, btn) {
  const label = btn.innerHTML;
  try {
    // iPhone の Safari は、押したあとに読みこむと写せないので、読みこみごと渡す
    if (window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": Promise.resolve(get()).then(t => new Blob([t], { type: "text/plain" })) })]);
    } else {
      await navigator.clipboard.writeText(await get());
    }
    btn.textContent = "コピーしました";
  } catch {
    btn.textContent = "コピーできませんでした";
  }
  setTimeout(() => { btn.innerHTML = label; }, 2000);
}
function drawHowto() {
  const S = NAMES.scriptable, W = NAMES.widgetScript;
  document.getElementById("howto-title").textContent = "iPhone のウィジェットにする";
  document.getElementById("howto-lead").textContent = `${S}（無料のアプリ）に、このページと同じ海の予報を出すスクリプトを入れて、ホーム画面に置きます。`;
  // 磯割のある島で、いつもの渡船を選んでいれば、その渡船も（ウィジェットの下の行に、その渡船の磯）
  const isl = islandFor(state.place);
  const param = [placeParam(), ...myFerries(isl).map(ferryShort)].join(",");
  document.getElementById("howto-steps").innerHTML = `
    <li>App Store で「${S}」を入れる（無料）。</li>
    <li>下のボタンでスクリプトをコピーする。
      <div class="copyrow"><button type="button" class="primary" id="copy-script"><span class="ls-icon" data-icon="copy" aria-hidden="true"></span>スクリプトをコピー</button><a href="${SCRIPT_FILE}" class="small sub" rel="noopener">ファイルを開く</a></div></li>
    <li>${S} を開き、右上の「＋」を押す。白い画面を長押しして「ペースト」。</li>
    <li>上の名前（Untitled Script）を押して「${W}」に変え、左上の「Done」で閉じる。</li>
    <li>一覧の「${W}」を押すと、場所と出すものを選んで、その場で見られる（今いる場所を使うときは、位置情報を許可する）。</li>
    <li>ホーム画面のあいている所を長押し → 左上の「編集」→「ウィジェットを追加」→「${S}」→ 大きさを選ぶ（大がいちばん情報が多い）→「ウィジェットを追加」。</li>
    <li>置いたウィジェットを長押し →「ウィジェットを編集」→ Script で「${W}」を選び、Parameter に場所を書く。いま見ている場所なら：
      <div class="copyrow"><code class="param" id="howto-param">${esc(param)}</code><button type="button" id="copy-param"><span class="ls-icon" data-icon="copy" aria-hidden="true"></span>コピー</button></div></li>
    <li>ホーム画面にもどると表示される。ウィジェットを押すと、このページがその場所で開く。</li>`;
  document.getElementById("howto-params").innerHTML = `
    <thead><tr><th>書き方</th><th>出るもの</th></tr></thead>
    <tbody>
      <tr><td><code class="param">城ヶ島</code></td><td class="wrap">港の名前・地名で</td></tr>
      <tr><td><code class="param">20.4253,136.0814</code></td><td class="wrap">緯度・経度で（日本の外も）</td></tr>
      <tr><td><span class="muted">（空）</span></td><td class="wrap">今いる場所</td></tr>
      <tr><td><code class="param">城ヶ島</code><span class="muted">（小）</span></td><td class="wrap">小は、そのとき大事な1つ（強風・波浪の注意報、強い風・高い波、まづめの前後なら潮、ふだんは波）</td></tr>
      <tr><td><code class="param">城ヶ島,wave,wind</code></td><td class="wrap">書いたものだけを書いた順に（wave 波・tide 潮・wind 風）</td></tr>
      <tr><td><code class="param">城ヶ島,wind,deg</code></td><td class="wrap">風のグラフだけ・向きを角度で</td></tr>
      <tr><td><code class="param">鵜来島,家中</code></td><td class="wrap">磯割のある島は、大・中の下の行に渡船ごとの磯（14時までは今日のぶんを「昼釣り」、そこからは「明日」。4/15〜7/15 は13〜18時に次の日のぶんを「夕釣り」。時刻と季節はスクリプトのいちばん上の ISO_TIMES で変えられます）。渡船の名前を書くと、その渡船だけ（いくつでも）</td></tr>
    </tbody>`;
  document.getElementById("howto-note").textContent = `ウィジェットは iOS の都合で15分〜1時間ごとに描き直されます。Parameter の「,」や「:」が消えてしまうときは、${S} の中で「${W}」を一度開いて、出てくるメニューで作った Parameter を貼ってください。`;
  document.getElementById("copy-script").onclick = ev => copyText(loadScript, ev.currentTarget);
  document.getElementById("copy-param").onclick = ev => copyText(() => document.getElementById("howto-param").textContent, ev.currentTarget);
}

// ---- くわしい欄のタブ ----
// まとめ（ダッシュボード）が先頭。くわしい欄はウィジェットと同じ並び（潮・波・風・天気）
const TABS = ["summary", "tide", "wave", "wind", "weather", "diary"];
const panelOf = k => document.getElementById(k === "summary" ? "summary" : `sec-${k}`);
// key の欄だけを出す。scroll … true ならタブの帯、id ならその段が見えるところまで送る（まとめの項目を押したとき）
function showTab(key, scroll = false) {
  if (!TABS.includes(key)) key = TABS[0];
  TABS.forEach(k => {
    const on = k === key;
    const tab = document.getElementById(`tab-${k}`);
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    panelOf(k).hidden = !on;
  });
  store.set("umiqru:tab", key);
  // 隠れていた欄は幅が0なので、出してから描き直す。横スクロールの表は、えらんだ時刻まで送りなおす
  Object.keys(tlScroll).forEach(id => delete tlScroll[id]);
  render();
  if (key === "diary") drawDiary();
  // 描き直しで高さが変わったあとで送る。すぐに送ると、途中で止まることがある
  if (scroll) scrollToEl(typeof scroll === "string" ? scroll : "place-info");
}
const scrollToEl = id => setTimeout(() => document.getElementById(id).scrollIntoView({ block: "start" }), 50);
function initTabs() {
  const bar = document.getElementById("tabs");
  bar.addEventListener("click", ev => { const b = ev.target.closest("[data-tab]"); if (b) showTab(b.dataset.tab); });
  // ← → で となりのタブへ
  bar.addEventListener("keydown", ev => {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    const i = TABS.indexOf(store.get("umiqru:tab"));
    const next = TABS[(i + (ev.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    showTab(next);
    document.getElementById(`tab-${next}`).focus();
  });
  // まとめの項目（#sec-wave など）を押したら、その欄に切りかえてタブの帯まで
  document.getElementById("summary").addEventListener("click", ev => {
    const a = ev.target.closest('a[href^="#"]');
    if (!a) return;
    const href = a.getAttribute("href");
    // #sec-wave … その欄へ。#waves … 波の欄の中の、気象庁の波の段へ
    const key = href.startsWith("#sec-") ? href.slice(5) : href === "#waves" ? "wave" : null;
    if (!key) return;
    ev.preventDefault();
    showTab(key, href === "#waves" ? "waves" : true);
  });
  const fromHash = location.hash.startsWith("#sec-") ? location.hash.slice(5) : null;
  showTab(fromHash || store.get("umiqru:tab") || TABS[0], !!fromHash);
}

// 日を選ぶ（今日はいまの時刻、ほかの日は6時から）
function pickDay(i) {
  state.day = i;
  state.hour = i === 0 ? tokyoParts().hour : 6;
  refreshTide();
}

// 前の版のページ（index.html）のまま新しい app.js を読んだときは、1回だけ読みなおす（新しい部品がないと動かないので）
function staleHtml() {
  if (document.getElementById("map-pick")) return false;
  let tried = true;
  try { tried = sessionStorage.getItem("umiqru:reloaded") === "1"; sessionStorage.setItem("umiqru:reloaded", "1"); } catch {}
  if (!tried) location.reload();
  return true;
}

function init() {
  if (staleHtml()) return;
  state.render = render;
  // 電波がなくても、一度開いたページは開けるように（中身は Q キットの sw-core.js）
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  const input = document.getElementById("place-input");
  document.getElementById("place-form").addEventListener("submit", async ev => {
    ev.preventDefault();
    if (!input.value.trim()) { doneNote("場所を入れてください（港・地名・緯度経度）"); input.focus(); return; }
    busy(`「${input.value.trim()}」をさがしています…`, { button: "さがし中…" });
    try { const p = await findPlace(input.value); input.value = ""; input.blur(); go(p, { ask: true }); }
    catch (e) { doneNote(e.message, true); }
  });
  // 地図で選ぶ：押した所の「緯度,経度」（名前をつけたら「緯度,経度=名前」）を、検索と同じ道で見る
  initMapPick(copyText);
  document.getElementById("map-open").addEventListener("click", () => openMapPick(state.place, q => {
    input.value = q;
    document.getElementById("place-form").requestSubmit();
  }));
  // 今いる場所は「地図で選ぶ」の中の「現在地」で（js/mappick.js）
  const days = document.getElementById("days");
  days.innerHTML = Array.from({ length: DAYS }, (_, i) => `<button type="button" data-i="${i}">${dayLabel(i).text}</button>`).join("");
  days.addEventListener("click", ev => {
    const b = ev.target.closest("button");
    if (!b) return;
    pickDay(Number(b.dataset.i));
  });
  state.hour = tokyoParts().hour;
  // 磯割：いつもの渡船を選ぶ・表の行でその日に
  document.getElementById("summary").addEventListener("click", ev => {
    const f = ev.target.closest("[data-ferry]");
    if (f) {
      // 押すたびに入れる・外す（いくつでも）
      const isl = islandFor(state.place), list = myFerries(isl), name = f.dataset.ferry;
      setMyFerries(isl, list.includes(name) ? list.filter(x => x !== name) : [...list, name]);
      render();
      drawHowto();
      return;
    }
    const r = ev.target.closest("[data-iso-day]");
    if (r && Number(r.dataset.isoDay) !== state.day) pickDay(Number(r.dataset.isoDay));
  });
  // 島のデータが届いたら、いま島を見ているときだけ描きなおす
  loadIso().then(() => { if (islandFor(state.place)) { render(); drawHowto(); } });
  document.querySelectorAll(".seg").forEach(seg => seg.addEventListener("click", ev => {
    const b = ev.target.closest("[data-dir]");
    if (!b || b.dataset.dir === state.windDir) return;
    state.windDir = b.dataset.dir;
    store.set("umiqru:winddir", state.windDir);
    render();
  }));

  // 出どころ：1つの出どころを1行に
  const modelRow = (k, kind) => `<li><b>${kind}「${SOURCES[k].label}」</b>${esc(SOURCES[k].org)}の${esc(SOURCES[k].full)}（マス目 ${SOURCES[k].grid}）</li>`;
  document.getElementById("credits").innerHTML = `
    <p class="credits-head">出どころ</p>
    <ul class="credits">
      <li><b><a href="https://www.jma.go.jp/bosai/" rel="noopener">${NAMES.jma}</a></b>府県天気予報の天気・風・波・降水確率、警報と注意報、アメダスのいまの観測（風・気温）</li>
      <li><b><a href="https://tide736.net/" rel="noopener">${NAMES.tide736}</a></b>潮汐表（${SOURCES.tide736.full}）</li>
      ${WAVE_MODELS.map(k => modelRow(k, "波")).join("")}
      ${WIND_MODELS.map(k => modelRow(k, "風")).join("")}
      <li><b><a href="https://open-meteo.com/" rel="noopener">${NAMES.openMeteo}</a></b>上の波・風の予報（気象庁の MSM・GSM も）と、突風（GFS・IFS）・天気・水温・沖の海流・海面の高さ・地名さがしを、緯度経度で読む（CC BY 4.0）</li>
      <li><b>${NAMES.gsi}</b>場所から市区町村（気象庁の地域を決める）。「地図で選ぶ」の地図と写真（地理院タイル。地図を動かすのは <a href="https://leafletjs.com/" rel="noopener">${NAMES.leaflet}</a>）</li>
    </ul>
    <p>予報は計算のめやすです。航海には使えません。海に出るかどうかは、${NAMES.jma}の警報・注意報と現地のようすで決めてください。</p>`;
  // 波・風のグラフの下の「それぞれの予報」
  const modelItem = k => `<li>${SOURCES[k].dash ? dashSwatch(SOURCES[k].color) : `<i style="background:var(${SOURCES[k].color})"></i>`}<b>${SOURCES[k].label}</b>${esc(SOURCES[k].org)}の${esc(SOURCES[k].full)}。マス目 ${SOURCES[k].grid}</li>`;
  document.querySelector("#wave-models ul").innerHTML = WAVE_MODELS.map(modelItem).join("") + `<li><i class="dash"></i><b>${NAMES.jma}</b>府県天気予報の波の文（数字の予報は無料で出ていないので、文の高さを点線で重ねる）</li>`;
  document.querySelector("#wind-models ul").innerHTML = WIND_MODELS.map(modelItem).join("");


  let t;
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(render, 150); });
  drawRecent();
  drawHowto();
  drawDiaryShell();
  initDiary({
    // 日記の日時を変えたら、ページもその日・時刻に（その予報を日記に残せるように）
    setView(day, hour) {
      if (day !== state.day) { state.day = day; state.hour = hour; refreshTide(); }
      else setHour(hour);
    },
    // 日記の場所を開く（今日の、まとめのタブで）
    openPlace(e) {
      state.day = 0; state.hour = tokyoParts().hour;
      go(e.place);
      showTab("summary", true);
    },
  });
  initTabs();
  // ウィジェットの「新しい版があります」の通知から開いたとき（#howto）は、入れ方の欄を開いてそこまで
  if (location.hash === "#howto") {
    const det = document.getElementById("howto");
    det.open = true;
    setTimeout(() => det.scrollIntoView({ block: "start" }), 300);
  }
  // いまの版（ウィジェットが新しい版を見つけるときにくらべる番号）
  fetch("sea-version.json").then(r => r.ok ? r.json() : null).then(v => {
    if (v?.build) document.getElementById("howto-version").textContent = `いまの版：${v.build}（${v.date}）。新しい版が出ると、ウィジェットが iPhone の通知で知らせます。知らせが来たら、上のボタンでもう一度コピーし、${NAMES.scriptable} で「${NAMES.widgetScript}」を開いて、中身を全部選んでからペーストし、「Done」で閉じてください（Parameter はそのまま使えます）。`;
  }).catch(() => {});
  document.getElementById("howto").addEventListener("toggle", ev => {
    const open = ev.currentTarget.open;
    ev.currentTarget.querySelector("summary .sub").textContent = open ? "閉じる" : "開く";
    if (open) loadScript().catch(() => {});
  });
  // ?q=20.4253,136.0814 や ?q=城ヶ島 のリンクで、その場所を開く
  const q = new URLSearchParams(location.search).get("q");
  // ボットの釣りの記録からのリンク（&d=日にち&c=釣果）：場所を開いたら、日記のタブで、その日の釣果を入れた「日記を書く」を開く
  // （go がアドレス欄を ?q= だけにするので、先に読んでおく）
  const pre = prefillFromUrl(location.search);
  rememberBot(location.search); // ボットのカードからのリンクなら、そのボットを覚える（日記の「ボットに送る」）
  const tideDay = tideFromUrl(location.search); // ボットのカードの「🌊 潮をうみくるで直す」から：その日の潮を送る窓
  const opened = (p) => go(p, p === known ? {} : { ask: true }).then(() => {
    if (tideDay) openTideSend(tideDay);
    else if (pre) { showTab("diary", true); diaryPrefill(pre); }
  });
  const last = (store.get("umiqru:recent") || [])[0];
  // 最近見た場所と同じリンクなら、覚えている場所（同じ名前のほかの候補つき）で開く
  const known = q && (store.get("umiqru:recent") || []).find(p => placeParam(p) === q);
  if (known) opened(known);
  else if (q) findPlace(q).then(opened).catch(e => { doneNote(e.message, true); });
  else if (last) go(last);
  else findPlace(DEFAULT_PLACE).then(go).catch(e => { doneNote(e.message, true); });
}
init();
