import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHARMS,
  DEMO_CONFIG,
  GENERALS,
  ROUNDS,
  SCORING,
} from '../prototype/v3-arcade-demo/content/content.mjs';
import { ArcadeGame } from '../prototype/v3-arcade-demo/core/game.mjs';
import { HAND_FLAVORS, ROUND_FLAVORS, createSolvableDeal, flavorForHand } from '../prototype/v3-arcade-demo/core/deal.mjs';
import {
  classifySelection,
  findBestHu,
  findHuSolutions,
  routeRemains,
  tilesToChange,
} from '../prototype/v3-arcade-demo/core/rules.mjs';
import { parseTileNotation, makeTile, sortTiles, tileKey } from '../prototype/v3-arcade-demo/core/tiles.mjs';

function hand(notation) {
  return sortTiles(parseTileNotation(notation).map((spec, index) => makeTile(`t${index}`, spec.suit, spec.rank)));
}

function group(kind, notation) {
  return { id: `g-${kind}-${notation}`, kind, tiles: hand(notation), revealed: true };
}

/* ---------- 选择判定 ---------- */

test('1–4 张选择映射到换牌、对子、顺子、刻子和杠', () => {
  assert.equal(classifySelection(hand('5m')).kind, 'swap');
  assert.equal(classifySelection(hand('55m')).kind, 'pair');
  assert.equal(classifySelection(hand('456p')).kind, 'chow');
  assert.equal(classifySelection(hand('777s')).kind, 'pung');
  assert.equal(classifySelection(hand('EEEE')).kind, 'kong');
  assert.equal(classifySelection(hand('EEE E')).kind, 'kong');
  assert.equal(classifySelection(hand('13m')).valid, false, '隔张不是对子也不是顺子');
  assert.equal(classifySelection(hand('RRR')).kind, 'pung');
  assert.equal(classifySelection(hand('RGB')).valid, false, '字牌不能组成顺子');
  assert.equal(classifySelection(hand('789m 1p')).valid, false, '跨花色四张不是杠');
});

/* ---------- 胡牌判定与计分 ---------- */

test('普通胡按牌值 × 番势结算，空开运位换成牌值', () => {
  const tiles = hand('123m 456m 456p 111s EE');
  const concealed = findBestHu(tiles, [], { revealCount: 0, emptySlots: 6 });
  assert.ok(concealed, '应当识别为普通胡');
  assert.deepEqual(concealed.patterns, ['普通胡', '门清']);
  const structureChips = SCORING.huBase
    + SCORING.groupChips.chow * 3 + SCORING.groupChips.pung + SCORING.groupChips.pair;
  assert.equal(concealed.calmChips, 6 * SCORING.emptySlotChips);
  assert.equal(concealed.chips, structureChips + concealed.calmChips);
  assert.equal(concealed.mult, 1, '普通胡没有番种加成');
  assert.equal(concealed.total, concealed.chips * concealed.mult);

  const revealed = findBestHu(hand('456m 456p 111s EE'), [group('chow', '123m')], {
    revealCount: 1,
    emptySlots: 5,
  });
  assert.ok(!revealed.patterns.includes('门清'), '亮过牌就不再是门清');
  assert.equal(
    revealed.chips,
    structureChips + 5 * SCORING.emptySlotChips,
    '结构牌值不变，只少了一个空位的静心牌值',
  );
  assert.equal(concealed.chips - revealed.chips, SCORING.emptySlotChips, '每花一个开运位的牌值代价固定');
});

test('七对、清一色、大三元、大四喜都能被识别', () => {
  const sevenPairs = findBestHu(hand('11m 22m 33m 44p 55p 66s 77s'), [], { revealCount: 1 });
  assert.deepEqual(sevenPairs.patterns, ['七对']);

  const pure = findBestHu(hand('123m 456m 789m 111m 99m'), [], { revealCount: 1 });
  assert.ok(pure.patterns.includes('清一色'));
  assert.ok(pure.patterns.includes('一条龙'));

  const bigThree = findBestHu(hand('RRR GGG BBB 123m EE'), [], { revealCount: 1 });
  assert.ok(bigThree.patterns.includes('大三元'));

  const bigFour = findBestHu(hand('EEE SSS WWW NNN 11m'), [], { revealCount: 1 });
  assert.ok(bigFour.patterns.includes('大四喜'));
  assert.ok(bigFour.patterns.includes('碰碰胡'));
});

test('已亮组约束最终分解，不能重复利用同一张牌', () => {
  const solutions = findHuSolutions(hand('456m 789m 111p EE'), [group('chow', '123m')]);
  assert.equal(solutions.length, 1);
  assert.ok(solutions[0].groups.some((item) => item.kind === 'chow'
    && item.tiles.map(tileKey).join(',') === 'man:1,man:2,man:3'));

  const blocked = findHuSolutions(hand('11m 22m 33m 44p 55p 66s'), [group('pung', '777s')]);
  assert.deepEqual(blocked, [], '亮了刻子就走不了七对');
});

test('灵签与福将效果进入牌值和番势', () => {
  const tiles = hand('123m 456m 456p 111s EE');
  const base = findBestHu(tiles, [], { revealCount: 1 });
  const withCharm = findBestHu(tiles, [], { revealCount: 1, charmIds: ['tailwind'] });
  assert.equal(withCharm.chips - base.chips, 20 * 3, '顺风签按顺子数量给牌值');

  const withGeneral = findBestHu(tiles, [], { revealCount: 1, generalIds: ['magistrate'] });
  assert.equal(withGeneral.mult - base.mult, 1, '判官给固定番势');

  const withGold = findBestHu(tiles, [], { revealCount: 2, emptySlots: 4, generalIds: ['coinBoy'] });
  assert.equal(withGold.bonusGold, 4, '聚宝童按空位给金币');
});

/* ---------- 距离 ---------- */

test('还差几张的判定覆盖普通胡与七对两条路线', () => {
  assert.equal(tilesToChange(hand('123m 456m 789m 111p EE'), []), 0);
  assert.equal(tilesToChange(hand('11m 22m 33m 44p 55p 66s 77s'), []), 0);
  assert.equal(tilesToChange(hand('123m 456m 789m 111p E S'), []), 1);
  assert.equal(tilesToChange(hand('123m 456m 789m 11p E'), [group('pair', '99s')]), 1);
  assert.equal(tilesToChange(hand('11m 22m 33m 44p 55p 66s 7s 9s'), []), 1);
  assert.ok(tilesToChange(hand('19m 19p 19s ESWN RGB'), []) >= 3, '幺九散牌离胡很远');
});

test('亮牌不能同时堵死普通胡和七对', () => {
  assert.equal(routeRemains([group('pair', '11m'), group('pair', '22m')]), true, '两个对子仍可走七对');
  assert.equal(routeRemains([group('pung', '111m'), group('pair', '22m'), group('pair', '33m')]), false);
});

/* ---------- 发牌器 ---------- */

test('发牌器给出 14 张、有解但还没胡的起手牌', () => {
  for (const flavorId of Object.keys(HAND_FLAVORS)) {
    for (let seed = 1; seed <= 25; seed += 1) {
      const deal = createSolvableDeal({ handId: `t-${flavorId}`, seed: seed * 613, flavorId, brokenTiles: 3 });
      assert.equal(deal.looseTiles.length, 14, `${flavorId} 起手必须是 14 张`);
      const distance = tilesToChange(deal.looseTiles, []);
      assert.ok(distance >= 1, `${flavorId} 起手不能直接胡`);
      assert.ok(distance <= DEMO_CONFIG.swapsPerHand, `${flavorId} 起手必须在换牌预算内可解`);
      assert.equal(new Set(deal.looseTiles.map((tile) => tile.id)).size, 14, '牌 id 必须唯一');
      assert.ok(deal.wall.length >= 60, '牌墙要留足后续摸牌');
    }
  }
});

test('同一 seed 的发牌完全可复现', () => {
  const first = createSolvableDeal({ handId: 'x', seed: 4242, flavorId: 'dragon', brokenTiles: 3 });
  const second = createSolvableDeal({ handId: 'x', seed: 4242, flavorId: 'dragon', brokenTiles: 3 });
  assert.deepEqual(
    first.looseTiles.map((tile) => tileKey(tile)),
    second.looseTiles.map((tile) => tileKey(tile)),
  );
  assert.deepEqual(
    first.wall.slice(0, 6).map((tile) => tileKey(tile)),
    second.wall.slice(0, 6).map((tile) => tileKey(tile)),
  );
});

test('每轮牌谱按设计顺序出现，第三轮包含大牌型', () => {
  assert.equal(flavorForHand(0, 0), ROUND_FLAVORS[0][0]);
  assert.ok(ROUND_FLAVORS[2].includes('bigFour'));
  assert.equal(ROUNDS.length, 3);
});

/* ---------- 开运位与经济 ---------- */

function greedySwap(game) {
  const next = game.wall[0];
  if (!next) return false;
  let bestTile = null;
  let bestDistance = Infinity;
  for (const tile of game.looseTiles) {
    const candidate = [...game.looseTiles.filter((item) => item.id !== tile.id), next];
    const distance = tilesToChange(candidate, game.revealedGroups);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestTile = tile;
    }
  }
  if (!bestTile) return false;
  game.toggleTile(bestTile.id);
  const result = game.performAction();
  return result.ok;
}

/** 已经能胡时，从获胜分解里挑一组来亮，模拟“再多赚一次三签选一”。 */
function revealFromWinningShape(game) {
  const best = game.bestHu();
  if (!best) return false;
  const looseIds = new Set(game.looseTiles.map((tile) => tile.id));
  for (const candidate of best.groups) {
    if (candidate.revealed) continue;
    if (!candidate.tiles.every((tile) => looseIds.has(tile.id))) continue;
    for (const tile of candidate.tiles) game.toggleTile(tile.id);
    if (game.selectionPreview().valid) {
      const result = game.performAction();
      if (result.ok) return true;
    }
    game.clearSelection();
  }
  return false;
}

function playHand(game, { revealTarget = 0 } = {}) {
  let guard = 0;
  while (guard++ < 40) {
    if (game.status === 'charm-draft') {
      game.chooseCharm(game.pendingDraft.charmIds[0]);
      continue;
    }
    if (game.status !== 'playing' && game.status !== 'hu-ready') break;
    if (game.status === 'hu-ready') {
      if (game.slotsUsed() < revealTarget && revealFromWinningShape(game)) continue;
      game.declareHu();
      break;
    }
    if (!greedySwap(game)) break;
  }
  return game.status;
}

function findLegalReveal(game) {
  const tiles = game.looseTiles;
  for (let i = 0; i < tiles.length; i += 1) {
    for (let j = i + 1; j < tiles.length; j += 1) {
      for (const candidate of [[tiles[i], tiles[j]], ...tiles.slice(j + 1).map((third) => [tiles[i], tiles[j], third])]) {
        if (!classifySelection(candidate).valid) continue;
        const ids = new Set(candidate.map((tile) => tile.id));
        candidate.forEach((tile) => game.selectedIds.add(tile.id));
        const ok = game.selectionPreview().valid;
        game.selectedIds.clear();
        if (ok) return candidate.filter((tile) => ids.has(tile.id));
      }
    }
  }
  return null;
}

test('完全不亮牌的胡牌拿到满额空位金币', () => {
  const game = new ArcadeGame({ seed: 20260725 });
  const status = playHand(game, { revealTarget: 0 });
  assert.equal(status, 'hand-won', '贪心换牌应当能胡第一副');
  const result = game.lastHandResult;
  assert.equal(result.slotsUsed, 0);
  assert.equal(result.emptySlots, DEMO_CONFIG.fortuneSlots);
  assert.equal(result.gold, DEMO_CONFIG.fortuneSlots * DEMO_CONFIG.goldPerEmptySlot);
  assert.ok(result.scoring.patterns.includes('门清'));
});

test('每亮一组少两金，并换来一次三签选一', () => {
  const game = new ArcadeGame({ seed: 20260725 });
  const status = playHand(game, { revealTarget: 2 });
  assert.equal(status, 'hand-won');
  const result = game.lastHandResult;
  assert.ok(result.slotsUsed >= 1, '应当至少亮出一组');
  assert.equal(result.emptySlots, DEMO_CONFIG.fortuneSlots - result.slotsUsed);
  assert.equal(
    result.gold - (result.scoring.bonusGold ?? 0) - game.charmGold,
    result.emptySlots * DEMO_CONFIG.goldPerEmptySlot,
  );
  assert.equal(result.charmIds.length, result.slotsUsed, '每个开运位对应一张灵签');
});

test('三签选一固定给出本组签 / 牌型签 / 奇签，且同一 seed 稳定', () => {
  const first = new ArcadeGame({ seed: 777 });
  const reveal = findLegalReveal(first);
  assert.ok(reveal, '起手应当有可亮的组合');
  for (const tile of reveal) first.toggleTile(tile.id);
  first.performAction();
  assert.equal(first.status, 'charm-draft');
  const options = first.pendingDraft.charmIds.map((id) => CHARMS[id]);
  assert.equal(options.length, 3);
  assert.deepEqual(new Set(options.map((charm) => charm.tag)).size, 3, '三张灵签角色不同');
  assert.equal(new Set(first.pendingDraft.charmIds).size, 3, '同一次不出现重复灵签');

  const second = new ArcadeGame({ seed: 777 });
  const sameReveal = findLegalReveal(second);
  for (const tile of sameReveal) second.toggleTile(tile.id);
  second.performAction();
  assert.deepEqual(second.pendingDraft.charmIds, first.pendingDraft.charmIds);

  assert.equal(first.chooseCharm('__missing__').ok, false, '不能选不在本次三签里的灵签');
  const chosen = first.pendingDraft.charmIds[1];
  assert.equal(first.chooseCharm(chosen).ok, true);
  assert.equal(first.status !== 'charm-draft', true);
  assert.equal(first.chooseCharm(chosen).ok, false, '选完不能再选');
  assert.deepEqual(first.charmIds, [chosen]);
});

test('灵签只在本副生效，下一副清空', () => {
  const game = new ArcadeGame({ seed: 909090 });
  playHand(game, { revealTarget: 1 });
  assert.ok(game.charmIds.length >= 1);
  game.advance();
  assert.deepEqual(game.charmIds, []);
  assert.equal(game.swapsRemaining, DEMO_CONFIG.swapsPerHand);
  assert.deepEqual(game.revealedGroups, []);
});

test('三副达标后金币入账，未达标清空待结算', () => {
  const game = new ArcadeGame({ seed: 31415 });
  for (let index = 0; index < ROUNDS[0].handCount; index += 1) {
    playHand(game, { revealTarget: 0 });
    game.advance();
  }
  assert.equal(game.status, 'shop');
  assert.equal(game.gold, DEMO_CONFIG.startingGold + game.completedRounds[0].banked);
  assert.equal(game.pendingGold, 0);

  const failing = new ArcadeGame({ seed: 31415 });
  failing.roundScore = 10;
  failing.pendingGold = 12;
  failing.handIndex = ROUNDS[0].handCount - 1;
  failing.status = 'hand-won';
  failing.advance();
  assert.equal(failing.status, 'round-failed');
  assert.equal(failing.pendingGold, 0);
  assert.equal(failing.gold, DEMO_CONFIG.startingGold, '失败不会把待结算金币变成真金币');
});

test('百宝阁购买与刷新按价格扣金币', () => {
  const game = new ArcadeGame({ seed: 5150 });
  for (let index = 0; index < ROUNDS[0].handCount; index += 1) {
    playHand(game, { revealTarget: 0 });
    game.advance();
  }
  assert.equal(game.status, 'shop');
  const goldBefore = game.gold;
  const offered = game.shopOffer.items;
  assert.equal(offered.length, DEMO_CONFIG.shopSize);
  assert.equal(new Set(offered).size, offered.length, '货架不重复');

  const affordable = offered.find((id) => GENERALS[id].price <= goldBefore);
  assert.ok(affordable, '门清三副的金币至少能买一位福将');
  const purchase = game.buyGeneral(affordable);
  assert.equal(purchase.ok, true);
  assert.equal(game.gold, goldBefore - GENERALS[affordable].price);
  assert.deepEqual(game.generalIds, [affordable]);
  assert.equal(game.shopOffer.items.includes(affordable), false);

  const goldAfterBuy = game.gold;
  const reroll = game.rerollShop();
  if (goldAfterBuy >= DEMO_CONFIG.rerollCost) {
    assert.equal(reroll.ok, true);
    assert.equal(game.gold, goldAfterBuy - DEMO_CONFIG.rerollCost);
  }
  game.leaveShop();
  assert.equal(game.roundIndex, 1);
  assert.equal(game.handIndex, 0);
  assert.equal(game.generalIds.length, 1, '福将跨轮保留');
});

test('买到的福将在下一轮真的改变结算', () => {
  const game = new ArcadeGame({ seed: 246810 });
  for (let index = 0; index < ROUNDS[0].handCount; index += 1) {
    playHand(game, { revealTarget: 0 });
    game.advance();
  }
  game.gold = 99;
  game.buyGeneral(game.shopOffer.items[0]);
  const boughtId = game.generalIds[0];
  game.leaveShop();

  const withGeneral = game.bestHu() ?? findBestHu(game.looseTiles, game.revealedGroups, game.scoringOptions());
  const without = findBestHu(game.looseTiles, game.revealedGroups, {
    ...game.scoringOptions(),
    generalIds: [],
  });
  if (withGeneral && without) {
    assert.ok(withGeneral.total >= without.total, `${GENERALS[boughtId].name} 不应降低得分`);
  }
});

test('换牌用完且不能胡就流局，本副 0 分但前面的分数保留', () => {
  const game = new ArcadeGame({ seed: 13571 });
  playHand(game, { revealTarget: 0 });
  const firstScore = game.roundScore;
  assert.ok(firstScore > 0);
  game.advance();
  game.swapsRemaining = 0;
  game.refreshStatus();
  if (game.status === 'hand-failed') {
    game.advance();
    assert.equal(game.roundScore, firstScore, '流局不会扣掉之前的分数');
  }
});

test('三轮都靠门清也能推进到通关判定', () => {
  const game = new ArcadeGame({ seed: 8642 });
  let guard = 0;
  while (game.status !== 'run-complete' && guard++ < 30) {
    if (game.status === 'shop') {
      game.leaveShop();
      continue;
    }
    if (game.status === 'round-failed') break;
    playHand(game, { revealTarget: 0 });
    game.advance();
  }
  assert.ok(['run-complete', 'round-failed'].includes(game.status), `意外状态 ${game.status}`);
});

test('重开会通知界面并换一副新牌', () => {
  const game = new ArcadeGame({ seed: 4321 });
  const seen = [];
  game.subscribe((state) => seen.push(state.seed));
  const before = game.looseTiles.map((tile) => tileKey(tile)).join(' ');
  game.reset(999111);
  assert.deepEqual(seen, [999111], 'reset 必须 emit 一次，否则界面会停在上一局');
  assert.notEqual(game.looseTiles.map((tile) => tileKey(tile)).join(' '), before);
  assert.equal(game.swapsRemaining, DEMO_CONFIG.swapsPerHand);
  assert.equal(game.gold, DEMO_CONFIG.startingGold);
});
