/**
 * 番谱：百宝阁购买后立即使用，让一个番种等级 +1，本局有效。
 * 不进手牌、不占将位、不改变胡牌资格；首轮只加牌值，不加番势。
 */

export const CODEX_MAX_LEVEL = 3;
export const CODEX_CHIPS_PER_LEVEL = 24;

function codexBook(spec) {
  return Object.freeze({
    family: 'codex',
    duration: '本局',
    glyph: '谱',
    maxLevel: CODEX_MAX_LEVEL,
    ...spec,
  });
}

export const CODEX = Object.freeze({
  sevenPairs: codexBook({
    id: 'sevenPairs',
    name: '七巧谱',
    pattern: '七对',
    price: 6,
    text: `七对 Lv.+1；成七对时每级 +${CODEX_CHIPS_PER_LEVEL} 牌值。`,
  }),
  dragon: codexBook({
    id: 'dragon',
    name: '游龙谱',
    pattern: '一条龙',
    price: 6,
    text: `一条龙 Lv.+1；成一条龙时每级 +${CODEX_CHIPS_PER_LEVEL} 牌值。`,
  }),
  pureSuit: codexBook({
    id: 'pureSuit',
    name: '清一谱',
    pattern: '清一色',
    price: 6,
    text: `清一色 Lv.+1；成清一色时每级 +${CODEX_CHIPS_PER_LEVEL} 牌值。`,
  }),
});

export const CODEX_LIST = Object.freeze(Object.values(CODEX));

/** 番种名 → 番谱，用来给商店做「匹配下一轮目标」的定向保底。 */
export const CODEX_BY_PATTERN = Object.freeze(
  Object.fromEntries(CODEX_LIST.map((book) => [book.pattern, book])),
);
