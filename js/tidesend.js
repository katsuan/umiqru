// うみくる：その日の潮だけを、くらぶボットに送る窓（ボットのカードの「🌊 潮をうみくるで直す」から ?tide=日にち で開く）
// 潮汐表（tide736）のその日の潮を読み、「🌊 うみくるの潮 …」の文を LINE でボットのトークの入力欄に入れて開く（送るのは使う人）。
// ボットは、その日・その釣り場の記録の潮を直して、描きなおしたカードを返す（q-qlove-bot の 56_sea_diary.gs）
// 読まれるところ：app.js
import { NAMES } from "./names.js";
import { state } from "./state.js";
import { loadTide } from "./forecast.js";
import { canKeepDay } from "./daydata.js";
import { closeDialog, esc, icon, openDialog } from "./format.js";
import { botMessageUrl, tideLines } from "./diary.js";

/** リンクの ?tide=2026-11-12 を読む（なければ null） */
export function tideFromUrl(search) {
  const ymd = new URLSearchParams(search).get("tide") || "";
  return /^\d{4}-\d\d-\d\d$/.test(ymd) && canKeepDay(ymd) ? ymd : null;
}

/** いま開いている場所の、その日の潮を読んで、ボットに送る窓を開く */
export async function openTideSend(ymd) {
  const dlg = document.getElementById("tide-send");
  if (!dlg || !state.place) return;
  const port = state.ctx?.port;
  const close = `<button type="button" class="ls-icon-button" data-tide-close aria-label="閉じる">${icon("close")}</button>`;
  const shell = body => `<div class="viewer-in"><div class="viewer-bar"><strong>その日の潮を${esc(NAMES.bot)}に送る</strong>${close}</div>${body}</div>`;
  dlg.onclick = ev => { if (ev.target === dlg || ev.target.closest("[data-tide-close]")) closeDialog(dlg); };
  // qcheck-ok: W1 決まった文と、esc した港・場所の名前だけ
  dlg.innerHTML = shell(`<p class="muted small">潮を読んでいます…</p>`);
  openDialog(dlg);
  const td = port ? await loadTide(port, ymd).catch(() => null) : null;
  const lines = td ? tideLines({ cm: (td.tide || []).map(t => t.cm), flood: td.flood, edd: td.edd }) : [];
  const where = `${Number(state.place.lat).toFixed(4)},${Number(state.place.lon).toFixed(4)} ${String(state.place.name || "").replace(/[\r\n]/g, " ")}`.trim();
  const text = [`🌊 ${NAMES.app}の潮 ${ymd}`, `📍 ${where}`, port ? `潮：${port.name}（${NAMES.tide736}）` : "", ...lines].filter(Boolean).join("\n");
  const url = lines.length ? botMessageUrl(text) : "";
  const [, m, d] = ymd.split("-").map(Number);
  // qcheck-ok: W1 決まった文と、esc した港・場所の名前・URL だけ
  dlg.innerHTML = shell(url
    ? `<p>${m}月${d}日の ${esc(port.name)}（${esc(NAMES.tide736)}）の潮を送ります。${esc(NAMES.bot)}は、その日・その釣り場の記録の潮を直して、描きなおしたカードを返します。</p>
       <a class="ls-button line is-block" href="${esc(url)}">${esc(NAMES.bot)}に送る</a>`
    : `<p class="muted">${!port ? "この場所の近くに潮汐表の港がありません。" : !lines.length ? "その日の潮を読めませんでした。少しあとで、もう一度開いてください。" : `${esc(NAMES.bot)}がわかりません。${esc(NAMES.bot)}のカードのボタンから開いてください。`}</p>`);
}
