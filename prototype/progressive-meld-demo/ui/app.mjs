import { ProgressiveMeldGame } from '../core/game.mjs';
import { GROUPS } from '../core/rules.mjs';
import { SCENARIOS } from '../core/scenarios.mjs';
import { tileAriaLabel, tileKey, tileName } from '../core/tiles.mjs';
import { WebPlatformAdapter } from '../platforms/web-adapter.mjs';
import { createTileCanvas } from '../render/tile-renderer.mjs';

const elements = {
  swaps: document.querySelector('#swaps-value'),
  chips: document.querySelector('#chips-value'),
  wall: document.querySelector('#wall-value'),
  structure: document.querySelector('#structure-count'),
  looseCount: document.querySelector('#loose-count'),
  looseHand: document.querySelector('#loose-hand'),
  groupSlots: document.querySelector('#group-slots'),
  goalSlots: document.querySelector('#goal-slots'),
  actionPreview: document.querySelector('.action-preview'),
  actionTitle: document.querySelector('#action-title'),
  actionDetail: document.querySelector('#action-detail'),
  actionButton: document.querySelector('#action-button'),
  clearButton: document.querySelector('#clear-button'),
  huButton: document.querySelector('#hu-button'),
  eventTitle: document.querySelector('#event-title'),
  eventDetail: document.querySelector('#event-detail'),
  coach: document.querySelector('#coach-copy'),
  scenarioCopy: document.querySelector('#scenario-copy'),
  seed: document.querySelector('#seed-copy'),
  scenarios: document.querySelector('#scenario-buttons'),
  soundButton: document.querySelector('#sound-button'),
  helpButton: document.querySelector('#help-button'),
  helpDialog: document.querySelector('#help-dialog'),
  closeHelpButton: document.querySelector('#close-help-button'),
  resultDialog: document.querySelector('#result-dialog'),
  resultTitle: document.querySelector('#result-title'),
  resultChips: document.querySelector('#result-chips'),
  resultMult: document.querySelector('#result-mult'),
  resultTotal: document.querySelector('#result-total'),
  resultFortunes: document.querySelector('#result-fortunes'),
  replayButton: document.querySelector('#replay-button'),
  nextScenarioButton: document.querySelector('#next-scenario-button'),
  toast: document.querySelector('#toast-region'),
};

const query = new URLSearchParams(window.location.search);
const initialScenario = SCENARIOS[query.get('scenario')] ? query.get('scenario') : 'simple';
const requestedSeed = Number(query.get('seed')) || undefined;
const game = new ProgressiveMeldGame({ scenario: initialScenario, seed: requestedSeed });
const platform = new WebPlatformAdapter();

let audioEnabled = true;
let audioContext = null;
let lastRenderedEvent = null;

function ensureAudio() {
  if (!audioEnabled) return null;
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioContext = new AudioContextClass();
  }
  if (audioContext?.state === 'suspended') audioContext.resume();
  return audioContext;
}

function tone(frequency, duration = 0.055, type = 'square', volume = 0.035, delay = 0) {
  const context = ensureAudio();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime + delay;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
}

function playSound(type) {
  if (type === 'select') tone(660, 0.04, 'square', 0.025);
  if (type === 'swap') {
    tone(360, 0.055, 'triangle', 0.04);
    tone(530, 0.06, 'triangle', 0.04, 0.07);
  }
  if (type === 'lock') {
    tone(520, 0.06, 'square', 0.035);
    tone(720, 0.075, 'square', 0.035, 0.07);
  }
  if (type === 'error') tone(150, 0.16, 'sawtooth', 0.035);
  if (type === 'hu') {
    [523, 659, 784, 1046].forEach((frequency, index) => tone(frequency, 0.18, 'triangle', 0.045, index * 0.1));
  }
}

function showToast(message) {
  elements.toast.replaceChildren();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  elements.toast.appendChild(toast);
  window.setTimeout(() => {
    if (toast.isConnected) toast.remove();
  }, 1700);
}

function createGroupCard(group, selectedTiles) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `group-card is-${group.kind}`;
  button.dataset.groupId = group.id;

  const canUpgrade = selectedTiles.length === 1
    && tileKey(selectedTiles[0]) === tileKey(group.tiles[0])
    && (group.kind === 'pair' || group.kind === 'pung');
  if (canUpgrade) button.classList.add('is-upgrade');

  const tiles = document.createElement('span');
  tiles.className = 'mini-tiles';
  for (const tile of group.tiles) tiles.appendChild(createTileCanvas(tile, 'mini-tile'));

  const label = document.createElement('span');
  label.className = 'group-label';
  const actionHint = canUpgrade
    ? group.kind === 'pair' ? '点此升刻' : '点此升杠'
    : group.kind === 'kong' ? '已承诺' : '点击拆组';
  label.innerHTML = `<b>${GROUPS[group.kind].cn}</b><span>${actionHint}</span>`;

  button.setAttribute(
    'aria-label',
    `${GROUPS[group.kind].cn}，${group.tiles.map(tileAriaLabel).join('、')}，${actionHint}`,
  );
  button.append(tiles, label);
  button.addEventListener('click', () => {
    const result = game.interactWithGroup(group.id);
    if (result.ok) {
      playSound(result.supplement ? 'swap' : 'lock');
      showToast(game.lastEvent.text);
    } else {
      playSound('error');
      showToast(result.reason);
    }
  });
  return button;
}

function createEmptyGroupSlot(label) {
  const slot = document.createElement('div');
  slot.className = 'group-slot';
  slot.textContent = label;
  slot.setAttribute('aria-hidden', 'true');
  return slot;
}

function renderGroups(snapshot) {
  elements.groupSlots.replaceChildren();
  const melds = snapshot.groups.filter((group) => group.kind !== 'pair');
  const pair = snapshot.groups.find((group) => group.kind === 'pair');
  for (let index = 0; index < 4; index += 1) {
    elements.groupSlots.appendChild(
      melds[index]
        ? createGroupCard(melds[index], snapshot.selectedTiles)
        : createEmptyGroupSlot(`面子 ${index + 1}`),
    );
  }
  elements.groupSlots.appendChild(
    pair ? createGroupCard(pair, snapshot.selectedTiles) : createEmptyGroupSlot('将牌'),
  );
}

function renderGoal(snapshot) {
  elements.goalSlots.replaceChildren();
  const melds = snapshot.groups.filter((group) => group.kind !== 'pair').length;
  const pairs = snapshot.groups.filter((group) => group.kind === 'pair').length;
  for (let index = 0; index < 4; index += 1) {
    const slot = document.createElement('span');
    slot.className = `goal-slot${index < melds ? ' is-filled' : ''}`;
    slot.textContent = `面${index + 1}`;
    elements.goalSlots.appendChild(slot);
  }
  const pairSlot = document.createElement('span');
  pairSlot.className = `goal-slot${pairs ? ' is-filled' : ''}`;
  pairSlot.textContent = '将';
  elements.goalSlots.appendChild(pairSlot);
}

function renderLooseHand(snapshot) {
  const focusedTileId = document.activeElement?.dataset?.tileId;
  elements.looseHand.replaceChildren();
  for (const tile of snapshot.looseTiles) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tile-button${snapshot.selectedIds.includes(tile.id) ? ' is-selected' : ''}`;
    button.dataset.tileId = tile.id;
    button.setAttribute('aria-label', `${tileAriaLabel(tile)}${snapshot.selectedIds.includes(tile.id) ? '，已选择' : ''}`);
    button.setAttribute('aria-pressed', snapshot.selectedIds.includes(tile.id) ? 'true' : 'false');
    button.appendChild(createTileCanvas(tile));
    button.addEventListener('click', () => {
      game.toggleTile(tile.id);
      playSound('select');
    });
    elements.looseHand.appendChild(button);
  }
  if (focusedTileId) {
    requestAnimationFrame(() => {
      elements.looseHand.querySelector(`[data-tile-id="${focusedTileId}"]`)?.focus({ preventScroll: true });
    });
  }
}

function renderAction(snapshot) {
  const preview = snapshot.selectionPreview;
  const selectedCount = snapshot.selectedTiles.length;
  elements.actionPreview.classList.toggle('is-valid', preview.valid);
  elements.actionPreview.classList.toggle('is-invalid', selectedCount > 0 && !preview.valid);

  if (selectedCount === 0) {
    if (snapshot.swapsLeft === 0 && !snapshot.canHu && !snapshot.handCanFormHu) {
      elements.actionTitle.textContent = '换牌已用完';
      elements.actionDetail.textContent = snapshot.hasLockConflict ? '可能是锁组冲突，先拆组试试' : '确认无法胡牌后结束本副';
      elements.actionButton.textContent = '流局';
      elements.actionButton.disabled = false;
    } else {
      elements.actionTitle.textContent = snapshot.canHu
        ? '四面一将全部归位！'
        : snapshot.handCanFormHu ? '牌型已成，还差归位' : '请选择麻将牌';
      elements.actionDetail.textContent = snapshot.canHu
        ? '现在可以主动宣告胡牌'
        : snapshot.handCanFormHu ? '锁定剩余组合后即可胡牌' : '1 张换牌，2–4 张组成有效组合';
      elements.actionButton.textContent = '选择牌';
      elements.actionButton.disabled = true;
    }
  } else {
    elements.actionTitle.textContent = preview.valid ? preview.text : (preview.reason || preview.text);
    const upgradeGroup = snapshot.groups.find(
      (group) => selectedCount === 1
        && tileKey(snapshot.selectedTiles[0]) === tileKey(group.tiles[0])
        && (group.kind === 'pair' || group.kind === 'pung'),
    );
    elements.actionDetail.textContent = upgradeGroup
      ? `也可以点击${GROUPS[upgradeGroup.kind].cn}进行升级`
      : preview.valid ? `${selectedCount} 张已选择` : '调整选择后再提交';
    elements.actionButton.textContent = preview.kind === 'swap'
      ? '换一张'
      : preview.valid ? `锁定${GROUPS[preview.kind].cn}` : '无法提交';
    elements.actionButton.disabled = !preview.valid;
  }

  elements.clearButton.disabled = selectedCount === 0;
  elements.huButton.disabled = !snapshot.canHu || snapshot.status !== 'active';
  elements.huButton.classList.toggle('is-ready', snapshot.canHu && snapshot.status === 'active');
}

function renderEvent(snapshot) {
  const event = snapshot.lastEvent;
  if (event === lastRenderedEvent) return;
  lastRenderedEvent = event;

  if (event.type === 'start') {
    elements.eventTitle.textContent = '一张换 · 成组留 · 凑齐胡';
    elements.eventDetail.textContent = snapshot.scenario.subtitle;
  } else if (event.type === 'swap') {
    elements.eventTitle.textContent = `摸到 ${tileName(event.drawn)}`;
    elements.eventDetail.textContent = snapshot.handCanFormHu
      ? '牌型已经成形，把最后组合归位'
      : `换牌剩余 ${snapshot.swapsLeft} 次；继续整理`;
  } else if (event.type === 'lock' || event.type === 'upgrade' || event.type === 'unlock') {
    elements.eventTitle.textContent = event.text;
    elements.eventDetail.textContent = `当前待结算 ${snapshot.pendingScore.chips} 筹码`;
  } else if (event.type === 'error') {
    elements.eventTitle.textContent = event.text;
    elements.eventDetail.textContent = '调整选择，或拆开一个普通组合';
  }
}

function renderCoach(snapshot) {
  if (snapshot.canHu) {
    elements.coach.textContent = '四个面子和一个将牌都已归位。现在可以主动宣告“胡！”。';
  } else if (snapshot.handCanFormHu) {
    elements.coach.textContent = '整副牌已经能组成四面一将，但还不能跳过锁组。把剩余组合归位后再胡。';
  } else if (snapshot.hasLockConflict) {
    elements.coach.textContent = '整副牌本来能胡，但当前锁组挡住了解法。点一个普通组合拆回，再看看。';
  } else if (snapshot.groups.length === 0) {
    elements.coach.textContent = '先找出现成的对子、顺子或刻子。锁组不会摸牌，也不消耗换牌次数。';
  } else if (snapshot.groups.length >= 3) {
    elements.coach.textContent = '牌面快整理完了。单选不需要的牌换掉，摸牌后系统会重新检查胡牌。';
  } else {
    elements.coach.textContent = '普通组合可以免费拆。选中一张相同牌后点击对子或刻子，可以直接升级。';
  }
}

function render(snapshot) {
  elements.swaps.textContent = snapshot.swapsLeft;
  elements.chips.textContent = snapshot.pendingScore.chips;
  elements.wall.textContent = snapshot.wallCount;
  elements.structure.textContent = `结构 ${snapshot.structuralCount} / 实体 ${snapshot.physicalCount}`;
  elements.looseCount.textContent = `${snapshot.looseTiles.length} 张`;
  elements.scenarioCopy.textContent = `${snapshot.scenario.name} · ${snapshot.scenario.subtitle}`;
  elements.seed.textContent = `SEED ${snapshot.seed}`;
  renderGroups(snapshot);
  renderGoal(snapshot);
  renderLooseHand(snapshot);
  renderAction(snapshot);
  renderEvent(snapshot);
  renderCoach(snapshot);

  for (const button of elements.scenarios.querySelectorAll('button')) {
    button.classList.toggle('is-active', button.dataset.scenario === snapshot.scenario.id);
    button.setAttribute('aria-pressed', button.dataset.scenario === snapshot.scenario.id ? 'true' : 'false');
  }
}

function showWin(result) {
  elements.resultTitle.textContent = result.patterns.join(' · ');
  elements.resultChips.textContent = result.score.chips;
  elements.resultMult.textContent = result.score.mult;
  elements.resultTotal.textContent = result.score.total;
  const bonusParts = [];
  if (result.score.patternMult > 1) bonusParts.push(`${result.patterns.join(' · ')} ×${result.score.patternMult}`);
  bonusParts.push(...result.score.fortuneEvents.map((event) => `${event.name} +${event.value}`));
  elements.resultFortunes.textContent = bonusParts.length ? bonusParts.join('　') : '本次没有额外加成';
  elements.nextScenarioButton.textContent = game.scenario.id === 'simple' ? '试玩杠上局' : '回到顺水局';
  elements.resultDialog.showModal();
}

function startScenario(scenarioId, seed) {
  if (elements.resultDialog.open) elements.resultDialog.close();
  game.reset({ scenario: scenarioId, seed });
  playSound('select');
}

elements.actionButton.addEventListener('click', () => {
  const snapshot = game.snapshot();
  if (snapshot.selectedTiles.length === 0 && snapshot.swapsLeft === 0) {
    const result = game.concede();
    if (result.ok) {
      playSound('error');
      showToast('本副流局，换个牌谱再试');
    }
    return;
  }
  const result = game.performSelectionAction();
  if (result.ok) {
    playSound(result.drawn || result.supplement ? 'swap' : 'lock');
    showToast(game.lastEvent.text);
  } else {
    playSound('error');
    showToast(result.reason);
  }
});

elements.clearButton.addEventListener('click', () => {
  game.clearSelection();
  playSound('select');
});

elements.huButton.addEventListener('click', () => {
  const result = game.declareHu();
  if (!result.ok) {
    playSound('error');
    showToast(result.reason);
    return;
  }
  playSound('hu');
  window.setTimeout(() => showWin(result), 180);
});

elements.scenarios.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-scenario]');
  if (!button) return;
  const randomSeed = button.dataset.scenario === 'random' ? Math.floor(Date.now() % 1_000_000_000) : undefined;
  startScenario(button.dataset.scenario, randomSeed);
});

elements.soundButton.addEventListener('click', () => {
  audioEnabled = !audioEnabled;
  elements.soundButton.setAttribute('aria-pressed', String(audioEnabled));
  elements.soundButton.setAttribute('aria-label', audioEnabled ? '关闭声音' : '打开声音');
  if (audioEnabled) playSound('select');
});

elements.helpButton.addEventListener('click', () => elements.helpDialog.showModal());
elements.closeHelpButton.addEventListener('click', () => elements.helpDialog.close());
elements.replayButton.addEventListener('click', () => startScenario(game.scenario.id, game.scenario.id === 'random' ? game.seed : undefined));
elements.nextScenarioButton.addEventListener('click', () => startScenario(game.scenario.id === 'simple' ? 'kong' : 'simple'));

for (const dialog of [elements.helpDialog, elements.resultDialog]) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && dialog === elements.helpDialog) dialog.close();
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.helpDialog.open && !elements.resultDialog.open) game.clearSelection();
  if (event.key.toLowerCase() === 'h' && game.canHu() && !elements.resultDialog.open) elements.huButton.click();
});

await platform.initialize();
game.subscribe(render);
render(game.snapshot());
requestAnimationFrame(() => {
  platform.signalFirstFrame();
  platform.signalReady();
  document.documentElement.dataset.ready = 'true';
});

window.__demo = {
  game,
  getSnapshot: () => game.snapshot(),
  startScenario,
  version: '0.1.0',
};
