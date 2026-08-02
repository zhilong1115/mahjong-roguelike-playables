import assert from 'node:assert/strict';
import test from 'node:test';

import { getItem } from '../src/content/index.mjs';
import { draftCharmOffers } from '../src/content/charms.mjs';
import { Run } from '../src/core/run.mjs';
import { findHuSolutions } from '../src/core/patterns.mjs';
import { scoreHand } from '../src/core/scoring.mjs';
import { tilesToChange } from '../src/core/shanten.mjs';
import { restoreRun, serializeRun } from '../src/state/save.mjs';
import { createSeededRng } from '../src/core/tiles.mjs';
import { hand } from './helpers/auto-play.mjs';

function solutionOf(notation) {
  const solutions = findHuSolutions(hand(notation));
  assert.ok(solutions.length, `${notation} 应当能胡`);
  return solutions[0];
}

test('三次请将按起势 / 成势 / 终局提供三条路线', () => {
  const run = new Run({ seed: 20260727 });
  for (const [clearedBlinds, expectedStage] of [[1, 1], [3, 2], [5, 3]]) {
    run.clearedBlinds = clearedBlinds;
    const shop = run.rollShop();
    assert.equal(shop.kind, 'general-draft');
    assert.equal(shop.stage, expectedStage);
    assert.equal(shop.items.length, 3);
    const cards = shop.items.map((offer) => getItem('general', offer.id));
    assert.deepEqual(cards.map((card) => card.archetype).sort(), ['dragon', 'pairs', 'thunder']);
    assert.ok(cards.every((card) => card.stage === expectedStage));
  }
});

test('请将台只能购买一位且不能刷新', () => {
  const run = new Run({ seed: 20260727 });
  run.clearedBlinds = 1;
  run.shop = run.rollShop();
  run.status = 'shop';
  run.gold = 100;

  const [first, second] = run.shop.items;
  assert.equal(run.buy(first.slotIndex).ok, true);
  assert.equal(run.generalIds.length, 1);
  assert.ok(run.shop.items.every((offer) => offer.sold));
  assert.equal(run.buy(second.slotIndex).ok, false);
  assert.deepEqual(run.rerollShop(), { ok: false, reason: '请将台不可刷新' });
});

test('请将选择经存档恢复后仍锁住另外两位', () => {
  const run = new Run({ seed: 20260727 });
  run.clearedBlinds = 1;
  run.shop = run.rollShop();
  run.status = 'shop';
  run.gold = 100;
  assert.equal(run.buy(run.shop.items[0].slotIndex).ok, true);

  const restored = new Run({ seed: 1 });
  assert.equal(restoreRun(restored, structuredClone(serializeRun(run))).ok, true);
  assert.equal(restored.shop.kind, 'general-draft');
  assert.equal(restored.shop.stage, 1);
  assert.ok(restored.shop.generalPicked);
  assert.ok(restored.shop.items.every((offer) => offer.sold));
  assert.equal(restored.buy(restored.shop.items[1].slotIndex).ok, false);
});

test('已有福将会让牌型签位优先出现同流派灵签', () => {
  const offers = draftCharmOffers(createSeededRng(17), 'chow', {
    tierSlots: ['silver', 'gold', 'silver'],
    preferredArchetype: 'dragon',
  });
  assert.equal(offers.length, 3);
  assert.equal(getItem('charm', offers[1].charmId).archetype, 'dragon');
});

test('金色改命签先选原牌再选目标，确认前不改牌、确认后真实减少距离', () => {
  const run = new Run({ seed: 7 });
  run.looseTiles = hand('123m 456m 789m 111p 2s 3s');
  run.revealedGroups = [];
  run.swapsRemaining = 2;
  run.status = 'charm-draft';
  run.draft = {
    draftId: 'test-fate',
    groupId: 'missing',
    offers: [{
      offerId: 'test-fate:o0',
      charmId: 'redThread',
      tier: 'gold',
      role: 'fate',
    }],
    charmIds: ['redThread'],
    tierSlots: ['gold'],
    pendingOmenReplacement: null,
    pendingFateChoice: null,
  };

  const before = tilesToChange(run.looseTiles, run.revealedGroups);
  assert.equal(getItem('charm', 'redThread').tier, 'gold');
  const originalKinds = run.looseTiles.map((tile) => tile.kind ?? `${tile.suit}:${tile.rank}`);
  const begin = run.chooseDraftOffer('test-fate:o0');
  assert.deepEqual(begin, { ok: true, needsFateChoice: true, choiceCount: begin.choiceCount });
  assert.ok(begin.choiceCount > 0);
  assert.deepEqual(run.looseTiles.map((tile) => tile.kind ?? `${tile.suit}:${tile.rank}`), originalKinds);
  assert.equal(run.charmIds.includes('redThread'), false);

  const choice = run.draft.pendingFateChoice.choices.find((entry) => entry.distanceAfter === 0)
    ?? run.draft.pendingFateChoice.choices[0];
  assert.equal(run.selectFateTile(choice.tileId).ok, true);
  const result = run.confirmFateTarget(choice.targetKind);
  assert.equal(result.ok, true);
  assert.ok(result.fateChange);
  assert.equal(result.fateChange.distanceBefore, before);
  assert.ok(result.fateChange.distanceAfter < before);
  assert.equal(run.charmIds.includes('redThread'), true);
  assert.equal(run.distance(), 0);
  assert.equal(run.status, 'hu-ready');
  const counts = new Map();
  for (const tile of run.looseTiles) {
    const kind = `${tile.suit}:${tile.rank}`;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  assert.ok([...counts.values()].every((count) => count <= 4), '改命不能造出第五张同牌');
  const excluded = new Set(run.draftContentOptions({ appliedOmen: null }).excludeCharmIds);
  assert.ok(['dragonGuide', 'thunderGather', 'redThread'].every((id) => excluded.has(id)),
    '已经成胡时不应再出现没有合法目标的改命签');
});

test('改命选择可以返回三签，并能在选定原牌后存档恢复', () => {
  const run = new Run({ seed: 7 });
  run.looseTiles = hand('123m 456m 789m 111p 2s 3s');
  run.revealedGroups = [];
  run.status = 'charm-draft';
  run.draft = {
    draftId: 'save-fate', groupId: 'missing', offerCount: 1,
    offers: [{ offerId: 'save-fate:o0', charmId: 'thunderGather', tier: 'gold', role: 'fate' }],
    charmIds: ['thunderGather'], tierSlots: ['gold'], pendingOmenReplacement: null, pendingFateChoice: null,
  };

  assert.equal(run.chooseDraftOffer('save-fate:o0').needsFateChoice, true);
  const choice = run.draft.pendingFateChoice.choices[0];
  assert.equal(run.selectFateTile(choice.tileId).ok, true);

  const restored = new Run({ seed: 1 });
  assert.equal(restoreRun(restored, structuredClone(serializeRun(run))).ok, true);
  assert.equal(restored.draft.pendingFateChoice.selectedTileId, choice.tileId);
  assert.ok(restored.draft.pendingFateChoice.choices.length > 0);
  assert.equal(restored.backFateTile().ok, true);
  assert.equal(restored.draft.pendingFateChoice.selectedTileId, null);
  assert.equal(restored.cancelFateChoice().ok, true);
  assert.equal(restored.draft.pendingFateChoice, null);
  assert.deepEqual(restored.charmIds, []);
});

test('三条终局福将在目标牌型上产生可解释的番势乘算', () => {
  const cases = [
    {
      notation: '123m 456m 456p 111s EE',
      starter: 'azureEnvoy', engine: 'cloudWalker', capstone: 'dragonKing', factor: 2,
    },
    {
      notation: '111m 222m 333p 444s EE',
      starter: 'stoneWarden', engine: 'thunderDuke', capstone: 'heavenWarden', factor: 2,
    },
    {
      notation: '1122m 3344p 5566s EE',
      starter: 'ladyConcord', engine: 'matchmaker', capstone: 'sevenStarQueen', factor: 3,
    },
  ];

  for (const entry of cases) {
    const solution = solutionOf(entry.notation);
    const starter = scoreHand({ solution, generalIds: [entry.starter] });
    const full = scoreHand({ solution, generalIds: [entry.starter, entry.engine, entry.capstone] });
    const capstoneStep = full.steps.find((step) => step.label === getItem('general', entry.capstone).name);
    assert.equal(capstoneStep?.multFactor, entry.factor);
    assert.ok(full.mult > starter.mult, `${entry.capstone} 应提高番势`);
    assert.ok(full.total >= starter.total * entry.factor, `${entry.capstone} 应产生终局爆发`);
  }
});
