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
import { arrow, dirName, esc, fmt, rainCell, rainMmCell, range, tempCell, tideEvents, tideRange, valueAt, wxName, wxShort } from "./js/format.js";
import { dashSwatch, drawChart, legend, timeline, tlScroll } from "./js/chart.js";

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
// まづめ：薄明のはじまり〜日の出の1時間後、日の入りの1時間前〜薄明のおわり（めやす）
function mazume(tide) {
  if (!tide?.sun) return null;
  const s = tide.sun;
  const rise = hm(s.rise), set = hm(s.set);
  const [tw0, tw1] = (s.regular_twilight || []).map(hm);
  return { rise, set, morning: [tw0 ?? rise - 0.5, rise + 1], evening: [set - 1, tw1 ?? set + 0.5] };
}

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

  // まとめ
  const pop = d.pops.find(p => p.ymd === day.ymd && h >= p.from && h < p.from + 6);
  const r = range(wind.map(s => valueAt(s, h)));
  const windDir = wind.map(s => s.dir[h]).find(v => v != null);
  const gusts = wind.map(s => s.gust[h]).filter(v => v != null);
  const gustMax = gusts.length ? Math.max(...gusts) : null;
  const events = tideEvents(tide, hm);
  // つぎの満潮・干潮。その日にもうなければ、つぎの日のいちばん早いもの（「あす 満潮 4:57」）
  let nextTide = events.find(t => hm(t.time) >= h) || null;
  if (!nextTide && tide) {
    const t2 = tideFor(dayLabel(state.day + 1).ymd);
    const first = tideEvents(t2, hm)[0] || null;
    if (first) nextTide = { ...first, when: state.day === 0 ? "あす " : `${dayLabel(state.day + 1).text.replace(/（.）$/, "")} ` };
  }
  const waveTop = text?.nums.length ? Math.max(...text.nums) : null;
  const wr = range(waveSeries(d).map(s => valueAt(s, h)));
  const sst = sliceDay(d.sea?.hourly?.sea_surface_temperature, state.day)[h];
  const waveIcon = `<span class="ls-icon is-text" data-icon="waves" aria-hidden="true"></span>`;
  const moonIcon = `<span class="ls-icon is-text" data-icon="moon" aria-hidden="true"></span>`;
  document.getElementById("place-info").innerHTML = `
    <div class="summary-head"><strong>${esc(state.place.name)}${state.place.coords && ctx.jma ? `（${esc(ctx.jma.muniName)}）` : ""}</strong><span class="sub">${day.short} ${h}時${ctx.jma ? "" : "（日本時間）"}</span></div>
    <p class="where">潮：${ctx.port ? `${esc(ctx.port.name)}の港（${ctx.port.km.toFixed(0)}km）` : "—"}　${NAMES.jma}：${ctx.jma ? esc(ctx.jma.name) : "—"}</p>`;
  document.getElementById("summary").innerHTML = `
    <div class="minis">
      <a class="mini" href="#sec-wave"><span class="mini-title">${waveIcon}波 m<span class="go ls-icon" data-icon="next" aria-hidden="true"></span></span><div id="mini-wave"></div></a>
      <a class="mini" href="#sec-tide"><span class="mini-title">${moonIcon}潮${tide ? ` ${esc(tide.moon.title)}` : ""}<span class="go ls-icon" data-icon="next" aria-hidden="true"></span></span><div id="mini-tide"></div></a>
    </div>
    <div class="facts">
      <a class="fact" href="#sec-wave"><span class="dt"><span class="ls-icon is-text" data-icon="waves" aria-hidden="true"></span>波（4つの予報）</span><span class="dd">${wr ? (wr.n > 1 && wr.hi - wr.lo >= 0.05 ? `${fmt(wr.lo)}〜${fmt(wr.hi)}` : fmt(wr.hi)) : "—"}<span class="unit">m</span><span class="note">${wr && wr.n > 1 ? `いちばん大きい差 ${fmt(wr.hi - wr.lo)} m` : ""}</span></span><span class="go ls-icon" data-icon="next" aria-hidden="true"></span></a>
      <a class="fact" href="#waves"><span class="dt"><span class="ls-icon is-text" data-icon="waves" aria-hidden="true"></span>波（${NAMES.jma}）</span><span class="dd">${waveTop == null ? "—" : fmt(waveTop)}<span class="unit">${waveTop == null ? "" : "m まで"}</span><span class="note">${text?.wave ? esc(text.wave) : (!ctx.jma ? "日本だけ" : state.day > 2 ? "3日先まで" : "")}</span></span><span class="go ls-icon" data-icon="next" aria-hidden="true"></span></a>
      <a class="fact" href="#sec-wind"><span class="dt"><span class="ls-icon is-text" data-icon="wind" aria-hidden="true"></span>風（${wind.filter(s => valueAt(s, h) != null).length}つの予報）</span><span class="dd">${r ? (r.n > 1 && r.hi - r.lo >= 0.05 ? `${fmt(r.lo)}〜${fmt(r.hi)}` : fmt(r.hi)) : "—"}<span class="unit">m/s</span><span class="note">${windDir != null ? (state.windDir === "deg" ? `向き ${windDirText(windDir)}` : `${dirName(windDir)}の風`) : ""}${gustMax != null ? `<br>突風 ${fmt(gustMax, 0)} m/s まで` : ""}${amedas?.wind != null ? `<br>実況 ${fmt(amedas.wind)} m/s（${esc(amedas.name)} ${esc(amedas.time)}）` : ""}</span></span><span class="go ls-icon" data-icon="next" aria-hidden="true"></span></a>
      <a class="fact" href="#sec-tide"><span class="dt"><span class="ls-icon is-text" data-icon="moon" aria-hidden="true"></span>潮</span><span class="dd">${tide ? esc(tide.moon.title) : "—"}<span class="note">${!tide ? (tideWaiting(day.ymd) ? "読みこみ中…" : ctx.port ? "読めませんでした" : "日本の港だけ") : nextTide ? `${tideDiff ? `${tideDiff}<br>` : ""}つぎ ${nextTide.when || ""}${nextTide.k} ${esc(nextTide.time)}` : "満潮・干潮の時刻を読めませんでした"}</span></span><span class="go ls-icon" data-icon="next" aria-hidden="true"></span></a>
      <a class="fact" href="#sec-tide"><span class="dt"><span class="ls-icon is-text" data-icon="sunrise" aria-hidden="true"></span>朝まづめ（めやす）</span><span class="dd">${mz ? `${hmText(mz.morning[0])}〜${hmText(mz.morning[1])}` : "—"}<span class="note">${mz ? `夕まづめ ${hmText(mz.evening[0])}〜${hmText(mz.evening[1])}` : "日本の港だけ"}</span></span><span class="go ls-icon" data-icon="next" aria-hidden="true"></span></a>
      <a class="fact" href="#sec-wave"><span class="dt"><span class="ls-icon is-text" data-icon="thermometer" aria-hidden="true"></span>水温</span><span class="dd">${fmt(sst)}<span class="unit">℃</span><span class="note">${cur ? `沖の流れ ${curText}` : NAMES.openMeteo}</span></span><span class="go ls-icon" data-icon="next" aria-hidden="true"></span></a>
      <a class="fact" href="#sec-weather"><span class="dt"><span class="ls-icon is-text" data-icon="cloud-sun" aria-hidden="true"></span>天気（${h}時）</span><span class="dd text">${wh ? esc(wxName(sliceDay(wh.weather_code, state.day)[h])) : "—"}<span class="note">${wh && sliceDay(wh.precipitation_probability, state.day)[h] != null ? `降水確率 ${sliceDay(wh.precipitation_probability, state.day)[h]}%` : ""}${pop ? `・${NAMES.jma} ${esc(pop.pop)}%（${pop.from}〜${pop.from + 6}時）` : ""}</span></span><span class="go ls-icon" data-icon="next" aria-hidden="true"></span></a>
    </div>`;
  // ウィジェットと同じ小さいグラフ（押すと詳しい欄へ）
  drawChart(document.getElementById("mini-wave"), { series: waves, bands, yFloor: 0, unit: "m", mini: true, waiting: waveWait });
  if (tideS.length) drawChart(document.getElementById("mini-tide"), { series: tideS.slice(0, 1), bands, marks, unit: "cm", mini: true });
  else document.getElementById("mini-tide").innerHTML = `<p class="muted small" style="margin:8px 0 0">${tideWait ? "読みこみ中…" : "潮汐表は日本の港だけ"}</p>`;
}

// ---- 流れ ----
const statusEl = () => document.getElementById("status");
async function go(place) {
  statusEl().textContent = "読みこみ中…";
  try {
    const ctxP = placeContext(place);
    const token = state.token = {};
    const tideP = ctxP.then(ctx => { state.ctx = ctx; return ctx.port ? loadTide(ctx.port, dayLabel(state.day).ymd).catch(() => null) : null; });
    const data = await loadForecasts(place, ctxP, part => {
      if (token !== state.token || !state.ctx) return;
      state.place = place; state.data = part;
      statusEl().textContent = "読みこみ中…（届いたものから表示）";
      render();
    });
    if (token !== state.token) return;
    state.ctx = await ctxP; await tideP;
    state.place = place; state.data = data;
    remember(place);
    drawHowto();
    await refreshTide();
    // MSM は日本のまわりだけなので、日本の外では読めなくてよい
    const names = { wx: "天気", wind: "風", msm: state.ctx.jma ? "風（MSM）" : null, waves: "波", sea: "水温・海流・海面", jma: `${NAMES.jma}の予報`, amedas: NAMES.amedas, warn: `${NAMES.jma}の警報` };
    const errs = data.errors.map(k => names[k]).filter(Boolean);
    statusEl().textContent = errs.length ? `読めなかったもの：${errs.join("・")}` : "";
  } catch (e) {
    statusEl().textContent = "読みこめませんでした。通信を確かめてください。";
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
function placeParam() {
  const p = state.place;
  if (!p) return "城ヶ島";
  return p.coords || p.name === "今いる場所" ? `${p.lat.toFixed(4)},${p.lon.toFixed(4)}` : p.name;
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
  const param = placeParam();
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
      <tr><td><code class="param">城ヶ島,wave,wind</code></td><td class="wrap">書いたものだけを書いた順に（wave 波・tide 潮・wind 風）</td></tr>
      <tr><td><code class="param">城ヶ島,wind,deg</code></td><td class="wrap">風の表だけ・向きを角度で</td></tr>
    </tbody>`;
  document.getElementById("howto-note").textContent = `ウィジェットは iOS の都合で15分〜1時間ごとに描き直されます。Parameter の「,」や「:」が消えてしまうときは、${S} の中で「${W}」を一度開いて、出てくるメニューで作った Parameter を貼ってください。`;
  document.getElementById("copy-script").onclick = ev => copyText(loadScript, ev.currentTarget);
  document.getElementById("copy-param").onclick = ev => copyText(() => document.getElementById("howto-param").textContent, ev.currentTarget);
}

// ---- くわしい欄のタブ ----
// まとめ（ダッシュボード）が先頭。くわしい欄はウィジェットと同じ並び（波・潮・風・天気）
const TABS = ["summary", "wave", "tide", "wind", "weather"];
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

function init() {
  state.render = render;
  // 電波がなくても、一度開いたページは開けるように（中身は Q キットの sw-core.js）
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  const input = document.getElementById("place-input");
  document.getElementById("place-form").addEventListener("submit", async ev => {
    ev.preventDefault();
    if (!input.value.trim()) return;
    statusEl().textContent = "さがしています…";
    try { const p = await findPlace(input.value); input.value = ""; input.blur(); go(p); }
    catch (e) { statusEl().textContent = e.message; }
  });
  document.getElementById("here").addEventListener("click", () => {
    if (!navigator.geolocation) { statusEl().textContent = "この端末では今いる場所を使えません"; return; }
    statusEl().textContent = "今いる場所をたしかめています…";
    navigator.geolocation.getCurrentPosition(
      pos => go({ name: "今いる場所", lat: +pos.coords.latitude.toFixed(3), lon: +pos.coords.longitude.toFixed(3) }),
      () => { statusEl().textContent = "今いる場所を使えませんでした"; },
      { maximumAge: 10 * 60 * 1000, timeout: 15000 });
  });
  const days = document.getElementById("days");
  days.innerHTML = Array.from({ length: DAYS }, (_, i) => `<button type="button" data-i="${i}">${dayLabel(i).text}</button>`).join("");
  days.addEventListener("click", ev => {
    const b = ev.target.closest("button");
    if (!b) return;
    state.day = Number(b.dataset.i);
    state.hour = state.day === 0 ? tokyoParts().hour : 6;
    refreshTide();
  });
  state.hour = tokyoParts().hour;
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
      <li><b>${NAMES.gsi}</b>場所から市区町村（気象庁の地域を決める）</li>
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
  const last = (store.get("umiqru:recent") || [])[0];
  if (q) findPlace(q).then(go).catch(e => { statusEl().textContent = e.message; });
  else if (last) go(last);
  else findPlace(DEFAULT_PLACE).then(go).catch(e => { statusEl().textContent = e.message; });
}
init();
