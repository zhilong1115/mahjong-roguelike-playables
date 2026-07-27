import { listContentItems, pickContentItem } from './library.mjs';

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

export const CHARM_LIST = Object.freeze(listContentItems('charm', { pool: 'charm-draft' }));
export const CHARMS = Object.freeze(Object.fromEntries(CHARM_LIST.map((item) => [item.id, item])));

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
  preferredArchetype = null,
} = {}) {
  const slotRoles = ['group', 'pattern', 'wild', 'extra'];
  const chosen = [];

  for (let index = 0; index < offerCount; index += 1) {
    const draftRole = slotRoles[index] ?? 'extra';
    const tier = tierSlots[index] ?? 'silver';
    let pool = rolePool(draftRole, revealedKind, {
      excludeDelayedOmens,
      excludeCharmIds,
    }).filter((item) => item.tier === tier && !chosen.some((picked) => picked.id === item.id));
    if (draftRole === 'pattern' && preferredArchetype) {
      const matching = pool.filter((item) => item.archetype === preferredArchetype);
      if (matching.length) pool = matching;
    }
    if (!pool.length) break;
    chosen.push(pickContentItem(rng, pool));
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
