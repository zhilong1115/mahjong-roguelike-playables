import assert from 'node:assert/strict';
import test from 'node:test';

import { ANTES } from '../src/content/index.mjs';
import { Run } from '../src/core/run.mjs';
import { tileKey } from '../src/core/tiles.mjs';
import { SCHEMA_VERSION, createLocalStorage, migrate, restoreRun, serializeRun } from '../src/state/save.mjs';
import { playHand, smartSwap } from './helpers/auto-play.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildRun() {
  const run = new Run({ seed: 20260726 });
  assert.equal(run.status, 'blind-select');
  assert.equal(run.selectBlind().ok, true);
  for (let index = 0; index < ANTES[0].handsPerBlind; index += 1) {
    playHand(run, { revealTarget: index === 1 ? 2 : 0 });
    run.advance();
  }
  // 在百宝阁买齐四类长期内容，存档里才有东西可验
  run.gold += 100;
  for (const offer of [...run.shop.items]) {
    const result = run.buy(offer.slotIndex);
    if (result.needsKind) run.confirmKind('man:5');
  }
  run.leaveShop();
  assert.equal(run.status, 'blind-select');
  assert.equal(run.selectBlind().ok, true);
  // 故意停在一副打到一半的状态：这才是最容易存坏的时刻
  smartSwap(run);
  smartSwap(run);
  return run;
}

test('存档往返：手牌、牌墙、已亮组、五系构筑全部还原', () => {
  const run = buildRun();
  const data = serializeRun(run);
  assert.equal(data.schemaVersion, SCHEMA_VERSION);

  const restored = new Run({ seed: 1 });
  const result = restoreRun(restored, clone(data));
  assert.equal(result.ok, true);

  assert.equal(restored.seed, run.seed);
  assert.equal(restored.gold, run.gold);
  assert.equal(restored.anteIndex, run.anteIndex);
  assert.equal(restored.blindKind, run.blindKind);
  assert.equal(restored.handIndex, run.handIndex);
  assert.equal(restored.blindScore, run.blindScore);
  assert.equal(restored.pendingGold, run.pendingGold);
  assert.deepEqual(restored.blindOutcomes, run.blindOutcomes);
  assert.deepEqual(restored.completedBlinds, data.completedBlinds);
  assert.deepEqual(restored.generalIds, run.generalIds);
  assert.deepEqual(restored.codexLevels, run.codexLevels);
  assert.deepEqual(restored.bones, run.bones);
  assert.deepEqual(restored.seals, run.seals);
  assert.deepEqual([...restored.usedSealKinds], [...run.usedSealKinds]);
  assert.deepEqual(restored.looseTiles.map(tileKey), run.looseTiles.map(tileKey));
  assert.deepEqual(restored.wall.slice(0, 5).map(tileKey), run.wall.slice(0, 5).map(tileKey));
  assert.deepEqual(
    restored.revealedGroups.map((group) => group.tiles.map(tileKey)),
    run.revealedGroups.map((group) => group.tiles.map(tileKey)),
  );
  assert.deepEqual(restored.charmIds, run.charmIds);
});

test('从半副恢复后继续打，结算结果与原局完全一致', () => {
  const run = buildRun();
  assert.ok(['playing', 'hu-ready'].includes(run.status), '存档点应当在一副的中间');
  const restored = new Run({ seed: 1 });
  restoreRun(restored, clone(serializeRun(run)));

  const originalStatus = playHand(run);
  const restoredStatus = playHand(restored);
  assert.equal(restoredStatus, originalStatus);
  assert.equal(restored.blindScore, run.blindScore);
  assert.equal(restored.pendingGold, run.pendingGold);
  assert.deepEqual(restored.lastHandResult?.patterns, run.lastHandResult?.patterns);
  assert.equal(restored.lastHandResult?.score, run.lastHandResult?.score);
});

test('南西圈三张牌墙预览在存档恢复后保持不变', () => {
  const run = new Run({ seed: 20260726 });
  run.anteIndex = 1;
  assert.equal(run.selectBlind().ok, true);
  assert.equal(run.previewCount, 3);

  const saved = serializeRun(run);
  const restored = new Run({ seed: 1 });
  assert.equal(restoreRun(restored, clone(saved)).ok, true);
  assert.equal(restored.previewCount, 3);
  assert.equal(restored.snapshot().upcomingTiles.length, 3);

  delete saved.hand.previewCount;
  const legacyV4 = new Run({ seed: 1 });
  assert.equal(restoreRun(legacyV4, clone(saved)).ok, true);
  assert.equal(legacyV4.previewCount, 3, '旧 v4 存档按圈数补出预览张数');
});

test('v1 → v2 迁移：tileMods 拆成 bones 与 seals', () => {
  const run = buildRun();
  const data = serializeRun(run);
  const legacy = { ...clone(data), schemaVersion: 1, tileMods: { 'man:5': { bone: 'warmJade', seal: 'returnWind' } } };
  delete legacy.bones;
  delete legacy.seals;

  const migrated = migrate(legacy);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(migrated.bones, { 'man:5': 'warmJade' });
  assert.deepEqual(migrated.seals, { 'man:5': 'returnWind' });

  const restored = new Run({ seed: 1 });
  assert.equal(restoreRun(restored, migrated).ok, true);
  assert.equal(restored.bones['man:5'], 'warmJade');
});

test('无法解析的存档返回 null，不会静默覆盖', () => {
  assert.equal(migrate(null), null);
  assert.equal(migrate({ schemaVersion: 99 }), null);
  assert.equal(migrate({ schemaVersion: SCHEMA_VERSION }), null, '缺少手牌的档不能接受');

  const run = new Run({ seed: 5 });
  const before = run.looseTiles.map(tileKey);
  assert.equal(restoreRun(run, { schemaVersion: 42 }).ok, false);
  assert.deepEqual(run.looseTiles.map(tileKey), before, '坏档不能破坏当前进度');
});

test('本地存档读写走同一份 JSON', async () => {
  const backing = new Map();
  const storage = createLocalStorage({
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => backing.set(key, value),
    removeItem: (key) => backing.delete(key),
  });
  const run = new Run({ seed: 31415 });
  assert.equal(await storage.save(serializeRun(run)), true);
  const loaded = await storage.load();
  assert.equal(loaded.seed, run.seed);
  const restored = new Run({ seed: 1 });
  assert.equal(restoreRun(restored, loaded).ok, true);
  await storage.clear();
  assert.equal(await storage.load(), null);
});
