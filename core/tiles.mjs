/**
 * 牌的基础模型。
 *
 * 术语：
 * - `tile`：一张实体牌，带唯一 id，只在一副牌内有效。
 * - `kind`（牌种）：34 种花色点数组合之一，用 `man:5` 这样的字符串表示。
 *   牌骨与牌印作用在牌种上，本局内所有同名牌共享改造。
 *
 * @typedef {'man'|'pin'|'sou'|'honor'} Suit
 * @typedef {{ id: string, suit: Suit, rank: number }} Tile
 * @typedef {{ suit: Suit, rank: number }} TileSpec
 */

export const SUITS = Object.freeze({
  man: Object.freeze({ code: 'm', name: '万', order: 0, size: 9 }),
  pin: Object.freeze({ code: 'p', name: '筒', order: 1, size: 9 }),
  sou: Object.freeze({ code: 's', name: '条', order: 2, size: 9 }),
  honor: Object.freeze({ code: 'z', name: '字', order: 3, size: 7 }),
});

export const SUIT_ORDER = Object.freeze(['man', 'pin', 'sou', 'honor']);

export const HONORS = Object.freeze({
  E: Object.freeze({ rank: 1, glyph: '東', name: '东风' }),
  S: Object.freeze({ rank: 2, glyph: '南', name: '南风' }),
  W: Object.freeze({ rank: 3, glyph: '西', name: '西风' }),
  N: Object.freeze({ rank: 4, glyph: '北', name: '北风' }),
  R: Object.freeze({ rank: 5, glyph: '中', name: '红中' }),
  G: Object.freeze({ rank: 6, glyph: '發', name: '发财' }),
  B: Object.freeze({ rank: 7, glyph: '白', name: '白板' }),
});

const HONOR_CODE_BY_RANK = Object.freeze(
  Object.fromEntries(Object.entries(HONORS).map(([code, value]) => [value.rank, code])),
);

/** @returns {Tile} */
export function makeTile(id, suit, rank) {
  return Object.freeze({ id, suit, rank });
}

/** 牌种 key，例如 `man:5`。牌骨、牌印和牌型判定都用它。 */
export function tileKey(tile) {
  return `${tile.suit}:${tile.rank}`;
}

export function kindKey(suit, rank) {
  return `${suit}:${rank}`;
}

export function parseKind(key) {
  const [suit, rank] = key.split(':');
  return { suit: /** @type {Suit} */ (suit), rank: Number(rank) };
}

export function tileName(tile) {
  if (tile.suit === 'honor') return HONORS[HONOR_CODE_BY_RANK[tile.rank]].name;
  return `${tile.rank}${SUITS[tile.suit].name}`;
}

export function kindName(key) {
  return tileName(parseKind(key));
}

/** 全部 34 个牌种，顺序稳定，用于商店选牌种。 */
export const TILE_KINDS = Object.freeze(
  SUIT_ORDER.flatMap((suit) => Array.from(
    { length: SUITS[suit].size },
    (_, index) => kindKey(suit, index + 1),
  )),
);

/** 34 种牌的稳定索引，用于计数数组。 */
export function tileIndex(tile) {
  if (tile.suit === 'honor') return 27 + (tile.rank - 1);
  return SUITS[tile.suit].order * 9 + (tile.rank - 1);
}

/** @returns {TileSpec} */
export function indexToSpec(index) {
  if (index >= 27) return { suit: 'honor', rank: index - 27 + 1 };
  return { suit: /** @type {Suit} */ (SUIT_ORDER[Math.floor(index / 9)]), rank: (index % 9) + 1 };
}

export function countsOf(tiles) {
  const counts = new Array(34).fill(0);
  for (const tile of tiles) counts[tileIndex(tile)] += 1;
  return counts;
}

export function isTerminalTile(tile) {
  return tile.suit === 'honor' || tile.rank === 1 || tile.rank === 9;
}

export function compareTiles(left, right) {
  return SUITS[left.suit].order - SUITS[right.suit].order
    || left.rank - right.rank
    || String(left.id).localeCompare(String(right.id));
}

export function sortTiles(tiles) {
  return [...tiles].sort(compareTiles);
}

/**
 * 牌谱记法：`123m 99p EE`。用于测试与固定牌谱。
 * @returns {TileSpec[]}
 */
export function parseTileNotation(notation) {
  if (Array.isArray(notation)) return notation.flatMap((part) => parseTileNotation(part));
  if (typeof notation !== 'string') throw new TypeError('Tile notation must be a string or array.');

  const specs = [];
  for (const token of notation.trim().split(/\s+/).filter(Boolean)) {
    const suited = token.match(/^([1-9]+)([mps])$/);
    if (suited) {
      const suit = { m: 'man', p: 'pin', s: 'sou' }[suited[2]];
      for (const digit of suited[1]) specs.push(Object.freeze({ suit, rank: Number(digit) }));
      continue;
    }
    if (/^[ESWNRGB]+$/.test(token)) {
      for (const code of token) specs.push(Object.freeze({ suit: 'honor', rank: HONORS[code].rank }));
      continue;
    }
    throw new Error(`Unsupported tile notation token: ${token}`);
  }
  return specs;
}

/** xorshift32：可记录、可复盘的随机源。 */
export function createSeededRng(seed = 1) {
  let state = Number(seed) >>> 0 || 1;
  const rng = {
    next() {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state / 4294967296;
    },
    int(maxExclusive) {
      return Math.floor(rng.next() * maxExclusive);
    },
    pick(items) {
      return items[rng.int(items.length)];
    },
    /** 当前状态，存档用。 */
    get state() {
      return state >>> 0;
    },
    set state(next) {
      state = Number(next) >>> 0 || 1;
    },
  };
  return rng;
}

export function shuffleInPlace(items, rng) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = rng.int(index + 1);
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}
