/**
 * 五系构筑的公共定义。分类边界见 docs/decisions/0011-five-content-families.md。
 *
 * 卡面只允许写 `本副` / `本轮` / `本局` / `局外`，不使用「永久」。
 */

/** @typedef {'charm'|'codex'|'general'|'bone'|'seal'} FamilyId */

export const FAMILIES = Object.freeze({
  charm: Object.freeze({
    id: 'charm',
    name: '灵签',
    subtitle: '本副机缘',
    glyph: '签',
    duration: '本副',
    shape: 'strip',   // 细长签纸
    tone: 'cyan',
  }),
  codex: Object.freeze({
    id: 'codex',
    name: '番谱',
    subtitle: '番型修习',
    glyph: '谱',
    duration: '本局',
    shape: 'book',    // 线装书
    tone: 'violet',
  }),
  general: Object.freeze({
    id: 'general',
    name: '福将',
    subtitle: '常驻助阵',
    glyph: '将',
    duration: '本局',
    shape: 'tablet',  // 人物牌位
    tone: 'gold',
  }),
  bone: Object.freeze({
    id: 'bone',
    name: '牌骨',
    subtitle: '材质改造',
    glyph: '骨',
    duration: '本局',
    shape: 'slab',    // 麻将剖面
    tone: 'jade',
  }),
  seal: Object.freeze({
    id: 'seal',
    name: '牌印',
    subtitle: '附牌印记',
    glyph: '印',
    duration: '本局',
    shape: 'stamp',   // 方形朱砂印
    tone: 'crimson',
  }),
});

export const FAMILY_ORDER = Object.freeze(['charm', 'codex', 'general', 'bone', 'seal']);
