import assert from 'node:assert/strict';
import test from 'node:test';

import { ANTES, CONFIG, getItem } from '../src/content/index.mjs';
import { Run } from '../src/core/run.mjs';
import { playHand } from './helpers/auto-play.mjs';

/** 固定 seed 打标准短局：东南两圈 × 三关 × 一副，每个过关点进入百宝阁。 */
function playRun(seed, { revealTarget = 0, buy = true } = {}) {
  const run = new Run({ seed });
  const log = [];
  let guard = 0;
  while (guard++ < 60) {
    if (run.status === 'run-complete' || run.status === 'run-over') break;
    if (run.status === 'blind-select') {
      log.push({ type: 'blind', ante: run.anteIndex, kind: run.blindKind });
      run.selectBlind();
      continue;
    }
    if (run.status === 'shop') {
      log.push({ type: 'shop', gold: run.gold, offers: run.shop.items.map((item) => `${item.family}:${item.id}`) });
      if (buy) {
        for (const offer of [...run.shop.items]) {
          const result = run.buy(offer.slotIndex);
          if (result.needsKind) run.confirmKind('man:5');
        }
      }
      run.leaveShop();
      continue;
    }
    const status = playHand(run, { revealTarget });
    log.push({ type: 'hand', status, score: run.lastHandResult?.score ?? 0 });
    run.advance();
  }
  return { run, log };
}

test('固定 seed 的整局圈关流程可复现，并能进入百宝阁', () => {
  const first = playRun(20260726);
  const second = playRun(20260726);
  assert.deepEqual(
    first.log.map((entry) => JSON.stringify(entry)),
    second.log.map((entry) => JSON.stringify(entry)),
    '同一 seed 的整局过程必须逐步一致',
  );
  const shops = first.log.filter((entry) => entry.type === 'shop');
  assert.ok(shops.length >= 1, '至少要进一次百宝阁');
  assert.ok(['run-complete', 'run-over'].includes(first.run.status));
});

test('一局之内五类内容都能被玩家碰到', () => {
  const { run } = playRun(20260726, { revealTarget: 2 });
  const touched = new Set();
  if (run.completedBlinds.some((blind) => blind.hands.some((entry) => entry.charmIds?.length))) {
    touched.add('charm');
  }
  if (Object.keys(run.codexLevels).length) touched.add('codex');
  if (run.generalIds.length) touched.add('general');
  if (Object.keys(run.bones).length) touched.add('bone');
  if (Object.keys(run.seals).length) touched.add('seal');

  // 灵签在第一关就出现，其余四类来自后续百宝阁货架
  assert.ok(touched.has('charm'), '亮组必须给到灵签');
  assert.ok(touched.has('general') && touched.has('codex'), '第一家店给福将和番谱');
  assert.ok(touched.has('bone') || touched.has('seal'), '锻牌位给牌骨或牌印');
});

test('买到的长期内容确实改变了后续结算', () => {
  const run = new Run({ seed: 20260726 });
  assert.equal(run.status, 'blind-select');
  assert.equal(run.selectBlind().ok, true);
  for (let index = 0; index < ANTES[0].handsPerBlind; index += 1) {
    playHand(run);
    run.advance();
  }
  assert.equal(run.status, 'shop');
  run.gold += 100;
  const reliableGeneral = run.shop.items.find(
    (offer) => getItem('general', offer.id)?.archetype === 'pairs',
  );
  assert.ok(reliableGeneral, '第一家请将台应当包含七巧起势福将');
  assert.equal(run.buy(reliableGeneral.slotIndex).ok, true);
  const owned = {
    generals: [...run.generalIds],
    codex: { ...run.codexLevels },
    bones: { ...run.bones },
  };
  run.leaveShop();
  assert.equal(run.status, 'blind-select');
  assert.equal(run.selectBlind().ok, true);

  const expectExtra = owned.generals.length || Object.keys(owned.codex).length
    || Object.keys(owned.bones).length;
  assert.ok(expectExtra, '这一步之前应当买到东西');

  let result = null;
  let sources = new Set();
  for (let index = 0; index < ANTES[0].handsPerBlind; index += 1) {
    playHand(run);
    result = run.lastHandResult;
    assert.ok(result, `下一关第 ${index + 1} 副应当成牌`);
    sources = new Set(result.steps.map((step) => step.source));
    if (sources.has('general') || sources.has('codex') || sources.has('bone')) break;
    if (index < ANTES[0].handsPerBlind - 1) run.advance();
  }
  assert.ok(
    sources.has('general') || sources.has('codex') || sources.has('bone'),
    `结算里看不到任何长期内容的贡献：${[...sources].join(',')}`,
  );

  // 同一手牌，去掉长期内容后分数必须更低
  const without = run.bestHu(run.looseTiles, run.revealedGroups, {
    generalIds: [], codexLevels: {}, bones: {},
  });
  assert.ok(!without || without.total <= result.score);
});

test('开运位越省，金币越多；越花，分数越高', () => {
  const conservative = new Run({ seed: 4242 });
  conservative.selectBlind();
  playHand(conservative, { revealTarget: 0 });
  const aggressive = new Run({ seed: 4242 });
  aggressive.selectBlind();
  playHand(aggressive, { revealTarget: 6 });

  const quiet = conservative.lastHandResult;
  const loud = aggressive.lastHandResult;
  assert.ok(quiet && loud);
  assert.ok(quiet.gold > loud.gold, '省下开运位应当更有钱');
  assert.ok(loud.slotsUsed > quiet.slotsUsed);
  assert.equal(
    quiet.gold - loud.gold - quiet.charmGold + loud.charmGold,
    (loud.slotsUsed - quiet.slotsUsed) * CONFIG.goldPerEmptySlot,
  );
});

test('内容表里的 id 与注册表一致', () => {
  for (const [family, ids] of Object.entries({
    charm: ['tailwind', 'doubleBless', 'wealth'],
    codex: ['sevenPairs', 'dragon', 'pureSuit'],
    general: ['azureEnvoy', 'magistrate', 'coinBoy'],
    bone: ['warmJade', 'greenBamboo'],
    seal: ['returnWind', 'askOracle', 'gateKeeper'],
  })) {
    for (const id of ids) {
      const item = getItem(family, id);
      assert.ok(item, `${family}:${id} 应当能查到`);
      assert.equal(item.id, id);
      assert.equal(item.family, family);
    }
  }
  assert.equal(getItem('charm', 'nope'), null);
});
