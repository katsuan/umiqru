// うみくる：海の日記（日記タブ）。見た海のようす・したこと・メモと、時刻つきの写真・釣果に、その日1日ぶんの予報・潮・観測をそえて、この端末に残す
// 日記は「はじめ → 写真・釣果（時刻の順）→ おわり」に並べ、それぞれの時刻の潮位・風・波を出す。写真を押すと、大きな写真とその時刻の値。月のカレンダーで見る
// 読まれるところ：app.js（initDiary・diaryNow）
import { NAMES } from "./names.js";
import { DAYS } from "./sources.js";
import { store } from "./store.js";
import { WEEK, addDays, hmText, tokyoParts } from "./time.js";
import { arrow, closeDialog, dirName, esc, fmt, icon, openDialog, spread, wxShort } from "./format.js";
import { diaryDb } from "./diary-db.js";
import { canCard, oqrnCardUrl, pageUrl } from "./card.js";
import { atTime, canKeepDay, dayIndex, getDay } from "./daydata.js";
import { ferriesOf, ferryStyle, islandFor, isoOn, myFerry, spotsOf } from "./iso.js";
import { IN_APP, IS_PHONE, canPrompt, onInstallChange, promptInstall, reasonText, shouldInstall, standalone, stepsHtml } from "./install.js";

// 見た海のようす（1つずつ選ぶ。もう一度押すと外れる）と、したこと（いくつでも）
const SAW = [
  { key: "wave", label: "波", opts: ["なぎ", "さざ波", "少し", "高い", "しけ"] },
  { key: "wind", label: "風", opts: ["なし", "弱い", "ふつう", "強い"] },
  { key: "water", label: "水", opts: ["澄み", "少し濁り", "濁り"] },
];
const DID = ["釣り", "サーフィン", "磯あそび", "散歩", "ほか"];
const PHOTO_PX = 1600; // 写真は長い辺をここまで小さくして残す
const PHOTO_MATCH_MIN = 15; // 「写真を足す」の写真を、写真のない釣果につける時刻の差（分）
const EXPORT_TAG = "umiqru-diary";

// app.js が入れるもの：いま見ている場所・日時（render のたびに）、ページを動かす関数
let now = null;
let hooks = { setView: () => {}, openPlace: () => {} };
let entries = [];
let month = null; // 見ている月 "2026-11"
let selected = null; // えらんだ日 "2026-11-08"
let editing = null; // 書いている日記（新しいものは id なし）
let editYmd = null; // なおす前の日にち（変えたら、その日の予報を読みなおす）
let items = []; // 書いている日記の写真・釣果 { id, at, photo, fish, count, size }
let fresh = new Map(); // まだ残していない写真の id → { type, buf }
let dropped = []; // 書いている日記から外した、残してあった写真の id
let asked = false; // 「書く」の前に、ホーム画面に置く案内を出したか（開くたびに1回）
let viewing = null; // 写真を大きく見ているとき { e, steps, i }
const urls = new Map(); // 写真の id → 画面に出す URL
const records = new Map(); // 写真の id → { type, buf }（共有するとき、押してすぐ写真を渡せるように）

const box = () => document.getElementById("sec-diary");
const today = () => tokyoParts().ymd;
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
const ymdText = ymd => {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${m}月${d}日（${WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`;
};
// 時刻は 0:00 からの分で持つ。"5:30" と分の行き来
const toHM = min => hmText(min / 60);
const toInput = min => min == null ? "" : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;
const fromHM = s => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const weekStart = () => window.QWeekStart ? window.QWeekStart.get(store.get("umiqru:weekStart")) : (store.get("umiqru:weekStart") ?? 1);

// ---- 日記の形（前の形：hour・catches・photos・snap も読めるように） ----
const startOf = e => e.start ?? e.hour * 60;
function itemsOf(e) {
  if (e.items) return e.items;
  const at = startOf(e);
  return [
    ...(e.photos || []).map(photo => ({ id: photo, at, photo })),
    ...(e.catches || []).map((c, i) => ({ id: `${e.id}-c${i}`, at, ...c })),
  ];
}
// その時刻の値。1日ぶんを残してあればそこから。前の形は書いた時刻のぶんだけ
const condAt = (e, min) => e.day ? atTime(e.day, min) : e.snap && min === startOf(e) ? e.snap : null;
const fishText = it => it.fish ? `${it.fish}${it.count ? ` ${it.count}匹` : ""}${it.size ? ` ${it.size}cm` : ""}` : "";

// ---- app.js から ----
export function initDiary(h) {
  hooks = { ...hooks, ...h };
  selected = today();
  month = selected.slice(0, 7);
  box().addEventListener("click", onClick);
  box().addEventListener("change", onChange);
  onInstallChange(drawWhere);
  load();
}
/**
 * ボット（くらぶボットの釣り）のリンクから：その日の釣果を入れた「日記を書く」を開く（残すのは、使う人が「残す」を押したとき）。
 * pre … { ymd: "2026-11-12", items: [{ at: 402（0時からの分）, fish: "アジ" }] }。場所はページで開いている場所（リンクの ?q=）
 */
export function diaryPrefill(pre) {
  if (!now?.place || !pre?.items?.length) return false;
  forgetFresh();
  dropped = [];
  const list = [...pre.items].sort((a, b) => a.at - b.at);
  editing = { ymd: pre.ymd, start: list[0].at, end: null, saw: {}, did: ["釣り"], memo: "" };
  // 魚の名前がない釣果も残るように「魚」（日記は、写真も魚もない行を残さない）。あとで直せる
  items = list.map(it => ({ id: newId(), at: it.at, photo: null, fish: it.fish || "魚", count: "", size: "" }));
  editYmd = null;
  selected = pre.ymd; month = pre.ymd.slice(0, 7);
  drawCalendar();
  drawForm();
  drawDay();
  // 同じ日・同じ場所の日記がもうあれば、かさならないように知らせる（残すかは使う人が決める）
  const same = entries.some(x => x.ymd === pre.ymd && x.place && Math.abs(x.place.lat - now.place.lat) < 0.002 && Math.abs(x.place.lon - now.place.lon) < 0.002);
  const note = document.createElement("p");
  note.className = "muted small diary-note";
  note.textContent = `${NAMES.bot}の釣りの記録から入れました。${same ? "この日・この場所の日記がもうあります。かさなるときは「やめる」を押してください。" : "よければ「残す」を押してください。"}`;
  document.querySelector("#diary-form .diary-form-title")?.after(note);
  document.getElementById("diary-form").scrollIntoView({ block: "start" });
  return true;
}

// ボット（くらぶボット）の LINE の ID（@…）。ボットのカードのリンクの &bot= で覚える。日記の「ボットに送る」に使う
const BOT_KEY = "umiqru:bot";
const BOT_ID = /^@[0-9a-z._-]{2,40}$/i;
/** リンクの &bot=@… を覚える（ちがう形なら何もしない） */
export function rememberBot(search) {
  const id = new URLSearchParams(search).get("bot") || "";
  if (BOT_ID.test(id)) store.set(BOT_KEY, id);
}
const botId = () => { const id = store.get(BOT_KEY); return typeof id === "string" && BOT_ID.test(id) ? id : ""; };

/**
 * ボットに送る文（ボットが読む形。人が読んでもわかるように）：
 *   📔 うみくるの日記 2026-11-12 ／ 📍 緯度,経度 場所 ／ 潮：港（tide736.net）／ 06:42 アジ 2匹 20cm｜潮 上げ2分 32cm（60%）
 * 釣果（魚の名前のあるもの）だけ。潮はうみくるの港（tide736）のその時刻の値。そのあとに、その日1日の潮（潮位：20分ごと … ／ 満干：…）
 */
function botText(e) {
  const list = [...itemsOf(e)].filter(it => it.fish).sort((a, b) => a.at - b.at).slice(0, 20);
  const port = list.map(it => condAt(e, it.at)?.tide?.port).find(Boolean);
  const clean = v => String(v ?? "").replace(/[\r\n｜]/g, " ").trim();
  // その日1日の潮（ボットはこれで、その日の記録の潮を直す）：20分ごとの潮位と、満潮・干潮
  const td = e.day?.tide;
  const cms = Array.isArray(td?.cm) ? td.cm.map(v => (v == null ? "" : Math.round(v))) : [];
  const marks = td ? [...(td.flood || []).map(x => ({ k: "満潮", ...x })), ...(td.edd || []).map(x => ({ k: "干潮", ...x }))]
    .filter(x => x.time).sort((a, b) => toMin(a.time) - toMin(b.time)).map(x => `${x.k} ${x.time} ${Math.round(x.cm)}`) : [];
  return [
    `📔 ${NAMES.app}の日記 ${e.ymd}`,
    `📍 ${Number(e.place.lat).toFixed(4)},${Number(e.place.lon).toFixed(4)} ${clean(e.placeTitle || e.place.name || "")}`.trim(),
    port ? `潮：${port.name || port}（${NAMES.tide736}）` : "",
    cms.length >= 72 ? `潮位：20分ごと ${cms.join(" ")}` : "",
    marks.length ? `満干：${marks.join("・")}` : "",
    ...list.map(it => {
      const t = condAt(e, it.at)?.tide;
      const fish = [clean(it.fish), it.count ? `${clean(it.count)}匹` : "", it.size ? `${clean(it.size)}cm` : ""].filter(Boolean).join(" ");
      const tide = t && t.cm != null ? `｜潮 ${t.stageText || "—"} ${Math.round(t.cm)}cm${t.pct != null ? `（${t.pct}%）` : ""}` : "";
      return `${toHM(it.at)} ${fish}${tide}`;
    }),
  ].filter(Boolean).join("\n");
}
/** "6:10" → 370（0時からの分） */
const toMin = t => { const [h, m] = String(t).trim().split(":").map(Number); return h * 60 + m; };
/** その日記を、ボットとのトークの入力欄に入れて開く URL（ボットを知らない・釣果がなければ ""） */
function botUrl(e) {
  const id = botId();
  if (!id || !e.place || !itemsOf(e).some(it => it.fish)) return "";
  return `https://line.me/R/oaMessage/${encodeURIComponent(id)}/?${encodeURIComponent(botText(e))}`;
}

/** リンクの ?d=2026-11-12&c=0642~アジ_0810~ を読む（なければ null）。魚の名前は30字まで */
export function prefillFromUrl(search) {
  const q = new URLSearchParams(search);
  const ymd = q.get("d") || "";
  if (!/^\d{4}-\d\d-\d\d$/.test(ymd) || !canKeepDay(ymd)) return null;
  const list = String(q.get("c") || "").split("_").map(x => {
    const [t, fish = ""] = x.split("~");
    if (!/^\d{4}$/.test(t || "")) return null;
    const at = Number(t.slice(0, 2)) * 60 + Number(t.slice(2));
    return at < 1440 ? { at, fish: fish.slice(0, 30) } : null;
  }).filter(Boolean).slice(0, 30);
  return list.length ? { ymd, items: list } : null;
}

// render のたびに：いま見ている場所・日時
export function diaryNow(v) {
  now = v;
  // 場所を読むまでは書けない（書く日記の場所がないので）
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
  drawWhere();
}

// ---- カレンダー ----
function drawCalendar() {
  const [y, m] = month.split("-").map(Number);
  const ws = weekStart();
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const lead = (first - ws + 7) % 7;
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDay = groupByDay(), now = today();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(`<span class="cal-pad"></span>`);
  for (let d = 1; d <= count; d++) {
    const ymd = `${month}-${String(d).padStart(2, "0")}`;
    const list = byDay[ymd] || [];
    const pic = list.flatMap(e => e.photos || [])[0];
    const label = `${m}月${d}日${list.length ? `・日記 ${list.length}` : ""}`;
    cells.push(`<button type="button" class="cal-day${ymd === now ? " is-today" : ""}" data-day="${ymd}" aria-pressed="${ymd === selected}" aria-label="${label}">
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
  Object.values(out).forEach(l => l.sort((a, b) => startOf(a) - startOf(b)));
  return out;
}

// ---- えらんだ日の日記 ----
function drawDay() {
  const el = document.getElementById("diary-day");
  if (editing) { el.innerHTML = ""; return; }
  const list = groupByDay()[selected] || [];
  // qcheck-ok: W1 日記の中身は entryHtml で esc する
  el.innerHTML = `<h3 class="diary-day-title">${ymdText(selected)}</h3>
    ${list.length ? list.map(entryHtml).join("") : `<p class="muted small" style="margin:0">この日の日記はありません。${standalone() && !entries.length ? "Safari などで書いた日記は、そちらで「書き出す」→ ここで「読みこむ」で移せます（下の「週のはじまり・書き出し」）。" : ""}</p>`}`;
  fillPhotos(el);
  // 1日の表は、はじめの時刻のあたりから見えるように
  el.querySelectorAll(".day-table").forEach(w => { w.scrollLeft = Math.max(0, Number(w.dataset.from) - 1) * 40; });
}
// 潮・風・波を1行で（並びの中に出す）
function condShort(c) {
  if (!c) return "";
  const t = c.tide;
  return [
    t && (t.stageText || t.cm != null ? `潮 ${t.stageText ? `${t.stageText} ` : ""}${t.cm != null ? `${Math.round(t.cm)}cm` : ""}` : t.moon && `潮 ${t.moon}`),
    c.wind && `風 ${c.windDir != null ? `${dirName(c.windDir)} ` : ""}${fmt(c.windMean ?? c.wind.hi)}m/s`,
    c.wave && `波 ${fmt(c.waveMean ?? c.wave.hi)}m`,
  ].filter(Boolean).map(esc).join("・");
}
// はじめ → 写真・釣果（時刻の順）→ おわり
function stepsOf(e) {
  const list = [...itemsOf(e)].sort((a, b) => a.at - b.at);
  return [
    { kind: "start", at: startOf(e) },
    ...list.map(it => ({ kind: "item", at: it.at, it })),
    ...(e.end != null ? [{ kind: "end", at: e.end }] : []),
  ];
}
function entryHtml(e) {
  const saw = SAW.map(s => e.saw?.[s.key] ? `${s.label} ${esc(e.saw[s.key])}` : "").filter(Boolean).join("・");
  const did = (e.did || []).map(esc).join("・");
  const stepHtml = (st, i) => {
    const cond = condShort(condAt(e, st.at));
    const head = st.kind === "start" ? "はじめ" : st.kind === "end" ? "おわり" : esc(fishText(st.it)) || "写真";
    const pic = st.it?.photo ? `<img class="tl-pic" data-photo="${esc(st.it.photo)}" alt="${toHM(st.at)}の写真">` : "";
    return `<li class="tl-step is-${st.kind}">
      <span class="tl-dot">${st.kind === "item" ? icon(st.it.photo ? "camera" : "target") : ""}</span>
      <button type="button" class="tl-body" data-view="${esc(e.id)}" data-step="${i}">
        <span class="tl-line"><span class="tl-time">${toHM(st.at)}</span><span class="tl-head">${head}</span></span>
        ${pic}${cond ? `<span class="tl-cond">${cond}</span>` : ""}
      </button></li>`;
  };
  const span = `${toHM(startOf(e))}${e.end != null ? `〜${toHM(e.end)}` : ""}`;
  return `<article class="entry" data-id="${esc(e.id)}">
    <div class="entry-head"><strong>${span}</strong><button type="button" class="entry-place" data-open="${esc(e.id)}">${icon("place")}${esc(e.placeTitle || e.place?.name || "")}</button></div>
    ${e.ferry || e.spot ? `<p class="entry-line">${[e.ferry, e.spot].filter(Boolean).map(esc).join("・")}</p>` : ""}
    ${saw || did ? `<p class="entry-line">${[saw && `見た海：${saw}`, did && `したこと：${did}`].filter(Boolean).join("<br>")}</p>` : ""}
    <ol class="tl-steps">${stepsOf(e).map(stepHtml).join("")}</ol>
    ${e.memo ? `<p class="entry-memo">${esc(e.memo)}</p>` : ""}
    ${e.day ? dayTable(e) : snapHtml(e)}
    <div class="share-row entry-send">
      ${canCard() ? `<a class="ls-button line is-oqrn" href="${esc(cardUrl(e))}">カードでおくるん</a>` : ""}
      <button type="button" class="ls-button" data-share="${esc(e.id)}">${icon(navigator.share ? "share" : "copy")}${navigator.share ? "共有" : "文をコピー"}</button>
    </div>
    ${botUrl(e) ? `<a class="ls-button line is-block entry-bot" href="${esc(botUrl(e))}">${NAMES.bot}に送る</a>` : ""}
    <div class="entry-actions">
      <button type="button" class="ls-button" data-edit="${esc(e.id)}">${icon("edit")}なおす</button>
      <button type="button" class="ls-button" data-delete="${esc(e.id)}">${icon("delete")}消す</button>
    </div>
  </article>`;
}
// その時刻の予報・潮・観測を、見出しと値の並びに
function condRows(c) {
  if (!c) return [];
  const t = c.tide;
  return [
    t && ["潮", [
      t.cm != null && `${Math.round(t.cm)}cm${t.pct != null ? `（この日の高さの ${t.pct}%）` : ""}`,
      t.stageText && esc(t.stageText),
    ].filter(Boolean).join("・") + `<br>${esc(t.moon)}${t.diff ? `・${esc(t.diff)}` : ""}${t.port ? `（${esc(t.port)}）` : ""}${t.events ? `<br>${esc(t.events)}` : ""}`],
    c.mazume && ["まづめ", `${c.inMazume ? `<strong>${esc(c.inMazume)}</strong>・` : ""}${esc(c.mazume)}`],
    c.wave && ["波", `${spread(c.wave)} m（${c.wave.n}つの予報）${c.period ? `・周期 ${fmt(c.period, 0)}秒` : ""}${c.waveDir != null ? `・${dirName(c.waveDir)}から` : ""}${c.waveJma ? `<br>${NAMES.jma}：${esc(c.waveJma)}` : ""}`],
    c.wind && ["風", `${c.windDir != null ? `${dirName(c.windDir)} ` : ""}${spread(c.wind)} m/s${c.gust != null ? `・突風 ${fmt(c.gust, 0)}` : ""}`],
    (c.wx || c.temp != null) && ["天気", [c.wx && esc(c.wx), c.temp != null && `${fmt(c.temp, 0)}℃`, c.rain != null && `降水確率 ${c.rain}%`].filter(Boolean).join("・")],
    c.sst != null && ["水温", `${fmt(c.sst)}℃${c.cur ? `・沖の流れ ${c.cur.dir != null ? `${dirName(c.cur.dir)}へ ` : ""}${fmt(c.cur.kn)}ノット` : ""}`],
    c.amedas && ["実況", `${NAMES.amedas} ${esc(c.amedas.name)}（${esc(c.amedas.time)}）${c.amedas.wind != null ? ` ${c.amedas.dir != null ? `${dirName(c.amedas.dir)} ` : ""}${fmt(c.amedas.wind)} m/s` : ""}${c.amedas.temp != null ? `・${fmt(c.amedas.temp)}℃` : ""}`],
  ].filter(Boolean);
}
const rowsHtml = rows => `<dl class="cond">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
// 前の形の日記：書いた時刻のぶんだけ
function snapHtml(e) {
  const rows = condRows(e.snap);
  return rows.length ? `<details class="entry-snap"><summary>${toHM(startOf(e))}の予報と観測</summary>${rowsHtml(rows)}</details>` : "";
}
// 表のマスに入る短い潮の段階：「上6」「下1」、満潮・干潮のころは「満」「干」
const tideShort = t => !t?.stageText ? "—" : t.near ? t.near[0] : `${t.phase[0]}${t.stage ?? ""}`;
// その日1日ぶん（1時間ごと）。写真・釣果のある時刻に印、はじめ〜おわりに色
function dayTable(e) {
  const marks = new Set(itemsOf(e).map(it => Math.round(it.at / 60)));
  const from = Math.floor(startOf(e) / 60), to = e.end != null ? Math.ceil(e.end / 60) : from;
  const hours = Array.from({ length: 24 }, (_, h) => ({ h, c: atTime(e.day, h * 60) }));
  const cls = h => h >= from && h <= to ? ' class="on"' : "";
  const row = (label, cell) => `<tr><th class="stick">${label}</th>${hours.map(({ h, c }) => `<td${cls(h)}>${cell(c)}</td>`).join("")}</tr>`;
  return `<details class="entry-snap"><summary>この日1日の予報と潮${e.day.later ? "（あとから読んだ値）" : ""}</summary>
    <div class="table-wrap day-table" data-from="${from}"><table class="tl">
      <thead><tr><th class="stick">時刻</th>${hours.map(({ h }) => `<th${cls(h)}>${marks.has(h) ? icon("camera") : ""}${h}時</th>`).join("")}</tr></thead>
      <tbody>
        ${row("潮位 cm", c => c.tide ? Math.round(c.tide.cm) : "—")}
        ${row("潮", c => tideShort(c.tide))}
        ${row("波 m", c => c.waveMean != null ? `${arrow(c.waveDir)}${fmt(c.waveMean)}` : "—")}
        ${row("風 m/s", c => c.windMean != null ? `${arrow(c.windDir)}${fmt(c.windMean)}` : "—")}
        ${row("天気", c => c.code != null ? esc(wxShort(c.code)) : "—")}
        ${row("気温", c => c.temp != null ? fmt(c.temp, 0) : "—")}
      </tbody></table></div>
    <p class="muted small" style="margin:8px 0 0">潮の「上6」は上げ6分（干潮から満潮までを10に分けて）。${icon("camera")}は写真・釣果のある時刻。波と風は予報をならした値。${e.day.later ? "前の日の値は、あとから読んだもの（そのときの予報とは少しちがうことがあります）。" : ""}</p>
  </details>`;
}

// ---- 写真を大きく見る（その時刻の値つき） ----
function openViewer(e, i) {
  viewing = { e, steps: stepsOf(e), i };
  drawViewer();
  const dlg = document.getElementById("diary-viewer");
  openDialog(dlg);
}
function drawViewer() {
  const { e, steps, i } = viewing;
  const st = steps[i];
  const rows = condRows(condAt(e, st.at));
  const title = st.kind === "start" ? "はじめ" : st.kind === "end" ? "おわり" : fishText(st.it) || "写真";
  const dlg = document.getElementById("diary-viewer");
  // qcheck-ok: W1 日記の中身は esc、値は condRows で esc する
  dlg.innerHTML = `<div class="viewer-in">
    <div class="viewer-bar">
      <div><strong>${ymdText(e.ymd)} ${toHM(st.at)}</strong><br><span class="sub small">${esc(e.placeTitle || e.place?.name || "")}</span></div>
      <button type="button" class="ls-icon-button" data-viewer-close aria-label="閉じる">${icon("close")}</button>
    </div>
    ${st.it?.photo ? `<img class="viewer-pic" data-photo="${esc(st.it.photo)}" alt="${toHM(st.at)}の写真">` : ""}
    <p class="viewer-title">${esc(title)}</p>
    ${rows.length ? rowsHtml(rows) : `<p class="muted small">この時刻の予報は残っていません。</p>`}
    ${e.day?.later ? `<p class="muted small">あとから読んだ値です。</p>` : ""}
    <div class="ls-grid-2 viewer-nav">
      <button type="button" class="ls-button" data-viewer-go="-1"${i ? "" : " disabled"}>${icon("back")}前</button>
      <button type="button" class="ls-button" data-viewer-go="1"${i < steps.length - 1 ? "" : " disabled"}>次${icon("next")}</button>
    </div>
  </div>`;
  fillPhotos(dlg);
}
function closeViewer() {
  const dlg = document.getElementById("diary-viewer");
  closeDialog(dlg);
  viewing = null;
}

// ---- 送る（おくるんのカード・端末の共有） ----
// 日記の場所を開くリンク（場所は書いたときの位置と名前で。ウィジェットの Parameter と同じ書き方）
const entryUrl = e => pageUrl(`${e.place.lat.toFixed(4)},${e.place.lon.toFixed(4)}=${e.place.name}`);
// 日記を文に（カードの中身と、共有の文）。釣果は時刻と潮の段階つき
function entryLines(e) {
  const saw = SAW.map(s => e.saw?.[s.key] ? `${s.label} ${e.saw[s.key]}` : "").filter(Boolean).join("・");
  const fish = [...itemsOf(e)].sort((a, b) => a.at - b.at).filter(it => it.fish).map(it => {
    const t = condAt(e, it.at)?.tide;
    return `🎣 ${toHM(it.at)} ${fishText(it)}${t?.stageText ? `（${t.stageText}）` : ""}`;
  });
  const memo = (e.memo || "").length > 200 ? `${e.memo.slice(0, 200)}…` : e.memo;
  const s = condAt(e, startOf(e));
  const fc = s ? [
    s.tide && `🌙 ${s.tide.moon}${s.tide.diff ? `・${s.tide.diff}` : ""}`,
    s.wave && `🌊 波 ${spread(s.wave)} m`,
    s.wind && `💨 風 ${s.windDir != null ? `${dirName(s.windDir)} ` : ""}${spread(s.wind)} m/s${s.gust != null ? `（突風 ${fmt(s.gust, 0)}）` : ""}`,
    (s.wx || s.temp != null) && `☁️ ${[s.wx, s.temp != null && `${fmt(s.temp, 0)}℃`].filter(Boolean).join("・")}`,
    s.sst != null && `🌡️ 水温 ${fmt(s.sst)}℃`,
  ].filter(Boolean) : [];
  return [
    (e.ferry || e.spot) && `🪨 ${[e.ferry, e.spot].filter(Boolean).join("・")}`,
    saw && `👀 ${saw}`,
    (e.did || []).length && `🏖️ ${e.did.join("・")}`,
    ...fish,
    memo && `📝 ${memo}`,
    ...(fc.length ? ["", `${toHM(startOf(e))}の予報`, ...fc] : []),
  ].filter(x => x || x === "");
}
function cardUrl(e) {
  return oqrnCardUrl({
    header: `🌊 ${NAMES.app}の日記`,
    date: `🕒 ${ymdText(e.ymd)} ${toHM(startOf(e))}${e.end != null ? `〜${toHM(e.end)}` : ""}`,
    title: e.placeTitle || e.place?.name || "",
    detail: entryLines(e).join("\n") || "海の日記",
    actionUrl: entryUrl(e),
  });
}
// 端末の共有の画面で、文・リンクと写真をいっしょに（写真を渡せない端末は文とリンクだけ。共有がなければ文をコピー）
async function shareEntry(e, btn) {
  if (!e) return;
  const text = [`${ymdText(e.ymd)} ${toHM(startOf(e))} ${e.placeTitle || e.place.name}`, ...entryLines(e)].join("\n");
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
  forgetFresh();
  dropped = [];
  if (e) {
    editing = structuredClone(e);
    editing.start = startOf(e);
    items = itemsOf(e).map(it => ({ ...it }));
    editYmd = e.ymd;
  } else {
    if (!now?.place) return;
    editing = { ymd: now.day.ymd, start: now.h * 60, end: null, saw: {}, did: [], memo: "" };
    items = [];
    editYmd = null;
  }
  drawForm();
  drawDay();
  document.getElementById("diary-form").scrollIntoView({ block: "start" });
}
// まだ残していない写真を、画面からも外す
function forgetFresh() {
  fresh.forEach((_, id) => { URL.revokeObjectURL(urls.get(id)); urls.delete(id); });
  fresh = new Map();
}
function stopEdit() {
  forgetFresh();
  editing = null; items = []; dropped = []; editYmd = null;
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
    <label class="ls-field"><span class="ls-label">日にち</span><input type="date" class="ls-input" name="ymd" value="${esc(e.ymd)}" max="${addDays(today(), DAYS - 1)}"></label>
    <div class="ls-grid-2">
      <label class="ls-field"><span class="ls-label">はじめ</span><input type="time" class="ls-input" name="start" value="${toInput(e.start)}"></label>
      <label class="ls-field"><span class="ls-label">おわり</span><input type="time" class="ls-input" name="end" value="${toInput(e.end)}"></label>
    </div>
    <p class="muted small diary-note" id="diary-snapnote"></p>
    ${isoField(e)}
    <div class="ls-field"><span class="ls-label">写真・釣果</span>
      <p class="muted small diary-note">釣果の左の丸を押すと、その釣果に写真がつきます。「写真を足す」の写真は、撮った時刻から${PHOTO_MATCH_MIN}分以内の写真のない釣果につき、なければ撮った時刻で新しく並びます。時刻と魚はあとから直せます。</p>
      <div class="items" id="diary-items"></div>
      <div class="item-add">
        <label class="ls-button">${icon("camera")}写真を足す<input type="file" accept="image/*" multiple class="vh" data-pic-input></label>
        <button type="button" class="ls-button" data-item-add>${icon("add")}写真なしで魚を足す</button>
      </div>
    </div>
    <div class="ls-field"><span class="ls-label">見た海のようす</span>
      ${SAW.map(s => `<div class="saw-row"><span class="saw-key">${s.label}</span>${chips(`saw:${s.key}`, s.opts, e.saw?.[s.key] || "", false)}</div>`).join("")}
    </div>
    <div class="ls-field"><span class="ls-label">したこと</span>${chips("did", DID, e.did || [], true)}</div>
    <label class="ls-field"><span class="ls-label">メモ</span><textarea class="ls-input" name="memo" rows="3" placeholder="例：朝まづめに足もとでアジ。10時ごろから北風が強くなった">${esc(e.memo || "")}</textarea></label>
    <div class="ls-grid-2 diary-actions">
      <button type="button" class="ls-button" data-cancel>やめる</button>
      <button type="button" class="ls-button is-primary" data-save>${icon("save")}残す</button>
    </div>`;
  drawAt();
  drawItems();
  isoAuto();
}
// 渡船・磯の欄。磯割のある島（data/isowari.json）なら渡船を選べて、その日の磯が入る。ほかの所は磯・釣り座を書くだけ
function isoField(e) {
  const isl = islandFor(e.place || now?.place);
  const ferry = e.id ? e.ferry || "" : myFerry(isl) || "";
  const spots = isl ? spotsOf(isl) : [];
  return `<div class="ls-field"><span class="ls-label">${isl ? "渡船・磯" : "磯・釣り座"}</span>
    ${isl ? `<div class="ls-chips" role="group" data-chips="ferry">${ferriesOf(isl).map(f => `<button type="button" class="ls-chip is-small" data-chip="${esc(f)}" aria-pressed="${f === ferry}"><i class="ferry-dot"${ferryStyle(isl, f)}></i>${esc(f)}</button>`).join("")}</div>` : ""}
    <input class="ls-input" name="spot" list="diary-spots" placeholder="${isl ? "磯（例：グンカン）" : "例：赤灯台の先・テトラ"}" value="${esc(e.spot || "")}" aria-label="磯">
    ${spots.length ? `<datalist id="diary-spots">${spots.map(x => `<option value="${esc(x)}">`).join("")}</datalist>` : ""}
    <p class="muted small diary-note" id="diary-iso-note"></p>
  </div>`;
}
// 選んだ渡船の、その日の磯。磯の欄が空か、前にここで入れたままなら入れなおす
function isoAuto() {
  const f = document.getElementById("diary-form"), note = document.getElementById("diary-iso-note");
  const isl = editing && islandFor(editing.place || now?.place);
  if (!isl || !note) return;
  const ferry = f.querySelector('[data-chips="ferry"] [aria-pressed="true"]')?.dataset.chip;
  const ymd = f.querySelector('[name="ymd"]').value || editing.ymd;
  const g = ferry && isoOn(isl, ymd)?.find(x => x.ferry === ferry)?.group;
  note.textContent = !ferry ? "" : g ? `${ymdText(ymd)}の${ferry}は「${g}」（${isl.name}の磯割）。` : "この日の磯割は、まだ発表されていません。";
  const spot = f.querySelector('[name="spot"]');
  if (g && (!spot.value || spot.dataset.auto === spot.value)) { spot.value = g; spot.dataset.auto = g; }
}

// 書いている日記の場所と、その日の予報をいっしょに残せるか
function drawAt() {
  const e = editing, at = document.getElementById("diary-at"), note = document.getElementById("diary-snapnote");
  if (!e || !at) return;
  const title = e.id ? e.placeTitle : now?.placeTitle;
  // qcheck-ok: W1 場所の名前は esc 済み
  at.innerHTML = `${icon("place")}<strong>${esc(title || "")}</strong>`;
  note.textContent = e.id && e.day && e.ymd === editYmd ? "予報・潮・観測は、はじめに残した1日ぶんのまま使います。"
    : !canKeepDay(e.ymd) ? `この日の予報は読めないので、書いたことだけ残します（予報を読めるのは約3か月前から${DAYS - 1}日先まで）。`
      : `${e.id ? "" : "場所は上でえらんでいる所。"}${ymdText(e.ymd)}1日ぶんの予報・潮・観測もいっしょに残し、写真・釣果の時刻の値を見られます。${dayIndex(e.ymd) < 0 ? "前の日は、あとから読んだ値になります。" : ""}`;
}

const itemRow = (it, i) => `<div class="item" data-item="${i}">
  <label class="item-pic" aria-label="${it.photo ? "写真をとりかえる" : "この釣果に写真をつける"}">${it.photo ? `<img data-photo="${esc(it.photo)}" alt="写真 ${i + 1}">` : icon("camera")}<input type="file" accept="image/*" class="vh" data-pic-for="${i}"></label>
  <div class="item-fields">
    <input type="time" class="ls-input" name="at" value="${toInput(it.at)}" aria-label="時刻">
    <input class="ls-input" name="fish" placeholder="魚" value="${esc(it.fish || "")}" aria-label="魚の名前">
    <input class="ls-input" name="count" inputmode="numeric" placeholder="匹" value="${esc(it.count || "")}" aria-label="数（匹）">
    <input class="ls-input" name="size" inputmode="decimal" placeholder="cm" value="${esc(it.size || "")}" aria-label="大きさ（cm）">
  </div>
  <button type="button" class="ls-icon-button" data-item-del="${i}" aria-label="これを外す">${icon("close")}</button></div>`;
function drawItems() {
  const el = document.getElementById("diary-items");
  if (!el) return;
  // qcheck-ok: W1 esc した入力と写真の id だけ
  el.innerHTML = items.map(itemRow).join("");
  fillPhotos(el);
}
// 入力欄の中身を items に（並べなおす前・残す前に）
function readItems() {
  document.querySelectorAll("#diary-items .item").forEach(row => {
    const it = items[Number(row.dataset.item)];
    if (!it) return;
    it.at = fromHM(row.querySelector('[name="at"]').value) ?? editing.start;
    it.fish = row.querySelector('[name="fish"]').value.trim();
    it.count = row.querySelector('[name="count"]').value.trim();
    it.size = row.querySelector('[name="size"]').value.trim();
  });
}

/** 写真を小さくして、まだ残していない写真として覚える。写真の id を返す */
async function keepPhoto(file) {
  const p = await shrink(file);
  const id = newId();
  fresh.set(id, p);
  urls.set(id, URL.createObjectURL(new Blob([p.buf], { type: p.type })));
  return id;
}

// ---- 写真の撮った時刻（JPEG の Exif。なければファイルの時刻）。その日のものでなければ null ----
async function exifTime(file) {
  const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
  if (v.getUint16(0) !== 0xFFD8) return null;
  let o = 2;
  while (o + 10 < v.byteLength) {
    const mk = v.getUint16(o), len = v.getUint16(o + 2);
    if ((mk & 0xFF00) !== 0xFF00) return null;
    if (mk === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) {
      const t = o + 10, le = v.getUint16(t) === 0x4949;
      const u16 = p => v.getUint16(p, le), u32 = p => v.getUint32(p, le);
      const find = (ifd, tag) => {
        const n = u16(t + ifd);
        for (let i = 0; i < n; i++) { const e = t + ifd + 2 + i * 12; if (u16(e) === tag) return { count: u32(e + 4), val: u32(e + 8) }; }
        return null;
      };
      const ifd0 = u32(t + 4), ex = find(ifd0, 0x8769);
      const dt = (ex && (find(ex.val, 0x9003) || find(ex.val, 0x9004))) || find(ifd0, 0x0132);
      if (!dt) return null;
      let s = "";
      for (let i = 0; i < Math.min(dt.count, 20); i++) s += String.fromCharCode(v.getUint8(t + dt.val + i));
      const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/.exec(s);
      return m ? { ymd: `${m[1]}-${m[2]}-${m[3]}`, min: Number(m[4]) * 60 + Number(m[5]) } : null;
    }
    o += 2 + len;
  }
  return null;
}
async function takenAt(file, ymd) {
  const ex = await exifTime(file).catch(() => null);
  if (ex) return ex.ymd === ymd ? ex.min : null;
  const jst = new Date(file.lastModified + 9 * 3600e3);
  return jst.toISOString().slice(0, 10) === ymd ? jst.getUTCHours() * 60 + jst.getUTCMinutes() : null;
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
// カレンダーと日の一覧に同じ写真が出ても、読むのは1回（読んでいる途中のものは、その読みこみを待つ）
const reading = new Map();
function photoUrl(id) {
  if (urls.has(id)) return Promise.resolve(urls.get(id));
  if (!reading.has(id)) reading.set(id, diaryDb.photo(id).catch(() => null).then(p => {
    reading.delete(id);
    if (!p) return "";
    records.set(id, p);
    const u = URL.createObjectURL(new Blob([p.buf], { type: p.type }));
    urls.set(id, u);
    return u;
  }));
  return reading.get(id);
}
function fillPhotos(root) {
  root.querySelectorAll("img[data-photo]").forEach(async img => { img.src = await photoUrl(img.dataset.photo); });
}

function readForm() {
  const f = document.getElementById("diary-form");
  const e = editing;
  e.ymd = f.querySelector('[name="ymd"]').value || e.ymd;
  e.start = fromHM(f.querySelector('[name="start"]').value) ?? e.start;
  e.end = fromHM(f.querySelector('[name="end"]').value);
  e.memo = f.querySelector('[name="memo"]').value.trim();
  e.saw = {};
  SAW.forEach(s => { const b = f.querySelector(`[data-chips="saw:${s.key}"] [aria-pressed="true"]`); if (b) e.saw[s.key] = b.dataset.chip; });
  e.did = [...f.querySelectorAll('[data-chips="did"] [aria-pressed="true"]')].map(b => b.dataset.chip);
  e.ferry = f.querySelector('[data-chips="ferry"] [aria-pressed="true"]')?.dataset.chip || "";
  e.spot = f.querySelector('[name="spot"]')?.value.trim() || "";
  readItems();
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
  }
  btn.disabled = true;
  const label = btn.innerHTML;
  btn.textContent = "予報を読んでいます…";
  // その日1日ぶん（まだないか、日にちを変えたとき）。読めなくても日記は残す
  if (e.day?.ymd !== e.ymd) {
    e.day = await getDay(e.place, e.ymd).catch(() => null);
    if (e.day || e.ymd !== editYmd) delete e.snap;
  }
  if (!e.day) delete e.day;
  e.hour = Math.floor(e.start / 60);
  e.items = items.map(({ id, at, photo, fish, count, size }) => ({ id, at, photo: photo || null, fish: fish || "", count: count || "", size: size || "" }))
    .filter(it => it.photo || it.fish).sort((a, b) => a.at - b.at);
  e.photos = e.items.filter(it => it.photo).map(it => it.photo);
  delete e.catches;
  e.updated = Date.now();
  const add = e.photos.filter(id => fresh.has(id)).map(id => ({ id, ...fresh.get(id) }));
  try {
    await diaryDb.save(e, add, dropped);
    // 消えにくくする（ブラウザが空きを作るときに消さないように頼む。だめでも動く）
    navigator.storage?.persist?.().catch(() => {});
    add.forEach(p => records.set(p.id, p));
    fresh = new Map(); // 残したので、画面の URL はそのまま使う
    dropped.forEach(id => { URL.revokeObjectURL(urls.get(id)); urls.delete(id); });
    entries = entries.filter(x => x.id !== e.id).concat(e);
    selected = e.ymd; month = e.ymd.slice(0, 7);
    stopEdit();
    drawCalendar();
    document.getElementById("diary-cal").scrollIntoView({ block: "start" });
  } catch {
    if (isNew) delete e.id;
    btn.disabled = false;
    btn.innerHTML = label;
    document.getElementById("diary-snapnote").textContent = "残せませんでした。端末の空きを確かめてください。";
  }
}

// ---- 押したとき ----
async function onClick(ev) {
  const t = ev.target.closest("button, a");
  if (!t) {
    // 写真を見ているとき、窓の外を押したら閉じる
    if (ev.target.id === "diary-viewer") closeViewer();
    if (ev.target.id === "diary-install") closeInstall();
    return;
  }
  const d = t.dataset;
  if (t.id === "diary-new") {
    if (shouldInstall() && !asked) { asked = true; openInstall(); }
    else startEdit();
  } else if ("installGo" in d) {
    if (await promptInstall()) closeInstall();
  } else if ("installSkip" in d) { closeInstall(); startEdit(); }
  else if ("installClose" in d) closeInstall();
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
    if (group.dataset.chips === "ferry") isoAuto();
  } else if ("itemAdd" in d) {
    readForm();
    // 今日なら今の時刻、ほかの日は、はじめの時刻
    const n = tokyoParts();
    const at = editing.ymd === n.ymd ? n.hour * 60 + new Date().getMinutes() : editing.start;
    items.push({ id: newId(), at, photo: null, fish: "", count: "", size: "" });
    drawItems();
    document.querySelector("#diary-items .item:last-child [name='fish']").focus();
  } else if (d.itemDel != null) {
    readItems();
    const [it] = items.splice(Number(d.itemDel), 1);
    if (it?.photo) {
      if (fresh.has(it.photo)) { URL.revokeObjectURL(urls.get(it.photo)); urls.delete(it.photo); fresh.delete(it.photo); }
      else dropped.push(it.photo);
    }
    drawItems();
  } else if ("cancel" in d) stopEdit();
  else if ("save" in d) save(t);
  else if (d.view) {
    const e = entries.find(x => x.id === d.view);
    if (e) openViewer(e, Number(d.step));
  } else if (d.viewerGo) {
    viewing.i = Math.max(0, Math.min(viewing.steps.length - 1, viewing.i + Number(d.viewerGo)));
    drawViewer();
  } else if ("viewerClose" in d) closeViewer();
  else if (d.share) shareEntry(entries.find(e => e.id === d.share), t);
  else if (d.edit) startEdit(entries.find(e => e.id === d.edit));
  else if (d.delete) {
    const e = entries.find(x => x.id === d.delete);
    if (!e) return;
    // Q キットの確認の窓（読めなかったときは消さない）
    const yes = await window.LineShareUI?.ask({ title: `${ymdText(e.ymd)} ${toHM(startOf(e))}の日記を消しますか？`, text: "写真もいっしょに消え、もとに戻せません。", ok: "消す", danger: true });
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
  else if ("csv" in d) exportCsv(t);
}
async function onChange(ev) {
  const t = ev.target;
  if (t.matches("[data-pic-input]")) {
    const files = [...t.files];
    t.value = "";
    readForm();
    for (const file of files) {
      try {
        const at = (await takenAt(file, editing.ymd)) ?? editing.start;
        const id = await keepPhoto(file);
        // 撮った時刻から PHOTO_MATCH_MIN 分以内に、写真のない釣果があれば、いちばん近いものにつける（ボットから入れた釣果など）
        const near = items.filter(it => !it.photo && it.fish && Math.abs(it.at - at) <= PHOTO_MATCH_MIN).sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
        if (near) near.photo = id;
        else items.push({ id: newId(), at, photo: id, fish: "", count: "", size: "" });
      } catch { /* 読めない写真は飛ばす */ }
    }
    items.sort((a, b) => a.at - b.at);
    drawItems();
  } else if (t.matches("[data-pic-for]")) {
    // 行の丸から：その釣果に写真をつける（あればとりかえる。時刻はそのまま）
    const it = items[Number(t.dataset.picFor)];
    const file = t.files[0];
    t.value = "";
    if (!it || !file) return;
    readForm();
    try {
      const id = await keepPhoto(file);
      if (it.photo) {
        if (fresh.has(it.photo)) fresh.delete(it.photo);
        else dropped.push(it.photo);
      }
      it.photo = id;
    } catch { return; }
    drawItems();
  } else if (t.matches('[name="ymd"], [name="start"]') && editing) {
    readForm();
    // 予報を読んである日なら、ページもその日時にする（書きなおしのときは動かさない）
    const i = dayIndex(editing.ymd);
    if (!editing.id && i >= 0 && i < DAYS) hooks.setView(i, Math.floor(editing.start / 60));
    drawAt();
    isoAuto();
  } else if (t.matches("[data-import]")) importFile(t);
}
document.addEventListener("keydown", ev => {
  if (!viewing || (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight")) return;
  viewing.i = Math.max(0, Math.min(viewing.steps.length - 1, viewing.i + (ev.key === "ArrowRight" ? 1 : -1)));
  drawViewer();
});

// ---- 分析用に書き出す（CSV。1行が写真・釣果1つ。ないときは日記1つ。その時刻の潮・風・波つき） ----
const CSV_HEAD = ["日付", "時刻", "種類", "場所", "緯度", "経度", "渡船", "磯", "はじめ", "おわり", "魚", "匹", "cm", "写真",
  "したこと", "見た波", "見た風", "見た水", "月齢", "潮", "潮位差m", "潮位cm", "潮位の高さ%", "上げ下げ", "潮の分", "満潮から分", "まづめ", "夜",
  "波m", "波の予報の低い値", "波の予報の高い値", "周期s", "波の向き", "風m/s", "風の予報の低い値", "風の予報の高い値", "風向", "風向°", "突風m/s",
  "天気", "気温", "降水確率%", "雨mm", "水温", "沖の流れkn", "沖の流れの向き", "あとから読んだ値", "メモ"];
function csvRows() {
  const rows = [];
  const n = (v, d = 1) => v == null || Number.isNaN(v) ? "" : Number(v).toFixed(d);
  [...entries].sort((a, b) => a.ymd.localeCompare(b.ymd) || startOf(a) - startOf(b)).forEach(e => {
    const list = [...itemsOf(e)].sort((a, b) => a.at - b.at);
    (list.length ? list : [{ at: startOf(e), diary: true }]).forEach(it => {
      const c = condAt(e, it.at) || {}, t = c.tide || {};
      rows.push([
        e.ymd, toHM(it.at), it.diary ? "日記" : it.fish ? "釣果" : "写真", e.placeTitle || e.place?.name || "", n(e.place?.lat, 4), n(e.place?.lon, 4), e.ferry || "", e.spot || "",
        toHM(startOf(e)), e.end != null ? toHM(e.end) : "", it.fish || "", it.count || "", it.size || "", it.photo ? 1 : 0,
        (e.did || []).join("・"), e.saw?.wave || "", e.saw?.wind || "", e.saw?.water || "",
        t.age ?? "", t.moon || "", (t.diff || "").replace(/[^\d.]/g, ""), n(t.cm, 0), t.pct ?? "", t.phase || "", t.stage ?? "", t.fromHigh ?? "", c.inMazume || "", c.night == null ? "" : c.night ? 1 : 0,
        n(c.waveMean), n(c.wave?.lo), n(c.wave?.hi), n(c.period, 0), c.waveDir != null ? dirName(c.waveDir) : "",
        n(c.windMean), n(c.wind?.lo), n(c.wind?.hi), c.windDir != null ? dirName(c.windDir) : "", n(c.windDir, 0), n(c.gust),
        c.wx || "", n(c.temp), c.rain ?? "", n(c.rainMm), n(c.sst), n(c.cur?.kn), c.cur?.dir != null ? dirName(c.cur.dir) : "", c.later ? 1 : 0, e.memo || "",
      ]);
    });
  });
  return rows;
}
async function exportCsv(btn) {
  const cell = v => { const s = String(v ?? ""); return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
  const rows = csvRows();
  // 先頭の BOM … 表計算ソフトで日本語が化けないように
  const text = "﻿" + [CSV_HEAD, ...rows].map(r => r.map(cell).join(",")).join("\r\n");
  const ok = await saveFile(new Blob([text], { type: "text/csv" }), `${EXPORT_TAG}-${today().replaceAll("-", "")}.csv`);
  if (ok) keepNote(`${rows.length}行を書き出しました（1行が写真・釣果1つ。その時刻の潮・風・波つき）。${IN_APP ? "保存されないときは、Safari などのブラウザで開いてください。" : ""}`);
  btn.blur();
}
// ファイルを渡す。スマホは共有の画面から（「ファイルに保存」できる）。だめなら、ふつうのダウンロード。やめたら false
async function saveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (IS_PHONE && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; }
    catch (err) { if (err?.name === "AbortError") return false; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return true;
}

// ---- 書き出す・読みこむ（この端末だけに残るので、ときどき書き出しておく） ----
const toB64 = buf => { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer;
async function exportAll(btn) {
  const photos = [];
  for (const e of entries) for (const id of e.photos || []) {
    const p = records.get(id) || await diaryDb.photo(id).catch(() => null);
    if (p) photos.push({ id, type: p.type, data: toB64(p.buf) });
  }
  const ok = await saveFile(new Blob([JSON.stringify({ app: EXPORT_TAG, version: 1, entries, photos })], { type: "application/json" }), `${EXPORT_TAG}-${today().replaceAll("-", "")}.json`);
  if (ok) keepNote(`${entries.length}件を書き出しました。${IN_APP ? "保存されないときは、Safari などのブラウザで開いてください。" : ""}`);
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
// ホーム画面に置く案内（日記タブの上）。置き方の手順と、いまある日記の移し方
function drawWhere() {
  const el = document.getElementById("diary-where");
  if (!el) return;
  if (!shouldInstall()) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  const n = entries.length;
  // qcheck-ok: W1 決まった文字と、esc したこのページの URL だけ
  el.innerHTML = `${icon(IN_APP ? "warn" : "tip")}<div class="where-in">
    <strong>日記は、ホーム画面のうみくるで書くのがおすすめ</strong>
    <p>${reasonText()}</p>
    <ol class="where-steps">${stepsHtml(icon, esc)}</ol>
    ${canPrompt() ? `<button type="button" class="ls-button is-primary" data-install-go>${icon("add")}ホーム画面に追加</button>` : ""}
    ${n ? `<p>ここにある日記 ${n}件は、ホーム画面のうみくるには自動で移りません（保存の場所が別）。先に書き出して、ホーム画面のうみくるの「読みこむ」で移してください。</p>
      <button type="button" class="ls-button" data-export>${icon("backup")}${n}件を書き出す</button>` : ""}
  </div>`;
}
function openInstall() {
  const dlg = document.getElementById("diary-install");
  // qcheck-ok: W1 決まった文字と、esc したこのページの URL だけ
  dlg.innerHTML = `<div class="viewer-in">
    <div class="viewer-bar"><strong>先にホーム画面に置きませんか？</strong>
      <button type="button" class="ls-icon-button" data-install-close aria-label="閉じる">${icon("close")}</button></div>
    <p class="small">${reasonText()}</p>
    <ol class="where-steps small">${stepsHtml(icon, esc)}</ol>
    ${canPrompt() ? `<button type="button" class="ls-button is-primary" data-install-go>${icon("add")}ホーム画面に追加</button>` : ""}
    <div class="ls-grid-2 viewer-nav">
      <button type="button" class="ls-button" data-install-close>置きに行く</button>
      <button type="button" class="ls-button" data-install-skip>このまま書く</button>
    </div>
  </div>`;
  openDialog(dlg);
}
function closeInstall() {
  closeDialog(document.getElementById("diary-install"));
}
export function drawDiaryShell() {
  // qcheck-ok: W1 決まった文字と、esc したこのページの URL だけ
  box().innerHTML = `
    <div class="sec-head">
      <h2>${icon("notebook")}海の日記</h2>
      <button type="button" class="ls-button" id="diary-new"${now ? "" : " disabled"}>${icon("edit")}書く</button>
    </div>
    <p class="muted small diary-lead">写真・釣果を時刻つきで残すと、その時刻の潮位・上げ下げ・風・波がいっしょに見られます。その日1日ぶんの予報・潮も残すので、あとでくらべて次の日えらびに。</p>
    <div class="alert diary-where" id="diary-where" hidden></div>
    <div id="diary-form" class="diary-form" hidden></div>
    <div id="diary-cal"></div>
    <div id="diary-day"></div>
    <dialog id="diary-viewer" class="viewer" aria-label="写真とその時刻の値"></dialog>
    <dialog id="diary-install" class="viewer" aria-label="ホーム画面に置く"></dialog>
    <details class="diary-keep">
      <summary>週のはじまり・書き出し</summary>
      <div class="diary-keep-row"><span class="small sub">週のはじまり</span>
        <div class="seg" role="group" aria-label="週のはじまり"><button type="button" data-week="1">月曜</button><button type="button" data-week="0">日曜</button></div></div>
      <p class="muted small">日記と写真はこのブラウザにだけ残ります（ほかの端末や人には送られません）。同じ端末でも、ブラウザやアプリがちがうと別の場所です。ブラウザのデータを消すと日記も消えるので、ときどき書き出してください。</p>
      <div class="diary-keep-row">
        <button type="button" class="ls-button" data-export>${icon("backup")}書き出す</button>
        <label class="ls-button">${icon("upload")}読みこむ<input type="file" accept="application/json,.json" class="vh" data-import></label>
      </div>
      <p class="muted small">分析用：写真・釣果1つを1行に、その時刻の潮位・上げ下げ・風・波・水温などを並べた表（CSV）。表計算ソフトで開けます。</p>
      <div class="diary-keep-row">
        <button type="button" class="ls-button" data-csv>${icon("chart")}分析用に書き出す</button>
      </div>
      <p class="muted small" id="diary-keep-note" aria-live="polite"></p>
    </details>`;
  drawWeekSeg();
}
