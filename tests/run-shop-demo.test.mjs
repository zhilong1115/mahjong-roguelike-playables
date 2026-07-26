import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEMO_CONFIG,
  FORTUNE_GENERALS,
  ROUND_DEFINITIONS,
  TEMPORARY_CHARMS,
} from '../prototype/v2-run-shop-demo/content/index.mjs';
import { RunShopGame } from '../prototype/v2-run-shop-demo/core/game.mjs';
import {
  classifySelection,
  detectPatterns,
  findBestHu,
  findHuSolutions,
  physicalCount,
  structuralCount,
} from '../prototype/v2-run-shop-demo/core/rules.mjs';
import {
  buildStandardWall,
  createCuratedDeal,
  parseTileNotation,
  tileCode,
} from '../prototype/v2-run-shop-demo/core/tiles.mjs';

function chooseCodes(game, codes) {
  const used = new Set();
  for (const code of codes) {
    const tile = game.looseTiles.find(
      (candidate) => !used.has(candidate.id) && tileCode(candidate) === code,
    );
    assert.ok(tile, `missing tile ${code} in ${game.currentHandDefinition().id}`);
    used.add(tile.id);
    assert.equal(game.toggleTile(tile.id), true);
  }
  return [...used];
}

function act(game, codes) {
  chooseCodes(game, codes);
  const result = game.performSelectionAction();
  assert.equal(result.ok, true, result.reason);
  return result;
}

function tilesFrom(notation, id = 'unit-hand') {
  return createCuratedDeal({
    id,
    seed: 991,
    initial: notation,
    draws: [],
  }).looseTiles;
}

function finishCurrentFixedHandWithoutReveals(game) {
  for (const code of game.currentHandDefinition().suggestedDiscards) act(game, [code]);
  assert.equal(game.status, 'hu-ready');
  const result = game.declareHu();
  assert.equal(result.ok, true, result.reason);
  return result;
}

function revealSuggestedGroups(game) {
  for (const notation of game.currentHandDefinition().suggestedReveals) {
    act(game, parseTileNotation(notation).map((spec) => (
      spec.suit === 'honor'
        ? Object.entries({ E: 1, S: 2, W: 3, N: 4, R: 5, G: 6, B: 7 })
          .find(([, rank]) => rank === spec.rank)[0]
        : `${spec.rank}${{ man: 'm', pin: 'p', sou: 's' }[spec.suit]}`
    )));
  }
}

test('demo constants expose the agreed action, economy, target, and shop values', () => {
  assert.equal(DEMO_CONFIG.actionsPerHand, 5);
  assert.equal(DEMO_CONFIG.maxRevealsPerHand, 2);
  assert.equal(DEMO_CONFIG.startingGold, 2);
  assert.deepEqual(DEMO_CONFIG.goldByRevealCount, [3, 1, 0]);
  assert.deepEqual(ROUND_DEFINITIONS.map((round) => round.target), [1100, 1900]);
  assert.deepEqual(
    Object.values(FORTUNE_GENERALS).map(({ name, price }) => [name, price]),
    [['青龙使', 2], ['同心娘', 5], ['镇字将', 8]],
  );
});

test('all six fixed deals contain fourteen tiles and preserve their rigged draw prefixes', () => {
  const expectedDraws = [
    ['9m'], ['E'], ['3m'], ['7m', '9m'], ['6p', '7p'], ['N', 'R'],
  ];
  let cursor = 0;
  for (const round of ROUND_DEFINITIONS) {
    for (const hand of round.hands) {
      const deal = createCuratedDeal(hand);
      assert.equal(deal.looseTiles.length, 14);
      assert.equal(deal.wall.length, 122);
      assert.deepEqual(
        deal.wall.slice(0, expectedDraws[cursor].length).map(tileCode),
        expectedDraws[cursor],
      );
      cursor += 1;
    }
  }
});

test('selection maps one tile to swap and two-to-four to Mahjong groups', () => {
  const wall = buildStandardWall();
  const take = (suit, rank, amount = 1) => wall
    .filter((tile) => tile.suit === suit && tile.rank === rank)
    .slice(0, amount);

  assert.equal(classifySelection(take('man', 1)).kind, 'swap');
  assert.equal(classifySelection(take('pin', 3, 2)).kind, 'pair');
  assert.equal(classifySelection(take('honor', 5, 3)).kind, 'pung');
  assert.equal(classifySelection([
    take('sou', 2)[0], take('sou', 3)[0], take('sou', 4)[0],
  ]).kind, 'chow');
  assert.equal(classifySelection(take('honor', 1, 4)).kind, 'kong');
  assert.equal(classifySelection([
    take('honor', 1)[0], take('honor', 2)[0], take('honor', 3)[0],
  ]).valid, false);
});

test('solver recognizes ordinary, seven pairs, all-pungs, full straight, big dragons, and big winds', () => {
  const cases = [
    ['123m 456p 789s 111p EE', ['普通胡']],
    ['11m 22m 33p 44p 55s 66s EE', ['七对']],
    ['111m 222p 333s 444m EE', ['碰碰胡']],
    ['123m 456m 789m 111p EE', ['一条龙']],
    ['RRR GGG BBB 123m EE', ['大三元']],
    ['EEE SSS WWW NNN RR', ['碰碰胡', '大四喜']],
  ];
  for (const [notation, patterns] of cases) {
    const best = findBestHu(tilesFrom(notation, `case-${notation}`));
    assert.ok(best, notation);
    assert.deepEqual(best.patterns, patterns, notation);
  }

  const allPungs = findBestHu(tilesFrom('111m 222p 333s 444m EE', 'all-pungs'));
  assert.equal(allPungs.multiplier, 1.5);
  assert.equal(allPungs.total, 345);
});

test('strict seven pairs rejects a four-of-a-kind as two pairs', () => {
  const tiles = tilesFrom('1111m 22m 33p 44p 55s EE', 'luxury-seven-pairs');
  const sevenPairs = findHuSolutions(tiles).find((solution) => solution.shape === 'sevenPairs');
  assert.equal(sevenPairs, undefined);
});

test('a revealed group remains a hard constraint for Hu solving', () => {
  const tiles = tilesFrom('11123455678999m', 'ambiguous');
  assert.ok(findBestHu(tiles));

  const chosen = ['3m', '4m', '5m'].map((code) => tiles.find((tile) => tileCode(tile) === code));
  const chosenIds = new Set(chosen.map((tile) => tile.id));
  const loose = tiles.filter((tile) => !chosenIds.has(tile.id));
  const revealed = [{ id: 'wrong', kind: 'chow', tiles: chosen, revealed: true }];
  assert.equal(findBestHu(loose, revealed), null);
});

test('Hu-ready players may still reveal up to two groups for charms and score', () => {
  const game = new RunShopGame();
  act(game, ['9s']);
  assert.equal(game.status, 'hu-ready');
  assert.equal(game.bestHu().total, 300);

  chooseCodes(game, ['1m', '2m', '3m']);
  assert.equal(game.selectionPreview().projectedHu.total, 345);
  assert.equal(game.selectionPreview().scoreDelta, 45);
  game.clearSelection();
  act(game, ['1m', '2m', '3m']);
  assert.equal(game.status, 'hu-ready');
  assert.equal(game.revealCount, 1);
  assert.deepEqual(game.temporaryCharmIds, ['tailwind']);
  assert.equal(game.bestHu().total, 345);

  act(game, ['1p', '1p', '1p']);
  assert.equal(game.status, 'hu-ready');
  assert.equal(game.revealCount, 2);
  assert.deepEqual(game.temporaryCharmIds, ['tailwind', 'carving']);
  assert.equal(game.bestHu().total, 367);

  chooseCodes(game, ['4m', '5m', '6m']);
  const preview = game.selectionPreview();
  assert.equal(preview.valid, false);
  assert.match(preview.reason, /最多亮 2 组/);
  const actionsBefore = game.actionsRemaining;
  assert.equal(game.performSelectionAction().ok, false);
  assert.equal(game.actionsRemaining, actionsBefore);

  game.clearSelection();
  const result = game.declareHu();
  assert.equal(result.gold, 0);
  assert.equal(result.score, 367);
});

test('zero, one, and two reveals yield exactly three, one, and zero pending gold', () => {
  for (const [revealCount, expectedGold] of [[0, 3], [1, 1], [2, 0]]) {
    const game = new RunShopGame();
    act(game, ['9s']);
    if (revealCount >= 1) act(game, ['1m', '2m', '3m']);
    if (revealCount >= 2) act(game, ['1p', '1p', '1p']);
    const result = game.declareHu();
    assert.equal(result.gold, expectedGold);
    assert.equal(game.roundPendingGold, expectedGold);
    assert.deepEqual(game.snapshot().roundPending, { score: result.score, gold: expectedGold });
  }
});

test('the last action resolves its draw before automatic Hu settlement', () => {
  const game = new RunShopGame();
  game.actionsRemaining = 1;
  const action = act(game, ['9s']);
  assert.equal(tileCode(action.drawn), '9m');
  assert.equal(action.automaticSettlement, true);
  assert.equal(game.status, 'hand-won');
  assert.equal(game.lastHandResult.automatic, true);
  assert.equal(game.lastHandResult.score, 300);
  assert.equal(game.roundPendingGold, 3);
});

test('round rewards stay pending and are wiped when a later hand fails', () => {
  const game = new RunShopGame();
  finishCurrentFixedHandWithoutReveals(game);
  assert.equal(game.roundPendingGold, 3);
  game.advance();

  game.actionsRemaining = 1;
  act(game, ['1m']);
  assert.equal(game.status, 'round-failed');
  assert.equal(game.roundPendingGold, 0);
  assert.equal(game.roundScore, 0);
  assert.equal(game.gold, 2);

  assert.equal(game.restartRound().ok, true);
  assert.equal(game.currentHandDefinition().id, 'r1-h1');
  assert.equal(game.gold, 2);
});

test('three concealed wins clear round one, bank nine gold once, and open the shop', () => {
  const game = new RunShopGame();
  const scores = [];
  for (let hand = 0; hand < 3; hand += 1) {
    scores.push(finishCurrentFixedHandWithoutReveals(game).score);
    game.advance();
  }
  assert.deepEqual(scores, [300, 255, 660]);
  assert.equal(game.completedRounds[0].score, 1215);
  assert.equal(game.completedRounds[0].bankedGold, 9);
  assert.equal(game.status, 'shop');
  assert.equal(game.gold, 11);
  assert.equal(game.roundPendingGold, 0);
  assert.equal(game.advance().ok, false);
  assert.equal(game.gold, 11);
});

test('revealing twice in all three hands reaches the high-score route but banks no gold', () => {
  const game = new RunShopGame();
  const scores = [];
  for (let hand = 0; hand < 3; hand += 1) {
    for (const code of game.currentHandDefinition().suggestedDiscards) act(game, [code]);
    assert.equal(game.status, 'hu-ready');
    revealSuggestedGroups(game);
    scores.push(game.declareHu().score);
    game.advance();
  }
  assert.deepEqual(scores, [367, 331, 825]);
  assert.equal(game.completedRounds[0].score, 1523);
  assert.equal(game.completedRounds[0].bankedGold, 0);
  assert.equal(game.gold, 2);
  assert.equal(game.status, 'shop');
});

test('a kong draws its supplement, preserves fourteen structural slots, and draws one charm', () => {
  const customRounds = [{
    id: 'kong-round',
    name: '杠测试',
    target: 0,
    hands: [{
      id: 'kong-hand',
      name: '杠上开花',
      seed: 8801,
      initial: '1111m 234p 567p 78s EE',
      draws: ['9s'],
      charmOrder: ['tailwind', 'carving'],
      suggestedDiscards: [],
      suggestedReveals: ['1111m'],
    }],
  }];
  const game = new RunShopGame({ rounds: customRounds });
  const action = act(game, ['1m', '1m', '1m', '1m']);
  assert.equal(action.kind, 'kong');
  assert.equal(tileCode(action.supplement), '9s');
  assert.equal(game.actionsRemaining, 4);
  assert.equal(game.revealCount, 1);
  assert.deepEqual(game.temporaryCharmIds, ['tailwind']);
  assert.equal(structuralCount(game.looseTiles, game.revealedGroups), 14);
  assert.equal(physicalCount(game.looseTiles, game.revealedGroups), 15);
  assert.equal(game.status, 'hu-ready');
  assert.equal(game.wall.length + game.discard.length + physicalCount(game.looseTiles, game.revealedGroups), 136);
});

test('shop purchase is atomic, limited to one general, and persists into round two', () => {
  const game = new RunShopGame();
  for (let hand = 0; hand < 3; hand += 1) {
    finishCurrentFixedHandWithoutReveals(game);
    game.advance();
  }
  assert.equal(game.purchaseGeneral('glyphWarden').ok, true);
  assert.equal(game.gold, 3);
  assert.equal(game.purchaseGeneral('azureEnvoy').ok, false);
  assert.equal(game.gold, 3);
  assert.equal(game.startSecondRound().ok, true);
  assert.equal(game.roundIndex, 1);
  assert.equal(game.ownedGeneralId, 'glyphWarden');
  assert.equal(game.snapshot().ownedGeneral.name, '镇字将');
});

test('round-two baseline is 1880 and each shop general pushes it above the 1900 target', () => {
  const finalHands = [
    '111m 234m 567m 999m 55m',
    '11p 22p 33p 44p 55p 66p 77p',
    'EEE SSS WWW NNN RR',
  ];
  const totalFor = (generalId) => finalHands.reduce(
    (sum, notation, index) => sum + findBestHu(
      tilesFrom(notation, `round-two-${generalId ?? 'none'}-${index}`),
      [],
      { generalId },
    ).total,
    0,
  );

  assert.equal(totalFor(null), 1880);
  assert.equal(totalFor('azureEnvoy'), 1955);
  assert.equal(totalFor('ladyConcord'), 2072);
  assert.equal(totalFor('glyphWarden'), 2240);

  const ambiguousWithAzure = findBestHu(
    tilesFrom(finalHands[1], 'azure-ambiguous'),
    [],
    { generalId: 'azureEnvoy' },
  );
  assert.equal(ambiguousWithAzure.shape, 'standard');
  assert.equal(ambiguousWithAzure.total, 460);
});

test('the cheapest general produces an end-to-end round-two clear', () => {
  const game = new RunShopGame();
  for (let hand = 0; hand < 3; hand += 1) {
    finishCurrentFixedHandWithoutReveals(game);
    game.advance();
  }
  assert.equal(game.purchaseGeneral('azureEnvoy').ok, true);
  assert.equal(game.startSecondRound().ok, true);

  const scores = [];
  for (let hand = 0; hand < 3; hand += 1) {
    scores.push(finishCurrentFixedHandWithoutReveals(game).score);
    game.advance();
  }
  assert.deepEqual(scores, [460, 460, 1035]);
  assert.equal(game.completedRounds[1].score, 1955);
  assert.equal(game.status, 'run-complete');
});

test('temporary charms expire when advancing to the next hand', () => {
  const game = new RunShopGame();
  act(game, ['9s']);
  act(game, ['1m', '2m', '3m']);
  assert.deepEqual(game.temporaryCharmIds, ['tailwind']);
  game.declareHu();
  game.advance();
  assert.deepEqual(game.temporaryCharmIds, []);
  assert.equal(game.revealCount, 0);
});

test('the same hand definition always creates the same hidden wall after its fixed prefix', () => {
  const hand = ROUND_DEFINITIONS[1].hands[0];
  const first = createCuratedDeal(hand);
  const second = createCuratedDeal(hand);
  assert.deepEqual(first.looseTiles.map(tileCode), second.looseTiles.map(tileCode));
  assert.deepEqual(first.wall.slice(0, 30).map(tileCode), second.wall.slice(0, 30).map(tileCode));
  assert.equal(TEMPORARY_CHARMS[hand.charmOrder[0]].name, '顺风签');
});
