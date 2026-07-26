/**
 * 发牌器：先造一副完整胡牌，再打碎几张换成干扰牌，并把被打碎的牌放进牌墙最前面。
 * 保证「认真打一定能成牌」，流局来自换错牌或亮错组，不是运气。
 *
 * 同时支持 `guaranteedKinds`：让指定牌种在本副里至少出现若干张，
 * 用来验证刚买的牌骨 / 牌印确实看得见效果。
 */

import { tilesToChange } from './shanten.mjs';
import {
  createSeededRng,
  indexToSpec,
  kindKey,
  makeTile,
  parseKind,
  shuffleInPlace,
  sortTiles,
  tileIndex,
} from './tiles.mjs';

const NUMBER_SUITS = Object.freeze(['man', 'pin', 'sou']);

export const HAND_FLAVORS = Object.freeze({
  mixed: { id: 'mixed', name: '散手', hint: '四组面子 + 一对将' },
  sevenPairs: { id: 'sevenPairs', name: '七对', hint: '七个不同的对子' },
  allPung: { id: 'allPung', name: '碰碰胡', hint: '四个刻子 + 一对将' },
  pureSuit: { id: 'pureSuit', name: '清一色', hint: '整副只用一个花色' },
  dragon: { id: 'dragon', name: '一条龙', hint: '同花色 123 · 456 · 789' },
  bigThree: { id: 'bigThree', name: '大三元', hint: '中 · 发 · 白 三个刻子' },
  bigFour: { id: 'bigFour', name: '大四喜', hint: '东 · 南 · 西 · 北 四个刻子' },
});

function createAvailability() {
  return new Array(34).fill(4);
}

function indexOfKind(suit, rank) {
  return tileIndex({ suit, rank });
}

function takeChow(avail, suit, start) {
  const indices = [0, 1, 2].map((offset) => indexOfKind(suit, start + offset));
  if (indices.some((index) => avail[index] < 1)) return null;
  for (const index of indices) avail[index] -= 1;
  return { kind: 'chow', specs: indices.map(indexToSpec) };
}

function takePung(avail, suit, rank) {
  const index = indexOfKind(suit, rank);
  if (avail[index] < 3) return null;
  avail[index] -= 3;
  return { kind: 'pung', specs: [0, 1, 2].map(() => indexToSpec(index)) };
}

function takePair(avail, suit, rank) {
  const index = indexOfKind(suit, rank);
  if (avail[index] < 2) return null;
  avail[index] -= 2;
  return { kind: 'pair', specs: [0, 1].map(() => indexToSpec(index)) };
}

/** 牌帖的发牌倾向：让某个花色更容易被选中。 */
function biasedSuits(suits, suitBias) {
  if (!suitBias || !suits.includes(suitBias)) return suits;
  return [...suits, suitBias, suitBias];
}

function randomMeld(avail, rng, suits = NUMBER_SUITS, chowBias = 0.6) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const suit = rng.pick(suits);
    if (suit !== 'honor' && rng.next() < chowBias) {
      const group = takeChow(avail, suit, 1 + rng.int(7));
      if (group) return group;
    } else {
      const rank = suit === 'honor' ? 1 + rng.int(7) : 1 + rng.int(9);
      const group = takePung(avail, suit, rank);
      if (group) return group;
    }
  }
  return null;
}

function randomPair(avail, rng, suits = [...NUMBER_SUITS, 'honor']) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const suit = rng.pick(suits);
    const rank = suit === 'honor' ? 1 + rng.int(7) : 1 + rng.int(9);
    const group = takePair(avail, suit, rank);
    if (group) return group;
  }
  return null;
}

/**
 * 造一副「四个面子 + 一对将」，先把被改造过的牌种塞进去，
 * 保证玩家能看见刚买的牌骨 / 牌印。返回的组数固定是 5，合计 14 张。
 */
function buildStandardHand(avail, rng, {
  suits, chowBias, guaranteedKinds = [], pungOnly = false, suitBias = null,
}) {
  const pool = biasedSuits(suits ?? NUMBER_SUITS, suitBias);
  const melds = [];
  let pair = null;

  for (const key of guaranteedKinds) {
    const { suit, rank } = parseKind(key);
    if (suits && !suits.includes(suit)) continue;
    if (melds.length < 4) {
      const asChow = !pungOnly && suit !== 'honor' && rng.next() < 0.55
        ? takeChow(avail, suit, Math.min(Math.max(rank - 1, 1), 7))
        : null;
      const meld = asChow ?? takePung(avail, suit, rank);
      if (meld) {
        melds.push(meld);
        continue;
      }
    }
    if (!pair) pair = takePair(avail, suit, rank);
  }

  while (melds.length < 4) {
    const meld = pungOnly
      ? takePung(
        avail,
        rng.next() < 0.75 ? rng.pick(pool) : 'honor',
        1 + rng.int(9),
      )
      : randomMeld(avail, rng, pool, chowBias ?? 0.6);
    if (meld) melds.push(meld);
  }

  pair = pair ?? randomPair(avail, rng, suits ? pool : [...pool, 'honor']);
  if (!pair) return null;
  return [...melds, pair];
}

function buildTargetGroups(flavorId, rng, avail, guaranteedKinds, suitBias) {
  /** @type {{kind:string, specs:{suit:string,rank:number}[]}[]} */
  const groups = [];
  const push = (group) => {
    if (!group) throw new Error(`无法生成牌型 ${flavorId}`);
    groups.push(group);
  };

  if (flavorId === 'sevenPairs') {
    const used = new Set();
    for (const key of guaranteedKinds) {
      const { suit, rank } = parseKind(key);
      const group = takePair(avail, suit, rank);
      if (group) {
        used.add(indexOfKind(suit, rank));
        groups.push(group);
      }
    }
    while (groups.length < 7) {
      const suit = rng.next() < 0.82 ? rng.pick(NUMBER_SUITS) : 'honor';
      const rank = suit === 'honor' ? 1 + rng.int(7) : 1 + rng.int(9);
      const index = indexOfKind(suit, rank);
      if (used.has(index)) continue;
      const group = takePair(avail, suit, rank);
      if (!group) continue;
      used.add(index);
      groups.push(group);
    }
    return groups.slice(0, 7);
  }

  if (flavorId === 'allPung') {
    const hand = buildStandardHand(avail, rng, { guaranteedKinds, pungOnly: true, suitBias });
    if (!hand) throw new Error('无法生成牌型 allPung');
    return hand;
  }

  if (flavorId === 'pureSuit') {
    const preferred = guaranteedKinds.map(parseKind).find((spec) => spec.suit !== 'honor');
    const suit = preferred ? preferred.suit : (suitBias ?? rng.pick(NUMBER_SUITS));
    const hand = buildStandardHand(avail, rng, {
      suits: [suit],
      chowBias: 0.7,
      guaranteedKinds: preferred ? [kindKey(preferred.suit, preferred.rank)] : [],
    });
    if (!hand) throw new Error('无法生成牌型 pureSuit');
    return hand;
  }

  if (flavorId === 'dragon') {
    const suit = suitBias ?? rng.pick(NUMBER_SUITS);
    for (const start of [1, 4, 7]) push(takeChow(avail, suit, start));
    push(randomMeld(avail, rng, NUMBER_SUITS, 0.6));
    push(randomPair(avail, rng));
    return groups;
  }

  if (flavorId === 'bigThree') {
    for (const rank of [5, 6, 7]) push(takePung(avail, 'honor', rank));
    push(randomMeld(avail, rng, NUMBER_SUITS, 0.7));
    push(randomPair(avail, rng));
    return groups;
  }

  if (flavorId === 'bigFour') {
    for (const rank of [1, 2, 3, 4]) push(takePung(avail, 'honor', rank));
    push(randomPair(avail, rng));
    return groups;
  }

  const hand = buildStandardHand(avail, rng, { guaranteedKinds, chowBias: 0.6, suitBias });
  if (!hand) throw new Error(`无法生成牌型 ${flavorId}`);
  return hand;
}

function randomJunkSpec(avail, rng, avoidKinds = new Set()) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const index = rng.int(34);
    if (avail[index] > 0 && !avoidKinds.has(index)) {
      avail[index] -= 1;
      return indexToSpec(index);
    }
  }
  const index = avail.findIndex((count) => count > 0);
  avail[index] -= 1;
  return indexToSpec(index);
}

/**
 * @param {object} options
 * @param {string} options.handId 生成稳定牌 id 的前缀
 * @param {number} options.seed
 * @param {string} options.flavorId 目标牌型
 * @param {number} options.brokenTiles 打碎几张，决定至少要换几次
 * @param {string[]} [options.guaranteedKinds] 必须出现在本副的牌种
 * @param {string|null} [options.suitBias] 牌帖带来的发牌倾向
 */
export function createSolvableDeal({
  handId = 'h',
  seed = 1,
  flavorId = 'mixed',
  brokenTiles = 2,
  guaranteedKinds = [],
  suitBias = null,
} = {}) {
  const rng = createSeededRng(seed);
  const serialRef = { value: 1 };
  // 七对的七个槽位全是对子，打碎三张会留下三个极脆的单张，因此单独封顶
  const broken = flavorId === 'sevenPairs' ? Math.min(2, brokenTiles) : brokenTiles;
  const specsToTiles = (specs, prefix) => specs.map(
    (spec) => makeTile(`${prefix}${serialRef.value++}`, spec.suit, spec.rank),
  );

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const avail = createAvailability();
    let groups;
    try {
      groups = buildTargetGroups(flavorId, rng, avail, guaranteedKinds, suitBias);
    } catch {
      continue;
    }

    const targetSpecs = groups.flatMap((group) => group.specs);
    if (targetSpecs.length !== 14) continue;

    // 被改造的牌种不参与打碎，避免玩家看不到刚买的效果
    const protectedIndices = new Set(guaranteedKinds.map((key) => {
      const { suit, rank } = parseKind(key);
      return indexOfKind(suit, rank);
    }));
    const breakable = targetSpecs
      .map((spec, index) => ({ spec, index }))
      .filter(({ spec }) => !protectedIndices.has(indexOfKind(spec.suit, spec.rank)))
      .map(({ index }) => index);
    if (breakable.length < broken) continue;

    const holeIndices = shuffleInPlace(breakable, rng).slice(0, broken);
    const holeSet = new Set(holeIndices);
    const missingSpecs = holeIndices.map((index) => targetSpecs[index]);
    const keptSpecs = targetSpecs.filter((_, index) => !holeSet.has(index));

    for (const spec of missingSpecs) avail[tileIndex(spec)] += 1;
    const junkSpecs = [];
    for (let count = 0; count < broken; count += 1) {
      junkSpecs.push(randomJunkSpec(avail, rng, protectedIndices));
    }

    const startingSpecs = [...keptSpecs, ...junkSpecs];
    if (startingSpecs.length !== 14) continue;

    const looseTiles = sortTiles(specsToTiles(startingSpecs, `${handId}-`));
    const distance = tilesToChange(looseTiles, []);
    // 起手必须还没胡，且一定能在打碎张数之内补回来
    if (distance === 0 || distance > broken) continue;

    // 牌墙前段固定放需要的牌：认真打一定能成牌，流局只来自换错牌或亮错组。
    // 一次换多张的价值在于省下换牌次数（每次没用掉换金币），而不是赌运气。
    for (const spec of missingSpecs) avail[tileIndex(spec)] -= 1;
    const frontSpecs = shuffleInPlace([...missingSpecs], rng);

    const restSpecs = [];
    for (let index = 0; index < 34; index += 1) {
      for (let copy = 0; copy < avail[index]; copy += 1) restSpecs.push(indexToSpec(index));
    }
    shuffleInPlace(restSpecs, rng);

    return {
      looseTiles,
      wall: specsToTiles([...frontSpecs, ...restSpecs], `${handId}-w`),
      flavorId,
      flavor: HAND_FLAVORS[flavorId],
      distance,
      brokenTiles: broken,
      /** 预览张数跟着打碎张数走：需要几张就让玩家看得见几张。 */
      previewCount: Math.max(2, broken),
    };
  }

  throw new Error(`发牌失败：${flavorId}`);
}
