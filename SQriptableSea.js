// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: water;

// ======================================
// うみくる（UmiQru）のウィジェット
// ウィジェットの Parameter に場所を書くと、その場所の波・風・潮・天気が出ます（例：城ヶ島 / 32.7987,132.4959）。
// 新しい版が出ると通知で知らせます。入れかえ方は https://katsuan.github.io/umiqru/#howto
// ======================================

// この版の番号（新しい版が出たかを、ページの sea-version.json とくらべる）
const SEA_BUILD = "605910b9e2";

const PALETTE = {
  brand: "#6C47FF", // ConneQt の紫
  warn: "#E5534B", // 日曜・祝日
  saturday: "#3D7BE0",
  moonLit: "#F6E7A8",
  moonDark: "#3A3550",
};

/** 読めずに前の中身を出すときの濃さ */

const FADE = 0.45;

/**
 * サイズごとの名前・アプリでの見せ方と、置ける数の上限
 * （maxLines … 段の数 / perLine … 1段の枚数 / maxCards … ロック画面の枚数）
 */

const FAMILIES = {
  small: { name: "小", maxLines: 3, perLine: 2, present: "presentSmall" },
  medium: { name: "中", maxLines: 3, perLine: 4, present: "presentMedium" },
  large: { name: "大", maxLines: 7, perLine: 4, present: "presentLarge" },
  extraLarge: { name: "特大", maxLines: 7, perLine: 8, present: "presentExtraLarge" },
  accessoryRectangular: { name: "ロック画面（長方形）", maxCards: 3, present: "presentAccessoryRectangular" },
  accessoryInline: { name: "ロック画面（1行）", maxCards: 2, present: "presentAccessoryInline" },
  accessoryCircular: { name: "ロック画面（丸）", maxCards: 1, present: "presentAccessoryCircular" },
};

function parseParams(raw, family) {
  let text = String(raw || "").trim();
  const opts = {};
  if (text.startsWith("{")) {
    try {
      const { cards, ...rest } = JSON.parse(text);
      Object.assign(opts, rest);
      text = Array.isArray(cards) ? cards.join(" ") : String(cards || "");
    } catch (e) {
      return { lines: [[{ type: "json", arg: "", hint: "「{」から始まる書き方を見直してね" }]], opts };
    }
  }
  // 空なら、カードを1枚ランダムに
  if (!text) text = "random";

  const lines = [[]];
  for (const word of text.split(/[\s|]+/).filter(Boolean)) {
    if (word === "/" || word === "／") {
      lines.push([]);
      continue;
    }
    // カード名と設定の区切りは「:」。iPhone で「:」の入った Parameter が残らないことがあるので、
    // 「.」と全角の「：」でもよい（いちばん前の1つだけを区切りに使う：weather.34.58,133.77）
    const sep = word.search(/[:：.]/);
    const head = sep < 0 ? word : word.slice(0, sep);
    const arg = sep < 0 ? "" : word.slice(sep + 1);
    const eq = head.indexOf("=");
    if (eq > 0) {
      opts[head.slice(0, eq).toLowerCase()] = word.slice(eq + 1);
      continue;
    }
    const names = head.split(",").filter(Boolean);
    names.forEach((name, i) => {
      const item = { type: cardName(name), arg: i === names.length - 1 ? arg : "" };
      lines[lines.length - 1].push(item.type === "random" ? pickRandomCard(item.arg, family, lines.flat().length) : item);
    });
  }
  return { lines: lines.filter((line) => line.length), opts };
}

/**
 * 空のときや random のときに出す候補。設定なしでも必ず出せるカードだけ（cd・memo は設定が要るので入れない）。
 * 端末の許可が要るカードは、許可が取れているとき（PERM_CARDS）だけ足す
 */

const RANDOM_POOL = ["date", "calendar", "clock", "omikuji", "holiday", "progress", "moon", "pomo", "topic", "pokemon", "quest", "q"];

/** 許可ごとの、設定なしで出せるカード（位置情報 → 今いる場所の天気・気圧・日の出入り など） */

const PERM_CARDS = { location: ["weather", "pressure", "sun"], calendar: ["agenda"], reminders: ["todo"], contacts: ["bday"] };

/** いま許可が取れていて、ランダム・おまかせに足せるカード */

function permittedCards() {
  return Object.entries(PERM_CARDS).flatMap(([perm, cards]) => ((permState(perm) || {}).state === "ok" ? cards : []));
}

/** random:moon,pokemon のように候補を選べる。前回と同じカードは続けて出さない */

function pickRandomCard(arg, family, slot) {
  const wanted = String(arg || "").split(",").filter(Boolean).map(cardName);
  const unknown = wanted.filter((name) => !CARDS[name] || name === "random");
  if (unknown.length) return { type: "random", arg, hint: `「${unknown[0]}」というカードはありません（random:moon,pokemon のように）` };
  let pool = wanted.length ? wanted : [...RANDOM_POOL, ...permittedCards()];
  // ロック画面では、アイコンを並べるだけの q は小さすぎる
  if (!wanted.length && isAccessory(family)) pool = pool.filter((name) => name !== "q");
  return { type: pickNotLast(`last_random_${family}_${slot}`, pool), arg: "" };
}

/** pool から1つランダムに。前に key で選んだものは続けて出さない（1つしかなければそれ） */

function pickNotLast(key, pool) {
  const last = readCache(key);
  const choices = pool.length > 1 ? pool.filter((x) => x !== last) : pool;
  const pick = choices[Math.floor(Math.random() * choices.length)];
  writeCache(key, pick);
  return pick;
}

// ---------- dash（おまかせの並び） ----------
// Parameter を dash にすると、カードの数・段・列・カードの設定を毎回ランダムに決める。
// 押すと、いま出ている並びの Parameter が出て、コピーできる（気に入ったらそれを Parameter に）

/** カードごとに、ランダムに選ぶ設定（"" は設定なし）。許可が要るカードは、許可が取れているとき（permittedCards）か dash:weather のように選んだときだけ */

const DASH_VARIANTS = {
  date: ["", "", "en"],
  calendar: ["", "2w", "1w", "en"],
  clock: ["", "hm", "en"],
  omikuji: [""],
  holiday: [""],
  progress: [""],
  moon: [""],
  pomo: ["", "50/10"],
  topic: [""],
  penalty: [""],
  pokemon: ["", "bg", "bg", "en", "bg,en"],
  ball: [""],
  quest: [""],
  q: [""],
};

/** 大きさごとの並べ方の上限（見やすさで決める。Parameter で書ける上限より少なめ） */

const DASH_SHAPES = {
  small: { rows: 2, perRow: 2, max: 3 },
  medium: { rows: 2, perRow: 3, max: 6 },
  large: { rows: 4, perRow: 3, max: 8 },
  extraLarge: { rows: 4, perRow: 4, max: 12 },
  accessoryRectangular: { rows: 1, perRow: 3, max: 3 },
  accessoryInline: { rows: 1, perRow: 2, max: 2 },
  accessoryCircular: { rows: 1, perRow: 1, max: 1 },
};

const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** dash の Parameter（dash / dash:moon,pokemon,weather / dash theme=dark）なら { pool, rest }、ちがえば null */

function dashRequest(raw) {
  const m = /^(?:dash|おまかせ)(?:[:：.](\S*))?(?:\s+(.*))?$/i.exec(String(raw || "").trim());
  if (!m) return null;
  const wanted = String(m[1] || "").split(",").filter(Boolean).map(cardName);
  return { wanted, rest: (m[2] || "").trim() };
}

/**
 * おまかせの並びを1つ作って、その Parameter を返す。
 * 区切りは「.」（iPhone のウィジェットの設定で「:」の入った Parameter が残らないことがあるので、そのまま貼れるように）
 */

function makeDashParam(req, family) {
  const shape = DASH_SHAPES[family] || DASH_SHAPES.medium;
  const unknown = req.wanted.filter((name) => !CARDS[name]);
  if (unknown.length) return { hint: `「${unknown[0]}」というカードはありません（dash:moon,pokemon のように）` };
  let pool = req.wanted.length ? req.wanted : [...Object.keys(DASH_VARIANTS), ...permittedCards()];
  // ロック画面は字と絵が小さいので、アイコンを並べるだけの q・家事クエストのボタンは外す
  if (!req.wanted.length && isAccessory(family)) pool = pool.filter((name) => !["q", "quest", "calendar"].includes(name));
  // 同じカードは2枚出さない
  const total = randInt(1, Math.min(shape.max, pool.length));
  const cards = shuffle(pool).slice(0, total).map((name) => {
    const arg = pickOne(DASH_VARIANTS[name] || [""]);
    return arg ? `${name}.${arg}` : name;
  });
  // 段の数を決めて、カードを段に分ける（どの段にも1枚以上、1段 perRow 枚まで）
  const rowsMin = Math.ceil(total / shape.perRow);
  const rows = randInt(rowsMin, Math.min(shape.rows, total));
  const counts = Array(rows).fill(1);
  for (let left = total - rows; left > 0; left--) {
    const open = counts.map((c, i) => (c < shape.perRow ? i : -1)).filter((i) => i >= 0);
    counts[pickOne(open)]++;
  }
  let at = 0;
  const lines = counts.map((c) => cards.slice(at, (at += c)).join(" "));
  const extra = [];
  // ときどき枠ありで（Parameter に tile= を書いたときはそのまま）
  if (!/(^|\s)tile=/.test(req.rest) && !isAccessory(family) && total > 1 && Math.random() < 0.3) extra.push("tile=on");
  if (req.rest) extra.push(req.rest);
  return { param: [lines.join(" / "), ...extra].join(" ") };
}

const THEMES = {
  light: { bg: "#F4F2FB", tile: "#FFFFFF", text: "#1B1730", sub: "#6B6585", track: "#E6E2F3" },
  dark: { bg: "#121018", tile: "#1F1C29", text: "#F4F2FA", sub: "#A49EB9", track: "#2E2A3B" },
  purple: { bg: "#2A1A6E", tile: "#3B2A8C", text: "#FFFFFF", sub: "#CFC4FF", track: "#5240A8" },
};

/**
 * 色をまとめる。alpha を 1 より小さくすると、字と線が薄くなる（背景はそのまま）。
 * theme=auto（ふつう）は端末のライト・ダークに合わせる
 */

function makeTheme(opts, alpha = 1) {
  const name = String(opts.theme || "").toLowerCase();
  const mode = THEMES[name] ? name : "auto";
  // tiles … ふつうは枠なし。tile=on で枠をつける（tile=auto は2枚以上のときだけ）
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

/** ロック画面では色が付け直されるので、白の濃淡だけにする */

function accessoryTheme(alpha = 1) {
  const white = (a) => new Color("#FFFFFF", a * alpha);
  return { mode: "accessory", alpha, text: white(1), sub: white(0.7), track: white(0.25), accent: white(1), warn: white(1), tiles: false };
}

// ---------- 色 ----------

function hexToRgb(hex) {
  const n = parseInt(String(hex).replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
  return "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** 明るさ（0 黒〜1 白） */

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * その背景の上で読める濃さにした色。明るい背景では暗く、暗い背景では明るく、少しずつ寄せる。
 * ツールの色そのものは変えず、濃い色・薄い色をそこから作る（A2）
 */

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

/** その色を塗った上に置く字の色（明るい色なら濃い字、暗い色なら白） */

function ink(hex, theme) {
  if (theme.mode === "accessory") return theme.accent;
  const color = (mode) => new Color(readable(hex, mode), theme.alpha);
  if (theme.mode === "auto") return Color.dynamic(color("light"), color("dark"));
  return color(theme.mode);
}

// ======================================
// ウィジェットの組み立て
// ======================================

async function buildWidget(raw, family, flags = {}) {
  // @7 … 時刻で切り替わる並び。いまの時刻の並びで描き、次の切りかえで描き直す
  const timed = pickTimeSection(raw, new Date());
  if (timed) {
    const widget = await buildWidget(timed.text, family, flags);
    if (!widget.refreshAfterDate || widget.refreshAfterDate > timed.nextAt) widget.refreshAfterDate = timed.nextAt;
    return widget;
  }
  // dash … おまかせの並び。作った Parameter で描き、押すとその Parameter が出る
  const dash = dashRequest(raw);
  if (dash) return buildDashWidget(dash, family);
  const { lines, opts } = parseParams(raw, family);
  // types … このウィジェットに置いたカード（ほかのカードと同じことを出さないため）
  const types = new Set(lines.flat().map((item) => item.type));
  // noLinks … カードごとの行き先をつけない（dash）
  const ctx = { now: new Date(), theme: makeTheme(opts), faded: makeTheme(opts, FADE), family, types, noLinks: !!flags.noLinks };
  ctx.onDark = { theme: onColorTheme(opts, 1), faded: onColorTheme(opts, FADE) };
  const widget = new ListWidget();
  const tooMany = overLimit(lines, family);
  if (tooMany) {
    buildHintWidget(widget, tooMany, ctx);
    return widget;
  }
  const items = lines.flat();
  await loadItems(items, ctx);

  widget.refreshAfterDate = nextRefresh(items, ctx);
  // 小さいウィジェットとロック画面は、押せるところが全体で1つだけ。先頭のツールを開く
  if (family === "small" || isAccessory(family)) {
    const url = items.map((item) => itemUrl(item, ctx)).find(Boolean);
    if (url) widget.url = url;
  }
  if (isAccessory(family)) {
    buildAccessory(widget, items, ctx);
  } else {
    buildTiles(widget, arrange(lines, family), ctx);
  }
  return widget;
}

/** おまかせの並び（dash）。並びを作って描き、押すとその Parameter が出る */

async function buildDashWidget(dash, family) {
  const made = makeDashParam(dash, family);
  if (made.hint) {
    const widget = new ListWidget();
    buildHintWidget(widget, made.hint, { now: new Date(), theme: makeTheme({}), faded: makeTheme({}, FADE), family, types: new Set() });
    return widget;
  }
  writeCache(`last_dash_${family}`, { param: made.param });
  const widget = await buildWidget(made.param, family, { noLinks: true });
  widget.dashParam = made.param;
  // カードごとの行き先は消して、どこを押してもこの並びの Parameter が出るように
  widget.url = actionUrl("dash", { p: made.param, f: family });
  return widget;
}

/**
 * 背景を塗るカード（pokemon:bg・写真など）の上の色。ダークの色で描き、
 * 小さい字や線は白を透かして、明るい色（2タイプのグラデーションのまん中など）の上でも読めるように
 */

function onColorTheme(opts, alpha) {
  return {
    ...makeTheme({ ...opts, theme: "dark" }, alpha),
    text: new Color("#FFFFFF", alpha),
    sub: new Color("#FFFFFF", 0.82 * alpha),
    track: new Color("#FFFFFF", 0.28),
    accent: new Color("#FFFFFF", alpha),
  };
}

// ---------- 時刻で切り替わる並び（@7 date weather @12 pomo progress @18 moon） ----------
// 「@時」「@時:分」で区切ると、その時刻からその並びに変わる。「@平日7」「@土日9」で曜日も分けられる。
// いちばん前の「@」より前に書いたカードは、どの区切りにも当てはまらないとき（朝の前など）に出す。
// ウィジェットの描き直しは時刻ちょうどではないので、切りかえが少し遅れることがある（並びが変わるだけ）。

const TIME_TAG = /^@(平日|土日|weekday|weekend)?(\d{1,2})(?:[:：](\d{2}))?$/i;

/** いまの時刻の並び { text, nextAt }。「@」の区切りがなければ null */

function pickTimeSection(raw, now) {
  const text = String(raw || "").trim();
  if (!text || text.startsWith("{")) return null;
  const words = text.split(/\s+/);
  if (!words.some((w) => TIME_TAG.test(w))) return null;
  const base = [];
  const sections = [];
  for (const w of words) {
    const m = w.match(TIME_TAG);
    if (m) {
      const kind = !m[1] ? "all" : /平日|weekday/i.test(m[1]) ? "weekday" : "weekend";
      sections.push({ kind, min: Math.min(23, Number(m[2])) * 60 + Math.min(59, Number(m[3] || 0)), words: [] });
    } else if (sections.length) sections[sections.length - 1].words.push(w);
    else base.push(w);
  }
  const dayKind = (d) => (d.getDay() === 0 || d.getDay() === 6 ? "weekend" : "weekday");
  const fits = (sec, d) => sec.kind === "all" || sec.kind === dayKind(d);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = sections.filter((sec) => fits(sec, now)).sort((a, b) => a.min - b.min);
  const current = today.filter((sec) => sec.min <= nowMin).pop();
  let words2;
  if (current) words2 = current.words;
  else if (base.length) words2 = base;
  else {
    // 朝の区切りの前は、前の日の最後の並び
    const y = addDays(now, -1);
    const last = sections.filter((sec) => fits(sec, y)).sort((a, b) => a.min - b.min).pop();
    words2 = last ? last.words : [];
  }
  const next = today.find((sec) => sec.min > nowMin);
  const nextAt = next
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(next.min / 60), next.min % 60)
    : justAfterMidnight(now);
  return { text: words2.join(" "), nextAt };
}

/** カードが多すぎるとき、直し方の文（多すぎなければ ""）。黙って切り捨てない */

function overLimit(lines, family) {
  const f = FAMILIES[family] || FAMILIES.medium;
  if (isAccessory(family)) {
    const count = lines.flat().length;
    // ロック画面は字が入らないので短く
    if (count <= f.maxCards) return "";
    return family === "accessoryCircular" ? `${f.maxCards}枚まで` : `カードは${f.maxCards}枚まで（いま${count}枚）`;
  }
  const arranged = arrange(lines, family);
  const widest = Math.max(...arranged.map((line) => line.length));
  if (arranged.length <= f.maxLines && widest <= f.perLine) return "";
  const now = arranged.length > f.maxLines ? `いま${arranged.length}段` : `いま1段に${widest}枚`;
  return `カードが多すぎます。${f.name}は${f.maxLines}段・1段${f.perLine}枚まで（${now}）。「/」で段を分けられます`;
}

/** ウィジェット全体を、書き方の直し方だけにする */

function buildHintWidget(widget, hint, ctx) {
  const item = { type: "SQriptable", hint };
  if (ctx.family === "accessoryInline") {
    widget.addText(`✏️ ${hint}`);
    return;
  }
  if (isAccessory(ctx.family)) {
    const theme = accessoryTheme();
    if (ctx.family === "accessoryCircular") widget.addAccessoryWidgetBackground = true;
    const circle = ctx.family === "accessoryCircular";
    txt(widget, circle ? `✏️\n${hint}` : `✏️ ${hint}`, circle ? 11 : 12, theme.text, "semibold", { lines: 3, scale: 0.6, center: circle });
    return;
  }
  buildTiles(widget, [[item]], ctx);
}

/**
 * 書き方の間違い（ないカード・日付のない cd など）。
 * ネットにつながらないときとちがい、直し方を短く出す
 */

class SetupError extends Error {}

/**
 * 全部のカードを並行して読み込む。
 * - 読めた … item.data（古いキャッシュで出すときは item.stale も）
 * - 読めない … 前に出した中身を item.data に入れて item.stale。それもなければ item.data なし（「—」で描く）
 * - 書き方の間違い … item.hint
 */

async function loadItems(items, ctx) {
  const seen = {};
  await Promise.all(items.map(async (item) => {
    seen[item.type] = (seen[item.type] || 0) + 1;
    item.index = seen[item.type]; // 同じカードを2枚置いたとき、中身を変えるため
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

/** 30 分後か、カードが望むもっと早い時刻 */

function nextRefresh(items, ctx) {
  let at = new Date(ctx.now.getTime() + 30 * 60000);
  for (const item of items) {
    const card = CARDS[item.type];
    const want = card && card.refreshAt && item.data ? card.refreshAt(item.data, ctx) : null;
    if (want && want < at) at = want;
  }
  return at;
}

/** 押したときに開くページ（読めないときも、そのツールは開く） */

function itemUrl(item, ctx) {
  const card = CARDS[item.type];
  return (card && card.url && card.url(item.data, ctx)) || null;
}

/** カードの名前（「—」で描くときの見出し） */

function itemLabel(item) {
  const card = CARDS[item.type];
  return card ? `${card.icon} ${card.label}` : item.type;
}

/** 「/」がないときの並べ方。小は縦に、中は横に（4枚以上は2段）、大は2枚ずつ。上限は overLimit で確かめる */

function arrange(lines, family) {
  if (lines.length > 1) return lines;
  const items = lines[0] || [];
  if (family === "small") return items.map((item) => [item]);
  if (family === "medium") return items.length <= 3 ? [items] : chunk(items, Math.ceil(items.length / 2));
  return chunk(items, 2);
}

// ---------- ウィジェットの大きさ（Apple の HIG の表から） ----------
// 画面（縦向きの幅×高さ）がぴったり合う行があればその大きさ。
// 表にない機種は、その画面より大きくない機種のうち、いちばん大きい行を使う（実物より小さめに描くので切れない）。
// どの行より小さい画面は、いちばん小さい行を比で縮める。
// iPhone：[幅, 高さ, 小, 中の幅, 大の高さ, 丸, 長方形の幅, 長方形の高さ]

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
// iPad：[幅, 高さ, 小, 中の幅（＝大の一辺）, 特大の幅]。描く大きさ（Canvas）。iPad の大は正方形

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

/** 画面の大きさ（縦向き）と iPad かどうかから、その機種の行を選ぶ */

function pickWidgetSizeRow(screen, pad) {
  const w = Math.min(screen.width, screen.height);
  const h = Math.max(screen.width, screen.height);
  const table = pad ? IPAD_WIDGET_SIZES : IPHONE_WIDGET_SIZES;
  const exact = table.find((row) => row[0] === w && row[1] === h);
  if (exact) return exact;
  const fits = table.filter((row) => row[0] <= w && row[1] <= h).sort((a, b) => b[2] - a[2])[0];
  if (fits) return fits;
  // どの機種より小さい：いちばん小さい行を、幅と高さの比の小さいほうで縮める
  const least = table.slice().sort((a, b) => a[2] - b[2])[0];
  const k = Math.min(w / least[0], h / least[1]);
  return least.map((v, i) => (i < 2 ? v : Math.floor(v * k)));
}

/** ウィジェットの大きさ（ポイント）。{ w, h } */

function widgetSizeFor(family, screen, pad) {
  const row = pickWidgetSizeRow(screen, pad);
  if (pad) {
    const [, , s, m, xl] = row;
    return {
      small: { w: s, h: s },
      medium: { w: m, h: s },
      large: { w: m, h: m },
      extraLarge: { w: xl, h: m },
      // iPad のロック画面は表がないので、iPhone のいちばん小さい値（切れないほう）
      accessoryCircular: { w: 68, h: 68 },
      accessoryRectangular: { w: 153, h: 68 },
    }[family] || { w: m, h: s };
  }
  const [, , s, m, l, circle, rectW, rectH] = row;
  return {
    small: { w: s, h: s },
    medium: { w: m, h: s },
    large: { w: m, h: l },
    // iPhone に特大はない（試験台で描くときのため）
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
  // 1枚だけなら、これまでの Scriptable のウィジェットと同じく枠なしでいっぱいに使う
  const single = lines.length === 1 && lines[0].length === 1;
  const tiles = theme.tiles === "auto" ? !single : theme.tiles;
  const pad = single && !tiles ? 14 : 10;
  // 枠がないときは、すき間を広めにしてカードを分ける
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
      // 写真を敷くカード（photo）。1枚だけならウィジェット全体、並べたときはその枠だけ
      const whole = single && !tiles;
      const photo = cardPhoto(item, ctx, whole ? size.w : tileW, whole ? size.h : rowH);
      if (tiles) {
        const tint = cardTint(item, ctx);
        box.backgroundColor = tint ? tintedTile(tint, theme) : theme.tile;
        box.cornerRadius = 14;
      }
      let tp = tiles ? (rowH < 50 ? 6 : 10) : single ? 0 : 2;
      if (paint) {
        // 1枚だけならウィジェット全体、並べたときはそのカードだけ角丸に塗る
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

/** カードが敷く写真（w×h にぴったり切り抜いたもの。なければ null） */

function cardPhoto(item, ctx, w, h) {
  const card = CARDS[item.type];
  if (!card || !card.photo || !item.data) return null;
  try {
    const img = card.photo(item.data, ctx);
    return img ? coverImage(img, w, h) : null;
  } catch (e) {
    return null;
  }
}

/** 写真を w×h いっぱいに（はみ出たところは切る）。縦横の比をくずさない */

function coverImage(img, w, h) {
  // 画面の倍率ぶんの大きさで描く（大きすぎるとウィジェットのメモリを使いすぎる）
  const k = 2;
  const dc = new DrawContext();
  dc.size = new Size(Math.round(w * k), Math.round(h * k));
  dc.respectScreenScale = false;
  dc.opaque = true;
  const iw = img.size.width;
  const ih = img.size.height;
  const scale = Math.max((w * k) / iw, (h * k) / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  dc.drawImageInRect(img, new Rect((w * k - dw) / 2, (h * k - dh) / 2, dw, dh));
  return dc.getImage();
}

/** 枠（tile=on）にうっすらのせる色（カードの tint。なければ null） */

function cardTint(item, ctx) {
  const card = CARDS[item.type];
  try {
    return (card && card.tint && item.data && card.tint(item.data, ctx)) || null;
  } catch (e) {
    return null;
  }
}

/** 枠の地の色に hex をうっすら混ぜる（ライト・ダークそれぞれの地に） */

function tintedTile(hex, theme) {
  const mix = (mode, t) => {
    const a = hexToRgb(hex);
    const b = hexToRgb(THEMES[mode].tile);
    return new Color(rgbToHex(b.map((v, i) => v + (a[i] - v) * t)));
  };
  if (theme.mode === "auto") return Color.dynamic(mix("light", 0.16), mix("dark", 0.22));
  return THEMES[theme.mode] ? mix(theme.mode, theme.mode === "light" ? 0.16 : 0.22) : theme.tile;
}

/** カードが決めた背景の色（なければ null） */

function cardBackground(item, ctx) {
  const card = CARDS[item.type];
  return (card && card.background && item.data && card.background(item.data, ctx)) || null;
}

/** 上から下へのグラデーション（色は同じ間隔で） */

function gradient(colors) {
  const g = new LinearGradient();
  g.colors = colors.map((c) => new Color(c));
  g.locations = colors.map((c, i) => i / (colors.length - 1));
  return g;
}

/** s … 1〜2行ぶん / m … 中くらい / l … 広い */

function tierOf(area) {
  // 小を上下に分けた枠（高さ 60 前後）も 1〜2行の形に（中くらいの形は高さが足りずにはみ出す）
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
      // とても狭い枠（小に3〜4枚など）は、ロック画面の丸と同じ「印と短い値」だけ
      if (isTiny(ctx) && renderTiny(box, item, c)) return;
      CARDS[item.type].render(box, item.data, c);
      return;
    } catch (e) {
      // 描けないときも「—」にする
    }
  }
  renderBlank(box, item, { ...ctx, theme: ctx.faded });
}

/** とても狭い枠（幅 72pt 未満）。ふつうの描き方では字が欠けるので、印と短い値だけにする */

function isTiny(ctx) {
  return !ctx.accessory && ctx.w < 72;
}

/**
 * 狭い枠の描き方。カードの badge（ロック画面の丸と同じ { top, main, image }）を使う。
 * badge のないカードは false を返し、ふつうに描く
 */

function renderTiny(box, item, ctx) {
  const card = CARDS[item.type];
  const { theme, w, h } = ctx;
  if (!card.badge) {
    if (!card.inline) return false;
    // 文が中身のカード（お題・メモなど）：長い文は入らないので、印と名前だけ（押せばツールが開く）
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
    // 絵文字は大きめ、言葉（今月・集中など）は小さめ
    const word = /[\p{L}\p{N}]/u.test(b.top) && !/\p{Extended_Pictographic}/u.test(b.top);
    fixedTxt(box, w, b.top, word ? 10 : Math.min(22, h * 0.3), word ? theme.sub : theme.text, "semibold");
  }
  box.addSpacer(2);
  const main = String(b.main == null ? "—" : b.main);
  // 字の数に合わせて大きさを決める（全角は 1 字、半角は 0.6 字ぶん）
  const units = [...main].reduce((n, ch) => n + (/[ -~]/.test(ch) ? 0.6 : 1), 0) || 1;
  const size = Math.max(10, Math.min(26, h * 0.36, (w / units) * 0.95));
  fixedTxt(box, w, main, size, theme.text, "heavy");
  return true;
}

/** 読めないカード。名前と「—」だけを薄く（エラーの文は出さない） */

function renderBlank(box, item, ctx) {
  const { theme } = ctx;
  if (isTiny(ctx)) {
    // とても狭い枠は、印と「—」だけ
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

/** 書き方の間違い・許可がないとき。直し方だけを短く */

function renderHint(box, item, ctx) {
  const { theme } = ctx;
  if (item.perm) {
    // 許可がないとき：何の許可かと、どこで直せるか（とても狭い枠は「🔐」と何の許可かだけ）
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
    // とても狭い枠は「✏️」とカードの名前だけ（押すかアプリで見る）
    fixedTxt(box, ctx.w, "✏️", 16, theme.text, "regular");
    fixedTxt(box, ctx.w, item.type, 10, theme.sub, "semibold");
    return;
  }
  if (ctx.tier !== "s") txt(box, `✏️ ${item.type}`, 11, theme.sub, "semibold");
  // 行の数は高さに入るだけ（入らない分は「…」）
  const lines = Math.max(1, Math.min(4, Math.floor((ctx.h - (ctx.tier !== "s" ? 14 : 0)) / 12)));
  txt(box, item.hint, 10, theme.text, "regular", { lines, scale: 0.7 });
}

// ---------- ロック画面 ----------

function isAccessory(family) {
  return String(family).startsWith("accessory");
}

/**
 * ロック画面は単色で描かれるので、絵文字は灰色のかたまりになりやすい。
 * よく使う絵文字は、同じ意味の SF Symbols（iOS の記号）に置きかえる
 */

const SF_FOR_EMOJI = {
  "🗓️": "calendar", "📅": "calendar", "☑️": "checklist", "🎂": "birthday.cake.fill", "📷": "photo",
  "🔋": "battery.75percent", "⚡": "bolt.fill", "⏳": "hourglass", "🎌": "flag.fill", "⛩️": "sparkles",
  "🌀": "gauge.with.dots.needle.33percent", "🍅": "timer", "☕": "cup.and.saucer.fill", "🕒": "clock", "🕰️": "clock",
  "☀️": "sun.max.fill", "🌤️": "cloud.sun.fill", "⛅": "cloud.sun.fill", "🌥️": "cloud.sun.fill", "☁️": "cloud.fill",
  "🌦️": "cloud.sun.rain.fill", "🌧️": "cloud.rain.fill", "⛈️": "cloud.bolt.rain.fill", "🌩️": "cloud.bolt.fill",
  "🌨️": "cloud.snow.fill", "❄️": "snowflake", "🌫️": "cloud.fog.fill", "🌙": "moon.stars.fill", "🌛": "moon.fill",
  "🌑": "moonphase.new.moon", "🌒": "moonphase.waxing.crescent", "🌓": "moonphase.first.quarter", "🌔": "moonphase.waxing.gibbous",
  "🌕": "moonphase.full.moon", "🌖": "moonphase.waning.gibbous", "🌗": "moonphase.last.quarter", "🌘": "moonphase.waning.crescent",
  "🌅": "sunrise.fill", "🌇": "sunset.fill", "🌊": "water.waves", "💨": "wind",
};

/**
 * ホーム画面の線のアイコン。アプリが選んだ絵文字を、同じ意味の SF Symbols（線の形）にする。
 * 人が書いた絵文字（cd の 🌸入学式・count の 💧水・link の 🚃乗換 など）はここにないので、そのまま出る
 */
// 🤰（出産予定日）は、ほかに合う形がないので絵文字のまま

const LINE_ICONS = {
  "🗓️": "calendar", "📅": "calendar", "☑️": "checklist", "🎂": "birthday.cake", "📷": "photo",
  "🔋": "battery.75percent", "⚡": "bolt", "⏳": "hourglass", "🎌": "flag", "⛩️": "scroll",
  "🌀": "gauge.with.dots.needle.33percent", "🍅": "timer", "☕": "cup.and.saucer", "🕒": "clock", "🕰️": "clock", "⏱️": "chart.bar", "⏱": "clock",
  "☀️": "sun.max", "🌤️": "cloud.sun", "⛅": "cloud.sun", "🌥️": "cloud.sun", "☁️": "cloud",
  "🌦️": "cloud.sun.rain", "🌧️": "cloud.rain", "⛈️": "cloud.bolt.rain", "🌩️": "cloud.bolt",
  "🌨️": "cloud.snow", "❄️": "snowflake", "🌫️": "cloud.fog", "🌙": "moon.stars", "🌛": "moon", "🌡️": "thermometer.medium",
  "🌑": "moonphase.new.moon", "🌒": "moonphase.waxing.crescent", "🌓": "moonphase.first.quarter", "🌔": "moonphase.waxing.gibbous",
  "🌕": "moonphase.full.moon", "🌖": "moonphase.waning.gibbous", "🌗": "moonphase.last.quarter", "🌘": "moonphase.waning.crescent",
  "🌅": "sunrise", "🌇": "sunset", "☔": "umbrella", "💬": "bubble.left", "🎲": "dice", "🎉": "party.popper",
  "💞": "heart", "🔐": "lock", "✏️": "pencil", "⚠️": "exclamationmark.triangle", "🌊": "water.waves", "💨": "wind",
  "✅": "checkmark.circle", "🔢": "number", "🚨": "exclamationmark.triangle", "🛡️": "shield", "🌿": "leaf", "📝": "note.text", "🔗": "link", "🧹": "sparkles", "🔥": "flame", "⚪": "circle",
};

/** いま描いている記号の形。ロック画面は塗り（SF_FOR_EMOJI。単色でもくっきり）、ホーム画面は線（LINE_ICONS） */

let symbolStyle = "line";

/** 絵文字に合う SF Symbols の絵（なければ null） */

function symbolFor(emoji, size) {
  const key = String(emoji || "").trim();
  const name = symbolStyle === "fill" ? SF_FOR_EMOJI[key] || LINE_ICONS[key] : LINE_ICONS[key];
  if (!name || typeof SFSymbol === "undefined") return null;
  try {
    const sym = SFSymbol.named(name);
    if (!sym) return null;
    // 線は字と同じ細さ、塗りは少し太く
    sym.applyFont(symbolStyle === "fill" ? Font.semiboldSystemFont(size) : Font.systemFont(size));
    return sym.image;
  } catch (e) {
    return null;
  }
}

/**
 * SF Symbols の絵を置く大きさ。高さは字の大きさ、幅は絵の縦横の比のまま。
 * 大きさを決めないと、iOS のウィジェットは絵を入る場所いっぱいに広げる（実機で大きく伸びた）
 */

function symbolBox(img, size) {
  const s = (img && img.size) || {};
  const ratio = s.width > 0 && s.height > 0 ? s.width / s.height : 1;
  return new Size(Math.round(size * ratio * 10) / 10, size);
}

/** 名前で決めた SF Symbols を、字と同じ色で1つ置く。描けないときは fallback の字 */

const ICON_KEYS = Object.keys(LINE_ICONS).sort((a, b) => b.length - a.length);

const ICON_SPLIT = new RegExp(`(${ICON_KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "u");

/**
 * 字の中の絵文字を、字と同じ色の線のアイコンにして並べる。
 * 1行の字はどこにあっても、2行以上の字は頭の1つだけ（折り返しをくずさないため）。返すのは字（なければ何もしない置きもの）
 */

function iconTxt(stack, text, size, color, weight, opt) {
  const parts = text.split(ICON_SPLIT).filter((p) => p !== "");
  const multi = (opt.lines || 1) > 1;
  // アイコンは字の行の高さに収まる大きさ（字と同じ大きさだと、行が少し高くなって下が押し出される）
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
      // アイコンのすぐ後に字が続くときは、細い空きを入れる（字の空白と同じくらい）
      const next = parts[i + 1];
      if (next && !/^\s/.test(next)) parts[i + 1] = "\u2009" + next;
      return;
    }
    const t = plainTxt(row, p, size, color, weight, opt);
    if (p.trim().length > mainLen) [main, mainLen] = [t, p.trim().length];
  });
  return main || { centerAlignText() {}, rightAlignText() {}, leftAlignText() {} };
}

/** 文の頭の絵文字（SF Symbols に置きかえられるもの）と、残りの文 */

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

/** ロック画面に出せるカードがないとき：許可がない・書き方のまちがいなら、そうとわかる短い文に */

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

/** ロック画面の1行。絵は1つだけ置けるので、先頭の絵文字を SF Symbols にしてくっきり見せる */

function accessoryInline(widget, shown, ctx) {
  // 1行に入る長さに（長い文は iOS も「…」で切るので、先に切って、どこまで出るかを決めておく）
  const full = shown.map((item) => cardInline(item, ctx)).join("  ");
  let line = full;
  // いちばん狭い1行（225pt）に入るまで、後ろを「…」にする
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

/** ロック画面の丸。先頭の1枚の badge（上の印と大きな値、または絵） */

function accessoryCircular(widget, shown, ctx) {
  const item = shown[0];
  const card = CARDS[item.type];
  const badge = !item.data ? { top: card.icon, main: "—" }
    // 丸の形のないカード（メモ・お題・ツールなど）は、長い文が入らないので印と名前だけ
    : card.badge ? card.badge(item.data, ctx) : { top: card.icon, main: (card.label || "").length <= 3 ? card.label || "" : "" };
  const theme = accessoryTheme(item.data && !item.stale ? 1 : FADE);
  widget.addAccessoryWidgetBackground = true;
  // 中身は上下左右のまん中に（iOS の決まりに任せず、余白ではっきり寄せる）
  const middle = centerInWidget(widget);
  if (badge.image) {
    // 丸の枠は機種で大きさが違う（およそ 58〜76pt）。72 で置くと小さい機種ではみ出して大きく見えるので、
    // どの機種でも収まる 50 の正方形の画像に描いてから、余白なしで真ん中に置く（引き伸ばされないよう正方形の画像にする）
    // 丸がとても小さい機種でも入るように（丸の大きさから余白ぶん引く）
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
  // 縦の並びは左に寄るので、1行ずつ横のまん中の行に（丸の幅から、左右の伸びる余白 8pt ずつを引いた幅）
  const lineW = widgetSize("accessoryCircular").w - 20;
  // 上の印：SF Symbols があればそれで（単色でもくっきり）、なければ絵文字や文字のまま
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

/** ロック画面の長方形（機種で 153×68〜172×76）に 1〜3 枚 */

function accessoryRectangular(widget, shown, ctx) {
  const rows = shown; // 枚数は overLimit で確かめてある
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

/** ウィジェットの上下左右のまん中に置く箱（上下と左右に伸びる余白ではさむ） */

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

// ======================================
// 描画の部品
// ======================================

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
  // opt.raw … 絵文字のまま出す（ツールのアイコン・人が選んだ印など）
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

/** 残り時間が勝手に減っていく文字（ぽもくる） */

function hrow(stack, spacing = 4) {
  const row = stack.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.spacing = spacing;
  return row;
}

function image(stack, img, size, theme) {
  const view = stack.addImage(img);
  view.imageSize = new Size(size, size);
  if (theme && theme.alpha < 1) view.imageOpacity = theme.alpha;
  return view;
}

/** 大に1枚など、縦に広い枠。中身をひとかたまりにして、まん中に置く */

function isBig(ctx) {
  return ctx.tier === "l" && ctx.h >= 200;
}

/**
 * 幅 w の、中身を横のまん中に置く1行の枠。
 * 実機で確かめた寄り方（2026-11-01、AlignTest）：
 * - 縦に並べる枠は、centerAlignContent でも物差しを入れても、中身は左に寄る
 * - 横に並べる・幅を決めた・centerAlignContent の枠なら、中身はまん中に来る（伸びる余白の 8pt も取られない）
 */

function centerLine(box, w) {
  const line = box.addStack();
  line.layoutHorizontally();
  line.centerAlignContent();
  line.size = new Size(Math.max(1, w), 0);
  return line;
}

/** 横のまん中に置く行。返した stack に中身を足す */

function centerRow(box, w, spacing = 0) {
  const row = centerLine(box, w).addStack();
  row.centerAlignContent();
  row.spacing = spacing;
  return row;
}

/** 横のまん中に1行の字 */

function fixedTxt(stack, w, value, size, color, weight, opt = {}) {
  const t = txt(centerLine(stack, w), value, size, color, weight, { scale: 0.5, ...opt });
  t.centerAlignText();
  return t;
}

/** 横棒（0〜1）。DrawContext で角丸の棒を描く */

function canvas(w, h) {
  const dc = new DrawContext();
  dc.size = new Size(Math.max(4, Math.round(w)), Math.max(2, Math.round(h)));
  dc.opaque = false;
  dc.respectScreenScale = true;
  return dc;
}

/** 1行の字のおおよその幅（全角は1文字ぶん、半角は0.55） */

function textWidth(text, size) {
  return [...String(text)].reduce((n, ch) => n + (ch.charCodeAt(0) < 0x2000 ? 0.55 : 1), 0) * size;
}

/** 枠（w×h）に lines 行以内で入る、いちばん大きい文字の大きさ */

function chunk(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** 字の頭の絵文字（🌸・👨‍👩‍👧・🇯🇵 など） */

function hash(text) {
  const key = String(text);
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------- 日付 ----------

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymd(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

/** ウィジェットのボタンから、このスクリプトを操作つきで開くリンク（runAction で受ける） */

function actionUrl(action, params = {}) {
  const q = Object.entries({ action, ...params }).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return `${URLScheme.forRunningScript()}?${q}`;
}

/** カードの refreshAt にそのまま使う：日付が変わったら描き直す */

function justAfterMidnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 1);
}

const fm = FileManager.local();

const CACHE_DIR = fm.joinPath(fm.documentsDirectory(), "sqriptable");

if (!fm.fileExists(CACHE_DIR)) fm.createDirectory(CACHE_DIR, true);

function cachePath(key) {
  return fm.joinPath(CACHE_DIR, key.replace(/[^a-z0-9_.-]/gi, "_"));
}

/** maxAgeMin より古ければ null（null を渡すと古くても返す） */

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
    // 保存できなくても表示は続ける
  }
}

// ---------- 端末の許可（カレンダー・リマインダー・連絡先・位置） ----------
// 許可がないと、ウィジェットではエラーになったり、スクリプトごと止まったりする。
// 読む前に「読みかけ」と書いておき、読めたら ok・だめなら no にする。
// 「読みかけ」のまま残っていたら、前回そこで止まったということなので、ウィジェットではしばらく読まない
// （止まるとほかのカードや通知も進まないため）。アプリで動かしたときは毎回ためす（許可を聞けるのはアプリだけ）。

const PERMS = {
  calendar: { label: "カレンダー", used: "agenda（今日の予定）" },
  reminders: { label: "リマインダー", used: "todo" },
  contacts: { label: "連絡先", used: "bday（誕生日と、その通知）", notice: "誕生日の通知" },
  // 位置は電波などで取れないこともあるので、早めにためし直す
  location: { label: "位置情報", used: "場所を書かない weather・pressure・sun", retryMin: 30 },
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

/** 許可が要るものを読む。だめなら PermissionError（どの許可かを持つ） */

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

// ---------- 通知の予約（cd・bday・pomo） ----------
// 通知は iOS が時刻どおりに出すので、ウィジェットの描き直しが遅れてもずれない。
// 予約はスクリプトが動いたときにする。ウィジェットごとの分を覚えて、同じ種類の分をまとめて予約し直す。

/**
 * cd と bday は「days」の1つの箱で予約する（同じ時刻の知らせは、cd の記念日と連絡先の誕生日でも1通にまとめるため）。
 * 前は cd・bday に分けて予約していたので、その名前（NOTICE_OLD_KINDS）の予約は消して予約し直す
 */

function request(url) {
  const req = new Request(url);
  req.timeoutInterval = 12;
  return req;
}

/**
 * 新しければキャッシュを使い、取れなければ古いキャッシュで表示する。
 * item を渡すと、古いキャッシュを使ったときに item.stale を立てる（薄く描く）
 */

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

/**
 * ポケモンの絵。small … 大に1枚のとき以外は、元の絵（475px）を 240px に縮めて残す
 * （絵が大きいとウィジェットのメモリが足りなくなる）
 */

function cachedImage(key) {
  const path = cachePath(key + ".png");
  return fm.fileExists(path) ? fm.readImage(path) : null;
}

async function getImage(url, key) {
  const path = cachePath(key + ".png");
  const cached = cachedImage(key);
  if (cached) return cached;
  const img = await request(url).loadImage();
  try {
    fm.writeImage(path, img);
  } catch (e) {
    // そのまま使う
  }
  return img;
}

// ======================================
// カード
//
// defineCard(名前, {
//   icon, label … 短い名前（読めないときに「⏳ くろのす —」のように出す）
//   aliases  … 別名（日本語名など）
//   help     … 「書き方を見る」に出す説明
//   load(arg, ctx, item)   … データを用意（async 可）。読めなければ投げる → 前の中身か「—」。
//                            書き方の間違いは SetupError で投げる → 直し方を出す
//   keep(data) / revive(saved) … 読めたときの中身を残し、読めないときに戻す（ネットを使うカードだけ）
//   tint(data, ctx)         … 枠（tile=on）にうっすらのせる色 #RRGGBB（なくてよい）
//   render(box, data, ctx) … ctx.w / ctx.h / ctx.tier（s・m・l）に合わせて描く
//   inline(data, ctx)      … ロック画面の1行
//   badge(data, ctx)       … ロック画面の丸 { top, main }
//   url(data, ctx)         … タップで開くツール（data は読めないとき undefined）
//   refreshAt(data, ctx)   … この時刻には描き直してほしい
//   background(data, ctx)  … カードの背景のグラデーション [上の色, 下の色]（字は白で描く。1枚だけならウィジェット全体）
//   photo(data, ctx)       … カードに敷く写真（Image。photo カード）
//   speak(data, ctx)       … Siri・ショートカットで読み上げる文
//   pickTitle              … 押したときの選ぶ画面の見出し（q・link・shortcut）
// })
// くわしい作りは docs/structure.md
// ======================================

const CARDS = {};

const ALIASES = {};

function defineCard(name, spec) {
  CARDS[name] = { name, ...spec };
  (spec.aliases || []).forEach((alias) => (ALIASES[alias.toLowerCase()] = name));
}

function cardName(word) {
  const key = word.toLowerCase();
  return ALIASES[key] || key;
}

// ---------- 祝日（date・holiday で使う） ----------

/** 祝日の一覧。item を渡すと、読めないときに投げる（holiday カード）。渡さなければ空にする（date カード） */

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

/** 「35.68,139.77」「名古屋」「（空）＝今いる場所」を緯度経度にする */

async function resolvePlace(arg) {
  const text = String(arg || "").trim();
  const ll = text.match(/^(-?\d+(?:\.\d+)?)[,_](-?\d+(?:\.\d+)?)(?:=(.+))?$/);
  if (ll) return { lat: +ll[1], lon: +ll[2], name: ll[3] || "" };
  return text ? searchPlace(text) : currentPlace();
}

/**
 * 日本語の地名は「名古屋」で見つかっても「横浜」では別の小さな町に当たるなど、まちまち。
 * 「◯◯」と「◯◯市」をまとめて探して人口の多いほうを選び、なければ都・区・町でも探す。
 */

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

/** 今いる場所。取れなければ前回の場所 */

async function currentPlace() {
  try {
    const loc = await withPerm("location", () => {
      Location.setAccuracyToThreeKilometers();
      return Location.current();
    });
    let name = "";
    // 頭痛ーるの地点さがしに使う（市町村と都道府県）
    let city = "";
    let pref = "";
    try {
      const geo = await Location.reverseGeocode(loc.latitude, loc.longitude, "ja");
      const g = (geo && geo[0]) || {};
      name = g.locality || g.administrativeArea || "";
      city = g.locality || "";
      pref = g.administrativeArea || "";
    } catch (e) {
      // 地名なしでよい
    }
    const place = { lat: loc.latitude, lon: loc.longitude, name, city, pref };
    writeCache("place_here", place);
    return place;
  } catch (e) {
    const last = readCache("place_here");
    if (last) return last;
    throw new SetupError("weather:名古屋 のように場所を入れてね");
  }
}

/** 天気と日の出・日の入り（weather・sun で同じものを使う。Open-Meteo・鍵なし） */

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

/**
 * 頭痛ーるの地点さがし。返りが文字のことも配列のこともあるので、どちらも読む。
 * 同じ名前の市区町村（府中・伊達・中央区など）は、黙って選ばずに県名を付けてもらう（広島県府中市）。
 * 同じ市の区だけ（名古屋・札幌など）なら、1つ目の区のまま。
 * 頭痛ーるのさがし方は県名を付けると見つからないので、県名を外してさがし、返りを県名でしぼる
 */

function pressureAxis(box, axis, w, size, theme) {
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

/** 1時間ごとの棒。高さは気圧、色は段階。過ぎた時間は薄く、今の時刻に印 */

function shortPlace(name) {
  const rest = String(name || "").replace(/^(北海道|東京都|京都府|大阪府|.{2,3}?県)/, "");
  return rest || String(name || "");
}

/** 今の時刻のぶん（なければいちばん近い時刻） */

const SEA = {
  page: "https://katsuan.github.io/umiqru/",
  // 画面に出す出どころの名前（ここだけに書く）
  names: { page: "うみくる", jma: "気象庁", tide: "潮汐表" },
  portMaxKm: 30, // これより遠い港の潮汐表は使わない（日本の外・沖の遠く）
  // 線の色はグラフごとの並びで検証ずみ（色の見分けやすさ）。字は ink で背景に合わせる
  waves: [
    { key: "ecmwf_wam025", label: "欧州", color: "#2A78D6" },
    { key: "ncep_gfswave025", label: "米国", color: "#EB6834" },
    { key: "meteofrance_wave", label: "仏", color: "#1BAF7A" },
    { key: "ncep_gfswave016", label: "米細", color: "#EDA100" },
  ],
  winds: [
    { key: "jma_msm", label: "MSM", color: "#008300" },
    { key: "jma_gsm", label: "GSM", color: "#2A78D6" },
    { key: "ecmwf_ifs025", label: "欧州", color: "#EB6834" },
    { key: "gfs_seamless", label: "米国", color: "#6250D6" },
  ],
  tideColor: "#E87BA4", // 潮汐表（tide736.net）。波の「仏」と同じ色にしない
  // 気象庁の警報・注意報のうち、海に出るときに見るもの
  warnNames: {
    "02": "暴風雪警報", "03": "大雨警報", "05": "暴風警報", "07": "波浪警報", "08": "高潮警報",
    "10": "大雨注意報", "14": "雷注意報", "15": "強風注意報", "16": "波浪注意報", "19": "高潮注意報", "20": "濃霧注意報",
    "32": "暴風雪特別警報", "33": "大雨特別警報", "35": "暴風特別警報", "37": "波浪特別警報", "38": "高潮特別警報",
  },
  dirs: ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"],
};

// tide736.net の港（県の番号,港の番号,名前,緯度,経度）。位置は度に直したもの

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

/** 港の名前にそのまま当たれば港の位置。ほかは weather と同じ（緯度経度・地名・空なら今いる場所） */

async function seaPlace(arg) {
  const text = String(arg || "").trim();
  const port = text && seaPorts().find((p) => p.name === text);
  if (port) return { lat: port.lat, lon: port.lon, name: port.name };
  return resolvePlace(text);
}

/**
 * 気象庁の地域（府県予報区の一次細分と市町村）。国土地理院の市区町村コード → 気象庁の区分の表（area.json）。
 * 海の上で市区町村が出ないときは、港の位置とまわりを少しずつ広げてさがす。地点は動かないので長く覚える
 */

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

/** 気象庁の府県天気予報から、日ごとの波・風・天気の文（3日先まで） */

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
    // 文がなくてもグラフは出す
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

/** 岸に近くて値の出ない波の予報は、まわりの少し沖（0.25°）の点で読む。読めた点までの km を返す */

async function seaOffshore(place, hourly, empty, q) {
  const pts = [];
  for (const dy of [-0.25, 0, 0.25]) for (const dx of [-0.25, 0, 0.25]) if (dx || dy) pts.push([place.lat + dy, place.lon + dx]);
  const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${pts.map((p) => p[0].toFixed(2)).join(",")}&longitude=${pts.map((p) => p[1].toFixed(2)).join(",")}`
    + `${q}&cell_selection=sea&hourly=wave_height,wave_direction&models=${empty.join(",")}`;
  const res = await getJSON(url, `sea_off_${place.lat.toFixed(2)}_${place.lon.toFixed(2)}_${empty.join("-")}.json`, 60);
  const list = Array.isArray(res) ? res : [res];
  const km = {};
  empty.forEach((k) => {
    // 1つだけ頼んだときは、名前に予報の名前が付かない
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

/**
 * sea の設定。場所（港・地名・緯度経度）のほかに、出すもの（wave 波・tide 潮・wind 風。書いた順に）と、
 * 向きの出し方（deg 角度・16 16方位）。「32.79,132.49,wind」は場所が 32.79,132.49
 */

const SEA_SHOW = { wave: "wave", 波: "wave", tide: "tide", 潮: "tide", wind: "wind", 風: "wind" };

function seaOptions(arg) {
  const show = [];
  const rest = [];
  let deg = false;
  String(arg || "").split(",").map((w) => w.trim()).filter(Boolean).forEach((w) => {
    const k = w.toLowerCase();
    if (SEA_SHOW[k]) {
      if (!show.includes(SEA_SHOW[k])) show.push(SEA_SHOW[k]);
    } else if (k === "deg" || k === "角度") deg = true;
    else if (k === "16" || k === "16方位") deg = false;
    else rest.push(w);
  });
  return { place: rest.join(","), show, deg };
}

async function loadSea(arg, ctx, item) {
  const opt = seaOptions(arg);
  const place = await seaPlace(opt.place);
  const port = seaNearestPort(place);
  const la = place.lat.toFixed(2);
  const lo = place.lon.toFixed(2);
  // 今日の0時から72時間（日本時間）。グラフは今の少し前から24時間
  const q = `&timezone=Asia%2FTokyo&forecast_days=3`;
  const at = `latitude=${la}&longitude=${lo}`;
  const windUrl = (models) => `https://api.open-meteo.com/v1/forecast?${at}${q}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&models=${models.join(",")}`;
  const soft = (p) => p.catch(() => null);
  const today = ymd(ctx.now);
  const [areaJma, waves, sea, msm, wind, tide, wx] = await Promise.all([
    soft(seaArea(place, port)),
    soft(getJSON(`https://marine-api.open-meteo.com/v1/marine?${at}${q}&cell_selection=sea&hourly=wave_height,wave_direction&models=${SEA.waves.map((m) => m.key).join(",")}`, `sea_wave_${la}_${lo}.json`, 60, item)),
    soft(getJSON(`https://marine-api.open-meteo.com/v1/marine?${at}${q}&cell_selection=sea&hourly=sea_surface_temperature`, `sea_sst_${la}_${lo}.json`, 120, item)),
    // MSM は日本のまわりだけ（外では読めなくてよい）
    soft(getJSON(windUrl(["jma_msm"]), `sea_msm_${la}_${lo}.json`, 60, item)),
    soft(getJSON(windUrl(SEA.winds.slice(1).map((m) => m.key)), `sea_wind_${la}_${lo}.json`, 60, item)),
    port ? soft(getJSON(`https://tide736.net/api/get_tide.php?pc=${port.pc}&hc=${port.hc}&yr=${ctx.now.getFullYear()}&mn=${ctx.now.getMonth() + 1}&dy=${ctx.now.getDate()}&rg=week`, `sea_tide_${port.pc}_${port.hc}_${today}.json`, 60 * 12, item)) : null,
    // 天気・気温・降水確率（1時間ごと）
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
  // 潮汐表：今日と明日（20分ごと）、満潮・干潮、潮回り、日の出入りと薄明（まづめのめやす）
  const chart = tide && tide.tide && tide.tide.chart;
  const days = [today, ymd(addDays(ctx.now, 1))].map((k) => chart && chart[k]).filter(Boolean);
  const mins = (t) => {
    const [h, m] = String(t).trim().split(":").map(Number);
    return h * 60 + m;
  };
  const jma = jmaJson && areaJma ? seaJmaText(jmaJson, areaJma.c10) : {};
  return {
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
    tide: days.length ? days.flatMap((c, i) => c.tide.slice(0, 72).map((p, j) => ({ m: i * 1440 + j * 20, cm: Math.round(p.cm) }))) : [],
    tideMarks: days.flatMap((c, i) => [
      ...c.flood.map((p) => ({ m: i * 1440 + mins(p.time), cm: Math.round(p.cm), k: "満潮", time: p.time })),
      ...c.edd.map((p) => ({ m: i * 1440 + mins(p.time), cm: Math.round(p.cm), k: "干潮", time: p.time })),
    ]).sort((a, b) => a.m - b.m),
    moon: days.length ? days[0].moon.title : "",
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

/** 今日の0時からの時間（読んだ日が変わっていても、その日の0時から数える） */

function seaHourIndex(d, now) {
  return Math.max(0, Math.round((now - new Date(`${d.day0}T00:00:00+09:00`)) / 3600000 - 0.5));
}

/** グラフに出す24時間：今の前の目盛り（0・6・12・18時）の3時間前から。気圧（pressureWindow）と同じ */

function seaWindow(d, now) {
  const i = seaHourIndex(d, now);
  const from = Math.max(0, Math.min(24, Math.floor((i % 24) / 6) * 6 - 3 + Math.floor(i / 24) * 24));
  const axis = [];
  for (let t = Math.ceil(from / 6) * 6; t <= from + 24; t += 6) axis.push({ text: String(t % 24 === 0 && t > from ? 24 : t % 24), pos: (t - from) / 24 });
  return { from, i, axis };
}

const seaDir = (deg) => (deg == null ? "" : SEA.dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]);
/** 風の向き：ふつうは16方位（北北西）、deg なら角度（331°） */

const seaDirText = (d, deg) => (deg == null ? "" : d.opt && d.opt.deg ? `${Math.round(((deg % 360) + 360) % 360)}°` : seaDir(deg));

function seaRange(list, i) {
  const v = list.map((s) => s.v[i]).filter((x) => x != null);
  if (!v.length) return null;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const f = (x) => (x >= 10 ? String(Math.round(x)) : x.toFixed(1));
  return { lo, hi, n: v.length, text: v.length > 1 && f(lo) !== f(hi) ? `${f(lo)}〜${f(hi)}` : f(hi) };
}

/** つぎの満潮・干潮と、つぎのまづめ（朝：薄明〜日の出の1時間後、夕：日の入りの1時間前〜薄明のおわり） */

function seaNext(d, now) {
  const m = (now - new Date(`${d.day0}T00:00:00+09:00`)) / 60000;
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

/**
 * グラフ（DrawContext の絵）の色。絵はライト・ダークで描き分けられず、自動の色はライト側で固まるので、
 * 自動のときは、どちらの背景でも見える半透明の灰色と、線の色そのものを使う
 */

function seaPaint(theme) {
  if (theme.mode !== "auto") return { band: theme.track, base: theme.track, ref: theme.sub, now: theme.text, mark: theme.text, line: (hex) => ink(hex, theme) };
  const gray = (a) => new Color("#8E8E93", a * theme.alpha);
  return { band: gray(0.22), base: gray(0.45), ref: gray(0.9), now: gray(1), mark: gray(1), line: (hex) => new Color(hex, theme.alpha) };
}

/**
 * 線のグラフ。series … [{ color, v: [1時間ごと], step（1つの間の時間。潮は 1/3） }]、from から24時間。
 * refs … 点線の横線（気象庁の文の波の高さ）。bands … うすく塗る時間（夜）。marks … 印（満潮・干潮）。i … 今の時刻
 */

function seaGraph(w, h, { series, from, i, theme, refs = [], bands = [], marks = [], floor0 = true }) {
  const dc = canvas(w, h);
  const pts = series.map((s) => (s.v || []).map((y, j) => ({ x: j * (s.step || 1) - from, y })).filter((p) => p.x >= -0.01 && p.x <= 24.01 && p.y != null));
  const ys = pts.flat().map((p) => p.y).concat(refs.map((r) => r.y));
  if (!ys.length) return dc.getImage();
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (floor0) lo = Math.min(0, lo);
  if (hi - lo < 1) hi = lo + 1;
  const pad = 3;
  const X = (x) => (x / 24) * w;
  const Y = (y) => pad + (h - pad * 2) * (1 - (y - lo) / (hi - lo));
  const paint = seaPaint(theme);
  // 夜
  dc.setFillColor(paint.band);
  bands.forEach((b) => {
    const a = Math.max(0, b.from - from);
    const z = Math.min(24, b.to - from);
    if (z > a) dc.fillRect(new Rect(X(a), 0, X(z) - X(a), h));
  });
  // 底の線
  dc.setFillColor(paint.base);
  dc.fillRect(new Rect(0, h - 1, w, 1));
  // 点線（気象庁）
  dc.setFillColor(paint.ref);
  refs.forEach((r) => {
    const y = Y(r.y);
    for (let x = X(Math.max(0, (r.from ?? from) - from)); x < X(Math.min(24, (r.to ?? from + 24) - from)); x += 6) dc.fillRect(new Rect(x, y - 0.75, 3, 1.5));
  });
  pts.forEach((list, k) => {
    if (list.length < 2) return;
    const path = new Path();
    path.move(new Point(X(list[0].x), Y(list[0].y)));
    list.slice(1).forEach((p) => path.addLine(new Point(X(p.x), Y(p.y))));
    dc.addPath(path);
    dc.setStrokeColor(paint.line(series[k].color));
    dc.setLineWidth(series.length > 1 ? 1.5 : 2);
    dc.strokePath();
  });
  marks.forEach((mk) => {
    const x = mk.m / 60 - from;
    if (x < 0 || x > 24) return;
    dc.setFillColor(paint.mark);
    dc.fillEllipse(new Rect(X(x) - 2, Y(mk.cm) - 2, 4, 4));
  });
  // 今の時刻
  const nx = X(Math.min(24, Math.max(0, i - from)));
  dc.setFillColor(paint.now);
  dc.fillRect(new Rect(nx - 0.5, 0, 1, h));
  return dc.getImage();
}

/** グラフの見出し（名前）と、線の色の見本を1行に */

function seaLegend(box, title, items, size, theme, w) {
  const row = hrow(box, 4);
  txt(row, title, size, theme.sub, "semibold");
  row.addSpacer();
  // 字の幅は目安なので、少し多めに見て、入らない見本は出さない
  let room = w - textWidth(title, size) * 1.15 - 16;
  items.forEach((it) => {
    const need = textWidth(it.label, size - 1) * 1.15 + (it.dash ? 18 : 14);
    if (need > room) return;
    room -= need;
    // 点線の見本（気象庁の文の波）か、線の色の丸
    const dot = canvas(it.dash ? 10 : 6, 6);
    dot.setFillColor(it.dash ? seaPaint(theme).ref : seaPaint(theme).line(it.color));
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

/** 夜（日の入り〜日の出）の時間。今日の0時からの時間で。日の出入りがなければ（日本の港がない）空 */

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

/** 風の表の高さ（時刻の行と、予報ごとの2行ぶん）。rowH … 1つの予報の行の高さ（ふつう 24） */

function seaWindTableH(d, rowH = 24) {
  return 12 + d.winds.filter((m) => m.v.some((v) => v != null)).length * rowH;
}

/**
 * 風の表。列は今から3時間おきの時刻（入るだけ）、行は予報ごと。マスは向き（16方位か角度）と風速
 */

function seaWindTable(box, d, ctx, w, rowH = 24) {
  const { theme } = ctx;
  const i = seaHourIndex(d, ctx.now);
  const list = d.winds.filter((m) => m.v.some((v) => v != null));
  // 行が高いとき（風だけのとき）は字も大きく。低いとき（22 未満）は、1マスを「北北西 13」の1行に
  const big = rowH >= 34;
  const thin = rowH < 22;
  const labelW = big ? 52 : thin ? 36 : 46;
  const cols = Math.max(1, Math.min(8, Math.floor((w - labelW) / (thin ? 46 : 34)), Math.floor((47 - i) / 3) + 1));
  const cw = Math.floor((w - labelW) / cols);
  const at = (c) => i + c * 3;
  const head = hrow(box, 0);
  const lab = head.addStack();
  lab.size = new Size(labelW, 12);
  txt(lab, "風 m/s", 8, theme.sub, "semibold", { scale: 0.6 });
  lab.addSpacer();
  for (let c = 0; c < cols; c++) fixedTxt(head, cw, `${at(c) % 24}時`, big ? 10 : 8, c ? theme.sub : theme.text, "semibold");
  list.forEach((m) => {
    const row = hrow(box, 0);
    const name = row.addStack();
    name.size = new Size(labelW, rowH);
    name.centerAlignContent();
    name.spacing = 3;
    const dot = canvas(6, 6);
    dot.setFillColor(seaPaint(theme).line(m.color));
    dot.fillEllipse(new Rect(0, 0, 6, 6));
    const v = name.addImage(dot.getImage());
    v.imageSize = new Size(6, 6);
    txt(name, m.label, big ? 11 : thin ? 8 : 9, theme.sub, "semibold", { scale: 0.7 });
    name.addSpacer();
    for (let c = 0; c < cols; c++) {
      const k = at(c);
      const sp = m.v[k];
      if (thin) {
        fixedTxt(row, cw, sp == null ? "—" : `${seaDirText(d, m.dir && m.dir[k])} ${sp >= 10 ? Math.round(sp) : sp.toFixed(1)}`, 8, c ? theme.sub : theme.text, c ? "medium" : "bold");
        continue;
      }
      const cell = row.addStack();
      cell.layoutVertically();
      cell.size = new Size(cw, rowH);
      fixedTxt(cell, cw, sp == null ? "" : seaDirText(d, m.dir && m.dir[k]), big ? 9 : 7, theme.sub, "medium", { scale: 0.6 });
      fixedTxt(cell, cw, sp == null ? "—" : sp >= 10 ? String(Math.round(sp)) : sp.toFixed(1), big ? 14 : 10, c ? theme.sub : theme.text, c ? "medium" : "bold");
    }
  });
}

defineCard("sea", {
  icon: "🌊",
  label: "海",
  aliases: ["umi", "marine", "海", "波", "釣り"],
  help: `波・風・潮をグラフで（sea:城ヶ島 / sea:32.7987,132.4959 / 空なら今いる場所 / sea:城ヶ島,wave,wind で出すものを選ぶ（wave 波・tide 潮・wind 風） / deg で風の向きを角度に。アプリの「🌊 海の Parameter を作る」で作れる）。${SEA.names.jma}の波の文と警報・注意報、近い港の${SEA.names.tide}を先に、緯度経度で読む波4つ・風4つの予報をあとに。押すと${SEA.names.page}が開く`,
  keep: (d) => d,
  load: loadSea,
  refreshAt(d, ctx) {
    return new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate(), ctx.now.getHours() + 1, 1);
  },
  url(d) {
    return d ? `${SEA.page}?q=${d.lat.toFixed(4)},${d.lon.toFixed(4)}` : SEA.page;
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
    const view = seaWindow(d, now);
    const i = view.i;
    const wv = seaRange(d.waves, i);
    const wd = seaRange(d.winds, i);
    const j = d.jma[0];
    const next = seaNext(d, now);
    const warnColor = theme.warn;
    const waveText = wv ? wv.text : "—";
    const windText = `${seaDirText(d, d.windDir[i])} ${wd ? wd.text : "—"}`;
    // 狭い枠は、いちばん強い予報の値だけ（「北西 7」）
    const windShort = `${seaDirText(d, d.windDir[i])} ${wd ? (wd.hi >= 10 ? Math.round(wd.hi) : wd.hi.toFixed(1)) : "—"}`;
    const place = shortPlace(d.name);

    if (ctx.accessory && tier !== "s") {
      // ロック画面の長方形：波の幅と、4つの予報の平均の線、風とつぎの潮（白の濃淡だけ）
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
      // 1行に入らなければ、風を2行目に（場所・警報のかわりに）
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

    // 見出し：場所と、警報・注意報（あれば）
    const head = hrow(box, 4);
    txt(head, place, tier === "l" ? 12 : 11, theme.sub, "semibold", { scale: 0.6 });
    head.addSpacer();
    if (d.warns.length) txt(head, `⚠️ ${d.warns.length > 1 ? `${d.warns[0]} ほか` : d.warns[0]}`, 9, warnColor, "bold", { scale: 0.6 });
    // 今の時刻の天気・気温・降水確率（狭い枠で警報があるときは、印と降水確率だけ）
    const wx = d.wx && d.wx.code[i] != null ? d.wx : null;
    // 狭い枠（250 未満）は、警報があれば警報だけ、なければ天気の印と降水確率だけ
    if (wx && (w >= 250 || !d.warns.length)) {
      const [emoji] = wmo(wx.code[i], wx.day[i]);
      const pop = wx.pop[i] != null ? `☔${wx.pop[i]}%` : "";
      const temp = wx.temp[i] != null ? `${Math.round(wx.temp[i])}°` : "";
      txt(head, emoji, tier === "l" ? 11 : 10, theme.text);
      txt(head, w >= 250 ? `${temp} ${pop}`.trim() : pop, tier === "l" ? 11 : 10, theme.sub, "semibold", { scale: 0.6 });
    }

    const big = isBig(ctx);
    const wide = w >= 250;
    // 数字の行：波（4つの予報の幅）・気象庁の文・風
    const main = hrow(box, 6);
    txt(main, "🌊", big ? 15 : 12, theme.text);
    txt(main, waveText, big && wide ? 26 : wide ? 20 : w < 110 ? 11 : w < 150 ? 13 : 16, theme.text, "round", { scale: 0.5 });
    txt(main, "m", 11, theme.sub, "medium");
    if (j && j.nums.length && big && wide) txt(main, `${SEA.names.jma} ${Math.max(...j.nums)}m`, 10, theme.sub, "semibold", { scale: 0.7 });
    main.addSpacer();
    if (wide) {
      txt(main, "💨", big ? 13 : 11, theme.text);
      txt(main, `${windText}m/s`, big ? 13 : 11, theme.text, "semibold", { scale: 0.6 });
    } else {
      // 狭い枠（小に1枚など）は、風を次の行に
      txt(box, `💨 ${w < 160 ? windShort : windText}m/s`, 10, theme.sub, "semibold", { scale: 0.6 });
    }
    // 大に1枚：数字の行の下に、気象庁の天気の文（今日）
    const wxLine = big && wide && j && j.weather;
    if (wxLine) txt(box, `${SEA.names.jma} ${j.weather}`, 10, theme.sub, "semibold", { scale: 0.6 });

    // グラフと表。Parameter に wave・tide・wind を書けばそれだけを書いた順に。書かなければ大きさに合わせて
    //   大に1枚（横に広い）：波・潮のグラフと風の表 / 中：波と潮を横に2つ / 狭くて背の高い枠：波・潮・風のグラフ / ほか：波
    const footH = 14;
    const axisH = 11;
    const legendH = 12;
    const room = h - (big && wide ? 54 + (wxLine ? 14 : 0) : wide ? 46 : 58) - footH - axisH;
    const waveItems = [...d.waves, ...(j && j.nums.length ? [{ label: SEA.names.jma, dash: true }] : [])];
    const tideTitle = d.port ? `潮 ${d.port.name}${d.moon ? `・${d.moon}` : ""}` : "潮";
    // 風は、幅があれば表、狭ければグラフ
    // 風は、幅と高さがあれば表、なければグラフ。表の行の高さ：ふつう 24、低ければ 13（1行の細い表）、風だけなら あいた高さに合わせて 48 まで
    const windRows = d.winds.filter((m) => m.v.some((v) => v != null)).length || 1;
    let tableRowH = 24;
    const fitRowH = (avail, grow) => {
      const r = Math.floor((avail - 12) / windRows);
      return r >= 24 ? (grow ? Math.min(48, r) : 24) : r >= 13 ? 13 : 0;
    };
    const isTable = (g, cw) => g === "wind" && cw >= 150 && tableRowH > 0;
    const drawOne = (col, g, cw, gh) => {
      if (g === "wave") {
        seaLegend(col, "波 m", waveItems, 9, theme, cw);
        seaWaveGraph(col, d, ctx, view, cw, gh);
      } else if (g === "tide") {
        seaLegend(col, tideTitle, [], 9, theme, cw);
        if (d.tide.length) seaTideGraph(col, d, ctx, view, cw, gh);
        else txt(col, `${SEA.names.tide}は日本の港だけ`, 9, theme.sub, "medium");
      } else if (isTable(g, cw)) {
        seaWindTable(col, d, ctx, cw, tableRowH);
        col.addSpacer();
      } else {
        seaLegend(col, "風 m/s", d.winds, 9, theme, cw);
        seaPlot(col, seaGraph(cw, gh, { series: d.winds, from: view.from, i, theme, bands: seaNightBands(d) }), cw, gh);
      }
    };
    const chosen = d.opt && d.opt.show && d.opt.show.length ? d.opt.show : null;
    const auto = (big ? ["wave", "tide", "wind"] : wide ? ["wave", "tide"] : ["wave"]).filter((g) => g !== "tide" || d.tide.length || !wide);
    const items = chosen || auto;
    box.addSpacer(4);
    if (room < legendH + 16) {
      // 低い枠：グラフは入らないので、数字と下の行だけ
    } else if (wide && !big && items.length >= 2) {
      const cw = Math.floor((w - 12) / 2);
      const gh = Math.max(16, room - legendH - 2);
      tableRowH = fitRowH(room + axisH, false);
      const row = box.addStack();
      row.layoutHorizontally();
      row.spacing = 12;
      items.slice(0, 2).forEach((g) => {
        const col = row.addStack();
        col.layoutVertically();
        col.size = new Size(cw, 0);
        drawOne(col, g, cw, gh);
        if (!isTable(g, cw)) {
          col.addSpacer(2);
          pressureAxis(col, view.axis, cw, 8, theme);
        }
      });
    } else {
      // 上から入るだけ。表は決まった高さ、グラフは残りを分ける
      const graphCount = items.filter((g) => g !== "wind").length;
      tableRowH = fitRowH(room + axisH - graphCount * (legendH + 26) - (graphCount ? 6 : 0), graphCount === 0);
      const shown = [];
      let need = 0;
      for (const g of items) {
        const n = isTable(g, w) ? seaWindTableH(d, tableRowH) + 6 : legendH + 26;
        if (shown.length && need + n > room + axisH) break;
        shown.push(g);
        need += n;
      }
      const graphs = shown.filter((g) => !isTable(g, w)).length;
      const fixed = shown.some((g) => isTable(g, w)) ? seaWindTableH(d, tableRowH) + 6 : 0;
      const gh = graphs ? Math.max(16, Math.floor((room - fixed) / graphs - legendH - 2)) : 0;
      const lastGraph = shown.map((g) => !isTable(g, w)).lastIndexOf(true);
      shown.forEach((g, k) => {
        if (isTable(g, w) && k) box.addSpacer(6);
        drawOne(box, g, w, gh);
        box.addSpacer(2);
        if (k === lastGraph) pressureAxis(box, view.axis, w, 8, theme);
      });
    }
    box.addSpacer();
    // 下の行：つぎの潮とまづめ（入るだけ）
    const foot = hrow(box, 8);
    const parts = [next.tide && next.tide.text, next.mazume && (next.mazume.now ? `いま${next.mazume.k}` : next.mazume.text), (d.sst || [])[i] != null && w >= 280 ? `水温 ${Math.round(d.sst[i])}℃` : ""].filter(Boolean);
    let left = w;
    parts.forEach((p) => {
      if (textWidth(p, 9) + 8 > left) return;
      left -= textWidth(p, 9) + 8;
      txt(foot, p, 9, theme.sub, "semibold", { scale: 0.7 });
    });
  },
});

async function copyParam(param) {
  Pasteboard.copyString(param);
  await say("コピーしました", param);
}

/** アプリのメニューから。おまかせの並びを、次々に見る */

async function say(title, message = "") {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addAction("OK");
  await a.presentAlert();
}

/** 許可をまとめて聞いて、結果を並べる（許可を聞けるのはアプリで動かしたときだけ） */

async function seaMenu() {
  const last = readCache("sea_menu") || {};
  const ask = new Alert();
  ask.title = "🌊 海（sea）の場所";
  ask.message = "港の名前・地名・緯度経度（例：城ヶ島 / 鴨川 / 32.7987,132.4959）。空なら今いる場所";
  ask.addTextField("城ヶ島", last.place || "");
  ask.addAction("次へ");
  ask.addCancelAction("やめる");
  if ((await ask.presentAlert()) < 0) return;
  // 「(32.79, 132.49)」のような書き方も。空白はカードの区切りなので外す
  const place = ask.textFieldValue(0).replace(/[（(）)]/g, "").replace(/[，、]/g, ",").replace(/\s*,\s*/g, ",").trim().replace(/\s+/g, "_");
  const sets = [
    ["おまかせ（大きさに合わせる）", []],
    ["波と潮", ["wave", "tide"]],
    ["風の表だけ", ["wind"]],
    ["波と風", ["wave", "wind"]],
    ["潮と風", ["tide", "wind"]],
    ["波・潮・風", ["wave", "tide", "wind"]],
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

/** Parameter に書くカレンダーの名前（空白はカードの区切りなので「_」に、「,」は外す） */

// ======================================
// 入口（sea だけ）
// Parameter：場所（城ヶ島 / 鴨川 / 32.7987,132.4959 / 空なら今いる場所）。
// 「,wave,tide,wind」で出すものを選び、「,deg」で風の向きを角度に。sea:城ヶ島 のように sea: から書いてもよい
// ======================================

function seaParam(raw) {
  const text = String(raw || "").trim();
  if (!text) return "sea";
  return /^(sea|海)([:.：]|$)/i.test(text) ? text : `sea:${text.replace(/\s+/g, "")}`;
}

/**
 * 新しい版があるか、12時間に1回だけ見る（ページの sea-version.json）。
 * 新しければ iPhone の通知で知らせる（同じ版は1回だけ）。押すと、ページの入れ方の所が開く
 */
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
    // 読めなくてもウィジェットは描く
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
