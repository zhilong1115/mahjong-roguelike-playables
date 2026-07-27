/**
 * 五系功能卡的唯一内容库。
 *
 * 新增、下架、调价和改文案都从 `CONTENT_LIBRARY` 开始。
 * 旧存档可能保留已下架卡的 id，所以下架用 `enabled: false`，
 * 不在没有存档迁移时直接删除记录。
 */

import { FAMILIES, FAMILY_ORDER } from './families.mjs';

export const CONTENT_STATUSES = Object.freeze(['test', 'accepted', 'deprecated']);
export const CONTENT_POOLS = Object.freeze(['charm-draft', 'shop']);
export const CODEX_MAX_LEVEL = 3;
export const CODEX_CHIPS_PER_LEVEL = 24;

const EFFECT_KINDS = new Set([
  'chipsFlat',
  'chipsPerGroup',
  'chipsPerTile',
  'chipsPerRemainingSwap',
  'chipsPerReveal',
  'chipsIfPattern',
  'multFlat',
  'multIfPattern',
  'multIfGroupCount',
  'goldPerEmptySlot',
  'goldNow',
  'boneChipsPerTile',
  'refundSwap',
  'rerollDraft',
  'goldIfConcealedTile',
]);

function freezeObject(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => freezeObject(entry)));
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, freezeObject(entry)]),
  ));
}

/** @param {object} spec */
function content(spec) {
  const normalized = {
    enabled: true,
    status: 'test',
    weight: 100,
    pools: spec.family === 'charm' ? ['charm-draft'] : ['shop'],
    duration: FAMILIES[spec.family]?.duration,
    ...(spec.family === 'charm' ? { match: null, omen: null, effects: [] } : {}),
    ...spec,
  };
  return freezeObject(normalized);
}

/**
 * 这个数组是五系功能卡的唯一数据源。
 * 关卡、手气、牌组和牌帖不是功能卡，仍保持独立内容表。
 */
export const CONTENT_LIBRARY = Object.freeze([
  // ---------- 灵签 ----------
  content({
    family: 'charm', id: 'tailwind', name: '顺风签', glyph: '顺',
    role: 'group', draftRole: 'group', functionRole: 'momentum', match: ['chow'], tier: 'silver',
    text: '本副每个顺子 +20 牌值。',
    effects: [{ kind: 'chipsPerGroup', groupKinds: ['chow'], value: 20 }],
  }),
  content({
    family: 'charm', id: 'carving', name: '刻福签', glyph: '刻',
    role: 'group', draftRole: 'group', functionRole: 'momentum', match: ['pung', 'kong'], tier: 'silver',
    text: '本副每个刻子或杠 +28 牌值。',
    effects: [{ kind: 'chipsPerGroup', groupKinds: ['pung', 'kong'], value: 28 }],
  }),
  content({
    family: 'charm', id: 'doubleJoy', name: '双喜签', glyph: '喜',
    role: 'group', draftRole: 'group', functionRole: 'momentum', match: ['pair'], tier: 'silver',
    text: '本副每个对子 +20 牌值。',
    effects: [{ kind: 'chipsPerGroup', groupKinds: ['pair'], value: 20 }],
  }),
  content({
    family: 'charm', id: 'dragonVein', name: '龙脉签', glyph: '龙',
    role: 'pattern', draftRole: 'pattern', functionRole: 'momentum', match: ['chow'], tier: 'gold',
    text: '本副顺子达到 3 组时，番势 +1。',
    effects: [{ kind: 'multIfGroupCount', groupKinds: ['chow'], min: 3, value: 1 }],
  }),
  content({
    family: 'charm', id: 'honorSeal', name: '镇字签', glyph: '字',
    role: 'pattern', draftRole: 'pattern', functionRole: 'momentum', match: null, tier: 'silver',
    text: '本副每张字牌 +9 牌值。',
    effects: [{ kind: 'chipsPerTile', suit: 'honor', value: 9 }],
  }),
  content({
    family: 'charm', id: 'doubleBless', name: '倍喜签', glyph: '倍',
    role: 'wild', draftRole: 'wild', functionRole: 'momentum', match: null, tier: 'gold',
    text: '本副番势 +1。', effects: [{ kind: 'multFlat', value: 1 }],
  }),
  content({
    family: 'charm', id: 'wealth', name: '财神签', glyph: '财',
    role: 'wild', draftRole: 'wild', functionRole: 'omen', match: null, tier: 'silver',
    text: '立刻 +1 待结算金币。', effects: [{ kind: 'goldNow', value: 1 }],
  }),
  content({
    family: 'charm', id: 'reserve', name: '余裕签', glyph: '余',
    role: 'wild', draftRole: 'wild', functionRole: 'momentum', match: null, tier: 'silver',
    text: '胡牌时每个剩余换牌 +20 牌值。',
    effects: [{ kind: 'chipsPerRemainingSwap', value: 20 }],
  }),
  content({
    family: 'charm', id: 'luckyOmen', name: '鸿运签', glyph: '鸿', duration: '本局',
    role: 'wild', draftRole: 'wild', functionRole: 'omen', match: null, tier: 'gold',
    text: '留下鸿运兆：本局下一次求签至少出现 1 张金签，该位有 15% 升为彩签；应验后消耗。',
    omen: { omenId: 'luckyTier', consumeOn: 'nextCharmDraft' }, effects: [],
  }),
  content({
    family: 'charm', id: 'wideOmen', name: '广缘签', glyph: '广', duration: '本局',
    role: 'wild', draftRole: 'wild', functionRole: 'omen', match: null, tier: 'gold',
    text: '留下广缘兆：本局下一次求签改为四选一，仍然只能选 1 张；应验后消耗。',
    omen: { omenId: 'extraChoice', consumeOn: 'nextCharmDraft' }, effects: [],
  }),
  content({
    family: 'charm', id: 'rainbowBless', name: '虹福签', glyph: '虹',
    role: 'wild', draftRole: 'wild', functionRole: 'omen', match: null, tier: 'rainbow',
    text: '本副番势 +1，立刻 +1 待结算金币。',
    effects: [{ kind: 'multFlat', value: 1 }, { kind: 'goldNow', value: 1 }],
  }),

  // ---------- 番谱 ----------
  content({
    family: 'codex', id: 'sevenPairs', name: '七巧谱', glyph: '谱', pattern: '七对',
    price: 9, maxLevel: CODEX_MAX_LEVEL,
    text: `七对 Lv.+1；成七对时每级 +${CODEX_CHIPS_PER_LEVEL} 牌值。`,
  }),
  content({
    family: 'codex', id: 'dragon', name: '游龙谱', glyph: '谱', pattern: '一条龙',
    price: 9, maxLevel: CODEX_MAX_LEVEL,
    text: `一条龙 Lv.+1；成一条龙时每级 +${CODEX_CHIPS_PER_LEVEL} 牌值。`,
  }),
  content({
    family: 'codex', id: 'pureSuit', name: '清一谱', glyph: '谱', pattern: '清一色',
    price: 9, maxLevel: CODEX_MAX_LEVEL,
    text: `清一色 Lv.+1；成清一色时每级 +${CODEX_CHIPS_PER_LEVEL} 牌值。`,
  }),

  // ---------- 福将 ----------
  content({
    family: 'general', id: 'azureEnvoy', name: '青龙使', glyph: '龙', price: 12, rarity: 'common',
    text: '本局每个顺子 +32 牌值。',
    effects: [{ kind: 'chipsPerGroup', groupKinds: ['chow'], value: 32 }],
  }),
  content({
    family: 'general', id: 'stoneWarden', name: '玄武将', glyph: '武', price: 12, rarity: 'common',
    text: '本局每个刻子或杠 +42 牌值。',
    effects: [{ kind: 'chipsPerGroup', groupKinds: ['pung', 'kong'], value: 42 }],
  }),
  content({
    family: 'general', id: 'ladyConcord', name: '同心娘', glyph: '心', price: 12, rarity: 'common',
    text: '本局每个对子 +25 牌值。',
    effects: [{ kind: 'chipsPerGroup', groupKinds: ['pair'], value: 25 }],
  }),
  content({
    family: 'general', id: 'coinBoy', name: '聚宝童', glyph: '宝', price: 18, rarity: 'uncommon',
    text: '本局每个未使用的开运位额外 +1 金币。',
    effects: [{ kind: 'goldPerEmptySlot', value: 1 }],
  }),
  content({
    family: 'general', id: 'magistrate', name: '判官', glyph: '判', price: 22, rarity: 'uncommon',
    text: '本局番势 +1。', effects: [{ kind: 'multFlat', value: 1 }],
  }),

  // ---------- 牌骨 ----------
  content({
    family: 'bone', id: 'warmJade', name: '温玉骨', glyph: '骨', price: 8, rarity: 'common',
    text: '此牌进入最终胡牌结构时，每张 +12 牌值。',
    effects: [{ kind: 'boneChipsPerTile', value: 12 }],
  }),
  content({
    family: 'bone', id: 'greenBamboo', name: '青竹骨', glyph: '骨', price: 8, rarity: 'common',
    text: '此牌在最终胡牌结构中属于顺子时，每张 +18 牌值。',
    effects: [{ kind: 'boneChipsPerTile', groupKinds: ['chow'], value: 18 }],
  }),

  // ---------- 牌印 ----------
  content({
    family: 'seal', id: 'returnWind', name: '回风印', glyph: '印', trigger: 'swapOut',
    price: 9, rarity: 'common', perHandLimit: 1,
    text: '本副第一次换出此牌时，返还 1 次换牌；每副最多一次。',
    effect: { kind: 'refundSwap', value: 1 },
  }),
  content({
    family: 'seal', id: 'askOracle', name: '问签印', glyph: '印', trigger: 'reveal',
    price: 11, rarity: 'uncommon', perHandLimit: 1,
    text: '本副第一次用此牌亮组时，本次三签免费重抽一次；每副最多一次。',
    effect: { kind: 'rerollDraft', value: 1 },
  }),
  content({
    family: 'seal', id: 'gateKeeper', name: '守门印', glyph: '印', trigger: 'settle',
    price: 9, rarity: 'common', perHandLimit: 1,
    text: '此牌未被亮出而参与胡牌时，+1 待结算金币；每副最多一次。',
    effect: { kind: 'goldIfConcealedTile', value: 1 },
  }),
]);

const CONTENT_BY_KEY = new Map(
  CONTENT_LIBRARY.map((item) => [`${item.family}:${item.id}`, item]),
);

/** 查询时包含已下架卡，以便旧存档继续解析。 */
export function getContentItem(family, id) {
  return CONTENT_BY_KEY.get(`${family}:${id}`) ?? null;
}

/**
 * @param {string|null} family
 * @param {{includeDisabled?:boolean,pool?:string|null}} options
 */
export function listContentItems(family = null, { includeDisabled = false, pool = null } = {}) {
  return CONTENT_LIBRARY.filter((item) => (
    (!family || item.family === family)
    && (includeDisabled || item.enabled)
    && (!pool || item.pools.includes(pool))
  ));
}

/** 内容权重抽取；全部同权时保持原有均匀抽取的 RNG 路径。 */
export function pickContentItem(rng, items) {
  if (!items?.length) return null;
  const weights = items.map((item) => item.weight ?? 100);
  if (weights.every((weight) => weight === weights[0])) return items[rng.int(items.length)];
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (total <= 0) return null;
  let roll = rng.next() * total;
  for (let index = 0; index < items.length; index += 1) {
    roll -= Math.max(0, weights[index]);
    if (roll < 0) return items[index];
  }
  return items.at(-1);
}

export const CONTENT_COUNTS = Object.freeze(Object.fromEntries(
  FAMILY_ORDER.map((family) => [family, listContentItems(family).length]),
));

/** @param {readonly object[]} items */
export function validateContentLibrary(items = CONTENT_LIBRARY) {
  const errors = [];
  const keys = new Set();
  for (const [index, item] of items.entries()) {
    const at = item?.id ? `${item.family}:${item.id}` : `#${index}`;
    if (!FAMILIES[item?.family]) errors.push(`${at} family 不存在`);
    if (!item?.id || !/^[A-Za-z][A-Za-z0-9]*$/.test(item.id)) errors.push(`${at} id 不合法`);
    if (keys.has(at)) errors.push(`${at} 重复`);
    keys.add(at);
    if (!item?.name || !item?.glyph || !item?.text) errors.push(`${at} 缺少名称、字印或文案`);
    if (!['本副', '本轮', '本局', '局外'].includes(item?.duration)) errors.push(`${at} 持续时间不合法`);
    if (typeof item?.enabled !== 'boolean') errors.push(`${at} enabled 必须是布尔值`);
    if (!CONTENT_STATUSES.includes(item?.status)) errors.push(`${at} status 不合法`);
    if (!Number.isFinite(item?.weight) || item.weight < 0) errors.push(`${at} weight 不合法`);
    if (!Array.isArray(item?.pools) || item.pools.some((pool) => !CONTENT_POOLS.includes(pool))) {
      errors.push(`${at} pools 不合法`);
    }
    for (const effect of [...(item?.effects ?? []), ...(item?.effect ? [item.effect] : [])]) {
      if (!EFFECT_KINDS.has(effect.kind)) errors.push(`${at} 使用未登记效果 ${effect.kind}`);
    }
    if (item?.family === 'charm') {
      if (!['silver', 'gold', 'rainbow'].includes(item.tier)) errors.push(`${at} 签阶不合法`);
      if (!['momentum', 'fate', 'omen'].includes(item.functionRole)) errors.push(`${at} 职责不合法`);
      if (!['group', 'pattern', 'wild'].includes(item.draftRole)) errors.push(`${at} 求签货位不合法`);
    } else if (!Number.isFinite(item?.price) || item.price < 0) {
      errors.push(`${at} 价格不合法`);
    }
    if (item?.family === 'seal' && !['swapOut', 'reveal', 'settle'].includes(item.trigger)) {
      errors.push(`${at} 触发时机不合法`);
    }
  }
  return errors;
}

const LIBRARY_ERRORS = validateContentLibrary();
if (LIBRARY_ERRORS.length) {
  throw new Error(`功能卡 Library 校验失败:\n${LIBRARY_ERRORS.join('\n')}`);
}
