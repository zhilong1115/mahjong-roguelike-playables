/**
 * 圈主：每个只改一个变量，且必须在开打前一眼看懂。
 * 规则只在该关生效，进下一关立刻恢复。
 */

function boss(spec) {
  return Object.freeze({ family: 'boss', duration: '本关', glyph: '主', ...spec });
}

export const BOSSES = Object.freeze({
  oneEye: boss({
    id: 'oneEye',
    name: '独眼张',
    text: '本关看不见牌墙预览。',
    modifier: { hideWallPreview: true },
  }),
  threeRounds: boss({
    id: 'threeRounds',
    name: '三巡客',
    text: '本关每副只有 3 次换牌。',
    modifier: { swapsPerHand: 3 },
  }),
  ironAbacus: boss({
    id: 'ironAbacus',
    name: '铁算盘',
    text: '本关只有 4 个开运位。',
    modifier: { fortuneSlots: 4 },
  }),
  paleJudge: boss({
    id: 'paleJudge',
    name: '白面判官',
    text: '本关字牌不计牌值。',
    modifier: { honorChipsZero: true },
  }),
  tileBreaker: boss({
    id: 'tileBreaker',
    name: '拆家婆',
    text: '本关起手多打碎 1 张。',
    modifier: { extraBrokenTiles: 1 },
  }),
});

export const BOSS_LIST = Object.freeze(Object.values(BOSSES));

/** 同一 seed 下每圈的圈主固定，且一局之内不重复。 */
export function pickBoss(rng, usedIds = []) {
  const pool = BOSS_LIST.filter((item) => !usedIds.includes(item.id));
  return (pool.length ? rng.pick(pool) : rng.pick(BOSS_LIST)).id;
}
