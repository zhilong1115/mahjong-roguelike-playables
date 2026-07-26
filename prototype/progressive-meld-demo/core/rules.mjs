import { sortTiles, tileKey } from './tiles.mjs';

export const GROUPS = Object.freeze({
  pair: { cn: '将牌', en: 'PAIR', chips: 20, structuralSize: 2, slot: 'pair' },
  chow: { cn: '顺子', en: 'CHOW', chips: 30, structuralSize: 3, slot: 'meld' },
  pung: { cn: '刻子', en: 'PUNG', chips: 45, structuralSize: 3, slot: 'meld' },
  kong: { cn: '杠', en: 'KONG', chips: 80, structuralSize: 3, slot: 'meld' },
});

export const HU_PATTERN_MULTIPLIERS = Object.freeze({
  普通胡: 1,
  清一色: 2,
  一条龙: 1.5,
  大三元: 2.5,
  大四喜: 4,
});

function sameTile(tiles) {
  return tiles.every((tile) => tileKey(tile) === tileKey(tiles[0]));
}

function isChow(tiles) {
  if (tiles.length !== 3) return false;
  const sorted = sortTiles(tiles);
  if (sorted[0].suit === 'honor') return false;
  if (!sorted.every((tile) => tile.suit === sorted[0].suit)) return false;
  return sorted[1].rank === sorted[0].rank + 1
    && sorted[2].rank === sorted[1].rank + 1;
}

export function classifySelection(tiles) {
  if (tiles.length === 0) {
    return { valid: false, kind: null, reason: '请选择 1–4 张未整理牌' };
  }
  if (tiles.length === 1) {
    return { valid: true, kind: 'swap', cn: '换牌', en: 'SWAP' };
  }
  if (tiles.length === 2 && sameTile(tiles)) {
    return { valid: true, kind: 'pair', ...GROUPS.pair };
  }
  if (tiles.length === 3 && sameTile(tiles)) {
    return { valid: true, kind: 'pung', ...GROUPS.pung };
  }
  if (tiles.length === 3 && isChow(tiles)) {
    return { valid: true, kind: 'chow', ...GROUPS.chow };
  }
  if (tiles.length === 4 && sameTile(tiles)) {
    return { valid: true, kind: 'kong', ...GROUPS.kong };
  }
  if (tiles.length > 4) {
    return { valid: false, kind: null, reason: '一次最多选择 4 张' };
  }
  if (tiles.some((tile) => tile.suit === 'honor') && tiles.length === 3) {
    return { valid: false, kind: null, reason: '字牌不能组成顺子' };
  }
  return { valid: false, kind: null, reason: '这些牌不能组成对子、顺子、刻子或杠' };
}

export function structuralCount(looseTiles, groups) {
  return looseTiles.length + groups.reduce(
    (total, group) => total + GROUPS[group.kind].structuralSize,
    0,
  );
}

export function physicalCount(looseTiles, groups) {
  return looseTiles.length + groups.reduce((total, group) => total + group.tiles.length, 0);
}

function removeTiles(source, chosen) {
  const chosenIds = new Set(chosen.map((tile) => tile.id));
  return source.filter((tile) => !chosenIds.has(tile.id));
}

function candidatesForKey(tiles, key, amount) {
  return tiles.filter((tile) => tileKey(tile) === key).slice(0, amount);
}

function solveMelds(tiles, meldsNeeded) {
  if (meldsNeeded === 0) return tiles.length === 0 ? [] : null;
  if (tiles.length !== meldsNeeded * 3) return null;

  const sorted = sortTiles(tiles);
  const first = sorted[0];
  const key = tileKey(first);
  const triplet = candidatesForKey(sorted, key, 3);

  if (triplet.length === 3) {
    const restSolution = solveMelds(removeTiles(sorted, triplet), meldsNeeded - 1);
    if (restSolution) return [{ kind: 'pung', tiles: triplet }, ...restSolution];
  }

  if (first.suit !== 'honor' && first.rank <= 7) {
    const second = sorted.find(
      (tile) => tile.suit === first.suit && tile.rank === first.rank + 1,
    );
    const third = sorted.find(
      (tile) => tile.suit === first.suit && tile.rank === first.rank + 2,
    );
    if (second && third) {
      const chow = [first, second, third];
      const restSolution = solveMelds(removeTiles(sorted, chow), meldsNeeded - 1);
      if (restSolution) return [{ kind: 'chow', tiles: chow }, ...restSolution];
    }
  }

  return null;
}

function solveLoose(tiles, meldsNeeded, pairNeeded) {
  const expected = meldsNeeded * 3 + (pairNeeded ? 2 : 0);
  if (tiles.length !== expected) return null;

  if (!pairNeeded) return solveMelds(tiles, meldsNeeded);

  const sorted = sortTiles(tiles);
  const seen = new Set();
  for (const tile of sorted) {
    const key = tileKey(tile);
    if (seen.has(key)) continue;
    seen.add(key);
    const pair = candidatesForKey(sorted, key, 2);
    if (pair.length !== 2) continue;
    const melds = solveMelds(removeTiles(sorted, pair), meldsNeeded);
    if (melds) return [{ kind: 'pair', tiles: pair }, ...melds];
  }
  return null;
}

export function findHuSolution(looseTiles, lockedGroups = []) {
  const lockedPairCount = lockedGroups.filter((group) => group.kind === 'pair').length;
  const lockedMeldCount = lockedGroups.filter((group) => group.kind !== 'pair').length;

  if (lockedPairCount > 1 || lockedMeldCount > 4) return null;
  if (structuralCount(looseTiles, lockedGroups) !== 14) return null;

  const solvedLoose = solveLoose(
    looseTiles,
    4 - lockedMeldCount,
    lockedPairCount === 0,
  );

  if (!solvedLoose) return null;
  return [...lockedGroups, ...solvedLoose];
}

export function findUnlockedHuSolution(looseTiles, lockedGroups = []) {
  if (lockedGroups.some((group) => group.kind === 'kong')) return null;
  const allTiles = [...looseTiles, ...lockedGroups.flatMap((group) => group.tiles)];
  return solveLoose(allTiles, 4, true);
}

export function detectHuPatterns(groups) {
  const tiles = groups.flatMap((group) => group.tiles);
  const numberedSuits = new Set(tiles.filter((tile) => tile.suit !== 'honor').map((tile) => tile.suit));
  const hasHonors = tiles.some((tile) => tile.suit === 'honor');
  const tags = [];

  if (!hasHonors && numberedSuits.size === 1) tags.push('清一色');

  for (const suit of ['man', 'pin', 'sou']) {
    const starts = new Set(
      groups
        .filter((group) => group.kind === 'chow' && group.tiles[0].suit === suit)
        .map((group) => Math.min(...group.tiles.map((tile) => tile.rank))),
    );
    if (starts.has(1) && starts.has(4) && starts.has(7)) tags.push('一条龙');
  }

  const tripletKeys = new Set(
    groups
      .filter((group) => group.kind === 'pung' || group.kind === 'kong')
      .map((group) => tileKey(group.tiles[0])),
  );
  if ([5, 6, 7].every((rank) => tripletKeys.has(`honor:${rank}`))) tags.push('大三元');
  if ([1, 2, 3, 4].every((rank) => tripletKeys.has(`honor:${rank}`))) tags.push('大四喜');

  return tags.length ? tags : ['普通胡'];
}

export function groupBaseChips(group) {
  return GROUPS[group.kind].chips;
}

export function scoreGroups(groups, { includeHuBonus = false } = {}) {
  let chips = groups.reduce((sum, group) => sum + groupBaseChips(group), 0);
  const fortuneEvents = [];

  const chowCount = groups.filter((group) => group.kind === 'chow').length;
  if (chowCount) {
    const bonus = chowCount * 10;
    chips += bonus;
    fortuneEvents.push({ name: '青龙签', value: bonus, text: `顺子 ×${chowCount}` });
  }

  const honorMeldCount = groups.filter(
    (group) => group.kind !== 'pair' && group.tiles[0].suit === 'honor',
  ).length;
  if (honorMeldCount) {
    const bonus = honorMeldCount * 15;
    chips += bonus;
    fortuneEvents.push({ name: '百福印', value: bonus, text: `字牌面子 ×${honorMeldCount}` });
  }

  const pairCount = groups.filter((group) => group.kind === 'pair').length;
  if (pairCount) {
    chips += 5;
    fortuneEvents.push({ name: '同心结', value: 5, text: '将牌成双' });
  }

  const patterns = detectHuPatterns(groups);
  const patternMult = includeHuBonus
    ? patterns.reduce((mult, pattern) => mult * HU_PATTERN_MULTIPLIERS[pattern], 1)
    : 1;
  const baseMult = 4;
  const mult = baseMult * patternMult;

  return {
    chips,
    baseMult,
    patternMult,
    mult,
    total: chips * mult,
    patterns,
    fortuneEvents,
  };
}
