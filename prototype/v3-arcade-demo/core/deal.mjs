import { tilesToChange } from './rules.mjs';
import {
  createSeededRng,
  indexToSpec,
  makeTile,
  shuffleInPlace,
  sortTiles,
  tileIndex,
} from './tiles.mjs';

/**
 * 发牌器：先造一副合法胡牌，再打碎 2–3 张，并把需要的牌放进牌墙前段。
 * 目的是让每副牌一定有解、有明确目标牌型，同时保留“换错就流局”的压力。
 */

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

export const ROUND_FLAVORS = Object.freeze([
  Object.freeze(['mixed', 'sevenPairs', 'allPung']),
  Object.freeze(['pureSuit', 'dragon', 'mixed']),
  Object.freeze(['bigThree', 'pureSuit', 'bigFour']),
]);

function createAvailability() {
  return new Array(34).fill(4);
}

function indexOf(suit, rank) {
  return tileIndex({ suit, rank });
}

function takeChow(avail, suit, start) {
  const indices = [0, 1, 2].map((offset) => indexOf(suit, start + offset));
  if (indices.some((index) => avail[index] < 1)) return null;
  for (const index of indices) avail[index] -= 1;
  return { kind: 'chow', specs: indices.map(indexToSpec) };
}

function takePung(avail, suit, rank) {
  const index = indexOf(suit, rank);
  if (avail[index] < 3) return null;
  avail[index] -= 3;
  return { kind: 'pung', specs: [0, 1, 2].map(() => indexToSpec(index)) };
}

function takePair(avail, suit, rank) {
  const index = indexOf(suit, rank);
  if (avail[index] < 2) return null;
  avail[index] -= 2;
  return { kind: 'pair', specs: [0, 1].map(() => indexToSpec(index)) };
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

function buildTargetGroups(flavorId, rng, avail) {
  const groups = [];
  const push = (group) => {
    if (!group) throw new Error(`无法生成牌型 ${flavorId}`);
    groups.push(group);
  };

  if (flavorId === 'sevenPairs') {
    const used = new Set();
    while (groups.length < 7) {
      const suit = rng.next() < 0.82 ? rng.pick(NUMBER_SUITS) : 'honor';
      const rank = suit === 'honor' ? 1 + rng.int(7) : 1 + rng.int(9);
      const index = indexOf(suit, rank);
      if (used.has(index)) continue;
      const group = takePair(avail, suit, rank);
      if (!group) continue;
      used.add(index);
      groups.push(group);
    }
    return groups;
  }

  if (flavorId === 'allPung') {
    while (groups.length < 4) {
      const suit = rng.next() < 0.75 ? rng.pick(NUMBER_SUITS) : 'honor';
      const rank = suit === 'honor' ? 1 + rng.int(7) : 1 + rng.int(9);
      const group = takePung(avail, suit, rank);
      if (group) groups.push(group);
    }
    push(randomPair(avail, rng));
    return groups;
  }

  if (flavorId === 'pureSuit') {
    const suit = rng.pick(NUMBER_SUITS);
    while (groups.length < 4) push(randomMeld(avail, rng, [suit], 0.7));
    push(randomPair(avail, rng, [suit]));
    return groups;
  }

  if (flavorId === 'dragon') {
    const suit = rng.pick(NUMBER_SUITS);
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

  while (groups.length < 4) push(randomMeld(avail, rng, NUMBER_SUITS, 0.6));
  push(randomPair(avail, rng));
  return groups;
}

function randomJunkSpec(avail, rng) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const index = rng.int(34);
    if (avail[index] > 0) {
      avail[index] -= 1;
      return indexToSpec(index);
    }
  }
  const index = avail.findIndex((count) => count > 0);
  avail[index] -= 1;
  return indexToSpec(index);
}

function specsToTiles(specs, idPrefix, serialRef) {
  return specs.map((spec) => makeTile(`${idPrefix}${serialRef.value++}`, spec.suit, spec.rank));
}

/**
 * @param {object} options
 * @param {string} options.handId  用于生成稳定的牌 id
 * @param {number} options.seed
 * @param {string} options.flavorId
 * @param {number} options.brokenTiles 打碎几张（决定至少需要几次换牌）
 */
export function createSolvableDeal({ handId = 'h', seed = 1, flavorId = 'mixed', brokenTiles = 2 } = {}) {
  const rng = createSeededRng(seed);
  const serialRef = { value: 1 };

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const avail = createAvailability();
    let groups;
    try {
      groups = buildTargetGroups(flavorId, rng, avail);
    } catch {
      continue;
    }

    const targetSpecs = groups.flatMap((group) => group.specs);
    if (targetSpecs.length !== 14) continue;

    const holeIndices = shuffleInPlace(targetSpecs.map((_, index) => index), rng)
      .slice(0, brokenTiles);
    const holeSet = new Set(holeIndices);
    const missingSpecs = holeIndices.map((index) => targetSpecs[index]);
    const keptSpecs = targetSpecs.filter((_, index) => !holeSet.has(index));

    // 把被打碎的牌还回可用池，它们要出现在牌墙里
    for (const spec of missingSpecs) avail[tileIndex(spec)] += 1;

    const junkSpecs = [];
    for (let count = 0; count < brokenTiles; count += 1) junkSpecs.push(randomJunkSpec(avail, rng));

    const startingSpecs = [...keptSpecs, ...junkSpecs];
    if (startingSpecs.length !== 14) continue;

    const looseTiles = sortTiles(specsToTiles(startingSpecs, `${handId}-`, serialRef));
    const distance = tilesToChange(looseTiles, []);
    if (distance === 0 || distance === Infinity) continue;

    // 牌墙前段固定放需要的牌（顺序随机），保证认真打就一定能成牌；
    // 换错牌、亮错组仍然会流局。
    for (const spec of missingSpecs) avail[tileIndex(spec)] -= 1;
    const frontSpecs = [...missingSpecs];
    shuffleInPlace(frontSpecs, rng);

    const restSpecs = [];
    for (let index = 0; index < 34; index += 1) {
      for (let copy = 0; copy < avail[index]; copy += 1) restSpecs.push(indexToSpec(index));
    }
    shuffleInPlace(restSpecs, rng);

    const wall = specsToTiles([...frontSpecs, ...restSpecs], `${handId}-w`, serialRef);
    return {
      looseTiles,
      wall,
      flavorId,
      flavor: HAND_FLAVORS[flavorId],
      distance,
      targetSpecs,
    };
  }

  throw new Error(`发牌失败：${flavorId}`);
}

export function flavorForHand(roundIndex, handIndex) {
  const list = ROUND_FLAVORS[Math.min(roundIndex, ROUND_FLAVORS.length - 1)];
  return list[handIndex % list.length];
}
