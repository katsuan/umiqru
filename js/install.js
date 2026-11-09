// うみくる：ホーム画面に置く案内。日記はブラウザごとに別の場所に残り、iPhone の Safari はしばらく開かないと消すことがあるので、日記はホーム画面のうみくるで書いてもらう
// 読まれるところ：js/diary.js
const UA = navigator.userAgent;
const IN_LINE = /\bLine\//i.test(UA);
export const IN_APP = IN_LINE || /FBAN|FBAV|Instagram|Twitter/i.test(UA);
const IS_IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/.test(UA);
export const IS_PHONE = IS_IOS || IS_ANDROID;
export const standalone = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
// ホーム画面に置くのをすすめるか（スマホとアプリの中のブラウザだけ。パソコンは消えにくいので出さない）
export const shouldInstall = () => !standalone() && (IN_APP || IS_PHONE);

// Android の Chrome などは、ボタンから「ホーム画面に追加」を出せる
let deferred = null;
let changed = () => {};
export const onInstallChange = fn => { changed = fn; };
addEventListener("beforeinstallprompt", ev => { ev.preventDefault(); deferred = ev; changed(); });
addEventListener("appinstalled", () => { deferred = null; changed(); });
export const canPrompt = () => !!deferred;
export async function promptInstall() {
  if (!deferred) return false;
  const ev = deferred;
  deferred = null;
  ev.prompt(); // qcheck-ok: W8 ホーム画面に追加の窓（beforeinstallprompt）。小窓ではない
  const r = await ev.userChoice.catch(() => null);
  changed();
  return r?.outcome === "accepted";
}

// LINE で開いたとき、ふだんのブラウザで開きなおすリンク
function outsideUrl() {
  const u = new URL(location.href);
  u.searchParams.set("openExternalBrowser", "1");
  return u.href;
}

// なぜ置くか（1〜2文）
export const reasonText = () => IN_APP
  ? "いまはアプリの中のブラウザです。ここで書いた日記はこのアプリの中にだけ残り、キャッシュを消すと消えます。書き出しもできないことがあります。"
  : IS_IOS
    ? "Safari のままだと、しばらく開かないと日記と写真が消えることがあります。ホーム画面に置いて、そこから開くと消えにくくなります。"
    : "ブラウザのままだと、端末の空きが足りないときに消されることがあります。ホーム画面に置くと消えにくく、すぐ開けます。";

// 置き方の手順（ol の中身）。icon … 線アイコンの HTML を作る関数、esc … HTML に入れる文字の esc
export function stepsHtml(icon, esc) {
  const open = "ホーム画面の「うみくる」のアイコンから開いて、日記を書く";
  if (IN_APP) return [
    IN_LINE ? `<a href="${esc(outsideUrl())}">ふだんのブラウザで開く</a>` : "右上か下のメニューから「ブラウザで開く」（Safari・Chrome など）",
    "開いたページで、共有ボタンかメニューから「ホーム画面に追加」",
    open,
  ].map(s => `<li>${s}</li>`).join("");
  if (IS_IOS) return [
    `共有ボタン ${icon("share")} を押す（見つからないときは、下の「…」から「共有」）`,
    "下へ送って「ホーム画面に追加」を選ぶ",
    "右上の「追加」を押す",
    open,
  ].map(s => `<li>${s}</li>`).join("");
  return [
    deferred ? `下の「ホーム画面に追加」を押す` : "右上の ⋮ を押す",
    deferred ? "出てきた窓で「インストール」か「追加」" : "「ホーム画面に追加」か「アプリをインストール」を選ぶ",
    open,
  ].map(s => `<li>${s}</li>`).join("");
}
