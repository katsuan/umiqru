#!/usr/bin/env python3
"""うみくる（UmiQru）のアイコン・ロゴ・OGP を作る。

名前は「うみくる」（海＋くる。海のようすが先に来る）。英字は UmiQru（「く」を Q にする。そらくる＝SoraQru と同じ作り方）。
アイコンはおくるんと同じ角の丸い四角に、浅い海の青緑から深い青へのグラデーション。
Q は白い輪、右下へのびるしっぽは、うねる波の線。

  icon.svg・icon-32.png・apple-touch-icon.png・icon-512.png・icon-maskable-512.png … アイコン
  logo.svg … 横長のロゴ「UmiQru」（Q はアイコンと同じ形）
  ogp.png  … 共有したときの画像（1200×630）

使い方: python3 tools/icon.py（となりのおくるん（q-oqrn）の tools/brandkit.py を使う）
"""
import math
from pathlib import Path

import brandkit_path  # noqa: F401
from brandkit import Brand, centered, polar

ROOT = Path(__file__).resolve().parent.parent
BRAND = Brand(light=(110, 214, 214), dark=(14, 110, 158))  # style.css の線の色（波の欧州 #2A78D6）と重ならない青緑

C = (44, 44)
R, RING_W = 23, 12.5
TAIL = polar(C, 45, 30)


def wave(x0, x1, y, amp, waves, w, fill):
    """うねる波の線（x0 から x1 まで、waves 回うねる）"""
    pts = [(x0 + (x1 - x0) * i / 40, y + amp * math.sin(i / 40 * waves * 2 * math.pi)) for i in range(41)]
    return {"t": "line", "p": pts, "w": w, "fill": fill}


SHAPES = [
    {"t": "ring", "c": C, "r": R, "w": RING_W, "fill": (255, 255, 255)},
    # しっぽ：輪にかかる波。まわりを背景の色で少し削って、輪と見分ける
    wave(TAIL[0] - 6, TAIL[0] + 26, TAIL[1] + 6, 3.6, 1.5, 12, "bg"),
    wave(TAIL[0] - 4, TAIL[0] + 24, TAIL[1] + 6, 3.6, 1.5, 7, (255, 255, 255)),
]
SHAPES, (_DX, _DY) = centered(SHAPES)
C = (C[0] + _DX, C[1] + _DY)
RING_OUTER = R + RING_W / 2


def decorate(d, s):
    """OGP の背景：うっすら波"""
    for y, a in ((520, 60), (570, 40)):
        pts = [((i * 30) * s, (y + 14 * math.sin(i / 3)) * s) for i in range(42)]
        d.line(pts, fill=(255, 255, 255, a), width=int(6 * s))


# アイコン・ロゴ・OGP の画像をまとめて作る（python3 tools/icon.py で動かす）
def main():
    BRAND.write_icons(ROOT, SHAPES)
    logo, ratio = BRAND.logo_svg("UmiQru", SHAPES, C, RING_OUTER, "UmiQru（うみくる）")
    (ROOT / "logo.svg").write_text(logo, encoding="utf-8")
    BRAND.write_ogp(
        ROOT / "ogp.png", SHAPES, "うみくる", "UmiQru",
        ["同じ場所の波・風・潮・天気を", "気象庁と世界の予報でくらべる"], decorate,
        copy="海のごきげん、くらべて先どり",
    )
    print(f"アイコン・logo.svg（高さ 28px なら幅 {28 * ratio:.0f}px）・ogp.png を書き出しました")


if __name__ == "__main__":
    main()
