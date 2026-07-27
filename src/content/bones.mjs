/**
 * 牌骨：回答「这张牌是什么材质、固有值多少」。
 * 购买时选一个牌种，本局后续出现的四张同名牌都带上它；只做静态牌值，不改花色点数与胡牌资格。
 * 结算时只看最终胡牌的唯一分解。
 */

import { listContentItems } from './library.mjs';

export const BONE_LIST = Object.freeze(listContentItems('bone', { pool: 'shop' }));
export const BONES = Object.freeze(Object.fromEntries(BONE_LIST.map((item) => [item.id, item])));
