/**
 * 圈与关：标准短局 = 东 / 南两圈，一圈 = 闲局 / 庄局 / 圈主，一关 = 1 副。
 * 西圈保留为通关后的可选加赛。见 docs/decisions/0017-short-run-shop-cadence.md。
 */

export const BLIND_KINDS = Object.freeze({
  small: Object.freeze({
    id: 'small', name: '闲局', label: '闲', skippable: true, reward: 3, chip: '#3f6f8e',
  }),
  big: Object.freeze({
    id: 'big', name: '庄局', label: '庄', skippable: true, reward: 5, chip: '#c99527',
  }),
  boss: Object.freeze({
    id: 'boss', name: '圈主', label: '主', skippable: false, reward: 8, chip: '#b5423a',
  }),
});

export const BLIND_ORDER = Object.freeze(['small', 'big', 'boss']);
export const STANDARD_ANTE_COUNT = 2;

/** 每关 1 副；起手打碎张数随圈递增。 */
export const ANTES = Object.freeze([
  Object.freeze({
    id: 'east',
    name: '东圈',
    label: '东',
    handsPerBlind: 1,
    brokenTiles: 2,
    targets: Object.freeze({ small: 400, big: 550, boss: 700 }),
    flavors: Object.freeze(['mixed', 'sevenPairs', 'allPung']),
    announced: Object.freeze(['七对', '碰碰胡']),
  }),
  Object.freeze({
    id: 'south',
    name: '南圈',
    label: '南',
    handsPerBlind: 1,
    brokenTiles: 3,
    targets: Object.freeze({ small: 800, big: 1350, boss: 2200 }),
    flavors: Object.freeze(['pureSuit', 'bigThree', 'bigFour']),
    announced: Object.freeze(['清一色', '一条龙']),
  }),
  Object.freeze({
    id: 'west',
    name: '西圈',
    label: '西',
    handsPerBlind: 1,
    brokenTiles: 3,
    targets: Object.freeze({ small: 1000, big: 1450, boss: 2400 }),
    flavors: Object.freeze(['dragon', 'bigThree', 'bigFour']),
    announced: Object.freeze(['大三元', '清一色', '大四喜']),
  }),
]);

/** 一关在整局里的序号，用来给发牌 seed 和商店定位。 */
export function blindIndexOf(anteIndex, blindKind) {
  return anteIndex * BLIND_ORDER.length + BLIND_ORDER.indexOf(blindKind);
}
