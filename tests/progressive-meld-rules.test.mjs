import assert from 'node:assert/strict';
import test from 'node:test';

import { ProgressiveMeldGame } from '../prototype/progressive-meld-demo/core/game.mjs';
import {
  classifySelection,
  findHuSolution,
  physicalCount,
  scoreGroups,
  structuralCount,
} from '../prototype/progressive-meld-demo/core/rules.mjs';
import { buildStandardWall, tileKey } from '../prototype/progressive-meld-demo/core/tiles.mjs';

function choose(game, specs) {
  const used = new Set();
  for (const [suit, rank] of specs) {
    const tile = game.looseTiles.find(
      (candidate) => !used.has(candidate.id) && candidate.suit === suit && candidate.rank === rank,
    );
    assert.ok(tile, `missing tile ${suit}:${rank}`);
    used.add(tile.id);
    assert.equal(game.toggleTile(tile.id), true);
  }
  return [...used];
}

function lock(game, specs) {
  choose(game, specs);
  const result = game.performSelectionAction();
  assert.equal(result.ok, true, result.reason);
  return result.group;
}

test('selection maps one to swap and two-to-four to atomic Mahjong groups', () => {
  const wall = buildStandardWall();
  const get = (suit, rank, amount = 1) => wall.filter(
    (tile) => tile.suit === suit && tile.rank === rank,
  ).slice(0, amount);

  assert.equal(classifySelection(get('man', 1)).kind, 'swap');
  assert.equal(classifySelection(get('man', 2, 2)).kind, 'pair');
  assert.equal(classifySelection(get('pin', 5, 3)).kind, 'pung');
  assert.equal(classifySelection([get('sou', 3)[0], get('sou', 4)[0], get('sou', 5)[0]]).kind, 'chow');
  assert.equal(classifySelection(get('honor', 5, 4)).kind, 'kong');
});

test('invalid runs reject honors, mixed suits, and 8-9-1 wrapping', () => {
  const wall = buildStandardWall();
  const one = (suit, rank) => wall.find((tile) => tile.suit === suit && tile.rank === rank);

  assert.equal(classifySelection([one('honor', 1), one('honor', 2), one('honor', 3)]).valid, false);
  assert.equal(classifySelection([one('man', 1), one('pin', 2), one('man', 3)]).valid, false);
  assert.equal(classifySelection([one('man', 8), one('man', 9), one('man', 1)]).valid, false);
});

test('simple tutorial completes through locks, one atomic swap, and active Hu declaration', () => {
  const game = new ProgressiveMeldGame({ scenario: 'simple' });
  lock(game, [['man', 1], ['man', 2], ['man', 3]]);
  lock(game, [['pin', 3], ['pin', 4], ['pin', 5]]);
  lock(game, [['honor', 5], ['honor', 5], ['honor', 5]]);
  lock(game, [['honor', 6], ['honor', 6]]);

  assert.equal(game.canHu(), false);
  choose(game, [['sou', 9]]);
  const swap = game.performSelectionAction();
  assert.equal(swap.ok, true);
  assert.equal(tileKey(swap.drawn), 'sou:8');
  assert.equal(game.swapsLeft, 11);
  assert.equal(game.handCanFormHu(), true);
  assert.equal(game.canHu(), false);

  lock(game, [['sou', 6], ['sou', 7], ['sou', 8]]);
  assert.equal(game.canHu(), true);

  const hu = game.declareHu();
  assert.equal(hu.ok, true);
  assert.equal(game.status, 'won');
  assert.equal(game.groups.length, 5);
  assert.equal(game.looseTiles.length, 0);
  assert.equal(hu.score.chips, 205);
  assert.equal(hu.score.total, 820);
});

test('Hu solver can preview remaining structure without bypassing explicit lock-in', () => {
  const game = new ProgressiveMeldGame({ scenario: 'simple' });
  lock(game, [['man', 1], ['man', 2], ['man', 3]]);
  choose(game, [['sou', 9]]);
  game.performSelectionAction();

  const solution = findHuSolution(game.looseTiles, game.groups);
  assert.ok(solution);
  assert.equal(solution.filter((group) => group.kind === 'pair').length, 1);
  assert.equal(solution.filter((group) => group.kind !== 'pair').length, 4);
  assert.equal(game.handCanFormHu(), true);
  assert.equal(game.canHu(), false);
  assert.equal(game.declareHu().ok, false);
});

test('wrong locked chow blocks an otherwise valid hand until it is unlocked', () => {
  const game = new ProgressiveMeldGame({ scenario: 'ambiguous' });
  assert.equal(game.handCanFormHu(), true);
  assert.equal(game.canHu(), false);

  const wrongGroup = lock(game, [['man', 3], ['man', 4], ['man', 5]]);
  assert.equal(game.handCanFormHu(), false);
  assert.equal(game.hasLockConflict(), true);

  const unlock = game.interactWithGroup(wrongGroup.id);
  assert.equal(unlock.ok, true);
  assert.equal(game.handCanFormHu(), true);
  assert.equal(game.canHu(), false);
});

test('a complete loose hand cannot skip the progressive lock loop', () => {
  const game = new ProgressiveMeldGame({ scenario: 'ambiguous' });
  assert.equal(game.groups.length, 0);
  assert.equal(game.handCanFormHu(), true);
  assert.equal(game.canHu(), false);
  assert.match(game.declareHu().reason, /归位/);
  assert.equal(game.status, 'active');
});

test('only one pair slot can be locked', () => {
  const game = new ProgressiveMeldGame({ scenario: 'simple' });
  lock(game, [['honor', 6], ['honor', 6]]);
  choose(game, [['honor', 5], ['honor', 5]]);
  const preview = game.selectionPreview();
  assert.equal(preview.valid, false);
  assert.match(preview.reason, /将位/);
});

test('a pair upgrades to a pung using one selected matching loose tile', () => {
  const game = new ProgressiveMeldGame({ scenario: 'simple' });
  const pair = lock(game, [['honor', 5], ['honor', 5]]);
  choose(game, [['honor', 5]]);
  const upgrade = game.interactWithGroup(pair.id);

  assert.equal(upgrade.ok, true);
  assert.equal(upgrade.group.kind, 'pung');
  assert.equal(upgrade.group.tiles.length, 3);
  assert.equal(game.groups.filter((group) => group.kind === 'pair').length, 0);
});

test('a pung upgrades to a committed kong, draws supplement, and preserves 14 structural slots', () => {
  const game = new ProgressiveMeldGame({ scenario: 'kong' });
  const pung = lock(game, [['honor', 1], ['honor', 1], ['honor', 1]]);
  choose(game, [['honor', 1]]);
  const upgrade = game.interactWithGroup(pung.id);

  assert.equal(upgrade.ok, true);
  assert.equal(upgrade.group.kind, 'kong');
  assert.equal(tileKey(upgrade.supplement), 'sou:8');
  assert.equal(game.swapsLeft, 12);
  assert.equal(structuralCount(game.looseTiles, game.groups), 14);
  assert.equal(physicalCount(game.looseTiles, game.groups), 15);
  assert.equal(game.interactWithGroup(pung.id).ok, false);
});

test('locking and unlocking recomputes pending chips instead of accumulating farmable score', () => {
  const game = new ProgressiveMeldGame({ scenario: 'simple' });
  const chow = lock(game, [['man', 1], ['man', 2], ['man', 3]]);
  assert.equal(game.pendingScore().chips, 40);

  game.interactWithGroup(chow.id);
  assert.equal(game.pendingScore().chips, 0);

  lock(game, [['man', 1], ['man', 2], ['man', 3]]);
  assert.equal(game.pendingScore().chips, 40);
});

test('seven pairs are not mistaken for a standard four-meld-one-pair Hu', () => {
  const wall = buildStandardWall();
  const tiles = [];
  for (const [suit, rank] of [
    ['man', 1], ['man', 2], ['man', 3], ['pin', 1], ['pin', 2], ['sou', 1], ['honor', 5],
  ]) {
    tiles.push(...wall.filter((tile) => tile.suit === suit && tile.rank === rank).slice(0, 2));
  }
  assert.equal(findHuSolution(tiles, []), null);
});

test('last swap draws first, then leaves a winning hand available to declare', () => {
  const game = new ProgressiveMeldGame({ scenario: 'simple' });
  game.swapsLeft = 1;
  choose(game, [['sou', 9]]);
  const result = game.performSelectionAction();

  assert.equal(result.ok, true);
  assert.equal(game.swapsLeft, 0);
  assert.equal(tileKey(result.drawn), 'sou:8');
  assert.equal(game.handCanFormHu(), true);
  assert.equal(game.canHu(), false);
  assert.equal(game.status, 'active');
  assert.equal(game.concede().ok, false);
  assert.equal(game.status, 'active');
});

test('same random seed produces identical hand and wall order', () => {
  const first = new ProgressiveMeldGame({ scenario: 'random', seed: 99173 });
  const second = new ProgressiveMeldGame({ scenario: 'random', seed: 99173 });

  assert.deepEqual(first.looseTiles.map(tileKey), second.looseTiles.map(tileKey));
  assert.deepEqual(first.wall.slice(0, 20).map(tileKey), second.wall.slice(0, 20).map(tileKey));
});

test('score is derived only from current groups', () => {
  const game = new ProgressiveMeldGame({ scenario: 'simple' });
  const chow = lock(game, [['man', 1], ['man', 2], ['man', 3]]);
  const current = scoreGroups(game.groups);
  assert.equal(current.chips, 40);
  game.interactWithGroup(chow.id);
  assert.equal(scoreGroups(game.groups).chips, 0);
});

test('special Hu patterns apply an explicit bonus multiplier', () => {
  const game = new ProgressiveMeldGame({ scenario: 'ambiguous' });
  lock(game, [['man', 1], ['man', 1], ['man', 1]]);
  lock(game, [['man', 2], ['man', 3], ['man', 4]]);
  lock(game, [['man', 5], ['man', 5]]);
  lock(game, [['man', 6], ['man', 7], ['man', 8]]);
  lock(game, [['man', 9], ['man', 9], ['man', 9]]);

  assert.equal(game.canHu(), true);
  const result = game.declareHu();
  assert.deepEqual(result.patterns, ['清一色']);
  assert.equal(result.score.patternMult, 2);
  assert.equal(result.score.mult, 8);
  assert.equal(result.score.total, 1560);
});
