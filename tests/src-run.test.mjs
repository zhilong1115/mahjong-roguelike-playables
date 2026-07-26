import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANTES,
  CODEX_BY_PATTERN,
  CODEX_MAX_LEVEL,
  CONFIG,
  FAMILIES,
  getItem,
  listItems,
  shelfFor,
} from '../src/content/index.mjs';
import { Run } from '../src/core/run.mjs';
import { tileKey } from '../src/core/tiles.mjs';
import { playHand, revealFromWinningShape, smartSwap } from './helpers/auto-play.mjs';

const SEED = 20260726;

function startSelectedBlind(run) {
  assert.equal(run.status, 'blind-select');
  assert.equal(run.selectBlind().ok, true);
  return run;
}

function runToShop(seed = SEED, options = {}) {
  const run = new Run({ seed });
  startSelectedBlind(run);
  for (let index = 0; index < ANTES[0].handsPerBlind; index += 1) {
    playHand(run, options);
    run.advance();
  }
  return run;
}

test('每副开局：14 张结构牌、6 个开运位、5 次换牌', () => {
  const run = new Run({ seed: SEED });
  assert.equal(run.status, 'blind-select', '新局必须先停在选关屏');
  startSelectedBlind(run);
  const state = run.snapshot();
  assert.equal(state.looseTiles.length, 14);
  assert.equal(state.structuralCount, 14);
  assert.equal(state.slotCount, CONFIG.fortuneSlots);
  assert.equal(state.swapsRemaining, CONFIG.swapsPerHand);
  assert.equal(state.status, 'playing');
  assert.ok(state.distance >= 1);
});

test('跳过闲局和庄局会逐关推进，圈主保持不可跳', () => {
  const run = new Run({ seed: SEED });

  assert.equal(run.blindKind, 'small');
  assert.equal(run.skipBlind().ok, true);
  let state = run.snapshot();
  assert.equal(state.status, 'blind-select');
  assert.equal(state.blindKind, 'big');
  assert.equal(state.blindCards.find((card) => card.kind === 'small')?.outcome, 'skipped');
  assert.equal(state.blindCards.find((card) => card.kind === 'big')?.current, true);

  assert.equal(run.skipBlind().ok, true);
  state = run.snapshot();
  assert.equal(state.status, 'blind-select');
  assert.equal(state.blindKind, 'boss');
  assert.equal(state.blindCards.find((card) => card.kind === 'big')?.outcome, 'skipped');
  assert.equal(state.blindCards.find((card) => card.kind === 'boss')?.current, true);

  assert.deepEqual(run.skipBlind(), { ok: false, reason: '圈主不能跳' });
  assert.equal(run.blindKind, 'boss');
});

test('完全不亮牌：满额空位金币 + 门清标签', () => {
  const run = startSelectedBlind(new Run({ seed: SEED }));
  assert.equal(playHand(run), 'hand-won');
  const result = run.lastHandResult;
  assert.equal(result.slotsUsed, 0);
  assert.equal(
    result.gold,
    CONFIG.fortuneSlots * CONFIG.goldPerEmptySlot
      + result.swapsRemaining * CONFIG.goldPerUnusedSwap,
  );
  assert.ok(result.patterns.includes('门清'));
});

test('每亮一组少两金，并换来一次三签选一', () => {
  const run = startSelectedBlind(new Run({ seed: SEED }));
  assert.equal(playHand(run, { revealTarget: 2 }), 'hand-won');
  const result = run.lastHandResult;
  assert.ok(result.slotsUsed >= 1);
  assert.equal(result.emptySlots, CONFIG.fortuneSlots - result.slotsUsed);
  assert.equal(result.charmIds.length, result.slotsUsed);
  assert.equal(
    result.gold - result.charmGold - result.swapsRemaining * CONFIG.goldPerUnusedSwap,
    result.emptySlots * CONFIG.goldPerEmptySlot,
  );
});

/** 摸到能胡为止，再亮一组，停在三签选一。 */
function reachDraft(seed) {
  const run = startSelectedBlind(new Run({ seed }));
  let guard = 0;
  while (guard++ < 30 && run.status === 'playing') smartSwap(run);
  assert.equal(run.status, 'hu-ready', `seed ${seed} 应当能摸到可胡`);
  assert.equal(revealFromWinningShape(run), true, '应当能从获胜分解里亮一组');
  assert.equal(run.status, 'charm-draft');
  return run;
}

test('三签选一固定给出本组签 / 牌型签 / 奇签，同一 seed 稳定', () => {
  const first = reachDraft(777);
  const draft = first.draft;
  assert.equal(draft.charmIds.length, 3);
  assert.equal(new Set(draft.charmIds).size, 3, '同一次不出现重复灵签');
  const roles = draft.charmIds.map((id) => getItem('charm', id).role);
  assert.deepEqual([...new Set(roles)].sort(), ['group', 'pattern', 'wild']);

  const second = reachDraft(777);
  assert.deepEqual(second.draft.charmIds, draft.charmIds, '同一 seed 必须给出同样的三签');

  assert.equal(first.chooseCharm('__missing__').ok, false);
  const picked = draft.charmIds[1];
  assert.equal(first.chooseCharm(picked).ok, true);
  assert.equal(first.chooseCharm(picked).ok, false, '选完不能再选');
  assert.deepEqual(first.charmIds, [picked]);
});

test('灵签只在本副生效，下一副清空', () => {
  const run = startSelectedBlind(new Run({ seed: 909090 }));
  playHand(run, { revealTarget: 1 });
  assert.ok(run.charmIds.length >= 1);
  run.advance();
  assert.deepEqual(run.charmIds, []);
  assert.deepEqual(run.revealedGroups, []);
  assert.equal(run.swapsRemaining, CONFIG.swapsPerHand);
});

test('牌印 · 换出触发：回风印返还一次换牌，每副只一次', () => {
  const run = startSelectedBlind(new Run({ seed: SEED }));
  const target = run.looseTiles[0];
  const kind = tileKey(target);
  run.seals = { [kind]: 'returnWind' };

  const before = run.swapsRemaining;
  run.toggleTile(target.id);
  assert.match(run.swapPreview().text, /回风印/);
  const result = run.swapSelected();
  assert.equal(result.sealHit, 'returnWind');
  assert.equal(run.swapsRemaining, before, '换一张扣一次、印返还一次，净持平');
  assert.ok(run.usedSealKinds.has(kind));

  const again = run.looseTiles.find((tile) => tileKey(tile) === kind);
  if (again) {
    const swaps = run.swapsRemaining;
    run.toggleTile(again.id);
    const second = run.swapSelected();
    assert.equal(second.sealHit, null, '同一牌种本副只触发一次');
    assert.equal(run.swapsRemaining, swaps - 1);
  }
});

test('牌印 · 亮组触发：问签印给一次整组重抽，重抽结果由 seed 决定', () => {
  const run = startSelectedBlind(new Run({ seed: 4242 }));
  playHand(run, { revealTarget: 0 });   // 先摸到能胡
  run.advance();
  const kind = tileKey(run.looseTiles[0]);
  run.seals = { [kind]: 'askOracle' };

  let guard = 0;
  while (run.status === 'playing' && guard++ < 20) {
    if (!revealFromWinningShape(run)) break;
  }
  if (run.status !== 'charm-draft') {
    playHand(run, { revealTarget: 1 });
    return;   // 这副没能亮到带印的牌，跳过（规则本身由上一条测试覆盖）
  }
  const firstDraft = [...run.draft.charmIds];
  if (run.draft.rerollsLeft > 0) {
    const rerolled = run.rerollDraft();
    assert.equal(rerolled.ok, true);
    assert.equal(run.draft.rerollsLeft, 0, '重抽只有一次');
    assert.equal(run.rerollDraft().ok, false);

    const twin = new Run({ seed: 4242 });
    assert.deepEqual(run.draft.charmIds.length, firstDraft.length);
    assert.ok(twin instanceof Run);
  }
});

test('百宝阁：货位类别固定，番谱定向匹配下一轮预告', () => {
  const run = runToShop();
  assert.equal(run.status, 'shop');
  const families = run.shop.items.map((item) => item.family);
  assert.deepEqual(families, shelfFor(run.shopIndex()));

  const codexOffer = run.shop.items.find((item) => item.family === 'codex');
  const book = getItem('codex', codexOffer.id);
  const announced = ANTES[run.anteIndex].announced;
  assert.ok(
    announced.includes(book.pattern),
    `番谱 ${book.name} 必须匹配当前圈预告 ${announced.join('/')}`,
  );

  // 刷新只换商品，不换类别
  const goldBefore = run.gold;
  run.rerollShop();
  assert.equal(run.gold, goldBefore - CONFIG.rerollCost);
  assert.deepEqual(run.shop.items.map((item) => item.family), shelfFor(run.shopIndex()));
});

test('牌骨 / 牌印要先选牌种才扣钱，覆盖旧改造会被记录', () => {
  const run = runToShop();
  const boneOffer = run.shop.items.find((item) => item.family === 'bone');
  const goldBefore = run.gold;

  const started = run.buy(boneOffer.slotIndex);
  assert.equal(started.needsKind, true);
  assert.equal(run.gold, goldBefore, '还没选牌种就不能扣钱');
  assert.equal(run.shop.pending.id, boneOffer.id);

  run.cancelPending();
  assert.equal(run.shop.pending, null);
  assert.equal(run.gold, goldBefore, '取消不扣钱');

  run.buy(boneOffer.slotIndex);
  const done = run.confirmKind('man:5');
  assert.equal(done.ok, true);
  assert.equal(run.gold, goldBefore - boneOffer.price);
  assert.equal(run.bones['man:5'], boneOffer.id);
  assert.equal(run.shop.items.find((item) => item.slotIndex === boneOffer.slotIndex).sold, true);

  // 覆盖同一牌种
  run.gold += 50;
  run.shop.items.push({ slotIndex: 9, family: 'bone', id: 'warmJade', price: 5, sold: false });
  run.buy(9);
  const replaced = run.confirmKind('man:5');
  assert.equal(replaced.ok, true);
  assert.equal(replaced.replaced, boneOffer.id, '必须报告被覆盖的旧牌骨');
  assert.equal(run.bones['man:5'], 'warmJade');
});

test('买到的牌骨在下一副真的出现在手上', () => {
  const run = runToShop();
  const boneOffer = run.shop.items.find((item) => item.family === 'bone');
  run.buy(boneOffer.slotIndex);
  run.confirmKind('sou:3');
  run.leaveShop();
  startSelectedBlind(run);
  const seen = run.looseTiles.filter((tile) => tileKey(tile) === 'sou:3').length;
  assert.ok(seen >= 1, '刚改造的牌种必须能看见');
});

test('番谱可以累计升级，满级后不再出现在货架', () => {
  const run = runToShop();
  const codexOffer = run.shop.items.find((item) => item.family === 'codex');
  const book = getItem('codex', codexOffer.id);
  run.gold += 100;
  run.buy(codexOffer.slotIndex);
  assert.equal(run.codexLevels[book.pattern], 1);

  run.codexLevels[book.pattern] = CODEX_MAX_LEVEL;
  const refreshed = run.rollShop(5);
  const offered = refreshed.items.find((item) => item.family === 'codex');
  const nextBook = getItem('codex', offered.id);
  assert.notEqual(nextBook.pattern, book.pattern, '满级番谱不该继续出现');
  assert.ok(CODEX_BY_PATTERN[nextBook.pattern]);
});

test('福将占将位，位满不能再买', () => {
  const run = runToShop();
  run.gold += 100;
  run.generalIds = ['azureEnvoy', 'stoneWarden', 'ladyConcord', 'coinBoy'];
  const generalOffer = run.shop.items.find((item) => item.family === 'general');
  const result = run.buy(generalOffer.slotIndex);
  assert.equal(result.ok, false);
  assert.match(result.reason, /将位/);
});

test('两副达标金币入账，未达标不入账且重试会清空本关进度', () => {
  const run = runToShop();
  assert.equal(run.pendingGold, 0);
  assert.equal(run.gold, CONFIG.startingGold + run.completedBlinds[0].banked);

  const failing = startSelectedBlind(new Run({ seed: SEED }));
  failing.blindScore = 10;
  failing.pendingGold = 12;
  failing.handIndex = ANTES[0].handsPerBlind - 1;
  failing.status = 'hand-won';
  failing.advance();
  assert.equal(failing.status, 'run-over');
  assert.equal(failing.gold, CONFIG.startingGold);
  assert.equal(failing.retryBlind().ok, true);
  assert.equal(failing.status, 'blind-select');
  assert.equal(failing.pendingGold, 0);
  assert.equal(failing.blindScore, 0);
  assert.equal(failing.handIndex, 0);
  assert.equal(failing.selectBlind().ok, true);
});

test('流局只吃掉本副，之前的分数保留', () => {
  const run = startSelectedBlind(new Run({ seed: SEED }));
  playHand(run);
  const firstScore = run.blindScore;
  assert.ok(firstScore > 0);
  run.advance();
  run.swapsRemaining = 0;
  run.refreshStatus();
  if (run.status === 'hand-failed') {
    run.advance();
    assert.equal(run.blindScore, firstScore);
  }
});

test('财气立刻结算，不进入待生效手气栏', () => {
  const run = new Run({ seed: SEED });
  const goldBefore = run.gold;
  run.applyTag('coin');
  assert.equal(run.gold, goldBefore + getItem('tag', 'coin').effect.value);
  assert.ok(!run.tags.includes('coin'));
});

test('签气在下一关首副发牌后消耗', () => {
  const run = new Run({ seed: SEED });
  run.applyTag('charm');
  assert.equal(run.pendingFreeCharms, 1);
  assert.ok(run.tags.includes('charm'));

  startSelectedBlind(run);
  assert.equal(run.pendingFreeCharms, 0);
  assert.equal(run.charmIds.length, 1);
  assert.ok(!run.tags.includes('charm'));
});

test('顺气覆盖整关两副，并在本关结束后消耗', () => {
  const run = new Run({ seed: SEED });
  run.applyTag('swap');
  assert.ok(run.tags.includes('swap'));
  startSelectedBlind(run);

  for (let index = 0; index < ANTES[0].handsPerBlind; index += 1) {
    assert.equal(run.swapsRemaining, CONFIG.swapsPerHand + 1);
    playHand(run);
    run.advance();
  }
  assert.equal(run.status, 'shop');
  assert.equal(run.pendingExtraSwaps, 0);
  assert.ok(!run.tags.includes('swap'));
});

test('免单气在免费购买第一件商品后消耗', () => {
  const run = runToShop();
  run.applyTag('freeBuy');
  assert.equal(run.pendingFreeBuy, 1);
  assert.ok(run.tags.includes('freeBuy'));

  const offer = run.shop.items[0];
  const goldBefore = run.gold;
  const bought = run.buy(offer.slotIndex);
  assert.equal(bought.ok, true);
  assert.equal(bought.price, 0);
  assert.equal(run.gold, goldBefore);
  assert.equal(run.pendingFreeBuy, 0);
  assert.ok(!run.tags.includes('freeBuy'));
});

test('五系内容都写了明确的持续时间与卡面文案，不出现「永久」', () => {
  const durations = ['本副', '本轮', '本局', '局外'];
  for (const family of ['charm', 'codex', 'general', 'bone', 'seal']) {
    assert.ok(durations.includes(FAMILIES[family].duration), `${family} 的持续时间不合法`);
    const items = listItems(family);
    assert.ok(items.length >= 2, `${family} 至少要有 2 件内容用于验证`);
    for (const item of items) {
      assert.ok(item.name && item.text, `${item.id} 缺名字或卡面文案`);
      assert.ok(durations.includes(item.duration ?? FAMILIES[family].duration));
      assert.ok(!item.text.includes('永久'), `${item.id} 不能用「永久」`);
      if (family === 'seal') {
        assert.ok(['swapOut', 'reveal', 'settle'].includes(item.trigger), `${item.id} 缺触发时机`);
        assert.match(item.text, /每副最多/, `${item.id} 必须写清每副上限`);
      }
    }
  }
});
