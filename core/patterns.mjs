/**
 * 胡牌分解与番种识别。这里只回答「这 14 张能不能胡、算什么番」，不涉及计分与内容。
 *
 * @typedef {import('./tiles.mjs').Tile} Tile
 * @typedef {'pair'|'chow'|'pung'|'kong'} GroupKind
 * @typedef {{ id: string, kind: GroupKind, tiles: Tile[], revealed: boolean, charmId?: string|null }} Group
 * @typedef {{ shape: 'standard'|'sevenPairs', groups: Group[] }} Solution
 */

import { sortTiles, tileKey } from './tiles.mjs';

export const GROUPS = Object.freeze({
  pair: Object.freeze({ kind: 'pair', name: '对子', structuralSize: 2 }),
  chow: Object.freeze({ kind: 'chow', name: '顺子', structuralSize: 3 }),
  pung: Object.freeze({ kind: 'pung', name: '刻子', structuralSize: 3 }),
  kong: Object.freeze({ kind: 'kong', name: '杠', structuralSize: 3 }),
});

export const GROUP_NAMES = Object.freeze({ pair: '对子', chow: '顺子', pung: '刻子', kong: '杠' });

/** 结构牌数：杠占 3 个结构位，第四张是附加实体牌。 */
export function structuralCount(looseTiles, revealedGroups = []) {
  return looseTiles.length + revealedGroups.reduce(
    (total, group) => total + (GROUPS[group.kind]?.structuralSize ?? 0),
    0,
  );
}

export function physicalCount(looseTiles, revealedGroups = []) {
  return looseTiles.length + revealedGroups.reduce((total, group) => total + group.tiles.length, 0);
}

function sameTile(tiles) {
  return tiles.length > 0 && tiles.every((tile) => tileKey(tile) === tileKey(tiles[0]));
}

function isChow(tiles) {
  if (tiles.length !== 3) return false;
  const sorted = sortTiles(tiles);
  return sorted[0].suit !== 'honor'
    && sorted.every((tile) => tile.suit === sorted[0].suit)
    && sorted[1].rank === sorted[0].rank + 1
    && sorted[2].rank === sorted[1].rank + 1;
}

/** 把当前选中的 1–4 张牌翻译成一个明确动作。 */
export function classifySelection(tiles) {
  if (tiles.length === 0) return { valid: false, kind: null, reason: '请选择 1–4 张牌' };
  if (tiles.length > 4) return { valid: false, kind: null, reason: '一次最多选择 4 张牌' };
  if (tiles.length === 1) return { valid: true, kind: 'swap', name: '换牌' };
  if (tiles.length === 2 && sameTile(tiles)) return { valid: true, ...GROUPS.pair };
  if (tiles.length === 3 && sameTile(tiles)) return { valid: true, ...GROUPS.pung };
  if (tiles.length === 3 && isChow(tiles)) return { valid: true, ...GROUPS.chow };
  if (tiles.length === 4 && sameTile(tiles)) return { valid: true, ...GROUPS.kong };
  return { valid: false, kind: null, reason: '这些牌不能组成对子、顺子、刻子或杠' };
}

function removeTiles(source, chosen) {
  const chosenIds = new Set(chosen.map((tile) => tile.id));
  return source.filter((tile) => !chosenIds.has(tile.id));
}

function candidatesForKey(tiles, key, amount) {
  return tiles.filter((tile) => tileKey(tile) === key).slice(0, amount);
}

function makeAutoGroup(kind, tiles) {
  const sorted = sortTiles(tiles);
  return {
    id: `auto:${kind}:${sorted.map((tile) => tile.id).join(',')}`,
    kind,
    tiles: sorted,
    revealed: false,
  };
}

function enumerateMelds(tiles, meldsNeeded) {
  if (meldsNeeded === 0) return tiles.length === 0 ? [[]] : [];
  if (tiles.length !== meldsNeeded * 3) return [];

  const sorted = sortTiles(tiles);
  const first = sorted[0];
  const solutions = [];
  const pungTiles = candidatesForKey(sorted, tileKey(first), 3);

  if (pungTiles.length === 3) {
    for (const rest of enumerateMelds(removeTiles(sorted, pungTiles), meldsNeeded - 1)) {
      solutions.push([makeAutoGroup('pung', pungTiles), ...rest]);
    }
  }

  if (first.suit !== 'honor' && first.rank <= 7) {
    const second = sorted.find((tile) => tile.suit === first.suit && tile.rank === first.rank + 1);
    const third = sorted.find((tile) => tile.suit === first.suit && tile.rank === first.rank + 2);
    if (second && third) {
      const chowTiles = [first, second, third];
      for (const rest of enumerateMelds(removeTiles(sorted, chowTiles), meldsNeeded - 1)) {
        solutions.push([makeAutoGroup('chow', chowTiles), ...rest]);
      }
    }
  }
  return solutions;
}

function enumerateStandardSolutions(looseTiles, revealedGroups) {
  const pairCount = revealedGroups.filter((group) => group.kind === 'pair').length;
  const meldCount = revealedGroups.filter((group) => group.kind !== 'pair').length;
  if (pairCount > 1 || meldCount > 4) return [];

  const meldsNeeded = 4 - meldCount;
  const pairNeeded = pairCount === 0;
  const expected = meldsNeeded * 3 + (pairNeeded ? 2 : 0);
  if (looseTiles.length !== expected) return [];

  const looseSolutions = [];
  if (!pairNeeded) {
    looseSolutions.push(...enumerateMelds(looseTiles, meldsNeeded));
  } else {
    const sorted = sortTiles(looseTiles);
    const seen = new Set();
    for (const tile of sorted) {
      const key = tileKey(tile);
      if (seen.has(key)) continue;
      seen.add(key);
      const pairTiles = candidatesForKey(sorted, key, 2);
      if (pairTiles.length !== 2) continue;
      for (const melds of enumerateMelds(removeTiles(sorted, pairTiles), meldsNeeded)) {
        looseSolutions.push([makeAutoGroup('pair', pairTiles), ...melds]);
      }
    }
  }

  return looseSolutions.map((groups) => ({ shape: 'standard', groups: [...revealedGroups, ...groups] }));
}

function enumerateSevenPairsSolutions(looseTiles, revealedGroups) {
  if (revealedGroups.some((group) => group.kind !== 'pair')) return [];
  if (revealedGroups.length > 7) return [];

  const lockedKeys = revealedGroups.map((group) => tileKey(group.tiles[0]));
  if (new Set(lockedKeys).size !== lockedKeys.length) return [];
  if (looseTiles.length !== (7 - revealedGroups.length) * 2) return [];

  const buckets = new Map();
  for (const tile of looseTiles) {
    const key = tileKey(tile);
    const bucket = buckets.get(key) ?? [];
    bucket.push(tile);
    buckets.set(key, bucket);
  }
  if (buckets.size !== 7 - revealedGroups.length) return [];
  if ([...buckets.values()].some((tiles) => tiles.length !== 2)) return [];
  if ([...buckets.keys()].some((key) => lockedKeys.includes(key))) return [];

  const pairs = [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, tiles]) => makeAutoGroup('pair', tiles));
  return [{ shape: 'sevenPairs', groups: [...revealedGroups, ...pairs] }];
}

function groupSignature(group) {
  return `${group.kind}:${group.tiles.map(tileKey).sort().join(',')}`;
}

export function solutionSignature(solution) {
  return `${solution.shape}|${solution.groups.map(groupSignature).sort().join('|')}`;
}

/** @returns {Solution[]} 所有合法分解；已亮组是硬约束。 */
export function findHuSolutions(looseTiles, revealedGroups = []) {
  if (structuralCount(looseTiles, revealedGroups) !== 14) return [];
  if (!revealedGroups.every((group) => GROUPS[group.kind])) return [];

  const all = [
    ...enumerateStandardSolutions(looseTiles, revealedGroups),
    ...enumerateSevenPairsSolutions(looseTiles, revealedGroups),
  ];
  const unique = new Map();
  for (const solution of all) unique.set(solutionSignature(solution), solution);
  return [...unique.values()];
}

export const PATTERNS = Object.freeze({
  普通胡: { id: '普通胡', name: '普通胡' },
  门清: { id: '门清', name: '门清' },
  七对: { id: '七对', name: '七对' },
  碰碰胡: { id: '碰碰胡', name: '碰碰胡' },
  清一色: { id: '清一色', name: '清一色' },
  一条龙: { id: '一条龙', name: '一条龙' },
  大三元: { id: '大三元', name: '大三元' },
  大四喜: { id: '大四喜', name: '大四喜' },
});

/** @returns {string[]} 番种名列表，普通胡总在第一位，门清在最后。 */
export function detectPatterns(solution, { concealed = false } = {}) {
  const { groups, shape } = solution;
  const patterns = [];
  if (shape === 'sevenPairs') patterns.push('七对');

  const melds = groups.filter((group) => group.kind !== 'pair');
  if (shape === 'standard' && melds.length === 4
      && melds.every((group) => group.kind === 'pung' || group.kind === 'kong')) {
    patterns.push('碰碰胡');
  }

  const tiles = groups.flatMap((group) => group.tiles);
  const numberedSuits = new Set(tiles.filter((tile) => tile.suit !== 'honor').map((tile) => tile.suit));
  if (!tiles.some((tile) => tile.suit === 'honor') && numberedSuits.size === 1) patterns.push('清一色');

  if (shape === 'standard') {
    for (const suit of ['man', 'pin', 'sou']) {
      const starts = new Set(
        groups
          .filter((group) => group.kind === 'chow' && group.tiles[0].suit === suit)
          .map((group) => Math.min(...group.tiles.map((tile) => tile.rank))),
      );
      if (starts.has(1) && starts.has(4) && starts.has(7)) {
        patterns.push('一条龙');
        break;
      }
    }
  }

  const tripletKeys = new Set(
    groups
      .filter((group) => group.kind === 'pung' || group.kind === 'kong')
      .map((group) => tileKey(group.tiles[0])),
  );
  if ([5, 6, 7].every((rank) => tripletKeys.has(`honor:${rank}`))) patterns.push('大三元');
  if ([1, 2, 3, 4].every((rank) => tripletKeys.has(`honor:${rank}`))) patterns.push('大四喜');

  if (!patterns.length) patterns.push('普通胡');
  if (concealed) patterns.push('门清');
  return patterns;
}

/** 亮出这些组之后，是否还剩至少一条胡牌路线。 */
export function routeRemains(revealedGroups) {
  const pairs = revealedGroups.filter((group) => group.kind === 'pair');
  const melds = revealedGroups.filter((group) => group.kind !== 'pair');
  const standardPossible = pairs.length <= 1 && melds.length <= 4;
  const pairKeys = pairs.map((group) => tileKey(group.tiles[0]));
  const sevenPairsPossible = melds.length === 0
    && pairs.length <= 6
    && new Set(pairKeys).size === pairKeys.length;
  return standardPossible || sevenPairsPossible;
}
