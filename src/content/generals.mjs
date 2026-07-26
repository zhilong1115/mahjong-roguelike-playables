/**
 * 福将：百宝阁购买，占将位，本局常驻。按将位从左到右结算。
 * 框架期只做 5 位，覆盖牌值型、番势型和经济型三种职责。
 * 线性的「某番种固定 +N 牌值」交给番谱，这里不再出。
 */

function general(spec) {
  return Object.freeze({
    family: 'general',
    duration: '本局',
    ...spec,
    effects: Object.freeze(spec.effects),
  });
}

export const GENERALS = Object.freeze({
  azureEnvoy: general({
    id: 'azureEnvoy',
    name: '青龙使',
    glyph: '龙',
    price: 8,
    rarity: 'common',
    text: '本局每个顺子 +32 牌值。',
    effects: [{ kind: 'chipsPerGroup', groupKinds: ['chow'], value: 32 }],
  }),
  stoneWarden: general({
    id: 'stoneWarden',
    name: '玄武将',
    glyph: '武',
    price: 8,
    rarity: 'common',
    text: '本局每个刻子或杠 +42 牌值。',
    effects: [{ kind: 'chipsPerGroup', groupKinds: ['pung', 'kong'], value: 42 }],
  }),
  ladyConcord: general({
    id: 'ladyConcord',
    name: '同心娘',
    glyph: '心',
    price: 8,
    rarity: 'common',
    text: '本局每个对子 +25 牌值。',
    effects: [{ kind: 'chipsPerGroup', groupKinds: ['pair'], value: 25 }],
  }),
  coinBoy: general({
    id: 'coinBoy',
    name: '聚宝童',
    glyph: '宝',
    price: 12,
    rarity: 'uncommon',
    text: '本局每个未使用的开运位额外 +1 金币。',
    effects: [{ kind: 'goldPerEmptySlot', value: 1 }],
  }),
  magistrate: general({
    id: 'magistrate',
    name: '判官',
    glyph: '判',
    price: 14,
    rarity: 'uncommon',
    text: '本局番势 +1。',
    effects: [{ kind: 'multFlat', value: 1 }],
  }),
});

export const GENERAL_LIST = Object.freeze(Object.values(GENERALS));
