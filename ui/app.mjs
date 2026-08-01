/**
 * 界面层：把 Run 的快照画出来，并在结算时按 scoring steps 播放爆分动画。
 * 这里不产生任何规则结果，只表演。
 */

import {
  ANTES, CODEX_BY_PATTERN, CODEX_CHIPS_PER_LEVEL, CONFIG, FAMILIES, getItem,
} from '../content/index.mjs';
import { GROUP_NAMES } from '../core/patterns.mjs';
import { TILE_KINDS, kindName, tileKey, tileName } from '../core/tiles.mjs';
import {
  createTileBackCanvas,
  createTileCanvas,
  pixelText,
  setPixelText,
  TILE_SIZE,
} from '../render/pixel.mjs';
import { createCardArtwork } from '../render/card-art.mjs';
import { createBackdrop } from '../render/backdrop.mjs';
import { Timeline, countUp, floatText, pulse, shake } from './animate.mjs';
import {
  attachCardMotion, attachTileMotion, impulse, setSpringMotion, springTo,
} from './spring.mjs';
import { setAudioEnabled, sfx } from './audio.mjs';
import {
  closeScreen,
  makeScreen,
  showBlindSelect,
  showDeckSelect,
  showHelp,
  showLibrary,
  showSettings,
  showTitle,
} from './screens.mjs';

const $ = (selector) => document.querySelector(selector);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const ROLE_LABEL = {
  group: '助势',
  pattern: '助势',
  wild: '奇缘',
  momentum: '助势',
  fate: '改命',
  omen: '奇缘',
  active: '锦囊',
};
const TIER_LABEL = { silver: '银签', gold: '金签', rainbow: '彩签' };
const TIER_MARKS = { silver: '◆', gold: '◆◆', rainbow: '◆◆◆' };
const SETTINGS_KEY = 'tianhu.settings.v1';
const DEFAULT_SETTINGS = { sound: true, animationSpeed: 1, haptics: true, deckId: 'plain' };

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * @param {object} deps
 * @param {(options:{seed?:number, deckId?:string}) => import('../core/run.mjs').Run} deps.createRun
 * @param {object} deps.adapter
 * @param {object} [deps.storage]
 * @param {(run:import('../core/run.mjs').Run, options:{silent:boolean}) => void} [deps.onRunAttached]
 */
export function createApp({ createRun, adapter, storage, onRunAttached }) {
  let settings = loadSettings();
  let run = null;
  let state = null;
  let unsubscribe = null;
  let tileScale = 2;
  let tileDisplay = 2;
  let locked = false;
  let lastScreenStatus = null;
  let screenQueue = Promise.resolve();
  let hasSave = false;
  // 胡牌那一瞬间就置位：结算动画播完之前，谁都不许把结果屏盖上来
  let settlementPending = false;
  let draftFocusToken = null;
  let draftReturnFocus = null;
  const timeline = new Timeline();

  /* ---------------- 基础工具 ---------------- */

  /** 背景 shader。拿不到 WebGL 就是 null，body 的 CSS 渐变兜底。 */
  let backdrop = null;

  function applySettings(next) {
    settings = { ...settings, ...next };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch { /* 隐私模式下忽略 */ }
    setAudioEnabled(settings.sound);
    timeline.speed = settings.animationSpeed === 0 ? Infinity : settings.animationSpeed;
    const motion = settings.animationSpeed !== 0;
    setSpringMotion(motion);
    backdrop?.setEnabled(motion);
  }

  /** 背景底色跟着圈和圈主走：打圈主时整个画面转红，压力是看得见的。 */
  function syncBackdropTone() {
    if (!backdrop) return;
    if (!state) {
      backdrop.setTone('title');
      return;
    }
    if (state.bossActive) {
      backdrop.setTone('boss');
      return;
    }
    backdrop.setTone(['east', 'south', 'west'][(state.anteNumber ?? 1) - 1] ?? 'default');
  }

  function toast(message, duration = 2100) {
    const node = el('div', 'toastItem', message);
    node.style.setProperty('--toast-out-delay', `${Math.max(250, duration - 400)}ms`);
    $('#toast').append(node);
    setTimeout(() => node.remove(), duration);
  }

  function haptic() {
    if (settings.haptics) adapter.haptic?.(8);
  }

  function bindTip(node, title, body) {
    const tip = $('#tip');
    const show = (event) => {
      tip.replaceChildren(el('div', 'tn', title), el('div', 'td', body));
      tip.style.display = 'block';
      const rect = tip.getBoundingClientRect();
      tip.style.left = `${Math.min(event.clientX + 12, innerWidth - rect.width - 8)}px`;
      tip.style.top = `${Math.max(8, Math.min(event.clientY - rect.height - 10, innerHeight - rect.height - 8))}px`;
    };
    node.addEventListener('mouseenter', show);
    node.addEventListener('mousemove', show);
    node.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  }

  function cardNode(family, item, {
    className = '', meta = '', showText = true, interactive = false,
  } = {}) {
    const info = FAMILIES[family] ?? {
      name: family === 'paper' ? '牌帖' : family,
      subtitle: '改牌组',
      duration: item.duration ?? '本局',
      glyph: item.glyph,
    };
    const node = el(interactive ? 'button' : 'div', `card family-${family} ${className}`.trim());
    if (interactive) node.type = 'button';
    node.dataset.card = `${family}:${item.id}`;
    node.append(createCardArtwork(family, item));
    node.append(el('div', 'cName', item.name));
    if (showText) node.append(el('div', 'cText', item.text ?? ''));
    node.append(el('div', 'cMeta', meta || `${info.name} · ${item.duration ?? info.duration}`));
    bindTip(node, `${item.name} · ${info.name}`, `${item.text ?? ''}（${item.duration ?? info.duration}）`);
    return node;
  }

  /* ---------------- 尺寸 ---------------- */

  function refreshScale() {
    const main = $('#main');
    const width = main.clientWidth || document.documentElement.clientWidth || 844;
    const height = main.clientHeight || document.documentElement.clientHeight || 390;
    const portrait = matchMedia('(max-aspect-ratio:0.95)').matches;
    const perRow = portrait ? 7 : 14;
    const rows = portrait ? 2 : 1;
    const widthBudget = (width - 8) / perRow - 3;
    const heightBudget = (height * (portrait ? 0.42 : 0.34)) / rows;
    const fit = Math.min(3, widthBudget / TILE_SIZE.width, heightBudget / TILE_SIZE.height);
    const canvas = Math.max(1, Math.min(3, Math.floor(fit)));
    const display = Math.max(canvas, Math.min(fit, canvas * 1.55));
    if (canvas === tileScale && Math.abs(display - tileDisplay) < 0.02) return false;
    tileScale = canvas;
    tileDisplay = display;
    return true;
  }

  /** 这张牌被哪个牌骨 / 牌印改造过。牌骨直接换材质，牌印在右上角盖一枚朱砂印。 */
  function tileSkin(tile) {
    const kind = tileKey(tile);
    return {
      material: state?.bones?.[kind] ?? 'ivory',
      sealed: Boolean(state?.seals?.[kind]),
    };
  }

  /** 所有牌一律走这里，材质才不会有的地方画有的地方不画。 */
  function tileCanvas(tile, scale, options = {}) {
    return createTileCanvas(tile, scale, { ...tileSkin(tile), ...options });
  }

  function tileFace(tile) {
    const face = tileCanvas(tile, tileScale);
    face.style.width = `${Math.round(TILE_SIZE.width * tileDisplay)}px`;
    face.style.height = `${Math.round(TILE_SIZE.height * tileDisplay)}px`;
    return face;
  }

  const textScale = () => (innerHeight <= 470 ? 1 : 2);

  /* ---------------- 渲染 ---------------- */

  function renderSide() {
    const scale = textScale();
    $('#roundChip').textContent = state.ante.label;
    $('#roundName').textContent = `${state.ante.name}·${state.blind.name}`;
    $('#roundMeta').textContent = `第 ${state.handNumber}/${state.handCount} 副 · 第 ${state.anteNumber}/${state.anteCount} 圈 · ${state.flavor?.name ?? ''}`;

    setPixelText($('#targetVal'), `${state.blindScore} / ${state.target}`, 12, '#f2efe4', '#000', scale);
    $('#targetFill').style.width = `${Math.min(100, (state.blindScore / state.target) * 100)}%`;
    $('#pendingLine').textContent = `待结算 ${state.pendingGold} 金 · 过关才入账`;

    const preview = state.preview;
    $('#handName').textContent = preview ? preview.patterns.join(' · ') : '尚未成牌';
    setPixelText($('#chipsBox'), preview ? preview.chips : 0, 13, '#ffffff', '#0a3d63', scale);
    setPixelText($('#multBox'), preview ? preview.mult : 1, 13, '#ffffff', '#7a1f19', scale);
    setPixelText($('#totalBox'), preview ? (preview.total ?? preview.score ?? 0) : 0, 14, '#f0c04a', '#3a2c06', scale);

    setPixelText($('#swapV'), state.swapsRemaining, 11, '#59c4ff', '#000', scale);
    $('#swapLabel').textContent = state.bonusSwapsRemaining
      ? `换牌 · 额外 ${state.bonusSwapsRemaining} 次不换金`
      : `换牌 ·剩余×${state.goldPerUnusedSwap}金`;
    setPixelText(
      $('#distV'),
      state.canHu ? '可胡' : (Number.isFinite(state.distance) ? state.distance : '—'),
      11,
      state.canHu ? '#3fae74' : '#ff8b83',
      '#000',
      scale,
    );
    setPixelText($('#goldV'), state.gold, 11, '#f0c04a', '#000', scale);
    setPixelText($('#slotV'), `${state.projectedGold}金`, 11, '#f0c04a', '#000', scale);
    $('#slotLabel').textContent = `签缘 ${state.emptySlots}/${state.slotCount}`;

    const omenSlot = $('#omenSlot');
    const omen = state.pendingOmen;
    const omenCharm = omen ? getItem('charm', omen.sourceCharmId) : null;
    omenSlot.classList.toggle('filled', Boolean(omen));
    $('#omenName').textContent = omenCharm ? omenCharm.name : '空 · 延时奇缘会留在这里';
    $('#omenTiming').textContent = omen ? '下次求签 · 一次' : '等待奇缘';
    omenSlot.setAttribute(
      'aria-label',
      omenCharm
        ? `待缘位，${omenCharm.name}，下次求签时应验一次。${omenCharm.text}`
        : '待缘位为空，延时奇缘会留在这里',
    );

    const passiveCount = state.charmInstances?.length ?? 0;
    $('#passiveCount').textContent = passiveCount ? `${passiveCount} 张 · 点开看叠加` : '0 · 选中即生效';
    $('#passiveSummary').classList.toggle('filled', passiveCount > 0);
    $('#passiveSummary').setAttribute(
      'aria-label',
      passiveCount ? `本副签效 ${passiveCount} 张，点开查看完整效果` : '本副签效为空，被动签选中后立即生效',
    );

    renderBuildBar();
    renderBossBanner();
  }

  function renderBossBanner() {
    const banner = $('#bossBanner');
    if (!state.bossActive || !state.boss) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.replaceChildren(
      el('span', 'bossTitle', `圈主 · ${state.boss.name}`),
      el('span', 'bossText', state.boss.text),
    );
  }

  /* ---------------- 常驻构筑栏 ---------------- */

  /**
   * 番谱 / 牌骨 / 牌印 / 牌帖不再一张一卡：它们是「按牌种或按番种铺开」的东西，
   * 平铺出来既占地方又读不出来。收成一枚可点摘要，点开看明细（0021 的反馈）。
   * 福将不一样，它是有限的将位，必须一位一卡地看见。
   */
  function buildChip(family, { count, hint, onOpen }) {
    const info = FAMILIES[family] ?? { name: '牌帖', glyph: '帖' };
    const chip = el('button', `buildChip family-${family}`);
    chip.type = 'button';
    chip.dataset.family = family;
    chip.append(el('span', 'chipGlyph', info.glyph ?? '牌'));
    const body = el('span', 'chipBody');
    body.append(el('span', 'chipName', info.name));
    body.append(el('span', 'chipCount', count));
    chip.append(body);
    chip.setAttribute('aria-label', `${info.name}：${count}。点开看明细`);
    bindTip(chip, `${info.name} · 点开看明细`, hint);
    chip.addEventListener('click', onOpen);
    return chip;
  }

  function renderBuildBar() {
    const bar = $('#buildBar');
    bar.replaceChildren();

    // 福将：一位一卡，空位也要看得见。将位多了就在这块里滚动。
    const generals = el('div', 'generalRow');
    for (let index = 0; index < state.generalSlots; index += 1) {
      const generalId = state.generalIds[index];
      if (!generalId) {
        const empty = el('div', 'buildSlot');
        empty.append(el('span', 'slotIdx', `将位 ${index + 1}`));
        generals.append(empty);
        continue;
      }
      generals.append(cardNode('general', getItem('general', generalId), {
        className: 'buildCard', meta: `将位 ${index + 1}`, showText: false,
      }));
    }
    bar.append(generals);

    // 摘要不放在滚动区里：福将占满时它必须还看得见
    const chips = el('div', 'chipRow');
    $('#buildChips').replaceChildren(chips);
    const codexOwned = Object.entries(state.codexLevels).filter(([, level]) => level > 0);
    const boneEntries = Object.entries(state.bones);
    const sealEntries = Object.entries(state.seals);

    chips.append(buildChip('codex', {
      count: codexOwned.length ? `${codexOwned.length} 本` : '看番率',
      hint: '点开看本局所有番种的番势，以及番谱把哪几种练到了几级。',
      onOpen: showCodexSheet,
    }));
    chips.append(buildChip('bone', {
      count: boneEntries.length ? `${boneEntries.length} 种` : '无',
      hint: '点开看哪几个牌种换了材质。改过材质的牌在手上就是另一种料子。',
      onOpen: showBoneSheet,
    }));
    chips.append(buildChip('seal', {
      count: sealEntries.length ? `${sealEntries.length} 种` : '无',
      hint: '点开看哪几个牌种挂了牌印，以及各自在什么时候触发。',
      onOpen: showSealSheet,
    }));
    if (state.papers.length) {
      chips.append(buildChip('paper', {
        count: `${state.papers.length} 张`,
        hint: '点开看牌帖怎么改了这一局的牌组。',
        onOpen: showPaperSheet,
      }));
    }
  }

  /* ---------------- 明细弹层 ---------------- */

  function closeSheet() {
    const sheet = $('#sheet');
    if (!sheet) return;
    if (sheet.contains(document.activeElement)) document.activeElement.blur();
    sheet.remove();
  }

  function openSheet(title, subtitle, body) {
    closeSheet();
    const sheet = el('div', 'sheet');
    sheet.id = 'sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    const box = el('div', 'sheetBox');
    box.append(el('div', 'title sh', title));
    if (subtitle) box.append(el('div', 'subtitle', subtitle));
    box.append(body);
    const row = el('div', 'rowBtns');
    const close = el('button', 'btn green big', '关闭');
    close.type = 'button';
    close.addEventListener('click', closeSheet);
    row.append(close);
    box.append(row);
    sheet.append(box);
    sheet.addEventListener('click', (event) => {
      if (event.target === sheet) closeSheet();
    });
    document.body.append(sheet);
    close.focus({ preventScroll: true });
  }

  /** 番谱：不摆卡，直接把这一局的番率表摊开。 */
  function showCodexSheet() {
    const list = el('div', 'sheetList');
    const active = new Set(state.preview?.patterns ?? []);
    for (const [pattern, mult] of Object.entries(CONFIG.patternMult)) {
      const level = state.codexLevels[pattern] ?? 0;
      const book = CODEX_BY_PATTERN[pattern];
      const row = el('div', `sheetRow${active.has(pattern) ? ' hot' : ''}`);
      row.append(el('div', 'n', pattern));
      const parts = [mult ? `番势 +${mult}` : '记名 · 不加番'];
      if (level > 0) parts.push(`${book?.name ?? '番谱'} Lv.${level} · +${level * CODEX_CHIPS_PER_LEVEL} 牌值`);
      else if (book) parts.push(`${book.name} 未修习`);
      row.append(el('div', 'v', parts.join(' · ')));
      list.append(row);
    }
    openSheet('番率', state.preview?.patterns?.length
      ? `当前手牌命中：${state.preview.patterns.join(' · ')} · 番势 ×${state.preview.mult ?? 1}`
      : '当前手牌还没成番种；亮着的行会随手牌变化', list);
  }

  /** 牌骨 / 牌印共用：按牌种铺开，左边直接画那张牌，改了什么一眼看到。 */
  function kindSheet(family, entries, title, subtitle, extra) {
    const list = el('div', 'sheetList');
    if (!entries.length) {
      list.append(el('div', 'sheetEmpty', `这一局还没有${FAMILIES[family].name}。去百宝阁买一张，选一个牌种装上。`));
    }
    for (const [kind, itemId] of entries) {
      const item = getItem(family, itemId);
      const [suit, rank] = kind.split(':');
      const row = el('div', 'sheetRow kindRow');
      const tile = el('div', 'kindTile');
      tile.append(tileCanvas({ id: `sheet-${kind}`, suit, rank: Number(rank) }, 2));
      row.append(tile);
      const body = el('div', 'n');
      body.append(el('div', 'kindTitle', `${kindName(kind)} · ${item?.name ?? itemId}`));
      body.append(el('div', 'kindText', item?.text ?? ''));
      if (extra) body.append(el('div', 'kindExtra', extra(item)));
      row.append(body);
      list.append(row);
    }
    openSheet(title, subtitle, list);
  }

  function showBoneSheet() {
    kindSheet('bone', Object.entries(state.bones), '牌骨 · 材质',
      '换过材质的牌在手上就是另一种料子，牌面直接看得出来', null);
  }

  const SEAL_TRIGGER_NAMES = { swapOut: '换出这张牌时', reveal: '用这张牌亮组时', settle: '成胡结算时' };

  function showSealSheet() {
    kindSheet('seal', Object.entries(state.seals), '牌印 · 事件',
      '挂了牌印的牌右上角有一枚朱砂印',
      (item) => `触发：${SEAL_TRIGGER_NAMES[item?.trigger] ?? '未知'}`);
  }

  function showPaperSheet() {
    const list = el('div', 'sheetList');
    for (const paperId of state.papers) {
      const paper = getItem('paper', paperId);
      const row = el('div', 'sheetRow');
      row.append(el('div', 'n', paper?.name ?? paperId));
      row.append(el('div', 'v', paper?.text ?? ''));
      list.append(row);
    }
    openSheet('牌帖', '牌帖改的是这一局的牌组构成', list);
  }

  function showPassiveSheet() {
    const list = el('div', 'sheetList passiveList');
    if (!state.charmInstances?.length) {
      list.append(el('div', 'sheetEmpty', '本副还没有被动签效。亮出合法组合后选择“立即生效”的签，它会收进这里。'));
    }
    for (const [index, instance] of (state.charmInstances ?? []).entries()) {
      const charm = getItem('charm', instance.charmId);
      if (!charm) continue;
      const row = el('div', 'sheetRow passiveRow');
      row.dataset.charmIndex = String(index);
      row.append(createCardArtwork('charm', charm, { className: 'passiveArtwork' }));
      const body = el('div', 'n');
      body.append(el('div', 'kindTitle', `${charm.name} · ${TIER_LABEL[instance.tier ?? charm.tier] ?? '灵签'}`));
      body.append(el('div', 'kindText', charm.text));
      row.append(body);
      list.append(row);
    }
    openSheet('本副签效', '这些签已经生效，不占锦囊位；胡牌结算时会按取得顺序触发', list);
  }

  /** 六次签缘只显示经济计数；顶部三格只放现在可以点击使用的锦囊。 */
  function renderSlots() {
    const bar = $('#slotBar');
    bar.replaceChildren();
    const meter = el('div', 'fortuneMeter');
    meter.id = 'fortuneMeter';
    meter.dataset.used = String(state.slotsUsed);
    meter.append(
      el('span', 'fortuneEyebrow', '求签机会'),
      el('span', 'fortuneValue', `签缘 ${state.emptySlots}/${state.slotCount}`),
      el('span', 'fortuneRule', `每剩 1 缘 · +${state.goldPerEmptySlot} 金`),
    );
    const pips = el('span', 'fortunePips');
    for (let index = 0; index < state.slotCount; index += 1) {
      pips.append(el('i', index < state.slotsUsed ? 'spent' : ''));
    }
    meter.append(pips);
    bindTip(meter, '签缘不是锦囊位', `亮组花 1 缘并求签；使用锦囊不会返还。胡牌时每个未用签缘 +${state.emptySlotChips} 牌值与 +${state.goldPerEmptySlot} 金。`);
    bar.append(meter);

    for (let index = 0; index < 3; index += 1) {
      const instance = state.satchel?.[index] ?? null;
      const charm = instance ? getItem('charm', instance.charmId) : null;
      const slot = el(charm ? 'button' : 'div', `satchelSlot${charm ? ' filled' : ''}`);
      slot.dataset.satchelIndex = String(index);
      if (!charm) {
        slot.append(el('span', 'satchelEmptyGlyph', '囊'), el('span', 'satchelEmptyText', `锦囊 ${index + 1} · 待收入`));
        bar.append(slot);
        continue;
      }
      slot.type = 'button';
      slot.dataset.card = `charm:${charm.id}`;
      slot.dataset.instanceId = instance.instanceId;
      slot.classList.add(`tier-${instance.tier ?? charm.tier ?? 'silver'}`);
      slot.append(createCardArtwork('charm', charm, { className: 'satchelArtwork' }));
      const body = el('span', 'satchelBody');
      body.append(el('span', 'satchelName', charm.name), el('span', 'satchelAction', '点击使用 · 一次'));
      slot.append(body);
      slot.setAttribute('aria-label', `${charm.name}，主动锦囊，点击查看并使用。${charm.text}`);
      slot.addEventListener('click', () => {
        const result = run.beginSatchelUse(instance.instanceId);
        if (!result.ok) toast(result.reason);
        else sfx.select();
      });
      bindTip(slot, `${charm.name} · ${TIER_LABEL[instance.tier ?? charm.tier]}`, charm.text);
      attachCardMotion(slot, { float: 1.8, hoverLift: 7, tilt: 6, depth: 520 });
      bar.append(slot);
    }
  }

  const MELD_INK_NAMES = Object.freeze({ pair: '对', chow: '顺', pung: '碰', kong: '杠' });
  const STACK_INK_NAMES = Object.freeze({ 5: '五', 6: '六', 7: '七', 8: '八' });

  function meldNode(group, scale = Math.max(2, tileScale)) {
    const meld = el('div', `meld${group.revealed ? '' : ' concealed'}`);
    meld.dataset.groupId = group.id;
    meld.dataset.kinds = [...new Set(group.tiles.map(tileKey))].join(' ');
    meld.dataset.count = String(group.tiles.length);

    const ink = el('div', 'meldInk');
    const inkName = STACK_INK_NAMES[group.tiles.length] ?? MELD_INK_NAMES[group.kind] ?? '组';
    ink.append(el('span', 'meldInkText', inkName));
    ink.append(el('span', 'meldInkSub', group.tiles.length >= 5 ? `${group.tiles.length} 张同牌` : GROUP_NAMES[group.kind]));

    const representative = group.kind === 'chow'
      ? group.tiles[Math.floor(group.tiles.length / 2)]
      : group.tiles[0];
    const wrap = el('span', 'meldTile meldHeroTile');
    wrap.dataset.kind = tileKey(representative);
    wrap.append(tileCanvas(representative, scale));
    meld.append(ink, wrap);
    return meld;
  }

  function renderTable() {
    const zone = $('#revealZone');
    zone.replaceChildren();
    for (const group of state.revealedGroups) zone.append(meldNode(group));

    const nextBox = $('#nextTile');
    nextBox.replaceChildren();
    if (state.upcomingTiles.length) {
      state.upcomingTiles.forEach((tile, index) => {
        const wrap = el('div', index === 0 ? 'nextFirst' : 'nextSecond');
        wrap.append(tileCanvas(tile, Math.max(1, tileScale - 1)));
        nextBox.append(wrap);
      });
      bindTip($('#nextBox'), '牌墙预览',
        `换牌先摸 ${tileName(state.upcomingTiles[0])}${state.upcomingTiles[1] ? `，再摸 ${tileName(state.upcomingTiles[1])}` : ''}。一次换多张会摸到看不见的牌。`);
    } else {
      nextBox.append(el('div', 'lbl', state.modifiers?.hideWallPreview ? '被遮住' : '空'));
    }

    const pile = $('#deckPile');
    pile.replaceChildren();
    const layers = Math.max(1, Math.min(4, Math.ceil(state.wallCount / 30)));
    for (let index = 0; index < layers; index += 1) {
      const back = createTileBackCanvas(state.back, 1);
      back.style.marginTop = index ? '-42px' : '0';
      back.style.marginLeft = `${index * 2}px`;
      pile.append(back);
    }
    $('#wallCount').textContent = `牌墙 ${state.wallCount}`;
  }

  function renderHand({ dealt = false } = {}) {
    const zone = $('#handZone');
    // 拖拽进行中绝对不能重建手牌：正在被拖的那个节点会被换掉，拖拽当场断掉。
    // 拖起一张未选中的牌时会改选择，那次 emit 就会走到这里。
    if (dragging?.active) {
      for (const node of zone.querySelectorAll('.tile')) {
        const selected = state.selectedIds.includes(node.dataset.tileId);
        node.classList.toggle('sel', selected);
        if (node !== dragging.node) attachTileMotion(node, { selected });
      }
      return;
    }
    zone.replaceChildren();
    state.looseTiles.forEach((tile, index) => {
      const kind = tileKey(tile);
      const node = el('button', 'tile');
      node.type = 'button';
      node.dataset.tileId = tile.id;
      node.dataset.kind = kind;
      node.setAttribute('aria-label', tileName(tile));
      if (state.bones[kind]) node.classList.add('hasBone');
      if (state.seals[kind]) node.classList.add('hasSeal');
      if (state.selectedIds.includes(tile.id)) node.classList.add('sel');
      if (dealt) {
        node.classList.add('dealIn');
        node.style.animationDelay = `${index * 26}ms`;
      }
      node.append(tileFace(tile));
      attachTileMotion(node, { selected: state.selectedIds.includes(tile.id) });
      attachTileDrag(node, tile);
      const marks = [];
      if (state.bones[kind]) marks.push(getItem('bone', state.bones[kind])?.name);
      if (state.seals[kind]) marks.push(getItem('seal', state.seals[kind])?.name);
      if (marks.length) bindTip(node, tileName(tile), `${marks.join(' · ')}（本局，这个牌种的四张牌都有）`);
      node.addEventListener('click', () => {
        if (locked) return;
        if (node.dataset.suppressClick === '1') {
          delete node.dataset.suppressClick;
          return;
        }
        sfx.select();
        run.toggleTile(tile.id);
      });
      zone.append(node);
    });
  }

  function renderActions() {
    const swapButton = $('#btnSwap');
    const revealButton = $('#btnReveal');
    const huButton = $('#btnHu');
    const playable = state.status === 'playing' || state.status === 'hu-ready';
    const count = state.selectedIds.length;

    swapButton.textContent = count ? `换掉 ${count} 张` : '换牌';
    swapButton.disabled = !state.swapPreview.valid || !playable || locked;
    revealButton.textContent = state.revealPreview.valid ? `亮${state.revealPreview.name}` : '亮组';
    revealButton.disabled = !state.revealPreview.valid || !playable || locked;
    // 胡牌平时不占位：只有真的能胡时才出现，出现本身就是提示
    huButton.hidden = !state.canHu;
    huButton.disabled = !state.canHu || locked;
    huButton.classList.toggle('ready', state.canHu && !locked);

    let hint;
    if (dragging?.active) {
      hint = dropHintText() ?? '拖到上面的按钮或牌桌上松手；放在这里松手不会出牌';
    } else if (!count) {
      hint = state.canHu
        ? '现在就能胡：直接结算，或继续亮组换三签选一。'
        : `还差 ${state.distance} 张成牌。点或拖起手牌都能出，没用完的换牌每次换 ${state.goldPerUnusedSwap} 金。`;
    } else if (state.revealPreview.valid) {
      hint = state.revealPreview.text;
    } else {
      hint = state.swapPreview.text;
    }
    $('#actionHint').textContent = hint;
  }

  /* ---------------- 拖拽出牌 ---------------- */

  /**
   * 拖起一张手牌往上走，第一个碰到的就是操作栏。
   * 松手落在按钮上执行那个动作；落在牌桌上执行默认动作；落回手牌只当点选。
   */
  let dragging = null;
  const DRAG_THRESHOLD = 8;

  /** 落在牌桌上时的默认动作：能亮组就亮组，否则换牌。 */
  function defaultDropAction() {
    if (!state) return null;
    if (state.revealPreview?.valid) return { id: 'reveal', label: `亮${state.revealPreview.name}`, run: doReveal };
    if (state.swapPreview?.valid) {
      return {
        id: 'swap',
        label: `换掉 ${state.selectedIds.length} 张`,
        run: doSwap,
      };
    }
    return null;
  }

  function dropHintText() {
    if (!dragging?.active) return null;
    if (dragging.hotButton) return `松手：${dragging.hotButton.textContent.trim()}`;
    // 只有真的悬在牌桌上才提示默认动作。松手落在别处必须什么都不做，
    // 否则「拖着看看又放回去」会白白吃掉一次换牌。
    if (!dragging.overTable) return null;
    const fallback = defaultDropAction();
    return fallback ? `松手：${fallback.label}` : null;
  }

  function paintDropState() {
    const hint = $('#dropHint');
    const text = dropHintText();
    hint.hidden = !dragging?.active;
    hint.classList.toggle('idle', !text);
    hint.textContent = text ?? '松手不会出牌';
    for (const button of document.querySelectorAll('#actionRow .btn')) {
      button.classList.toggle('dropHot', button === dragging?.hotButton);
    }
  }

  function endDrag({ commit = false } = {}) {
    if (!dragging) return;
    const { node, pointerId, active, hotButton, overTable } = dragging;
    const wasActive = active;
    dragging = null;
    document.body.classList.remove('dragging');
    delete node.dataset.dragging;
    node.classList.remove('dragTile');
    try { node.releasePointerCapture(pointerId); } catch { /* 指针已经没了 */ }
    paintDropState();

    // 复位：选中状态由 renderHand 重新给静止姿态，这里先把偏移收回去
    springTo(node, {
      x: 0,
      lift: node.classList.contains('sel') ? 20 : 0,
      rot: node.classList.contains('sel') ? -2.5 : 0,
      scale: node.classList.contains('sel') ? 1.06 : 1,
    });

    if (!wasActive || !commit) return;
    if (hotButton && !hotButton.disabled) {
      hotButton.click();
      return;
    }
    // 落在牌桌上才执行默认动作；落回手牌或落在空处一律作废
    const fallback = overTable ? defaultDropAction() : null;
    if (fallback) fallback.run();
    else renderActions();
  }

  function attachTileDrag(node, tile) {
    node.addEventListener('pointerdown', (event) => {
      if (locked || event.button > 0 || dragging) return;
      dragging = {
        node,
        tileId: tile.id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        hotButton: null,
        overTable: false,
      };
      try { node.setPointerCapture(event.pointerId); } catch { /* 不支持就退回普通点击 */ }
    });

    node.addEventListener('pointermove', (event) => {
      if (!dragging || dragging.node !== node || event.pointerId !== dragging.pointerId) return;
      const dx = event.clientX - dragging.startX;
      const dy = event.clientY - dragging.startY;
      if (!dragging.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragging.active = true;
        node.dataset.dragging = '1';
        node.classList.add('dragTile');
        document.body.classList.add('dragging');
        // 拖一张没选的牌 = 只出这一张；拖一张已选的牌 = 出整个选择
        if (!state.selectedIds.includes(tile.id)) {
          run.clearSelection();
          run.toggleTile(tile.id);
        }
      }
      event.preventDefault();
      springTo(node, { x: dx, lift: -dy, scale: 1.14, rot: Math.max(-14, Math.min(14, dx * 0.07)) });
      const under = document.elementFromPoint(event.clientX, event.clientY);
      const button = under?.closest?.('#actionRow .btn:not(:disabled)') ?? null;
      dragging.overTable = Boolean(under?.closest?.('#table'));
      if (button !== dragging.hotButton) {
        dragging.hotButton = button;
        if (button) sfx.select();
      }
      paintDropState();
      renderActions();
    });

    node.addEventListener('pointerup', (event) => {
      if (!dragging || dragging.node !== node || event.pointerId !== dragging.pointerId) return;
      const wasActive = dragging.active;
      endDrag({ commit: true });
      // 拖过就不再当点击，否则松手会顺手把选中状态翻回去
      if (wasActive) node.dataset.suppressClick = '1';
    });

    node.addEventListener('pointercancel', () => endDrag({ commit: false }));
  }

  function renderDraft() {
    const layer = $('#draftLayer');
    const cards = $('#draftCards');
    const reroll = $('#btnReroll');
    const actions = $('#draftActions');
    const notice = $('#draftNotice');
    if (!state.draft && !state.activeChoice) {
      const wasOpen = !layer.hidden;
      const previousFocus = draftReturnFocus;
      layer.hidden = true;
      layer.inert = false;
      layer.removeAttribute('aria-hidden');
      layer.removeAttribute('data-offer-count');
      layer.removeAttribute('data-mode');
      cards.replaceChildren();
      actions.replaceChildren(reroll);
      reroll.hidden = true;
      notice.hidden = true;
      $('#side').inert = false;
      $('#main').inert = false;
      draftFocusToken = null;
      draftReturnFocus = null;
      if (wasOpen) {
        requestAnimationFrame(() => {
          if (state?.draft || state?.activeChoice) return;
          const fallback = [$('#btnHu'), $('#btnReveal'), $('#btnSwap')]
            .find((node) => node && !node.disabled && !node.hidden);
          const target = previousFocus?.isConnected && !previousFocus.matches?.(':disabled')
            ? previousFocus
            : fallback;
          target?.focus();
        });
      }
      return;
    }
    if ($('#screen')) {
      coverDraftForScreen();
      return;
    }
    if (layer.hidden) {
      const active = document.activeElement;
      draftReturnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    layer.inert = false;
    layer.removeAttribute('aria-hidden');
    layer.hidden = false;
    $('#side').inert = true;
    $('#main').inert = true;
    cards.replaceChildren();
    actions.replaceChildren(reroll);
    layer.removeAttribute('data-mode');

    if (state.activeChoice) {
      renderSatchelChoice({ layer, cards, actions, notice, choice: state.activeChoice });
      return;
    }

    const satchelReplacement = state.draft.pendingSatchelReplacement ?? null;
    if (satchelReplacement) {
      renderSatchelReplacement({ layer, cards, actions, notice, replacement: satchelReplacement });
      return;
    }

    const replacement = state.draft.pendingOmenReplacement
      ?? state.draft.replacement
      ?? state.draft.pendingReplacement
      ?? null;
    if (replacement) {
      renderOmenReplacement({ layer, cards, actions, notice, replacement });
      return;
    }
    if (state.draft.pendingFateChoice) {
      renderFateChoice({ layer, cards, actions, notice, pending: state.draft.pendingFateChoice });
      return;
    }

    const offers = state.draft.offers ?? state.draft.charmIds.map((charmId, index) => ({
      offerId: `legacy-${index}`,
      charmId,
      tier: getItem('charm', charmId)?.tier ?? 'silver',
    }));
    layer.dataset.offerCount = String(state.draft.offerCount ?? offers.length);

    const applied = state.draft.appliedOmen;
    const appliedCharm = applied ? getItem('charm', applied.sourceCharmId) : null;
    notice.hidden = !applied;
    notice.textContent = applied
      ? `签兆已应验 · ${appliedCharm?.name ?? '待缘'} · 本次${offers.length}选一`
      : '';
    $('#draftTitle').textContent = `${offers.length === 4 ? '四' : '三'}签选一 · 只取一张`;

    offers.forEach((offer, index) => {
      const { charmId } = offer;
      const charm = getItem('charm', charmId);
      if (!charm) return;
      const tier = offer.tier ?? charm.tier ?? 'silver';
      const role = offer.functionRole ?? offer.role ?? charm.functionRole ?? charm.role;
      const resolutionLabel = charm.resolution === 'reserve'
        ? '收入锦囊'
        : charm.omen
        ? '留下签兆'
        : '立即生效';
      const durationMeta = charm.omen ? `${charm.duration ?? '本局'} · 一次` : (charm.duration ?? '本副');
      const node = cardNode('charm', charm, {
        className: `charmPick tier-${tier}`,
        meta: `${index + 1} · ${resolutionLabel} · ${durationMeta}`,
        interactive: true,
      });
      node.dataset.offerId = offer.offerId;
      node.dataset.tier = tier;
      node.dataset.role = role;
      node.setAttribute(
        'aria-label',
        `${index + 1}，${TIER_LABEL[tier] ?? '灵签'}，${ROLE_LABEL[role] ?? '奇缘'}，${charm.name}，${charm.text}`,
      );
      const tierRow = el('div', 'cTierRow');
      tierRow.append(
        el('span', 'tierName', TIER_LABEL[tier] ?? '灵签'),
        el('span', 'tierMarks', TIER_MARKS[tier] ?? '◆'),
      );
      node.prepend(el('div', 'cResolve', resolutionLabel), el('div', 'cRole', ROLE_LABEL[role] ?? '奇缘'), tierRow);
      const choose = () => {
        if (locked) return;
        sfx.charm();
        haptic();
        const result = run.chooseDraftOffer
          ? run.chooseDraftOffer(offer.offerId)
          : run.chooseCharm(charmId);
        if (result.ok && result.needsOmenReplace) {
          return;
        }
        if (result.ok && result.needsFateChoice) {
          return;
        }
        if (result.ok && result.needsSatchelReplace) {
          return;
        }
        if (result.ok && result.goldNow) {
          sfx.coin();
          toast(`${charm.name} · +${result.goldNow} 待结算金`);
        } else if (result.ok && result.pendingOmen) {
          toast(`${charm.name} · 已放入待缘位，下次求签应验一次`);
        } else if (result.ok && result.reserved) {
          toast(`${charm.name} · 已收入顶部锦囊位`);
        } else if (result.ok) {
          toast(`${charm.name} · 已生效`);
        } else if (!result.ok && !result.needsOmenReplace && result.reason) {
          toast(result.reason);
        }
      };
      node.addEventListener('click', choose);
      node.style.animationDelay = `${index * 60}ms`;
      node.classList.add('dealIn');
      cards.append(node);
      // dealIn 用的是 transform 关键帧，得等它播完再交给弹簧，否则会打架
      setTimeout(() => attachCardMotion(node, { float: 3.2, hoverLift: 14, tilt: 11 }), 400);
    });
    reroll.hidden = state.draft.rerollsLeft <= 0;
    if (!reroll.hidden) reroll.classList.remove('sm');

    const focusToken = `${state.draft.draftId ?? state.draft.groupId}:offers`;
    if (draftFocusToken !== focusToken) {
      requestAnimationFrame(() => {
        const target = cards.querySelector('.charmPick');
        if ($('#screen') || layer.hidden || layer.inert || !state?.draft || !target?.isConnected) return;
        draftFocusToken = focusToken;
        target.focus();
      });
    }
  }

  function omenCharmFrom(value) {
    if (!value) return null;
    return getItem('charm', value.sourceCharmId ?? value.charmId ?? value.nextCharmId);
  }

  function renderFateChoice({ layer, cards, actions, notice, pending }) {
    layer.dataset.mode = 'fate';
    layer.removeAttribute('data-offer-count');
    $('#btnReroll').hidden = true;
    const charm = getItem('charm', pending.charmId);
    const selected = pending.selectedTileId
      ? state.looseTiles.find((tile) => tile.id === pending.selectedTileId)
      : null;
    const validTileIds = new Set(pending.choices.map((choice) => choice.tileId));

    notice.hidden = false;
    notice.textContent = `${charm?.name ?? '改命签'} · 只显示能让“还差几张”下降的结果`;
    $('#draftTitle').textContent = selected
      ? `${kindName(tileKey(selected))} · 选择要变成的牌`
      : `${charm?.name ?? '改命签'} · 选择要改变的牌`;

    const chooser = el('div', 'fateChooser');
    chooser.append(el('div', 'fateHint', selected
      ? `当前还差 ${pending.distanceBefore} 张；点击目标牌后立即改牌并取得金签。`
      : '灰色牌没有有效改法；选择一张亮着的手牌。'));

    if (!selected) {
      const handGrid = el('div', 'fateHand');
      for (const tile of state.looseTiles) {
        const valid = validTileIds.has(tile.id);
        const node = el('button', `fateOption fateSource${valid ? '' : ' invalid'}`);
        node.type = 'button';
        node.disabled = !valid;
        node.dataset.tileId = tile.id;
        node.setAttribute('aria-label', valid
          ? `选择${tileName(tile)}作为要改变的牌`
          : `${tileName(tile)}没有有效改牌目标`);
        node.append(tileCanvas(tile, 2));
        node.append(el('span', 'fateOptionMeta', valid ? '可改' : '无改善'));
        if (valid) node.addEventListener('click', () => run.selectFateTile(tile.id));
        handGrid.append(node);
      }
      chooser.append(handGrid);
    } else {
      const before = el('div', 'fateBefore');
      before.append(tileCanvas(selected, 2), el('span', 'fateArrow', '→'));
      chooser.append(before);

      const targetGrid = el('div', 'fateTargetGrid');
      const options = pending.choices
        .filter((choice) => choice.tileId === selected.id)
        .sort((left, right) => (
          left.distanceAfter - right.distanceAfter
          || right.potential - left.potential
          || TILE_KINDS.indexOf(left.targetKind) - TILE_KINDS.indexOf(right.targetKind)
        ));
      for (const choice of options) {
        const [suit, rank] = choice.targetKind.split(':');
        const node = el('button', 'fateOption fateTarget');
        node.type = 'button';
        node.dataset.targetKind = choice.targetKind;
        node.setAttribute('aria-label', `改成${kindName(choice.targetKind)}，还差${choice.distanceAfter}张`);
        node.append(tileCanvas({ id: `fate-${choice.targetKind}`, suit, rank: Number(rank) }, 2));
        node.append(el('span', 'fateOptionName', kindName(choice.targetKind)));
        node.append(el('span', 'fateOptionMeta', choice.distanceAfter === 0 ? '立即可胡' : `还差 ${choice.distanceAfter} 张`));
        node.addEventListener('click', () => {
          const result = run.confirmFateTarget(choice.targetKind);
          if (!result.ok) {
            toast(result.reason);
            return;
          }
          sfx.charm();
          haptic();
          const changed = result.fateChange;
          toast(`${charm?.name ?? '改命'} · ${kindName(tileKey(changed.before))}化为${kindName(tileKey(changed.after))}`);
        });
        targetGrid.append(node);
      }
      chooser.append(targetGrid);
    }
    cards.append(chooser);

    if (selected) {
      const back = el('button', 'btn grey', '重选原牌');
      back.type = 'button';
      back.addEventListener('click', () => run.backFateTile());
      actions.append(back);
    }
    const cancel = el('button', 'btn grey', '返回三签');
    cancel.type = 'button';
    cancel.addEventListener('click', () => run.cancelFateChoice());
    actions.append(cancel);

    const focusToken = `${state.draft.draftId ?? state.draft.groupId}:fate:${selected?.id ?? 'source'}`;
    if (draftFocusToken !== focusToken) {
      requestAnimationFrame(() => {
        const target = cards.querySelector('.fateOption:not(:disabled)');
        if ($('#screen') || layer.hidden || layer.inert || !state?.draft?.pendingFateChoice || !target?.isConnected) return;
        draftFocusToken = focusToken;
        target.focus();
      });
    }
  }

  function renderSatchelChoice({ layer, cards, actions, notice, choice }) {
    layer.dataset.mode = 'satchel';
    layer.removeAttribute('data-offer-count');
    $('#btnReroll').hidden = true;
    const charm = getItem('charm', choice.charmId);
    notice.hidden = false;
    notice.textContent = '主动锦囊 · 确认后才消费；返回不会损失';

    if (choice.mode === 'confirm') {
      $('#draftTitle').textContent = `${charm?.name ?? '锦囊'} · 是否使用`;
      const preview = el('div', 'satchelConfirm');
      if (charm) preview.append(createCardArtwork('charm', charm, { className: 'satchelConfirmArt' }));
      const body = el('div', 'satchelConfirmBody');
      body.append(el('div', 'satchelConfirmName', charm?.name ?? '主动锦囊'));
      body.append(el('div', 'satchelConfirmText', charm?.text ?? ''));
      if (charm?.active?.kind === 'addSwaps') {
        body.append(el('div', 'satchelPreviewLine', `换牌 ${state.swapsRemaining} → ${state.swapsRemaining + charm.active.value} · 新增次数不换金币`));
      } else if (charm?.active?.kind === 'shuffleWall') {
        body.append(el('div', 'satchelPreviewLine', `重洗牌墙 ${state.wallCount} 张 · 牌的总集合不变`));
      }
      preview.append(body);
      cards.append(preview);

      const cancel = el('button', 'btn grey', '收回锦囊');
      cancel.type = 'button';
      cancel.addEventListener('click', () => run.cancelSatchelUse());
      const confirm = el('button', 'btn gold big', '确认使用');
      confirm.type = 'button';
      confirm.addEventListener('click', () => {
        const result = run.confirmSatchelUse();
        if (!result.ok) toast(result.reason);
        else {
          sfx.charm();
          haptic();
          toast(`${result.charm.name} · ${result.detail}`);
        }
      });
      actions.append(cancel, confirm);
      requestAnimationFrame(() => confirm.focus());
      return;
    }

    const selected = choice.selectedTileId
      ? state.looseTiles.find((tile) => tile.id === choice.selectedTileId)
      : null;
    const validTileIds = new Set(choice.choices.map((entry) => entry.tileId));
    const chooser = el('div', 'fateChooser satchelChooser');

    if (choice.mode === 'source') {
      $('#draftTitle').textContent = `${charm?.name ?? '点石锦囊'} · 选择要改变的牌`;
      chooser.append(el('div', 'fateHint', '只可选择未亮牌；下一步可以指定任意不造第五张的牌种。'));
      const handGrid = el('div', 'fateHand');
      for (const tile of state.looseTiles) {
        const valid = validTileIds.has(tile.id);
        const node = el('button', `fateOption fateSource${valid ? '' : ' invalid'}`);
        node.type = 'button';
        node.disabled = !valid;
        node.dataset.tileId = tile.id;
        node.setAttribute('aria-label', `选择${tileName(tile)}作为点石原牌`);
        node.append(tileCanvas(tile, 2), el('span', 'fateOptionMeta', valid ? '可点石' : '不可改'));
        if (valid) node.addEventListener('click', () => run.selectSatchelTile(tile.id));
        handGrid.append(node);
      }
      chooser.append(handGrid);
    } else if (choice.mode === 'target') {
      $('#draftTitle').textContent = `${selected ? tileName(selected) : '原牌'} · 指定目标牌`;
      chooser.append(el('div', 'fateHint', '任意合法牌种都可选；“改善”表示更接近成胡，但不会替你自动选择。'));
      const before = el('div', 'fateBefore');
      if (selected) before.append(tileCanvas(selected, 2), el('span', 'fateArrow', '→'));
      chooser.append(before);
      const targetGrid = el('div', 'fateTargetGrid pointStoneTargets');
      const options = choice.choices
        .filter((entry) => entry.tileId === choice.selectedTileId)
        .sort((left, right) => (
          Number(right.improves) - Number(left.improves)
          || left.distanceAfter - right.distanceAfter
          || TILE_KINDS.indexOf(left.targetKind) - TILE_KINDS.indexOf(right.targetKind)
        ));
      for (const option of options) {
        const [suit, rank] = option.targetKind.split(':');
        const node = el('button', `fateOption fateTarget${option.improves ? ' improves' : ''}`);
        node.type = 'button';
        node.dataset.targetKind = option.targetKind;
        node.setAttribute('aria-label', `指定为${kindName(option.targetKind)}，还差${option.distanceAfter}张`);
        node.append(tileCanvas({ id: `stone-${option.targetKind}`, suit, rank: Number(rank) }, 2));
        node.append(el('span', 'fateOptionName', kindName(option.targetKind)));
        node.append(el('span', 'fateOptionMeta', option.distanceAfter === 0 ? '可胡' : option.improves ? `改善 · 差 ${option.distanceAfter}` : `差 ${option.distanceAfter}`));
        node.addEventListener('click', () => run.selectSatchelTarget(option.targetKind));
        targetGrid.append(node);
      }
      chooser.append(targetGrid);
    } else {
      const preview = choice.preview;
      $('#draftTitle').textContent = `${charm?.name ?? '点石锦囊'} · 确认改牌`;
      chooser.append(el('div', 'fateHint', '确认后才会消耗锦囊；本副只能使用一次改命类锦囊。'));
      const before = el('div', 'stonePreview');
      const original = selected;
      const [suit, rank] = (choice.selectedTargetKind ?? 'man:1').split(':');
      if (original) before.append(tileCanvas(original, 2));
      before.append(el('span', 'fateArrow', '→'));
      before.append(tileCanvas({ id: `stone-preview-${choice.selectedTargetKind}`, suit, rank: Number(rank) }, 2));
      chooser.append(before);
      chooser.append(el('div', 'satchelPreviewLine', preview?.canHuAfter
        ? `还差 ${preview.distanceBefore} → 0 · 立即可胡${preview.patternsAfter?.length ? ` · ${preview.patternsAfter.join(' · ')}` : ''}`
        : `还差 ${preview?.distanceBefore ?? '—'} → ${preview?.distanceAfter ?? '—'}`));
    }
    cards.append(chooser);

    if (choice.mode === 'target' || choice.mode === 'preview') {
      const back = el('button', 'btn grey', choice.mode === 'preview' ? '重选目标' : '重选原牌');
      back.type = 'button';
      back.addEventListener('click', () => run.backSatchelChoice());
      actions.append(back);
    }
    const cancel = el('button', 'btn grey', '收回锦囊');
    cancel.type = 'button';
    cancel.addEventListener('click', () => run.cancelSatchelUse());
    actions.append(cancel);
    if (choice.mode === 'preview') {
      const confirm = el('button', 'btn gold big', '确认点石');
      confirm.type = 'button';
      confirm.addEventListener('click', () => {
        const result = run.confirmSatchelUse();
        if (!result.ok) toast(result.reason);
        else {
          sfx.charm();
          haptic();
          toast(`${result.charm.name} · ${result.detail}`);
        }
      });
      actions.append(confirm);
    }

    const focusToken = `satchel:${choice.instanceId}:${choice.mode}:${choice.selectedTileId ?? ''}:${choice.selectedTargetKind ?? ''}`;
    if (draftFocusToken !== focusToken) {
      requestAnimationFrame(() => {
        const target = cards.querySelector('.fateOption:not(:disabled)') ?? actions.querySelector('.btn:last-child');
        if (layer.hidden || !state?.activeChoice || !target?.isConnected) return;
        draftFocusToken = focusToken;
        target.focus();
      });
    }
  }

  function renderSatchelReplacement({ layer, cards, actions, notice, replacement }) {
    layer.dataset.mode = 'satchel-replace';
    layer.removeAttribute('data-offer-count');
    $('#btnReroll').hidden = true;
    const incoming = getItem('charm', replacement.charmId);
    notice.hidden = false;
    notice.textContent = '锦囊位已满 · 选择一张旧锦囊替换；求签机会不会返还';
    $('#draftTitle').textContent = `${incoming?.name ?? '新锦囊'} · 替换哪一张`;
    const grid = el('div', 'satchelReplaceGrid');
    for (const [index, instance] of (state.satchel ?? []).entries()) {
      const current = getItem('charm', instance.charmId);
      const node = el('button', 'satchelReplaceCard');
      node.type = 'button';
      if (current) node.append(createCardArtwork('charm', current, { className: 'satchelReplaceArt' }));
      node.append(el('span', 'satchelReplaceName', current?.name ?? '旧锦囊'));
      node.append(el('span', 'satchelReplaceMeta', `替换锦囊 ${index + 1}`));
      node.addEventListener('click', () => {
        const result = run.confirmSatchelReplacement(index);
        if (!result.ok) toast(result.reason);
        else toast(`${incoming?.name ?? '新锦囊'}已收入，替换${current?.name ?? '旧锦囊'}`);
      });
      grid.append(node);
    }
    cards.append(grid);
    const back = el('button', 'btn grey', '返回三签');
    back.type = 'button';
    back.addEventListener('click', () => run.cancelSatchelReplacement());
    actions.append(back);
    requestAnimationFrame(() => grid.querySelector('button')?.focus());
  }

  function renderOmenReplacement({ layer, cards, actions, notice, replacement }) {
    layer.dataset.offerCount = '2';
    notice.hidden = false;
    notice.textContent = '待缘位已占用 · 选择是否替换';
    $('#draftTitle').textContent = '旧缘与新缘只能留一个';

    const current = omenCharmFrom(replacement.current ?? state.pendingOmen);
    const incoming = omenCharmFrom(replacement.incoming ?? replacement.next ?? replacement);
    const comparison = el('div', 'omenCompare');
    for (const [label, item, className] of [
      ['当前待缘', current, 'current'],
      ['这次新缘', incoming, 'new'],
    ]) {
      const node = el('div', `omenCompareCard ${className}`);
      node.append(
        el('div', 'compareLabel', label),
        el('div', 'compareName', item?.name ?? '未知签兆'),
        el('div', 'compareText', item?.text ?? '下一次求签时应验一次'),
      );
      comparison.append(node);
    }
    cards.append(comparison);

    const back = el('button', 'btn grey', '返回选签');
    back.type = 'button';
    back.addEventListener('click', () => (
      run.cancelPendingOmenReplacement?.() ?? run.cancelOmenReplacement?.()
    ));
    const confirm = el('button', 'btn gold', '换成新缘');
    confirm.type = 'button';
    confirm.addEventListener('click', () => {
      const result = run.confirmPendingOmen?.()
        ?? run.confirmPendingOmenReplacement?.()
        ?? run.confirmOmenReplacement?.()
        ?? { ok: false, reason: '暂时无法替换' };
      if (!result.ok && result.reason) toast(result.reason);
      else toast(`${incoming?.name ?? '新签兆'}已放入待缘位`);
    });
    actions.append(back, confirm);
    $('#btnReroll').hidden = true;

    const focusToken = `${state.draft.draftId ?? state.draft.groupId}:replacement`;
    if (draftFocusToken !== focusToken) {
      requestAnimationFrame(() => {
        if ($('#screen') || layer.hidden || layer.inert || !state?.draft || !back.isConnected) return;
        draftFocusToken = focusToken;
        back.focus();
      });
    }
  }

  /** 外层屏幕出现时，求签只作为待恢复状态存在，不能留在可访问树或抢走焦点。 */
  function coverDraftForScreen() {
    const layer = $('#draftLayer');
    if ((!state?.draft && !state?.activeChoice) || !layer) return;
    if (layer.contains(document.activeElement)) document.activeElement.blur();
    layer.hidden = true;
    layer.inert = true;
    layer.setAttribute('aria-hidden', 'true');
    draftFocusToken = null;
  }

  function renderAll(options = {}) {
    if (locked || !state) return;
    renderSide();
    renderSlots();
    renderTable();
    renderHand(options);
    renderActions();
    renderDraft();
    if (state.status === 'shop' && $('#screen')) showShop();
    else ensureScreen();
  }

  /* ---------------- 结算动画 ---------------- */

  /**
   * 一条结算步骤可能同时对应好几个东西：牌骨要让牌桌上那几张牌和常驻栏的摘要一起跳。
   * 返回全部锚点，第一个用来飘字。
   */
  function stepAnchors(step) {
    const target = step.target ?? {};
    const found = [];
    const add = (node) => { if (node && !found.includes(node)) found.push(node); };

    if (target.type === 'group') {
      add($(`#revealZone .meld[data-group-id="${target.groupId}"]`));
    } else if (target.type === 'kind') {
      for (const meld of document.querySelectorAll('#revealZone .meld')) {
        if (meld.dataset.kinds?.split(' ').includes(target.kind)) {
          add(meld.querySelector('.meldHeroTile') ?? meld);
        }
      }
      add($(`#buildPanel [data-family="${target.family}"]`));
    } else if (target.type === 'card' && target.family === 'charm') {
      add($('#passiveSummary'));
      add($(`#sheet .passiveRow[data-charm-index="${target.index}"]`));
    } else if (target.type === 'card') {
      add($(`#buildPanel [data-card="${target.family}:${target.id}"]`));
      add($(`#buildPanel [data-family="${target.family}"]`));
    } else if (target.type === 'pattern') {
      add($('#patternBanner'));
    } else if (target.id === 'slots') {
      add($('#fortuneMeter'));
      add($('#slotV'));
    } else if (target.id === 'swaps') {
      add($('#swapV'));
    } else if (target.id === 'total') {
      add($('#totalBox'));
    }
    if (!found.length) add($('#chipsBox'));
    return found;
  }

  /**
   * 每条步骤的节奏。原来一律 190ms，玩家根本看不清是哪张牌在加分（0021 的反馈）。
   * 现在按「这一步值不值得看」分档：灵签和番种最慢，组合底分最快。
   */
  const STEP_BEAT = {
    base: 260, group: 210, slots: 300, swaps: 300,
    bone: 380, seal: 380, pattern: 480, codex: 400,
    charm: 460, general: 420,
  };
  /** 先让卡跳，再飘数字。两件事分开，玩家才看得出因果。 */
  const STEP_LEAD = 130;

  async function playSettlement(result) {
    closeSheet();
    locked = true;
    timeline.begin();
    try {
      return await runSettlement(result);
    } finally {
      $('#patternBanner').hidden = true;
      timeline.end();
      locked = false;
      renderAll();
    }
  }

  async function runSettlement(result) {
    const layer = $('#floatLayer');
    const chipsBox = $('#chipsBox');
    const multBox = $('#multBox');
    const banner = $('#patternBanner');

    const zone = $('#revealZone');
    zone.replaceChildren();
    for (const group of result.solution.groups) zone.append(meldNode(group));
    $('#handZone').replaceChildren();
    $('#draftLayer').hidden = true;
    renderActions();

    setPixelText(chipsBox, 0, 13, '#ffffff', '#0a3d63', textScale());
    setPixelText(multBox, 1, 13, '#ffffff', '#7a1f19', textScale());
    setPixelText($('#totalBox'), 0, 14, '#f0c04a', '#3a2c06', textScale());
    await timeline.wait(160);

    let chipIndex = 0;
    let multIndex = 0;

    for (const step of result.steps) {
      if (step.source === 'total') break;
      const anchors = stepAnchors(step);
      const anchor = anchors[0];
      const beat = STEP_BEAT[step.source] ?? 300;

      if (step.source === 'pattern') {
        banner.hidden = false;
        banner.textContent = step.label;
        pulse(banner, 'slamIn', 380);
        if (step.mult || step.multFactor > 1) sfx.mult(multIndex++);
      } else {
        // 牌骨 / 牌印额外挂一层滤镜光，其余靠弹簧冲量把卡顶起来
        const glow = step.source === 'bone' ? 'glowBone'
          : step.source === 'seal' ? 'glowSeal' : null;
        const heavy = step.source === 'charm' || step.source === 'general' || step.source === 'codex';
        // impulse 给的是速度不是位移。按 spring.mjs 的刚度 / 阻尼折算，
        // 峰值位移约等于速度 × 0.035，所以要到「跳 14px」得给 400 上下。
        for (const node of anchors) {
          if (glow) pulse(node, glow, 420);
          impulse(node, {
            lift: heavy ? 560 : 400,
            scale: heavy ? 5.6 : 4.2,
            rot: heavy ? (Math.random() < 0.5 ? -260 : 260) : 0,
          });
          pulse(node, 'spotlight', beat + STEP_LEAD);
        }
      }

      // 先跳，再出数字
      await timeline.wait(STEP_LEAD);

      if (step.chips) {
        floatText(anchor, `+${step.chips}`, 'chips', layer);
        sfx.chip(chipIndex++);
        pulse(chipsBox, 'pulse', 300);
        setPixelText(chipsBox, step.chipsAfter, 13, '#ffffff', '#0a3d63', textScale());
      }
      if (step.mult) {
        floatText(anchor, `+${step.mult} 番`, 'mult', layer);
        if (step.source !== 'pattern') sfx.mult(multIndex++);
        pulse(multBox, 'pulse', 300);
        setPixelText(multBox, step.multAfter, 13, '#ffffff', '#7a1f19', textScale());
      }
      if (step.multFactor > 1) {
        floatText(anchor, `×${step.multFactor} 番势`, 'mult', layer);
        if (step.source !== 'pattern') sfx.mult(multIndex++);
        pulse(multBox, 'pulse', 420);
        setPixelText(multBox, step.multAfter, 13, '#ffffff', '#7a1f19', textScale());
      }
      if (step.gold) {
        floatText(anchor, `+${step.gold} 金`, 'gold', layer);
        sfx.coin();
      }

      await timeline.wait(beat);
    }

    // 收尾三拍：先把乘式砸出来，再滚总分，最后让数字落地停一下
    banner.hidden = false;
    banner.textContent = `${result.chips} × ${result.mult}`;
    pulse(banner, 'slamIn', 380);
    sfx.mult(9);
    await timeline.wait(520);

    sfx.hu();
    haptic();
    shake($('#app'), Math.min(3, result.score / 900));
    await countUp(0, result.score, timeline.skipped ? 0 : 1000 / (timeline.speed || 1), (value) => {
      setPixelText($('#totalBox'), value, 14, '#f0c04a', '#3a2c06', textScale());
    });

    // 落地：总分弹一下、番种名压上来、金币飞进钱包
    banner.textContent = `${result.patterns.join(' · ')} ${result.score}`;
    pulse(banner, 'slamIn', 380);
    pulse($('#totalBox'), 'pulse', 320);
    floatText($('#totalBox'), `+${result.score}`, 'gold', layer);
    if (result.gold) {
      sfx.coin();
      floatText($('#goldV'), `+${result.gold} 金`, 'gold', layer);
    }
    await timeline.wait(950);
    return true;
  }

  /* ---------------- 局内覆盖屏 ---------------- */

  function scoreLines(result) {
    const list = el('div', 'lineList');
    for (const step of result.steps ?? []) {
      if (step.source === 'total') continue;
      const parts = [];
      if (step.chips) parts.push(`+${step.chips} 牌值`);
      if (step.mult) parts.push(`+${step.mult} 番势`);
      if (step.multFactor > 1) parts.push(`番势 ×${step.multFactor}`);
      if (step.gold) parts.push(`+${step.gold} 金`);
      if (!parts.length) continue;
      const line = el('div', 'lineItem');
      line.append(el('div', 'n', step.detail ? `${step.label} · ${step.detail}` : step.label));
      line.append(el('div', 'v', parts.join(' · ')));
      list.append(line);
    }
    return list;
  }

  function showHandResult() {
    const result = state.lastHandResult;
    if (!result) {
      showHandFailed();
      return;
    }
    const box = makeScreen();
    box.append(el('div', 'title sh', result.patterns.join(' · ')));
    box.append(el('div', 'subtitle',
      `${state.ante.name}·${state.blind.name} 第 ${result.handIndex + 1} 副 · 目标牌型 ${result.flavor?.name ?? ''}`));

    const calc = el('div', 'rowFlex');
    calc.style.justifyContent = 'center';
    calc.style.margin = '0 0 10px';
    calc.append(pixelText(result.chips, 14, '#59c4ff', '#0a3d63', 0, 2));
    calc.append(pixelText('×', 14, '#f2efe4', '#000', 0, 2));
    calc.append(pixelText(result.mult, 14, '#ff8b83', '#7a1f19', 0, 2));
    calc.append(pixelText('=', 14, '#f2efe4', '#000', 0, 2));
    calc.append(pixelText(result.score, 16, '#f0c04a', '#3a2c06', 0, 2));
    box.append(calc);
    box.append(scoreLines(result));

    const gold = el('div', 'lineItem');
    gold.style.marginTop = '8px';
    gold.append(el('div', 'n', `余下签缘 ${result.emptySlots} · 可兑换换牌 ${result.rewardableSwapsRemaining ?? result.swapsRemaining}${result.unusedSatchel?.length ? ` · 未用锦囊 ${result.unusedSatchel.length}` : ''}`));
    gold.append(el('div', 'v', `+${result.gold} 待结算金`));
    box.append(gold);

    const buttons = el('div', 'rowBtns');
    const next = el('button', 'btn green big',
      state.handNumber < state.handCount ? '下一副 NEXT' : '本关结算 CASH OUT');
    next.addEventListener('click', () => { closeScreen(); run.advance(); });
    buttons.append(next);
    box.append(buttons);
    next.focus();
  }

  function showHandFailed() {
    const box = makeScreen();
    box.append(el('div', 'title sh', '流局'));
    box.append(el('div', 'subtitle', '换牌用完还没成牌，本副 0 分；之前几副的分数与待结算金币保留'));
    const buttons = el('div', 'rowBtns');
    const next = el('button', 'btn play big',
      state.handNumber < state.handCount ? '下一副 NEXT' : '本关结算 CASH OUT');
    next.addEventListener('click', () => { closeScreen(); run.advance(); });
    buttons.append(next);
    box.append(buttons);
    next.focus();
  }

  function showRunOver() {
    const box = makeScreen();
    box.append(el('div', 'title sh', '本局结束'));
    box.append(el('div', 'subtitle', state.lastEvent?.text ?? ''));
    const list = el('div', 'lineList');
    const summary = el('div', 'lineItem');
    summary.append(el('div', 'n', `打到 ${state.ante.name}·${state.blind.name}`));
    summary.append(el('div', 'v', `累计 ${state.totalScore} 分 · 过关 ${state.clearedBlinds} 关`));
    list.append(summary);
    box.append(list);

    const buttons = el('div', 'rowBtns');
    const again = el('button', 'btn green big', '再来一局 NEW RUN');
    again.addEventListener('click', () => startRun({ deckId: settings.deckId }));
    const retry = el('button', 'btn grey', '重试本关（试玩）');
    retry.addEventListener('click', () => { closeScreen(); run.retryBlind(); });
    const title = el('button', 'btn grey', '返回标题');
    title.addEventListener('click', () => openTitle());
    buttons.append(again, retry, title);
    box.append(buttons);
    again.focus();
  }

  function showRunComplete() {
    const box = makeScreen();
    box.append(el('div', 'title sh', state.challengeActive ? '西圈制霸' : '短局通关'));
    box.append(el('div', 'subtitle',
      `${state.challengeActive ? '三圈加赛' : '东南两圈'}总分 ${state.totalScore} · 剩余 ${state.gold} 金`));
    const list = el('div', 'lineList');
    for (const blind of state.completedBlinds) {
      const line = el('div', 'lineItem');
      line.append(el('div', 'n', blind.name));
      line.append(el('div', 'v', `${blind.score} 分 · ${blind.banked} 金`));
      list.append(line);
    }
    box.append(list);
    const buttons = el('div', 'rowBtns');
    if (state.challengeAvailable) {
      const challenge = el('button', 'btn red big', '进入西圈加赛 CHALLENGE');
      challenge.addEventListener('click', () => { closeScreen(); run.continueChallenge(); });
      buttons.append(challenge);
    }
    const again = el('button', 'btn green big', '再来一局 PLAY AGAIN');
    again.addEventListener('click', () => startRun({ deckId: settings.deckId }));
    const title = el('button', 'btn grey', '返回标题');
    title.addEventListener('click', () => openTitle());
    buttons.append(again, title);
    box.append(buttons);
    buttons.querySelector('button')?.focus();
    adapter.submitScore?.(state.totalScore);
  }

  function showShop() {
    const box = makeScreen('shopScreen');
    const isGeneralDraft = state.shop?.kind === 'general-draft';
    box.append(el('div', 'title sh', isGeneralDraft ? '请将台 · 三选一' : '百宝阁'));
    box.append(el('div', 'subtitle',
      `${state.ante.name}·${state.blind.name}达标 · 现有 ${state.gold} 金${isGeneralDraft ? ` · 第 ${state.shop.stage} 阶福将，只能请一位` : ''}${state.pendingFreeBuy ? ' · 免单气可用' : ''}`));

    if (state.shop?.pending) {
      renderKindPicker(box, state.shop.pending);
      return;
    }

    const grid = el('div', 'shopGrid');
    grid.id = 'shopGrid';
    for (const offer of state.shop.items) {
      const item = getItem(offer.family, offer.id);
      const info = FAMILIES[offer.family] ?? { name: '牌帖', subtitle: '改牌组', duration: '本局' };
      const price = state.pendingFreeBuy > 0 ? 0 : offer.price;
      const affordable = !offer.sold && state.gold >= price;
      const card = cardNode(offer.family, item, {
        className: `shopCard${offer.sold ? ' sold' : affordable ? '' : ' cant'}`,
        meta: `${info.name} · ${item.duration ?? info.duration}`,
      });
      card.prepend(el('div', 'price', price === 0 ? '免费' : `${offer.price} 金`));
      card.append(el('div', 'famTag', isGeneralDraft ? `第 ${state.shop.stage} 阶 · 三选一` : (info.subtitle ?? '改牌组')));
      if (affordable) {
        card.addEventListener('click', () => {
          const result = run.buy(offer.slotIndex);
          if (!result.ok) toast(result.reason);
          else if (!result.needsKind) {
            sfx.coin();
            toast(`${item.name} 已购买`);
          }
        });
      }
      grid.append(card);
      attachCardMotion(card, { float: 2.8, hoverLift: 14, tilt: 10 });
    }
    box.append(grid);

    const buttons = el('div', 'rowBtns');
    const reroll = el('button', 'btn grey', `刷新 ${state.rerollCost} 金`);
    reroll.hidden = isGeneralDraft;
    reroll.disabled = isGeneralDraft || state.gold < state.rerollCost;
    reroll.addEventListener('click', () => {
      const result = run.rerollShop();
      if (!result.ok) toast(result.reason);
      else sfx.select();
    });
    const leave = el('button', 'btn green big', '下一关 NEXT');
    leave.addEventListener('click', () => { closeScreen(); run.leaveShop(); });
    buttons.append(reroll, leave);
    box.append(buttons);
    leave.focus();
  }

  function renderKindPicker(box, pending) {
    const item = getItem(pending.family, pending.id);
    const existing = pending.family === 'bone' ? state.bones : state.seals;
    box.append(el('div', 'subtitle', `${item.name} · 选择要改造的牌种（本局这个牌种的四张牌都会带上）`));

    const grid = el('div', '');
    grid.id = 'kindGrid';
    for (const kind of TILE_KINDS) {
      const [suit, rank] = kind.split(':');
      const node = el('button', `kindBtn${existing[kind] ? ' taken' : ''}`);
      node.type = 'button';
      node.title = kindName(kind);
      node.append(tileCanvas({ id: `pick-${kind}`, suit, rank: Number(rank) }, 1));
      node.addEventListener('click', () => {
        const replaced = existing[kind];
        if (replaced) {
          confirmReplace(kind, item, getItem(pending.family, replaced), pending);
          return;
        }
        const result = run.confirmKind(kind);
        if (result.ok) {
          sfx.coin();
          toast(`${item.name} → ${kindName(kind)}`);
        } else toast(result.reason);
      });
      grid.append(node);
    }
    box.append(grid);

    const buttons = el('div', 'rowBtns');
    const cancel = el('button', 'btn grey', '取消');
    cancel.addEventListener('click', () => run.cancelPending());
    buttons.append(cancel);
    box.append(buttons);
  }

  function confirmReplace(kind, item, old, pending) {
    const box = makeScreen();
    box.append(el('div', 'title sh', '覆盖旧改造'));
    box.append(el('div', 'subtitle', `${kindName(kind)} 上已经有 ${old.name}`));
    const list = el('div', 'lineList');
    for (const [label, value] of [[`原有 ${old.name}`, old.text], [`换成 ${item.name}`, item.text]]) {
      const line = el('div', 'lineItem');
      line.append(el('div', 'n', label));
      line.append(el('div', 'v', value));
      list.append(line);
    }
    box.append(list);
    const buttons = el('div', 'rowBtns');
    const confirm = el('button', 'btn red big', `确认覆盖（${pending.price} 金）`);
    confirm.addEventListener('click', () => {
      const result = run.confirmKind(kind);
      if (result.ok) {
        sfx.coin();
        toast(`${item.name} → ${kindName(kind)}`);
      } else toast(result.reason);
    });
    const back = el('button', 'btn grey', '返回');
    back.addEventListener('click', () => showShop());
    buttons.append(confirm, back);
    box.append(buttons);
  }

  /* ---------------- 外层界面 ---------------- */

  /** 标题页在没有 run 的时候也要能显示玩法，给一份默认数值。 */
  function previewState() {
    return {
      handCount: ANTES[0]?.handsPerBlind ?? 2,
      swapsPerHand: CONFIG.swapsPerHand,
      goldPerUnusedSwap: CONFIG.goldPerUnusedSwap,
      emptySlotChips: CONFIG.emptySlotChips,
      goldPerEmptySlot: CONFIG.goldPerEmptySlot,
    };
  }

  function openTitle() {
    lastScreenStatus = 'title';
    coverDraftForScreen();
    backdrop?.setTone('title');
    showTitle({
      deckId: settings.deckId,
      hasSave,
      onStart: () => startRun({ deckId: settings.deckId }),
      onContinue: () => resumeRun(),
      onDeck: () => openDeckSelect(),
      onSettings: () => openSettings(openTitle),
      onHelp: () => showHelp({ state: state ?? previewState(), onBack: openTitle }),
      onLibrary: () => showLibrary({ onBack: openTitle }),
    });
  }

  function openDeckSelect() {
    showDeckSelect({
      deckId: settings.deckId,
      onPick: (deckId) => {
        applySettings({ deckId });
        sfx.select();
        openDeckSelect();
      },
      onBack: openTitle,
    });
  }

  function openSettings(onBack) {
    showSettings({
      settings,
      seed: state?.seed ?? '—',
      onChange: (next) => {
        applySettings(next);
        sfx.select();
        openSettings(onBack);
      },
      onClearSave: async () => {
        await storage?.clear?.();
        hasSave = false;
        toast('存档已清除');
      },
      onBack,
    });
  }

  function openBlindSelect({ focusPrimary = false } = {}) {
    showBlindSelect({
      state,
      onSelect: () => { closeScreen(); sfx.reveal(); run.selectBlind(); },
      onSkip: () => {
        const result = run.skipBlind();
        if (result.ok) {
          sfx.coin();
          toast(`跳局 · 得到${getItem('tag', result.tagId).name}`);
        } else toast(result.reason);
        // 跳局前后都属于 blind-select，不能只靠 status 变化重建覆盖层。
        // 核心 emit 是同步的；此时 state 已指向下一关，立即替换旧的静态 DOM。
        openBlindSelect({ focusPrimary: true });
      },
      onTitle: () => openTitle(),
    });
    if (focusPrimary) {
      requestAnimationFrame(() => {
        const screen = $('#screen');
        if (!screen?.classList.contains('blindScreen')) return;
        screen.querySelector('.blindCard.current .blindActions .btn.green')
          ?.focus({ preventScroll: true });
      });
    }
  }

  /* ---------------- 状态驱动 ---------------- */

  const SCREEN_BY_STATUS = {
    'blind-select': () => openBlindSelect(),
    'hand-won': () => showHandResult(),
    'hand-failed': () => showHandFailed(),
    'run-over': () => showRunOver(),
    shop: () => showShop(),
    'run-complete': () => showRunComplete(),
  };

  function ensureScreen() {
    if (locked || settlementPending || $('#screen')) return;
    SCREEN_BY_STATUS[state.status]?.();
  }

  function syncScreens(previous) {
    if (state.status === lastScreenStatus) return;
    lastScreenStatus = state.status;
    const status = state.status;
    screenQueue = screenQueue.then(async () => {
      if (status !== state.status) return;
      if (status === 'hand-won') {
        try {
          if (state.lastHandResult?.steps?.length) await playSettlement(state.lastHandResult);
        } finally {
          settlementPending = false;
        }
        if (state.status === 'hand-won') showHandResult();
        return;
      }
      if (status === 'hand-failed' || status === 'run-over') sfx.bad();
      if (status === 'shop' || status === 'blind-select') sfx.coin();
      if (status === 'run-complete') sfx.hu();
      if (SCREEN_BY_STATUS[status]) {
        SCREEN_BY_STATUS[status]();
      } else {
        closeScreen();
        if (previous !== 'playing' && previous !== 'hu-ready' && previous !== 'charm-draft') {
          renderAll({ dealt: true });
        }
      }
    }).catch((error) => {
      console.error('[tianhu] 界面出错', error);
      locked = false;
      settlementPending = false;
      timeline.end();
      ensureScreen();
    });
  }

  /* ---------------- 输入 ---------------- */

  function doSwap() {
    if (locked || !run) return;
    const result = run.swapSelected();
    if (!result.ok) {
      toast(result.reason);
      return;
    }
    sfx.swap();
    haptic();
    if (result.sealHit) {
      toast(`${getItem('seal', result.sealHit).name}触发 · 返还 1 次换牌`);
      pulse($('#swapV'), 'pulse', 300);
    }
  }

  function doReveal() {
    if (locked || !run) return;
    const result = run.revealSelected();
    if (!result.ok) {
      toast(result.reason);
      return;
    }
    sfx.reveal();
    haptic();
    pulse($('#fortuneMeter'), 'slamDown', 320);
    if (result.sealHit) toast(`${getItem('seal', result.sealHit).name}触发 · 可以重抽三签`);
  }

  function doHu() {
    if (locked || !state?.canHu) return;
    run.declareHu();
  }

  function wireInput() {
    $('#btnSwap').addEventListener('click', doSwap);
    $('#btnReveal').addEventListener('click', doReveal);
    $('#btnHu').addEventListener('click', doHu);
    $('#btnHelp').addEventListener('click', () => showHelp({
      state: state ?? previewState(),
      onBack: () => { closeScreen(); ensureScreen(); },
    }));
    $('#btnLibrary').addEventListener('click', () => showLibrary({
      onBack: () => { closeScreen(); ensureScreen(); },
    }));
    $('#btnRestart').addEventListener('click', () => openTitle());
    $('#omenSlot').addEventListener('click', () => {
      const omen = state?.pendingOmen;
      const charm = omen ? getItem('charm', omen.sourceCharmId) : null;
      toast(charm
        ? `${charm.name} · ${charm.text}`
        : '待缘位为空 · 选择延时奇缘后会留在这里', charm ? 4200 : 2100);
    });
    $('#passiveSummary').addEventListener('click', showPassiveSheet);
    $('#btnReroll').addEventListener('click', () => {
      const result = run.rerollDraft();
      if (result.ok) sfx.charm();
      else toast(result.reason);
    });

    document.addEventListener('pointerdown', () => timeline.skip(), { capture: true });

    // 兜底：setPointerCapture 失败时 pointerup 不会落在那张牌上，
    // 没有这一条 dragging 会永远挂着，之后再也拖不动。
    // 必须走冒泡阶段——捕获阶段会抢在牌自己的 pointerup 之前，把正常的落点吃掉。
    for (const type of ['pointerup', 'pointercancel']) {
      addEventListener(type, () => { if (dragging) endDrag({ commit: false }); });
    }
    addEventListener('blur', () => { if (dragging) endDrag({ commit: false }); });

    document.addEventListener('keydown', (event) => {
      // 明细弹层开着的时候独占键盘，否则 Esc 会顺手把手牌选择也清了
      if ($('#sheet')) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeSheet();
        }
        return;
      }
      const screen = $('#screen');
      if (screen) {
        // 标题 / 帮助等外层屏幕覆盖求签时，禁止数字键和隐藏签卡的默认 Enter 激活。
        if ((state?.draft || state?.activeChoice)
          && !screen.contains(event.target)
          && ['1', '2', '3', '4', 'Escape', 'Enter', ' '].includes(event.key)) {
          event.preventDefault();
        }
        return;
      }
      if (timeline.running && (event.key === ' ' || event.key === 'Enter')) {
        timeline.skip();
        return;
      }
      if (state?.activeChoice) {
        if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          if (state.activeChoice.mode === 'target' || state.activeChoice.mode === 'preview') run.backSatchelChoice();
          else run.cancelSatchelUse();
          return;
        }
        if (['1', '2', '3', '4'].includes(event.key)) {
          event.preventDefault();
          const index = Number(event.key) - 1;
          [...document.querySelectorAll('#draftCards .fateOption:not(:disabled), #draftActions .btn')][index]?.click();
        }
        return;
      }
      if (state?.draft) {
        if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
        const replacement = state.draft.pendingOmenReplacement
          ?? state.draft.replacement
          ?? state.draft.pendingReplacement
          ?? null;
        const satchelReplacement = state.draft.pendingSatchelReplacement ?? null;
        const fate = state.draft.pendingFateChoice ?? null;
        if (event.key === 'Escape') {
          event.preventDefault();
          if (satchelReplacement) {
            run.cancelSatchelReplacement();
          } else if (replacement) {
            run.cancelPendingOmenReplacement?.() ?? run.cancelOmenReplacement?.();
          } else if (fate?.selectedTileId) {
            run.backFateTile();
          } else if (fate) {
            run.cancelFateChoice();
          }
          return;
        }
        if (['1', '2', '3', '4'].includes(event.key)) {
          event.preventDefault();
          const index = Number(event.key) - 1;
          const card = fate
            ? [...document.querySelectorAll('#draftCards .fateOption:not(:disabled)')][index]
            : [...document.querySelectorAll('#draftCards .charmPick')][index];
          card?.click();
        }
        return;
      }
      const key = event.key.toLowerCase();
      if (event.key === 'Enter') doSwap();
      else if (key === 'r') doReveal();
      else if (key === 'h') doHu();
      else if (event.key === 'Escape') run?.clearSelection();
    });

    let resizeTimer = null;
    const relayout = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (refreshScale()) renderAll();
      }, 80);
    };
    addEventListener('resize', relayout);
    addEventListener('orientationchange', relayout);
    if (globalThis.ResizeObserver) new ResizeObserver(relayout).observe($('#main'));
  }

  /* ---------------- 启动 ---------------- */

  function attach(nextRun, { silent = false } = {}) {
    unsubscribe?.();
    run = nextRun;
    state = run.snapshot();
    // silent：只把牌桌画出来当标题页的背景，不弹任何覆盖屏
    lastScreenStatus = silent ? state.status : null;
    unsubscribe = run.subscribe((next) => {
      const previous = state?.status;
      // renderAll 会调 ensureScreen，所以闸门必须在渲染之前就立起来
      if (next.status === 'hand-won' && previous !== 'hand-won' && next.lastHandResult?.steps?.length) {
        settlementPending = true;
      } else if (next.status !== 'hand-won') {
        settlementPending = false;
      }
      state = next;
      renderAll();
      syncBackdropTone();
      syncScreens(previous);
    });
    onRunAttached?.(run, { silent });
    refreshScale();
    if (silent) {
      renderSide();
      renderSlots();
      renderTable();
      renderHand({ dealt: true });
      renderActions();
      renderDraft();
    } else {
      renderAll({ dealt: true });
      syncScreens(null);
    }
    return run;
  }

  function startRun({ seed, deckId } = {}) {
    closeScreen();
    hasSave = true;
    return attach(createRun({ seed, deckId: deckId ?? settings.deckId }));
  }

  function resumeRun() {
    closeScreen();
    if (!run) return startRun({});
    lastScreenStatus = null;
    state = run.snapshot();
    renderAll();
    syncScreens(null);
    ensureScreen();
    return run;
  }

  function mount({ initialRun = null, savedRun = false, autoStart = false } = {}) {
    backdrop = createBackdrop($('#backdrop'));
    applySettings(settings);
    wireInput();
    hasSave = savedRun;
    if (initialRun) attach(initialRun, { silent: !autoStart });
    adapter.signalFirstFrame?.();
    if (!autoStart) openTitle();
    adapter.signalReady?.();
  }

  return {
    mount,
    startRun,
    attach,
    openTitle,
    get run() { return run; },
    get state() { return state; },
    get settings() { return settings; },
  };
}
