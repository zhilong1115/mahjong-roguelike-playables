/** 测试用的「会打牌的玩家」：先看离胡多远，再优先丢孤张，不丢马上要摸的同种牌。 */

import { tilesToChange } from '../../src/core/shanten.mjs';
import { makeTile, parseTileNotation, sortTiles, tileKey } from '../../src/core/tiles.mjs';

export function hand(notation) {
  return sortTiles(
    parseTileNotation(notation).map((spec, index) => makeTile(`t${index}`, spec.suit, spec.rank)),
  );
}

export function group(kind, notation) {
  return { id: `g-${kind}-${notation}`, kind, tiles: hand(notation), revealed: true };
}

function support(tile, tiles) {
  return tiles.reduce((score, other) => {
    if (other.id === tile.id || other.suit !== tile.suit) return score;
    if (other.rank === tile.rank) return score + 3;
    if (tile.suit === 'honor') return score;
    const gap = Math.abs(other.rank - tile.rank);
    return gap === 1 ? score + 2 : gap === 2 ? score + 1 : score;
  }, 0);
}

/** 单张换牌：一次只丢一张，最保守的打法。 */
export function smartSwap(run) {
  const next = run.wall[0];
  if (!next) return false;
  let best = null;
  for (const tile of run.looseTiles) {
    if (tileKey(tile) === tileKey(next)) continue;
    const candidate = [...run.looseTiles.filter((item) => item.id !== tile.id), next];
    const distance = tilesToChange(candidate, run.revealedGroups);
    const lonely = -support(tile, run.looseTiles);
    if (!best || distance < best.distance
      || (distance === best.distance && lonely > best.lonely)) best = { tile, distance, lonely };
  }
  if (!best) return false;
  run.clearSelection();
  run.toggleTile(best.tile.id);
  return run.swapSelected().ok;
}

/**
 * 会用「一次换多张」的打法：看得见的两张都有用就一次换两张，
 * 省下来的换牌次数在胡牌时换金币。
 */
export function batchSwap(run) {
  const preview = run.wall.slice(0, 2);
  if (!preview.length) return false;
  const candidates = run.looseTiles.filter(
    (tile) => !preview.some((next) => tileKey(next) === tileKey(tile)),
  );
  if (!candidates.length) return false;

  // 比较顺序：先看换完离胡多远，其次少换几张，最后丢最孤的牌
  let best = null;
  const consider = (tiles) => {
    const ids = new Set(tiles.map((tile) => tile.id));
    const after = [
      ...run.looseTiles.filter((tile) => !ids.has(tile.id)),
      ...preview.slice(0, tiles.length),
    ];
    const distance = tilesToChange(after, run.revealedGroups);
    const lonely = -tiles.reduce((sum, tile) => sum + support(tile, run.looseTiles), 0);
    const entry = { tiles, distance, count: tiles.length, lonely };
    if (!best
      || entry.distance < best.distance
      || (entry.distance === best.distance && entry.count < best.count)
      || (entry.distance === best.distance && entry.count === best.count && entry.lonely > best.lonely)) {
      best = entry;
    }
  };

  for (const first of candidates) {
    consider([first]);
    if (preview.length < 2) continue;
    for (const second of candidates) {
      if (second.id !== first.id) consider([first, second]);
    }
  }
  if (!best) return false;
  run.clearSelection();
  for (const tile of best.tiles) run.toggleTile(tile.id);
  return run.swapSelected().ok;
}

/** 已经能胡时，从获胜分解里挑一组亮出来，模拟「再赚一次三签选一」。 */
export function revealFromWinningShape(run) {
  const best = run.bestHu();
  if (!best) return false;
  const looseIds = new Set(run.looseTiles.map((tile) => tile.id));
  for (const candidate of best.solution.groups) {
    if (candidate.revealed) continue;
    if (!candidate.tiles.every((tile) => looseIds.has(tile.id))) continue;
    run.clearSelection();
    for (const tile of candidate.tiles) run.toggleTile(tile.id);
    if (run.revealPreview().valid && run.revealSelected().ok) return true;
    run.clearSelection();
  }
  return false;
}

/** 打完当前这一副。run 必须已经处于 playing / hu-ready。 */
export function playHand(run, { revealTarget = 0, charmPick = 0, swap = batchSwap } = {}) {
  let guard = 0;
  while (guard++ < 40) {
    if (run.status === 'charm-draft') {
      run.chooseCharm(run.draft.charmIds[charmPick] ?? run.draft.charmIds[0]);
      continue;
    }
    if (run.status !== 'playing' && run.status !== 'hu-ready') break;
    if (run.status === 'hu-ready') {
      if (run.slotsUsed() < revealTarget && revealFromWinningShape(run)) continue;
      run.declareHu();
      break;
    }
    if (!swap(run)) break;
  }
  return run.status;
}

/** 打完一整关（含选关），返回结束时的状态。 */
export function playBlind(run, options = {}) {
  if (run.status === 'blind-select') run.selectBlind();
  let guard = 0;
  while (guard++ < 10) {
    playHand(run, options);
    if (run.status !== 'hand-won' && run.status !== 'hand-failed') break;
    run.advance();
    if (run.status !== 'playing' && run.status !== 'hu-ready') break;
  }
  return run.status;
}

/** 一直打到进商店或者本局结束。 */
export function playToShop(run, options = {}) {
  let guard = 0;
  while (guard++ < 12) {
    if (run.status === 'shop' || run.status === 'run-over' || run.status === 'run-complete') break;
    if (run.status === 'blind-select') {
      run.selectBlind();
      continue;
    }
    playBlind(run, options);
  }
  return run.status;
}
