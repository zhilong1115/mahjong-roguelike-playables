import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG } from '../src/content/index.mjs';
import { HAND_FLAVORS, createSolvableDeal } from '../src/core/deal.mjs';
import {
  classifySelection,
  detectPatterns,
  findHuSolutions,
  routeRemains,
  structuralCount,
} from '../src/core/patterns.mjs';
import { tilesToChange } from '../src/core/shanten.mjs';
import { TILE_KINDS, kindName, tileKey } from '../src/core/tiles.mjs';
import { group, hand } from './helpers/auto-play.mjs';

test('1–4 张选择映射到换牌、对子、顺子、刻子和杠', () => {
  assert.equal(classifySelection(hand('5m')).kind, 'swap');
  assert.equal(classifySelection(hand('55m')).kind, 'pair');
  assert.equal(classifySelection(hand('456p')).kind, 'chow');
  assert.equal(classifySelection(hand('777s')).kind, 'pung');
  assert.equal(classifySelection(hand('EEEE')).kind, 'kong');
  assert.equal(classifySelection(hand('13m')).valid, false);
  assert.equal(classifySelection(hand('RGB')).valid, false, '字牌不能组成顺子');
  assert.equal(classifySelection(hand('789m 1p')).valid, false);
});

test('杠占 3 个结构位，第四张只是附加实体牌', () => {
  assert.equal(structuralCount(hand('123m 456m 789m EE'), [group('kong', '1111p')]), 14);
});

test('番种识别覆盖首批七种，门清只在没亮牌时出现', () => {
  const plain = findHuSolutions(hand('123m 456m 456p 111s EE'))[0];
  assert.deepEqual(detectPatterns(plain, { concealed: true }), ['普通胡', '门清']);
  assert.deepEqual(detectPatterns(plain, { concealed: false }), ['普通胡']);

  const seven = findHuSolutions(hand('11m 22m 33m 44p 55p 66s 77s'))[0];
  assert.ok(detectPatterns(seven).includes('七对'));

  const pure = findHuSolutions(hand('123m 456m 789m 111m 99m'))
    .map((solution) => detectPatterns(solution))
    .flat();
  assert.ok(pure.includes('清一色'));
  assert.ok(pure.includes('一条龙'));

  const bigThree = findHuSolutions(hand('RRR GGG BBB 123m EE'))[0];
  assert.ok(detectPatterns(bigThree).includes('大三元'));

  const bigFour = findHuSolutions(hand('EEE SSS WWW NNN 11m'))[0];
  assert.ok(detectPatterns(bigFour).includes('大四喜'));
  assert.ok(detectPatterns(bigFour).includes('碰碰胡'));
});

test('已亮组是硬约束，不能重复利用同一张牌', () => {
  const solutions = findHuSolutions(hand('456m 789m 111p EE'), [group('chow', '123m')]);
  assert.equal(solutions.length, 1);
  assert.deepEqual(findHuSolutions(hand('11m 22m 33m 44p 55p 66s'), [group('pung', '777s')]), []);
});

test('还差几张同时考虑普通胡与七对', () => {
  assert.equal(tilesToChange(hand('123m 456m 456p 111s EE')), 0);
  assert.equal(tilesToChange(hand('11m 22m 33m 44p 55p 66s 77s')), 0);
  assert.equal(tilesToChange(hand('123m 456m 789m 111p E S')), 1);
  assert.equal(tilesToChange(hand('123m 456m 789m 11p E'), [group('pair', '99s')]), 1);
  assert.ok(tilesToChange(hand('19m 19p 19s ESWN RGB')) >= 3);
});

test('亮牌不能同时堵死普通胡和七对', () => {
  assert.equal(routeRemains([group('pair', '11m'), group('pair', '22m')]), true);
  assert.equal(routeRemains([group('pung', '111m'), group('pair', '22m'), group('pair', '33m')]), false);
});

test('发牌器：14 张、还没胡、且一定能在打碎张数内补回来', () => {
  for (const flavorId of Object.keys(HAND_FLAVORS)) {
    for (let seed = 1; seed <= 20; seed += 1) {
      for (const brokenTiles of [2, 3]) {
        const deal = createSolvableDeal({ handId: `t-${flavorId}`, seed: seed * 613, flavorId, brokenTiles });
        assert.equal(deal.looseTiles.length, 14, `${flavorId} 起手必须 14 张`);
        const distance = tilesToChange(deal.looseTiles, []);
        assert.ok(distance >= 1, `${flavorId} 起手不能直接胡`);
        assert.ok(distance <= brokenTiles, `${flavorId} 起手必须在 ${brokenTiles} 次换牌内可解`);
        assert.ok(distance <= CONFIG.swapsPerHand, '必须在换牌预算内');
        assert.equal(new Set(deal.looseTiles.map((tile) => tile.id)).size, 14);
      }
    }
  }
});

test('发牌器保证被改造的牌种一定出现在本副', () => {
  for (const kind of ['man:5', 'pin:1', 'sou:9', 'honor:5']) {
    for (const flavorId of ['mixed', 'sevenPairs', 'allPung']) {
      const deal = createSolvableDeal({
        handId: 'g', seed: 4242, flavorId, brokenTiles: 3, guaranteedKinds: [kind],
      });
      const seen = deal.looseTiles.filter((tile) => tileKey(tile) === kind).length;
      assert.ok(seen >= 1, `${flavorId} 应当至少发到一张 ${kindName(kind)}`);
    }
  }
});

test('同一 seed 的发牌完全可复现', () => {
  const first = createSolvableDeal({ handId: 'x', seed: 4242, flavorId: 'dragon', brokenTiles: 3 });
  const second = createSolvableDeal({ handId: 'x', seed: 4242, flavorId: 'dragon', brokenTiles: 3 });
  assert.deepEqual(first.looseTiles.map(tileKey), second.looseTiles.map(tileKey));
  assert.deepEqual(first.wall.slice(0, 6).map(tileKey), second.wall.slice(0, 6).map(tileKey));
});

test('34 个牌种都能用于牌骨牌印选择', () => {
  assert.equal(TILE_KINDS.length, 34);
  assert.equal(new Set(TILE_KINDS).size, 34);
  assert.equal(kindName('honor:5'), '红中');
});
