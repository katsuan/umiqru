// うみくる：海の日記（日記タブ）。見た海のようす・したこと・釣果・写真に、その日時の予報・潮・観測をそえて、この端末に残す。月のカレンダーで見る
// 読まれるところ：app.js（initDiary・diaryNow）
import { NAMES } from "./names.js";
import { DAYS } from "./sources.js";
import { store } from "./store.js";
import { WEEK, addDays, tokyoParts } from "./time.js";
import { dirName, esc, fmt, spread } from "./format.js";
import { diaryDb } from "./diary-db.js";
import { canCard, oqrnCardUrl, pageUrl } from "./card.js";

// 見た海のようす（1つずつ選ぶ。もう一度押すと外れる）と、したこと（いくつでも）
const SAW = [
  { key: "wave", label: "波", opts: ["なぎ", "さざ波", "少し", "高い", "しけ"] },
  { key: "wind", label: "風", opts: ["なし", "弱い", "ふつう", "強い"] },
  { key: "water", label: "水", opts: ["澄み", "少し濁り", "濁り"] },
];
const DID = ["釣り", "サーフィン", "磯あそび", "散歩", "ほか"];
const MAX_PHOTOS = 4;
const PHOTO_PX = 1600; // 写真は長い辺をここまで小さくして残す
const EXPORT_TAG = "umiqru-diary";

// app.js が入れるもの：いま見ている場所・日時と、その時刻の予報（render のたびに）、ページを動かす関数
let now = null;
let hooks = { setView: () => {}, openPlace: () => {} };
let entries = [];
let month = null; // 見ている月 "2026-11"
let selected = null; // えらんだ日 "2026-11-08"
let editing = null; // 書いている日記（新しいものは id なし）
let pending = []; // 書いている日記の写真 { id, buf, type, url, saved }
let dropped = []; // 書いている日記から外した、残してあった写真の id
const urls = new Map(); // 写真の id → 画面に出す URL
const records = new Map(); // 写真の id → { type, buf }（共有するとき、押してすぐ写真を渡せるように）

const icon = name => `<span class="ls-icon is-text" data-icon="${name}" aria-hidden="true"></span>`;
const box = () => document.getElementById("sec-diary");
const today = () => tokyoParts().ymd;
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
const ymdText = ymd => {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${m}月${d}日（${WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`;
};
// 今日から何日目か（予報を読んである日なら 0〜DAYS-1）
const dayIndex = ymd => Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 864e5);
const weekStart = () => window.QWeekStart ? window.QWeekStart.get(store.get("umiqru:weekStart")) : (store.get("umiqru:weekStart") ?? 1);

// ---- app.js から ----
export function initDiary(h) {
  hooks = { ...hooks, ...h };
  selected = today();
  month = selected.slice(0, 7);
  box().addEventListener("click", onClick);
  box().addEventListener("change", onChange);
  load();
}
// render のたびに：いま見ている場所・日時と、その時刻の予報・観測。書いている途中なら、見出しと注を書きかえる
export function diaryNow(v) {
  now = v;
  // 場所と予報を読むまでは書けない（書く日記の場所がないので）
  const btn = document.getElementById("diary-new");
  if (btn) btn.disabled = false;
  if (editing && !editing.id) drawAt();
}
export function drawDiary() {
  if (!box()) return;
  drawCalendar();
  drawDay();
}

async function load() {
  try { entries = await diaryDb.all(); } catch { entries = []; }
  drawDiary();
}

// ---- カレンダー ----
function drawCalendar() {
  const [y, m] = month.split("-").map(Number);
  const ws = weekStart();
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const lead = (first - ws + 7) % 7;
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDay = groupByDay();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(`<span class="cal-pad"></span>`);
  for (let d = 1; d <= count; d++) {
    const ymd = `${month}-${String(d).padStart(2, "0")}`;
    const list = byDay[ymd] || [];
    const pic = list.flatMap(e => e.photos || [])[0];
    const label = `${m}月${d}日${list.length ? `・日記 ${list.length}` : ""}`;
    cells.push(`<button type="button" class="cal-day${ymd === today() ? " is-today" : ""}" data-day="${ymd}" aria-pressed="${ymd === selected}" aria-label="${label}">
      <span class="cal-num">${d}</span>${pic ? `<img class="cal-pic" data-photo="${esc(pic)}" alt="">` : list.length ? `<span class="cal-dot"></span>` : ""}</button>`);
  }
  while (cells.length % 7) cells.push(`<span class="cal-pad"></span>`);
  const heads = Array.from({ length: 7 }, (_, i) => `<span class="cal-head">${WEEK[(i + ws) % 7]}</span>`).join("");
  const n = entries.filter(e => e.ymd.startsWith(month)).length;
  // qcheck-ok: W1 数と日付と、esc した写真の id だけ
  document.getElementById("diary-cal").innerHTML = `
    <div class="cal-bar">
      <button type="button" class="ls-icon-button" data-month="-1" aria-label="前の月">${icon("back")}</button>
      <strong>${y}年${m}月</strong><span class="sub small">${n ? `日記 ${n}` : ""}</span>
      <button type="button" class="ls-icon-button" data-month="1" aria-label="次の月">${icon("next")}</button>
    </div>
    <div class="cal-grid">${heads}${cells.join("")}</div>`;
  fillPhotos(document.getElementById("diary-cal"));
}
function groupByDay() {
  const out = {};
  entries.forEach(e => { (out[e.ymd] ||= []).push(e); });
  Object.values(out).forEach(l => l.sort((a, b) => a.hour - b.hour));
  return out;
}

// ---- えらんだ日の日記 ----
function drawDay() {
  const el = document.getElementById("diary-day");
  if (editing) { el.innerHTML = ""; return; }
  const list = groupByDay()[selected] || [];
  // qcheck-ok: W1 日記の中身は entryHtml で esc する
  el.innerHTML = `<h3 class="diary-day-title">${ymdText(selected)}</h3>
    ${list.length ? list.map(entryHtml).join("") : `<p class="muted small" style="margin:0">この日の日記はありません。</p>`}`;
  fillPhotos(el);
}
function entryHtml(e) {
  const saw = SAW.map(s => e.saw?.[s.key] ? `${s.label} ${esc(e.saw[s.key])}` : "").filter(Boolean).join("・");
  const did = (e.did || []).map(esc).join("・");
  const fish = (e.catches || []).filter(c => c.fish).map(c => `<li>${esc(c.fish)}${c.count ? ` ${esc(c.count)}匹` : ""}${c.size ? ` ${esc(c.size)}cm` : ""}</li>`).join("");
  return `<article class="entry" data-id="${esc(e.id)}">
    <div class="entry-head"><strong>${e.hour}時</strong><button type="button" class="entry-place" data-open="${esc(e.id)}">${icon("place")}${esc(e.placeTitle || e.place?.name || "")}</button></div>
    ${(e.photos || []).length ? `<div class="entry-pics">${e.photos.map(id => `<a data-photo-link="${esc(id)}" target="_blank" rel="noopener"><img data-photo="${esc(id)}" alt="写真"></a>`).join("")}</div>` : ""}
    ${saw || did ? `<p class="entry-line">${[saw && `見た海：${saw}`, did && `したこと：${did}`].filter(Boolean).join("<br>")}</p>` : ""}
    ${fish ? `<ul class="entry-fish">${fish}</ul>` : ""}
    ${e.memo ? `<p class="entry-memo">${esc(e.memo)}</p>` : ""}
    ${snapHtml(e)}
    <div class="share-row entry-send">
      ${canCard() ? `<a class="ls-button line is-oqrn" href="${esc(cardUrl(e))}">カードでおくるん</a>` : ""}
      <button type="button" class="ls-button" data-share="${esc(e.id)}">${icon(navigator.share ? "share" : "copy")}${navigator.share ? "共有" : "文をコピー"}</button>
    </div>
    <div class="entry-actions">
      <button type="button" class="ls-button" data-edit="${esc(e.id)}">${icon("edit")}なおす</button>
      <button type="button" class="ls-button" data-delete="${esc(e.id)}">${icon("delete")}消す</button>
    </div>
  </article>`;
}
// そのときの予報・潮・観測（書いたときに残したもの）
function snapHtml(e) {
  const s = e.snap;
  if (!s) return "";
  const rows = [
    s.tide && ["潮", `${esc(s.tide.moon)}${s.tide.diff ? `・${esc(s.tide.diff)}` : ""}${s.tide.port ? `（${esc(s.tide.port)}）` : ""}${s.tide.events ? `<br>${esc(s.tide.events)}` : ""}`],
    s.mazume && ["まづめ", esc(s.mazume)],
    s.wave && ["波", `${spread(s.wave)} m（${s.wave.n}つの予報）${s.waveJma ? `<br>${NAMES.jma}：${esc(s.waveJma)}` : ""}`],
    s.wind && ["風", `${s.windDir != null ? `${dirName(s.windDir)} ` : ""}${spread(s.wind)} m/s${s.gust != null ? `・突風 ${fmt(s.gust, 0)}` : ""}`],
    (s.wx || s.temp != null) && ["天気", [s.wx && esc(s.wx), s.temp != null && `${fmt(s.temp, 0)}℃`, s.rain != null && `降水確率 ${s.rain}%`].filter(Boolean).join("・")],
    s.sst != null && ["水温", `${fmt(s.sst)}℃${s.cur ? `・沖の流れ ${s.cur.dir != null ? `${dirName(s.cur.dir)}へ ` : ""}${fmt(s.cur.kn)}ノット` : ""}`],
    s.amedas && ["実況", `${NAMES.amedas} ${esc(s.amedas.name)}（${esc(s.amedas.time)}）${s.amedas.wind != null ? ` ${s.amedas.dir != null ? `${dirName(s.amedas.dir)} ` : ""}${fmt(s.amedas.wind)} m/s` : ""}${s.amedas.temp != null ? `・${fmt(s.amedas.temp)}℃` : ""}`],
  ].filter(Boolean);
  return rows.length ? `<details class="entry-snap"><summary>${e.hour}時の予報と観測</summary>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></details>` : "";
}

// ---- 送る（おくるんのカード・端末の共有） ----
// 日記の場所を開くリンク（場所は書いたときの位置と名前で。ウィジェットの Parameter と同じ書き方）
const entryUrl = e => pageUrl(`${e.place.lat.toFixed(4)},${e.place.lon.toFixed(4)}=${e.place.name}`);
// 日記を文に（カードの中身と、共有の文）。forecast … そのときの予報も入れるか
function entryLines(e, forecast = true) {
  const saw = SAW.map(s => e.saw?.[s.key] ? `${s.label} ${e.saw[s.key]}` : "").filter(Boolean).join("・");
  const fish = (e.catches || []).filter(c => c.fish).map(c => `${c.fish}${c.count ? ` ${c.count}匹` : ""}${c.size ? ` ${c.size}cm` : ""}`).join("・");
  const memo = (e.memo || "").length > 200 ? `${e.memo.slice(0, 200)}…` : e.memo;
  const s = e.snap;
  const fc = forecast && s ? [
    s.wave && `🌊 波 ${spread(s.wave)} m`,
    s.wind && `💨 風 ${s.windDir != null ? `${dirName(s.windDir)} ` : ""}${spread(s.wind)} m/s${s.gust != null ? `（突風 ${fmt(s.gust, 0)}）` : ""}`,
    s.tide && `🌙 ${s.tide.moon}${s.tide.diff ? `・${s.tide.diff}` : ""}`,
    (s.wx || s.temp != null) && `☁️ ${[s.wx, s.temp != null && `${fmt(s.temp, 0)}℃`].filter(Boolean).join("・")}`,
    s.sst != null && `🌡️ 水温 ${fmt(s.sst)}℃`,
  ].filter(Boolean) : [];
  return [
    saw && `👀 ${saw}`,
    (e.did || []).length && `🏖️ ${e.did.join("・")}`,
    fish && `🎣 ${fish}`,
    memo && `📝 ${memo}`,
    ...(fc.length ? ["", `${e.hour}時の予報`, ...fc] : []),
  ].filter(x => x || x === "");
}
function cardUrl(e) {
  return oqrnCardUrl({
    header: `🌊 ${NAMES.app}の日記`,
    date: `🕒 ${ymdText(e.ymd)} ${e.hour}時`,
    title: e.placeTitle || e.place?.name || "",
    detail: entryLines(e).join("\n") || "海の日記",
    actionUrl: entryUrl(e),
  });
}
// 端末の共有の画面で、文・リンクと写真をいっしょに（写真を渡せない端末は文とリンクだけ。共有がなければ文をコピー）
async function shareEntry(e, btn) {
  if (!e) return;
  const text = [`${ymdText(e.ymd)} ${e.hour}時 ${e.placeTitle || e.place.name}`, ...entryLines(e)].join("\n");
  const url = entryUrl(e);
  if (!navigator.share) {
    const label = btn.innerHTML;
    try { await navigator.clipboard.writeText(`${text}\n${url}`); btn.textContent = "コピーしました"; }
    catch { btn.textContent = "コピーできませんでした"; }
    setTimeout(() => { btn.innerHTML = label; }, 2000);
    return;
  }
  // 写真は表示のときに読んであるので、押してすぐ渡せる（間があくと iPhone で共有の画面が出ない）
  const files = (e.photos || []).map((id, i) => records.get(id) && new File([records.get(id).buf], `${e.ymd}-${i + 1}.jpg`, { type: records.get(id).type })).filter(Boolean);
  const withFiles = files.length && navigator.canShare?.({ files }) ? { files } : {};
  navigator.share({ title: `${NAMES.app}の日記`, text: withFiles.files ? `${text}\n${url}` : text, url: withFiles.files ? undefined : url, ...withFiles }).catch(() => {});
}

// ---- 書く・なおす ----
function startEdit(e = null) {
  pending.forEach(p => !p.saved && URL.revokeObjectURL(p.url));
  dropped = [];
  if (e) {
    editing = structuredClone(e);
    pending = (e.photos || []).map(id => ({ id, saved: true }));
  } else {
    if (!now?.place) return;
    const ymd = now.day.ymd;
    editing = { ymd, hour: now.h, saw: {}, did: [], catches: [], memo: "", photos: [] };
    pending = [];
  }
  drawForm();
  drawDay();
  document.getElementById("diary-form").scrollIntoView({ block: "start" });
}
function stopEdit() {
  pending.forEach(p => !p.saved && p.url && URL.revokeObjectURL(p.url));
  editing = null; pending = []; dropped = [];
  const f = document.getElementById("diary-form");
  f.hidden = true; f.innerHTML = "";
  document.getElementById("diary-new").hidden = false;
  drawDay();
}
function drawForm() {
  const e = editing;
  const f = document.getElementById("diary-form");
  f.hidden = false;
  document.getElementById("diary-new").hidden = true;
  const chips = (name, opts, on, multi) => `<div class="ls-chips" role="group" data-chips="${name}"${multi ? ' data-multi="1"' : ""}>${opts.map(o => `<button type="button" class="ls-chip is-small" data-chip="${esc(o)}" aria-pressed="${multi ? on.includes(o) : on === o}">${esc(o)}</button>`).join("")}</div>`;
  // qcheck-ok: W1 決まった選択肢と、esc した入力だけ
  f.innerHTML = `<h3 class="diary-form-title">${e.id ? "日記をなおす" : "日記を書く"}</h3>
    <p class="diary-at" id="diary-at"></p>
    <div class="ls-grid-2">
      <label class="ls-field"><span class="ls-label">日にち</span><input type="date" class="ls-input" name="ymd" value="${esc(e.ymd)}" max="${addDays(today(), DAYS - 1)}"></label>
      <label class="ls-field"><span class="ls-label">時刻</span><select class="ls-input" name="hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === e.hour ? " selected" : ""}>${h}時</option>`).join("")}</select></label>
    </div>
    <p class="muted small diary-note" id="diary-snapnote"></p>
    <div class="ls-field"><span class="ls-label">見た海のようす</span>
      ${SAW.map(s => `<div class="saw-row"><span class="saw-key">${s.label}</span>${chips(`saw:${s.key}`, s.opts, e.saw?.[s.key] || "", false)}</div>`).join("")}
    </div>
    <div class="ls-field"><span class="ls-label">したこと</span>${chips("did", DID, e.did || [], true)}</div>
    <div class="ls-field" id="diary-fish"${(e.did || []).includes("釣り") || (e.catches || []).length ? "" : " hidden"}><span class="ls-label">釣果</span>
      <div class="fish-rows" id="fish-rows">${(e.catches.length ? e.catches : [{}]).map(fishRow).join("")}</div>
      <button type="button" class="ls-button" data-fish-add>${icon("add")}魚を足す</button>
    </div>
    <label class="ls-field"><span class="ls-label">メモ</span><textarea class="ls-input" name="memo" rows="3" placeholder="例：朝まづめに足もとでアジ。10時ごろから北風が強くなった">${esc(e.memo || "")}</textarea></label>
    <div class="ls-field"><span class="ls-label">写真（${MAX_PHOTOS}枚まで）</span>
      <div class="entry-pics" id="diary-pics"></div>
      <label class="ls-button pic-add" id="pic-add">${icon("camera")}写真を足す<input type="file" accept="image/*" multiple class="vh" data-pic-input></label>
    </div>
    <div class="ls-grid-2 diary-actions">
      <button type="button" class="ls-button" data-cancel>やめる</button>
      <button type="button" class="ls-button is-primary" data-save>${icon("save")}残す</button>
    </div>`;
  drawAt();
  drawPics();
}
const fishRow = (c = {}) => `<div class="fish-row">
  <input class="ls-input" name="fish" placeholder="魚" value="${esc(c.fish || "")}" aria-label="魚の名前">
  <input class="ls-input" name="count" inputmode="numeric" placeholder="匹" value="${esc(c.count || "")}" aria-label="数（匹）">
  <input class="ls-input" name="size" inputmode="decimal" placeholder="cm" value="${esc(c.size || "")}" aria-label="大きさ（cm）">
  <button type="button" class="ls-icon-button" data-fish-del aria-label="この魚を消す">${icon("close")}</button></div>`;

// 書いている日記の場所・日時と、予報をいっしょに残せるか
function drawAt() {
  const e = editing, at = document.getElementById("diary-at"), note = document.getElementById("diary-snapnote");
  if (!e || !at) return;
  const title = e.id ? e.placeTitle : now?.placeTitle;
  // qcheck-ok: W1 場所の名前は esc 済み
  at.innerHTML = `${icon("place")}<strong>${esc(title || "")}</strong>`;
  note.textContent = e.id
    ? (e.snap ? `予報・潮・観測は、書いたとき（${e.snapHour ?? e.hour}時）のまま残ります。` : "")
    : snapFor(e) ? `場所は上でえらんでいる所。${ymdText(e.ymd)} ${e.hour}時の予報・潮・観測もいっしょに残します。`
      : `場所は上でえらんでいる所。この日の予報は読めないので、書いたことだけ残します（予報を読めるのは今日から${DAYS}日）。`;
}
// 書いている日時が、いま見ている日時と同じなら、その予報（ほかの日時は残せない）
const snapFor = e => now && now.day.ymd === e.ymd && now.h === e.hour ? now.snap : null;

async function drawPics() {
  const el = document.getElementById("diary-pics");
  if (!el) return;
  await Promise.all(pending.map(async p => { if (!p.url) p.url = await photoUrl(p.id); }));
  // qcheck-ok: W1 写真の URL（この端末の blob:）と番号だけ
  el.innerHTML = pending.map((p, i) => `<span class="pic"><img src="${esc(p.url || "")}" alt="写真 ${i + 1}"><button type="button" class="ls-icon-button pic-del" data-pic-del="${i}" aria-label="この写真を外す">${icon("close")}</button></span>`).join("");
  document.getElementById("pic-add").hidden = pending.length >= MAX_PHOTOS;
}

// 写真を小さくする（向きは写真のとおり）。JPEG で
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    // decode() は、端末によっては返ってこないことがあるので onload で待つ
    const img = await new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = url; });
    const k = Math.min(1, PHOTO_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(ok => c.toBlob(ok, "image/jpeg", 0.82));
    return { type: "image/jpeg", buf: await blob.arrayBuffer() };
  } finally { URL.revokeObjectURL(url); }
}
async function photoUrl(id) {
  if (urls.has(id)) return urls.get(id);
  const p = await diaryDb.photo(id).catch(() => null);
  if (!p) return "";
  records.set(id, p);
  const u = URL.createObjectURL(new Blob([p.buf], { type: p.type }));
  urls.set(id, u);
  return u;
}
function fillPhotos(root) {
  root.querySelectorAll("img[data-photo]").forEach(async img => { img.src = await photoUrl(img.dataset.photo); });
  root.querySelectorAll("a[data-photo-link]").forEach(async a => { a.href = await photoUrl(a.dataset.photoLink); });
}

function readForm() {
  const f = document.getElementById("diary-form");
  const e = editing;
  e.ymd = f.querySelector('[name="ymd"]').value || e.ymd;
  e.hour = Number(f.querySelector('[name="hour"]').value);
  e.memo = f.querySelector('[name="memo"]').value.trim();
  e.saw = {};
  SAW.forEach(s => { const b = f.querySelector(`[data-chips="saw:${s.key}"] [aria-pressed="true"]`); if (b) e.saw[s.key] = b.dataset.chip; });
  e.did = [...f.querySelectorAll('[data-chips="did"] [aria-pressed="true"]')].map(b => b.dataset.chip);
  e.catches = [...f.querySelectorAll(".fish-row")].map(r => ({
    fish: r.querySelector('[name="fish"]').value.trim(),
    count: r.querySelector('[name="count"]').value.trim(),
    size: r.querySelector('[name="size"]').value.trim(),
  })).filter(c => c.fish);
}
async function save(btn) {
  readForm();
  const e = editing;
  const isNew = !e.id;
  if (isNew) {
    e.id = newId();
    e.created = Date.now();
    e.place = now.place;
    e.placeTitle = now.placeTitle;
    e.snap = snapFor(e);
    if (e.snap) e.snapHour = e.hour;
  }
  e.updated = Date.now();
  const add = pending.filter(p => !p.saved).map(p => ({ id: p.id, type: p.type, buf: p.buf }));
  e.photos = pending.map(p => p.id);
  btn.disabled = true;
  try {
    await diaryDb.save(e, add, dropped);
    // 消えにくくする（ブラウザが空きを作るときに消さないように頼む。だめでも動く）
    navigator.storage?.persist?.().catch(() => {});
    pending.forEach(p => { if (!p.saved && p.url) urls.set(p.id, p.url); p.saved = true; });
    dropped.forEach(id => { URL.revokeObjectURL(urls.get(id)); urls.delete(id); });
    entries = entries.filter(x => x.id !== e.id).concat(e);
    selected = e.ymd; month = e.ymd.slice(0, 7);
    pending = []; dropped = [];
    stopEdit();
    drawCalendar();
    document.getElementById("diary-cal").scrollIntoView({ block: "start" });
  } catch {
    if (isNew) delete e.id;
    btn.disabled = false;
    document.getElementById("diary-snapnote").textContent = "残せませんでした。端末の空きを確かめてください。";
  }
}

// ---- 押したとき ----
async function onClick(ev) {
  const t = ev.target.closest("button, a");
  if (!t) return;
  const d = t.dataset;
  if (t.id === "diary-new") startEdit();
  else if (d.month) {
    const [y, m] = month.split("-").map(Number);
    const n = new Date(Date.UTC(y, m - 1 + Number(d.month), 1));
    month = n.toISOString().slice(0, 7);
    drawCalendar();
  } else if (d.day) {
    selected = d.day;
    box().querySelectorAll(".cal-day").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.day === selected)));
    drawDay();
  } else if (d.chip != null) {
    const group = t.closest("[data-chips]");
    const on = t.getAttribute("aria-pressed") === "true";
    if (!group.dataset.multi) group.querySelectorAll("[data-chip]").forEach(b => b.setAttribute("aria-pressed", "false"));
    t.setAttribute("aria-pressed", String(!on));
    if (group.dataset.chips === "did") {
      const fish = document.getElementById("diary-fish");
      if (d.chip === "釣り" && !on) fish.hidden = false;
    }
  } else if ("fishAdd" in d) {
    document.getElementById("fish-rows").insertAdjacentHTML("beforeend", fishRow());
    document.querySelector("#fish-rows .fish-row:last-child input").focus();
  } else if ("fishDel" in d) {
    const rows = document.getElementById("fish-rows");
    t.closest(".fish-row").remove();
    if (!rows.children.length) rows.insertAdjacentHTML("beforeend", fishRow());
  } else if (d.picDel != null) {
    const [p] = pending.splice(Number(d.picDel), 1);
    if (p.saved) dropped.push(p.id); else URL.revokeObjectURL(p.url);
    drawPics();
  } else if ("cancel" in d) stopEdit();
  else if ("save" in d) save(t);
  else if (d.share) shareEntry(entries.find(e => e.id === d.share), t);
  else if (d.edit) startEdit(entries.find(e => e.id === d.edit));
  else if (d.delete) {
    const e = entries.find(x => x.id === d.delete);
    if (!e) return;
    // Q キットの確認の窓（読めなかったときは消さない）
    const yes = await window.LineShareUI?.ask({ title: `${ymdText(e.ymd)} ${e.hour}時の日記を消しますか？`, text: "写真もいっしょに消え、もとに戻せません。", ok: "消す", danger: true });
    if (!yes) return;
    await diaryDb.remove(e).catch(() => {});
    (e.photos || []).forEach(id => { URL.revokeObjectURL(urls.get(id)); urls.delete(id); });
    entries = entries.filter(x => x !== e);
    drawDiary();
  } else if (d.open) {
    const e = entries.find(x => x.id === d.open);
    if (e?.place) hooks.openPlace(e);
  } else if (d.week != null) {
    const v = Number(d.week);
    if (window.QWeekStart) window.QWeekStart.set(v);
    store.set("umiqru:weekStart", v);
    drawWeekSeg();
    drawCalendar();
  } else if ("export" in d) exportAll(t);
}
async function onChange(ev) {
  const t = ev.target;
  if (t.matches("[data-pic-input]")) {
    const files = [...t.files].slice(0, MAX_PHOTOS - pending.length);
    t.value = "";
    for (const file of files) {
      try {
        const p = await shrink(file);
        pending.push({ id: newId(), ...p, url: URL.createObjectURL(new Blob([p.buf], { type: p.type })), saved: false });
      } catch { /* 読めない写真は飛ばす */ }
    }
    drawPics();
  } else if (t.matches('[name="ymd"], [name="hour"]') && editing) {
    readForm();
    // 予報を読んである日なら、ページもその日時にして、その予報を残せるようにする（書きなおしのときは動かさない）
    const i = dayIndex(editing.ymd);
    if (!editing.id && i >= 0 && i < DAYS) hooks.setView(i, editing.hour);
    drawAt();
  } else if (t.matches("[data-import]")) importFile(t);
}

// ---- 書き出す・読みこむ（この端末だけに残るので、ときどき書き出しておく） ----
const toB64 = buf => { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer;
async function exportAll(btn) {
  const photos = [];
  for (const e of entries) for (const id of e.photos || []) {
    const p = await diaryDb.photo(id).catch(() => null);
    if (p) photos.push({ id, type: p.type, data: toB64(p.buf) });
  }
  const blob = new Blob([JSON.stringify({ app: EXPORT_TAG, version: 1, entries, photos })], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${EXPORT_TAG}-${today().replaceAll("-", "")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  keepNote(`${entries.length}件を書き出しました。`);
  btn.blur();
}
async function importFile(input) {
  const file = input.files[0];
  input.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== EXPORT_TAG || !Array.isArray(data.entries)) throw new Error();
    const photos = new Map((data.photos || []).map(p => [p.id, p]));
    for (const e of data.entries) {
      if (!e.id || !/^\d{4}-\d{2}-\d{2}$/.test(e.ymd)) continue;
      const add = (e.photos || []).map(id => photos.get(id)).filter(Boolean).map(p => ({ id: p.id, type: p.type, buf: fromB64(p.data) }));
      await diaryDb.save(e, add);
    }
    entries = await diaryDb.all();
    drawDiary();
    keepNote(`${data.entries.length}件を読みこみました（同じ日記は、読みこんだほうにしました）。`);
  } catch {
    keepNote("読みこめませんでした。書き出したファイルを選んでください。");
  }
}
const keepNote = text => { document.getElementById("diary-keep-note").textContent = text; };
function drawWeekSeg() {
  const ws = weekStart();
  document.querySelectorAll("[data-week]").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.week) === ws)));
}
export function drawDiaryShell() {
  // qcheck-ok: W1 決まった文字だけ
  box().innerHTML = `
    <div class="sec-head">
      <h2>${icon("notebook")}海の日記</h2>
      <button type="button" class="ls-button" id="diary-new"${now ? "" : " disabled"}>${icon("edit")}書く</button>
    </div>
    <p class="muted small diary-lead">見た海のようすや釣果を書くと、その日時の予報・潮・観測もいっしょに残ります。予報とくらべて、次の日えらびに。</p>
    <div id="diary-form" class="diary-form" hidden></div>
    <div id="diary-cal"></div>
    <div id="diary-day"></div>
    <details class="diary-keep">
      <summary>週のはじまり・書き出し</summary>
      <div class="diary-keep-row"><span class="small sub">週のはじまり</span>
        <div class="seg" role="group" aria-label="週のはじまり"><button type="button" data-week="1">月曜</button><button type="button" data-week="0">日曜</button></div></div>
      <p class="muted small">日記と写真はこの端末のブラウザにだけ残ります（ほかの端末や人には送られません）。ブラウザのデータを消すと日記も消えるので、ときどき書き出してください。iPhone はホーム画面に置いて開くと消えにくくなります。</p>
      <div class="diary-keep-row">
        <button type="button" class="ls-button" data-export>${icon("backup")}書き出す</button>
        <label class="ls-button">${icon("upload")}読みこむ<input type="file" accept="application/json,.json" class="vh" data-import></label>
      </div>
      <p class="muted small" id="diary-keep-note" aria-live="polite"></p>
    </details>`;
  drawWeekSeg();
}
