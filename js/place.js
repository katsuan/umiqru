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
  // 「(32.79, 132.49)」「32.79,132.49」「32.79 132.49」など。かっこ・全角もよい
  const plain = text.replace(/[（(）)\[\]]/g, "").replace(/[，、]/g, ",").replace(/[０-９．－]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).trim();
  const ll = plain.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (ll) return { name: `${(+ll[1]).toFixed(4)}, ${(+ll[2]).toFixed(4)}`, lat: +ll[1], lon: +ll[2], coords: true };
  const ports = await loadPorts();
  const exact = ports.find(p => p.name === text);
  if (exact) return { name: exact.name, lat: exact.lat, lon: exact.lon };
  // 「○○」と「○○市」をいっしょにさがす（なければ「○○町」も）。候補は、日本・近くに潮の港（30km 以内）がある・人の多い の順に選ぶ
  const search = async name => {
    try {
      const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=ja&format=json`);
      return j.results || [];
    } catch { return []; }
  };
  let found = (await Promise.all([text, text + "市"].map(search))).flat();
  if (!found.length) found = await search(text + "町");
  if (found.length) {
    const near = r => ports.some(p => km({ lat: r.latitude, lon: r.longitude }, p) <= PORT_MAX_KM);
    const score = r => (r.country_code === "JP" ? 2 : 0) + (near(r) ? 1 : 0);
    const best = found.sort((a, b) => score(b) - score(a) || (b.population || 0) - (a.population || 0))[0];
    return { name: text, lat: best.latitude, lon: best.longitude };
  }
  const part = ports.find(p => p.name.includes(text) || text.includes(p.name));
  if (part) return { name: part.name, lat: part.lat, lon: part.lon };
  throw new Error(`「${text}」が見つかりませんでした`);
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
    const m = String(muni).padStart(5, "0");
    const keys = Object.keys(area.class20s);
    const c20 = area.class20s[m + "00"] ? m + "00"
      : keys.find(k => k.startsWith(m)) || keys.find(k => k.startsWith(m.slice(0, 4) + "0"));
    if (c20) {
      const c10 = area.class15s[area.class20s[c20].parent]?.parent;
      const office = area.class10s[c10]?.parent;
      if (c10 && office) jma = { c20, c10, office, name: `${area.offices[office]?.name || ""}${area.class10s[c10].name}`, muniName: area.class20s[c20].name };
    }
  }
  return { port, jma };
}
