// うみくる：地図から場所を選ぶ窓（押した所・動かしたピンの緯度経度で見る。名前もつけられる。寄ると潮汐表のある港の丸）
// 地図は国土地理院のタイル（標準・写真）を Leaflet で。Leaflet は窓を初めて開いたときだけ読む
// 読まれるところ：app.js（検索欄の横の地図のボタン）
import { NAMES } from "./names.js";
import { closeDialog, icon, openDialog } from "./format.js";
import { loadPorts } from "./place.js";

const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";
const TILES = {
  std: { label: "地図", url: "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", max: 18 },
  photo: { label: "写真", url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", max: 18 },
};
const JAPAN = { lat: 35.0, lon: 136.0, zoom: 5 };
const PORT_ZOOM = 9; // 港のピン（潮汐表のある港）は、この大きさより寄ったときだけ出す（日本全体だと多すぎる）
const round = v => +v.toFixed(4);

let leafletP = null;
function loadLeaflet() {
  return leafletP ??= new Promise((ok, ng) => {
    const css = document.createElement("link");
    css.rel = "stylesheet"; css.href = `${LEAFLET}leaflet.min.css`;
    document.head.append(css);
    const js = document.createElement("script");
    js.src = `${LEAFLET}leaflet.min.js`;
    js.onload = () => ok(window.L);
    js.onerror = () => { leafletP = null; ng(new Error("地図を読みこめませんでした")); };
    document.head.append(js);
  });
}

let map = null, pin = null, layers = {}, onPick = null, picked = null, ports = null;
const $ = id => document.getElementById(id);

function show(ll) {
  picked = { lat: round(ll.lat), lon: round(((ll.lng + 540) % 360) - 180) };
  $("map-ll").textContent = `${picked.lat}, ${picked.lon}`;
  $("map-go").disabled = false;
  $("map-copy").disabled = false;
}
function place(L, ll) {
  if (pin) pin.setLatLng(ll);
  else {
    pin = L.marker(ll, { draggable: true, keyboard: false }).addTo(map);
    pin.on("dragend", () => show(pin.getLatLng()));
  }
  show(ll);
}
function setLayer(key) {
  Object.entries(layers).forEach(([k, l]) => { if (k === key) l.addTo(map); else l.remove(); });
  document.querySelectorAll("#map-layer [data-layer]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.layer === key)));
}

// 潮汐表のある港のピン（data/ports.json）。押すと、その港の位置と名前を選ぶ。寄ったときだけ出す
function addPorts(L) {
  loadPorts().then(list => {
    const canvas = L.canvas({ padding: 0.3, tolerance: 10 }); // 指でも押せるように、まわり10pxまで
    ports = L.layerGroup(list.map(p => L.circleMarker([p.lat, p.lon], { renderer: canvas, radius: 8, weight: 3, color: "#0e6e9e", fillColor: "#ffffff", fillOpacity: 1 })
      .bindTooltip(p.name, { direction: "top", offset: [0, -6] })
      .on("click", ev => {
        L.DomEvent.stopPropagation(ev);
        place(L, ev.latlng);
        $("map-name").value = p.name;
      })));
    const toggle = () => { if (map.getZoom() >= PORT_ZOOM) ports.addTo(map); else ports.remove(); };
    map.on("zoomend", toggle);
    toggle();
  }).catch(() => {});
}

// 開く。from … いま見ている場所（なければ日本全体）。pick({lat, lon, name}) … 「ここを見る」で呼ぶ
export async function openMapPick(from, pick) {
  onPick = pick;
  const dlg = $("map-pick");
  openDialog(dlg);
  $("map-name").value = "";
  $("map-note").textContent = "地図を読みこみ中…";
  let L;
  try { L = await loadLeaflet(); }
  catch (e) { $("map-note").textContent = e.message; return; }
  $("map-note").textContent = "地図を押すか、ピンを動かして場所を決めます。寄ると、潮汐表のある港が丸で出ます（押すとその港）。写真にすると磯や岩も見えます。";
  if (!map) {
    map = L.map("map-box", { zoomControl: true, attributionControl: true });
    map.attributionControl.setPrefix(false);
    const attr = `<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">${NAMES.gsi}</a>`;
    layers = Object.fromEntries(Object.entries(TILES).map(([k, t]) => [k, L.tileLayer(t.url, { maxZoom: t.max, attribution: attr })]));
    setLayer("std");
    map.on("click", ev => place(L, ev.latlng));
    addPorts(L);
  }
  if (from) { map.setView([from.lat, from.lon], 13); place(L, { lat: from.lat, lng: from.lon }); }
  else if (!pin) map.setView([JAPAN.lat, JAPAN.lon], JAPAN.zoom);
  // 窓が開いてから大きさを測りなおす（開く前は 0 のことがある）
  requestAnimationFrame(() => map.invalidateSize());
}

const close = () => closeDialog($("map-pick"));

// 窓の中身（index.html の #map-pick に入れる）と、ボタンの動き
export function initMapPick(copy) {
  const dlg = $("map-pick");
  dlg.innerHTML = `<div class="viewer-in map-in">
    <div class="viewer-bar">
      <strong>地図で選ぶ</strong>
      <button type="button" class="ls-icon-button" data-map-close aria-label="閉じる">${icon("close")}</button>
    </div>
    <div class="ls-chips" id="map-layer" role="group" aria-label="地図の種類">
      ${Object.entries(TILES).map(([k, t]) => `<button type="button" class="ls-chip" data-layer="${k}" aria-pressed="${k === "std"}">${t.label}</button>`).join("")}
    </div>
    <div id="map-box" class="map-box"></div>
    <p class="muted small" id="map-note"></p>
    <p class="map-ll"><span class="sub small">緯度, 経度</span> <strong id="map-ll">—</strong></p>
    <label class="map-name"><span class="sub small">名前（なくてもよい。磯の名前など）</span>
      <input type="text" class="ls-input" id="map-name" maxlength="30" placeholder="例：グンカン" enterkeyhint="go"></label>
    <div class="ls-grid-2">
      <button type="button" class="ls-button" id="map-copy" disabled>${icon("copy")}コピー</button>
      <button type="button" class="ls-button is-primary" id="map-go" disabled>ここを見る</button>
    </div>
  </div>`;
  const named = () => {
    const name = $("map-name").value.trim().replace(/[=,]/g, "");
    return name ? `${picked.lat},${picked.lon}=${name}` : `${picked.lat},${picked.lon}`;
  };
  dlg.addEventListener("click", ev => {
    if (ev.target === dlg || ev.target.closest("[data-map-close]")) { close(); return; }
    const l = ev.target.closest("[data-layer]");
    if (l && map) setLayer(l.dataset.layer);
  });
  $("map-copy").addEventListener("click", ev => { if (picked) copy(named, ev.currentTarget); });
  const go = () => { if (!picked) return; const q = named(); close(); onPick?.(q); };
  $("map-go").addEventListener("click", go);
  $("map-name").addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); go(); } });
}
