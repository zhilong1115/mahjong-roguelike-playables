import assert from 'node:assert/strict';
import test from 'node:test';

import { CODEX_CHIPS_PER_LEVEL, CONFIG } from '../src/content/index.mjs';
import { findHuSolutions } from '../src/core/patterns.mjs';
import { scoreHand } from '../src/core/scoring.mjs';
import { group, hand } from './helpers/auto-play.mjs';

const PLAIN = '123m 456m 456p 111s EE';
const PURE = '123m 456m 789m 111m 99m';

function solutionOf(notation, revealed = []) {
  const solutions = findHuSolutions(hand(notation), revealed);
  assert.ok(solutions.length, `${notation} 应当能胡`);
  return solutions[0];
}

test('基础结算：底分 + 组合 + 空开运位牌值，最后牌值 × 番势', () => {
  const result = scoreHand({ solution: solutionOf(PLAIN), emptySlots: 6, revealCount: 0 });
  const structure = CONFIG.huBase
    + CONFIG.groupChips.chow * 3 + CONFIG.groupChips.pung + CONFIG.groupChips.pair;
  assert.deepEqual(result.patterns, ['普通胡', '门清']);
  assert.equal(result.chips, structure + 6 * CONFIG.emptySlotChips);
  // 普通胡本身给 +1 番势，抬高最差牌型的地板（见 0013 的数值重标）
  assert.equal(result.mult, 1 + CONFIG.patternMult['普通胡']);
  assert.equal(result.total, result.chips * result.mult);
});

test('每花一个开运位固定少 12 牌值，没有断崖', () => {
  const totals = [0, 1, 2, 3].map((used) => scoreHand({
    solution: solutionOf(PLAIN),
    emptySlots: CONFIG.fortuneSlots - used,
    revealCount: used,
  }).chips);
  for (let index = 1; index < totals.length; index += 1) {
    assert.equal(totals[index - 1] - totals[index], CONFIG.emptySlotChips);
  }
});

test('steps 按 0011 的八步顺序排列，并且自洽', () => {
  const result = scoreHand({
    solution: solutionOf(PURE),
    emptySlots: 4,
    revealCount: 2,
    charmIds: ['doubleBless'],
    generalIds: ['azureEnvoy'],
    bones: { 'man:1': 'warmJade' },
    codexLevels: { 清一色: 2 },
  });

  const order = result.steps.map((step) => step.source);
  const firstIndex = (source) => order.indexOf(source);
  assert.equal(order[0], 'base');
  assert.ok(firstIndex('group') < firstIndex('slots'));
  assert.ok(firstIndex('slots') < firstIndex('bone'));
  assert.ok(firstIndex('bone') < firstIndex('pattern'));
  assert.ok(firstIndex('pattern') < firstIndex('codex'));
  assert.ok(firstIndex('codex') < firstIndex('charm'));
  assert.ok(firstIndex('charm') < firstIndex('general'));
  assert.equal(order.at(-1), 'total');

  // chipsAfter / multAfter 必须是逐步累加的结果，动画才敢直接照着显示
  let chips = 0;
  let mult = 1;
  for (const step of result.steps) {
    if (step.source === 'total') break;
    chips += step.chips;
    mult += step.mult;
    assert.equal(step.chipsAfter, chips, `${step.label} 的 chipsAfter 不对`);
    assert.equal(step.multAfter, mult, `${step.label} 的 multAfter 不对`);
  }
  assert.equal(result.chips, chips);
  assert.equal(result.mult, mult);
  assert.equal(result.total, Math.floor(chips * mult));
  assert.ok(result.steps.every((step) => step.target), '每一步都要有动画锚点');
});

test('番谱按等级给牌值，且只影响对应番种', () => {
  const base = scoreHand({ solution: solutionOf(PURE), emptySlots: 6 });
  const level2 = scoreHand({ solution: solutionOf(PURE), emptySlots: 6, codexLevels: { 清一色: 2 } });
  assert.equal(level2.chips - base.chips, 2 * CODEX_CHIPS_PER_LEVEL);

  const mismatched = scoreHand({ solution: solutionOf(PURE), emptySlots: 6, codexLevels: { 七对: 3 } });
  assert.equal(mismatched.chips, base.chips, '不匹配的番谱不该加分');
});

test('牌骨按牌种的每张牌结算，青竹骨只认顺子里的牌', () => {
  const base = scoreHand({ solution: solutionOf(PURE), emptySlots: 6 });
  // 1万在这副里出现 4 张：123m 顺子 1 张 + 111m 刻子 3 张
  const warm = scoreHand({ solution: solutionOf(PURE), emptySlots: 6, bones: { 'man:1': 'warmJade' } });
  assert.equal(warm.chips - base.chips, 4 * 12);

  const bamboo = scoreHand({ solution: solutionOf(PURE), emptySlots: 6, bones: { 'man:1': 'greenBamboo' } });
  assert.equal(bamboo.chips - base.chips, 1 * 18, '青竹骨只算顺子里的那一张');

  const absent = scoreHand({ solution: solutionOf(PURE), emptySlots: 6, bones: { 'sou:3': 'warmJade' } });
  assert.equal(absent.chips, base.chips, '没出现的牌种不产生步骤');
  assert.ok(!absent.steps.some((step) => step.source === 'bone'));
});

test('结算类牌印：守门印只在暗组命中时给金币，且受每副上限约束', () => {
  const concealed = scoreHand({
    solution: solutionOf(PURE),
    emptySlots: 6,
    seals: { 'man:9': 'gateKeeper' },
  });
  assert.equal(concealed.gold, 1);
  assert.deepEqual(concealed.sealsFired, [{ kind: 'man:9', sealId: 'gateKeeper' }]);

  const alreadyUsed = scoreHand({
    solution: solutionOf(PURE),
    emptySlots: 6,
    seals: { 'man:9': 'gateKeeper' },
    usedSealKinds: new Set(['man:9']),
  });
  assert.equal(alreadyUsed.gold, 0, '本副已经触发过就不再给');

  // 9 万只出现在已亮的将牌里，守门印就不该触发
  const revealedPair = scoreHand({
    solution: solutionOf('123m 456m 111m 555m', [group('pair', '99m')]),
    emptySlots: 5,
    revealCount: 1,
    seals: { 'man:9': 'gateKeeper' },
  });
  assert.equal(revealedPair.gold, 0, '亮出来的牌不算「未被亮出」');
});

test('灵签与福将分别按取得顺序和将位顺序结算', () => {
  const result = scoreHand({
    solution: solutionOf(PLAIN),
    emptySlots: 4,
    revealCount: 2,
    charmIds: ['tailwind', 'doubleBless'],
    generalIds: ['azureEnvoy', 'magistrate'],
  });
  const labels = result.steps.filter((step) => step.source === 'charm' || step.source === 'general')
    .map((step) => step.label);
  assert.deepEqual(labels, ['顺风签', '倍喜签', '青龙使', '判官']);
  assert.equal(
    result.mult,
    1 + CONFIG.patternMult['普通胡'] + 1 + 1,
    '普通胡 +1，倍喜签与判官再各 +1 番势',
  );
});

test('灵签的即时金币不会在成胡时重复计入', () => {
  const result = scoreHand({ solution: solutionOf(PLAIN), emptySlots: 5, revealCount: 1, charmIds: ['wealth'] });
  assert.equal(result.gold, 0);
});

test('聚宝童按空开运位给金币', () => {
  const result = scoreHand({ solution: solutionOf(PLAIN), emptySlots: 4, revealCount: 2, generalIds: ['coinBoy'] });
  assert.equal(result.gold, 4);
});
