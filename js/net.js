// うみくる：ネットから JSON を読む
// 読まれるところ：app.js と js/ の部品

export async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}
