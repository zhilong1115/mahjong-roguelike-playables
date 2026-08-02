/**
 * 牌印：回答「这张牌在什么事件发生时做什么」。
 * 购买时选一个牌种，本局后续四张同名牌都带上它；不改材质、花色和点数。
 * 每枚牌印必须写清触发时机和每副上限，首轮同一事件最多触发一次。
 *
 * 三个触发时机各做一枚，用来验证事件层确实存在：
 * - `swapOut` 换出这张牌时
 * - `reveal`  用这张牌亮组时
 * - `settle`  成胡结算时
 */

import { listContentItems } from './library.mjs';

export const SEAL_LIST = Object.freeze(listContentItems('seal', { pool: 'shop' }));
export const SEALS = Object.freeze(Object.fromEntries(SEAL_LIST.map((item) => [item.id, item])));

export const SEALS_BY_TRIGGER = Object.freeze({
  swapOut: SEAL_LIST.filter((item) => item.trigger === 'swapOut'),
  reveal: SEAL_LIST.filter((item) => item.trigger === 'reveal'),
  settle: SEAL_LIST.filter((item) => item.trigger === 'settle'),
});
