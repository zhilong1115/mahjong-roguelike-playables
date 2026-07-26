/**
 * 灵签：亮组后三选一取得，只在本副生效。
 *
 * 三个位置固定承担三种角色：
 * - `group` 本组签：强化刚亮出的组合，保证下限。
 * - `pattern` 牌型签：强化本副某类结构或番种，上限更高。
 * - `wild` 奇签 / 财签：高波动、剩余资源或少量待结算金币。
 *
 * 框架期只做 6 张，够覆盖三种角色与三类效果（牌值 / 番势 / 金币）。
 */

/**
 * @param {object} spec
 * @returns {import('../core/scoring.mjs').ContentItem}
 */
function charm(spec) {
  return Object.freeze({
    family: 'charm',
    duration: '本副',
    match: null,
    ...spec,
    effects: Object.freeze(spec.effects),
  });
}

export const CHARMS = Object.freeze({
  tailwind: charm({
    id: 'tailwind',
    name: '顺风签',
    glyph: '顺',
    role: 'group',
    match: ['chow'],
    text: '本副每个顺子 +20 牌值。',
    effects: [{ kind: 'chipsPerGroup', groupKinds: ['chow'], value: 20 }],
  }),
  carving: charm({
    id: 'carving',
    name: '刻福签',
    glyph: '刻',
    role: 'group',
    match: ['pung', 'kong'],
    text: '本副每个刻子或杠 +28 牌值。',
    effects: [{ kind: 'chipsPerGroup', groupKinds: ['pung', 'kong'], value: 28 }],
  }),
  doubleJoy: charm({
    id: 'doubleJoy',
    name: '双喜签',
    glyph: '喜',
    role: 'group',
    match: ['pair'],
    text: '本副每个对子 +20 牌值。',
    effects: [{ kind: 'chipsPerGroup', groupKinds: ['pair'], value: 20 }],
  }),
  dragonVein: charm({
    id: 'dragonVein',
    name: '龙脉签',
    glyph: '龙',
    role: 'pattern',
    match: ['chow'],
    text: '本副顺子达到 3 组时，番势 +1。',
    effects: [{ kind: 'multIfGroupCount', groupKinds: ['chow'], min: 3, value: 1 }],
  }),
  honorSeal: charm({
    id: 'honorSeal',
    name: '镇字签',
    glyph: '字',
    role: 'pattern',
    text: '本副每张字牌 +9 牌值。',
    effects: [{ kind: 'chipsPerTile', suit: 'honor', value: 9 }],
  }),
  doubleBless: charm({
    id: 'doubleBless',
    name: '倍喜签',
    glyph: '倍',
    role: 'wild',
    text: '本副番势 +1。',
    effects: [{ kind: 'multFlat', value: 1 }],
  }),
  wealth: charm({
    id: 'wealth',
    name: '财神签',
    glyph: '财',
    role: 'wild',
    text: '立刻 +1 待结算金币。',
    effects: [{ kind: 'goldNow', value: 1 }],
  }),
  reserve: charm({
    id: 'reserve',
    name: '余裕签',
    glyph: '余',
    role: 'wild',
    text: '胡牌时每个剩余换牌 +20 牌值。',
    effects: [{ kind: 'chipsPerRemainingSwap', value: 20 }],
  }),
});

export const CHARM_LIST = Object.freeze(Object.values(CHARMS));

/**
 * 三签选一：固定给出 本组签 / 牌型签 / 奇签 各一张。
 * @param {ReturnType<import('../core/tiles.mjs').createSeededRng>} rng
 * @param {string} revealedKind 刚亮出的组合类型
 * @returns {string[]} 三个灵签 id
 */
export function draftCharms(rng, revealedKind) {
  const byRole = (role) => CHARM_LIST.filter((item) => item.role === role);
  const groupPool = byRole('group').filter((item) => item.match?.includes(revealedKind));
  const chosen = [];
  const take = (pool) => {
    const candidates = pool.filter((item) => !chosen.some((picked) => picked.id === item.id));
    if (candidates.length) chosen.push(rng.pick(candidates));
  };
  take(groupPool.length ? groupPool : byRole('group'));
  take(byRole('pattern'));
  take(byRole('wild'));
  while (chosen.length < 3) take(CHARM_LIST);
  return chosen.map((item) => item.id);
}
