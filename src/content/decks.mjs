/**
 * 牌组：开始界面选择，决定这一局的牌背图案和开局修正。
 * 牌背只是外观，修正才是玩法；绑在一起是为了让玩家一眼认出自己在玩哪种起手。
 */

function deck(spec) {
  return Object.freeze({ family: 'deck', ...spec, modifier: Object.freeze(spec.modifier) });
}

export const DECKS = Object.freeze({
  plain: deck({
    id: 'plain',
    name: '素面',
    back: 'plain',
    text: '标准牌组，没有任何修正。',
    modifier: {},
  }),
  jade: deck({
    id: 'jade',
    name: '玉髓',
    back: 'jade',
    text: '开局 +8 金，开运位少 1 个。',
    modifier: { startingGold: 8, fortuneSlotsDelta: -1 },
  }),
  vermilion: deck({
    id: 'vermilion',
    name: '朱漆',
    back: 'vermilion',
    text: '每副多 1 次换牌，空位金币 -1。',
    modifier: { swapsDelta: 1, goldPerEmptySlotDelta: -1 },
  }),
  ink: deck({
    id: 'ink',
    name: '墨玉',
    back: 'ink',
    text: '开局送一位福将，起始金币 0。',
    modifier: { startingGold: 0, startingGeneral: 'azureEnvoy' },
  }),
});

export const DECK_LIST = Object.freeze(Object.values(DECKS));

/** 牌背图案 id，render/pixel.mjs 按它画。 */
export const TILE_BACKS = Object.freeze(['plain', 'jade', 'vermilion', 'ink']);
