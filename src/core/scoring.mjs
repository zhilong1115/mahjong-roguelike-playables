/**
 * 结算流水线。严格按 docs/decisions/0011 的八步顺序执行，
 * 并把过程拆成有序的 `steps[]`，UI 直接照着一步步播动画。
 *
 * 结果可解释、可复盘：同样的输入永远得到同样的 steps。
 *
 * @typedef {{ family: string, id: string, name: string, text: string, effects?: object[] }} ContentItem
 * @typedef {object} ScoreStep
 * @property {string} key            唯一 key，动画用
 * @property {string} source         base|group|slots|bone|seal|pattern|codex|charm|general|total
 * @property {string} label          左侧说明
 * @property {string} [detail]       右侧补充
 * @property {number} chips
 * @property {number} mult
 * @property {number} multFactor
 * @property {number} gold
 * @property {number} chipsAfter
 * @property {number} multAfter
 * @property {object} [target]       动画锚点
 */

import { CODEX_BY_PATTERN, CODEX_CHIPS_PER_LEVEL, CONFIG, getItem } from '../content/index.mjs';
import { resolveBone, resolveEffects } from './effects.mjs';
import { GROUP_NAMES, detectPatterns } from './patterns.mjs';
import { tileKey } from './tiles.mjs';

/**
 * @param {object} input
 * @param {import('./patterns.mjs').Solution} input.solution 已锁定的唯一分解
 * @param {number} input.revealCount
 * @param {number} input.emptySlots
 * @param {number} input.swapsRemaining
 * @param {string[]} [input.charmIds]   本副灵签，按取得顺序
 * @param {string[]} [input.generalIds] 福将，按将位顺序
 * @param {Record<string,string>} [input.bones] 牌种 → 牌骨 id
 * @param {Record<string,string>} [input.seals] 牌种 → 牌印 id
 * @param {Record<string,number>} [input.codexLevels] 番种 → 等级
 * @param {Set<string>} [input.usedSealKinds] 本副已经触发过的牌印牌种
 * @param {object} [input.modifiers] 圈主等临时规则
 */
export function scoreHand({
  solution,
  revealCount = 0,
  emptySlots = 0,
  swapsRemaining = 0,
  charmIds = [],
  generalIds = [],
  bones = {},
  seals = {},
  codexLevels = {},
  usedSealKinds = new Set(),
  modifiers = {},
  config = CONFIG,
}) {
  const groups = solution.groups;
  const tiles = groups.flatMap((group) => group.tiles);
  const patterns = detectPatterns(solution, { concealed: revealCount === 0 });

  const context = {
    groups,
    tiles,
    patterns,
    revealCount,
    emptySlots,
    swapsRemaining,
    bones,
    seals,
  };

  /** @type {ScoreStep[]} */
  const steps = [];
  let chips = 0;
  let mult = 1;
  let gold = 0;

  const push = (step) => {
    chips += step.chips ?? 0;
    mult += step.mult ?? 0;
    mult = Math.max(1, mult * (step.multFactor ?? 1));
    gold += step.gold ?? 0;
    steps.push({
      chips: 0,
      mult: 0,
      multFactor: 1,
      gold: 0,
      ...step,
      chipsAfter: chips,
      multAfter: mult,
    });
  };

  // 2. 胡牌底分 → 组合底分 → 空开运位牌值
  push({
    key: 'base',
    source: 'base',
    label: '胡牌底分',
    chips: config.huBase,
    target: { type: 'hud', id: 'chips' },
  });

  groups.forEach((group, index) => {
    const allHonor = group.tiles.every((tile) => tile.suit === 'honor');
    const muted = Boolean(modifiers.honorChipsZero) && allHonor;
    push({
      key: `group:${group.id}`,
      source: 'group',
      label: GROUP_NAMES[group.kind],
      detail: muted ? '字牌被压' : (group.revealed ? '已亮' : '暗组'),
      chips: muted ? 0 : config.groupChips[group.kind],
      target: { type: 'group', groupId: group.id, index },
    });
  });

  if (emptySlots > 0) {
    push({
      key: 'slots',
      source: 'slots',
      label: `静心 · 空开运位 ${emptySlots}`,
      detail: `${emptySlots} × ${config.emptySlotChips}`,
      chips: emptySlots * config.emptySlotChips,
      target: { type: 'hud', id: 'slots' },
    });
  }

  if (swapsRemaining > 0 && config.goldPerUnusedSwap > 0) {
    push({
      key: 'swaps',
      source: 'swaps',
      label: `余下换牌 ${swapsRemaining}`,
      detail: `${swapsRemaining} × ${config.goldPerUnusedSwap} 金`,
      gold: swapsRemaining * config.goldPerUnusedSwap,
      target: { type: 'hud', id: 'swaps' },
    });
  }

  // 3. 牌骨的静态牌值
  for (const [kind, boneId] of Object.entries(bones)) {
    const bone = getItem('bone', boneId);
    if (!bone) continue;
    const result = resolveBone(bone, kind, context);
    if (!result.chips) continue;
    push({
      key: `bone:${kind}`,
      source: 'bone',
      label: bone.name,
      detail: kindLabel(kind),
      chips: result.chips,
      target: { type: 'kind', kind, family: 'bone', id: bone.id },
    });
  }

  // 4. 成胡 / 结算类牌印，每印每副最多一次
  // 这里只读 usedSealKinds，实际记账由调用方在结算后做，预览不会消耗触发次数。
  const sealsFired = [];
  for (const [kind, sealId] of Object.entries(seals)) {
    const seal = getItem('seal', sealId);
    if (!seal || seal.trigger !== 'settle') continue;
    if (usedSealKinds.has(kind)) continue;
    const result = resolveSettleSeal(seal, kind, context);
    if (!result.chips && !result.gold) continue;
    sealsFired.push({ kind, sealId });
    push({
      key: `seal:${kind}`,
      source: 'seal',
      label: seal.name,
      detail: kindLabel(kind),
      chips: result.chips,
      gold: result.gold,
      target: { type: 'kind', kind, family: 'seal', id: seal.id },
    });
  }

  // 5. 番种与番谱
  for (const pattern of patterns) {
    const patternMult = config.patternMult[pattern] ?? 0;
    const level = codexLevels[pattern] ?? 0;
    if (!patternMult && !level && pattern !== '普通胡' && pattern !== '门清') continue;
    push({
      key: `pattern:${pattern}`,
      source: 'pattern',
      label: pattern,
      detail: patternMult ? `番势 +${patternMult}` : '记名',
      mult: patternMult,
      target: { type: 'pattern', name: pattern },
    });
    if (level > 0) {
      const book = CODEX_BY_PATTERN[pattern];
      push({
        key: `codex:${pattern}`,
        source: 'codex',
        label: `${book?.name ?? pattern} Lv.${level}`,
        detail: `${level} × ${CODEX_CHIPS_PER_LEVEL}`,
        chips: level * CODEX_CHIPS_PER_LEVEL,
        target: { type: 'card', family: 'codex', id: book?.id ?? pattern },
      });
    }
  }

  // 6. 本副灵签，按取得顺序
  charmIds.forEach((charmId, index) => {
    const charm = getItem('charm', charmId);
    if (!charm) return;
    const result = resolveEffects(charm.effects, context);
    if (!result.chips && !result.mult && !result.gold && result.multFactor === 1) return;
    push({
      key: `charm:${index}:${charmId}`,
      source: 'charm',
      label: charm.name,
      chips: result.chips,
      mult: result.mult,
      multFactor: result.multFactor,
      gold: result.gold,
      target: { type: 'card', family: 'charm', id: charmId, index },
    });
  });

  // 7. 福将，按将位从左到右
  generalIds.forEach((generalId, index) => {
    const general = getItem('general', generalId);
    if (!general) return;
    const result = resolveEffects(general.effects, context);
    if (!result.chips && !result.mult && !result.gold && result.multFactor === 1) return;
    push({
      key: `general:${index}:${generalId}`,
      source: 'general',
      label: general.name,
      chips: result.chips,
      mult: result.mult,
      multFactor: result.multFactor,
      gold: result.gold,
      target: { type: 'card', family: 'general', id: generalId, index },
    });
  });

  // 8. 牌值 × 番势
  mult = Math.max(1, mult);
  const total = Math.floor(chips * mult);
  steps.push({
    key: 'total',
    source: 'total',
    label: '本副得分',
    detail: `${chips} × ${mult}`,
    chips: 0,
    mult: 0,
    multFactor: 1,
    gold: 0,
    chipsAfter: chips,
    multAfter: mult,
    total,
    target: { type: 'hud', id: 'total' },
  });

  return { patterns, chips, mult, total, gold, steps, sealsFired };
}

function resolveSettleSeal(seal, kind, context) {
  if (seal.effect?.kind === 'goldIfConcealedTile') {
    const concealedHit = context.groups.some(
      (group) => !group.revealed && group.tiles.some((tile) => tileKey(tile) === kind),
    );
    return concealedHit ? { chips: 0, gold: seal.effect.value } : { chips: 0, gold: 0 };
  }
  return { chips: 0, gold: 0 };
}

function kindLabel(kind) {
  const [suit, rank] = kind.split(':');
  const names = { man: '万', pin: '筒', sou: '条' };
  if (suit === 'honor') return ['东', '南', '西', '北', '中', '发', '白'][Number(rank) - 1];
  return `${rank}${names[suit]}`;
}

/** 只要总分，不需要动画时用这个。 */
export function scoreTotal(input) {
  return scoreHand(input).total;
}
