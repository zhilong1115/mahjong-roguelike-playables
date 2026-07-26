import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHARMS,
  CHARM_LIST,
  OMEN_IDS,
  draftCharmOffers,
  rollCharmTierSlots,
} from '../src/content/charms.mjs';
import { Run } from '../src/core/run.mjs';
import { createSeededRng } from '../src/core/tiles.mjs';
import {
  SCHEMA_VERSION,
  createLocalStorage,
  migrate,
  restoreRun,
  serializeRun,
} from '../src/state/save.mjs';
import { revealFromWinningShape, smartSwap } from './helpers/auto-play.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));

function omen(omenId, sourceCharmId) {
  return {
    omenId,
    sourceCharmId,
    acquiredAtBlind: '0:small',
    consumeOn: 'nextCharmDraft',
  };
}

function openDraft(run) {
  if (run.status === 'blind-select') assert.equal(run.selectBlind().ok, true);
  let guard = 0;
  while (run.status === 'playing' && guard++ < 30) smartSwap(run);
  assert.equal(run.status, 'hu-ready', '固定牌谱应当能摸到可胡');
  assert.equal(revealFromWinningShape(run), true, '获胜分解里应当能亮出一组');
  assert.equal(run.status, 'charm-draft');
  return run.draft;
}

function replaceOfferWithOmen(run, charmId) {
  const charm = CHARMS[charmId];
  const index = run.draft.offers.length - 1;
  const offer = {
    ...run.draft.offers[index],
    charmId,
    tier: charm.tier,
    role: charm.functionRole,
    draftRole: charm.draftRole,
  };
  run.draft.offers[index] = offer;
  run.draft.charmIds[index] = charmId;
  run.draft.tierSlots[index] = charm.tier;
  return offer;
}

test('每张灵签有固定签阶和新职责，现有卡池同时覆盖银 / 金 / 彩', () => {
  const tiers = new Set();
  for (const charm of CHARM_LIST) {
    assert.ok(['silver', 'gold', 'rainbow'].includes(charm.tier), `${charm.id} 缺固定签阶`);
    assert.ok(['momentum', 'fate', 'omen'].includes(charm.functionRole), `${charm.id} 缺功能职责`);
    assert.ok(['group', 'pattern', 'wild'].includes(charm.draftRole), `${charm.id} 缺兼容货位职责`);
    tiers.add(charm.tier);
  }
  assert.deepEqual([...tiers].sort(), ['gold', 'rainbow', 'silver']);
  assert.equal(CHARMS.luckyOmen.omen.omenId, OMEN_IDS.luckyTier);
  assert.equal(CHARMS.wideOmen.omen.omenId, OMEN_IDS.extraChoice);
  assert.equal(CHARMS.luckyOmen.duration, '本局');
  assert.equal(CHARMS.wideOmen.duration, '本局');
  for (const id of ['tailwind', 'carving', 'doubleJoy', 'dragonVein', 'honorSeal', 'doubleBless', 'reserve']) {
    assert.equal(CHARMS[id].functionRole, 'momentum', `${id} 是直接加分助势，不应显示为奇缘`);
  }
  for (const id of ['wealth', 'luckyOmen', 'wideOmen', 'rainbowBless']) {
    assert.equal(CHARMS[id].functionRole, 'omen', `${id} 应显示为奇缘`);
  }
  assert.equal(CHARMS.rainbowBless.omen, null, '虹福签是即时彩签，不应留下延时签兆');
});

test('普通签阶版式接近 72% 全银 / 25% 一金 / 3% 一彩，且最多一个高阶位', () => {
  const rng = createSeededRng(20260726);
  const counts = { silver: 0, gold: 0, rainbow: 0 };
  const samples = 30000;
  for (let index = 0; index < samples; index += 1) {
    const slots = rollCharmTierSlots(rng, 'pair');
    assert.equal(slots.filter((tier) => tier !== 'silver').length <= 1, true);
    if (slots.includes('rainbow')) counts.rainbow += 1;
    else if (slots.includes('gold')) counts.gold += 1;
    else counts.silver += 1;
  }
  assert.ok(Math.abs(counts.silver / samples - 0.72) < 0.015, JSON.stringify(counts));
  assert.ok(Math.abs(counts.gold / samples - 0.25) < 0.015, JSON.stringify(counts));
  assert.ok(Math.abs(counts.rainbow / samples - 0.03) < 0.008, JSON.stringify(counts));

  const offers = draftCharmOffers(createSeededRng(9), 'pair', {
    offerCount: 3,
    tierSlots: ['silver', 'gold', 'rainbow'],
  });
  assert.deepEqual(offers.map((offer) => offer.tier), ['silver', 'gold', 'rainbow']);
  assert.equal(new Set(offers.map((offer) => offer.charmId)).size, 3);

  const luckyRng = createSeededRng(15015);
  let luckyRainbow = 0;
  const luckySamples = 12000;
  for (let index = 0; index < luckySamples; index += 1) {
    const slots = rollCharmTierSlots(luckyRng, 'pair', {
      minimumTier: 'gold',
      rainbowChance: 0.15,
      excludeDelayedOmens: true,
    });
    assert.ok(slots.includes('gold') || slots.includes('rainbow'), '鸿运保底不能降成全银');
    if (slots.includes('rainbow')) luckyRainbow += 1;
  }
  assert.ok(Math.abs(luckyRainbow / luckySamples - 0.15) < 0.015, String(luckyRainbow));
});

test('签局快照包含 offerId / offerCount / tierSlots / offers，问签重抽不改变签阶版式', () => {
  const run = new Run({ seed: 777 });
  const draft = openDraft(run);
  assert.match(draft.draftId, /^d:/);
  assert.equal(draft.offerCount, 3);
  assert.equal(draft.offers.length, draft.offerCount);
  assert.deepEqual(draft.charmIds, draft.offers.map((offer) => offer.charmId));
  assert.deepEqual(draft.tierSlots, draft.offers.map((offer) => offer.tier));
  assert.equal(new Set(draft.offers.map((offer) => offer.offerId)).size, draft.offerCount);

  const before = {
    draftId: draft.draftId,
    offerCount: draft.offerCount,
    tierSlots: [...draft.tierSlots],
    appliedOmen: draft.appliedOmen,
  };
  run.draft.rerollsLeft = 1;
  const result = run.rerollDraft();
  assert.equal(result.ok, true);
  assert.equal(run.draft.draftId, before.draftId);
  assert.equal(run.draft.offerCount, before.offerCount);
  assert.deepEqual(run.draft.tierSlots, before.tierSlots);
  assert.deepEqual(run.draft.appliedOmen, before.appliedOmen);
  assert.ok(run.draft.offers.every((offer) => offer.offerId.includes(':r1:')));
});

test('鸿运兆只消费一次、保证至少金签，并阻止延时奇缘续杯', () => {
  const run = new Run({ seed: 777 });
  run.pendingOmen = omen(OMEN_IDS.luckyTier, 'luckyOmen');
  const draft = openDraft(run);
  assert.equal(draft.appliedOmen.omenId, OMEN_IDS.luckyTier);
  assert.equal(run.pendingOmen, null);
  assert.equal(run.omenTriggeredThisHand, true);
  assert.ok(draft.tierSlots.some((tier) => tier === 'gold' || tier === 'rainbow'));
  assert.ok(draft.offers.every((offer) => !CHARMS[offer.charmId].omen), '增强签局不能继续留下签兆');

  run.draft.rerollsLeft = 1;
  const applied = clone(run.draft.appliedOmen);
  assert.equal(run.rerollDraft().ok, true);
  assert.deepEqual(run.draft.appliedOmen, applied);
  assert.equal(run.pendingOmen, null, '重抽不能再次消费或恢复签兆');
});

test('广缘兆生成四选一，第四位固定银签，四张互不重复', () => {
  const run = new Run({ seed: 909090 });
  run.pendingOmen = omen(OMEN_IDS.extraChoice, 'wideOmen');
  const draft = openDraft(run);
  assert.equal(draft.appliedOmen.omenId, OMEN_IDS.extraChoice);
  assert.equal(draft.offerCount, 4);
  assert.equal(draft.offers.length, 4);
  assert.equal(draft.tierSlots[3], 'silver');
  assert.equal(draft.offers[3].slotRole, 'extra');
  assert.equal(new Set(draft.charmIds).size, 4);
  assert.ok(draft.offers.every((offer) => !CHARMS[offer.charmId].omen));
});

test('自然签局里选择广缘签，会在下一次独立求签兑现', () => {
  const run = new Run({ seed: 12 });
  const firstDraft = openDraft(run);
  const wide = firstDraft.offers.find((offer) => offer.charmId === 'wideOmen');
  assert.ok(wide, '固定 seed 应当自然出现广缘签');
  assert.equal(run.chooseDraftOffer(wide.offerId).ok, true);
  assert.equal(run.pendingOmen.omenId, OMEN_IDS.extraChoice);

  assert.equal(revealFromWinningShape(run), true);
  assert.equal(run.draft.offerCount, 4);
  assert.equal(run.draft.appliedOmen.omenId, OMEN_IDS.extraChoice);
  assert.equal(run.pendingOmen, null);
});

test('待缘位已有签兆时不会静默覆盖，可取消或确认替换', () => {
  const run = new Run({ seed: 777 });
  openDraft(run);
  const original = omen(OMEN_IDS.luckyTier, 'luckyOmen');
  run.pendingOmen = clone(original);
  const offered = replaceOfferWithOmen(run, 'wideOmen');

  const staged = run.chooseDraftOffer(offered.offerId);
  assert.equal(staged.ok, true);
  assert.equal(staged.needsOmenReplace, true);
  assert.deepEqual(run.pendingOmen, original);
  assert.equal(run.status, 'charm-draft');
  assert.equal(run.draft.pendingOmenReplacement.next.omenId, OMEN_IDS.extraChoice);
  assert.equal(run.rerollDraft().ok, false, '替换确认期间不能重抽');

  const restored = new Run({ seed: 1 });
  assert.equal(restoreRun(restored, clone(serializeRun(run))).ok, true);
  assert.deepEqual(restored.draft.pendingOmenReplacement, run.draft.pendingOmenReplacement);
  assert.deepEqual(restored.pendingOmen, original);

  assert.equal(run.cancelPendingOmenReplacement().ok, true);
  assert.deepEqual(run.pendingOmen, original);
  assert.equal(run.draft.pendingOmenReplacement, null);

  assert.equal(run.chooseDraftOffer(offered.offerId).needsOmenReplace, true);
  const confirmed = run.confirmPendingOmen();
  assert.equal(confirmed.ok, true);
  assert.equal(run.pendingOmen.omenId, OMEN_IDS.extraChoice);
  assert.equal(run.status === 'charm-draft', false);
  assert.equal(run.charmInstances.at(-1).instanceId, offered.offerId);
});

test('失败重试恢复进关前待缘快照，失败尝试不能新增或刷掉签兆', () => {
  const run = new Run({ seed: 5 });
  const beforeBlind = omen(OMEN_IDS.luckyTier, 'luckyOmen');
  run.pendingOmen = clone(beforeBlind);
  assert.equal(run.selectBlind().ok, true);
  assert.deepEqual(run.blindEntryPendingOmen, beforeBlind);

  run.pendingOmen = omen(OMEN_IDS.extraChoice, 'wideOmen');
  run.status = 'run-over';
  assert.equal(run.retryBlind().ok, true);
  assert.deepEqual(run.pendingOmen, beforeBlind, '失败尝试取得的新签兆必须被撤销');

  assert.equal(run.selectBlind().ok, true);
  run.pendingOmen = null;
  run.status = 'run-over';
  run.retryBlind();
  assert.deepEqual(run.pendingOmen, beforeBlind, '失败尝试消耗的旧签兆必须恢复');
});

test('schema v4 原样保存增强签局；v3 迁移只补签阶，不重抽旧签', () => {
  const run = new Run({ seed: 777 });
  run.pendingOmen = omen(OMEN_IDS.extraChoice, 'wideOmen');
  openDraft(run);
  const saved = serializeRun(run);
  assert.equal(saved.schemaVersion, 4);

  const restored = new Run({ seed: 1 });
  assert.equal(restoreRun(restored, clone(saved)).ok, true);
  assert.deepEqual(restored.draft, run.draft);
  assert.equal(restored.pendingOmen, null);
  assert.equal(restored.omenTriggeredThisHand, true);

  const v3 = clone(saved);
  v3.schemaVersion = 3;
  v3.hand.charmIds = ['tailwind', 'doubleBless'];
  delete v3.hand.charmInstances;
  v3.hand.draft = {
    groupId: 'legacy-group',
    slotIndex: 1,
    charmIds: ['tailwind', 'dragonVein', 'wealth'],
    rerollsLeft: 1,
    rerollSource: 'askOracle',
    rolls: 0,
  };
  delete v3.pendingOmen;
  delete v3.blindEntryPendingOmen;
  delete v3.hand.omenTriggeredThisHand;

  const migrated = migrate(v3);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(migrated.hand.draft.charmIds, v3.hand.draft.charmIds, '旧签内容不能重抽');
  assert.deepEqual(migrated.hand.draft.tierSlots, ['silver', 'gold', 'silver']);
  assert.deepEqual(
    migrated.hand.charmInstances.map((instance) => instance.tier),
    ['silver', 'gold'],
  );
  assert.equal(migrated.pendingOmen, null);

  const v2 = clone(v3);
  v2.schemaVersion = 2;
  v2.roundIndex = 1;
  v2.roundScore = 321;
  v2.completedRounds = [];
  delete v2.anteIndex;
  delete v2.blindKind;
  const migratedV2 = migrate(v2);
  assert.equal(migratedV2.schemaVersion, SCHEMA_VERSION);
  assert.equal(migratedV2.anteIndex, 1);
  assert.equal(migratedV2.blindKind, 'small');
  assert.deepEqual(migratedV2.hand.draft.charmIds, v3.hand.draft.charmIds);
});

test('本地存档优先读取 v4，并能回退读取旧 v3 key；清档同时清两份', async () => {
  const backing = new Map();
  const storage = createLocalStorage({
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => backing.set(key, value),
    removeItem: (key) => backing.delete(key),
  });
  backing.set('tianhu.run.v3', JSON.stringify({ schemaVersion: 3, seed: 3 }));
  assert.equal((await storage.load()).seed, 3);
  backing.set('tianhu.run.v4', '{broken-json');
  assert.equal((await storage.load()).seed, 3, 'v4 损坏时仍应尝试尚未清理的 v3');
  await storage.save({ schemaVersion: 4, seed: 4 });
  assert.equal((await storage.load()).seed, 4);
  assert.equal(backing.has('tianhu.run.v3'), false, 'v4 成功写入后才清理旧 v3 键');
  await storage.clear();
  assert.equal(backing.has('tianhu.run.v3'), false);
  assert.equal(backing.has('tianhu.run.v4'), false);
});
