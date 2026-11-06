// うみくる：この端末に残すもの（localStorage）の読み書き。読めない・書けないときも止まらない
// 読まれるところ：app.js と js/ の部品

export const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
