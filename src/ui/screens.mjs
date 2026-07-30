/**
 * 外层界面：开始界面、牌组选择、设置、选关屏。
 * 这些屏幕只读状态并回调动作，不直接改 Run。
 */

import {
  ANTES,
  BLIND_KINDS,
  CONTENT_COUNTS,
  DECK_LIST,
  FAMILIES,
  FAMILY_ORDER,
  getItem,
  listItems,
} from '../content/index.mjs';
import {
  createLogoCanvas,
  createTileBackCanvas,
  createTileCanvas,
} from '../render/pixel.mjs';
import { createCardArtwork } from '../render/card-art.mjs';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const button = (className, label, onClick) => {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
};

/** 所有覆盖屏共用的外壳。 */
export function makeScreen(extraClass = '') {
  document.querySelector('#screen')?.remove();
  // 明细弹层是局内的轻量浮层，任何覆盖屏出现时都不该压在它下面
  document.querySelector('#sheet')?.remove();
  // 标题页有独立水墨扉页，但仍留少量透明度给动态墨色；底下牌桌必须压暗，
  // 否则 HUD 和开运位会从册页后面透出来。
  document.body.classList.toggle('atTitle', extraClass.includes('titleScreen'));
  const screen = el('div', `screen ${extraClass}`.trim());
  screen.id = 'screen';
  const box = el('div', 'screenBox');
  screen.append(box);
  document.body.append(screen);
  return box;
}

export function closeScreen() {
  document.querySelector('#screen')?.remove();
  document.body.classList.remove('atTitle');
}

/* ---------------- 开始界面 ---------------- */

/** 标题页专属背景：水墨山月留白，Logo 与菜单由代码另外叠上。 */
function titleBackdrop() {
  const stage = el('div', 'titleBg');
  stage.setAttribute('aria-hidden', 'true');
  stage.append(el('div', 'titleGrain'));
  return stage;
}

export function showTitle({ deckId, hasSave, onStart, onContinue, onDeck, onSettings, onHelp, onLibrary }) {
  const box = makeScreen('titleScreen');
  const deck = getItem('deck', deckId);
  box.parentElement.prepend(titleBackdrop());

  const logo = el('div', 'titleLogo');
  logo.append(createLogoCanvas(3));
  box.append(logo);
  box.append(el('div', 'subtitle titleTagline', '麻将构筑肉鸽 · 亮组求签 · 一路胡到西圈'));

  const fan = el('div', 'titleFan');
  for (const [suit, rank] of [['man', 1], ['pin', 5], ['sou', 1], ['honor', 5], ['honor', 6]]) {
    fan.append(createTileCanvas({ id: `t-${suit}-${rank}`, suit, rank }, 2));
  }
  box.append(fan);

  const menu = el('div', 'titleMenu');
  if (hasSave) menu.append(button('btn green big', '继续上局 CONTINUE', onContinue));
  menu.append(button(`btn ${hasSave ? 'play' : 'green'} big`, '开始新局 NEW RUN', onStart));
  const row = el('div', 'rowBtns');
  row.append(
    button('btn grey', `牌组：${deck?.name ?? '素面'}`, onDeck),
    button('btn grey libraryOpen', '百牌谱', onLibrary),
    button('btn grey', '设置', onSettings),
    button('btn grey', '玩法', onHelp),
  );
  menu.append(row);
  box.append(menu);
  return box;
}

/* ---------------- 功能牌图鉴 ---------------- */

const CHARM_TIER_NAMES = Object.freeze({ silver: '银签', gold: '金签', rainbow: '彩签' });
const CHARM_ROLE_NAMES = Object.freeze({ momentum: '助势', fate: '改命', omen: '奇缘' });

export function showLibrary({ initialFamily = 'charm', onBack }) {
  const box = makeScreen('libraryScreen');
  box.append(el('div', 'title sh', '百牌谱'));
  const total = Object.values(CONTENT_COUNTS).reduce((sum, count) => sum + count, 0);
  box.append(el('div', 'subtitle', `现行测试池 · ${total} 张功能牌 · 点按五系分类查看`));

  const tabs = el('div', 'libraryTabs');
  tabs.setAttribute('role', 'tablist');
  const grid = el('div', 'libraryGrid');
  grid.setAttribute('role', 'tabpanel');

  const renderFamily = (family) => {
    for (const tab of tabs.querySelectorAll('.libraryTab')) {
      const active = tab.dataset.family === family;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    grid.replaceChildren();
    grid.dataset.family = family;
    grid.setAttribute('aria-label', `${FAMILIES[family].name}卡牌`);
    for (const item of listItems(family)) {
      const card = el('article', `card libraryCard family-${family}`);
      card.dataset.libraryCard = `${family}:${item.id}`;
      card.append(createCardArtwork(family, item));
      card.append(el('div', 'cName', item.name));
      card.append(el('div', 'cText', item.text));
      let meta = `${FAMILIES[family].name} · ${item.duration}`;
      if (family === 'charm') {
        meta = `${CHARM_TIER_NAMES[item.tier]} · ${CHARM_ROLE_NAMES[item.functionRole]} · ${item.duration}`;
      } else if (Number.isFinite(item.price)) {
        meta = `${FAMILIES[family].name} · ${item.price} 金 · ${item.duration}`;
      }
      card.append(el('div', 'cMeta', meta));
      card.append(el('div', 'libraryStatus', '测试池'));
      grid.append(card);
    }
  };

  for (const family of FAMILY_ORDER) {
    const info = FAMILIES[family];
    const tab = button('btn grey libraryTab', `${info.glyph} ${info.name} ${CONTENT_COUNTS[family]}`, () => {
      renderFamily(family);
    });
    tab.dataset.family = family;
    tab.setAttribute('role', 'tab');
    tabs.append(tab);
  }

  box.append(tabs, grid);
  const row = el('div', 'rowBtns');
  row.append(button('btn green big', '返回', onBack));
  box.append(row);
  renderFamily(FAMILIES[initialFamily] ? initialFamily : 'charm');
  box.querySelector('.libraryTab.active')?.focus({ preventScroll: true });
  return box;
}

/* ---------------- 牌组选择 ---------------- */

export function showDeckSelect({ deckId, onPick, onBack }) {
  const box = makeScreen();
  box.append(el('div', 'title sh', '选牌组'));
  box.append(el('div', 'subtitle', '牌背是外观，修正是玩法；开局就定下这一局的起手风格'));

  const grid = el('div', 'deckGrid');
  for (const deck of DECK_LIST) {
    const card = el('div', `deckCard${deck.id === deckId ? ' picked' : ''}`);
    card.dataset.deck = deck.id;
    const stack = el('div', 'deckStack');
    for (let layer = 0; layer < 3; layer += 1) {
      const back = createTileBackCanvas(deck.back, 2);
      back.style.marginLeft = layer ? '-26px' : '0';
      back.style.marginTop = `${layer * 3}px`;
      stack.append(back);
    }
    card.append(stack);
    card.append(el('div', 'cName', deck.name));
    card.append(el('div', 'cText', deck.text));
    card.addEventListener('click', () => onPick(deck.id));
    grid.append(card);
  }
  box.append(grid);

  const row = el('div', 'rowBtns');
  row.append(button('btn green big', '确定', onBack));
  box.append(row);
  return box;
}

/* ---------------- 设置 ---------------- */

export function showSettings({ settings, seed, onChange, onClearSave, onBack }) {
  const box = makeScreen();
  box.append(el('div', 'title sh', '设置'));
  box.append(el('div', 'subtitle', `seed ${seed}`));

  const list = el('div', 'settingList');

  const toggleRow = (label, key, options) => {
    const row = el('div', 'settingRow');
    row.append(el('div', 'n', label));
    const group = el('div', 'segmented');
    for (const option of options) {
      const active = settings[key] === option.value;
      const node = button(`btn sm ${active ? 'green' : 'grey'}`, option.label, () => {
        onChange({ ...settings, [key]: option.value });
      });
      node.dataset.setting = `${key}:${option.value}`;
      group.append(node);
    }
    row.append(group);
    list.append(row);
  };

  toggleRow('音效', 'sound', [{ label: '开', value: true }, { label: '关', value: false }]);
  toggleRow('动画速度', 'animationSpeed', [
    { label: '正常', value: 1 },
    { label: '快', value: 2 },
    { label: '关', value: 0 },
  ]);
  toggleRow('震动', 'haptics', [{ label: '开', value: true }, { label: '关', value: false }]);
  box.append(list);

  const row = el('div', 'rowBtns');
  row.append(
    button('btn red', '清除存档', onClearSave),
    button('btn green big', '返回', onBack),
  );
  box.append(row);
  return box;
}

/* ---------------- 选关屏 ---------------- */

export function showBlindSelect({ state, onSelect, onSkip, onTitle }) {
  const box = makeScreen('blindScreen');
  const ante = state.ante;
  box.append(el('div', 'title sh', `${ante.name}`));
  box.append(el('div', 'subtitle',
    `第 ${state.anteNumber} / ${state.anteCount} 圈 · 现有 ${state.gold} 金 · 预告番种：${ante.announced.join(' / ')}`));

  const grid = el('div', 'blindGrid');
  for (const card of state.blindCards) {
    const node = el('div', `blindCard kind-${card.kind}${card.current ? ' current' : ''}${card.outcome ? ` done-${card.outcome}` : ''}`);
    const chip = el('div', 'blindChip', card.label);
    chip.style.background = card.chip;
    node.append(chip);
    node.append(el('div', 'cName', card.name));
    if (card.boss) {
      node.append(el('div', 'bossName', card.boss.name));
      node.append(el('div', 'cText', card.boss.text));
    } else {
      node.append(el('div', 'cText', card.skippable ? '可以跳过换一张手气' : ''));
    }
    node.append(el('div', 'blindTarget', `目标 ${card.target}`));
    node.append(el('div', 'cMeta', `过关 +${card.reward} 金`));
    if (card.outcome) node.append(el('div', 'blindStamp', card.outcome === 'cleared' ? '已过' : '已跳'));

    if (card.current) {
      const actions = el('div', 'blindActions');
      actions.append(button('btn green big', '开打', onSelect));
      if (card.skippable) actions.append(button('btn grey', '跳局', onSkip));
      node.append(actions);
    }
    grid.append(node);
  }
  box.append(grid);

  if (state.tags.length) {
    const tags = el('div', 'tagRow');
    tags.append(el('div', 'lbl', '手气'));
    for (const tagId of state.tags) {
      const tag = getItem('tag', tagId);
      const chip = el('div', 'tagChip', `${tag.name} · ${tag.text}`);
      tags.append(chip);
    }
    box.append(tags);
  }

  const row = el('div', 'rowBtns');
  row.append(button('btn grey sm', '返回标题', onTitle));
  box.append(row);
  return box;
}

/* ---------------- 玩法说明 ---------------- */

export function showHelp({ state, onBack }) {
  const box = makeScreen();
  box.append(el('div', 'title sh', '玩法'));
  box.append(el('div', 'subtitle', 'TIANHU · 麻将构筑肉鸽'));
  const text = el('div', 'helpText');
  text.innerHTML = `
    <p>标准短局打 <b>东 / 南两圈</b>，每圈三关：<b>闲局 → 庄局 → 圈主</b>；通关后可选西圈加赛。
       闲局和庄局可以<b>跳局</b>换一张手气，圈主必须打，而且带一条特殊规则。</p>
    <p>每关只打 <b>${state.handCount} 副</b>牌，过关后立即进百宝阁。手上永远 14 张，
       凑成<b>四组面子 + 一对将</b>或<b>七个对子</b>就能胡。</p>
    <p><b>换牌</b>：选中几张就一次换掉几张，只消耗 1 次换牌机会，每副 ${state.swapsPerHand} 次。
       <b>没用完的换牌，胡牌时每次换 ${state.goldPerUnusedSwap} 金。</b></p>
    <p><b>亮组</b>：选 2–4 张合法组合，花掉一个<b>开运位</b>，立刻三签选一。
       开运位每个留空给 +${state.emptySlotChips} 牌值和 +${state.goldPerEmptySlot} 金。</p>
    <p>灵签同时有<b>银 / 金 / 彩</b>签阶和<b>助势 / 奇缘</b>职责。部分奇缘会留在待缘位，
       在下一次求签时自动应验一次；广缘会把下一次求签变成四选一。</p>
    <p>得分 = <b>牌值 × 番势</b>。过关拿金币，进百宝阁买长期构筑。</p>
  `;
  const families = el('div', '');
  for (const family of ['charm', 'codex', 'general', 'bone', 'seal']) {
    const info = FAMILIES[family];
    const line = el('div', 'famLine');
    const dot = el('div', 'famDot');
    dot.style.background = `var(--${family})`;
    line.append(dot, el('div', '', `${info.name}（${info.subtitle}）· ${info.duration}`));
    families.append(line);
  }
  text.append(families);
  text.append(el('p', 'lbl', '快捷键：Enter 换牌 · R 亮组 · H 胡牌 · Esc 取消 · 1/2/3/4 选灵签 · 结算时点一下快进'));
  box.append(text);
  const row = el('div', 'rowBtns');
  row.append(button('btn green big', '返回', onBack));
  box.append(row);
  return box;
}

export { ANTES, BLIND_KINDS };
