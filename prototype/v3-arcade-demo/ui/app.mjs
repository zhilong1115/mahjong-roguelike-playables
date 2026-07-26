import { CHARMS, DEMO_CONFIG, GENERALS, SCORING } from '../content/content.mjs';
import { ArcadeGame } from '../core/game.mjs';
import { tilesToChange } from '../core/rules.mjs';
import { tileName } from '../core/tiles.mjs';
import { createTileCanvas, createSealCanvas, pixelText, setPixelText } from '../render/pixel-art.mjs';
import { createWebAdapter } from '../platforms/web-adapter.mjs';

const $ = (selector) => document.querySelector(selector);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const GROUP_LABEL = { pair: '对子', chow: '顺子', pung: '刻子', kong: '杠' };
const TAG_LABEL = { group: '本组签', pattern: '牌型签', wild: '奇签' };

const urlSeed = Number.parseInt(new URLSearchParams(window.location.search).get('seed') ?? '', 10);
const game = new ArcadeGame(Number.isFinite(urlSeed) ? { seed: urlSeed } : {});
const adapter = createWebAdapter();
let state = game.snapshot();
let tileScale = 2;
let tileDisplay = 2;

/* ---------- 音效 ---------- */
let audio = null;
function beep(frequency, duration = 0.06, type = 'square', volume = 0.05) {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.value = volume;
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
    oscillator.stop(audio.currentTime + duration + 0.02);
  } catch {
    /* 静音环境直接忽略 */
  }
}
const sfx = {
  select: () => beep(720, 0.04),
  swap: () => beep(430, 0.07),
  reveal: () => { beep(560, 0.07); setTimeout(() => beep(760, 0.09), 70); },
  charm: () => { beep(880, 0.06); setTimeout(() => beep(1180, 0.09), 60); },
  hu: () => { beep(523, 0.1); setTimeout(() => beep(659, 0.1), 90); setTimeout(() => beep(784, 0.2), 180); },
  coin: () => { beep(1046, 0.05); setTimeout(() => beep(1318, 0.07), 45); },
  bad: () => { beep(180, 0.18, 'sawtooth', 0.05); setTimeout(() => beep(120, 0.3, 'sawtooth', 0.05), 140); },
};

/* ---------- 小工具 ---------- */
function toast(message) {
  const node = el('div', 'toastItem', message);
  $('#toast').appendChild(node);
  setTimeout(() => node.remove(), 2100);
}

function bindTip(node, title, body) {
  const tip = $('#tip');
  const show = (event) => {
    tip.innerHTML = '';
    tip.appendChild(el('div', 'tn', title));
    tip.appendChild(el('div', 'td', body));
    tip.style.display = 'block';
    const point = event.touches?.[0] ?? event;
    const rect = tip.getBoundingClientRect();
    const x = Math.min(point.clientX + 12, window.innerWidth - rect.width - 8);
    const y = Math.max(8, Math.min(point.clientY - rect.height - 10, window.innerHeight - rect.height - 8));
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  node.addEventListener('mouseenter', show);
  node.addEventListener('mousemove', show);
  node.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
}

function floatText(target, text, color) {
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const node = el('div', 'float', text);
  node.style.color = color;
  node.style.left = `${rect.left + rect.width / 2}px`;
  node.style.top = `${rect.top}px`;
  node.style.position = 'fixed';
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 950);
}

/* ---------- 尺寸 ---------- */
/** 与 styles.css 的竖屏断点保持一致：竖屏手牌排成 7 + 7 两行。 */
function isPortraitLayout() {
  return window.matchMedia('(max-aspect-ratio:0.95)').matches;
}

function computeTileScale() {
  const main = $('#main');
  const width = main.clientWidth || document.documentElement.clientWidth || 844;
  const height = main.clientHeight || document.documentElement.clientHeight || 390;
  const portrait = isPortraitLayout();
  const perRow = portrait ? 7 : 14;
  const rows = portrait ? 2 : 1;
  const widthBudget = (width - 8) / perRow - 3;
  const heightBudget = (height * (portrait ? 0.42 : 0.34)) / rows;
  const fit = Math.min(3, widthBudget / 34, heightBudget / 46);
  // 画布用整数倍保持像素锐利；剩下的零头用 CSS 拉伸，避免小屏上牌面太小。
  const canvas = Math.max(1, Math.min(3, Math.floor(fit)));
  const display = Math.max(canvas, Math.min(fit, canvas * 1.55));
  return { canvas, display };
}

function refreshScale() {
  const next = computeTileScale();
  if (next.canvas === tileScale && Math.abs(next.display - tileDisplay) < 0.02) return false;
  tileScale = next.canvas;
  tileDisplay = next.display;
  return true;
}

/* ---------- 渲染 ---------- */
/** 矮屏时像素数字只放大 1 倍，避免侧栏被数字撑高。 */
function textScale() {
  return window.innerHeight <= 470 ? 1 : 2;
}

function renderSide() {
  const scale = textScale();
  $('#roundChip').textContent = state.round.label;
  $('#roundName').textContent = state.round.name;
  $('#roundMeta').textContent = `第 ${state.handNumber} 副 / 共 ${state.handCount} 副 · 第 ${state.roundNumber}/${state.roundCount} 轮`;
  $('#flavorHint').textContent = state.flavor ? `目标牌型：${state.flavor.name} · ${state.flavor.hint}` : '';

  setPixelText($('#targetVal'), `${state.roundScore} / ${state.target}`, 12, '#f2efe4', '#000', scale);
  $('#targetFill').style.width = `${Math.min(100, (state.roundScore / state.target) * 100)}%`;
  $('#pendingLine').textContent = `待结算 ${state.pendingGold} 金 · 三副过关才入账`;

  const preview = state.preview;
  $('#handName').textContent = preview ? preview.patterns.join(' · ') : '尚未成牌';
  setPixelText($('#chipsBox'), preview ? preview.chips : 0, 13, '#ffffff', '#0a3d63', scale);
  setPixelText($('#multBox'), preview ? preview.mult : 1, 13, '#ffffff', '#7a1f19', scale);
  setPixelText($('#totalBox'), preview ? preview.total : 0, 14, '#f0c04a', '#3a2c06', scale);

  setPixelText($('#swapV'), state.swapsRemaining, 11, '#59c4ff', '#000', scale);
  const distance = Number.isFinite(state.distance) ? state.distance : '—';
  setPixelText($('#distV'), state.canHu ? '可胡' : distance, 11, state.canHu ? '#3fae74' : '#ff8b83', '#000', scale);
  setPixelText($('#goldV'), state.gold, 11, '#f0c04a', '#000', scale);
  setPixelText($('#slotV'), `${state.projectedGold}金`, 11, '#f0c04a', '#000', scale);
  $('#slotLabel').textContent = `空位 ${state.emptySlots} SLOTS`;

  const bar = $('#generalBar');
  bar.innerHTML = '';
  for (let index = 0; index < state.generalSlots; index += 1) {
    const generalId = state.generalIds[index];
    if (!generalId) {
      bar.appendChild(el('div', 'genSlot'));
      continue;
    }
    const general = GENERALS[generalId];
    const card = el('div', 'genCard');
    card.appendChild(createSealCanvas(general.glyph, { paper: '#cfe0ef', ink: '#23405e', scale: 1 }));
    card.appendChild(el('div', 'gn', general.name));
    bindTip(card, general.name, general.description);
    bar.appendChild(card);
  }
}

function renderSlots() {
  const bar = $('#slotBar');
  bar.innerHTML = '';
  for (let index = 0; index < state.slotCount; index += 1) {
    const group = state.revealedGroups[index];
    const slot = el('div', 'slot');
    if (group) {
      slot.classList.add('filled');
      const tiles = el('div', 'groupTiles');
      for (const tile of group.tiles) tiles.appendChild(createTileCanvas(tile, 1));
      slot.appendChild(tiles);
      const charm = group.charmId ? CHARMS[group.charmId] : null;
      slot.appendChild(el('div', 'charmName', charm ? charm.name : GROUP_LABEL[group.kind]));
      if (charm) bindTip(slot, `${charm.name} · ${GROUP_LABEL[group.kind]}`, charm.description);
      if (index === state.revealedGroups.length - 1 && state.lastEvent?.type === 'charm') {
        slot.classList.add('just');
      }
    } else {
      slot.appendChild(el('div', 'slotGold', `+${DEMO_CONFIG.goldPerEmptySlot}金`));
      slot.appendChild(el('div', 'slotIdx', `开运位 ${index + 1}`));
      bindTip(slot, '空开运位', `保持空着，胡牌时兑换 ${DEMO_CONFIG.goldPerEmptySlot} 金；亮一组则换成一次三签选一。`);
    }
    bar.appendChild(slot);
  }
}

function renderTable() {
  const zone = $('#revealZone');
  zone.innerHTML = '';
  const meldScale = Math.max(1, tileScale - 1);
  state.revealedGroups.forEach((group, index) => {
    const meld = el('div', 'meld');
    for (const tile of group.tiles) meld.appendChild(createTileCanvas(tile, meldScale));
    if (index === state.revealedGroups.length - 1 && state.lastEvent?.type === 'reveal') {
      meld.classList.add('enter');
    }
    zone.appendChild(meld);
  });

  const nextBox = $('#nextTile');
  nextBox.innerHTML = '';
  if (state.upcomingTiles.length) {
    state.upcomingTiles.forEach((tile, index) => {
      const wrap = el('div', index === 0 ? 'nextFirst' : 'nextSecond');
      wrap.appendChild(createTileCanvas(tile, index === 0 ? Math.max(1, tileScale - 1) : 1));
      nextBox.appendChild(wrap);
    });
    bindTip($('#nextBox'), '牌墙预览',
      `下一次换牌摸到 ${tileName(state.upcomingTiles[0])}${
        state.upcomingTiles[1] ? `，再下一张是 ${tileName(state.upcomingTiles[1])}` : ''}。`);
  } else {
    nextBox.appendChild(el('div', 'lbl', '空'));
  }
  $('#wallCount').textContent = `牌墙 ${state.wallCount}`;
}

function renderHand() {
  const zone = $('#handZone');
  zone.innerHTML = '';
  for (const tile of state.looseTiles) {
    const button = el('button', 'tile');
    button.type = 'button';
    button.dataset.tileId = tile.id;
    button.setAttribute('aria-label', tileName(tile));
    const face = createTileCanvas(tile, tileScale);
    face.style.width = `${Math.round(34 * tileDisplay)}px`;
    face.style.height = `${Math.round(46 * tileDisplay)}px`;
    button.appendChild(face);
    if (state.selectedIds.includes(tile.id)) button.classList.add('sel');
    button.addEventListener('click', () => {
      sfx.select();
      game.toggleTile(tile.id);
    });
    zone.appendChild(button);
  }
}

function renderActions() {
  const actButton = $('#btnAct');
  const huButton = $('#btnHu');
  const preview = state.selectionPreview;
  const count = state.selectedIds.length;

  let label = '选牌';
  if (count === 1) label = '换这张';
  else if (count >= 2) label = preview.valid ? `亮${GROUP_LABEL[preview.kind] ?? '组'}开运` : '不能亮';
  actButton.textContent = label;
  actButton.disabled = !preview.valid || !state.canAct;
  actButton.className = `btn ${count >= 2 ? 'green' : 'play'}`;

  huButton.disabled = !state.canHu;
  huButton.classList.toggle('ready', state.canHu);

  let hint;
  if (count === 0) {
    hint = state.canHu
      ? '现在就能胡：直接结算拿金币，或继续亮组换三签选一。'
      : `点 1 张换牌，点 2–4 张亮组开运。还差 ${state.distance} 张成牌。`;
  } else {
    hint = preview.text;
  }
  $('#actionHint').textContent = hint;
}

function renderDraft() {
  const layer = $('#draftLayer');
  const cards = $('#draftCards');
  if (!state.pendingDraft) {
    layer.hidden = true;
    cards.innerHTML = '';
    return;
  }
  layer.hidden = false;
  cards.innerHTML = '';
  state.pendingDraft.charmIds.forEach((charmId) => {
    const charm = CHARMS[charmId];
    const card = el('button', `charmCard tag-${charm.tag}`);
    card.type = 'button';
    card.appendChild(createSealCanvas(charm.glyph, { scale: 2 }));
    card.appendChild(el('div', 'cn', charm.name));
    card.appendChild(el('div', 'role', TAG_LABEL[charm.tag]));
    card.appendChild(el('div', 'cd', charm.description));
    card.addEventListener('click', () => {
      sfx.charm();
      const result = game.chooseCharm(charmId);
      if (result.ok && result.goldNow) {
        sfx.coin();
        toast(`${charm.name} · +${result.goldNow} 待结算金`);
      }
    });
    cards.appendChild(card);
  });
}

function renderAll() {
  state = { ...state, canAct: state.status === 'playing' || state.status === 'hu-ready' };
  renderSide();
  renderSlots();
  renderTable();
  renderHand();
  renderActions();
  renderDraft();
}

/* ---------- 覆盖屏 ---------- */
function closeScreen() {
  $('#screen')?.remove();
}

function makeScreen() {
  closeScreen();
  const screen = el('div', 'screen');
  screen.id = 'screen';
  const box = el('div', 'screenBox');
  screen.appendChild(box);
  document.body.appendChild(screen);
  return box;
}

function scoreLines(scoring) {
  const list = el('div', 'lineList');
  const add = (name, value, bad = false) => {
    const line = el('div', `lineItem${bad ? ' bad' : ''}`);
    line.appendChild(el('div', 'n', name));
    line.appendChild(el('div', 'v', value));
    list.appendChild(line);
  };
  add('胡牌底分', `+${scoring.huBase} 牌值`);
  add('组合底分', `+${scoring.groupChips} 牌值`);
  for (const event of scoring.events) {
    if (!event.chips && !event.mult && !event.gold) continue;
    const parts = [];
    if (event.chips) parts.push(`+${event.chips} 牌值`);
    if (event.mult) parts.push(`+${event.mult} 番势`);
    if (event.gold) parts.push(`+${event.gold} 金`);
    const prefix = { charm: '灵签', general: '福将', slots: '' }[event.source] ?? '';
    add(`${prefix} ${event.name}`.trim(), parts.join(' · '));
  }
  add('番种', `${scoring.patterns.join(' · ')} → 番势 ${scoring.mult}`);
  return list;
}

function showHandResult() {
  const result = state.lastHandResult;
  const box = makeScreen();
  box.appendChild(el('div', 'title sh', result.scoring.patterns.join(' · ')));
  box.appendChild(el('div', 'subtitle', `第 ${result.handIndex + 1} 副 · 目标牌型 ${result.flavor.name}`));

  const calc = el('div', 'rowFlex');
  calc.style.justifyContent = 'center';
  calc.style.margin = '0 0 10px';
  calc.appendChild(pixelText(result.scoring.chips, 14, '#59c4ff', '#0a3d63', 0, 2));
  calc.appendChild(pixelText('×', 14, '#f2efe4', '#000', 0, 2));
  calc.appendChild(pixelText(result.scoring.mult, 14, '#ff8b83', '#7a1f19', 0, 2));
  calc.appendChild(pixelText('=', 14, '#f2efe4', '#000', 0, 2));
  calc.appendChild(pixelText(result.score, 16, '#f0c04a', '#3a2c06', 0, 2));
  box.appendChild(calc);

  box.appendChild(scoreLines(result.scoring));

  const gold = el('div', 'lineList');
  gold.style.marginTop = '8px';
  const goldLine = el('div', 'lineItem');
  goldLine.appendChild(el('div', 'n', `空开运位 ${result.emptySlots} × ${DEMO_CONFIG.goldPerEmptySlot} 金`));
  goldLine.appendChild(el('div', 'v', `+${result.gold} 待结算金`));
  gold.appendChild(goldLine);
  box.appendChild(gold);

  const buttons = el('div', 'rowBtns');
  const next = el('button', 'btn green big', state.handNumber < state.handCount ? '下一副 NEXT' : '本轮结算 CASH OUT');
  next.addEventListener('click', () => { closeScreen(); game.advance(); });
  buttons.appendChild(next);
  box.appendChild(buttons);
  next.focus();
}

function showHandFailed() {
  const box = makeScreen();
  box.appendChild(el('div', 'title sh', '流局'));
  box.appendChild(el('div', 'subtitle', '换牌用完，本副没能成牌，本副 0 分'));
  const buttons = el('div', 'rowBtns');
  const next = el('button', 'btn play big', state.handNumber < state.handCount ? '下一副 NEXT' : '本轮结算 CASH OUT');
  next.addEventListener('click', () => { closeScreen(); game.advance(); });
  buttons.appendChild(next);
  box.appendChild(buttons);
  next.focus();
}

function showRoundFailed() {
  const box = makeScreen();
  box.appendChild(el('div', 'title sh', '本轮未达标'));
  box.appendChild(el('div', 'subtitle', state.lastEvent?.text ?? ''));
  const buttons = el('div', 'rowBtns');
  const retry = el('button', 'btn red big', '重试本轮 RETRY');
  retry.addEventListener('click', () => { closeScreen(); game.retryRound(); });
  buttons.appendChild(retry);
  const restart = el('button', 'btn grey', '重开一局');
  restart.addEventListener('click', () => { closeScreen(); game.reset(Math.floor(Math.random() * 1e9)); });
  buttons.appendChild(restart);
  box.appendChild(buttons);
  retry.focus();
}

function showShop() {
  const box = makeScreen();
  box.appendChild(el('div', 'title sh', '百宝阁'));
  box.appendChild(el('div', 'subtitle',
    `${state.round.name}达标 · ${state.lastEvent?.text ?? ''} · 现有 ${state.gold} 金`));

  const grid = el('div', 'shopGrid');
  grid.id = 'shopGrid';
  for (const generalId of state.shopOffer.items) {
    const general = GENERALS[generalId];
    const affordable = state.gold >= general.price && state.generalIds.length < state.generalSlots;
    const card = el('div', `shopCard${affordable ? '' : ' cant'}`);
    card.appendChild(el('div', 'price', `${general.price} 金`));
    card.appendChild(createSealCanvas(general.glyph, { paper: '#cfe0ef', ink: '#23405e', scale: 2 }));
    card.appendChild(el('div', 'cn', general.name));
    card.appendChild(el('div', 'cd', general.description));
    if (affordable) {
      card.addEventListener('click', () => {
        const result = game.buyGeneral(generalId);
        if (result.ok) {
          sfx.coin();
          toast(`${general.name} 加入队伍`);
          showShop();
        } else {
          toast(result.reason);
        }
      });
    }
    grid.appendChild(card);
  }
  if (!state.shopOffer.items.length) grid.appendChild(el('div', 'hintLine', '货架已空'));
  box.appendChild(grid);

  const buttons = el('div', 'rowBtns');
  const reroll = el('button', 'btn grey', `刷新 ${state.rerollCost} 金`);
  reroll.disabled = state.gold < state.rerollCost;
  reroll.addEventListener('click', () => {
    const result = game.rerollShop();
    if (result.ok) { sfx.select(); showShop(); } else toast(result.reason);
  });
  buttons.appendChild(reroll);
  const leave = el('button', 'btn green big', '进入下一轮 NEXT ROUND');
  leave.addEventListener('click', () => { closeScreen(); game.leaveShop(); });
  buttons.appendChild(leave);
  box.appendChild(buttons);
  leave.focus();
}

function showRunComplete() {
  const box = makeScreen();
  box.appendChild(el('div', 'title sh', '通关'));
  box.appendChild(el('div', 'subtitle', `三轮总分 ${state.totalScore} · 剩余 ${state.gold} 金`));
  const list = el('div', 'lineList');
  for (const round of state.completedRounds) {
    const line = el('div', 'lineItem');
    line.appendChild(el('div', 'n', round.name));
    line.appendChild(el('div', 'v', `${round.score} 分 · ${round.banked} 金`));
    list.appendChild(line);
  }
  box.appendChild(list);
  const buttons = el('div', 'rowBtns');
  const again = el('button', 'btn green big', '再来一局 PLAY AGAIN');
  again.addEventListener('click', () => { closeScreen(); game.reset(Math.floor(Math.random() * 1e9)); });
  buttons.appendChild(again);
  box.appendChild(buttons);
  again.focus();
}

function showHelp() {
  const box = makeScreen();
  box.appendChild(el('div', 'title sh', '天胡'));
  box.appendChild(el('div', 'subtitle', 'TIANHU · 麻将构筑肉鸽 · V3 街机切片'));
  const text = el('div', 'helpText');
  text.innerHTML = `
    <p>手上永远是 <b>14 张</b>结构牌，目标是凑成一副完整胡牌：<b>四组面子 + 一对将</b>，或者 <b>七个对子</b>。</p>
    <p>点 <b>1 张</b> = 换掉它并摸右侧“下一张”，每副只有 ${DEMO_CONFIG.swapsPerHand} 次。<br>
       点 <b>2–4 张</b>合法组合 = 亮组，花掉一个 <b>开运位</b>，立刻 <b>三签选一</b>。</p>
    <p>上方 6 个开运位就是本副奖励：每个 <b>留空</b>的位置胡牌时给 <b>+${SCORING.emptySlotChips} 牌值和 +${DEMO_CONFIG.goldPerEmptySlot} 金</b>（金币留到商店买福将）；<b>花掉</b>它换一张只在本副生效的灵签。</p>
    <p>结构一合法就可以随时 <b>胡牌</b>。得分 = <b>牌值 × 番势</b>；番种越大番势越高，一次都不亮还会记一个 <b>门清</b>。</p>
    <p>三副累计达到目标才算过关，金币才真正入账；换牌用完还没成牌就流局。</p>
    <p class="lbl">快捷键：<span class="kbd">Enter</span> 执行 · <span class="kbd">H</span> 胡牌 · <span class="kbd">Esc</span> 取消选择 · <span class="kbd">1/2/3</span> 选灵签</p>
  `;
  box.appendChild(text);
  box.appendChild(el('div', 'lbl', `seed ${state.seed} · 想复现同一局就在网址后面加 ?seed=${state.seed}`));
  const buttons = el('div', 'rowBtns');
  const start = el('button', 'btn green big', '开始 START');
  start.addEventListener('click', () => closeScreen());
  buttons.appendChild(start);
  box.appendChild(buttons);
  start.focus();
}

/* ---------- 状态驱动的覆盖屏 ---------- */
let lastScreenStatus = null;
function syncScreens() {
  if (state.status === lastScreenStatus) return;
  lastScreenStatus = state.status;
  switch (state.status) {
    case 'hand-won':
      sfx.hu();
      showHandResult();
      break;
    case 'hand-failed':
      sfx.bad();
      showHandFailed();
      break;
    case 'round-failed':
      sfx.bad();
      showRoundFailed();
      break;
    case 'shop':
      sfx.coin();
      showShop();
      break;
    case 'run-complete':
      sfx.hu();
      showRunComplete();
      break;
    default:
      closeScreen();
      break;
  }
}

/* ---------- 事件 ---------- */
function doAction() {
  const preview = state.selectionPreview;
  if (!preview.valid) {
    if (state.selectedIds.length) toast(preview.text);
    return;
  }
  const result = game.performAction();
  if (!result.ok) {
    toast(result.reason);
    return;
  }
  if (result.kind === 'swap') {
    sfx.swap();
    if (result.drawn) toast(`摸到 ${tileName(result.drawn)}`);
  } else {
    sfx.reveal();
  }
}

function doHu() {
  if (!state.canHu) return;
  const chipsBox = $('#chipsBox');
  const multBox = $('#multBox');
  chipsBox.classList.add('pulse');
  multBox.classList.add('pulse');
  floatText($('#totalBox'), `+${state.preview.total}`, '#f0c04a');
  setTimeout(() => {
    chipsBox.classList.remove('pulse');
    multBox.classList.remove('pulse');
  }, 300);
  game.declareHu();
}

$('#btnAct').addEventListener('click', doAction);
$('#btnHu').addEventListener('click', doHu);
$('#btnHelp').addEventListener('click', showHelp);
$('#btnRestart').addEventListener('click', () => {
  closeScreen();
  lastScreenStatus = null;
  game.reset(Math.floor(Math.random() * 1e9));
  toast('新一局');
});

document.addEventListener('keydown', (event) => {
  if (state.pendingDraft && ['1', '2', '3'].includes(event.key)) {
    const charmId = state.pendingDraft.charmIds[Number(event.key) - 1];
    if (charmId) {
      sfx.charm();
      game.chooseCharm(charmId);
    }
    return;
  }
  if ($('#screen')) return;
  if (event.key === 'Enter') doAction();
  else if (event.key.toLowerCase() === 'h') doHu();
  else if (event.key === 'Escape') game.clearSelection();
});

let resizeTimer = null;
function scheduleRelayout() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (refreshScale()) renderAll();
  }, 80);
}
window.addEventListener('resize', scheduleRelayout);
window.addEventListener('orientationchange', scheduleRelayout);
if (window.ResizeObserver) new ResizeObserver(scheduleRelayout).observe($('#main'));

game.subscribe((next) => {
  state = next;
  renderAll();
  syncScreens();
});

/* ---------- 自动化钩子：只给视口 smoke test 使用 ---------- */
function firstLegalGroup() {
  const tiles = state.looseTiles;
  for (let i = 0; i < tiles.length; i += 1) {
    for (let j = i + 1; j < tiles.length; j += 1) {
      const candidates = [[tiles[i], tiles[j]]];
      for (let k = j + 1; k < tiles.length; k += 1) candidates.push([tiles[i], tiles[j], tiles[k]]);
      for (const candidate of candidates) {
        game.clearSelection();
        for (const tile of candidate) game.toggleTile(tile.id);
        if (game.selectionPreview().valid && game.selectionPreview().kind !== 'swap') return true;
      }
    }
  }
  game.clearSelection();
  return false;
}

window.__demo = {
  game,
  getState: () => state,
  revealFirstLegalGroup() {
    if (!firstLegalGroup()) return false;
    doAction();
    return Boolean(state.pendingDraft);
  },
  /** 贪心打完一副：优先胡牌，否则换掉离胡最远的一张。 */
  autoPlayHand() {
    for (let step = 0; step < 40; step += 1) {
      if (state.pendingDraft) {
        game.chooseCharm(state.pendingDraft.charmIds[0]);
        continue;
      }
      if (state.canHu) {
        doHu();
        return game.snapshot().status;
      }
      if (state.status !== 'playing') return state.status;
      const next = game.wall[0];
      if (!next) return state.status;
      const support = (tile) => state.looseTiles.reduce((score, other) => {
        if (other.id === tile.id || other.suit !== tile.suit) return score;
        if (other.rank === tile.rank) return score + 3;
        if (tile.suit === 'honor') return score;
        const gap = Math.abs(other.rank - tile.rank);
        return gap === 1 ? score + 2 : gap === 2 ? score + 1 : score;
      }, 0);
      let best = null;
      for (const tile of state.looseTiles) {
        if (tile.suit === next.suit && tile.rank === next.rank) continue;
        const candidate = [...state.looseTiles.filter((item) => item.id !== tile.id), next];
        const distance = tilesToChange(candidate, game.revealedGroups);
        const lonely = -support(tile);
        if (!best || distance < best.distance
          || (distance === best.distance && lonely > best.lonely)) best = { tile, distance, lonely };
      }
      if (!best) return state.status;
      game.clearSelection();
      game.toggleTile(best.tile.id);
      doAction();
    }
    return state.status;
  },
};

refreshScale();
renderAll();
requestAnimationFrame(() => { if (refreshScale()) renderAll(); });
lastScreenStatus = state.status;
adapter.ready();
showHelp();
