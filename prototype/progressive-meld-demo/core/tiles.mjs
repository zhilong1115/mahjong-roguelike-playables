export const SUITS = Object.freeze({
  man: { cn: '万', en: 'Characters', order: 0 },
  pin: { cn: '筒', en: 'Dots', order: 1 },
  sou: { cn: '条', en: 'Bamboo', order: 2 },
  honor: { cn: '字', en: 'Honors', order: 3 },
});

export const HONORS = Object.freeze({
  1: { glyph: '東', cn: '东风', en: 'East' },
  2: { glyph: '南', cn: '南风', en: 'South' },
  3: { glyph: '西', cn: '西风', en: 'West' },
  4: { glyph: '北', cn: '北风', en: 'North' },
  5: { glyph: '中', cn: '红中', en: 'Red Dragon' },
  6: { glyph: '發', cn: '发财', en: 'Green Dragon' },
  7: { glyph: '白', cn: '白板', en: 'White Dragon' },
});

export function makeTile(id, suit, rank) {
  return Object.freeze({ id, suit, rank });
}

export function tileKey(tile) {
  return `${tile.suit}:${tile.rank}`;
}

export function tileName(tile) {
  if (tile.suit === 'honor') return HONORS[tile.rank].cn;
  return `${tile.rank}${SUITS[tile.suit].cn}`;
}

export function tileAriaLabel(tile) {
  if (tile.suit === 'honor') return `${HONORS[tile.rank].cn}，字牌`;
  return `${tile.rank}${SUITS[tile.suit].cn}`;
}

export function compareTiles(left, right) {
  return SUITS[left.suit].order - SUITS[right.suit].order
    || left.rank - right.rank
    || String(left.id).localeCompare(String(right.id));
}

export function sortTiles(tiles) {
  return [...tiles].sort(compareTiles);
}

export function buildStandardWall() {
  const wall = [];
  let id = 1;
  for (const suit of ['man', 'pin', 'sou']) {
    for (let rank = 1; rank <= 9; rank += 1) {
      for (let copy = 0; copy < 4; copy += 1) {
        wall.push(makeTile(`t${id++}`, suit, rank));
      }
    }
  }
  for (let rank = 1; rank <= 7; rank += 1) {
    for (let copy = 0; copy < 4; copy += 1) {
      wall.push(makeTile(`t${id++}`, 'honor', rank));
    }
  }
  return wall;
}
