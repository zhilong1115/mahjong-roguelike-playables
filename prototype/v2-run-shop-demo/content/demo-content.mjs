export const DEMO_CONFIG = Object.freeze({
  actionsPerHand: 5,
  maxRevealsPerHand: 2,
  startingGold: 2,
  goldByRevealCount: Object.freeze([3, 1, 0]),
});

export const SCORING_CONFIG = Object.freeze({
  huBase: 100,
  groupBase: Object.freeze({
    pair: 10,
    chow: 20,
    pung: 30,
    kong: 50,
  }),
  patternBonus: Object.freeze({
    '七对': 0.5,
    '碰碰胡': 0.5,
    '清一色': 1,
    '一条龙': 0.5,
    '大三元': 2,
    '大四喜': 3,
  }),
});

export const TEMPORARY_CHARMS = Object.freeze({
  tailwind: Object.freeze({
    id: 'tailwind',
    name: '顺风签',
    description: '本副结算时，每个顺子 +10 底分。',
    effect: Object.freeze({ kind: 'group', groupKind: 'chow', value: 10 }),
  }),
  carving: Object.freeze({
    id: 'carving',
    name: '刻福签',
    description: '本副结算时，每个刻子或杠 +15 底分。',
    effect: Object.freeze({ kind: 'meldKinds', groupKinds: Object.freeze(['pung', 'kong']), value: 15 }),
  }),
  doubleJoy: Object.freeze({
    id: 'doubleJoy',
    name: '双喜签',
    description: '本副结算时，每个对子 +5 底分。',
    effect: Object.freeze({ kind: 'group', groupKind: 'pair', value: 5 }),
  }),
  reserve: Object.freeze({
    id: 'reserve',
    name: '余裕签',
    description: '本副胡牌时，每个剩余行动 +8 底分。',
    effect: Object.freeze({ kind: 'remainingActions', value: 8 }),
  }),
});

export const FORTUNE_GENERALS = Object.freeze({
  azureEnvoy: Object.freeze({
    id: 'azureEnvoy',
    name: '青龙使',
    price: 2,
    description: '整局每个顺子 +10 底分。',
    effect: Object.freeze({ kind: 'group', groupKind: 'chow', value: 10 }),
  }),
  ladyConcord: Object.freeze({
    id: 'ladyConcord',
    name: '同心娘',
    price: 5,
    description: '整局每个对子 +8 底分。',
    effect: Object.freeze({ kind: 'group', groupKind: 'pair', value: 8 }),
  }),
  glyphWarden: Object.freeze({
    id: 'glyphWarden',
    name: '镇字将',
    price: 8,
    description: '整局每个字牌刻子或杠 +20 底分。',
    effect: Object.freeze({ kind: 'honorMeld', value: 20 }),
  }),
});

export const ROUND_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'round-1',
    name: '试手局',
    target: 1100,
    medals: Object.freeze({ clear: 1100, silver: 1300, gold: 1500 }),
    hands: Object.freeze([
      Object.freeze({
        id: 'r1-h1',
        name: '一条龙',
        seed: 21001,
        initial: '123m 456m 78m 111p EE 9s',
        draws: Object.freeze(['9m']),
        charmOrder: Object.freeze(['tailwind', 'carving']),
        suggestedDiscards: Object.freeze(['9s']),
        suggestedReveals: Object.freeze(['123m', '111p']),
      }),
      Object.freeze({
        id: 'r1-h2',
        name: '七对',
        seed: 21002,
        initial: '11m 22m 33p 44p 55s 66s E N',
        draws: Object.freeze(['E']),
        charmOrder: Object.freeze(['doubleJoy', 'reserve']),
        suggestedDiscards: Object.freeze(['N']),
        suggestedReveals: Object.freeze(['11m', '22m']),
      }),
      Object.freeze({
        id: 'r1-h3',
        name: '大三元',
        seed: 21003,
        initial: 'RRR GGG BBB 12m EE 9s',
        draws: Object.freeze(['3m']),
        charmOrder: Object.freeze(['carving', 'tailwind']),
        suggestedDiscards: Object.freeze(['9s']),
        suggestedReveals: Object.freeze(['RRR', 'GGG']),
      }),
    ]),
  }),
  Object.freeze({
    id: 'round-2',
    name: '福将局',
    target: 1900,
    medals: Object.freeze({ clear: 1900, silver: 2100, gold: 2300 }),
    hands: Object.freeze([
      Object.freeze({
        id: 'r2-h1',
        name: '清一色',
        seed: 22001,
        initial: '111m 234m 56m 99m 55m 8p 2s',
        draws: Object.freeze(['7m', '9m']),
        charmOrder: Object.freeze(['tailwind', 'carving']),
        suggestedDiscards: Object.freeze(['8p', '2s']),
        suggestedReveals: Object.freeze(['111m', '234m']),
      }),
      Object.freeze({
        id: 'r2-h2',
        name: '清一色七对',
        seed: 22002,
        initial: '11p 22p 33p 44p 55p 6p 7p 9m E',
        draws: Object.freeze(['6p', '7p']),
        charmOrder: Object.freeze(['doubleJoy', 'reserve']),
        suggestedDiscards: Object.freeze(['9m', 'E']),
        suggestedReveals: Object.freeze(['11p', '22p']),
      }),
      Object.freeze({
        id: 'r2-h3',
        name: '大四喜',
        seed: 22003,
        initial: 'EEE SSS WWW NN R 1m 9p',
        draws: Object.freeze(['N', 'R']),
        charmOrder: Object.freeze(['carving', 'doubleJoy']),
        suggestedDiscards: Object.freeze(['1m', '9p']),
        suggestedReveals: Object.freeze(['EEE', 'SSS']),
      }),
    ]),
  }),
]);

export const SHOP_ITEMS = Object.freeze(Object.values(FORTUNE_GENERALS));
