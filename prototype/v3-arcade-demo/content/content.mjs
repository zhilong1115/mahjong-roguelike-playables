/* =========================================================
   V3 街机切片 · 内容表
   数值全部是试玩实验值，未提升为 Accepted 规则。
   ========================================================= */

export const DEMO_CONFIG = Object.freeze({
  fortuneSlots: 6,          // 每副 6 个开运位
  swapsPerHand: 5,          // 换牌预算，与开运位分开记账
  goldPerEmptySlot: 2,      // 胡牌时每个未使用开运位兑换金币
  startingGold: 4,
  generalSlots: 4,
  rerollCost: 3,
  shopSize: 3,
});

export const SCORING = Object.freeze({
  huBase: 50,
  // 每个没花掉的开运位除了给金币，还给一点牌值，
  // 让“留空”和“亮牌”变成一条平滑曲线，而不是门清全有全无。
  emptySlotChips: 12,
  groupChips: Object.freeze({ pair: 10, chow: 20, pung: 30, kong: 45 }),
  // 番种给的是倍率加值，最终 mult = 1 + Σ 加值 + 灵签/福将 mult
  patternMult: Object.freeze({
    普通胡: 0,
    七对: 2,
    碰碰胡: 2,
    清一色: 3,
    一条龙: 2,
    大三元: 5,
    大四喜: 7,
    门清: 0,   // 门清只是名牌标签，实际收益来自空开运位的牌值与金币
  }),
});

/* ---------- 灵签 CHARMS（只在本副生效） ---------- */

function charm(id, name, glyph, tag, description, effects, match = null) {
  return Object.freeze({ id, name, glyph, tag, description, effects: Object.freeze(effects), match });
}

export const CHARMS = Object.freeze({
  tailwind: charm('tailwind', '顺风签', '顺', 'group', '本副每个顺子 +20 牌值。',
    [{ kind: 'chipsPerGroup', groupKinds: ['chow'], value: 20 }], ['chow']),
  carving: charm('carving', '刻福签', '刻', 'group', '本副每个刻子或杠 +28 牌值。',
    [{ kind: 'chipsPerGroup', groupKinds: ['pung', 'kong'], value: 28 }], ['pung', 'kong']),
  doubleJoy: charm('doubleJoy', '双喜签', '喜', 'group', '本副每个对子 +20 牌值。',
    [{ kind: 'chipsPerGroup', groupKinds: ['pair'], value: 20 }], ['pair']),
  ironKong: charm('ironKong', '铁杠签', '杠', 'group', '本副每个杠 +70 牌值。',
    [{ kind: 'chipsPerGroup', groupKinds: ['kong'], value: 70 }], ['kong']),
  dragonVein: charm('dragonVein', '龙脉签', '龙', 'pattern', '本副顺子达到 3 组时，番势 +1。',
    [{ kind: 'multIfGroupCount', groupKinds: ['chow'], min: 3, value: 1 }], ['chow']),
  twinShadow: charm('twinShadow', '对影签', '对', 'pattern', '本副对子达到 3 组时，番势 +1。',
    [{ kind: 'multIfGroupCount', groupKinds: ['pair'], min: 3, value: 1 }], ['pair']),
  pureColor: charm('pureColor', '一色签', '色', 'pattern', '成清一色时，番势 +2。',
    [{ kind: 'multIfPattern', pattern: '清一色', value: 2 }]),
  honorSeal: charm('honorSeal', '镇字签', '字', 'pattern', '本副每张字牌 +9 牌值。',
    [{ kind: 'chipsPerTile', suit: 'honor', value: 9 }]),
  terminal: charm('terminal', '幺九签', '幺', 'pattern', '本副每张幺九牌 +8 牌值。',
    [{ kind: 'chipsPerTerminal', value: 8 }]),
  doubleBless: charm('doubleBless', '倍喜签', '倍', 'wild', '本副番势 +1。',
    [{ kind: 'multFlat', value: 1 }]),
  grandBless: charm('grandBless', '大倍签', '天', 'wild', '本副番势 +2。',
    [{ kind: 'multFlat', value: 2 }]),
  wealth: charm('wealth', '财神签', '财', 'wild', '立刻 +2 待结算金币。',
    [{ kind: 'goldNow', value: 2 }]),
  bigWealth: charm('bigWealth', '聚财签', '宝', 'wild', '立刻 +3 待结算金币。',
    [{ kind: 'goldNow', value: 3 }]),
  reserve: charm('reserve', '余裕签', '余', 'wild', '胡牌时每个剩余换牌 +20 牌值。',
    [{ kind: 'chipsPerRemainingSwap', value: 20 }]),
  omen: charm('omen', '孤张签', '孤', 'wild', '本副 +70 牌值。',
    [{ kind: 'chipsFlat', value: 70 }]),
});

export const CHARM_LIST = Object.freeze(Object.values(CHARMS));

/* ---------- 福将 GENERALS（整局生效，商店购买） ---------- */

function general(id, name, glyph, price, description, effects) {
  return Object.freeze({ id, name, glyph, price, description, effects: Object.freeze(effects) });
}

export const GENERALS = Object.freeze({
  azureEnvoy: general('azureEnvoy', '青龙使', '龙', 8, '整局每个顺子 +32 牌值。',
    [{ kind: 'chipsPerGroup', groupKinds: ['chow'], value: 32 }]),
  stoneWarden: general('stoneWarden', '玄武将', '武', 8, '整局每个刻子或杠 +42 牌值。',
    [{ kind: 'chipsPerGroup', groupKinds: ['pung', 'kong'], value: 42 }]),
  ladyConcord: general('ladyConcord', '同心娘', '心', 8, '整局每个对子 +25 牌值。',
    [{ kind: 'chipsPerGroup', groupKinds: ['pair'], value: 25 }]),
  coinBoy: general('coinBoy', '聚宝童', '宝', 12, '每个未使用开运位额外 +1 金币。',
    [{ kind: 'goldPerEmptySlot', value: 1 }]),
  magistrate: general('magistrate', '判官', '判', 14, '整局番势 +1。',
    [{ kind: 'multFlat', value: 1 }]),
  glyphWarden: general('glyphWarden', '镇字将', '镇', 14, '整局每张字牌 +18 牌值。',
    [{ kind: 'chipsPerTile', suit: 'honor', value: 18 }]),
  colorSage: general('colorSage', '一色仙', '仙', 20, '成清一色时番势 +4。',
    [{ kind: 'multIfPattern', pattern: '清一色', value: 4 }]),
  sevenStar: general('sevenStar', '七星使', '星', 20, '成七对时 +260 牌值。',
    [{ kind: 'chipsIfPattern', pattern: '七对', value: 260 }]),
  drumMaster: general('drumMaster', '鼓王', '鼓', 16, '每次亮组后本副额外 +45 牌值。',
    [{ kind: 'chipsPerReveal', value: 45 }]),
});

export const GENERAL_LIST = Object.freeze(Object.values(GENERALS));

/* ---------- 关卡 ROUNDS ---------- */

export const ROUNDS = Object.freeze([
  Object.freeze({ id: 'r1', name: '试手局', label: '壹', target: 900, handCount: 3, difficulty: 0 }),
  Object.freeze({ id: 'r2', name: '福将局', label: '贰', target: 1700, handCount: 3, difficulty: 1 }),
  Object.freeze({ id: 'r3', name: '牌馆局', label: '叁', target: 4500, handCount: 3, difficulty: 2 }),
]);
