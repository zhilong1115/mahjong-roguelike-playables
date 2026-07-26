/** 内容注册表：所有内容与关卡结构的统一入口。 */

import { ANTES, BLIND_KINDS, BLIND_ORDER, blindIndexOf } from './antes.mjs';
import { BONES, BONE_LIST } from './bones.mjs';
import { BOSSES, BOSS_LIST, pickBoss } from './bosses.mjs';
import { CHARMS, CHARM_LIST, draftCharms } from './charms.mjs';
import { CODEX, CODEX_BY_PATTERN, CODEX_CHIPS_PER_LEVEL, CODEX_LIST, CODEX_MAX_LEVEL } from './codex.mjs';
import { DECKS, DECK_LIST, TILE_BACKS } from './decks.mjs';
import { FAMILIES, FAMILY_ORDER } from './families.mjs';
import { GENERALS, GENERAL_LIST } from './generals.mjs';
import { PAPERS, PAPER_LIST } from './papers.mjs';
import { SEALS, SEALS_BY_TRIGGER, SEAL_LIST } from './seals.mjs';
import { TAGS, TAG_LIST, rollTag } from './tags.mjs';

export {
  ANTES, BLIND_KINDS, BLIND_ORDER, blindIndexOf,
  BONES, BONE_LIST,
  BOSSES, BOSS_LIST, pickBoss,
  CHARMS, CHARM_LIST, draftCharms,
  CODEX, CODEX_BY_PATTERN, CODEX_CHIPS_PER_LEVEL, CODEX_LIST, CODEX_MAX_LEVEL,
  DECKS, DECK_LIST, TILE_BACKS,
  FAMILIES, FAMILY_ORDER,
  GENERALS, GENERAL_LIST,
  PAPERS, PAPER_LIST,
  SEALS, SEALS_BY_TRIGGER, SEAL_LIST,
  TAGS, TAG_LIST, rollTag,
};

/** 玩法参数。全部是试玩实验值，改这里就能重新标定。 */
export const CONFIG = Object.freeze({
  fortuneSlots: 6,
  /** 每副的换牌**次数**；一次可以换多张 */
  swapsPerHand: 5,
  /** 一次换牌最多换几张，同时也是选牌上限 */
  maxSwapTiles: 4,
  goldPerEmptySlot: 2,
  /** 没用完的换牌次数，胡牌时每次换 2 金 */
  goldPerUnusedSwap: 2,
  emptySlotChips: 12,
  startingGold: 4,
  generalSlots: 4,
  rerollCost: 3,
  huBase: 50,
  groupChips: Object.freeze({ pair: 10, chow: 20, pung: 30, kong: 45 }),
  patternMult: Object.freeze({
    普通胡: 0,
    七对: 2,
    碰碰胡: 2,
    清一色: 3,
    一条龙: 2,
    大三元: 5,
    大四喜: 7,
    门清: 0, // 门清只是名牌标签，实际收益来自空开运位
  }),
});

const REGISTRY = Object.freeze({
  charm: CHARMS,
  codex: CODEX,
  general: GENERALS,
  bone: BONES,
  seal: SEALS,
  paper: PAPERS,
  deck: DECKS,
  boss: BOSSES,
  tag: TAGS,
});

/**
 * @param {string} family
 * @param {string} id
 */
export function getItem(family, id) {
  return REGISTRY[family]?.[id] ?? null;
}

export function listItems(family) {
  return Object.values(REGISTRY[family] ?? {});
}

/** 商店货位：福将固定 + 番谱/牌帖轮换 + 牌骨/牌印轮换。 */
export function shelfFor(shopIndex) {
  return [
    'general',
    shopIndex % 3 === 2 ? 'paper' : 'codex',
    shopIndex % 2 === 0 ? 'bone' : 'seal',
  ];
}
