/**
 * 手气：跳过闲局或庄局换来的一次性强化。
 * 立刻生效或在下一关开局生效，用掉即消失，不占任何槽位。
 */

function tag(spec) {
  return Object.freeze({ family: 'tag', duration: '一次性', glyph: '气', ...spec });
}

export const TAGS = Object.freeze({
  coin: tag({
    id: 'coin',
    name: '财气',
    text: '立刻 +6 金。',
    timing: 'instant',
    effect: { kind: 'gold', value: 6 },
  }),
  charm: tag({
    id: 'charm',
    name: '签气',
    text: '下一关第一副开局先得一张灵签。',
    timing: 'nextBlind',
    effect: { kind: 'freeCharm', value: 1 },
  }),
  freeBuy: tag({
    id: 'freeBuy',
    name: '免单气',
    text: '下一次百宝阁第一件商品免费。',
    timing: 'nextShop',
    effect: { kind: 'freePurchase', value: 1 },
  }),
  swap: tag({
    id: 'swap',
    name: '顺气',
    text: '下一关每副多 1 次换牌。',
    timing: 'nextBlind',
    effect: { kind: 'extraSwaps', value: 1 },
  }),
});

export const TAG_LIST = Object.freeze(Object.values(TAGS));

/** 跳局给哪一张手气，由 seed 决定，重载不能刷。 */
export function rollTag(rng) {
  return rng.pick(TAG_LIST).id;
}
