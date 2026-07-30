/**
 * 五系功能卡的纯表现层图谱。
 *
 * 内容 Library 只管规则与文案；这里把稳定 id 映射到图谱位置。
 * 换图时不需要改存档，也不会让规则层认识图片路径。
 */

const CHARM_ART_ORDER = Object.freeze([
  'tailwind', 'carving', 'doubleJoy', 'dragonVein', 'honorSeal',
  'doubleBless', 'wealth', 'reserve', 'dragonGuide', 'thunderGather',
  'redThread', 'stormCrown', 'pairedMoon', 'luckyOmen', 'wideOmen',
  'rainbowBless', 'nineDragons', 'thunderPrison', 'sevenStars',
]);

const GENERAL_ART_ORDER = Object.freeze([
  'azureEnvoy', 'stoneWarden', 'ladyConcord', 'cloudWalker',
  'thunderDuke', 'matchmaker', 'dragonKing', 'heavenWarden',
  'sevenStarQueen', 'coinBoy', 'magistrate',
]);

function atlasPosition(index, columns, rows) {
  const safe = Math.max(0, index);
  const column = safe % columns;
  const row = Math.floor(safe / columns);
  return {
    x: columns <= 1 ? 0 : (column / (columns - 1)) * 100,
    y: rows <= 1 ? 0 : (row / (rows - 1)) * 100,
  };
}

export function resolveCardArtwork(family, id) {
  const isCharm = family === 'charm';
  const order = isCharm ? CHARM_ART_ORDER : GENERAL_ART_ORDER;
  const columns = isCharm ? 5 : 4;
  const rows = isCharm ? 4 : 3;
  const fallback = isCharm ? 19 : 11;
  const found = order.indexOf(id);
  const index = found >= 0 ? found : fallback;
  return { ...atlasPosition(index, columns, rows), index, columns, rows, found: found >= 0 };
}

function node(className) {
  const art = document.createElement('div');
  art.className = `cardArtwork ${className}`;
  art.setAttribute('aria-hidden', 'true');
  return art;
}

function atlasArt(family, item, extraClass) {
  const position = resolveCardArtwork(family, item?.id);
  const art = node(`atlasArtwork art-${family} ${extraClass}`.trim());
  art.style.setProperty('--art-x', `${position.x}%`);
  art.style.setProperty('--art-y', `${position.y}%`);
  art.dataset.artId = item?.id ?? 'empty';
  return art;
}

function objectArt(family, item, extraClass) {
  const art = node(`objectArtwork art-${family} ${extraClass}`.trim());
  const object = document.createElement('span');
  object.className = 'artObject';
  const accent = document.createElement('span');
  accent.className = 'artAccent';
  const mark = document.createElement('span');
  mark.className = 'artMark';
  mark.textContent = family === 'codex'
    ? (item?.pattern?.slice(0, 2) ?? '谱')
    : family === 'bone' ? '玉'
      : family === 'seal' ? '印' : '帖';
  object.append(accent, mark);
  art.append(object);
  art.dataset.artId = item?.id ?? 'empty';
  return art;
}

/**
 * @param {'charm'|'codex'|'general'|'bone'|'seal'|'paper'} family
 * @param {object|null} item
 * @param {{className?:string}} [options]
 */
export function createCardArtwork(family, item, { className = '' } = {}) {
  if (family === 'charm' || family === 'general') return atlasArt(family, item, className);
  return objectArt(family, item, className);
}

export const CARD_ART_COUNTS = Object.freeze({
  charm: CHARM_ART_ORDER.length,
  general: GENERAL_ART_ORDER.length,
});
