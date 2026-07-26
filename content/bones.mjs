/**
 * 牌骨：回答「这张牌是什么材质、固有值多少」。
 * 购买时选一个牌种，本局后续出现的四张同名牌都带上它；只做静态牌值，不改花色点数与胡牌资格。
 * 结算时只看最终胡牌的唯一分解。
 */

function bone(spec) {
  return Object.freeze({
    family: 'bone',
    duration: '本局',
    glyph: '骨',
    ...spec,
    effects: Object.freeze(spec.effects),
  });
}

export const BONES = Object.freeze({
  warmJade: bone({
    id: 'warmJade',
    name: '温玉骨',
    price: 5,
    rarity: 'common',
    text: '此牌进入最终胡牌结构时，每张 +12 牌值。',
    effects: [{ kind: 'boneChipsPerTile', value: 12 }],
  }),
  greenBamboo: bone({
    id: 'greenBamboo',
    name: '青竹骨',
    price: 5,
    rarity: 'common',
    text: '此牌在最终胡牌结构中属于顺子时，每张 +18 牌值。',
    effects: [{ kind: 'boneChipsPerTile', groupKinds: ['chow'], value: 18 }],
  }),
});

export const BONE_LIST = Object.freeze(Object.values(BONES));
