// うみくる：グラフ（線・夜の帯・満潮干潮の印）と、横にスクロールする1時間ごとの表
// 読まれるところ：app.js と js/ の部品
import { NAMES } from "./names.js";
import { setHour, state } from "./state.js";
import { arrow, esc, fmt, valueAt } from "./format.js";

// ---- グラフ ----
export function niceScale(min, max, count = 4) {
  if (!(max > min)) max = min + 1;
  const raw = (max - min) / count;
  const steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100];
  const step = steps.find(s => s >= raw) || 100;
  return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step };
}
// mini … まとめの小さいグラフ（目盛りの字・線の名前なし。触っても時刻は変えない。押すと詳しい欄へ）
export function drawChart(el, { series, bands = [], marks = [], yFloor = null, unit = "", endLabels = true, mini = false }) {
  const W = Math.max(mini ? 120 : 280, el.clientWidth || 320);
  const H = mini ? 80 : 200;
  // 小さいグラフに満潮・干潮の時刻を書くときは、上と下に字のぶんのあき
  const m = mini ? { l: 2, r: 2, t: marks.length ? 14 : 6, b: marks.length ? 26 : 14 } : { l: 40, r: endLabels ? 56 : 16, t: 16, b: 24 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const ys = series.flatMap(s => s.points.map(p => p.y)).filter(v => v != null);
  if (!ys.length) { el.innerHTML = `<p class="muted small">この日のデータはありません。</p>`; return; }
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (yFloor != null) lo = Math.min(yFloor, lo);
  const sc = niceScale(lo, hi);
  const X = x => m.l + (x / 24) * pw;
  const Y = y => m.t + ph - ((y - sc.min) / (sc.max - sc.min)) * ph;

  let g = "";
  bands.forEach(b => { g += `<rect x="${X(b.from).toFixed(1)}" y="${m.t}" width="${(X(b.to) - X(b.from)).toFixed(1)}" height="${ph}" fill="var(--band)"/>`; });
  for (let v = sc.min; v <= sc.max + 1e-9; v += sc.step) {
    const y = Y(v).toFixed(1);
    g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${y}" y2="${y}" stroke="var(--grid)" stroke-width="1"/>`;
    if (!mini) g += `<text x="${m.l - 8}" y="${y}" text-anchor="end" dominant-baseline="middle">${+v.toFixed(2)}</text>`;
  }
  const every = mini || pw < 320 ? 6 : 3;
  for (let h = mini ? 6 : 0; h <= (mini ? 18 : 24); h += every) g += `<text x="${X(h).toFixed(1)}" y="${H - (mini ? 2 : 6)}" text-anchor="middle"${mini ? ' class="mini-tick"' : ""}>${h}${mini ? "" : "時"}</text>`;
  series.forEach(s => {
    let d = "", pen = false;
    s.points.forEach(p => {
      if (p.y == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`;
      pen = true;
    });
    // dash … 同じ機関の2つ目の計算（同じ色の点線）
    if (d) g += `<path d="${d}" fill="none" stroke="var(${s.color})" stroke-width="${mini ? 1.5 : 2}" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${mini ? "3 3" : "5 4"}"` : ""}/>`;
  });
  // 満潮・干潮などの印（字は字の色）
  marks.forEach(k => {
    g += `<circle cx="${X(k.x).toFixed(1)}" cy="${Y(k.y).toFixed(1)}" r="${mini ? 2.5 : 4}" fill="var(--surface)" stroke="var(--text-2)" stroke-width="1.5"/>`;
    if (mini) {
      // 端の印は、字が枠からはみ出さないよう内側に寄せる
      const x = Math.max(m.l + 12, Math.min(W - m.r - 12, X(k.x)));
      g += `<text class="mini-tick" x="${x.toFixed(1)}" y="${(Y(k.y) + (k.up ? -6 : 12)).toFixed(1)}" text-anchor="middle">${k.label.replace(/^0/, "")}</text>`;
    } else g += `<text x="${X(k.x).toFixed(1)}" y="${(Y(k.y) + (k.up ? -10 : 16)).toFixed(1)}" text-anchor="middle">${k.label}</text>`;
  });
  if (endLabels && !mini) {
    const ends = series.map(s => {
      const last = [...s.points].reverse().find(p => p.y != null);
      return last ? { s, x: X(last.x), y: Y(last.y) } : null;
    }).filter(Boolean).sort((a, b) => a.y - b.y);
    ends.forEach((e, i) => { e.ly = i && e.y - ends[i - 1].ly < 14 ? ends[i - 1].ly + 14 : e.y; });
    ends.forEach(e => {
      g += `<circle cx="${e.x.toFixed(1)}" cy="${e.y.toFixed(1)}" r="4" fill="var(${e.s.color})" stroke="var(--surface)" stroke-width="2"/>`;
      g += `<text class="end-label" x="${(m.l + pw + 8).toFixed(1)}" y="${e.ly.toFixed(1)}" dominant-baseline="middle">${e.s.label}</text>`;
    });
  }
  const hx = X(state.hour).toFixed(1);
  g += `<line x1="${hx}" x2="${hx}" y1="${m.t}" y2="${m.t + ph}" stroke="var(--text-2)" stroke-width="1"/>`;
  series.forEach(s => {
    const near = s.points.reduce((b, p) => Math.abs(p.x - state.hour) < Math.abs(b.x - state.hour) ? p : b, s.points[0]);
    if (near?.y != null) g += `<circle cx="${hx}" cy="${Y(near.y).toFixed(1)}" r="${mini ? 3 : 4}" fill="var(${s.color})" stroke="var(--surface)" stroke-width="2"/>`;
  });

  // qcheck-ok: W1 グラフの絵は数と決まった名前だけ（満潮・干潮の時刻と名前は esc 済み）
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(series.map(s => s.label).join("・"))}（単位 ${esc(unit)}）。触った時刻の値は下の表">${g}</svg>`;
  const svg = el.querySelector("svg");
  if (mini) return;
  const pick = ev => {
    const r = svg.getBoundingClientRect();
    const x = (ev.clientX - r.left) * (W / r.width);
    setHour(Math.max(0, Math.min(23, Math.round(((x - m.l) / pw) * 24))));
  };
  svg.addEventListener("pointerdown", pick);
  svg.addEventListener("pointermove", ev => { if (ev.pointerType === "mouse" || ev.buttons) pick(ev); });
}
// 点線の見本（同じ機関の2つ目の計算）
export const dashSwatch = color => `<svg class="sw-dash" width="18" height="4" viewBox="0 0 18 4" aria-hidden="true"><line x1="1" y1="2" x2="17" y2="2" stroke="var(${color})" stroke-width="2" stroke-linecap="round" stroke-dasharray="4 4"/></svg>`;

// items … { label, color, kind（band 夜・dash 灰色の点線）, dash（線の色の点線） }
export function legend(el, items) {
  el.innerHTML = items.map(it => it.dash
    ? `<li>${dashSwatch(it.color)}${it.label}</li>`
    : `<li><span class="sw ${it.kind || ""}" ${it.color ? `style="background:var(${it.color})"` : ""}></span>${it.label}</li>`).join("");
}


export const tlScroll = {};
export function timeline(id, series, digits, dirText = null) {
  const el = document.getElementById(id);
  const h = state.hour;
  const key = `${state.place?.name}:${state.day}`;
  const keep = el.firstElementChild ? el.firstElementChild.scrollLeft : 0;
  el.innerHTML = `<div class="timeline-in" style="overflow-x:auto"><table class="tl">
    <thead><tr><th class="stick">時刻</th>${Array.from({ length: 24 }, (_, t) => `<th class="${t === h ? "on" : ""}">${t}時</th>`).join("")}</tr></thead>
    <tbody>${series.map(s => `<tr><th class="stick"><span class="key"><i style="background:var(${s.color})"></i>${s.label.replace(NAMES.jma, "")}</span></th>${Array.from({ length: 24 }, (_, t) => {
      const v = valueAt(s, t);
      return `<td data-h="${t}" class="${t === h ? "on" : ""}">${v == null ? "—" : `${arrow(s.dir[t])}${dirText ? `<span class="tl-dir">${dirText(s.dir[t])}</span>` : ""}${fmt(v, digits)}`}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div>`;
  const box = el.firstElementChild;
  // 場所か日が変わったときだけ、えらんだ時刻が見える所まで送る。ほかは前の位置のまま
  if (tlScroll[id] !== key) {
    tlScroll[id] = key;
    box.scrollLeft = Math.max(0, h - 1) * 40;
  } else box.scrollLeft = keep;
  box.onclick = ev => { const td = ev.target.closest("td[data-h]"); if (td) setHour(Number(td.dataset.h)); };
}

// 風：1時間ごとに、予報ごとの向きと風速
