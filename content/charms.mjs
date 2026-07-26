/**
 * 灵签内容与求签选池。
 *
 * `draftRole` 保留 V3 的本组 / 牌型 / 奇签三个固定货位；
 * `functionRole` 是新卡面使用的助势 / 改命 / 奇缘职责；
 * `tier` 是每个签名固定的银 / 金 / 彩签阶。
 */

export const CHARM_TIERS = Object.freeze({
  silver: Object.freeze({ id: 'silver', name: '银签', rank: 1 }),
  gold: Object.freeze({ id: 'gold', name: '金签', rank: 2 }),
  rainbow: Object.freeze({ id: 'rainbow', name: '彩签', rank: 3 }),
});

export const CHARM_FUNCTION_ROLES = Object.freeze({
  momentum: Object.freeze({ id: 'momentum', name: '助势' }),
  fate: Object.freeze({ id: 'fate', name: '改命' }),
  omen: Object.freeze({ id: 'omen', name: '奇缘' }),
});

export const OMEN_IDS = Object.freeze({
  luckyTier: 'luckyTier',
  extraChoice: 'extraChoice',
});

/** @param {object} spec */
function charm(spec) {
  const draftRole = spec.draftRole ?? spec.role;
  return Object.freeze({
    family: 'charm',
    duration: '本副',
    match: null,
    tier: 'silver',
    functionRole: spec.omen ? 'omen' : 'momentum',
    ...spec,
    // `role` 暂时保留，旧 UI / 测试仍把它当作 draftRole 使用。
    role: draftRole,
    draftRole,
    effects: Object.freeze(spec.effects ?? []),
    omen: spec.omen ? Object.freeze({ ...spec.omen }) : null,
  });
}

export const CHARMS = Object.freeze({
  tailwind: charm({
    id: 'tailwind',
    name: '顺风签',
    glyph: '顺',
    role: 'group',
    match: ['chow'],
    tier: 'silver',
    text: '本副每个顺子 +20 牌值。',
    effects: [{ kind: 'chipsPerGroup', groupKinds: ['chow'], value: 20 }],
  }),
  carving: charm({
    id: 'carving',
    name: '刻福签',
    glyph: '刻',
    role: 'group',
    match: ['pung', 'kong'],
    tier: 'silver',
    text: '本副每个刻子或杠 +28 牌值。',
    effects: [{ kind: 'chipsPerGroup', groupKinds: ['pung', 'kong'], value: 28 }],
  }),
  doubleJoy: charm({
    id: 'doubleJoy',
    name: '双喜签',
    glyph: '喜',
    role: 'group',
    match: ['pair'],
    tier: 'silver',
    text: '本副每个对子 +20 牌值。',
    effects: [{ kind: 'chipsPerGroup', groupKinds: ['pair'], value: 20 }],
  }),
  dragonVein: charm({
    id: 'dragonVein',
    name: '龙脉签',
    glyph: '龙',
    role: 'pattern',
    match: ['chow'],
    tier: 'gold',
    text: '本副顺子达到 3 组时，番势 +1。',
    effects: [{ kind: 'multIfGroupCount', groupKinds: ['chow'], min: 3, value: 1 }],
  }),
  honorSeal: charm({
    id: 'honorSeal',
    name: '镇字签',
    glyph: '字',
    role: 'pattern',
    tier: 'silver',
    text: '本副每张字牌 +9 牌值。',
    effects: [{ kind: 'chipsPerTile', suit: 'honor', value: 9 }],
  }),
  doubleBless: charm({
    id: 'doubleBless',
    name: '倍喜签',
    glyph: '倍',
    role: 'wild',
    tier: 'gold',
    text: '本副番势 +1。',
    effects: [{ kind: 'multFlat', value: 1 }],
  }),
  wealth: charm({
    id: 'wealth',
    name: '财神签',
    glyph: '财',
    role: 'wild',
    functionRole: 'omen',
    tier: 'silver',
    text: '立刻 +1 待结算金币。',
    effects: [{ kind: 'goldNow', value: 1 }],
  }),
  reserve: charm({
    id: 'reserve',
    name: '余裕签',
    glyph: '余',
    role: 'wild',
    tier: 'silver',
    text: '胡牌时每个剩余换牌 +20 牌值。',
    effects: [{ kind: 'chipsPerRemainingSwap', value: 20 }],
  }),
  luckyOmen: charm({
    id: 'luckyOmen',
    name: '鸿运签',
    glyph: '鸿',
    role: 'wild',
    functionRole: 'omen',
    tier: 'gold',
    duration: '本局',
    text: '留下鸿运兆：本局下一次求签至少出现 1 张金签，该位有 15% 升为彩签；应验后消耗。',
    omen: { omenId: OMEN_IDS.luckyTier, consumeOn: 'nextCharmDraft' },
    effects: [],
  }),
  wideOmen: charm({
    id: 'wideOmen',
    name: '广缘签',
    glyph: '广',
    role: 'wild',
    functionRole: 'omen',
    tier: 'gold',
    duration: '本局',
    text: '留下广缘兆：本局下一次求签改为四选一，仍然只能选 1 张；应验后消耗。',
    omen: { omenId: OMEN_IDS.extraChoice, consumeOn: 'nextCharmDraft' },
    effects: [],
  }),
  rainbowBless: charm({
    id: 'rainbowBless',
    name: '虹福签',
    glyph: '虹',
    role: 'wild',
    functionRole: 'omen',
    functionRole: 'omen',
    tier: 'rainbow',
    text: '本副番势 +1，立刻 +1 待结算金币。',
    effects: [{ kind: 'multFlat', value: 1 }, { kind: 'goldNow', value: 1 }],
  }),
});

export const CHARM_LIST = Object.freeze(Object.values(CHARMS));

const TIER_FALLBACKS = Object.freeze({
  silver: Object.freeze(['silver']),
  gold: Object.freeze(['gold', 'silver']),
  rainbow: Object.freeze(['rainbow', 'gold', 'silver']),
});

function isDelayedOmen(item) {
  return Boolean(item.omen?.consumeOn === 'nextCharmDraft');
}

function rolePool(draftRole, revealedKind, { excludeDelayedOmens = false, excludeCharmIds = [] } = {}) {
  const excluded = new Set(excludeCharmIds);
  let pool = CHARM_LIST.filter((item) => !excluded.has(item.id));
  if (excludeDelayedOmens) pool = pool.filter((item) => !isDelayedOmen(item));
  if (draftRole === 'extra') return pool;
  pool = pool.filter((item) => item.draftRole === draftRole);
  if (draftRole !== 'group') return pool;
  const matching = pool.filter((item) => item.match?.includes(revealedKind));
  return matching.length ? matching : pool;
}

/**
 * 先抽整局签阶版式，再把唯一高阶位放进确实有对应内容的前三个职责位。
 * 普通局概率固定为银 72% / 金 25% / 彩 3%；第四个加签位始终为银。
 */
export function rollCharmTierSlots(rng, revealedKind, {
  offerCount = 3,
  minimumTier = null,
  rainbowChance = 0,
  excludeDelayedOmens = false,
  excludeCharmIds = [],
} = {}) {
  let highTier = null;
  if (minimumTier === 'gold') {
    highTier = rng.next() < rainbowChance ? 'rainbow' : 'gold';
  } else {
    const roll = rng.next();
    if (roll >= 0.97) highTier = 'rainbow';
    else if (roll >= 0.72) highTier = 'gold';
  }

  const tierSlots = new Array(offerCount).fill('silver');
  if (!highTier) return tierSlots;

  const slotRoles = ['group', 'pattern', 'wild'];
  for (const candidateTier of TIER_FALLBACKS[highTier]) {
    if (candidateTier === 'silver') return tierSlots;
    const eligible = slotRoles
      .map((draftRole, index) => ({ draftRole, index }))
      .filter(({ draftRole }) => rolePool(draftRole, revealedKind, {
        excludeDelayedOmens,
        excludeCharmIds,
      }).some((item) => item.tier === candidateTier));
    if (!eligible.length) continue;
    tierSlots[rng.pick(eligible).index] = candidateTier;
    return tierSlots;
  }
  return tierSlots;
}

/**
 * 按已经锁定的签阶位置抽取内容。返回的卡牌 tier 永远等于对应 tierSlot；
 * 若内容池不足则返回不足数量，让调用方决定保留签兆并回退普通签局。
 */
export function draftCharmOffers(rng, revealedKind, {
  offerCount = 3,
  tierSlots = new Array(offerCount).fill('silver'),
  excludeDelayedOmens = false,
  excludeCharmIds = [],
} = {}) {
  const slotRoles = ['group', 'pattern', 'wild', 'extra'];
  const chosen = [];

  for (let index = 0; index < offerCount; index += 1) {
    const draftRole = slotRoles[index] ?? 'extra';
    const tier = tierSlots[index] ?? 'silver';
    const pool = rolePool(draftRole, revealedKind, {
      excludeDelayedOmens,
      excludeCharmIds,
    }).filter((item) => item.tier === tier && !chosen.some((picked) => picked.id === item.id));
    if (!pool.length) break;
    chosen.push(rng.pick(pool));
  }

  return chosen.map((item, index) => Object.freeze({
    charmId: item.id,
    tier: item.tier,
    role: item.functionRole,
    draftRole: item.draftRole,
    slotRole: slotRoles[index] ?? 'extra',
  }));
}

/**
 * 兼容旧调用点的简化接口。新 Run 使用 `rollCharmTierSlots + draftCharmOffers`。
 * @returns {string[]}
 */
export function draftCharms(rng, revealedKind, options = {}) {
  const offerCount = options.offerCount ?? 3;
  const tierSlots = options.tierSlots ?? rollCharmTierSlots(rng, revealedKind, {
    ...options,
    offerCount,
  });
  return draftCharmOffers(rng, revealedKind, { ...options, offerCount, tierSlots })
    .map((offer) => offer.charmId);
}
