// うみくる：おくるんのお知らせカード（見ている海のめやす・海の日記）と、ページを開くリンク。カードの決まりはここ1か所
// 読まれるところ：app.js と js/diary.js
import { NAMES } from "./names.js";

// おくるんのカードの色（なかまのツールの一覧 q-oqrn の data/hub-links.json の umiqru と同じ）
export const CARD_COLOR = "#0E6E9E";
// おくるんの部品（oqrn.js）を読めたか
export const canCard = () => !!window.OQRN;
// その場所を開くうみくるのリンク（q はウィジェットの Parameter と同じ書き方）
export const pageUrl = q => `${location.origin}${location.pathname}?q=${encodeURIComponent(q)}`;

// カードを開く URL。ボタンは、受けとった人がその場所のうみくるを開くリンク
export function oqrnCardUrl({ header, date, title, detail, actionUrl }) {
  return window.OQRN.cardUrl(new URLSearchParams({
    headerTitle: header,
    date,
    title,
    detail,
    showDate: "true",
    theme: "custom",
    customColor: CARD_COLOR,
    bubbleSize: "mega",
    showAction: "true",
    actionLabel: `🌊 ${NAMES.app}で見る`,
    actionUrl,
    from: "umiqru", // おくるんで、うみくるから来たと数える（送ったあとに「うみくるに戻る」）
  }));
}
