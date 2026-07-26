/**
 * 「还差几张」：在当前 14 张结构上，最少换掉几张就能胡。
 * 同时考虑普通胡与七对，取较近的一条路线。0 表示已经可以胡。
 */

import { GROUPS, structuralCount } from './patterns.mjs';
import { countsOf, indexToSpec, tileKey } from './tiles.mjs';

function serialize(counts, meldsLeft, pairLeft) {
  return `${counts.join(',')}|${meldsLeft}|${pairLeft}`;
}

/** 在剩余槽位里最多能留住几张现有牌。 */
function bestRetained(counts, meldsLeft, pairLeft, memo) {
  if (meldsLeft === 0 && pairLeft === 0) return 0;
  const key = serialize(counts, meldsLeft, pairLeft);
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  let index = 0;
  while (index < 34 && counts[index] === 0) index += 1;
  if (index === 34) return 0;

  const take = (spend) => {
    const next = [...counts];
    for (const [position, amount] of spend) next[position] -= amount;
    return next;
  };

  // 丢掉这张
  let best = bestRetained(take([[index, 1]]), meldsLeft, pairLeft, memo);

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
  const counts = countsOf(usable)
    .filter((count) => count > 0)
    .map((count) => Math.min(count, 2))
    .sort((left, right) => right - left);
  return counts.slice(0, pairsNeeded).reduce((sum, value) => sum + value, 0);
}

export function tilesToChange(looseTiles, revealedGroups = []) {
  if (structuralCount(looseTiles, revealedGroups) !== 14) return Infinity;
  if (!revealedGroups.every((group) => GROUPS[group.kind])) return Infinity;

  const options = [];
  const pairCount = revealedGroups.filter((group) => group.kind === 'pair').length;
  const meldCount = revealedGroups.filter((group) => group.kind !== 'pair').length;

  if (pairCount <= 1 && meldCount <= 4) {
    const retained = bestRetained(
      countsOf(looseTiles),
      4 - meldCount,
      pairCount === 0 ? 1 : 0,
      new Map(),
    );
    options.push(looseTiles.length - retained);
  }

  const sevenPairs = sevenPairsRetained(looseTiles, revealedGroups);
  if (sevenPairs !== null) options.push(looseTiles.length - sevenPairs);

  return options.length ? Math.min(...options) : Infinity;
}
