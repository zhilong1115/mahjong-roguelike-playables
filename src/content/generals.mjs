/**
 * 福将：百宝阁购买，占将位，本局常驻。按将位从左到右结算。
 * 当前 11 位：三条流派各有起势 / 成势 / 终局，另保留经济与通用位。
 * 线性的「某番种固定 +N 牌值」交给番谱，福将强调组合引擎与规则乘算。
 */

import { listContentItems } from './library.mjs';

export const GENERAL_LIST = Object.freeze(listContentItems('general', { pool: 'shop' }));
export const GENERALS = Object.freeze(Object.fromEntries(GENERAL_LIST.map((item) => [item.id, item])));
export const GENERAL_ARCHETYPES = Object.freeze(['dragon', 'thunder', 'pairs']);
