/**
 * 福将：百宝阁购买，占将位，本局常驻。按将位从左到右结算。
 * 框架期只做 5 位，覆盖牌值型、番势型和经济型三种职责。
 * 线性的「某番种固定 +N 牌值」交给番谱，这里不再出。
 */

import { listContentItems } from './library.mjs';

export const GENERAL_LIST = Object.freeze(listContentItems('general', { pool: 'shop' }));
export const GENERALS = Object.freeze(Object.fromEntries(GENERAL_LIST.map((item) => [item.id, item])));
