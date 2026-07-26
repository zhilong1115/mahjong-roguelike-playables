import { createSeededRng, shuffleInPlace } from './rng.mjs';
import { buildStandardWall, sortTiles, tileKey } from './tiles.mjs';

export const SCENARIOS = Object.freeze({
  simple: {
    id: 'simple',
    name: '顺水局',
    subtitle: '先锁三组与将，再换出最后一张',
    seed: 14001,
  },
  kong: {
    id: 'kong',
    name: '杠上局',
    subtitle: '锁定东风杠，补牌完成最后顺子',
    seed: 14002,
  },
  ambiguous: {
    id: 'ambiguous',
    name: '迷局',
    subtitle: '这手已经能胡；错误锁组会改变答案',
    seed: 14003,
  },
  random: {
    id: 'random',
    name: '随机局',
    subtitle: '真正随机的十四张，仅用于压力测试',
    seed: 14004,
  },
});

function takeOne(wall, suit, rank) {
  const index = wall.findIndex((tile) => tile.suit === suit && tile.rank === rank);
  if (index < 0) throw new Error(`Tile unavailable: ${suit}:${rank}`);
  return wall.splice(index, 1)[0];
}

function takeSpecs(wall, specs) {
  return specs.map(([suit, rank]) => takeOne(wall, suit, rank));
}

function makeCuratedSetup(scenarioId, specs, riggedDraws) {
  const scenario = SCENARIOS[scenarioId];
  const rng = createSeededRng(scenario.seed);
  const remaining = buildStandardWall();
  const looseTiles = takeSpecs(remaining, specs);
  const top = takeSpecs(remaining, riggedDraws);
  shuffleInPlace(remaining, rng);

  return {
    scenario,
    seed: scenario.seed,
    looseTiles: sortTiles(looseTiles),
    wall: [...top, ...remaining],
    swaps: 12,
  };
}

function simpleSetup() {
  return makeCuratedSetup('simple', [
    ['man', 1], ['man', 2], ['man', 3],
    ['pin', 3], ['pin', 4], ['pin', 5],
    ['honor', 5], ['honor', 5], ['honor', 5],
    ['honor', 6], ['honor', 6],
    ['sou', 6], ['sou', 7], ['sou', 9],
  ], [
    ['sou', 8], ['man', 4], ['pin', 6], ['honor', 6],
  ]);
}

function kongSetup() {
  return makeCuratedSetup('kong', [
    ['man', 1], ['man', 2], ['man', 3],
    ['pin', 3], ['pin', 4], ['pin', 5],
    ['honor', 1], ['honor', 1], ['honor', 1], ['honor', 1],
    ['honor', 6], ['honor', 6],
    ['sou', 6], ['sou', 7],
  ], [
    ['sou', 8], ['honor', 6], ['man', 9],
  ]);
}

function ambiguousSetup() {
  return makeCuratedSetup('ambiguous', [
    ['man', 1], ['man', 1], ['man', 1],
    ['man', 2], ['man', 3], ['man', 4],
    ['man', 5], ['man', 5],
    ['man', 6], ['man', 7], ['man', 8],
    ['man', 9], ['man', 9], ['man', 9],
  ], [
    ['man', 5], ['man', 8], ['honor', 5],
  ]);
}

function randomSetup(seed) {
  const normalizedSeed = Number(seed) >>> 0 || SCENARIOS.random.seed;
  const rng = createSeededRng(normalizedSeed);
  const wall = buildStandardWall();
  shuffleInPlace(wall, rng);
  return {
    scenario: SCENARIOS.random,
    seed: normalizedSeed,
    looseTiles: sortTiles(wall.splice(0, 14)),
    wall,
    swaps: 12,
  };
}

export function createScenario(scenarioId = 'simple', seed) {
  if (scenarioId === 'kong') return kongSetup();
  if (scenarioId === 'ambiguous') return ambiguousSetup();
  if (scenarioId === 'random') return randomSetup(seed);
  return simpleSetup();
}

export function describeWallTop(setup, amount = 3) {
  return setup.wall.slice(0, amount).map(tileKey);
}
