/**
 * 番谱：百宝阁购买后立即使用，让一个番种等级 +1，本局有效。
 * 不进手牌、不占将位、不改变胡牌资格；首轮只加牌值，不加番势。
 */

import {
  CODEX_CHIPS_PER_LEVEL,
  CODEX_MAX_LEVEL,
  listContentItems,
} from './library.mjs';

export { CODEX_CHIPS_PER_LEVEL, CODEX_MAX_LEVEL };

export const CODEX_LIST = Object.freeze(listContentItems('codex', { pool: 'shop' }));
export const CODEX = Object.freeze(Object.fromEntries(CODEX_LIST.map((item) => [item.id, item])));

/** 番种名 → 番谱，用来给商店做「匹配下一轮目标」的定向保底。 */
export const CODEX_BY_PATTERN = Object.freeze(
  Object.fromEntries(CODEX_LIST.map((book) => [book.pattern, book])),
);
