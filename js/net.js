// うみくる：ネットから JSON を読む
// 読まれるところ：app.js と js/ の部品

// 返事のない窓口を待ちつづけないよう、WAIT_MS で切る（ほかの読みこみが後ろで止まらないように）
export const WAIT_MS = 20000;
export async function getJSON(url, ms = WAIT_MS) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  const r = await fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(timer));
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}
