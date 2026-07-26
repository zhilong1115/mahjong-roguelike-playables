/**
 * 界面层：把 Run 的快照画出来，并在结算时按 scoring steps 播放爆分动画。
 * 这里不产生任何规则结果，只表演。
 */

import { ANTES, CODEX_BY_PATTERN, CONFIG, FAMILIES, getItem } from '../content/index.mjs';
import { GROUP_NAMES } from '../core/patterns.mjs';
import { TILE_KINDS, kindName, tileKey, tileName } from '../core/tiles.mjs';
import {
  createSealCanvas,
  createTileBackCanvas,
  createTileCanvas,
  pixelText,
  setPixelText,
} from '../render/pixel.mjs';
import { Timeline, countUp, floatText, pulse, shake } from './animate.mjs';
import { setAudioEnabled, sfx } from './audio.mjs';
import {
  closeScreen,
  makeScreen,
  showBlindSelect,
  showDeckSelect,
  showHelp,
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

const ROLE_LABEL = { group: '本组签', pattern: '牌型签', wild: '奇签' };
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
  const timeline = new Timeline();

  /* ---------------- 基础工具 ---------------- */

  function applySettings(next) {
    settings = { ...settings, ...next };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch { /* 隐私模式下忽略 */ }
    setAudioEnabled(settings.sound);
    timeline.speed = settings.animationSpeed === 0 ? Infinity : settings.animationSpeed;
  }

  function toast(message) {
    const node = el('div', 'toastItem', message);
    $('#toast').append(node);
    setTimeout(() => node.remove(), 2100);
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

  function cardNode(family, item, { className = '', meta = '', showText = true } = {}) {
    const info = FAMILIES[family] ?? {
      name: family === 'paper' ? '牌帖' : family,
      subtitle: '改牌组',
      duration: item.duration ?? '本局',
      glyph: item.glyph,
    };
    const node = el('div', `card family-${family} ${className}`.trim());
    node.dataset.card = `${family}:${item.id}`;
    node.append(createSealCanvas(item.glyph ?? info.glyph, { family, scale: 1 }));
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
    const fit = Math.min(3, widthBudget / 34, heightBudget / 46);
    const canvas = Math.max(1, Math.min(3, Math.floor(fit)));
    const display = Math.max(canvas, Math.min(fit, canvas * 1.55));
    if (canvas === tileScale && Math.abs(display - tileDisplay) < 0.02) return false;
    tileScale = canvas;
    tileDisplay = display;
    return true;
  }

  function tileFace(tile) {
    const face = createTileCanvas(tile, tileScale);
    face.style.width = `${Math.round(34 * tileDisplay)}px`;
    face.style.height = `${Math.round(46 * tileDisplay)}px`;
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
    $('#swapLabel').textContent = `换牌 ·剩余×${state.goldPerUnusedSwap}金`;
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
    $('#slotLabel').textContent = `空位 ${state.emptySlots} SLOTS`;

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

  function renderBuildBar() {
    const bar = $('#buildBar');
    bar.replaceChildren();

    for (let index = 0; index < state.generalSlots; index += 1) {
      const generalId = state.generalIds[index];
      if (!generalId) {
        bar.append(el('div', 'buildSlot'));
        continue;
      }
      bar.append(cardNode('general', getItem('general', generalId), {
        className: 'buildCard', meta: `将位 ${index + 1}`, showText: false,
      }));
    }
    for (const [pattern, level] of Object.entries(state.codexLevels)) {
      const book = CODEX_BY_PATTERN[pattern];
      if (!book || !level) continue;
      bar.append(cardNode('codex', book, { className: 'buildCard', meta: `Lv.${level}`, showText: false }));
    }
    for (const [kind, boneId] of Object.entries(state.bones)) {
      const node = cardNode('bone', getItem('bone', boneId), {
        className: 'buildCard', meta: kindName(kind), showText: false,
      });
      node.dataset.kind = kind;
      bar.append(node);
    }
    for (const [kind, sealId] of Object.entries(state.seals)) {
      const node = cardNode('seal', getItem('seal', sealId), {
        className: 'buildCard', meta: kindName(kind), showText: false,
      });
      node.dataset.kind = kind;
      bar.append(node);
    }
    for (const paperId of state.papers) {
      bar.append(cardNode('paper', getItem('paper', paperId), { className: 'buildCard', showText: false }));
    }
  }

  function renderSlots() {
    const bar = $('#slotBar');
    bar.replaceChildren();
    for (let index = 0; index < state.slotCount; index += 1) {
      const group = state.revealedGroups[index];
      const slot = el('div', 'slot');
      slot.dataset.slot = String(index);
      if (group) {
        slot.classList.add('filled');
        const tiles = el('div', 'groupTiles');
        for (const tile of group.tiles) tiles.append(createTileCanvas(tile, 1));
        slot.append(tiles);
        const charm = group.charmId ? getItem('charm', group.charmId) : null;
        slot.append(el('div', 'charmName', charm ? charm.name : GROUP_NAMES[group.kind]));
        if (charm) {
          slot.dataset.card = `charm:${charm.id}`;
          bindTip(slot, `${charm.name} · ${GROUP_NAMES[group.kind]}`, `${charm.text}（本副）`);
        }
      } else {
        slot.append(el('div', 'slotGold', `+${state.goldPerEmptySlot}金`));
        slot.append(el('div', 'slotIdx', `开运位 ${index + 1}`));
        bindTip(slot, '空开运位',
          `留空：胡牌时 +${state.emptySlotChips} 牌值和 +${state.goldPerEmptySlot} 金；花掉：换一次三签选一。`);
      }
      bar.append(slot);
    }
  }

  function meldNode(group, scale = Math.max(1, tileScale - 1)) {
    const meld = el('div', `meld${group.revealed ? '' : ' concealed'}`);
    meld.dataset.groupId = group.id;
    for (const tile of group.tiles) {
      const wrap = el('span', 'meldTile');
      wrap.dataset.kind = tileKey(tile);
      wrap.append(createTileCanvas(tile, scale));
      meld.append(wrap);
    }
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
        wrap.append(createTileCanvas(tile, Math.max(1, tileScale - 1)));
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
      const marks = [];
      if (state.bones[kind]) marks.push(getItem('bone', state.bones[kind])?.name);
      if (state.seals[kind]) marks.push(getItem('seal', state.seals[kind])?.name);
      if (marks.length) bindTip(node, tileName(tile), `${marks.join(' · ')}（本局，这个牌种的四张牌都有）`);
      node.addEventListener('click', () => {
        if (locked) return;
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
    huButton.disabled = !state.canHu || locked;
    huButton.classList.toggle('ready', state.canHu && !locked);

    let hint;
    if (!count) {
      hint = state.canHu
        ? '现在就能胡：直接结算，或继续亮组换三签选一。'
        : `还差 ${state.distance} 张成牌。换牌可以一次换多张，没用完的每次换 ${state.goldPerUnusedSwap} 金。`;
    } else if (state.revealPreview.valid) {
      hint = state.revealPreview.text;
    } else {
      hint = state.swapPreview.text;
    }
    $('#actionHint').textContent = hint;
  }

  function renderDraft() {
    const layer = $('#draftLayer');
    const cards = $('#draftCards');
    const reroll = $('#btnReroll');
    if (!state.draft) {
      layer.hidden = true;
      cards.replaceChildren();
      reroll.hidden = true;
      return;
    }
    layer.hidden = false;
    cards.replaceChildren();
    state.draft.charmIds.forEach((charmId, index) => {
      const charm = getItem('charm', charmId);
      const node = cardNode('charm', charm, { className: 'charmPick' });
      node.setAttribute('role', 'button');
      node.tabIndex = 0;
      node.prepend(el('div', 'cRole', ROLE_LABEL[charm.role] ?? ''));
      const choose = () => {
        if (locked) return;
        sfx.charm();
        haptic();
        const result = run.chooseCharm(charmId);
        if (result.ok && result.goldNow) {
          sfx.coin();
          toast(`${charm.name} · +${result.goldNow} 待结算金`);
        }
      };
      node.addEventListener('click', choose);
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          choose();
        }
      });
      node.style.animationDelay = `${index * 60}ms`;
      node.classList.add('dealIn');
      cards.append(node);
    });
    reroll.hidden = state.draft.rerollsLeft <= 0;
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

  function findStepTarget(step) {
    const target = step.target ?? {};
    if (target.type === 'group') return $(`#revealZone .meld[data-group-id="${target.groupId}"]`);
    if (target.type === 'kind') {
      return $(`#revealZone .meldTile[data-kind="${target.kind}"]`) ?? $(`#buildBar [data-kind="${target.kind}"]`);
    }
    if (target.type === 'card') {
      return $(`#slotBar [data-card="${target.family}:${target.id}"]`)
        ?? $(`#buildBar [data-card="${target.family}:${target.id}"]`);
    }
    if (target.type === 'pattern') return $('#patternBanner');
    if (target.id === 'slots') return $('#slotV');
    if (target.id === 'swaps') return $('#swapV');
    if (target.id === 'total') return $('#totalBox');
    return $('#chipsBox');
  }

  async function playSettlement(result) {
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
      const anchor = findStepTarget(step);

      if (step.source === 'pattern') {
        banner.hidden = false;
        banner.textContent = step.label;
        pulse(banner, 'slamIn', 380);
        if (step.mult) sfx.mult(multIndex++);
      } else if (anchor) {
        const animation = step.source === 'group' ? 'popScore'
          : step.source === 'bone' ? 'glowBone'
            : step.source === 'seal' ? 'glowSeal' : 'jiggle';
        pulse(anchor, animation, 400);
      }

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
      if (step.gold) {
        floatText(anchor, `+${step.gold} 金`, 'gold', layer);
        sfx.coin();
      }

      await timeline.wait(step.source === 'pattern' ? 260 : 190);
    }

    banner.hidden = false;
    banner.textContent = `${result.chips} × ${result.mult}`;
    pulse(banner, 'slamIn', 380);
    sfx.hu();
    haptic();
    shake($('#app'), Math.min(3, result.score / 900));
    await countUp(0, result.score, timeline.skipped ? 0 : 620 / (timeline.speed || 1), (value) => {
      setPixelText($('#totalBox'), value, 14, '#f0c04a', '#3a2c06', textScale());
    });
    floatText($('#totalBox'), `+${result.score}`, 'gold', layer);
    if (result.gold) {
      sfx.coin();
      floatText($('#goldV'), `+${result.gold} 金`, 'gold', layer);
    }
    await timeline.wait(420);
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
    gold.append(el('div', 'n', `空开运位 ${result.emptySlots} · 余下换牌 ${result.swapsRemaining}`));
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
    box.append(el('div', 'title sh', '通关'));
    box.append(el('div', 'subtitle', `三圈总分 ${state.totalScore} · 剩余 ${state.gold} 金`));
    const list = el('div', 'lineList');
    for (const blind of state.completedBlinds) {
      const line = el('div', 'lineItem');
      line.append(el('div', 'n', blind.name));
      line.append(el('div', 'v', `${blind.score} 分 · ${blind.banked} 金`));
      list.append(line);
    }
    box.append(list);
    const buttons = el('div', 'rowBtns');
    const again = el('button', 'btn green big', '再来一局 PLAY AGAIN');
    again.addEventListener('click', () => startRun({ deckId: settings.deckId }));
    const title = el('button', 'btn grey', '返回标题');
    title.addEventListener('click', () => openTitle());
    buttons.append(again, title);
    box.append(buttons);
    again.focus();
    adapter.submitScore?.(state.totalScore);
  }

  function showShop() {
    const box = makeScreen();
    box.append(el('div', 'title sh', '百宝阁'));
    box.append(el('div', 'subtitle',
      `${state.ante.name}·${state.blind.name}达标 · 现有 ${state.gold} 金${state.pendingFreeBuy ? ' · 免单气可用' : ''}`));

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
      card.append(el('div', 'famTag', info.subtitle ?? '改牌组'));
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
    }
    box.append(grid);

    const buttons = el('div', 'rowBtns');
    const reroll = el('button', 'btn grey', `刷新 ${state.rerollCost} 金`);
    reroll.disabled = state.gold < state.rerollCost;
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
      node.append(createTileCanvas({ id: `pick-${kind}`, suit, rank: Number(rank) }, 1));
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
    showTitle({
      deckId: settings.deckId,
      hasSave,
      onStart: () => startRun({ deckId: settings.deckId }),
      onContinue: () => resumeRun(),
      onDeck: () => openDeckSelect(),
      onSettings: () => openSettings(openTitle),
      onHelp: () => showHelp({ state: state ?? previewState(), onBack: openTitle }),
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

  function openBlindSelect() {
    showBlindSelect({
      state,
      onSelect: () => { closeScreen(); sfx.reveal(); run.selectBlind(); },
      onSkip: () => {
        const result = run.skipBlind();
        if (result.ok) {
          sfx.coin();
          toast(`跳局 · 得到${getItem('tag', result.tagId).name}`);
        } else toast(result.reason);
      },
      onTitle: () => openTitle(),
    });
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
    if (locked || $('#screen')) return;
    SCREEN_BY_STATUS[state.status]?.();
  }

  function syncScreens(previous) {
    if (state.status === lastScreenStatus) return;
    lastScreenStatus = state.status;
    const status = state.status;
    screenQueue = screenQueue.then(async () => {
      if (status !== state.status) return;
      if (status === 'hand-won') {
        if (state.lastHandResult?.steps?.length) await playSettlement(state.lastHandResult);
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
    pulse($(`#slotBar .slot[data-slot="${state.slotsUsed - 1}"]`), 'slamDown', 320);
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
    $('#btnRestart').addEventListener('click', () => openTitle());
    $('#btnReroll').addEventListener('click', () => {
      const result = run.rerollDraft();
      if (result.ok) sfx.charm();
      else toast(result.reason);
    });

    document.addEventListener('pointerdown', () => timeline.skip(), { capture: true });

    document.addEventListener('keydown', (event) => {
      if (timeline.running && (event.key === ' ' || event.key === 'Enter')) {
        timeline.skip();
        return;
      }
      if (state?.draft && ['1', '2', '3'].includes(event.key)) {
        const charmId = state.draft.charmIds[Number(event.key) - 1];
        if (charmId) {
          sfx.charm();
          run.chooseCharm(charmId);
        }
        return;
      }
      if ($('#screen')) return;
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
      state = next;
      renderAll();
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
