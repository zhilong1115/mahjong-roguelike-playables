/**
 * 圈与关：一局 = 三圈，一圈 = 闲局 / 庄局 / 圈主，一关 = 2 副牌打累计目标。
 * 命名与结构见 docs/decisions/0013-ante-structure-and-meta-shell.md。
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

/** 每关 2 副；起手打碎张数随圈递增。 */
export const ANTES = Object.freeze([
  Object.freeze({
    id: 'east',
    name: '东圈',
    label: '东',
    handsPerBlind: 2,
    brokenTiles: 2,
    targets: Object.freeze({ small: 750, big: 1100, boss: 1300 }),
    // 牌谱按「闲局教基础、庄局给中番、圈主给大番」排，两副合计要和目标线对得上
    flavors: Object.freeze(['mixed', 'mixed', 'sevenPairs', 'allPung', 'pureSuit', 'dragon']),
    announced: Object.freeze(['七对', '碰碰胡']),
  }),
  Object.freeze({
    id: 'south',
    name: '南圈',
    label: '南',
    handsPerBlind: 2,
    brokenTiles: 3,
    targets: Object.freeze({ small: 1500, big: 1900, boss: 2400 }),
    flavors: Object.freeze(['pureSuit', 'mixed', 'dragon', 'allPung', 'pureSuit', 'sevenPairs']),
    announced: Object.freeze(['清一色', '一条龙']),
  }),
  Object.freeze({
    id: 'west',
    name: '西圈',
    label: '西',
    handsPerBlind: 2,
    brokenTiles: 3,
    targets: Object.freeze({ small: 2600, big: 3300, boss: 4600 }),
    flavors: Object.freeze(['pureSuit', 'allPung', 'dragon', 'bigThree', 'bigFour', 'pureSuit']),
    announced: Object.freeze(['大三元', '清一色', '大四喜']),
  }),
]);

/** 一关在整局里的序号，用来给发牌 seed 和商店定位。 */
export function blindIndexOf(anteIndex, blindKind) {
  return anteIndex * BLIND_ORDER.length + BLIND_ORDER.indexOf(blindKind);
}
