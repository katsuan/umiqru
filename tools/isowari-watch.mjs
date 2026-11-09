// うみくる：磯割表の見張り（週に1回、.github/workflows/isowari-watch.yml から）
// data/isowari.json の出どころのページから磯割表の画像を拾い、中身の指紋（sha256）を前の回とくらべる。
// 画像が増えた・変わった・なくなった、ページの更新日が変わった、期間の終わりが近い … のどれかがあれば、知らせの文を書く。
// 画像の中身（どの日にどの磯か）は読まない。変わったと知らせたら、人（か Claude）が画像を見てデータを直す
// 使い方：node tools/isowari-watch.mjs <前の記録.json> <新しい記録.json> <知らせ.md>
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const [prevPath, nextPath, reportPath] = process.argv.slice(2);
const SOON_DAYS = 31; // 期間の終わりの、何日前から知らせるか
const UA = { "user-agent": "umiqru-isowari-watch (GitHub Actions)" };

const data = JSON.parse(await readFile(new URL("../data/isowari.json", import.meta.url), "utf8"));
const prev = JSON.parse(await readFile(prevPath, "utf8").catch(() => "{}"));
const first = !prev.pages; // はじめての回は、記録を作るだけで知らせない

// ページの中の、磯割表の画像（watch … ファイル名の決まり。縮小版 -300x200・-s・pagespeed は外す）
function images(html, base, watch) {
  const found = new Set();
  for (const m of html.matchAll(/(?:src|href|srcset)="([^"]+)"/g)) {
    for (const part of m[1].split(",")) {
      const raw = part.trim().split(/\s+/)[0];
      if (!/\.(png|jpe?g)(\?|$)/i.test(raw)) continue;
      let u;
      try { u = new URL(raw, base); } catch { continue; }
      const path = decodeURIComponent(u.pathname);
      const file = path.split("/").pop();
      if (/-\d+x\d+\.(png|jpe?g)$/i.test(file) || /-s\.(png|jpe?g)$/i.test(file) || /\.pagespeed\./.test(file)) continue;
      if (watch ? !watch.test(file) : !/\/wp-content\/uploads\/|blogimg\.jp\//.test(u.href)) continue;
      u.search = "";
      found.add(u.href);
    }
  }
  return [...found].sort();
}
// ページの更新日（WordPress などの meta。なければ空）
const title = html => ((/<title>([^<]*)/.exec(html) || [])[1] || "").trim();
const modified = html => (/property="article:modified_time"\s+content="([^"]+)"/.exec(html) || /"dateModified"\s*:\s*"([^"]+)"/.exec(html) || [])[1] || "";

async function get(url, as = "text") {
  const r = await fetch(url, { headers: UA, redirect: "follow" });
  if (!r.ok) throw new Error(`${r.status}`);
  return as === "buf" ? Buffer.from(await r.arrayBuffer()) : r.text();
}
const sha = buf => createHash("sha256").update(buf).digest("hex").slice(0, 16);

const next = { checked: new Date().toISOString(), pages: {}, soon: prev.soon || {} };
const lines = [];
for (const island of data.islands) {
  for (const src of island.sources) {
    const was = prev.pages?.[src.url] || null;
    let html;
    try { html = await get(src.url); }
    catch (e) {
      // 読めないときは前の記録のまま（たまたまのことが多いので、知らせない）
      if (was) next.pages[src.url] = was;
      console.log(`読めなかった：${src.name}（${e.message}）`);
      continue;
    }
    const now = { name: src.name, title: title(html), modified: modified(html), images: {} };
    for (const img of images(html, src.url, src.watch ? new RegExp(src.watch) : null)) {
      try { now.images[img] = sha(await get(img, "buf")); }
      catch { if (was?.images?.[img]) now.images[img] = was.images[img]; }
    }
    next.pages[src.url] = now;
    console.log(`${src.name}：画像 ${Object.keys(now.images).length} 枚`);
    if (!was) continue;
    const name = u => decodeURIComponent(new URL(u).pathname.split("/").pop());
    const add = Object.keys(now.images).filter(u => !(u in was.images));
    const gone = Object.keys(was.images).filter(u => !(u in now.images));
    const changed = Object.keys(now.images).filter(u => u in was.images && was.images[u] !== now.images[u]);
    const notes = [
      ...add.map(u => `- 増えた画像：[${name(u)}](${u})`),
      ...changed.map(u => `- 中身が変わった画像：[${name(u)}](${u})`),
      ...gone.map(u => `- なくなった画像：${name(u)}`),
      ...(now.title && was.title && now.title !== was.title ? [`- ページの題名：${was.title} → ${now.title}`] : []),
      ...(now.modified && was.modified && now.modified !== was.modified ? [`- ページの更新日：${was.modified} → ${now.modified}`] : []),
    ];
    if (notes.length) lines.push(`### ${island.name}：[${src.name}](${src.url})`, ...notes, "");
  }
  // 期間の終わりが近い（その終わりの日ごとに1回だけ）
  const until = island.periods.map(p => p.to).sort().pop();
  const left = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.now()) / 864e5);
  if (until && left <= SOON_DAYS && next.soon[island.id] !== until) {
    next.soon[island.id] = until;
    lines.push(`### ${island.name}：磯割の期間がもうすぐ終わります`, `- data/isowari.json の期間は ${until} まで（あと ${Math.max(0, left)} 日）。つづきの磯割表が出ていないか見てください`, "");
  }
}

await writeFile(nextPath, JSON.stringify(next, null, 2));
const report = first || !lines.length ? "" : [
  "磯割表のページに変わったところがありました。画像を見て、`data/isowari.json` の順番（anchor・groups・ferries の shift）と期間（from・to）が合っているか確かめてください。",
  "合わないときは、新しい period を足すか、くり返しから外れる日を except に書きます。確かめたら checked の日付を直して、この Issue を閉じます。",
  "",
  ...lines,
].join("\n");
await writeFile(reportPath, report);
console.log(first ? "はじめての回なので、記録だけ作りました" : lines.length ? "知らせることがあります" : "変わったところはありません");
