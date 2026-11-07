// うみくる：場所をさがす（港の名前・地名・緯度経度）と、近い潮の港・気象庁の地域を決める
// 読まれるところ：app.js と js/ の部品
import { PORT_MAX_KM } from "./sources.js";
import { store } from "./store.js";
import { getJSON } from "./net.js";

export let portsP = null, areaP = null;
export const loadPorts = () => portsP ??= getJSON("data/ports.json").then(j => j.ports.filter(p => p[3] != null).map(([pc, hc, name, lat, lon]) => ({ pc, hc, name, lat, lon })));
export const loadArea = () => areaP ??= getJSON("https://www.jma.go.jp/bosai/common/const/area.json");

export function km(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ---- 場所をさがす ----
// 港の名前にそのまま当たれば港の位置。なければ地名（人口の多いほう）。それでもなければ港の名前の一部
export async function findPlace(text) {
  text = text.trim();
  // 「(20.43, 136.08)」「20.43,136.08」「20.43 136.08」など。かっこ・全角もよい
  const plain = text.replace(/[（(）)\[\]]/g, "").replace(/[，、]/g, ",").replace(/[０-９．－]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).trim();
  const ll = plain.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (ll) return { name: `${(+ll[1]).toFixed(4)}, ${(+ll[2]).toFixed(4)}`, lat: +ll[1], lon: +ll[2], coords: true };
  // 「32.8027,132.4898=鵜来島」… 位置と名前（同じ名前の場所がほかにもあるときの共有リンク・ウィジェットの Parameter と同じ形）
  const named = text.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*=\s*(.+)$/);
  if (named) return { name: named[3].trim(), lat: +named[1], lon: +named[2], pinned: true };
  const ports = await loadPorts();
  const exact = ports.find(p => p.name === text);
  if (exact) return { name: exact.name, lat: exact.lat, lon: exact.lon };
  // 「鵜来島（宿毛市）」のように地域を添えたら、その地域の候補を選ぶ（「ほかの○○」から選んだとき）
  const hm = text.match(/^(.+?)（(.+)）$/);
  const base = hm ? hm[1] : text, hint = hm ? hm[2] : "";
  const cands = await placeCandidates(base, ports);
  if (cands.length) {
    const pick = (hint && (cands.find(c => c.short === hint) || cands.find(c => c.label.includes(hint)))) || cands[0];
    // 候補ひとつずつの場所（いちばん上は名前だけ、ほかは地域を添える）。選んだもの以外を「ほかの候補」にする
    const asPlace = c => ({ name: c === cands[0] ? base : `${base}（${c.short}）`, label: c.label, lat: c.lat, lon: c.lon });
    const all = cands.slice(0, 6).map(asPlace);
    const me = asPlace(pick);
    const alts = all.filter(a => a.name !== me.name);
    return alts.length ? { ...me, alts } : { name: me.name, lat: me.lat, lon: me.lon };
  }
  const part = ports.find(p => p.name.includes(text) || text.includes(p.name));
  if (part) return { name: part.name, lat: part.lat, lon: part.lon };
  throw new Error(`「${text}」が見つかりませんでした`);
}

// 同じ名前の場所の候補（よさそうな順）。Open-Meteo の地名と、国土地理院の地名さがし（小さな島や字も載っている）の両方から。
// 5km 以内はひとつにまとめ、日本・近くに潮の港（30km 以内）・人の多さ・国土地理院の町や字の名前に載っている（人の住む所） の順に選ぶ。
// SQriptable の sea カード（seaPlace）も同じ決め方
async function placeCandidates(text, ports) {
  const om = async name => {
    try { return (await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=ja&format=json`)).results || []; } catch { return []; }
  };
  const gsiP = getJSON(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(text)}`).catch(() => []);
  let found = (await Promise.all([text, text + "市"].map(om))).flat();
  if (!found.length) found = await om(text + "町");
  const gsi = (await gsiP || []).map(f => ({ title: f.properties?.title || "", code: f.properties?.addressCode, ds: f.properties?.dataSource, lon: f.geometry?.coordinates?.[0], lat: f.geometry?.coordinates?.[1] }))
    .filter(g => Number.isFinite(g.lat) && Number.isFinite(g.lon));
  const area = await loadArea().catch(() => null);
  const muniLabel = code => {
    const key = code && area && c20Key(area, code);
    const c20 = key && area.class20s[key];
    if (!c20) return null;
    const c10 = area.class15s[c20.parent]?.parent, office = area.class10s[c10]?.parent;
    return { label: `${area.offices[office]?.name || ""} ${c20.name}`.trim(), short: c20.name };
  };
  const list = [];
  const add = (c) => {
    const same = list.find(x => km(x, c) <= 5);
    if (!same) { list.push(c); return; }
    same.pop = Math.max(same.pop, c.pop); same.jp ||= c.jp;
    if (!same.code && c.code) { same.code = c.code; same.label = c.label; same.short = c.short; }
  };
  found.forEach(r => add({ lat: r.latitude, lon: r.longitude, pop: r.population || 0, jp: r.country_code === "JP", label: [r.admin1, r.admin2].filter(Boolean).join(" ") || r.country || "", short: r.admin2 || r.admin1 || r.country || "" }));
  // 国土地理院の地名（島・岬など。dataSource 4）で、名前がそのままのもの。町や字（5）は全国に同じ名前が多いので、
  // ほかに何もないときだけ候補にする
  const addGsi = ds => gsi.filter(g => g.code && g.ds === ds && g.title === text)
    .forEach(g => { const m = muniLabel(g.code); if (m) add({ lat: g.lat, lon: g.lon, pop: 0, jp: true, code: g.code, ...m }); });
  addGsi("4");
  if (!list.length) addGsi("5");
  // 国土地理院の町や字の名前に載っている数（「沖の島町鵜来島」など。人の住む所ほど多い）
  list.forEach(c => { c.towns = gsi.filter(g => g.ds === "5" && g.title.endsWith(text) && km(c, g) <= 5).length; });
  const near = c => ports.some(p => km(c, p) <= PORT_MAX_KM);
  const score = c => (c.jp ? 2 : 0) + (near(c) ? 1 : 0);
  return list.map((c, i) => ({ ...c, i })).sort((a, b) => score(b) - score(a) || b.pop - a.pop || b.towns - a.towns || a.i - b.i);
}

// 国土地理院の市区町村コード → 気象庁の市町村の区分（政令市の区は市の番号で載っていることがある）
function c20Key(area, code) {
  const m = String(code).padStart(5, "0");
  const keys = Object.keys(area.class20s);
  return area.class20s[m + "00"] ? m + "00" : keys.find(k => k.startsWith(m)) || keys.find(k => k.startsWith(m.slice(0, 4) + "0")) || null;
}

// 近い潮の港と、気象庁の地域（国土地理院の市区町村コード → 気象庁の区分）
export async function placeContext(place) {
  const ports = await loadPorts();
  let port = null, best = Infinity;
  ports.forEach(p => { const d = km(place, p); if (d < best) { best = d; port = { ...p, km: d }; } });
  if (best > PORT_MAX_KM) port = null; // 日本の外や沖の遠く

  const area = await loadArea();
  const muniAt = async pt => {
    try {
      const j = await getJSON(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${pt.lat}&lon=${pt.lon}`);
      return j?.results?.muniCd || null;
    } catch { return null; }
  };
  // 海の上なら、港の位置とそのまわりを少しずつ広げてさがす
  const cacheKey = `umiqru:muni:${place.lat.toFixed(3)},${place.lon.toFixed(3)}`;
  let muni = store.get(cacheKey) || await muniAt(place);
  const bases = port ? [place, port] : [];
  for (const r of bases.length && !muni ? [0.02, 0.05, 0.1] : []) {
    // ひと回りぶん（8方向×2か所）をまとめて聞く
    const ring = bases.flatMap(b => [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]
      .map(([dy, dx]) => ({ lat: +(b.lat + dy * r).toFixed(4), lon: +(b.lon + dx * r).toFixed(4) })));
    muni = (await Promise.all(ring.map(muniAt))).find(Boolean) || null;
    if (muni) break;
  }
  if (muni) store.set(cacheKey, muni);
  let jma = null;
  if (muni) {
    const c20 = c20Key(area, muni);
    if (c20) {
      const c10 = area.class15s[area.class20s[c20].parent]?.parent;
      const office = area.class10s[c10]?.parent;
      if (c10 && office) jma = { c20, c10, office, name: `${area.offices[office]?.name || ""}${area.class10s[c10].name}`, muniName: area.class20s[c20].name };
    }
  }
  return { port, jma };
}
