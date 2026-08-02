import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHARMS,
  OMEN_IDS,
  draftCharmOffers,
} from '../src/content/charms.mjs';
import { Run } from '../src/core/run.mjs';
import { createSeededRng } from '../src/core/tiles.mjs';

const GROUP_KINDS = Object.freeze(['pair', 'chow', 'pung', 'kong']);
const REPRESENTATIVE_SEEDS = Object.freeze([1, 5, 12, 97, 777, 4242, 20260726]);

const makeGroup = (kind, id = `audit-${kind}`) => ({
  id,
  kind,
  tiles: [],
  revealed: true,
  charmId: null,
});

const makeOmen = (omenId, sourceCharmId) => ({
  omenId,
  sourceCharmId,
  acquiredAtBlind: '0:small',
  consumeOn: 'nextCharmDraft',
});

function prepareDraft(run, seed, kind = 'pair', mode = 'normal') {
  const group = makeGroup(kind);
  run.seed = seed >>> 0;
  run.anteIndex = 0;
  run.blindKind = 'small';
  run.handIndex = 0;
  run.revealedGroups = [group];
  run.pendingOmen = mode === 'lucky'
    ? makeOmen(OMEN_IDS.luckyTier, 'luckyOmen')
    : (mode === 'wide' ? makeOmen(OMEN_IDS.extraChoice, 'wideOmen') : null);
  run.omenTriggeredThisHand = false;
  const draft = run.createCharmDraft(group, null);
  assert.ok(draft, `${seed}/${kind}/${mode} 应当生成完整签局`);
  return { group, draft };
}

function tierLayout(draft) {
  if (draft.tierSlots.includes('rainbow')) return 'rainbow';
  if (draft.tierSlots.includes('gold')) return 'gold';
  return 'silver';
}

test('生产 draftSeed 打散连续 seed，真实签局仍接近 72/25/3 且不长段聚团', () => {
  const run = new Run({ seed: 1 });
  const samples = 20000;
  const counts = { silver: 0, gold: 0, rainbow: 0 };
  let silverStreak = 0;
  let longestSilverStreak = 0;

  for (let seed = 1; seed <= samples; seed += 1) {
    const { draft } = prepareDraft(run, seed);
    const layout = tierLayout(draft);
    counts[layout] += 1;
    silverStreak = layout === 'silver' ? silverStreak + 1 : 0;
    longestSilverStreak = Math.max(longestSilverStreak, silverStreak);
  }

  assert.ok(Math.abs(counts.silver / samples - 0.72) < 0.015, JSON.stringify(counts));
  assert.ok(Math.abs(counts.gold / samples - 0.25) < 0.015, JSON.stringify(counts));
  assert.ok(Math.abs(counts.rainbow / samples - 0.03) < 0.008, JSON.stringify(counts));
  assert.ok(longestSilverStreak < 80, `连续银局过长：${longestSilverStreak}`);

  // 相邻 seed 被混洗，但同一个 seed 的完整签阶与内容仍必须完全一致。
  const first = prepareDraft(run, 31415).draft;
  const second = prepareDraft(run, 31415).draft;
  assert.deepEqual(second.tierSlots, first.tierSlots);
  assert.deepEqual(second.charmIds, first.charmIds);
});

test('鸿运 15% 升彩也走真实 createCharmDraft，连续 seed 不聚成大片同结果', () => {
  const run = new Run({ seed: 1 });
  const samples = 12000;
  let rainbowCount = 0;
  let nonRainbowStreak = 0;
  let longestNonRainbowStreak = 0;

  for (let seed = 1; seed <= samples; seed += 1) {
    const { draft } = prepareDraft(run, seed, 'pair', 'lucky');
    assert.equal(draft.appliedOmen.omenId, OMEN_IDS.luckyTier);
    assert.ok(
      draft.tierSlots.includes('gold') || draft.tierSlots.includes('rainbow'),
      '鸿运签必须至少保证一张金签',
    );
    const rainbow = draft.tierSlots.includes('rainbow');
    if (rainbow) {
      rainbowCount += 1;
      nonRainbowStreak = 0;
    } else {
      nonRainbowStreak += 1;
      longestNonRainbowStreak = Math.max(longestNonRainbowStreak, nonRainbowStreak);
    }
  }

  assert.ok(Math.abs(rainbowCount / samples - 0.15) < 0.015, String(rainbowCount));
  assert.ok(longestNonRainbowStreak < 100, `鸿运升彩结果聚团过长：${longestNonRainbowStreak}`);
});

test('当前卡池在四种亮组、三种签局模式和代表 seed 下始终完整且不重复', () => {
  const run = new Run({ seed: 1 });
  for (const seed of REPRESENTATIVE_SEEDS) {
    for (const kind of GROUP_KINDS) {
      for (const mode of ['normal', 'lucky', 'wide']) {
        const { draft } = prepareDraft(run, seed, kind, mode);
        const expectedCount = mode === 'wide' ? 4 : 3;
        assert.equal(draft.offerCount, expectedCount, `${seed}/${kind}/${mode}`);
        assert.equal(draft.offers.length, expectedCount, `${seed}/${kind}/${mode}`);
        assert.equal(new Set(draft.charmIds).size, expectedCount, `${seed}/${kind}/${mode}`);
        assert.deepEqual(draft.tierSlots, draft.offers.map((offer) => offer.tier));
        assert.deepEqual(
          draft.offers.slice(0, 3).map((offer) => offer.slotRole),
          ['group', 'pattern', 'wild'],
        );
        if (mode === 'wide') {
          assert.equal(draft.offers[3].slotRole, 'extra');
          assert.equal(draft.offers[3].tier, 'silver');
        }
        if (mode !== 'normal') {
          assert.ok(
            draft.offers.every((offer) => !CHARMS[offer.charmId].omen),
            `${seed}/${kind}/${mode} 增强签局不能续签兆`,
          );
        }
      }
    }
  }
});

test('问签至少换一张，并保持签阶、数量、职责与去重', () => {
  const run = new Run({ seed: 5 });
  const { draft } = prepareDraft(run, 5);

  run.draft = { ...draft, rerollsLeft: 1 };
  run.status = 'charm-draft';
  const beforeIds = [...draft.charmIds];
  const beforeTiers = [...draft.tierSlots];
  const beforeRoles = draft.offers.map((offer) => offer.slotRole);
  const result = run.rerollDraft();

  assert.equal(result.ok, true);
  assert.equal(run.draft.offerCount, draft.offerCount);
  assert.deepEqual(run.draft.tierSlots, beforeTiers);
  assert.deepEqual(run.draft.offers.map((offer) => offer.slotRole), beforeRoles);
  assert.equal(new Set(run.draft.charmIds).size, run.draft.offerCount);
  assert.ok(
    run.draft.charmIds.some((charmId, index) => charmId !== beforeIds[index]),
    '扩池后问签仍应至少改变一张',
  );
  assert.ok(run.draft.offers.every((offer) => offer.offerId.includes(':r1:')));
});
