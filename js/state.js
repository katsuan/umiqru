// うみくる：いま見ている場所・日・時刻と、時刻を変えたときに描き直す仕組み
// 読まれるところ：app.js と js/ の部品

import { store } from "./store.js";

// いま見ている場所・日・時刻。render … 描き直す関数（app.js が入れる）
export const state = { place: null, ctx: null, data: null, day: 0, hour: 0, windDir: store.get("umiqru:winddir") === "deg" ? "deg" : "16", tideCache: {}, render: () => {} };

// 見る時刻を変えて、描き直す
export function setHour(h) {
  if (h === state.hour) return;
  state.hour = h;
  state.render();
}
