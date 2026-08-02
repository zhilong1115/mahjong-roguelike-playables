import assert from 'node:assert/strict';
import test from 'node:test';

import { getItem } from '../src/content/index.mjs';
import { Run } from '../src/core/run.mjs';
import { tileKey } from '../src/core/tiles.mjs';
import { hand } from './helpers/auto-play.mjs';

function playingRun(seed = 20260731) {
  const run = new Run({ seed });
  assert.equal(run.selectBlind().ok, true);
  return run;
}

function instance(charmId, index = 0) {
  const charm = getItem('charm', charmId);
  return {
    instanceId: `test:${charmId}:${index}`,
    charmId,
    tier: charm.tier,
    role: 'active',
    source: 'test',
  };
}

function draftActive(run, charmId) {
  const charm = getItem('charm', charmId);
  run.status = 'charm-draft';
  run.draft = {
    draftId: `draft:${charmId}`,
    groupId: 'missing',
    offerCount: 1,
    tierSlots: [charm.tier],
    offers: [{
      offerId: `draft:${charmId}:o0`,
      charmId,
      tier: charm.tier,
      role: 'active',
      draftRole: charm.draftRole,
      slotRole: 'pattern',
    }],
    charmIds: [charmId],
    rerollsLeft: 0,
    rolls: 0,
    pendingOmenReplacement: null,
    pendingSatchelReplacement: null,
  };
  return run.draft.offers[0].offerId;
}

test('主动签选中后收入三格锦囊，不混入被动签效与结算卡列', () => {
  const run = playingRun();
  const offerId = draftActive(run, 'extraRounds');
  const result = run.chooseDraftOffer(offerId);
  assert.equal(result.ok, true);
  assert.equal(result.reserved, true);
  assert.deepEqual(run.satchel.map((entry) => entry.charmId), ['extraRounds']);
  assert.deepEqual(run.charmIds, []);
  assert.deepEqual(run.charmInstances, []);
  assert.ok(['playing', 'hu-ready'].includes(run.status));
});

test('三格锦囊满时必须明确替换，取消不会静默丢牌', () => {
  const run = playingRun();
  run.satchel = [instance('extraRounds', 0), instance('washWall', 1), instance('extraRounds', 2)];
  const offerId = draftActive(run, 'washWall');
  const result = run.chooseDraftOffer(offerId);
  assert.equal(result.needsSatchelReplace, true);
  assert.equal(run.satchel.length, 3);
  assert.ok(run.draft.pendingSatchelReplacement);
  assert.equal(run.cancelSatchelReplacement().ok, true);
  assert.equal(run.draft.pendingSatchelReplacement, null);
  assert.equal(run.chooseDraftOffer(offerId).needsSatchelReplace, true);
  const replaced = run.satchel[1];
  const confirmed = run.confirmSatchelReplacement(1);
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.replaced.instanceId, replaced.instanceId);
  assert.equal(run.satchel[1].charmId, 'washWall');
});

test('续巡增加两次换牌，但额外次数不进入金币结算', () => {
  const run = playingRun();
  run.swapsRemaining = 0;
  run.satchel = [instance('extraRounds')];
  run.status = 'playing';
  const goldBefore = run.projectedGold();
  assert.equal(run.beginSatchelUse(run.satchel[0].instanceId).ok, true);
  assert.equal(run.confirmSatchelUse().ok, true);
  assert.equal(run.swapsRemaining, 2);
  assert.equal(run.bonusSwapsRemaining, 2);
  assert.equal(run.rewardableSwapsRemaining(), 0);
  assert.equal(run.projectedGold(), goldBefore);

  run.toggleTile(run.looseTiles[0].id);
  assert.equal(run.swapSelected().ok, true);
  assert.equal(run.swapsRemaining, 1);
  assert.equal(run.bonusSwapsRemaining, 1);
  assert.equal(run.rewardableSwapsRemaining(), 0);
});

test('洗壁按 seed 重洗剩余牌墙，顺序稳定且实体集合不变', () => {
  const first = playingRun(99173);
  const second = playingRun(99173);
  for (const run of [first, second]) run.satchel = [instance('washWall')];
  const before = first.wall.map((tile) => tile.id);
  const sortedBefore = [...before].sort();

  for (const run of [first, second]) {
    assert.equal(run.beginSatchelUse(run.satchel[0].instanceId).ok, true);
    assert.equal(run.confirmSatchelUse().ok, true);
  }
  assert.notDeepEqual(first.wall.map((tile) => tile.id), before);
  assert.deepEqual(first.wall.map((tile) => tile.id), second.wall.map((tile) => tile.id));
  assert.deepEqual(first.wall.map((tile) => tile.id).sort(), sortedBefore);
});

test('点石可把未亮牌指定为合法牌种并直接成胡，本副限一次且不造第五张', () => {
  const run = playingRun();
  run.looseTiles = hand('123m 456m 789m 111p 2s 3s');
  run.revealedGroups = [];
  run.swapsRemaining = 0;
  run.satchel = [instance('turnStone')];
  run.status = 'playing';
  run.refreshStatus();
  assert.equal(run.status, 'playing', '有救牌锦囊时不能提前判流局');

  assert.equal(run.beginSatchelUse(run.satchel[0].instanceId).ok, true);
  const winning = run.activeChoice.choices.find((choice) => choice.distanceAfter === 0);
  assert.ok(winning, '固定牌谱应有直接成胡的点石目标');
  assert.equal(run.selectSatchelTile(winning.tileId).ok, true);
  assert.equal(run.selectSatchelTarget(winning.targetKind).ok, true);
  assert.equal(run.activeChoice.preview.canHuAfter, true);
  assert.equal(run.confirmSatchelUse().ok, true);
  assert.equal(run.fateSatchelUsed, true);
  assert.equal(run.status, 'hu-ready');
  assert.equal(run.satchel.length, 0);

  run.looseTiles = hand('1111p 123m 456m 789m 2s 3s');
  run.fateSatchelUsed = false;
  assert.equal(run.pointStoneChoices().some((choice) => choice.targetKind === 'pin:1'), false);
  assert.equal(run.looseTiles.filter((tile) => tileKey(tile) === 'pin:1').length, 4);
});

test('新一副会清空未使用锦囊与主动中间态', () => {
  const run = playingRun();
  run.satchel = [instance('extraRounds')];
  assert.equal(run.beginSatchelUse(run.satchel[0].instanceId).ok, true);
  run.dealHand();
  assert.deepEqual(run.satchel, []);
  assert.equal(run.activeChoice, null);
  assert.equal(run.bonusSwapsRemaining, 0);
  assert.equal(run.fateSatchelUsed, false);
});
