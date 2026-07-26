/**
 * 牌帖：百宝阁里「改牌组」的商品。
 * 当前牌库模型每副重新生成，所以牌帖改的是**发牌倾向**和**牌背**，
 * 而不是增删实体牌；真正的增删要等持久牌库模型（`0011` 遗留问题）。
 */

function paper(spec) {
  return Object.freeze({ family: 'paper', duration: '本局', glyph: '帖', ...spec });
}

export const PAPERS = Object.freeze({
  manPaper: paper({
    id: 'manPaper',
    name: '万字帖',
    price: 7,
    rarity: 'common',
    text: '本局发牌更偏向万字，牌背换成朱漆。',
    modifier: { suitBias: 'man', back: 'vermilion' },
  }),
  pinPaper: paper({
    id: 'pinPaper',
    name: '筒子帖',
    price: 7,
    rarity: 'common',
    text: '本局发牌更偏向筒子，牌背换成玉髓。',
    modifier: { suitBias: 'pin', back: 'jade' },
  }),
  souPaper: paper({
    id: 'souPaper',
    name: '条子帖',
    price: 7,
    rarity: 'common',
    text: '本局发牌更偏向条子，牌背换成墨玉。',
    modifier: { suitBias: 'sou', back: 'ink' },
  }),
});

export const PAPER_LIST = Object.freeze(Object.values(PAPERS));
