// 電波がなくても、一度開いたページは開けるようにする（中身は Q キットの oqrn/shared/sw-core.js）。
// 予報（Open-Meteo・気象庁・tide736.net）はここでは扱わない
// 読まれるところ：app.js の init で登録する
self.Q_TOOL = "umiqru"; // Q キットの sw-core.js が読む名前
importScripts("/oqrn/shared/sw-core.js");
