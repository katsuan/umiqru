# 🌊 うみくる 〜UmiQru〜

同じ場所の海の予報を、出どころごとに並べてくらべるツール。釣りや海あそびの前の下しらべ用。名前は「うみくる」（海のようすが先に来る）。英字は UmiQru（「く」を Q にする。そらくる＝SoraQru と同じ作り方）。キャッチコピーは「海のごきげん、くらべて先どり」。GitHub Pages でそのまま動く静的サイトで、サーバーは使わない。

公開URL: https://katsuan.github.io/umiqru/ （2026-11-06 公開。くらぶ〜Qlove〜の一覧（👾 きたく部、そらくるの次）に載せた。ポートフォリオにはまだ）

## できること

- 場所：港の名前・地名・緯度経度（`(20.43, 136.08)` のようなかっこ付きも。日本の外も）・今いる場所。`?q=城ヶ島` / `?q=20.4253,136.0814` のリンクで、その場所で開く
- 近い潮の港（30km 以内）と気象庁の地域は自動で選ぶ（国土地理院の市区町村コード → 気象庁の区分。海の上なら港とそのまわりで探す）
- 日本の出どころを先に：気象庁の天気・波・風の文（3日先まで）、6時間ごとの降水確率、警報・注意報（波浪・強風・濃霧など）、潮汐表（tide736.net）
- 緯度経度で読む予報（Open-Meteo）：波4つ（欧州・米国・フランス・米国の細かい計算）、風4つ（気象庁 MSM・GSM・欧州・米国）、1時間ごとの天気・気温・降水確率・雨、水温、海面の高さ
- グラフは時刻を触ると全部そろって動く。夜（日の入り〜日の出）はうすい灰色。波・風・天気は1時間ごとの横スクロールの表も
- 風の向きは「16方位」と「角度」を切りかえられる（この端末に覚える）
- 朝まづめ・夕まづめ（めやす）：薄明のはじまり〜日の出の1時間後、日の入りの1時間前〜薄明のおわり
- iPhone のウィジェット：ページの「iPhone のウィジェットにする」から、Scriptable に入れるスクリプト（`SQriptableSea.js`）をコピーして、手順どおりに置く

## ファイル

| 名前 | 役わり |
|---|---|
| `index.html` | 画面 |
| `app.js` | 画面の入口（場所・日・時刻の切りかえと描き直し、iPhone のウィジェットの手順） |
| `style.css` | 見た目（Q キットの `ui.css` のあとに読む） |
| `js/names.js` | 画面に出す名前（うみくる・出どころの名前）。名前はここにだけ書く |
| `js/sources.js` | 出どころ（予報のモデル・線の色・警報の種類）と読む日数 |
| `js/place.js` | 場所さがしと、近い港・気象庁の地域 |
| `js/forecast.js` | 予報を読む（届いたものから順に描く） |
| `js/jma.js` | 気象庁の文・降水確率・警報と注意報 |
| `js/chart.js` | グラフと、横にスクロールする1時間ごとの表 |
| `js/format.js`・`js/time.js`・`js/net.js`・`js/store.js`・`js/state.js` | 数の見た目・日付・読みこみ・端末に残すもの・いま見ている場所と時刻 |
| `data/ports.json` | tide736.net の港の一覧（位置つき） |
| `SQriptableSea.js` | iPhone の Scriptable に入れる海のウィジェット。q-sqriptable の `tools/build-sea.mjs` で SQriptable.js から作る（直接直さない） |
| `sea-version.json` | `SQriptableSea.js` の版の番号と日付（`tools/build-sea.mjs` が書く）。ウィジェットが12時間に1回読み、新しければ iPhone の通知で知らせる（押すと `#howto` で入れ方の欄が開く） |
| `sw.js`・`manifest.webmanifest` | 電波がないときに開く仕組み（Q キットの sw-core.js）と、ホーム画面に置くときの設定 |
| `tools/icon.py` | アイコン・ロゴ・OGP を作る（となりの q-oqrn の brandkit を使う） |

名前を変えるときに探す所：`js/names.js`・`index.html` の `<title>`・見出し・OGP・`manifest.webmanifest`・この README。

## SQriptable とそろえるもの

場所から港・気象庁の地域を選ぶやり方、予報の種類、まづめの決め方は、SQriptable の sea カードと同じ（q-sqriptable の `docs/sea.md`）。片方を変えたらもう片方も。

## 公開のしかた

- いまは main を `.github/workflows/pages.yml` で GitHub Pages に出している（ためしの間）。出すときに Q キットの `qpublish.py` で CSS・JS に `?v=` を付ける（リポジトリの中には付けない）
- Q 共通の公開（katsuan/oqrn の `q-pages.yml`。テストは非公開の q-dev）に切りかえるときは、このリポジトリの secret に `Q_DEV_KEY` を登録してから `.github/workflows/pages.yml` を足す
- ページの下の「なかまのツール」の行は Q キットの `tool-share.js`（中身は q-oqrn の `data/hub-links.json` の umiqru）

## 出どころと使い方

- Open-Meteo（CC BY 4.0）：無料版は商用でない使い方だけ。呼ぶのは使う人のブラウザから直接
- 気象庁（防災情報の JSON）・tide736.net（潮汐表。海上保安庁の調和定数で計算。航海には使えない）・国土地理院（逆ジオコーダー）
- 予報は計算のめやす。海に出るかどうかは、気象庁の警報・注意報と現地のようすで決める
