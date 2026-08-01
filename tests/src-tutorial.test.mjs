/**
 * 教学关：固定牌谱必须每一步都可预期。
 * 这些断言就是教学脚本的前提——牌谱一改动，教学文案也得跟着改。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { Run } from '../src/core/run.mjs';
import { TUTORIAL_SCRIPT } from '../src/ui/tutorial.mjs';

function lesson() {
  const run = new Run({ seed: 20260730, deckId: 'plain' });
  run.start();
  run.selectBlind();
  run.loadScriptedHand(TUTORIAL_SCRIPT);
  return run;
}

test('固定牌谱发出 14 张、还差 1 张、下一张正好补上', () => {
  const run = lesson();
  const state = run.snapshot();
  assert.equal(state.looseTiles.length, 14);
  assert.equal(state.status, 'playing');
  assert.equal(state.canHu, false);
  assert.equal(state.distance, 1);
  assert.deepEqual(
    { suit: state.upcomingTiles[0].suit, rank: state.upcomingTiles[0].rank },
    { suit: 'man', rank: 9 },
    '牌墙第一张必须是差的那张九萬，教学文案直接点名了它',
  );
});

test('教学脚本四步都能走通：亮组 → 求签 → 换牌 → 胡', () => {
  const run = lesson();

  const ones = run.snapshot().looseTiles.filter((tile) => tile.suit === 'man' && tile.rank === 1);
  assert.equal(ones.length, 3, '起手必须正好有三张一萬可亮');
  for (const tile of ones) run.toggleTile(tile.id);
  assert.equal(run.snapshot().revealPreview.valid, true);
  assert.equal(run.revealSelected().ok, true);

  const draft = run.snapshot().draft;
  assert.ok(draft, '亮组之后必须开出求签');
  assert.equal(run.chooseDraftOffer(draft.offers[0].offerId).ok, true);
  assert.equal(run.snapshot().draft, null);
  assert.equal(run.snapshot().revealedGroups.length, 1);

  const east = run.snapshot().looseTiles.find((tile) => tile.suit === 'honor' && tile.rank === 1);
  assert.ok(east, '起手必须正好有一张東给玩家换掉');
  run.toggleTile(east.id);
  const swapsBefore = run.snapshot().swapsRemaining;
  assert.equal(run.swapSelected().ok, true);
  assert.ok(run.snapshot().swapsRemaining < swapsBefore, '换牌要真的消耗次数，教学靠它判断这一步做完了');
  assert.equal(run.snapshot().canHu, true, '换完就该能胡，胡牌按钮才会出现');

  run.declareHu();
  const done = run.snapshot();
  assert.equal(done.status, 'hand-won');
  assert.ok(done.lastHandResult.score > 0);
});

test('教学局有足够换牌次数，不会中途流局', () => {
  const run = lesson();
  assert.ok(run.snapshot().swapsRemaining >= 2, '至少要留够教学那一次换牌加一次容错');
});
