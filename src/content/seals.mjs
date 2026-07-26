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

function seal(spec) {
  return Object.freeze({
    family: 'seal',
    duration: '本局',
    glyph: '印',
    perHandLimit: 1,
    ...spec,
  });
}

export const SEALS = Object.freeze({
  returnWind: seal({
    id: 'returnWind',
    name: '回风印',
    trigger: 'swapOut',
    price: 9,
    rarity: 'common',
    text: '本副第一次换出此牌时，返还 1 次换牌；每副最多一次。',
    effect: { kind: 'refundSwap', value: 1 },
  }),
  askOracle: seal({
    id: 'askOracle',
    name: '问签印',
    trigger: 'reveal',
    price: 11,
    rarity: 'uncommon',
    text: '本副第一次用此牌亮组时，本次三签免费重抽一次；每副最多一次。',
    effect: { kind: 'rerollDraft', value: 1 },
  }),
  gateKeeper: seal({
    id: 'gateKeeper',
    name: '守门印',
    trigger: 'settle',
    price: 9,
    rarity: 'common',
    text: '此牌未被亮出而参与胡牌时，+1 待结算金币；每副最多一次。',
    effect: { kind: 'goldIfConcealedTile', value: 1 },
  }),
});

export const SEAL_LIST = Object.freeze(Object.values(SEALS));

export const SEALS_BY_TRIGGER = Object.freeze({
  swapOut: SEAL_LIST.filter((item) => item.trigger === 'swapOut'),
  reveal: SEAL_LIST.filter((item) => item.trigger === 'reveal'),
  settle: SEAL_LIST.filter((item) => item.trigger === 'settle'),
});
