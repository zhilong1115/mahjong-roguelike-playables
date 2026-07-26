export const SUITS = Object.freeze({
  man: Object.freeze({ code: 'm', name: '万', order: 0 }),
  pin: Object.freeze({ code: 'p', name: '筒', order: 1 }),
  sou: Object.freeze({ code: 's', name: '条', order: 2 }),
  honor: Object.freeze({ code: 'z', name: '字', order: 3 }),
});

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

export const SUIT_ORDER = Object.freeze(['man', 'pin', 'sou', 'honor']);

export function makeTile(id, suit, rank) {
  return Object.freeze({ id, suit, rank });
}

export function tileKey(tile) {
  return `${tile.suit}:${tile.rank}`;
}


export function tileName(tile) {
  if (tile.suit === 'honor') return HONORS[HONOR_CODE_BY_RANK[tile.rank]].name;
  return `${tile.rank}${SUITS[tile.suit].name}`;
}

/** 34 种牌型的稳定索引，用于计数数组和距离计算。 */
export function tileIndex(tile) {
  if (tile.suit === 'honor') return 27 + (tile.rank - 1);
  return SUITS[tile.suit].order * 9 + (tile.rank - 1);
}

export function indexToSpec(index) {
  if (index >= 27) return { suit: 'honor', rank: index - 27 + 1 };
  const suit = SUIT_ORDER[Math.floor(index / 9)];
  return { suit, rank: (index % 9) + 1 };
}

export function countsOf(tiles) {
  const counts = new Array(34).fill(0);
  for (const tile of tiles) counts[tileIndex(tile)] += 1;
  return counts;
}

export function compareTiles(left, right) {
  return SUITS[left.suit].order - SUITS[right.suit].order
    || left.rank - right.rank
    || String(left.id).localeCompare(String(right.id));
}

export function sortTiles(tiles) {
  return [...tiles].sort(compareTiles);
}

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

export function buildStandardWall(idPrefix = 't') {
  const wall = [];
  let serial = 1;
  for (const suit of ['man', 'pin', 'sou']) {
    for (let rank = 1; rank <= 9; rank += 1) {
      for (let copy = 0; copy < 4; copy += 1) {
        wall.push(makeTile(`${idPrefix}${serial++}`, suit, rank));
      }
    }
  }
  for (let rank = 1; rank <= 7; rank += 1) {
    for (let copy = 0; copy < 4; copy += 1) {
      wall.push(makeTile(`${idPrefix}${serial++}`, 'honor', rank));
    }
  }
  return wall;
}

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
    get state() {
      return state >>> 0;
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
