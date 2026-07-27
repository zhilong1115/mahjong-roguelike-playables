/**
 * 效果解析：五系内容共用同一套 effect 描述，这里是唯一的解释器。
 * 每个 effect 返回它贡献的 `chips / mult / gold`，UI 靠这个逐条播放动画。
 *
 * @typedef {{ chips: number, mult: number, gold: number, multFactor: number }} EffectResult
 */

import { isTerminalTile, tileKey } from './tiles.mjs';

const EMPTY = Object.freeze({ chips: 0, mult: 0, gold: 0, multFactor: 1 });

function countGroups(groups, kinds) {
  return groups.filter((group) => kinds.includes(group.kind)).length;
}

/**
 * @param {object} effect
 * @param {object} context 计分上下文，见 scoring.mjs
 * @returns {EffectResult}
 */
export function resolveEffect(effect, context) {
  switch (effect.kind) {
    case 'chipsFlat':
      return { ...EMPTY, chips: effect.value };

    case 'chipsPerGroup':
      return { ...EMPTY, chips: countGroups(context.groups, effect.groupKinds) * effect.value };

    case 'chipsPerTile': {
      const matched = context.tiles.filter((tile) => (
        (!effect.suit || tile.suit === effect.suit)
        && (!effect.kindKey || tileKey(tile) === effect.kindKey)
        && (!effect.terminal || isTerminalTile(tile))
      ));
      return { ...EMPTY, chips: matched.length * effect.value };
    }

    case 'chipsPerRemainingSwap':
      return { ...EMPTY, chips: context.swapsRemaining * effect.value };

    case 'chipsPerReveal':
      return { ...EMPTY, chips: context.revealCount * effect.value };

    case 'chipsIfPattern':
      return context.patterns.includes(effect.pattern)
        ? { ...EMPTY, chips: effect.value }
        : EMPTY;

    case 'multFlat':
      return { ...EMPTY, mult: effect.value };

    case 'multPerGroup':
      return { ...EMPTY, mult: countGroups(context.groups, effect.groupKinds) * effect.value };

    case 'multIfPattern':
      return context.patterns.includes(effect.pattern)
        ? { ...EMPTY, mult: effect.value }
        : EMPTY;

    case 'multIfGroupCount':
      return countGroups(context.groups, effect.groupKinds) >= effect.min
        ? { ...EMPTY, mult: effect.value }
        : EMPTY;

    case 'multFactorIfPattern':
      return context.patterns.includes(effect.pattern)
        ? { ...EMPTY, multFactor: effect.value }
        : EMPTY;

    case 'multFactorIfGroupCount':
      return countGroups(context.groups, effect.groupKinds) >= effect.min
        ? { ...EMPTY, multFactor: effect.value }
        : EMPTY;

    case 'goldPerEmptySlot':
      return { ...EMPTY, gold: context.emptySlots * effect.value };

    case 'goldNow':
      // 灵签取得时就已经结算过，成胡时不再重复计入
      return EMPTY;

    default:
      return EMPTY;
  }
}

/** 把一个内容项的所有 effect 汇总成一次贡献。 */
export function resolveEffects(effects, context) {
  let chips = 0;
  let mult = 0;
  let gold = 0;
  let multFactor = 1;
  for (const effect of effects ?? []) {
    const result = resolveEffect(effect, context);
    chips += result.chips;
    mult += result.mult;
    gold += result.gold;
    multFactor *= result.multFactor;
  }
  return { chips, mult, gold, multFactor };
}

/** 牌骨：按最终结构里属于该牌种的每张牌结算。 */
export function resolveBone(bone, kindKey, context) {
  let chips = 0;
  for (const effect of bone.effects) {
    if (effect.kind !== 'boneChipsPerTile') continue;
    for (const group of context.groups) {
      if (effect.groupKinds && !effect.groupKinds.includes(group.kind)) continue;
      chips += group.tiles.filter((tile) => tileKey(tile) === kindKey).length * effect.value;
    }
  }
  return { chips, mult: 0, gold: 0, multFactor: 1 };
}
