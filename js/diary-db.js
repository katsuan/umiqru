// うみくる：海の日記をこの端末に残す（IndexedDB）。日記は entries、写真は photos（ArrayBuffer と種類で。古い iPhone でも読めるように）
// 読まれるところ：js/diary.js

const NAME = "umiqru-diary", VERSION = 1;
let opening = null;

function open() {
  if (opening) return opening;
  opening = new Promise((ok, ng) => {
    if (!("indexedDB" in self)) { ng(new Error("この端末には日記を残せません")); return; }
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("entries", { keyPath: "id" });
      r.result.createObjectStore("photos", { keyPath: "id" });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ng(r.error);
  });
  opening.catch(() => { opening = null; });
  return opening;
}
const done = r => new Promise((ok, ng) => { r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error); });
const finish = t => new Promise((ok, ng) => { t.oncomplete = () => ok(); t.onerror = t.onabort = () => ng(t.error); });

export const diaryDb = {
  async all() {
    const db = await open();
    return done(db.transaction("entries").objectStore("entries").getAll());
  },
  // 日記1つと、足した写真・消した写真を、いっしょに書く
  async save(entry, add = [], drop = []) {
    const db = await open();
    const t = db.transaction(["entries", "photos"], "readwrite");
    t.objectStore("entries").put(entry);
    const ps = t.objectStore("photos");
    add.forEach(p => ps.put(p));
    drop.forEach(id => ps.delete(id));
    return finish(t);
  },
  async remove(entry) {
    const db = await open();
    const t = db.transaction(["entries", "photos"], "readwrite");
    t.objectStore("entries").delete(entry.id);
    (entry.photos || []).forEach(id => t.objectStore("photos").delete(id));
    return finish(t);
  },
  // 写真 → { id, type, buf }
  async photo(id) {
    const db = await open();
    return done(db.transaction("photos").objectStore("photos").get(id));
  },
};
