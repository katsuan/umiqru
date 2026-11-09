// うみくる：磯割（渡船ごとに、その日に上がる磯のまとまり）。data/isowari.json の島だけ。毎日ずれてくり返す順番を計算で出す
// 読まれるところ：app.js（まとめの「磯割」）、js/diary.js（日記の渡船・磯）
import { getJSON } from "./net.js";
import { km } from "./place.js";
import { store } from "./store.js";

let islands = [];
// 読みこむ（読めなくても、磯割を出さないだけ）
export const loadIso = () => getJSON("data/isowari.json").then(j => { islands = j.islands || []; }, () => { islands = []; });

// その場所の島（島の中心から km 以内）。なければ null
export function islandFor(place) {
  if (!place) return null;
  let best = null, bd = Infinity;
  islands.forEach(s => { const d = km(place, s); if (d <= s.km && d < bd) { best = s; bd = d; } });
  return best;
}

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const mod = (n, m) => ((n % m) + m) % m;
// その島・その日の渡船ごとの磯 [{ ferry, group }]。発表のない日は null
export function isoOn(island, ymd) {
  const p = island?.periods.find(x => ymd >= x.from && ymd <= x.to);
  if (!p) return null;
  const k = daysBetween(p.anchor, ymd), ex = island.except?.[ymd] || {};
  return p.ferries.map(f => ({ ferry: f.name, group: ex[f.name] || p.groups[mod(k + f.shift, p.groups.length)] }));
}
// 渡船の船の色（data/isowari.json の color。なければ null）
export const ferryColor = (island, name) => (island?.periods || []).flatMap(p => p.ferries).find(f => f.name === name)?.color || null;
// 色をつける style（--ferry に船の色）。色がなければ空
export const ferryStyle = (island, name) => { const c = ferryColor(island, name); return c && /^#[0-9a-f]{3,8}$/i.test(c) ? ` style="--ferry:${c}"` : ""; };
// その島の渡船の名前と、磯の名前（まとまりを分けたもの。日記の候補）
export const ferriesOf = island => [...new Set((island?.periods || []).flatMap(p => p.ferries.map(f => f.name)))];
export const spotsOf = island => [...new Set((island?.periods || []).flatMap(p => p.groups.flatMap(g => g.split("・"))))];
// 発表のある、いちばん先の日
export const isoUntil = island => (island?.periods || []).map(p => p.to).sort().pop() || null;

// いつもの渡船（島ごとに、この端末に覚える。いくつでも。前の形の1つだけの値も読む）
export function myFerries(island) {
  if (!island) return [];
  const v = store.get(`umiqru:ferry:${island.id}`), names = ferriesOf(island);
  return (Array.isArray(v) ? v : v ? [v] : []).filter(n => names.includes(n));
}
export const setMyFerries = (island, list) => store.set(`umiqru:ferry:${island.id}`, list);
// 日記に先に入れる渡船（いつもの渡船が1つだけのとき）
export const myFerry = island => { const m = myFerries(island); return m.length === 1 ? m[0] : null; };
