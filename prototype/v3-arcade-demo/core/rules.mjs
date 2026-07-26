import { CHARMS, GENERALS, SCORING } from '../content/content.mjs';
import { countsOf, indexToSpec, sortTiles, tileKey } from './tiles.mjs';

export const GROUPS = Object.freeze({
  pair: Object.freeze({ kind: 'pair', name: '对子', structuralSize: 2 }),
  chow: Object.freeze({ kind: 'chow', name: '顺子', structuralSize: 3 }),
  pung: Object.freeze({ kind: 'pung', name: '刻子', structuralSize: 3 }),
  kong: Object.freeze({ kind: 'kong', name: '杠', structuralSize: 3 }),
});

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

export function structuralCount(looseTiles, revealedGroups = []) {
  return looseTiles.length + revealedGroups.reduce(
    (total, group) => total + (GROUPS[group.kind]?.structuralSize ?? 0),
    0,
  );
}

export function physicalCount(looseTiles, revealedGroups = []) {
  return looseTiles.length + revealedGroups.reduce((total, group) => total + group.tiles.length, 0);
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

function solutionSignature(solution) {
  return `${solution.shape}|${solution.groups.map(groupSignature).sort().join('|')}`;
}

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

export function detectPatterns(solution, { concealed = false } = {}) {
  const { groups, shape } = solution;
  const patterns = [];
  const finish = () => {
    if (!patterns.length) patterns.push('普通胡');
    if (concealed) patterns.push('门清');
    return patterns;
  };
  if (shape === 'sevenPairs') patterns.push('七对');

  const melds = groups.filter((group) => group.kind !== 'pair');
  if (shape === 'standard' && melds.length === 4
      && melds.every((group) => group.kind === 'pung' || group.kind === 'kong')) {
    patterns.push('碰碰胡');
  }

  const tiles = groups.flatMap((group) => group.tiles);
  const numberedSuits = new Set(tiles.filter((tile) => tile.suit !== 'honor').map((tile) => tile.suit));
  const hasHonors = tiles.some((tile) => tile.suit === 'honor');
  if (!hasHonors && numberedSuits.size === 1) patterns.push('清一色');

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

  return finish();
}

/* =========================================================
   计分：牌值 CHIPS × 番势 MULT
   ========================================================= */

function countGroups(groups, kinds) {
  return groups.filter((group) => kinds.includes(group.kind)).length;
}

function isTerminal(tile) {
  return tile.suit === 'honor' || tile.rank === 1 || tile.rank === 9;
}

function applyEffects(effects, context) {
  let chips = 0;
  let mult = 0;
  let gold = 0;
  for (const effect of effects) {
    switch (effect.kind) {
      case 'chipsFlat':
        chips += effect.value;
        break;
      case 'chipsPerGroup':
        chips += countGroups(context.groups, effect.groupKinds) * effect.value;
        break;
      case 'chipsPerTile':
        chips += context.tiles.filter((tile) => tile.suit === effect.suit).length * effect.value;
        break;
      case 'chipsPerTerminal':
        chips += context.tiles.filter(isTerminal).length * effect.value;
        break;
      case 'chipsPerRemainingSwap':
        chips += context.swapsRemaining * effect.value;
        break;
      case 'chipsPerReveal':
        chips += context.revealCount * effect.value;
        break;
      case 'chipsIfPattern':
        if (context.patterns.includes(effect.pattern)) chips += effect.value;
        break;
      case 'multFlat':
        mult += effect.value;
        break;
      case 'multIfGroupCount':
        if (countGroups(context.groups, effect.groupKinds) >= effect.min) mult += effect.value;
        break;
      case 'multIfPattern':
        if (context.patterns.includes(effect.pattern)) mult += effect.value;
        break;
      case 'goldPerEmptySlot':
        gold += context.emptySlots * effect.value;
        break;
      default:
        break;
    }
  }
  return { chips, mult, gold };
}

export function scoreSolution(solution, options = {}) {
  const {
    charmIds = [],
    generalIds = [],
    swapsRemaining = 0,
    revealCount = 0,
    emptySlots = 0,
  } = options;

  const patterns = detectPatterns(solution, { concealed: revealCount === 0 });
  const tiles = solution.groups.flatMap((group) => group.tiles);
  const context = { groups: solution.groups, tiles, swapsRemaining, revealCount, emptySlots, patterns };

  const groupChips = solution.groups.reduce(
    (sum, group) => sum + SCORING.groupChips[group.kind],
    0,
  );

  let bonusChips = 0;
  let bonusMult = 0;
  let bonusGold = 0;
  const events = [];

  for (const charmId of charmIds) {
    const charm = CHARMS[charmId];
    if (!charm) continue;
    const result = applyEffects(charm.effects, context);
    bonusChips += result.chips;
    bonusMult += result.mult;
    bonusGold += result.gold;
    events.push({ source: 'charm', id: charm.id, name: charm.name, glyph: charm.glyph, ...result });
  }

  for (const generalId of generalIds) {
    const general = GENERALS[generalId];
    if (!general) continue;
    const result = applyEffects(general.effects, context);
    bonusChips += result.chips;
    bonusMult += result.mult;
    bonusGold += result.gold;
    events.push({ source: 'general', id: general.id, name: general.name, glyph: general.glyph, ...result });
  }

  const calmChips = emptySlots * SCORING.emptySlotChips;
  if (calmChips) {
    events.unshift({
      source: 'slots',
      id: 'calm',
      name: `静心（空位 ${emptySlots} × ${SCORING.emptySlotChips}）`,
      chips: calmChips,
      mult: 0,
      gold: 0,
    });
  }

  const patternMult = patterns.reduce((sum, pattern) => sum + (SCORING.patternMult[pattern] ?? 0), 0);
  const chips = SCORING.huBase + groupChips + calmChips + bonusChips;
  const mult = Math.max(1, 1 + patternMult + bonusMult);
  const total = Math.floor(chips * mult);

  return {
    ...solution,
    patterns,
    huBase: SCORING.huBase,
    groupChips,
    calmChips,
    bonusChips,
    bonusMult,
    bonusGold,
    patternMult,
    chips,
    mult,
    total,
    events,
  };
}

export function findBestHu(looseTiles, revealedGroups = [], options = {}) {
  const scored = findHuSolutions(looseTiles, revealedGroups)
    .map((solution) => scoreSolution(solution, options));
  scored.sort((left, right) => right.total - left.total
    || right.patterns.length - left.patterns.length
    || solutionSignature(left).localeCompare(solutionSignature(right)));
  return scored[0] ?? null;
}

/* =========================================================
   距离：还要换掉几张牌才能胡
   ========================================================= */

function serialize(counts, meldsLeft, pairLeft) {
  return `${counts.join(',')}|${meldsLeft}|${pairLeft}`;
}

function bestRetained(counts, meldsLeft, pairLeft, memo) {
  if (meldsLeft === 0 && pairLeft === 0) return 0;
  const key = serialize(counts, meldsLeft, pairLeft);
  if (memo.has(key)) return memo.get(key);

  let index = 0;
  while (index < 34 && counts[index] === 0) index += 1;
  if (index === 34) return 0;

  let best = 0;
  const take = (spend) => {
    const next = [...counts];
    for (const [position, amount] of spend) next[position] -= amount;
    return next;
  };

  // 丢掉这张
  best = Math.max(best, bestRetained(take([[index, 1]]), meldsLeft, pairLeft, memo));

  if (meldsLeft > 0) {
    const same = Math.min(counts[index], 3);
    best = Math.max(best, same + bestRetained(take([[index, same]]), meldsLeft - 1, pairLeft, memo));

    const spec = indexToSpec(index);
    if (spec.suit !== 'honor' && spec.rank <= 7) {
      const spend = [[index, 1]];
      let used = 1;
      for (const offset of [1, 2]) {
        if (counts[index + offset] > 0) {
          spend.push([index + offset, 1]);
          used += 1;
        }
      }
      best = Math.max(best, used + bestRetained(take(spend), meldsLeft - 1, pairLeft, memo));
    }
  }

  if (pairLeft > 0) {
    const same = Math.min(counts[index], 2);
    best = Math.max(best, same + bestRetained(take([[index, same]]), meldsLeft, pairLeft - 1, memo));
  }

  memo.set(key, best);
  return best;
}

function sevenPairsRetained(looseTiles, revealedGroups) {
  if (revealedGroups.some((group) => group.kind !== 'pair')) return null;
  const lockedKeys = new Set(revealedGroups.map((group) => tileKey(group.tiles[0])));
  if (lockedKeys.size !== revealedGroups.length) return null;
  const pairsNeeded = 7 - revealedGroups.length;
  if (pairsNeeded <= 0) return null;

  const usable = looseTiles.filter((tile) => !lockedKeys.has(tileKey(tile)));
  const counts = countsOf(usable).filter((count) => count > 0).map((count) => Math.min(count, 2));
  counts.sort((left, right) => right - left);
  return counts.slice(0, pairsNeeded).reduce((sum, value) => sum + value, 0);
}

/**
 * 还需要换掉几张散牌才能胡。0 表示已经可以胡。
 * 同时考虑普通胡和七对两条路线，取较近的一条。
 */
export function tilesToChange(looseTiles, revealedGroups = []) {
  if (structuralCount(looseTiles, revealedGroups) !== 14) return Infinity;

  const options = [];
  const pairCount = revealedGroups.filter((group) => group.kind === 'pair').length;
  const meldCount = revealedGroups.filter((group) => group.kind !== 'pair').length;

  if (pairCount <= 1 && meldCount <= 4) {
    const meldsLeft = 4 - meldCount;
    const pairLeft = pairCount === 0 ? 1 : 0;
    const retained = bestRetained(countsOf(looseTiles), meldsLeft, pairLeft, new Map());
    options.push(looseTiles.length - retained);
  }

  const sevenPairs = sevenPairsRetained(looseTiles, revealedGroups);
  if (sevenPairs !== null) options.push(looseTiles.length - sevenPairs);

  return options.length ? Math.min(...options) : Infinity;
}

/** 亮出这一组之后，是否还有任何胡牌路线可走。 */
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
