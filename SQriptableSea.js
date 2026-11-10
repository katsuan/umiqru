// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: water;

// ======================================
// うみくる（UmiQru）のウィジェット
// ウィジェットの Parameter に場所を書くと、その場所の波・風・潮・天気が出ます（例：城ヶ島 / 20.4253,136.0814）。
// 新しい版が出ると通知で知らせます。入れかえ方は https://katsuan.github.io/umiqru/#howto
// ======================================

const SEA_BUILD = "99e3117a2c";

const PALETTE = {
  brand: "#6C47FF",
  warn: "#E5534B",
  saturday: "#3D7BE0",
  moonLit: "#F6E7A8",
  moonDark: "#3A3550",
};

const FADE = 0.45;

const FAMILIES = {
  small: { name: "小", maxLines: 3, perLine: 2, present: "presentSmall" },
  medium: { name: "中", maxLines: 3, perLine: 4, present: "presentMedium" },
  large: { name: "大", maxLines: 7, perLine: 4, present: "presentLarge" },
  extraLarge: { name: "特大", maxLines: 7, perLine: 8, present: "presentExtraLarge" },
  accessoryRectangular: { name: "ロック画面（長方形）", maxCards: 3, present: "presentAccessoryRectangular" },
  accessoryInline: { name: "ロック画面（1行）", maxCards: 2, present: "presentAccessoryInline" },
  accessoryCircular: { name: "ロック画面（丸）", maxCards: 1, present: "presentAccessoryCircular" },
};

const THEMES = {
  light: { bg: "#F4F2FB", tile: "#FFFFFF", text: "#1B1730", sub: "#6B6585", track: "#E6E2F3" },
  dark: { bg: "#121018", tile: "#1F1C29", text: "#F4F2FA", sub: "#A49EB9", track: "#2E2A3B" },
  purple: { bg: "#2A1A6E", tile: "#3B2A8C", text: "#FFFFFF", sub: "#CFC4FF", track: "#5240A8" },
};

function makeTheme(opts, alpha = 1) {
  const name = String(opts.theme || "").toLowerCase();
  const mode = THEMES[name] ? name : "auto";
  const tile = String(opts.tile || "").toLowerCase();
  const tiles = /^(1|on|yes|true)$/.test(tile) ? true : tile === "auto" ? "auto" : false;
  const theme = { mode, alpha, tiles };
  for (const key of Object.keys(THEMES.light)) {
    const a = key === "bg" || key === "tile" ? 1 : alpha;
    theme[key] = mode === "auto"
      ? Color.dynamic(new Color(THEMES.light[key], a), new Color(THEMES.dark[key], a))
      : new Color(THEMES[mode][key], a);
  }
  const accent = /^#?[0-9a-f]{6}$/i.test(opts.accent || "") ? "#" + opts.accent.replace("#", "") : PALETTE.brand;
  theme.accent = ink(accent, theme);
  theme.warn = ink(PALETTE.warn, theme);
  return theme;
}

function accessoryTheme(alpha = 1) {
  const white = (a) => new Color("#FFFFFF", a * alpha);
  return { mode: "accessory", alpha, text: white(1), sub: white(0.7), track: white(0.25), accent: white(1), warn: white(1), tiles: false };
}

function hexToRgb(hex) {
  const n = parseInt(String(hex).replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
  return "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function readable(hex, mode) {
  const [toward, ok] = {
    light: [0, (l) => l <= 0.3],
    dark: [255, (l) => l >= 0.15],
    purple: [255, (l) => l >= 0.28],
  }[mode];
  const base = hexToRgb(hex);
  let rgb = base;
  for (let t = 0.1; !ok(luminance(rgb)) && t <= 1; t += 0.1) {
    rgb = base.map((v) => v + (toward - v) * t);
  }
  return rgbToHex(rgb);
}

function ink(hex, theme) {
  if (theme.mode === "accessory") return theme.accent;
  const color = (mode) => new Color(readable(hex, mode), theme.alpha);
  if (theme.mode === "auto") return Color.dynamic(color("light"), color("dark"));
  return color(theme.mode);
}

function onColorTheme(opts, alpha) {
  return {
    ...makeTheme({ ...opts, theme: "dark" }, alpha),
    text: new Color("#FFFFFF", alpha),
    sub: new Color("#FFFFFF", 0.82 * alpha),
    track: new Color("#FFFFFF", 0.28),
    accent: new Color("#FFFFFF", alpha),
  };
}

class SetupError extends Error {}

async function loadItems(items, ctx) {
  const seen = {};
  await Promise.all(items.map(async (item) => {
    seen[item.type] = (seen[item.type] || 0) + 1;
    item.index = seen[item.type];
    if (item.hint) return;
    const card = CARDS[item.type];
    if (!card) {
      item.hint = `「${item.type}」というカードはありません`;
      return;
    }
    const lastKey = `last_${item.type}_${hash(item.arg)}_${item.index}`;
    try {
      item.data = card.load ? await card.load(item.arg, ctx, item) : {};
      if (card.keep && !item.stale) writeCache(lastKey, card.keep(item.data));
    } catch (e) {
      if (e instanceof SetupError) {
        item.hint = e.message;
        if (e.perm) item.perm = e.perm;
        return;
      }
      const last = card.keep && readCache(lastKey);
      if (last) {
        item.data = card.revive ? card.revive(last) : last;
        item.stale = true;
      }
    }
  }));
}

function nextRefresh(items, ctx) {
  let at = new Date(ctx.now.getTime() + 30 * 60000);
  for (const item of items) {
    const card = CARDS[item.type];
    const want = card && card.refreshAt && item.data ? card.refreshAt(item.data, ctx) : null;
    if (want && want < at) at = want;
  }
  return at;
}

function itemUrl(item, ctx) {
  const card = CARDS[item.type];
  return (card && card.url && card.url(item.data, ctx)) || null;
}

function itemLabel(item) {
  const card = CARDS[item.type];
  return card ? `${card.icon} ${card.label}` : item.type;
}

const IPHONE_WIDGET_SIZES = [
  [430, 932, 170, 364, 382, 76, 172, 76],
  [428, 926, 170, 364, 382, 76, 172, 76],
  [414, 896, 169, 360, 379, 76, 160, 72],
  [414, 736, 159, 348, 357, 76, 170, 76],
  [393, 852, 158, 338, 354, 72, 160, 72],
  [390, 844, 158, 338, 354, 72, 160, 72],
  [375, 812, 155, 329, 345, 72, 157, 72],
  [360, 780, 155, 329, 345, 72, 157, 72],
  [375, 667, 148, 321, 324, 68, 153, 68],
  [320, 568, 141, 292, 311, 68, 153, 68],
];

const IPAD_WIDGET_SIZES = [
  [1192, 1590, 188, 412, 860],
  [1024, 1366, 170, 378, 795],
  [970, 1389, 162, 350, 726],
  [954, 1373, 162, 350, 726],
  [834, 1194, 155, 342, 715],
  [820, 1180, 155, 342, 715],
  [834, 1112, 150, 327, 682],
  [810, 1080, 146, 320, 669],
  [768, 1024, 141, 305, 634],
  [744, 1133, 141, 305, 634],
];

function pickWidgetSizeRow(screen, pad) {
  const w = Math.min(screen.width, screen.height);
  const h = Math.max(screen.width, screen.height);
  const table = pad ? IPAD_WIDGET_SIZES : IPHONE_WIDGET_SIZES;
  const exact = table.find((row) => row[0] === w && row[1] === h);
  if (exact) return exact;
  const fits = table.filter((row) => row[0] <= w && row[1] <= h).sort((a, b) => b[2] - a[2])[0];
  if (fits) return fits;
  const least = table.slice().sort((a, b) => a[2] - b[2])[0];
  const k = Math.min(w / least[0], h / least[1]);
  return least.map((v, i) => (i < 2 ? v : Math.floor(v * k)));
}

function widgetSizeFor(family, screen, pad) {
  const row = pickWidgetSizeRow(screen, pad);
  if (pad) {
    const [, , s, m, xl] = row;
    return {
      small: { w: s, h: s },
      medium: { w: m, h: s },
      large: { w: m, h: m },
      extraLarge: { w: xl, h: m },
      accessoryCircular: { w: 68, h: 68 },
      accessoryRectangular: { w: 153, h: 68 },
    }[family] || { w: m, h: s };
  }
  const [, , s, m, l, circle, rectW, rectH] = row;
  return {
    small: { w: s, h: s },
    medium: { w: m, h: s },
    large: { w: m, h: l },
    extraLarge: { w: m * 2 + 20, h: l },
    accessoryCircular: { w: circle, h: circle },
    accessoryRectangular: { w: rectW, h: rectH },
  }[family] || { w: m, h: s };
}

function widgetSize(family) {
  return widgetSizeFor(family, Device.screenSize(), Device.isPad());
}

function buildTiles(widget, lines, ctx) {
  const { theme } = ctx;
  const size = widgetSize(ctx.family);
  const single = lines.length === 1 && lines[0].length === 1;
  const tiles = theme.tiles === "auto" ? !single : theme.tiles;
  const pad = single && !tiles ? 14 : 10;
  const gap = tiles ? 8 : 10;
  widget.backgroundColor = theme.bg;
  widget.setPadding(pad, pad, pad, pad);

  const innerW = size.w - pad * 2;
  const rowH = (size.h - pad * 2 - gap * (lines.length - 1)) / lines.length;
  lines.forEach((line, li) => {
    if (li > 0) widget.addSpacer(gap);
    const row = widget.addStack();
    row.layoutHorizontally();
    row.size = new Size(innerW, rowH);
    const tileW = (innerW - gap * (line.length - 1)) / line.length;
    line.forEach((item, i) => {
      if (i > 0) row.addSpacer(gap);
      const box = row.addStack();
      box.size = new Size(tileW, rowH);
      box.layoutVertically();
      const paint = cardBackground(item, ctx);
      const whole = single && !tiles;
      const photo = cardPhoto(item, ctx, whole ? size.w : tileW, whole ? size.h : rowH);
      if (tiles) {
        const tint = cardTint(item, ctx);
        box.backgroundColor = tint ? tintedTile(tint, theme) : theme.tile;
        box.cornerRadius = 14;
      }
      let tp = tiles ? (rowH < 50 ? 6 : 10) : single ? 0 : 2;
      if (paint) {
        if (single && !tiles) {
          widget.backgroundColor = new Color(paint[paint.length - 1]);
          widget.backgroundGradient = gradient(paint);
        }
        else {
          box.backgroundGradient = gradient(paint);
          box.cornerRadius = 14;
          tp = Math.max(tp, rowH < 50 ? 6 : 10);
        }
      }
      if (photo) {
        if (whole) widget.backgroundImage = photo;
        else {
          box.backgroundImage = photo;
          box.cornerRadius = 14;
          tp = Math.max(tp, rowH < 50 ? 6 : 10);
        }
      }
      box.setPadding(tp, tp, tp, tp);
      const area = { w: tileW - tp * 2, h: rowH - tp * 2 };
      const colors = paint || photo ? ctx.onDark : {};
      renderItem(box, item, { ...ctx, ...colors, ...area, pad: tp, tier: tierOf(area), single });
    });
  });
}

function tierOf(area) {
  if (area.h < 66) return "s";
  if (area.h >= 120 && area.w >= 130) return "l";
  return "m";
}

function renderItem(box, item, ctx) {
  const url = itemUrl(item, ctx);
  if (url && !ctx.noLinks) box.url = url;
  if (item.hint) {
    renderHint(box, item, ctx);
    return;
  }
  if (item.data) {
    try {
      const c = item.stale ? { ...ctx, theme: ctx.faded } : ctx;
      if (isTiny(ctx) && renderTiny(box, item, c)) return;
      CARDS[item.type].render(box, item.data, c);
      return;
    } catch (e) {
    }
  }
  renderBlank(box, item, { ...ctx, theme: ctx.faded });
}

function isTiny(ctx) {
  return !ctx.accessory && ctx.w < 72;
}

function renderTiny(box, item, ctx) {
  const card = CARDS[item.type];
  const { theme, w, h } = ctx;
  if (!card.badge) {
    if (!card.inline) return false;
    fixedTxt(box, w, card.icon || "•", Math.min(22, h * 0.32), theme.text, "regular");
    if (card.label) fixedTxt(box, w, card.label, 10, theme.sub, "semibold");
    return true;
  }
  const b = card.badge(item.data, ctx) || {};
  if (b.image) {
    const side = Math.floor(Math.min(w, h * 0.54));
    const row = centerRow(box, w);
    const view = row.addImage(b.image);
    view.imageSize = new Size(side, side);
  } else if (b.top) {
    const word = /[\p{L}\p{N}]/u.test(b.top) && !/\p{Extended_Pictographic}/u.test(b.top);
    fixedTxt(box, w, b.top, word ? 10 : Math.min(22, h * 0.3), word ? theme.sub : theme.text, "semibold");
  }
  box.addSpacer(2);
  const main = String(b.main == null ? "—" : b.main);
  const units = [...main].reduce((n, ch) => n + (/[ -~]/.test(ch) ? 0.6 : 1), 0) || 1;
  const size = Math.max(10, Math.min(26, h * 0.36, (w / units) * 0.95));
  fixedTxt(box, w, main, size, theme.text, "heavy");
  return true;
}

function renderBlank(box, item, ctx) {
  const { theme } = ctx;
  if (isTiny(ctx)) {
    const card = CARDS[item.type];
    fixedTxt(box, ctx.w, (card && card.icon) || "•", Math.min(20, ctx.h * 0.3), theme.text, "regular");
    fixedTxt(box, ctx.w, "—", Math.min(22, ctx.h * 0.32), theme.text, "round");
    return;
  }
  if (ctx.tier === "s") {
    const row = hrow(box, 6);
    txt(row, itemLabel(item), 12, theme.text, "semibold");
    row.addSpacer();
    txt(row, "—", 14, theme.text, "round");
    return;
  }
  txt(box, itemLabel(item), 11, theme.sub, "semibold");
  box.addSpacer();
  txt(box, "—", Math.min(30, ctx.h * 0.3), theme.text, "round");
  box.addSpacer();
}

function renderHint(box, item, ctx) {
  const { theme } = ctx;
  if (item.perm) {
    const p = PERMS[item.perm] || { label: item.perm };
    if (isTiny(ctx)) {
      fixedTxt(box, ctx.w, "🔐", 16, theme.text, "regular");
      fixedTxt(box, ctx.w, p.label, 10, theme.sub, "semibold");
      return;
    }
    txt(box, `🔐 ${p.label}`, 11, theme.sub, "semibold");
    txt(box, "許可がないので出せません。アプリの「許可の確認」から", 10, theme.text, "regular", { lines: ctx.tier === "s" ? 2 : 3, scale: 0.7 });
    return;
  }
  if (isTiny(ctx)) {
    fixedTxt(box, ctx.w, "✏️", 16, theme.text, "regular");
    fixedTxt(box, ctx.w, item.type, 10, theme.sub, "semibold");
    return;
  }
  if (ctx.tier !== "s") txt(box, `✏️ ${item.type}`, 11, theme.sub, "semibold");
  const lines = Math.max(1, Math.min(4, Math.floor((ctx.h - (ctx.tier !== "s" ? 14 : 0)) / 12)));
  txt(box, item.hint, 10, theme.text, "regular", { lines, scale: 0.7 });
}

function isAccessory(family) {
  return String(family).startsWith("accessory");
}

const SF_FOR_EMOJI = {
  "☀️": "sun.max.fill", "🌤️": "cloud.sun.fill", "⛅": "cloud.sun.fill", "☁️": "cloud.fill",
  "🌦️": "cloud.sun.rain.fill", "🌧️": "cloud.rain.fill", "⛈️": "cloud.bolt.rain.fill", "🌨️": "cloud.snow.fill", "❄️": "snowflake", "🌫️": "cloud.fog.fill", "🌙": "moon.stars.fill", "🌊": "water.waves", "💨": "wind",
};

const LINE_ICONS = {
  "☀️": "sun.max", "🌤️": "cloud.sun", "⛅": "cloud.sun", "☁️": "cloud",
  "🌦️": "cloud.sun.rain", "🌧️": "cloud.rain", "⛈️": "cloud.bolt.rain", "🌨️": "cloud.snow", "❄️": "snowflake", "🌫️": "cloud.fog", "🌙": "moon.stars", "🌡️": "thermometer.medium",
  "☔": "drop", "🔐": "lock", "✏️": "pencil", "⚠️": "exclamationmark.triangle", "🌊": "water.waves", "💨": "wind",
  };

let symbolStyle = "line";

function symbolFor(emoji, size) {
  const key = String(emoji || "").trim();
  const name = symbolStyle === "fill" ? SF_FOR_EMOJI[key] || LINE_ICONS[key] : LINE_ICONS[key];
  if (!name || typeof SFSymbol === "undefined") return null;
  try {
    const sym = SFSymbol.named(name);
    if (!sym) return null;
    sym.applyFont(symbolStyle === "fill" ? Font.semiboldSystemFont(size) : Font.systemFont(size));
    return sym.image;
  } catch (e) {
    return null;
  }
}

function symbolBox(img, size) {
  const s = (img && img.size) || {};
  const ratio = s.width > 0 && s.height > 0 ? s.width / s.height : 1;
  return new Size(Math.round(size * ratio * 10) / 10, size);
}

const ICON_KEYS = Object.keys(LINE_ICONS).sort((a, b) => b.length - a.length);

const ICON_SPLIT = new RegExp(`(${ICON_KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "u");

function iconTxt(stack, text, size, color, weight, opt) {
  const parts = text.split(ICON_SPLIT).filter((p) => p !== "");
  const multi = (opt.lines || 1) > 1;
  const images = parts.map((p, i) => (LINE_ICONS[p] && (!multi || i === 0) ? symbolFor(p, size * 0.9) : null));
  if (!images.some(Boolean)) return null;
  const row = stack.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  let main = null;
  let mainLen = -1;
  parts.forEach((p, i) => {
    if (images[i]) {
      const view = row.addImage(images[i]);
      view.imageSize = symbolBox(images[i], size);
      view.tintColor = color;
      const next = parts[i + 1];
      if (next && !/^\s/.test(next)) parts[i + 1] = "\u2009" + next;
      return;
    }
    const t = plainTxt(row, p, size, color, weight, opt);
    if (p.trim().length > mainLen) [main, mainLen] = [t, p.trim().length];
  });
  return main || { centerAlignText() {}, rightAlignText() {}, leftAlignText() {} };
}

function splitLeadEmoji(text) {
  const t = String(text || "");
  const hit = Object.keys(SF_FOR_EMOJI).sort((a, b) => b.length - a.length).find((e) => t.startsWith(e));
  return hit ? { emoji: hit, rest: t.slice(hit.length).trim() } : { emoji: "", rest: t };
}

function buildAccessory(widget, items, ctx) {
  symbolStyle = "fill";
  const shown = items.filter((item) => CARDS[item.type] && !item.hint);
  if (!shown.length) accessoryNothing(widget, items, ctx);
  else if (ctx.family === "accessoryInline") accessoryInline(widget, shown, ctx);
  else if (ctx.family === "accessoryCircular") accessoryCircular(widget, shown, ctx);
  else accessoryRectangular(widget, shown, ctx);
}

function accessoryNothing(widget, items, ctx) {
  const perm = items.find((item) => item.perm);
  const p = perm && (PERMS[perm.perm] || { label: perm.perm });
  const round = ctx.family === "accessoryCircular";
  const line = p ? (round ? "🔐\n許可なし" : `🔐 ${p.label}の許可がいります`)
    : items.some((item) => item.hint) ? (round ? "✏️\n書き方" : "✏️ Parameter を見直してね") : "SQriptable —";
  const t = widget.addText(line);
  t.font = Font.semiboldSystemFont(round ? 11 : 13);
  t.minimumScaleFactor = 0.6;
  if (round) t.centerAlignText();
}

function accessoryInline(widget, shown, ctx) {
  const full = shown.map((item) => cardInline(item, ctx)).join("  ");
  let line = full;
  while (textWidth(line, 13) > 215 && [...line].length > 2) line = [...line].slice(0, -2).join("") + "…";
  const lead = splitLeadEmoji(line);
  const sym = lead.emoji && symbolFor(lead.emoji, 12);
  if (sym) {
    const stack = widget.addStack();
    stack.centerAlignContent();
    stack.spacing = 4;
    const view = stack.addImage(sym);
    view.imageSize = new Size(14, 14);
    stack.addText(lead.rest);
  } else {
    widget.addText(line);
  }
}

function accessoryCircular(widget, shown, ctx) {
  const item = shown[0];
  const card = CARDS[item.type];
  const badge = !item.data ? { top: card.icon, main: "—" }
    : card.badge ? card.badge(item.data, ctx) : { top: card.icon, main: (card.label || "").length <= 3 ? card.label || "" : "" };
  const theme = accessoryTheme(item.data && !item.stale ? 1 : FADE);
  widget.addAccessoryWidgetBackground = true;
  const middle = centerInWidget(widget);
  if (badge.image) {
    const SIZE = Math.min(50, widgetSize("accessoryCircular").w - 20);
    widget.setPadding(0, 0, 0, 0);
    const dc = canvas(SIZE, SIZE);
    dc.drawImageInRect(badge.image, new Rect(2, 2, SIZE - 4, SIZE - 4));
    const view = middle.addImage(dc.getImage());
    view.imageSize = new Size(SIZE, SIZE);
    if (theme.alpha < 1) view.imageOpacity = theme.alpha;
    return;
  }
  const stack = middle;
  stack.layoutVertically();
  const lineW = widgetSize("accessoryCircular").w - 20;
  const sym = badge.top && symbolFor(badge.top, 13);
  if (sym) {
    const row = stack.addStack();
    row.addSpacer();
    const view = row.addImage(sym);
    view.imageSize = new Size(15, 15);
    view.tintColor = theme.text;
    row.addSpacer();
  } else if (badge.top) txt(centerRow(stack, lineW), badge.top, 11, theme.text, "regular", { center: true });
  txt(centerRow(stack, lineW), badge.main, 16, theme.text, "round", { center: true, scale: 0.5 });
}

function accessoryRectangular(widget, shown, ctx) {
  const rows = shown;
  const rect = widgetSize("accessoryRectangular");
  const w = rect.w - 4;
  const h = (rect.h - 6) / rows.length;
  const sub = { ...ctx, theme: accessoryTheme(), faded: accessoryTheme(FADE), w, h, tier: rows.length === 1 ? "m" : "s", accessory: true };
  rows.forEach((item) => {
    const box = widget.addStack();
    box.layoutVertically();
    box.size = new Size(w, h);
    renderItem(box, item, sub);
  });
}

function centerInWidget(widget) {
  widget.addSpacer();
  const row = widget.addStack();
  row.layoutHorizontally();
  row.addSpacer();
  const inner = row.addStack();
  row.addSpacer();
  widget.addSpacer();
  return inner;
}

function cardInline(item, ctx) {
  const card = CARDS[item.type];
  if (!item.data) return `${card.icon}—`;
  return card.inline ? card.inline(item.data, ctx) : card.label;
}

const FONTS = {
  regular: (n) => Font.systemFont(n),
  medium: (n) => Font.mediumSystemFont(n),
  semibold: (n) => Font.semiboldSystemFont(n),
  bold: (n) => Font.boldSystemFont(n),
  heavy: (n) => Font.heavySystemFont(n),
  round: (n) => Font.boldRoundedSystemFont(n),
  mono: (n) => Font.mediumMonospacedSystemFont(n),
};

function txt(stack, value, size, color, weight = "regular", opt = {}) {
  const text = String(value);
  if (!opt.raw && ICON_SPLIT.test(text)) {
    const t = iconTxt(stack, text, size, color, weight, opt);
    if (t) return t;
  }
  return plainTxt(stack, text, size, color, weight, opt);
}

function plainTxt(stack, value, size, color, weight = "regular", opt = {}) {
  const t = stack.addText(String(value));
  t.font = (FONTS[weight] || FONTS.regular)(size);
  t.textColor = color;
  t.lineLimit = opt.lines || 1;
  t.minimumScaleFactor = opt.scale || 0.6;
  if (opt.center) t.centerAlignText();
  return t;
}

function hrow(stack, spacing = 4) {
  const row = stack.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.spacing = spacing;
  return row;
}

function isBig(ctx) {
  return ctx.tier === "l" && ctx.h >= 200;
}

function centerLine(box, w) {
  const line = box.addStack();
  line.layoutHorizontally();
  line.centerAlignContent();
  line.size = new Size(Math.max(1, w), 0);
  return line;
}

function centerRow(box, w, spacing = 0) {
  const row = centerLine(box, w).addStack();
  row.centerAlignContent();
  row.spacing = spacing;
  return row;
}

function fixedTxt(stack, w, value, size, color, weight, opt = {}) {
  const t = txt(centerLine(stack, w), value, size, color, weight, { scale: 0.5, ...opt });
  t.centerAlignText();
  return t;
}

function canvas(w, h) {
  const dc = new DrawContext();
  dc.size = new Size(Math.max(4, Math.round(w)), Math.max(2, Math.round(h)));
  dc.opaque = false;
  dc.respectScreenScale = true;
  return dc;
}

function textWidth(text, size) {
  return [...String(text)].reduce((n, ch) => n + (ch.charCodeAt(0) < 0x2000 ? 0.55 : 1), 0) * size;
}

function hash(text) {
  const key = String(text);
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymd(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

const fm = FileManager.local();

const CACHE_DIR = fm.joinPath(fm.documentsDirectory(), "sqriptable");

if (!fm.fileExists(CACHE_DIR)) fm.createDirectory(CACHE_DIR, true);

function cachePath(key) {
  return fm.joinPath(CACHE_DIR, key.replace(/[^a-z0-9_.-]/gi, "_"));
}

function readCache(key, maxAgeMin = null) {
  const path = cachePath(key);
  if (!fm.fileExists(path)) return null;
  const age = (Date.now() - fm.modificationDate(path).getTime()) / 60000;
  if (maxAgeMin != null && age > maxAgeMin) return null;
  try {
    return JSON.parse(fm.readString(path));
  } catch (e) {
    return null;
  }
}

function writeCache(key, value) {
  try {
    fm.writeString(cachePath(key), JSON.stringify(value));
  } catch (e) {
  }
}

const PERMS = {
  location: { label: "位置情報", used: "場所を書かないとき（今いる場所の海）", retryMin: 30 },
};

const PERM_RETRY_MIN = 6 * 60;

function permState(name) {
  return (readCache("perms") || {})[name] || null;
}

function notePerm(name, state) {
  const all = readCache("perms") || {};
  all[name] = { state, at: Date.now() };
  writeCache("perms", all);
}

async function withPerm(name, read) {
  const inApp = typeof config !== "undefined" && config.runsInApp && !config.runsInWidget;
  const last = permState(name);
  const retry = (PERMS[name] && PERMS[name].retryMin) || PERM_RETRY_MIN;
  const recent = last && Date.now() - last.at < retry * 60000;
  if (!inApp && recent && last.state !== "ok") throw new PermissionError(name);
  notePerm(name, "trying");
  try {
    const value = await read();
    notePerm(name, "ok");
    return value;
  } catch (e) {
    notePerm(name, "no");
    throw new PermissionError(name);
  }
}

class PermissionError extends SetupError {
  constructor(name) {
    const p = PERMS[name] || { label: name };
    super(`${p.label}を見る許可が要ります。Scriptable のアプリで「🔐 許可の確認」を開いてね`);
    this.perm = name;
  }
}

function request(url) {
  const req = new Request(url);
  req.timeoutInterval = 12;
  return req;
}

async function getJSON(url, key, maxAgeMin, item) {
  const fresh = readCache(key, maxAgeMin);
  if (fresh) return fresh;
  try {
    const json = await request(url).loadJSON();
    writeCache(key, json);
    return json;
  } catch (e) {
    const old = readCache(key);
    if (!old) throw e;
    if (item) item.stale = true;
    return old;
  }
}

const CARDS = {};

const ALIASES = {};

function defineCard(name, spec) {
  CARDS[name] = { name, ...spec };
  (spec.aliases || []).forEach((alias) => (ALIASES[alias.toLowerCase()] = name));
}

const WMO = {
  0: ["☀️", "快晴"], 1: ["🌤️", "晴れ"], 2: ["⛅", "晴れ時々くもり"], 3: ["☁️", "くもり"],
  45: ["🌫️", "霧"], 48: ["🌫️", "霧"],
  51: ["🌦️", "霧雨"], 53: ["🌦️", "霧雨"], 55: ["🌦️", "霧雨"], 56: ["🌧️", "冷たい霧雨"], 57: ["🌧️", "冷たい霧雨"],
  61: ["🌧️", "小雨"], 63: ["🌧️", "雨"], 65: ["🌧️", "大雨"], 66: ["🌧️", "冷たい雨"], 67: ["🌧️", "冷たい雨"],
  71: ["🌨️", "小雪"], 73: ["🌨️", "雪"], 75: ["❄️", "大雪"], 77: ["🌨️", "霧雪"],
  80: ["🌦️", "にわか雨"], 81: ["🌧️", "にわか雨"], 82: ["⛈️", "激しいにわか雨"],
  85: ["🌨️", "にわか雪"], 86: ["❄️", "にわか雪"],
  95: ["⛈️", "雷雨"], 96: ["⛈️", "雷雨とひょう"], 99: ["⛈️", "雷雨とひょう"],
};

function wmo(code, isDay = 1) {
  const [emoji, label] = WMO[code] || ["🌡️", "—"];
  return [!isDay && code <= 1 ? "🌙" : emoji, label];
}

async function resolvePlace(arg) {
  const text = String(arg || "").trim();
  const ll = text.match(/^(-?\d+(?:\.\d+)?)[,_](-?\d+(?:\.\d+)?)(?:=(.+))?$/);
  if (ll) return { lat: +ll[1], lon: +ll[2], name: ll[3] || "" };
  return text ? searchPlace(text) : currentPlace();
}

async function searchPlace(text) {
  const key = "place_" + encodeURIComponent(text);
  const cached = readCache(key);
  if (cached) return cached;
  for (const names of [[text, text + "市"], [text + "都", text + "区", text + "町"]]) {
    const found = [];
    for (const name of names) {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=ja&format=json`;
      found.push(...((await request(url).loadJSON()).results || []));
    }
    const japan = found.filter((r) => r.country_code === "JP");
    const list = japan.length ? japan : found;
    if (!list.length) continue;
    const best = list.sort((a, b) => (b.population || 0) - (a.population || 0))[0];
    const place = { lat: best.latitude, lon: best.longitude, name: text };
    writeCache(key, place);
    return place;
  }
  throw new SetupError(`「${text}」の場所が見つかりません`);
}

async function currentPlace() {
  try {
    const loc = await withPerm("location", () => {
      Location.setAccuracyToThreeKilometers();
      return Location.current();
    });
    let name = "";
    let city = "";
    let pref = "";
    try {
      const geo = await Location.reverseGeocode(loc.latitude, loc.longitude, "ja");
      const g = (geo && geo[0]) || {};
      name = g.locality || g.administrativeArea || "";
      city = g.locality || "";
      pref = g.administrativeArea || "";
    } catch (e) {
    }
    const place = { lat: loc.latitude, lon: loc.longitude, name, city, pref };
    writeCache("place_here", place);
    return place;
  } catch (e) {
    const last = readCache("place_here");
    if (last) return last;
    throw new SetupError("城ヶ島 のように場所を入れてね");
  }
}

async function muniCode(lat, lon) {
  try {
    const la = lat.toFixed(3);
    const lo = lon.toFixed(3);
    const json = await getJSON(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${la}&lon=${lo}`, `gsi_muni_${la}_${lo}.json`, 60 * 24 * 30);
    const code = String((json.results && json.results.muniCd) || "").padStart(5, "0");
    return /^\d{5}$/.test(code) && code !== "00000" ? { code, name: "" } : null;
  } catch (e) {
    return null;
  }
}

function hourAxis(box, axis, w, size, theme) {
  const row = box.addStack();
  row.layoutHorizontally();
  row.size = new Size(w, 0);
  const half = w / 8;
  let x = 0;
  axis.forEach((a) => {
    const at = a.pos * w;
    const left = Math.max(0, at - half);
    const right = Math.min(w, at + half);
    if (left > x) row.addSpacer(left - x);
    const cell = row.addStack();
    cell.layoutHorizontally();
    cell.centerAlignContent();
    cell.size = new Size(Math.max(1, right - left), 0);
    const room = Math.max(0, right - left - textWidth(a.text, size) * 1.2 - 4);
    if (a.pos >= 1 && room) cell.addSpacer(room);
    txt(cell, a.text, size, theme.sub, "medium", { scale: 0.7 });
    if (a.pos <= 0 && room) cell.addSpacer(room);
    x = right;
  });
}

function shortPlace(name) {
  const rest = String(name || "").replace(/^(北海道|東京都|京都府|大阪府|.{2,3}?県)/, "");
  return rest || String(name || "");
}

const SEA = {
  page: "https://katsuan.github.io/umiqru/",
  names: { page: "うみくる", jma: "気象庁", tide: "潮汐表" },
  portMaxKm: 30,
  palette: {
    ecmwf: ["#2A78D6", "#3987E5"],
    noaa: ["#EB6834", "#D95926"],
    mf: ["#1BAF7A", "#199E70"],
    jma: ["#6250D6", "#9085E9"],
    tide: ["#E87BA4", "#D55181"],
  },
  waves: [
    { key: "ecmwf_wam025", label: "WAM", color: "ecmwf" },
    { key: "ncep_gfswave025", label: "GFS", color: "noaa" },
    { key: "meteofrance_wave", label: "MFWAM", color: "mf" },
    { key: "ncep_gfswave016", label: "GFS細", color: "noaa", dash: true },
  ],
  winds: [
    { key: "jma_msm", label: "MSM", color: "jma" },
    { key: "jma_gsm", label: "GSM", color: "jma", dash: true },
    { key: "gfs_seamless", label: "GFS", color: "noaa" },
    { key: "ecmwf_ifs025", label: "IFS", color: "ecmwf" },
  ],
  tideRangeText: (cm) => `潮位差 ${(Math.round(cm / 10) / 10).toFixed(1)}m`,
  tideColor: "tide",
  warnNames: {
    "02": "暴風雪警報", "03": "大雨警報", "05": "暴風警報", "07": "波浪警報", "08": "高潮警報",
    "10": "大雨注意報", "14": "雷注意報", "15": "強風注意報", "16": "波浪注意報", "19": "高潮注意報", "20": "濃霧注意報",
    "32": "暴風雪特別警報", "33": "大雨特別警報", "35": "暴風特別警報", "37": "波浪特別警報", "38": "高潮特別警報",
  },
  focus: { hours: 6, windMs: 10, waveM: 2 },
  dirs: ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"],
};

const SEA_PORTS_RAW = "1,1,蘂取,45.5,148.617|1,2,紗万部,45.3333,148.017|1,3,内岡,45.2667,147.867|1,4,内保湾,44.7667,147.2|1,5,茂世路湾,45.4333,148.85|1,6,単冠湾,44.9333,147.633|1,7,入里節,44.7167,147.35|1,8,ニキシヨロ,44.05,145.733|1,9,古釜府湾,44.0333,145.85|1,10,泊湾,43.7333,145.45|1,11,水晶島,43.4167,145.9|1,12,多楽島,43.6333,146.367|1,13,斜古丹,43.8667,146.817|1,14,根室,43.3333,145.583|1,15,尾岱沼,43.5667,145.233|1,16,羅臼,44.0167,145.2|1,17,コイセボイ,44.05,144.95|1,18,網走,44.0167,144.283|1,19,紋別,44.35,143.367|1,20,雄武,44.5833,142.967|1,21,枝幸,44.9333,142.6|1,22,浜鬼志別,45.3333,142.167|1,23,宗谷岬,45.5167,141.95|1,24,稚内,45.4167,141.683|1,25,抜海,45.3167,141.617|1,26,鴛泊,45.2333,141.233|1,27,沓形,45.1833,141.133|1,28,船泊,45.45,141.033|1,29,苫前,44.3167,141.65|1,30,留萌,43.95,141.633|1,31,浜益,43.6,141.383|1,32,小樽,43.2167,141.017|1,33,忍路,43.2167,140.85|1,34,神威岬,43.3333,140.35|1,35,岩内,42.9833,140.5|1,36,寿都,42.7833,140.267|1,37,瀬棚,42.4667,139.85|1,38,奥尻,42.1667,139.517|1,39,青苗,42.0667,139.45|1,40,江差,41.8667,140.1|1,41,清部,41.5333,140|1,42,松前,41.4167,140.083|1,43,吉岡,41.45,140.25|1,44,湧元,41.5667,140.417|1,45,函館,41.7833,140.717|1,46,汐首岬,41.7167,140.967|1,47,戸井,41.7167,141|1,48,古武井,41.7667,141.133|1,49,臼尻,41.9333,140.95|1,50,森,42.1167,140.6|1,51,有珠湾,42.5167,140.767|1,52,室蘭,42.35,140.95|1,53,苫小牧,42.6333,141.633|1,54,東静内,42.2833,142.467|1,55,三石,42.25,142.55|1,56,浦河,42.1667,142.767|1,57,えりも,42.0167,143.15|1,58,歌露,41.9667,143.2|1,59,襟裳岬,41.9333,143.233|1,60,庶野,42.0167,143.283|1,61,ルベシベツ,42.2,143.333|1,62,音調津,42.2167,143.317|1,63,十勝,42.2833,143.333|1,64,釧路,42.9667,144.383|1,65,厚岸,43.0333,144.85|1,66,厚岸湖,43.0333,144.867|1,67,霧多布,43.0833,145.133|1,68,落石,43.1833,145.517|1,69,花咲,43.2833,145.583|1,70,香深,45.3,141.05|1,71,常呂,44.1167,144.1|1,72,湧別,44.2333,143.633|1,73,利尻,45.1333,141.317|2,1,竜飛埼,41.2667,140.333|2,2,三厩,41.2,140.417|2,3,袰月,41.2167,140.55|2,4,青森,40.8333,140.767|2,5,茂浦,40.95,140.867|2,6,小湊,40.95,140.983|2,7,野辺地,40.8667,141.117|2,8,大湊,41.25,141.15|2,9,大間,41.5333,140.9|2,10,大畑,41.4167,141.167|2,11,尻屋岬,41.4167,141.433|2,12,尻屋,41.4,141.45|2,13,白糠,41.1333,141.4|2,14,泊,41.1,141.383|2,15,八戸,40.5333,141.533|2,16,岩崎,40.5833,139.9|2,17,深浦,40.65,139.933|2,18,鯵ヶ沢,40.7833,140.217|2,19,小泊,41.1333,140.3|2,20,関根浜,41.3667,141.233|2,21,浅虫,40.9,140.867|2,22,竜飛,41.2333,140.4|3,1,久慈,40.1833,141.817|3,2,宮古,39.6333,141.983|3,3,山田,39.4667,141.967|3,4,釜石,39.2667,141.9|3,5,大船渡,39.05,141.733|3,6,八木,40.35,141.767|3,7,茂師,39.8333,141.983|4,1,気仙沼,38.8833,141.617|4,2,船越湾,38.5333,141.517|4,3,女川,38.4333,141.467|4,4,鮎川,38.3,141.517|4,5,荻浜,38.3667,141.45|4,6,石巻,38.4167,141.317|4,7,野蒜湾,38.35,141.15|4,8,石浜,38.3167,141.117|4,9,港橋,38.3167,141.033|4,10,花淵浜,38.3,141.083|4,11,仙台,38.2667,141.033|4,12,閖上,38.1667,140.967|4,13,志津川,38.6667,141.45|5,1,金浦,39.25,139.917|5,2,秋田,39.75,140.067|5,3,船川,39.8833,139.85|5,4,能代,40.2167,140|5,5,岩館,40.4,139.983|5,6,男鹿,39.9333,139.7|6,1,鼠ヶ関,38.5667,139.55|6,2,由良,38.7167,139.683|6,3,加茂,38.7667,139.733|6,4,酒田,38.9167,139.833|7,1,相馬,37.8333,140.967|7,2,松川浦,37.8167,140.983|7,3,夫沢,37.4167,141.033|7,4,富岡,37.3167,141.033|7,5,四倉,37.1,141|7,6,小名浜,36.9333,140.9|8,1,大津,36.8333,140.8|8,2,日立,36.5,140.633|8,3,那珂湊,36.3333,140.583|8,4,鹿島,35.9333,140.7|8,5,大洗,36.3167,140.583|12,1,新地,35.7333,140.85|12,2,銚子漁港,35.7333,140.867|12,3,犬吠埼,35.7,140.867|12,4,名洗,35.7,140.85|12,5,上総勝浦,35.1333,140.25|12,6,鴨川,35.0833,140.117|12,7,白浜,34.9167,139.933|12,8,布良,34.9167,139.833|12,9,船形,35.0167,139.85|12,10,岩井袋,35.1,139.833|12,11,第１海堡,35.3167,139.767|12,12,君津,35.35,139.867|12,13,姉崎,35.4833,140.033|12,14,市原,35.5333,140.117|12,15,寒川,35.5833,140.117|12,16,千葉灯標,35.5667,140.05|12,17,市川,35.6833,139.95|12,18,船橋,35.6833,139.983|12,19,館山,34.9833,139.85|13,1,築地,35.6667,139.767|13,2,芝浦,35.6333,139.75|13,3,羽田,35.55,139.767|13,4,岡田,34.7833,139.4|13,5,波浮,34.6833,139.433|13,6,式根島,34.3167,139.217|13,7,神津島,34.2,139.133|13,8,阿古,34.0667,139.483|13,9,神湊,33.1333,139.8|13,10,鳥島,30.4833,140.317|13,11,二見,27.0833,142.183|13,12,沖,26.6333,142.15|13,13,西,24.8,141.3|13,14,晴海,35.65,139.767|13,15,八重根,33.1,139.767|13,16,沖ノ鳥島,20.4167,136.05|14,1,塩浜運河,35.5167,139.75|14,2,末広,35.4833,139.7|14,3,新港,35.45,139.633|14,4,新山下,35.4333,139.667|14,5,根岸,35.4,139.633|14,6,長浦,35.3167,139.65|14,7,横須賀,35.2833,139.65|14,8,走水,35.25,139.733|14,9,浦賀,35.2333,139.717|14,10,久里浜,35.2167,139.717|14,11,金田湾,35.2,139.683|14,12,間口,35.15,139.683|14,13,城ヶ島,35.1333,139.617|14,14,向ヶ崎,35.1333,139.617|14,15,諸磯,35.15,139.617|14,16,油壷,35.15,139.617|14,17,小田和湾,35.2167,139.617|14,18,新宿湾,35.2833,139.567|14,19,江ノ島,35.3,139.483|14,20,真鶴,35.15,139.15|15,1,能生,37.1,138|15,2,直江津,37.1833,138.25|15,3,柏崎,37.35,138.517|15,4,出雲崎,37.55,138.667|15,5,寺泊,37.6333,138.767|15,6,新潟西港,37.9333,139.067|15,7,二見,37.9667,138.267|15,8,小木,37.8167,138.283|15,9,両津,38.0833,138.433|15,10,鷲崎,38.3167,138.517|15,11,岩船,38.1833,139.433|15,12,粟島,38.4667,139.25|15,13,新潟東港,37.9833,139.217|16,1,阿尾,36.8833,136.983|16,2,伏木,36.7833,137.067|16,3,富山,36.7667,137.233|16,4,生地,36.8833,137.417|16,5,宮崎,36.9667,137.583|17,1,金沢,36.6167,136.6|17,2,滝,36.9333,136.767|17,3,寺家,37.5,137.35|17,4,輪島,37.4,136.9|17,5,松波,37.35,137.25|17,6,曾良,37.1833,137.017|17,7,中居入,37.2333,136.95|17,8,七尾,37.05,136.967|17,9,穴水,37.2167,136.917|18,1,内浦湾,35.55,135.5|18,2,和田,35.5,135.583|18,3,小浜,35.5,135.733|18,4,丹生,35.7167,135.967|18,5,敦賀,35.6667,136.067|18,6,福井,36.2,136.133|18,7,三国,36.2167,136.133|22,1,網代,35.05,139.083|22,2,伊東,34.9667,139.117|22,3,川奈,34.95,139.133|22,4,白浜,34.7167,138.983|22,5,下田,34.6667,138.95|22,6,南伊豆,34.6167,138.883|22,7,妻良子浦,34.6667,138.783|22,8,田子,34.8,138.767|22,9,宇久須,34.85,138.767|22,10,三津,35.0167,138.9|22,11,田子の浦,35.1333,138.7|22,12,興津,35.05,138.517|22,13,清水,35.0167,138.5|22,14,三保,35,138.517|22,15,焼津,34.8667,138.333|22,16,相良,34.6833,138.233|22,17,御前崎,34.6,138.233|22,18,舞阪,34.6833,137.617|22,19,熱海,35.0833,139.083|23,1,伊良湖,34.5833,137.017|23,2,神島,34.55,136.983|23,3,篠島,34.6833,137|23,4,佐久島,34.7333,137.05|23,5,立馬埼,34.6667,137.083|23,6,福江,34.6333,137.117|23,7,豊橋,34.7167,137.333|23,8,三谷,34.8167,137.25|23,9,蒲郡,34.8167,137.233|23,10,形原,34.7833,137.183|23,11,洲崎,34.7833,137.167|23,12,寺津,34.8167,137|23,13,武豊,34.85,136.933|23,14,師崎,34.7,136.983|23,15,常滑,34.8667,136.833|23,16,鬼崎,34.9,136.833|23,17,名古屋,35.0833,136.883|23,18,赤羽根,34.6,137.2|24,1,四日市,34.95,136.633|24,2,津,34.7167,136.533|24,3,松阪,34.6,136.567|24,4,宇治山田,34.5167,136.75|24,5,鳥羽,34.4833,136.85|24,6,的矢,34.3667,136.867|24,7,浜島,34.3,136.767|24,8,五ヶ所,34.3167,136.667|24,9,吉津,34.2667,136.5|24,10,長島,34.2,136.333|24,11,尾鷲,34.0667,136.217|24,12,古江,33.9667,136.2|24,13,二木島,33.9333,136.183|24,14,鵜殿,33.7333,136.017|24,15,錦,34.2167,136.4|26,1,伊根,35.6667,135.283|26,2,島埼,35.5333,135.2|26,3,獅子崎,35.55,135.2|26,4,田井,35.5833,135.233|26,5,舞鶴東港,35.4833,135.4|26,6,舞鶴西港,35.45,135.317|27,1,深日,34.3167,135.133|27,2,淡輪,34.3333,135.183|27,3,岸和田,34.4667,135.367|27,4,泉大津,34.5,135.4|27,5,堺,34.5833,135.467|27,6,大阪,34.65,135.433|28,1,福良,34.25,134.7|28,2,阿那賀浦,34.2667,134.667|28,3,由良,34.2667,134.95|28,4,洲本,34.3333,134.917|28,5,仮屋,34.5167,135|28,6,尼崎,34.7,135.4|28,7,神戸,34.6833,135.2|28,8,苅藻島,34.65,135.167|28,9,明石,34.65,135|28,10,岩屋,34.6,135.017|28,11,江崎,34.6,134.983|28,12,室津,34.5333,134.867|28,13,江井,34.4667,134.817|28,14,家島,34.6833,134.533|28,15,二見,34.7,134.9|28,16,高砂,34.7333,134.8|28,17,飾磨,34.7833,134.667|28,18,広畑,34.7833,134.617|28,19,相生,34.8,134.467|28,20,赤穂,34.75,134.367|28,21,香住,35.65,134.633|28,22,柴山,35.65,134.667|28,23,津居山,35.65,134.833|28,24,垂水,34.6167,135.067|30,1,紀伊勝浦,33.6333,135.95|30,2,浦神,33.55,135.9|30,3,串本,33.4667,135.783|30,4,周参見,33.55,135.5|30,5,田辺（旧）,33.7167,135.367|30,6,三尾,33.8833,135.083|30,7,比井湾,33.9167,135.1|30,8,由良,33.95,135.117|30,9,下津,34.1167,135.133|30,10,海南,34.15,135.2|30,11,和歌山,34.2167,135.15|30,12,沖ノ島,34.2833,135.017|30,13,田辺,33.6833,135.383|31,1,米子,35.4333,133.317|31,2,境,35.55,133.25|31,3,淀江,35.4667,133.433|31,4,赤碕,35.5,133.667|31,5,因幡網代,35.5833,134.3|31,6,田後,35.5833,134.317|32,1,外ノ浦,34.9,132.067|32,2,江津,35.0167,132.233|32,3,温泉津,35.1,132.35|32,4,大社,35.4,132.667|32,5,鷺,35.45,132.683|32,6,河下,35.45,132.75|32,7,恵曇,35.5167,132.983|32,8,加賀,35.5667,133.05|32,9,七類,35.5667,133.233|32,10,大根島,35.5,133.167|32,11,安来,35.4333,133.267|32,12,浦郷,36.0833,133.017|32,13,日ノ津浦,36.0833,133.067|32,14,菱浦,36.1,133.083|32,15,知々井,36.0833,133.117|32,16,西郷,36.2,133.333|32,17,松江,35.45,133.133|33,1,片上,34.7333,134.217|33,2,大多府島,34.6833,134.3|33,3,牛窓,34.6167,134.167|33,4,宝伝,34.5833,134.1|33,5,小串,34.6,134.033|33,6,宇野,34.5,133.95|33,7,下津井,34.4333,133.8|33,8,水島,34.5167,133.75|33,9,笠岡,34.5,133.5|33,10,玉島,34.5167,133.667|34,1,福山,34.4833,133.417|34,2,鞆,34.3833,133.383|34,3,常石,34.3833,133.3|34,4,尾道,34.4,133.2|34,5,糸崎,34.3833,133.117|34,6,江之浦,34.35,133.2|34,7,小佐木島,34.3667,133.1|34,8,忠海,34.3333,133|34,9,土生,34.2667,133.2|34,10,瀬戸田,34.3,133.083|34,11,御手洗,34.1833,132.867|34,12,小用,34.2333,132.717|34,13,長浜,34.2167,132.617|34,14,奥ノ内,34.15,132.533|34,15,鹿老渡小瀬戸,34.0667,132.55|34,16,室尾,34.1,132.55|34,17,美能,34.25,132.383|34,18,江田内,34.25,132.467|34,19,広島,34.35,132.467|34,20,呉,34.2333,132.55|34,21,音戸瀬戸,34.1833,132.533|34,22,早瀬瀬戸,34.15,132.483|34,23,厳島,34.3,132.317|34,24,大野瀬戸,34.2667,132.267|34,25,竹原,34.3333,132.967|35,1,岩国,34.2,132.233|35,2,土居,33.9167,132.3|35,3,情島,33.95,132.467|35,4,大畠,33.95,132.167|35,5,東安下庄,33.9,132.283|35,6,沖家室島,33.85,132.367|35,7,室津,33.8333,132.117|35,8,平生,33.9167,132.05|35,9,下松,34,131.833|35,10,徳山,34.0333,131.8|35,11,三田尻,34.0333,131.583|35,12,宇部,33.9333,131.25|35,13,苅屋,33.95,131.167|35,14,小野田,33.9667,131.183|35,15,長府,34.0167,131|35,16,岩黒,33.9667,130.983|35,17,前田,33.9667,130.967|35,18,壇之浦,33.9667,130.95|35,19,下関第１突堤,33.95,130.933|35,20,弟子待,33.9167,130.933|35,21,田の首,33.9167,130.917|35,22,南風泊,33.95,130.883|35,23,伊崎,33.95,130.917|35,24,吉母,34.0833,130.867|35,25,特牛,34.3167,130.9|35,26,油谷,34.4,130.95|35,27,宇津,34.7833,131.15|35,28,大泊,34.4,131.183|35,29,萩,34.4333,131.417|35,30,江崎,34.6333,131.65|35,31,大山ノ鼻,33.9167,130.9|36,1,日和佐,33.7333,134.55|36,2,橘,33.8667,134.65|36,3,富岡,33.9167,134.7|36,4,小松島,34,134.583|36,5,土佐泊,34.1833,134.633|36,6,堂ノ浦,34.2167,134.583|36,7,北泊,34.2333,134.583|36,8,孫埼,34.2333,134.65|36,9,網代,34.2333,134.633|36,10,粟津,34.1333,134.617|37,1,引田,34.2333,134.4|37,2,坂手,34.45,134.317|37,3,大部,34.55,134.283|37,4,地蔵埼,34.4333,134.233|37,5,入部,34.4833,134.2|37,6,宮ノ浦,34.45,133.967|37,7,男木島,34.4333,134.05|37,8,高松,34.35,134.05|37,9,坂出,34.3167,133.85|37,10,丸亀,34.3,133.8|37,11,鍋島,34.3833,133.817|37,12,与島,34.3833,133.817|37,13,青木,34.3667,133.683|37,14,佐柳,34.3333,133.633|37,15,粟島,34.2667,133.633|37,16,観音寺,34.1333,133.633|38,1,三島,33.9833,133.55|38,2,多喜浜,33.9833,133.35|38,3,新居浜,33.9667,133.267|38,4,西条,33.9333,133.167|38,5,家ノ島,34.1,133.183|38,6,今治,34.0667,133|38,7,来島,34.1167,132.967|38,8,波止浜,34.1167,132.967|38,9,菊間,34.0333,132.833|38,10,宇和間,33.9667,132.583|38,11,大浦,33.9833,132.633|38,12,興居島,33.9167,132.683|38,13,松山,33.8667,132.717|38,14,青島,33.7333,132.483|38,15,長浜,33.6167,132.483|38,16,三机,33.45,132.233|38,17,与侈,33.3833,132.083|38,18,内ノ浦,33.3667,132.05|38,19,八幡浜,33.45,132.4|38,20,奥地湾,33.3333,132.383|38,21,宇和島,33.2333,132.55|38,22,能登,33.1667,132.267|38,23,柏崎,33.0167,132.483|38,24,小島,34.1167,132.983|38,25,鼻栗瀬戸,34.2167,133.067|39,1,甲浦,33.55,134.3|39,2,室戸岬,33.2667,134.167|39,3,室津,33.2833,134.15|39,4,高知,33.5,133.567|39,5,須崎,33.4,133.283|39,6,土佐清水,32.7833,132.967|39,7,片島,32.9167,132.7|40,1,宇島,33.6333,131.133|40,2,苅田,33.7833,130.983|40,3,新門司,33.8667,130.983|40,4,青浜,33.95,131.017|40,5,田野浦,33.95,130.983|40,6,旧門司,33.95,130.967|40,7,西海岸,33.9333,130.967|40,8,砂津,33.8833,130.9|40,9,製鉄戸畑泊地,33.9167,130.85|40,10,若松,33.9,130.817|40,11,戸畑,33.9,130.817|40,12,八幡,33.8667,130.8|40,13,沖,33.8667,130.75|40,14,白島,34.0167,130.733|40,15,岩屋,33.9333,130.683|40,16,鐘崎,33.8833,130.533|40,17,神湊,33.85,130.483|40,18,津屋崎,33.7833,130.45|40,19,西戸埼,33.65,130.367|40,20,博多船だまり,33.6,130.4|40,21,福岡船だまり,33.6,130.383|40,22,若松（響灘）,33.9333,130.85|40,23,三池,33.0167,130.417|40,24,筑前大島,33.9,130.433|40,25,柏原,33.9,130.667|40,26,脇田,33.9333,130.733|40,27,日明,33.9,130.883|40,28,小呂島,33.8667,130.033|41,1,唐津,33.4667,129.967|41,2,呼子,33.55,129.883|41,3,名護屋浦,33.5333,129.867|41,4,仮屋,33.4667,129.85|41,5,波瀬,33.3167,129.817|41,6,竹崎島,32.95,130.217|41,7,住ノ江,33.2,130.2|41,8,若津,33.2167,130.35|42,1,新御厨,33.3667,129.667|42,2,大飛島,33.4,129.783|42,3,郷ノ浦,33.7333,129.683|42,4,勝本,33.85,129.7|42,5,芦辺,33.8167,129.767|42,6,厳原,34.2,129.3|42,7,高浜,34.25,129.317|42,8,大船越,34.2833,129.35|42,9,茂土浦,34.3,129.383|42,10,鴨居瀬,34.3333,129.383|42,11,千尋藻,34.4,129.383|42,12,佐賀,34.45,129.383|42,13,小鹿湾,34.5167,129.45|42,14,網代,34.65,129.483|42,15,泉,34.6667,129.483|42,16,大河内湾,34.6833,129.417|42,17,佐須奈,34.6333,129.4|42,18,伊奈,34.55,129.317|42,19,狩尾,34.45,129.3|42,20,綱湾,34.4167,129.267|42,21,廻,34.3667,129.25|42,22,尾崎浦,34.3167,129.217|42,23,箕形,34.2833,129.267|42,24,昼ヶ浦,34.3167,129.283|42,25,竹敷,34.3,129.3|42,26,島山,34.3167,129.317|42,27,大山浦,34.3333,129.35|42,28,万関瀬戸東口,34.3,129.367|42,29,万関瀬戸西口,34.3,129.367|42,30,小茂田,34.2333,129.2|42,31,久根浜,34.1667,129.183|42,32,豆酘,34.1167,129.183|42,33,黒子島,33.3667,129.567|42,34,薄香湾,33.3833,129.533|42,35,志々伎湾,33.2,129.383|42,36,楠泊,33.2167,129.583|42,37,相ノ浦,33.1833,129.633|42,38,高後埼,33.1,129.683|42,39,俵ヶ浦,33.1167,129.667|42,40,佐世保,33.15,129.733|42,41,巣喰ノ浦,33.0833,129.717|42,42,鯛ノ浦,33.0833,129.75|42,43,小鯛,33.0667,129.75|42,44,畑下,33.0667,129.733|42,45,名倉,33.0667,129.767|42,46,伊ノ浦,33.05,129.75|42,47,早岐突堤（北側）,33.1333,129.8|42,48,早岐突堤（南側）,33.1333,129.8|42,49,小串湾,33.0667,129.817|42,50,大村,32.9,129.95|42,51,面高湾,33.0667,129.667|42,52,肥前大島,33.0333,129.617|42,53,崎戸,33.0167,129.567|42,54,松島,32.9333,129.617|42,55,小江,32.75,129.817|42,56,伊王島,32.7,129.783|42,57,鼠島,32.7167,129.833|42,58,女神,32.7167,129.85|42,59,松ケ枝,32.7333,129.867|42,60,水ノ浦,32.75,129.867|42,61,深堀,32.6833,129.817|42,62,高島,32.65,129.75|42,63,樺島水道,32.55,129.783|42,64,神ノ浦,33.2667,129.083|42,65,笛吹,33.1833,129.05|42,66,有川,32.9833,129.117|42,67,鯛之浦,32.95,129.1|42,68,荒川,32.9167,129.05|42,69,若松,32.8833,129.017|42,70,船廻湾,32.8667,128.933|42,71,戸岐浦,32.75,128.833|42,72,福江,32.7,128.85|42,73,富江,32.6167,128.767|42,74,玉之浦,32.6167,128.617|42,75,三井楽,32.75,128.7|42,76,水之浦,32.75,128.75|42,77,女島,32,128.35|42,78,網場,32.75,129.95|42,79,口之津,32.6,130.2|42,80,須川,32.65,130.3|42,81,島原,32.7667,130.367|42,82,荒川,32.6667,128.683|42,83,飯ノ瀬戸,32.95,129|42,84,神部,32.8667,129.033|42,85,島原新港,32.8167,130.367|42,86,万関瀬戸中央部,34.3,129.35|42,87,青方,33,129.05|42,88,松浦,33.35,129.683|43,1,本渡,32.45,130.2|43,2,長洲,32.9167,130.45|43,3,熊本,32.75,130.567|43,4,三角,32.6167,130.45|43,5,蔵々ノ瀬戸,32.5833,130.467|43,6,柳ノ瀬戸,32.5333,130.417|43,7,八代,32.5167,130.567|43,8,加賀島,32.5167,130.533|43,9,池ノ浦,32.3833,130.35|43,10,水俣,32.2,130.383|43,11,袋浦,32.1833,130.367|43,12,富岡,32.5333,130.033|43,13,崎津湾,32.3167,130.017|43,14,牛深,32.2,130.017|43,15,大門,32.4333,130.217|44,1,佐賀関,33.25,131.883|44,2,鶴崎,33.2667,131.683|44,3,西大分,33.25,131.583|44,4,亀川,33.3333,131.5|44,5,日出,33.3667,131.533|44,6,姫島,33.7333,131.65|44,7,香々地,33.6833,131.517|44,8,高田,33.5833,131.433|44,9,中津,33.6,131.25|44,10,下浦,33.2333,131.883|44,11,泊ヶ内,33.1333,131.9|44,12,津久見,33.0667,131.867|44,13,葛,32.9833,131.9|44,14,長島,32.9667,131.917|44,15,大島,32.9667,132.067|44,16,猪串,32.8,131.9|44,17,蒲江,32.7833,131.917|44,18,米水津泊地,32.8833,132|45,1,福島,31.45,131.2|45,2,外浦,31.5167,131.367|45,3,油津,31.5833,131.417|45,4,内海,31.75,131.467|45,5,折生迫,31.7833,131.467|45,6,細島,32.4333,131.667|45,7,美々津,32.3333,131.617|45,8,土々呂,32.5,131.683|45,9,宮崎,31.9,131.467|46,1,阿久根,32.0167,130.2|46,2,川内,31.85,130.217|46,3,浦内湾,31.85,129.85|46,4,串木野,31.7167,130.267|46,5,戸崎,31.65,130.3|46,6,坊泊,31.2833,130.217|46,7,枕崎,31.2667,130.3|46,8,山川,31.2,130.633|46,9,喜入,31.3833,130.55|46,10,鹿児島,31.6,130.567|46,11,麓,31.55,130.733|46,12,園山,31.6167,130.7|46,13,垂水,31.5,130.7|46,14,鹿屋,31.4,130.767|46,15,伊座敷,31.1,130.7|46,16,大泊,31.0167,130.683|46,17,志布志,31.4667,131.117|46,18,硫黄島,30.7833,130.283|46,19,西之表,30.7333,131|46,20,田ノ脇,30.6833,131.067|46,21,大浦,30.45,130.967|46,22,一湊,30.4667,130.5|46,23,口永良部島,30.4667,130.183|46,24,臥蛇島,29.9,129.55|46,25,中之島,29.8333,129.85|46,26,宝島,29.15,129.2|46,27,笠利湾,28.45,129.65|46,28,名瀬,28.3833,129.5|46,29,宇検,28.2833,129.233|46,30,西古見湾,28.25,129.167|46,31,久慈湾,28.2333,129.25|46,32,古仁屋,28.15,129.317|46,33,住用湾,28.2333,129.417|46,34,請島,28.0333,129.233|46,35,山村湾,27.8667,128.967|46,36,和泊,27.4,128.667|46,37,茶花,27.05,128.417|46,38,波見,31.35,131.017|47,1,我喜屋,27.0333,127.967|47,2,伊江,26.7,127.8|47,3,運天,26.6667,128.017|47,4,渡久地,26.65,127.9|47,5,那覇,26.2167,127.667|47,6,糸満,26.1333,127.667|47,7,石川,26.4167,127.85|47,8,馬天,26.1833,127.783|47,9,楚久,26.55,128.033|47,10,座間味,26.2167,127.3|47,11,儀間,26.3333,126.767|47,12,南大東島,25.8167,131.233|47,13,平良,24.8,125.283|47,14,長山,24.8,125.2|47,15,石垣,24.3333,124.167|47,16,船浮,24.3333,123.733|47,17,比川,24.4167,123|47,18,黄尾嶼,25.9333,123.683|47,19,魚釣島,25.7333,123.467|47,20,白浜,24.35,123.75|47,21,安田,26.7333,128.317|47,22,辺土名,26.75,128.183|47,23,都屋,26.3833,127.733|47,24,平敷屋,26.3,127.917|47,25,奥武島,26.1333,127.783|47,26,仲里,26.35,126.817|47,27,池間,24.9167,125.25|47,28,佐良浜,24.8333,125.217|47,29,波照間,24.0667,123.767|47,30,久部良,24.45,122.933|47,31,渡嘉敷,26.2,127.367|47,32,泡瀬,26.3167,127.85|47,33,東,26.6167,128.167|47,34,宜名真,26.85,128.25|47,35,兼城,26.3333,126.75";

let seaPortList = null;

function seaPorts() {
  if (!seaPortList) seaPortList = SEA_PORTS_RAW.split("|").map((s) => {
    const [pc, hc, name, lat, lon] = s.split(",");
    return { pc: +pc, hc: +hc, name, lat: +lat, lon: +lon };
  });
  return seaPortList;
}

function seaKm(a, b) {
  const r = Math.PI / 180;
  const s = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

function seaNearestPort(place) {
  let best = null;
  let km = Infinity;
  seaPorts().forEach((p) => {
    const d = seaKm(place, p);
    if (d < km) [best, km] = [p, d];
  });
  return best && km <= SEA.portMaxKm ? { ...best, km } : null;
}

async function seaPlace(arg) {
  const text = String(arg || "").trim();
  const port = text && seaPorts().find((p) => p.name === text);
  if (port) return { lat: port.lat, lon: port.lon, name: port.name };
  if (!text || /^(-?\d+(?:\.\d+)?)[,_](-?\d+(?:\.\d+)?)(?:=(.+))?$/.test(text)) return resolvePlace(text);
  const key = "sea_place2_" + encodeURIComponent(text);
  const cached = readCache(key);
  if (cached) return cached;
  const search = async (name) => {
    try {
      return (await request(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=ja&format=json`).loadJSON()).results || [];
    } catch (e) {
      return [];
    }
  };
  const gsiP = request(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(text)}`).loadJSON().catch(() => []);
  let found = (await Promise.all([text, text + "市"].map(search))).flat();
  if (!found.length) found = await search(text + "町");
  const gsi = ((await gsiP) || []).map((f) => ({ title: (f.properties && f.properties.title) || "", code: f.properties && f.properties.addressCode, ds: f.properties && f.properties.dataSource, lon: f.geometry && f.geometry.coordinates && f.geometry.coordinates[0], lat: f.geometry && f.geometry.coordinates && f.geometry.coordinates[1] }))
    .filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lon));
  const list = [];
  const add = (c) => {
    const same = list.find((x) => seaKm(x, c) <= 5);
    if (!same) list.push(c);
    else { same.pop = Math.max(same.pop, c.pop); same.jp = same.jp || c.jp; }
  };
  found.forEach((r) => add({ lat: r.latitude, lon: r.longitude, pop: r.population || 0, jp: r.country_code === "JP" }));
  const addGsi = (ds) => gsi.filter((g) => g.code && g.ds === ds && g.title === text).forEach((g) => add({ lat: g.lat, lon: g.lon, pop: 0, jp: true }));
  addGsi("4");
  if (!list.length) addGsi("5");
  if (!list.length) return resolvePlace(text);
  list.forEach((c, i) => { c.i = i; c.towns = gsi.filter((g) => g.ds === "5" && g.title.endsWith(text) && seaKm(c, g) <= 5).length; });
  const near = (c) => seaPorts().some((p) => seaKm(c, p) <= SEA.portMaxKm);
  const score = (c) => (c.jp ? 2 : 0) + (near(c) ? 1 : 0);
  const best = list.sort((a, b) => score(b) - score(a) || b.pop - a.pop || b.towns - a.towns || a.i - b.i)[0];
  const place = { lat: best.lat, lon: best.lon, name: text };
  writeCache(key, place);
  return place;
}

async function seaArea(place, port) {
  const key = `sea_area_${place.lat.toFixed(3)}_${place.lon.toFixed(3)}`;
  const cached = readCache(key, 60 * 24 * 30);
  if (cached) return cached.jma || null;
  let muni = await muniCode(place.lat, place.lon);
  const bases = port ? [place, port] : [];
  for (const r of bases.length && !muni ? [0.02, 0.05, 0.1] : []) {
    const ring = bases.flatMap((b) => [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]
      .map(([dy, dx]) => muniCode(b.lat + dy * r, b.lon + dx * r)));
    muni = (await Promise.all(ring)).find(Boolean) || null;
    if (muni) break;
  }
  if (!muni) {
    writeCache(key, { jma: null });
    return null;
  }
  const area = await getJSON("https://www.jma.go.jp/bosai/common/const/area.json", "jma_area.json", 60 * 24 * 30);
  const m = muni.code;
  const keys = Object.keys(area.class20s);
  const c20 = area.class20s[m + "00"] ? m + "00" : keys.find((k) => k.startsWith(m)) || keys.find((k) => k.startsWith(m.slice(0, 4) + "0"));
  const c10 = c20 && area.class15s[area.class20s[c20].parent] && area.class15s[area.class20s[c20].parent].parent;
  const office = c10 && area.class10s[c10] && area.class10s[c10].parent;
  const jma = office ? { c20, c10, office, name: `${(area.offices[office] || {}).name || ""}${area.class10s[c10].name}`, town: area.class20s[c20].name } : null;
  writeCache(key, { jma });
  return jma;
}

const seaHalf = (s) => String(s || "").replace(/[０-９．]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/\s+/g, " ").trim();

function seaJmaText(json, c10) {
  const out = {};
  try {
    const ts = json[0].timeSeries[0];
    const a = ts.areas.find((x) => x.area.code === c10);
    ts.timeDefines.forEach((t, i) => {
      const wave = seaHalf(a.waves && a.waves[i]);
      out[t.slice(0, 10)] = {
        wave,
        nums: [...wave.matchAll(/(\d+(?:\.\d+)?)\s*メートル/g)].map((x) => Number(x[1])),
        wind: seaHalf(a.winds && a.winds[i]),
        weather: seaHalf(a.weathers && a.weathers[i]),
      };
    });
  } catch (e) {
  }
  return out;
}

function seaWarnings(json, c20) {
  try {
    const a = json.areaTypes[1].areas.find((x) => x.code === c20);
    return ((a && a.warnings) || []).filter((w) => (w.status === "発表" || w.status === "継続") && SEA.warnNames[w.code]).map((w) => SEA.warnNames[w.code]);
  } catch (e) {
    return [];
  }
}

const seaRound = (list, n = 48) => (list || []).slice(0, n).map((v) => (v == null ? null : Math.round(v * 10) / 10));

async function seaOffshore(place, hourly, empty, q) {
  const pts = [];
  for (const dy of [-0.25, 0, 0.25]) for (const dx of [-0.25, 0, 0.25]) if (dx || dy) pts.push([place.lat + dy, place.lon + dx]);
  const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${pts.map((p) => p[0].toFixed(2)).join(",")}&longitude=${pts.map((p) => p[1].toFixed(2)).join(",")}`
    + `${q}&cell_selection=sea&hourly=wave_height,wave_direction&models=${empty.join(",")}`;
  const res = await getJSON(url, `sea_off_${place.lat.toFixed(2)}_${place.lon.toFixed(2)}_${empty.join("-")}.json`, 60);
  const list = Array.isArray(res) ? res : [res];
  const km = {};
  empty.forEach((k) => {
    const col = (r, v) => (r.hourly && (r.hourly[`${v}_${k}`] || (empty.length === 1 ? r.hourly[v] : null))) || null;
    let pick = null;
    let best = Infinity;
    list.forEach((r) => {
      if (!(col(r, "wave_height") || []).some((v) => v != null)) return;
      const d = seaKm(place, { lat: r.latitude, lon: r.longitude });
      if (d < best) [pick, best] = [r, d];
    });
    if (!pick) return;
    hourly[`wave_height_${k}`] = col(pick, "wave_height");
    hourly[`wave_direction_${k}`] = col(pick, "wave_direction");
    km[k] = Math.round(best);
  });
  return km;
}

const SEA_SHOW = { wave: "wave", 波: "wave", tide: "tide", 潮: "tide", wind: "wind", 風: "wind" };

function seaOptions(arg, isFerry = () => null) {
  const show = [];
  const rest = [];
  const ferries = [];
  let deg = false;
  String(arg || "").split(",").map((w) => w.trim()).filter(Boolean).forEach((w) => {
    const k = w.toLowerCase();
    const ferry = isFerry(w);
    if (SEA_SHOW[k]) {
      if (!show.includes(SEA_SHOW[k])) show.push(SEA_SHOW[k]);
    } else if (k === "deg" || k === "角度") deg = true;
    else if (k === "16" || k === "16方位") deg = false;
    else if (ferry) ferries.push(ferry);
    else rest.push(w);
  });
  return { place: rest.join(","), show, deg, ferries };
}

const seaFerryShort = (name) => String(name).replace(/渡船$/, "");

function seaFerryOf(data) {
  const names = ((data && data.islands) || []).flatMap((s) => (s.periods || []).flatMap((p) => p.ferries.map((f) => f.name)));
  return (w) => names.find((n) => n === w || seaFerryShort(n) === w) || null;
}

function seaIsland(data, place) {
  let best = null;
  let bd = Infinity;
  ((data && data.islands) || []).forEach((s) => {
    const k = seaKm(place, s);
    if (k <= s.km && k < bd) { best = s; bd = k; }
  });
  return best;
}

function seaIsoOn(iso, day) {
  const p = (iso.periods || []).find((x) => day >= x.from && day <= x.to);
  if (!p) return null;
  const k = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${p.anchor}T00:00:00Z`)) / 864e5);
  const ex = (iso.except && iso.except[day]) || {};
  const n = p.groups.length;
  return p.ferries.map((f) => ({ ferry: f.name, color: f.color || null, group: ex[f.name] || p.groups[(((k + f.shift) % n) + n) % n] }));
}

function seaIsoLine(d, now) {
  if (!d.iso) return null;
  const tomorrow = now.getHours() >= 12;
  const list = seaIsoOn(d.iso, ymd(addDays(now, tomorrow ? 1 : 0)));
  if (!list) return null;
  const pick = d.iso.pick && d.iso.pick.length ? list.filter((x) => d.iso.pick.includes(x.ferry)) : list;
  if (!pick.length) return null;
  const item = (x, full) => ({ color: x.color, text: `${seaFerryShort(x.ferry)} ${full ? x.group : x.group.split("・")[0]}` });
  return { when: tomorrow ? "あす" : "", full: pick.map((x) => item(x, true)), short: pick.map((x) => item(x, pick.length === 1)) };
}

function seaIsoDraw(row, iso, width, theme) {
  const itemW = (x) => textWidth(x.text, 9) + 18;
  const whenW = iso.when ? textWidth(iso.when, 9) + 8 : 0;
  const need = (list) => list.reduce((a, x) => a + itemW(x), whenW);
  const items = need(iso.full) <= width ? iso.full : iso.short;
  if (need(items.slice(0, 1)) > width) return;
  let used = whenW;
  if (iso.when) txt(row, iso.when, 9, theme.sub, "semibold", { scale: 0.7 });
  items.forEach((x) => {
    const n = itemW(x);
    if (used + n > width) return;
    used += n;
    const dot = row.addStack();
    dot.layoutHorizontally();
    dot.spacing = 2;
    dot.centerAlignContent();
    txt(dot, "●", 7, x.color ? new Color(x.color) : theme.sub);
    txt(dot, x.text, 9, theme.text, "semibold", { scale: 0.7 });
  });
}

async function loadSea(arg, ctx, item) {
  const isoP = getJSON(`${SEA.page}data/isowari.json`, "sea_isowari.json", 60 * 24, item).catch(() => null);
  const opt = seaOptions(arg, seaFerryOf(readCache("sea_isowari.json") || (await isoP)));
  const place = await seaPlace(opt.place);
  const port = seaNearestPort(place);
  const la = place.lat.toFixed(2);
  const lo = place.lon.toFixed(2);
  const q = `&timezone=Asia%2FTokyo&forecast_days=3`;
  const at = `latitude=${la}&longitude=${lo}`;
  const windUrl = (models, gust = false) => `https://api.open-meteo.com/v1/forecast?${at}${q}&hourly=wind_speed_10m,wind_direction_10m${gust ? ",wind_gusts_10m" : ""}&wind_speed_unit=ms&models=${models.join(",")}`;
  const soft = (p) => p.catch(() => null);
  const today = ymd(ctx.now);
  const [areaJma, waves, sea, msm, wind, tide, wx] = await Promise.all([
    soft(seaArea(place, port)),
    soft(getJSON(`https://marine-api.open-meteo.com/v1/marine?${at}${q}&cell_selection=sea&hourly=wave_height,wave_direction&models=${SEA.waves.map((m) => m.key).join(",")}`, `sea_wave_${la}_${lo}.json`, 60, item)),
    soft(getJSON(`https://marine-api.open-meteo.com/v1/marine?${at}${q}&cell_selection=sea&hourly=sea_surface_temperature,ocean_current_velocity,ocean_current_direction`, `sea_sst2_${la}_${lo}.json`, 120, item)),
    soft(getJSON(windUrl(["jma_msm"]), `sea_msm_${la}_${lo}.json`, 60, item)),
    soft(getJSON(windUrl(SEA.winds.slice(1).map((m) => m.key), true), `sea_wind2_${la}_${lo}.json`, 60, item)),
    port ? soft(getJSON(`https://tide736.net/api/get_tide.php?pc=${port.pc}&hc=${port.hc}&yr=${ctx.now.getFullYear()}&mn=${ctx.now.getMonth() + 1}&dy=${ctx.now.getDate()}&rg=week`, `sea_tide_${port.pc}_${port.hc}_${today}.json`, 60 * 12, item)) : null,
    soft(getJSON(`https://api.open-meteo.com/v1/forecast?${at}${q}&hourly=weather_code,is_day,temperature_2m,precipitation_probability`, `sea_wx_${la}_${lo}.json`, 60, item)),
  ]);
  if (!waves && !wind && !tide) throw new Error("sea: nothing");
  const [jmaJson, warnJson] = areaJma
    ? await Promise.all([
      soft(getJSON(`https://www.jma.go.jp/bosai/forecast/data/forecast/${areaJma.office}.json`, `jma_fc_${areaJma.office}.json`, 60, item)),
      soft(getJSON(`https://www.jma.go.jp/bosai/warning/data/warning/${areaJma.office}.json`, `jma_warn_${areaJma.office}.json`, 30, item)),
    ])
    : [null, null];

  const wh = (waves && waves.hourly) || {};
  const empty = SEA.waves.map((m) => m.key).filter((k) => !(wh[`wave_height_${k}`] || []).some((v) => v != null));
  const offshore = waves && empty.length ? await seaOffshore(place, wh, empty, q).catch(() => ({})) : {};
  const windH = { ...((wind && wind.hourly) || {}) };
  if (msm && msm.hourly) {
    windH.wind_speed_10m_jma_msm = msm.hourly.wind_speed_10m;
    windH.wind_direction_10m_jma_msm = msm.hourly.wind_direction_10m;
  }
  const firstOf = (h, name, models) => {
    for (const m of models) if ((h[`${name}_${m.key}`] || []).some((v) => v != null)) return h[`${name}_${m.key}`];
    return [];
  };
  const chart = tide && tide.tide && tide.tide.chart;
  const days = [today, ymd(addDays(ctx.now, 1))].map((k) => chart && chart[k]).filter(Boolean);
  const mins = (t) => {
    const [h, m] = String(t).trim().split(":").map(Number);
    return h * 60 + m;
  };
  const jma = jmaJson && areaJma ? seaJmaText(jmaJson, areaJma.c10) : {};
  const island = seaIsland(await isoP, place);
  return {
    iso: island ? { periods: island.periods, except: island.except, pick: opt.ferries } : null,
    name: place.name || (areaJma && areaJma.town) || `${la},${lo}`,
    lat: place.lat,
    lon: place.lon,
    day0: today,
    port: port ? { name: port.name, km: Math.round(port.km) } : null,
    area: areaJma ? areaJma.name : "",
    waves: SEA.waves.map((m) => ({ ...m, v: seaRound(wh[`wave_height_${m.key}`]), km: offshore[m.key] || 0 })),
    waveDir: seaRound(firstOf(wh, "wave_direction", SEA.waves)),
    winds: SEA.winds.map((m) => ({ ...m, v: seaRound(windH[`wind_speed_10m_${m.key}`]), dir: (windH[`wind_direction_10m_${m.key}`] || []).slice(0, 48).map((v) => (v == null ? null : Math.round(v))) })),
    windDir: seaRound(firstOf(windH, "wind_direction_10m", SEA.winds)),
    sst: seaRound(sea && sea.hourly && sea.hourly.sea_surface_temperature),
    gust: Array.from({ length: 48 }, (_, t) => {
      const g = SEA.winds.map((m) => (windH[`wind_gusts_10m_${m.key}`] || [])[t]).filter((v) => v != null);
      return g.length ? Math.round(Math.max(...g)) : null;
    }),
    current: {
      kn: seaRound(((sea && sea.hourly && sea.hourly.ocean_current_velocity) || []).map((v) => (v == null ? null : v / 1.852))),
      dir: ((sea && sea.hourly && sea.hourly.ocean_current_direction) || []).slice(0, 48),
    },
    tide: days.length ? days.flatMap((c, i) => c.tide.slice(0, 72).map((p, j) => ({ m: i * 1440 + j * 20, cm: Math.round(p.cm) }))) : [],
    tideMarks: days.flatMap((c, i) => [
      ...c.flood.map((p) => ({ m: i * 1440 + mins(p.time), cm: Math.round(p.cm), k: "満潮", time: p.time })),
      ...c.edd.map((p) => ({ m: i * 1440 + mins(p.time), cm: Math.round(p.cm), k: "干潮", time: p.time })),
    ]).sort((a, b) => a.m - b.m),
    moon: days.length ? days[0].moon.title : "",
    tideRange: days.length && days[0].flood.length && days[0].edd.length ? Math.round(Math.max(...days[0].flood.map((p) => p.cm)) - Math.min(...days[0].edd.map((p) => p.cm))) : null,
    sun: days.map((c, i) => ({ rise: i * 1440 + mins(c.sun.rise), set: i * 1440 + mins(c.sun.set), tw0: i * 1440 + mins((c.sun.regular_twilight || [c.sun.rise])[0]), tw1: i * 1440 + mins((c.sun.regular_twilight || [0, c.sun.set])[1]) })),
    jma: [0, 1, 2].map((i) => jma[ymd(addDays(ctx.now, i))] || null),
    warns: warnJson && areaJma ? seaWarnings(warnJson, areaJma.c20) : [],
    wx: wx && wx.hourly ? {
      code: (wx.hourly.weather_code || []).slice(0, 48),
      day: (wx.hourly.is_day || []).slice(0, 48),
      temp: seaRound(wx.hourly.temperature_2m),
      pop: (wx.hourly.precipitation_probability || []).slice(0, 48),
    } : null,
    opt: { show: opt.show, deg: opt.deg },
  };
}

function seaHourIndex(d, now) {
  return Math.max(0, Math.round((now - new Date(`${d.day0}T00:00:00+09:00`)) / 3600000 - 0.5));
}

const seaMinute = (d, now) => (now - new Date(`${d.day0}T00:00:00+09:00`)) / 60000;

function seaWindow(d, now) {
  const i = seaHourIndex(d, now);
  const from = Math.max(0, Math.min(24, Math.floor((i % 24) / 6) * 6 - 3 + Math.floor(i / 24) * 24));
  const axis = [];
  for (let t = Math.ceil(from / 6) * 6; t <= from + 24; t += 6) axis.push({ text: String(t % 24 === 0 && t > from ? 24 : t % 24), pos: (t - from) / 24 });
  return { from, i, axis };
}

const seaDir = (deg) => (deg == null ? "" : SEA.dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]);

const seaDirText = (d, deg) => (deg == null ? "" : d.opt && d.opt.deg ? `${Math.round(((deg % 360) + 360) % 360)}°` : seaDir(deg));

function seaRange(list, i) {
  const v = list.map((s) => s.v[i]).filter((x) => x != null);
  if (!v.length) return null;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const f = (x) => (x >= 10 ? String(Math.round(x)) : x.toFixed(1));
  return { lo, hi, n: v.length, text: v.length > 1 && f(lo) !== f(hi) ? `${f(lo)}〜${f(hi)}` : f(hi) };
}

function seaFocus(d, i, now) {
  const warns = d.warns || [];
  const tide = !!(d.tide && d.tide.length);
  if (warns.some((w) => /強風|暴風/.test(w))) return "wind";
  if (warns.some((w) => /高潮/.test(w)) && tide) return "tide";
  if (warns.some((w) => /波浪/.test(w))) return "wave";
  const top = (list) => {
    let hi = null;
    for (let k = i; k <= i + SEA.focus.hours; k++) {
      const r = seaRange(list, k);
      if (r && (hi == null || r.hi > hi)) hi = r.hi;
    }
    return hi == null ? 0 : hi;
  };
  if (top(d.winds) >= SEA.focus.windMs) return "wind";
  if (top(d.waves) >= SEA.focus.waveM) return "wave";
  const mz = seaNext(d, now).mazume;
  if (tide && mz && mz.from - seaMinute(d, now) <= 60) return "tide";
  return "wave";
}

function seaNext(d, now) {
  const m = seaMinute(d, now);
  const tide = (d.tideMarks || []).find((t) => t.m >= m) || null;
  const spans = (d.sun || []).flatMap((s) => [
    { k: "朝まづめ", from: s.tw0, to: s.rise + 60 },
    { k: "夕まづめ", from: s.set - 60, to: s.tw1 },
  ]);
  const mazume = spans.find((s) => s.to >= m) || null;
  const clock = (x) => `${Math.floor((x % 1440) / 60)}:${pad2(Math.round(x % 60))}`;
  return {
    tide: tide && { ...tide, text: `${tide.k} ${tide.time}` },
    mazume: mazume && { ...mazume, now: mazume.from <= m, text: `${mazume.k} ${clock(mazume.from)}〜${clock(mazume.to)}` },
  };
}

function seaPaint(theme) {
  const dark = theme.mode === "dark" || theme.mode === "purple" || (theme.mode === "auto" && typeof Device !== "undefined" && Device.isUsingDarkAppearance && Device.isUsingDarkAppearance());
  const hexOf = (c) => (SEA.palette[c] ? SEA.palette[c][dark ? 1 : 0] : c);
  if (theme.mode !== "auto") return { band: theme.track, base: theme.track, ref: theme.sub, now: theme.text, mark: theme.text, line: (c) => (SEA.palette[c] && theme.mode !== "accessory" ? new Color(hexOf(c), theme.alpha) : ink(hexOf(c), theme)) };
  const gray = (a) => new Color("#8E8E93", a * theme.alpha);
  return { band: gray(0.22), base: gray(0.45), ref: gray(0.9), now: gray(1), mark: gray(1), line: (c) => new Color(hexOf(c), theme.alpha) };
}

function seaGraph(w, h, { series, from, i, theme, refs = [], bands = [], marks = [], floor0 = true }) {
  const dc = canvas(w, h);
  const pts = series.map((s) => (s.v || []).map((y, j) => ({ x: j * (s.step || 1) - from, y })).filter((p) => p.x >= -0.01 && p.x <= 24.01 && p.y != null));
  const ys = pts.flat().map((p) => p.y).concat(refs.map((r) => r.y));
  if (!ys.length) return dc.getImage();
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (floor0) lo = Math.min(0, lo);
  if (hi - lo < 1) hi = lo + 1;
  const label = marks.length && h >= 40;
  const pad = label ? 11 : 3;
  const X = (x) => (x / 24) * w;
  const Y = (y) => pad + (h - pad * 2) * (1 - (y - lo) / (hi - lo));
  const paint = seaPaint(theme);
  dc.setFillColor(paint.band);
  bands.forEach((b) => {
    const a = Math.max(0, b.from - from);
    const z = Math.min(24, b.to - from);
    if (z > a) dc.fillRect(new Rect(X(a), 0, X(z) - X(a), h));
  });
  dc.setFillColor(paint.base);
  dc.fillRect(new Rect(0, h - 1, w, 1));
  dc.setFillColor(paint.ref);
  refs.forEach((r) => {
    const y = Y(r.y);
    for (let x = X(Math.max(0, (r.from ?? from) - from)); x < X(Math.min(24, (r.to ?? from + 24) - from)); x += 6) dc.fillRect(new Rect(x, y - 0.75, 3, 1.5));
  });
  pts.forEach((list, k) => {
    if (list.length < 2) return;
    const path = new Path();
    const xy = list.map((p) => [X(p.x), Y(p.y)]);
    if (series[k].dash) {
      let on = true;
      let left = 4;
      for (let n = 1; n < xy.length; n++) {
        let [x0, y0] = xy[n - 1];
        const [x1, y1] = xy[n];
        let len = Math.hypot(x1 - x0, y1 - y0);
        while (len > 1e-6) {
          const step = Math.min(left, len);
          const xs = x0 + ((x1 - x0) * step) / len;
          const ys = y0 + ((y1 - y0) * step) / len;
          if (on) {
            path.move(new Point(x0, y0));
            path.addLine(new Point(xs, ys));
          }
          [x0, y0] = [xs, ys];
          len -= step;
          left -= step;
          if (left <= 1e-6) {
            on = !on;
            left = on ? 4 : 3;
          }
        }
      }
    } else {
      path.move(new Point(xy[0][0], xy[0][1]));
      xy.slice(1).forEach(([x, y]) => path.addLine(new Point(x, y)));
    }
    dc.addPath(path);
    dc.setStrokeColor(series[k].color ? paint.line(series[k].color) : paint.ref);
    dc.setLineWidth(series[k].thin ? 1 : series.length > 1 ? 1.5 : 2);
    dc.strokePath();
  });
  marks.forEach((mk) => {
    const x = mk.m / 60 - from;
    if (x < 0 || x > 24) return;
    dc.setFillColor(paint.mark);
    dc.fillEllipse(new Rect(X(x) - 2, Y(mk.cm) - 2, 4, 4));
    if (!label || !mk.time) return;
    const text = mk.time.replace(/^0/, "");
    const tw = 26;
    const left = Math.max(0, Math.min(w - tw, X(x) - tw / 2));
    const top = mk.k === "満潮" ? Y(mk.cm) - 11 : Y(mk.cm) + 2;
    dc.setFont(Font.mediumSystemFont(8));
    dc.setTextColor(paint.ref);
    dc.setTextAlignedCenter();
    dc.drawTextInRect(text, new Rect(left, top, tw, 10));
  });
  const nx = X(Math.min(24, Math.max(0, i - from)));
  dc.setFillColor(paint.now);
  dc.fillRect(new Rect(nx - 0.5, 0, 1, h));
  return dc.getImage();
}

function seaLegend(box, title, items, size, theme, w) {
  const row = hrow(box, 4);
  txt(row, title, size, theme.sub, "semibold");
  row.addSpacer();
  let room = w - textWidth(title, size) * 1.15 - 16;
  items.forEach((it) => {
    const need = textWidth(it.label, size - 1) * 1.15 + (it.dash ? 18 : 14);
    if (need > room) return;
    room -= need;
    const dot = canvas(it.dash ? 10 : 6, 6);
    dot.setFillColor(it.dash && !it.color ? seaPaint(theme).ref : seaPaint(theme).line(it.color));
    if (it.dash) [0, 4, 8].forEach((x) => dot.fillRect(new Rect(x, 2.25, 2, 1.5)));
    else dot.fillEllipse(new Rect(0, 0, 6, 6));
    const v = row.addImage(dot.getImage());
    v.imageSize = new Size(it.dash ? 10 : 6, 6);
    txt(row, it.label, size - 1, theme.sub, "medium");
  });
}

function seaPlot(box, img, w, h) {
  const view = box.addImage(img);
  view.imageSize = new Size(w, h);
}

function seaNightBands(d) {
  if (!(d.sun || []).length) return [];
  const bands = [{ from: -24, to: 0 }];
  d.sun.forEach((s, k) => {
    bands[bands.length - 1].to = s.rise / 60;
    bands.push({ from: s.set / 60, to: (k + 1) * 24 + 24 });
  });
  return bands;
}

function seaWaveGraph(box, d, ctx, view, w, h) {
  const j = d.jma[Math.floor(view.i / 24)] || d.jma[0];
  const refs = j && j.nums.length ? [{ y: Math.max(...j.nums) }] : [];
  seaPlot(box, seaGraph(w, h, { series: d.waves, from: view.from, i: view.i, theme: ctx.theme, refs, bands: seaNightBands(d) }), w, h);
}

function seaTideGraph(box, d, ctx, view, w, h) {
  const bands = seaNightBands(d);
  const tide = [{ color: SEA.tideColor, step: 1 / 3, v: d.tide.map((p) => p.cm) }];
  seaPlot(box, seaGraph(w, h, { series: tide, from: view.from, i: view.i, theme: ctx.theme, bands, marks: d.tideMarks, floor0: false }), w, h);
}

const SEA_ARROW_H = 14;

function seaMeanDir(winds, k) {
  const list = winds.map((m) => ({ sp: m.v[k], dir: m.dir && m.dir[k] })).filter((x) => x.sp != null && x.dir != null);
  if (!list.length) return null;
  const r = Math.PI / 180;
  const x = list.reduce((a, m) => a + m.sp * Math.sin(m.dir * r), 0) / list.length;
  const y = list.reduce((a, m) => a + m.sp * Math.cos(m.dir * r), 0) / list.length;
  const mean = ((Math.atan2(x, y) / r) % 360 + 360) % 360;
  const spread = Math.max(...list.map((m) => Math.abs((((m.dir - mean) % 360) + 540) % 360 - 180)));
  return { deg: mean, spread, calm: Math.hypot(x, y) < 0.5 };
}

function seaWindArrows(box, d, ctx, view, w) {
  const h = SEA_ARROW_H;
  const dc = canvas(w, h);
  const paint = seaPaint(ctx.theme);
  const r = Math.PI / 180;
  for (let t = Math.ceil(view.from / 3) * 3; t <= view.from + 24; t += 3) {
    const m = seaMeanDir(d.winds, t);
    if (!m) continue;
    const cx = Math.max(h / 2, Math.min(w - h / 2, ((t - view.from) / 24) * w));
    const cy = h / 2;
    const color = m.spread > 45 || m.calm ? paint.base : paint.now;
    if (m.calm) {
      dc.setFillColor(color);
      dc.fillEllipse(new Rect(cx - 1.5, cy - 1.5, 3, 3));
      continue;
    }
    const c = Math.cos(m.deg * r);
    const sn = Math.sin(m.deg * r);
    const P = (x, y) => new Point(cx + x * c - y * sn, cy + x * sn + y * c);
    const L = h / 2 - 1.5;
    const path = new Path();
    path.move(P(0, -L));
    path.addLine(P(0, L));
    path.move(P(-3.5, L - 3.5));
    path.addLine(P(0, L));
    path.addLine(P(3.5, L - 3.5));
    dc.addPath(path);
    dc.setStrokeColor(color);
    dc.setLineWidth(1.5);
    dc.strokePath();
  }
  seaPlot(box, dc.getImage(), w, h);
}

defineCard("sea", {
  icon: "🌊",
  label: "海",
  aliases: ["umi", "marine", "海", "波", "釣り"],
  help: `波・風・潮をグラフで（sea:城ヶ島 / sea:20.4253,136.0814 / 空なら今いる場所 / sea:城ヶ島,wave,wind で出すものを選ぶ（wave 波・tide 潮・wind 風） / deg で風の向きを角度に / 小で出すものを書かなければ、そのとき大事な1つ（警報・強い風・高い波・まづめ） / 磯割のある島（鵜来島）は、下の行に渡船ごとのその日の磯（12時からはあす）。sea:鵜来島,家中 で渡船を選ぶ（いくつでも）。アプリの「🌊 海の Parameter を作る」で作れる）。${SEA.names.jma}の波の文と警報・注意報、近い港の${SEA.names.tide}を先に、緯度経度で読む波4つ・風4つの予報をあとに。押すと${SEA.names.page}が開く`,
  keep: (d) => d,
  load: loadSea,
  refreshAt(d, ctx) {
    return new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate(), ctx.now.getHours() + 1, 1);
  },
  url(d) {
    if (!d) return SEA.page;
    const at = `${d.lat.toFixed(4)},${d.lon.toFixed(4)}`;
    return `${SEA.page}?q=${encodeURIComponent(d.name && !/^-?\d/.test(d.name) ? `${at}=${d.name}` : at)}`;
  },
  inline(d, ctx) {
    const i = seaHourIndex(d, ctx.now);
    const wv = seaRange(d.waves, i);
    const wd = seaRange(d.winds, i);
    return `🌊${wv ? `${wv.text}m` : "—"} 💨${seaDirText(d, d.windDir[i])}${wd ? `${Math.round(wd.hi)}m` : ""}`;
  },
  badge(d, ctx) {
    const wv = seaRange(d.waves, seaHourIndex(d, ctx.now));
    return { top: "🌊", main: wv ? wv.hi.toFixed(1) : "—" };
  },
  speak(d, ctx) {
    const i = seaHourIndex(d, ctx.now);
    const wv = seaRange(d.waves, i);
    const wd = seaRange(d.winds, i);
    const next = seaNext(d, ctx.now);
    return `${d.name}の波は${wv ? `${wv.text.replace("〜", "から")}メートル` : "わかりません"}、風は${seaDir(d.windDir[i])}${wd ? `${wd.text.replace("〜", "から")}メートル` : ""}。${next.tide ? `つぎの${next.tide.k}は${next.tide.time}` : ""}`;
  },
  render(box, d, ctx) {
    const { theme, tier, now, w, h } = ctx;
    const look = (list, conf) => conf.map((c) => ({ ...(list.find((m) => m.key === c.key) || { v: [], dir: [] }), ...c }));
    d = { ...d, waves: look(d.waves, SEA.waves), winds: look(d.winds, SEA.winds) };
    const view = seaWindow(d, now);
    const i = view.i;
    const wv = seaRange(d.waves, i);
    const wd = seaRange(d.winds, i);
    const j = d.jma[0];
    const next = seaNext(d, now);
    const warnColor = theme.warn;
    const waveText = wv ? wv.text : "—";
    const windText = `${seaDirText(d, d.windDir[i])} ${wd ? wd.text : "—"}`;
    const windShort = `${seaDirText(d, d.windDir[i])} ${wd ? (wd.hi >= 10 ? Math.round(wd.hi) : wd.hi.toFixed(1)) : "—"}`;
    const place = shortPlace(d.name);

    if (ctx.accessory && tier !== "s") {
      const top = hrow(box, 4);
      txt(top, "🌊", 11, theme.text);
      txt(top, `${waveText}m`, 13, theme.text, "bold");
      top.addSpacer();
      txt(top, place, 9, theme.sub, "semibold", { scale: 0.6 });
      const mean = d.waves[0].v.map((_, k) => {
        const v = d.waves.map((s) => s.v[k]).filter((x) => x != null);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
      });
      const gh = Math.max(10, h - 34);
      seaPlot(box, seaGraph(w, gh, { series: [{ color: "#FFFFFF", v: mean }], from: view.from, i, theme }), w, gh);
      txt(box, `💨${windText}m${next.tide ? ` ${next.tide.text}` : ""}`, 9, theme.sub, "semibold", { scale: 0.6 });
      return;
    }
    if (tier === "s") {
      const oneLine = 12 + textWidth(`${waveText}m`, 13) * 1.15 + textWidth(`${windShort}m`, 11) * 1.15 + 26 <= w;
      const row = hrow(box, 6);
      txt(row, "🌊", 12, theme.text);
      txt(row, `${waveText}m`, 13, theme.text, "bold", { scale: 0.5 });
      row.addSpacer();
      if (oneLine) txt(row, `${windShort}m`, 11, theme.sub, "semibold", { scale: 0.6 });
      if (h >= 40) {
        const line = !oneLine ? `💨 ${windShort}m${d.warns.length ? ` ⚠️ ${d.warns[0]}` : ""}` : d.warns.length ? `⚠️ ${d.warns[0]}` : place;
        txt(box, line, 10, d.warns.length ? warnColor : theme.sub, "semibold", { scale: 0.6 });
      }
      return;
    }

    const head = hrow(box, 4);
    txt(head, place, tier === "l" ? 12 : 11, theme.sub, "semibold", { scale: 0.6 });
    head.addSpacer();
    if (d.warns.length) txt(head, `⚠️ ${d.warns.length > 1 ? `${d.warns[0]} ほか` : d.warns[0]}`, 9, warnColor, "bold", { scale: 0.6 });
    const wx = d.wx && d.wx.code[i] != null ? d.wx : null;
    if (wx && (w >= 250 || !d.warns.length)) {
      const [emoji] = wmo(wx.code[i], wx.day[i]);
      const pop = wx.pop[i] != null ? `☔${wx.pop[i]}%` : "";
      const temp = wx.temp[i] != null ? `${Math.round(wx.temp[i])}°` : "";
      txt(head, emoji, tier === "l" ? 11 : 10, theme.text);
      txt(head, w >= 250 ? `${temp} ${pop}`.trim() : pop, tier === "l" ? 11 : 10, theme.sub, "semibold", { scale: 0.6 });
    }

    const big = isBig(ctx);
    const wide = w >= 250;
    const main = hrow(box, 6);
    const fullSize = big && wide ? 26 : wide ? 20 : w < 110 ? 11 : w < 150 ? 13 : 16;
    const subSize = big ? 13 : 11;
    const jmaText = j && j.nums.length && big && wide ? `${SEA.names.jma} ${Math.max(...j.nums)}m` : "";
    const rowW = (jt, wt, size) => 24 + textWidth(wt, size) * 1.1 + 30 +
      (wide ? (jt ? textWidth(jt, 10) * 1.1 + 6 : 0) + 8 + subSize + 6 + textWidth(`${waveText}m`, subSize) * 1.1 : 0);
    const sizes = [1, 0.85, 0.75, 0.7].map((f) => Math.round(fullSize * f));
    const texts = !wide && w < 160 ? [windShort] : [windText, windShort];
    const tries = texts.flatMap((t) => sizes.map((size) => ({ t, size })));
    const fit = tries.find((x) => rowW("", x.t, x.size) <= w) || tries[tries.length - 1];
    const windMain = fit.t;
    const bigSize = fit.size;
    const showJma = jmaText && rowW(jmaText, windMain, bigSize) <= w;
    txt(main, "💨", big ? 15 : 12, theme.text);
    txt(main, windMain, bigSize, theme.text, "round", { scale: 0.5 });
    txt(main, "m/s", 11, theme.sub, "medium");
    main.addSpacer();
    if (wide) {
      if (showJma) txt(main, jmaText, 10, theme.sub, "semibold", { scale: 0.7 });
      txt(main, "🌊", subSize, theme.text);
      txt(main, `${waveText}m`, subSize, theme.text, "semibold", { scale: 0.6 });
    } else {
      txt(box, `🌊 ${waveText}m`, 10, theme.sub, "semibold", { scale: 0.6 });
    }
    const wxLine = big && wide && j && j.weather;
    if (wxLine) txt(box, `${SEA.names.jma} ${j.weather}`, 10, theme.sub, "semibold", { scale: 0.6 });

    const iso = seaIsoLine(d, now);
    const isoRow = !!iso && wide;
    const footH = isoRow ? 28 : 14;
    const axisH = 11;
    const legendH = 12;
    const room = h - (big && wide ? 54 + (wxLine ? 14 : 0) : wide ? 46 : 58) - footH - axisH;
    const waveItems = [...d.waves, ...(j && j.nums.length ? [{ label: SEA.names.jma, dash: true }] : [])];
    const tideBase = d.port ? `潮 ${d.port.name}${d.moon ? `・${d.moon}` : ""}` : "潮";
    const tideTitle = (cw) => {
      const full = d.tideRange != null ? `${tideBase}・${SEA.tideRangeText(d.tideRange)}` : tideBase;
      return textWidth(full, 9) * 1.15 + 8 <= cw ? full : tideBase;
    };
    const gustLine = (d.gust || []).some((v) => v != null) ? [{ label: "突風", dash: true, thin: true, v: d.gust }] : [];
    const extra = (g) => (g === "wind" ? SEA_ARROW_H + 2 : 0);
    const drawOne = (col, g, cw, gh, keys = true) => {
      if (g === "wave") {
        seaLegend(col, "波 m", keys ? waveItems : [], 9, theme, cw);
        seaWaveGraph(col, d, ctx, view, cw, gh);
      } else if (g === "tide") {
        seaLegend(col, tideTitle(cw), [], 9, theme, cw);
        if (d.tide.length) seaTideGraph(col, d, ctx, view, cw, gh);
        else txt(col, `${SEA.names.tide}は日本の港だけ`, 9, theme.sub, "medium");
      } else {
        seaLegend(col, "風 m/s", keys ? [...d.winds.filter((m) => m.v.some((v) => v != null)), ...gustLine] : [], 9, theme, cw);
        seaPlot(col, seaGraph(cw, gh - extra(g), { series: [...d.winds, ...gustLine], from: view.from, i, theme, bands: seaNightBands(d) }), cw, gh - extra(g));
        col.addSpacer(2);
        seaWindArrows(col, d, ctx, view, cw);
      }
    };
    const chosen = d.opt && d.opt.show && d.opt.show.length ? d.opt.show : null;
    const auto = (big ? ["tide", "wave", "wind"] : wide ? ["tide", "wave"] : [seaFocus(d, i, now)]).filter((g) => g !== "tide" || d.tide.length || !wide);
    const items = chosen || auto;
    box.addSpacer(4);
    if (room < legendH + 16) {
    } else if (wide && !big && items.length >= 2) {
      const cw = Math.floor((w - 12) / 2);
      const gh = Math.max(16 + SEA_ARROW_H + 2, room - legendH - 2);
      const row = box.addStack();
      row.layoutHorizontally();
      row.spacing = 12;
      items.slice(0, 2).forEach((g) => {
        const col = row.addStack();
        col.layoutVertically();
        col.size = new Size(cw, 0);
        drawOne(col, g, cw, gh, false);
        col.addSpacer(2);
        hourAxis(col, view.axis, cw, 8, theme);
      });
    } else {
      const shown = [];
      let need = 0;
      for (const g of items) {
        const n = legendH + 26 + extra(g);
        if (shown.length && need + n > room + axisH) break;
        shown.push(g);
        need += n;
      }
      const fixed = shown.reduce((a, g) => a + extra(g), 0);
      const gh = Math.max(16, Math.floor((room - fixed) / shown.length - legendH - 2));
      shown.forEach((g, k) => {
        drawOne(box, g, w, gh + extra(g));
        box.addSpacer(2);
        if (k === shown.length - 1) hourAxis(box, view.axis, w, 8, theme);
      });
    }
    box.addSpacer();
    const foot = hrow(box, 8);
    const gust = (d.gust || [])[i];
    const cur = d.current && d.current.kn[i] != null ? `流れ ${d.current.dir[i] == null ? "" : `${seaDirText(d, d.current.dir[i])}へ`}${d.current.kn[i].toFixed(1)}kn` : "";
    const parts = [next.tide && next.tide.text, next.mazume && (next.mazume.now ? `いま${next.mazume.k}` : next.mazume.text), gust != null ? `突風 ${gust}m/s` : "", cur, (d.sst || [])[i] != null && w >= 280 ? `水温 ${Math.round(d.sst[i])}℃` : ""].filter(Boolean);
    let left = w;
    parts.forEach((p) => {
      if (textWidth(p, 9) + 8 > left) return;
      left -= textWidth(p, 9) + 8;
      txt(foot, p, 9, theme.sub, "semibold", { scale: 0.7 });
    });
    if (iso && !isoRow && left > 0) seaIsoDraw(foot, iso, left, theme);
    if (isoRow) {
      box.addSpacer(2);
      seaIsoDraw(hrow(box, 8), iso, w, theme);
    }
  },
});

async function copyParam(param) {
  Pasteboard.copyString(param);
  await say("コピーしました", param);
}

async function say(title, message = "") {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addAction("OK");
  await a.presentAlert();
}

async function seaMenu() {
  const last = readCache("sea_menu") || {};
  const ask = new Alert();
  ask.title = "🌊 海（sea）の場所";
  ask.message = "港の名前・地名・緯度経度（例：城ヶ島 / 鴨川 / 20.4253,136.0814）。空なら今いる場所";
  ask.addTextField("城ヶ島", last.place || "");
  ask.addAction("次へ");
  ask.addCancelAction("やめる");
  if ((await ask.presentAlert()) < 0) return;
  const place = ask.textFieldValue(0).replace(/[（(）)]/g, "").replace(/[，、]/g, ",").replace(/\s*,\s*/g, ",").trim().replace(/\s+/g, "_");
  const sets = [
    ["おまかせ（大きさに合わせる）", []],
    ["潮と波", ["tide", "wave"]],
    ["風のグラフだけ", ["wind"]],
    ["波と風", ["wave", "wind"]],
    ["潮と風", ["tide", "wind"]],
    ["潮・波・風", ["tide", "wave", "wind"]],
  ];
  const pick = new Alert();
  pick.title = "出すもの";
  pick.message = "書いた順に、上から（中は2つを横に）";
  sets.forEach(([name]) => pick.addAction(name));
  pick.addCancelAction("やめる");
  const k = await pick.presentAlert();
  if (k < 0) return;
  const dir = new Alert();
  dir.title = "風の向き";
  dir.addAction("16方位（北北西）");
  dir.addAction("角度（331°）");
  dir.addCancelAction("やめる");
  const g = await dir.presentAlert();
  if (g < 0) return;
  const parts = [place, ...sets[k][1], g === 1 ? "deg" : ""].filter(Boolean);
  const param = parts.length ? `sea:${parts.join(",")}` : "sea";
  writeCache("sea_menu", { place });
  const families = ["small", "medium", "large"];
  for (;;) {
    const size = new Alert();
    size.title = "見たい大きさ";
    size.message = param;
    families.forEach((f) => size.addAction(FAMILIES[f].name));
    size.addAction("📋 Parameter をコピー");
    size.addCancelAction("おわる");
    const i = await size.presentAlert();
    if (i < 0) return;
    if (i === families.length) {
      await copyParam(param);
      return;
    }
    const widget = await buildWidget(param, families[i]);
    await widget[FAMILIES[families[i]].present]();
  }
}


async function buildWidget(raw, family) {
  const arg = String(raw || "").trim().replace(/^(sea|海)([:.：]|$)/i, "");
  const ctx = { now: new Date(), theme: makeTheme({}), faded: makeTheme({}, FADE), family, types: new Set(["sea"]) };
  ctx.onDark = { theme: onColorTheme({}, 1), faded: onColorTheme({}, FADE) };
  const widget = new ListWidget();
  const item = { type: "sea", arg };
  await loadItems([item], ctx);
  widget.refreshAfterDate = nextRefresh([item], ctx);
  const url = itemUrl(item, ctx);
  if (url) widget.url = url;
  if (isAccessory(family)) buildAccessory(widget, [item], ctx);
  else buildTiles(widget, [[item]], ctx);
  return widget;
}

function cardPhoto() { return null; }
function cardBackground() { return null; }
function cardTint() { return null; }
function gradient() { return null; }
function tintedTile(hex, theme) { return theme.tile; }

function seaParam(raw) {
  const text = String(raw || "").trim();
  if (!text) return "sea";
  return /^(sea|海)([:.：]|$)/i.test(text) ? text : `sea:${text.replace(/\s+/g, "")}`;
}

async function seaUpdateCheck() {
  try {
    const v = await getJSON(`${SEA.page}sea-version.json`, "sea_version.json", 60 * 12);
    if (!v || !v.build || v.build === SEA_BUILD) return;
    const told = readCache("sea_version_told");
    if (told && told.build === v.build) return;
    const n = new Notification();
    n.title = `${SEA.names.page}のウィジェットに新しい版があります`;
    n.body = "押すと入れ方のページが開きます。スクリプトをコピーして、いまのスクリプトに上書きしてください";
    n.openURL = `${SEA.page}#howto`;
    await n.schedule();
    writeCache("sea_version_told", { build: v.build });
  } catch (e) {
  }
}

async function seaOnlyRun() {
  await seaUpdateCheck();
  if (config.runsInWidget || config.runsInAccessoryWidget) {
    const widget = await buildWidget(seaParam(args.widgetParameter), config.widgetFamily || "large");
    Script.setWidget(widget);
  } else {
    await seaMenu();
  }
  Script.complete();
}

await seaOnlyRun();
