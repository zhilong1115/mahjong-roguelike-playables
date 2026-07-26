import {
  GROUPS,
  RunShopGame,
  tileCode,
  tileName,
} from '../core/index.mjs';
import {
  DEMO_CONFIG,
  FORTUNE_GENERALS,
  TEMPORARY_CHARMS,
} from '../content/index.mjs';
import { WebPlatformAdapter } from '../platforms/web-adapter.mjs';
import { createFortuneCanvas, createTileCanvas } from '../render/pixel-art.mjs';

const elements = Object.fromEntries(
  [...document.querySelectorAll('[id]')].map((element) => [element.id, element]),
);

const phaseDialogs = [
  elements['hand-result-dialog'],
  elements['shop-dialog'],
  elements['round-fail-dialog'],
  elements['run-summary-dialog'],
];

const CARD_GLYPHS = Object.freeze({
  azureEnvoy: '龙',
  ladyConcord: '心',
  glyphWarden: '镇',
  tailwind: '风',
  carving: '刻',
  doubleJoy: '喜',
  reserve: '余',
});

const platform = new WebPlatformAdapter();
const game = new RunShopGame();

let audioContext = null;
let lastEvent = null;
let toastTimer = null;

function ensureAudio() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioContext = new AudioContextClass();
  }
  if (audioContext?.state === 'suspended') audioContext.resume();
  return audioContext;
}

function tone(frequency, duration = .055, type = 'square', volume = .025, delay = 0) {
  const context = ensureAudio();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime + delay;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
}

function playSound(type) {
  if (type === 'select') tone(620, .035, 'square', .018);
  if (type === 'swap') {
    tone(330, .05, 'triangle', .03);
    tone(520, .055, 'triangle', .03, .055);
  }
  if (type === 'reveal') {
    tone(500, .055, 'square', .025);
    tone(740, .075, 'square', .025, .06);
  }
  if (type === 'error') tone(145, .14, 'sawtooth', .025);
  if (type === 'purchase') {
    tone(440, .07, 'square', .03);
    tone(660, .08, 'square', .03, .07);
    tone(880, .1, 'square', .025, .14);
  }
  if (type === 'hu') {
    [523, 659, 784, 1046].forEach((frequency, index) => {
      tone(frequency, .17, 'triangle', .035, index * .08);
    });
  }
}

function showToast(message) {
  if (!message) return;
  window.clearTimeout(toastTimer);
  elements['toast-stack'].replaceChildren();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  elements['toast-stack'].appendChild(toast);
  toastTimer = window.setTimeout(() => toast.remove(), 1700);
}

function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
}

function closePhaseDialogs(except = null) {
  phaseDialogs.forEach((dialog) => {
    if (dialog !== except) closeDialog(dialog);
  });
}

function openDialog(dialog) {
  if (dialog.open) return;
  closePhaseDialogs(dialog);
  dialog.showModal();
}

function rewardForReveals(revealCount) {
  return DEMO_CONFIG.goldByRevealCount[revealCount] ?? 0;
}

function routeCopy(revealCount) {
  if (revealCount === 0) return { icon: '藏', name: '门清路线', short: '门清', reward: 3 };
  if (revealCount === 1) return { icon: '运', name: '一签开运', short: '开运一签', reward: 1 };
  return { icon: '旺', name: '双签开运', short: '开运双签', reward: 0 };
}

function makeCard(item, { charm = false, preview = false, triggered = false } = {}) {
  const card = document.createElement('div');
  card.className = `fortune-card${charm ? ' is-charm' : ''}${preview ? ' is-preview' : ''}${triggered ? ' is-triggered' : ''}`;
  const glyph = CARD_GLYPHS[item.id] || item.name[0];
  card.appendChild(createFortuneCanvas(glyph, charm
    ? { paper: '#dce7e9', ink: '#285776', edge: '#172b36' }
    : { paper: '#e4cc91', ink: '#7e2d27', edge: '#3a2114' }));
  const name = document.createElement('b');
  name.textContent = item.name;
  card.appendChild(name);
  card.title = item.description;
  card.setAttribute('aria-label', `${preview ? '下一张' : ''}${charm ? '灵签' : '福将'}：${item.name}，${item.description}`);
  return card;
}

function makeEmptyCard(label) {
  const card = document.createElement('div');
  card.className = 'fortune-card is-empty';
  card.textContent = '+';
  card.setAttribute('aria-label', label);
  return card;
}

function renderCardRails(snapshot, isNewEvent) {
  elements['guardian-slots'].replaceChildren();
  if (snapshot.ownedGeneral) {
    const bonusTriggered = isNewEvent
      && snapshot.canHu
      && snapshot.bestHu?.bonusEvents.some((event) => event.source === 'general' && event.value > 0);
    elements['guardian-slots'].appendChild(makeCard(snapshot.ownedGeneral, { triggered: bonusTriggered }));
  }
  const guardianCount = snapshot.ownedGeneral ? 1 : 0;
  for (let index = guardianCount; index < 5; index += 1) {
    elements['guardian-slots'].appendChild(makeEmptyCard(`空福将位 ${index + 1}`));
  }

  elements['charm-slots'].replaceChildren();
  snapshot.temporaryCharms.forEach((charm, index) => {
    const triggered = isNewEvent && snapshot.lastEvent?.type === 'reveal'
      && index === snapshot.temporaryCharms.length - 1;
    elements['charm-slots'].appendChild(makeCard(charm, { charm: true, triggered }));
  });
  if (snapshot.revealCount < DEMO_CONFIG.maxRevealsPerHand) {
    const nextCharmId = snapshot.hand.charmOrder[snapshot.revealCount];
    const nextCharm = TEMPORARY_CHARMS[nextCharmId];
    if (nextCharm) elements['charm-slots'].appendChild(makeCard(nextCharm, { charm: true, preview: true }));
  }
  while (elements['charm-slots'].children.length < DEMO_CONFIG.maxRevealsPerHand) {
    elements['charm-slots'].appendChild(makeEmptyCard('空灵签位'));
  }
}

function makeGroupCard(group) {
  const card = document.createElement('div');
  card.className = `revealed-group is-${group.kind}`;
  const tiles = document.createElement('span');
  tiles.className = 'mini-tiles';
  group.tiles.forEach((tile) => tiles.appendChild(createTileCanvas(tile, 'mini-tile')));
  const copy = document.createElement('span');
  copy.className = 'group-copy';
  const name = document.createElement('b');
  name.textContent = GROUPS[group.kind]?.name || '成组';
  const state = document.createElement('small');
  state.textContent = '已亮 · 锁定';
  copy.append(name, state);
  card.append(tiles, copy);
  card.setAttribute('aria-label', `已亮${name.textContent}：${group.tiles.map(tileName).join('、')}`);
  return card;
}

function renderRevealRack(snapshot) {
  elements['revealed-groups'].replaceChildren();
  snapshot.revealedGroups.forEach((group) => {
    elements['revealed-groups'].appendChild(makeGroupCard(group));
  });
  for (let index = snapshot.revealedGroups.length; index < DEMO_CONFIG.maxRevealsPerHand; index += 1) {
    const slot = document.createElement('div');
    slot.className = 'group-slot';
    slot.textContent = index === 0 ? '亮一组 · 抽灵签' : '第二个亮牌位';
    slot.setAttribute('aria-hidden', 'true');
    elements['revealed-groups'].appendChild(slot);
  }
  elements['reveal-counter'].textContent = `${snapshot.revealCount} / ${DEMO_CONFIG.maxRevealsPerHand}`;
}

function isSuggestedDiscard(snapshot, tile) {
  if (snapshot.canHu) return false;
  return snapshot.hand.suggestedDiscards?.[snapshot.discardCount] === tileCode(tile);
}

function renderHand(snapshot) {
  const focusedId = document.activeElement?.dataset?.tileId;
  elements['hand-zone'].replaceChildren();
  snapshot.looseTiles.forEach((tile) => {
    const selected = snapshot.selectedIds.includes(tile.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tile-button${selected ? ' is-selected' : ''}${isSuggestedDiscard(snapshot, tile) ? ' is-suggested' : ''}`;
    button.dataset.tileId = tile.id;
    button.dataset.tileCode = tileCode(tile);
    button.setAttribute('aria-label', `${tileName(tile)}${selected ? '，已选择' : ''}`);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    button.appendChild(createTileCanvas(tile));
    button.addEventListener('click', () => {
      const changed = game.toggleTile(tile.id);
      playSound(changed ? 'select' : 'error');
    });
    elements['hand-zone'].appendChild(button);
  });
  if (focusedId) {
    requestAnimationFrame(() => {
      elements['hand-zone'].querySelector(`[data-tile-id="${CSS.escape(focusedId)}"]`)?.focus({ preventScroll: true });
    });
  }
}

function selectionTitle(snapshot) {
  const selectedCount = snapshot.selectedIds.length;
  const preview = snapshot.selectionPreview;
  if (selectedCount === 0) {
    if (snapshot.canHu) return '已经成牌：胡，或继续亮牌冲分';
    return '请选择麻将牌';
  }
  if (!preview.valid) return preview.reason || '这组牌不能这样打';
  if (preview.kind === 'swap') return `换掉 ${tileName(snapshot.selectedTiles[0])}`;
  return `亮出${preview.name || GROUPS[preview.kind]?.name || '组合'}`;
}

function selectionDetail(snapshot) {
  const selectedCount = snapshot.selectedIds.length;
  const preview = snapshot.selectionPreview;
  if (selectedCount === 0) {
    return snapshot.canHu
      ? `现在胡得 ${rewardForReveals(snapshot.revealCount)} 待结算金；亮牌会抽灵签`
      : '1 张换牌，2–4 张亮出有效组合';
  }
  if (!preview.valid) return '取消后重新选择，不会消耗行动';
  if (preview.kind === 'swap') return `摸 1 张固定牌 · 剩 ${snapshot.actionsRemaining - 1} 行动`;
  const charm = preview.charm;
  if (charm && preview.scoreDelta !== null) {
    const sign = preview.scoreDelta >= 0 ? '+' : '';
    return `${charm.name} · 预计 ${sign}${preview.scoreDelta} 分 → ${preview.projectedHu.total}`;
  }
  return charm
    ? `将抽到 ${charm.name}：${charm.description}`
    : '亮牌会锁定本组，并抽一张本副灵签';
}

function renderActions(snapshot) {
  const preview = snapshot.selectionPreview;
  const selectedCount = snapshot.selectedIds.length;
  const playable = snapshot.status === 'playing' || snapshot.status === 'hu-ready';
  elements['selection-title'].textContent = selectionTitle(snapshot);
  elements['selection-detail'].textContent = selectionDetail(snapshot);
  elements['selection-title'].parentElement.classList.toggle('is-valid', selectedCount > 0 && preview.valid);
  elements['selection-title'].parentElement.classList.toggle('is-invalid', selectedCount > 0 && !preview.valid);
  elements['clear-button'].disabled = !playable || selectedCount === 0;
  elements['action-button'].disabled = !playable || selectedCount === 0 || !preview.valid;

  if (!selectedCount) {
    elements['action-button'].textContent = snapshot.canHu ? '选组合开运' : '选择牌';
  } else if (preview.kind === 'swap') {
    elements['action-button'].textContent = '换这张牌';
  } else if (preview.valid && snapshot.revealCount === 0) {
    elements['action-button'].textContent = '亮出开运（少 2 金）';
  } else if (preview.valid) {
    elements['action-button'].textContent = '再亮一组（本副 0 金）';
  } else {
    elements['action-button'].textContent = '组合无效';
  }

  elements['hu-button'].disabled = !snapshot.canHu || !playable;
  elements['hu-button'].textContent = snapshot.canHu
    ? `胡！+${rewardForReveals(snapshot.revealCount)} 金`
    : '还不能胡';
  elements['hu-button'].classList.toggle('is-ready', snapshot.canHu && playable);
}

function coachCopy(snapshot) {
  if (snapshot.roundNumber === 1 && snapshot.handNumber === 1) {
    if (!snapshot.canHu) return '点一下有“换”标记的孤张，再按“换这张牌”。第一步只要几秒。';
    if (snapshot.revealCount === 0) return '一组不亮，直接胡：本副获得 3 枚待结算金币。也可以亮牌开运冲分。';
    return '你已经开运：灵签会抬高得分，但门清金币已经减少。';
  }
  if (snapshot.roundNumber === 1 && snapshot.handNumber === 2 && snapshot.canHu && snapshot.revealCount === 0) {
    return '这副试试选择一个对子亮出：抽“灵签”，亲手感受用金币换分数。';
  }
  if (snapshot.roundNumber === 1 && snapshot.handNumber === 3) {
    return '第三副自由选择。三副过关后，待结算金币才会入账并进入百宝阁。';
  }
  if (snapshot.roundNumber === 2 && snapshot.ownedGeneral) {
    return `${snapshot.ownedGeneral.name}整轮随行：${snapshot.ownedGeneral.description}完成三副即结束试玩。`;
  }
  return snapshot.canHu
    ? '已经成牌。现在可以胡，也可以最多亮两组，抽灵签继续提高这副分数。'
    : '先换孤张凑成完整胡牌。所有亮出的组合都会成为最终牌型的硬约束。';
}

function renderTableMessage(snapshot) {
  const message = elements['event-title'].parentElement;
  message.classList.toggle('is-valid', snapshot.canHu);
  if (snapshot.canHu) {
    elements['event-title'].textContent = snapshot.lastEvent?.type === 'reveal'
      ? `${snapshot.lastEvent.charm?.name || '灵签'}已经生效，还可以胡`
      : `可以胡了：${snapshot.bestHu.patterns.join(' · ')}`;
    elements['event-detail'].textContent = snapshot.revealCount === 0
      ? '门清拿 3 金币；亮牌抽签、提高本副得分'
      : `开运路线 · 当前胡牌 ${snapshot.bestHu.total} 分 · ${rewardForReveals(snapshot.revealCount)} 金币`;
  } else if (snapshot.lastEvent?.type === 'swap') {
    elements['event-title'].textContent = snapshot.lastEvent.text;
    elements['event-detail'].textContent = '继续观察手牌，或按提示换掉下一张孤牌';
  } else if (snapshot.lastEvent?.type === 'error') {
    elements['event-title'].textContent = snapshot.lastEvent.text;
    elements['event-detail'].textContent = '这次不会扣除行动次数';
  } else {
    elements['event-title'].textContent = '先换一张，凑成完整胡牌';
    elements['event-detail'].textContent = `本副牌谱：${snapshot.hand.name} · 可用 ${snapshot.actionsRemaining} 次行动`;
  }
}

function renderHud(snapshot) {
  const handTotal = snapshot.round.hands.length;
  const route = routeCopy(snapshot.revealCount);
  const percent = Math.min(100, (snapshot.roundScore / snapshot.target) * 100);

  elements['compact-hand'].textContent = `${snapshot.handNumber}/${handTotal}`;
  elements['compact-score'].textContent = snapshot.roundScore;
  elements['compact-coins'].textContent = snapshot.roundPendingGold
    ? `${snapshot.gold}+${snapshot.roundPendingGold}`
    : snapshot.gold;
  elements['round-chip'].textContent = snapshot.roundNumber === 1 ? '壹' : '贰';
  elements['round-name'].textContent = `第${snapshot.roundNumber === 1 ? '一' : '二'}轮 · ${snapshot.round.name}`;
  elements['hand-progress-label'].textContent = `第 ${snapshot.handNumber} 副 / 共 ${handTotal} 副`;
  elements['round-score'].textContent = snapshot.roundScore;
  elements['round-target'].textContent = snapshot.target;
  elements['score-meter'].style.width = `${percent}%`;
  elements['target-hint'].textContent = `待结算：${snapshot.roundPendingGold} 金 · 三副过关才入账`;
  elements['actions-left'].textContent = snapshot.actionsRemaining;
  elements['reveals-left'].textContent = DEMO_CONFIG.maxRevealsPerHand - snapshot.revealCount;
  elements['coin-total'].textContent = snapshot.gold;
  const coinLabel = elements['coin-total'].nextElementSibling;
  if (coinLabel) coinLabel.textContent = snapshot.roundPendingGold ? `金币 · 待+${snapshot.roundPendingGold}` : '金币';
  elements['route-badge'].classList.toggle('is-clean', snapshot.revealCount === 0);
  elements['route-badge'].classList.toggle('is-open', snapshot.revealCount > 0);
  elements['route-badge'].querySelector('.route-icon').textContent = route.icon;
  const routeText = elements['route-badge'].querySelector('span:last-child');
  routeText.querySelector('b').textContent = route.name;
  routeText.querySelector('small').textContent = snapshot.canHu
    ? `现在胡：+${route.reward} 待结算金`
    : `成牌后：+${route.reward} 待结算金`;
  elements['coach-copy'].textContent = coachCopy(snapshot);
  elements['hand-route'].textContent = snapshot.canHu ? `${route.short} · 可胡` : `${route.short} · 等待成牌`;

  elements['hand-pips'].replaceChildren();
  for (let index = 0; index < handTotal; index += 1) {
    const pip = document.createElement('span');
    pip.className = `hand-pip${index < snapshot.handResults.length ? ' is-complete' : ''}${index === snapshot.handNumber - 1 && snapshot.status !== 'shop' ? ' is-current' : ''}`;
    elements['hand-pips'].appendChild(pip);
  }

  if (snapshot.bestHu) {
    elements['hu-name'].textContent = snapshot.bestHu.patterns.join(' · ');
    elements['base-score'].textContent = snapshot.bestHu.baseChips;
    elements['score-mult'].textContent = Number(snapshot.bestHu.multiplier).toFixed(snapshot.bestHu.multiplier % 1 ? 1 : 0);
    elements['hand-score'].textContent = snapshot.bestHu.total;
  } else {
    elements['hu-name'].textContent = '尚未成牌';
    elements['base-score'].textContent = '0';
    elements['score-mult'].textContent = '1';
    elements['hand-score'].textContent = '0';
  }
}

function resultBreakdown(result) {
  const scoring = result.scoring;
  const parts = [
    { text: `胡牌底分 +${scoring.huBase}` },
    { text: `组合 +${scoring.groupChips}` },
  ];
  scoring.bonusEvents.forEach((event) => {
    parts.push({ text: `${event.name} +${event.value}` });
  });
  scoring.patterns.forEach((pattern) => {
    const bonus = pattern === '普通胡' ? 0 : scoring.patternBonus;
    parts.push({ text: bonus ? `${pattern} · 番势` : pattern, pattern: true });
  });
  return parts;
}

function renderHandResult(snapshot) {
  const result = snapshot.lastHandResult;
  if (!result) return;
  const route = routeCopy(result.revealCount);
  elements['result-hand-name'].textContent = result.scoring.patterns.join(' · ');
  elements['result-score'].textContent = result.score;
  elements['result-breakdown'].replaceChildren();
  resultBreakdown(result).forEach((part) => {
    const chip = document.createElement('span');
    chip.className = `breakdown-chip${part.pattern ? ' is-pattern' : ''}`;
    chip.textContent = part.text;
    elements['result-breakdown'].appendChild(chip);
  });
  elements['result-route'].textContent = route.short;
  elements['result-coins'].textContent = `+${result.gold}`;
  elements['result-round-score'].textContent = snapshot.roundScore;
  elements['next-hand-button'].textContent = snapshot.handNumber < snapshot.round.hands.length
    ? `下一副 ${snapshot.handNumber + 1}/${snapshot.round.hands.length}`
    : snapshot.roundNumber === 1 ? '三副结算 · 去百宝阁' : '完成第二轮';
}

function shopCard(item, snapshot) {
  const bought = snapshot.ownedGeneralId === item.id;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `shop-card${bought ? ' is-bought' : ''}`;
  button.disabled = Boolean(snapshot.ownedGeneralId) || snapshot.gold < item.price;
  button.dataset.generalId = item.id;
  button.appendChild(createFortuneCanvas(CARD_GLYPHS[item.id] || item.name[0]));
  const title = document.createElement('h3');
  title.textContent = item.name;
  const description = document.createElement('p');
  description.textContent = item.description;
  const price = document.createElement('span');
  price.className = 'price-badge';
  price.textContent = bought ? '已购买' : `${item.price} 金币`;
  button.append(title, description, price);
  button.setAttribute('aria-label', `${item.name}，${item.description}，价格 ${item.price} 金币${button.disabled && !bought ? '，当前不可购买' : ''}`);
  button.addEventListener('click', () => {
    const result = game.purchaseGeneral(item.id);
    if (result.ok) {
      playSound('purchase');
      platform.haptic([12, 35, 18]);
      showToast(`${item.name}加入随行，第二轮整局生效`);
    } else {
      playSound('error');
      showToast(result.reason);
    }
  });
  return button;
}

function renderShop(snapshot) {
  elements['shop-coins'].textContent = snapshot.gold;
  elements['shop-owned'].replaceChildren();
  if (snapshot.ownedGeneral) {
    const chip = document.createElement('span');
    chip.className = 'owned-chip';
    chip.textContent = `${snapshot.ownedGeneral.name} · 整局生效`;
    elements['shop-owned'].appendChild(chip);
  } else {
    const chip = document.createElement('span');
    chip.className = 'owned-chip';
    chip.textContent = '尚未选择 · 本 Demo 必须买一位';
    elements['shop-owned'].appendChild(chip);
  }
  elements['shop-grid'].replaceChildren();
  snapshot.shopItems.forEach((item) => elements['shop-grid'].appendChild(shopCard(item, snapshot)));
  elements['shop-message'].textContent = snapshot.ownedGeneral
    ? `${snapshot.ownedGeneral.name}已加入；进入第二轮后会在首次成牌时强提示触发。`
    : `本轮 ${snapshot.lastBankedGold} 枚待结算金币已入账；三选一，整局生效。`;
  elements['leave-shop-button'].disabled = !snapshot.ownedGeneral;
}

function renderSummary(snapshot) {
  const totalScore = snapshot.completedRounds.reduce((sum, round) => sum + round.score, 0);
  const generalName = snapshot.ownedGeneral?.name || '无';
  elements['summary-stats'].replaceChildren();
  [
    ['两轮总分', totalScore],
    ['剩余金币', snapshot.gold],
    ['随行福将', generalName],
  ].forEach(([label, value]) => {
    const stat = document.createElement('span');
    const small = document.createElement('small');
    small.textContent = label;
    const bold = document.createElement('b');
    bold.textContent = value;
    stat.append(small, bold);
    elements['summary-stats'].appendChild(stat);
  });
}

function renderDialogs(snapshot) {
  if (snapshot.status === 'hand-won') {
    renderHandResult(snapshot);
    openDialog(elements['hand-result-dialog']);
  } else if (snapshot.status === 'shop') {
    renderShop(snapshot);
    openDialog(elements['shop-dialog']);
  } else if (snapshot.status === 'round-failed') {
    elements['fail-copy'].textContent = snapshot.lastEvent?.text || '本轮失败，待结算奖励已经清空。';
    openDialog(elements['round-fail-dialog']);
  } else if (snapshot.status === 'run-complete') {
    renderSummary(snapshot);
    openDialog(elements['run-summary-dialog']);
  } else {
    closePhaseDialogs();
  }
}

function render(snapshot) {
  const eventKey = `${snapshot.lastEvent?.type}:${snapshot.lastEvent?.text}`;
  const isNewEvent = eventKey !== lastEvent;
  renderCardRails(snapshot, isNewEvent);
  renderRevealRack(snapshot);
  renderHand(snapshot);
  renderActions(snapshot);
  renderTableMessage(snapshot);
  renderHud(snapshot);
  renderDialogs(snapshot);
  lastEvent = eventKey;
}

function actOnSelection() {
  const result = game.performSelectionAction();
  if (!result.ok) {
    playSound('error');
    showToast(result.reason);
    return;
  }
  playSound(result.kind === 'swap' ? 'swap' : 'reveal');
  platform.haptic(result.kind === 'swap' ? 9 : [10, 28, 13]);
  if (result.kind !== 'swap') showToast(`${result.charm.name}：${result.charm.description}`);
  if (result.automaticSettlement) playSound('hu');
}

elements['clear-button'].addEventListener('click', () => game.clearSelection());
elements['action-button'].addEventListener('click', actOnSelection);
elements['hu-button'].addEventListener('click', () => {
  const result = game.declareHu();
  if (result.ok) {
    playSound('hu');
    platform.haptic([18, 32, 18, 32, 28]);
  } else {
    playSound('error');
    showToast(result.reason);
  }
});
elements['next-hand-button'].addEventListener('click', () => game.advance());
elements['leave-shop-button'].addEventListener('click', () => {
  const result = game.startSecondRound();
  if (!result.ok) showToast(result.reason);
});
elements['retry-round-button'].addEventListener('click', () => game.restartRound());
elements['replay-run-button'].addEventListener('click', () => game.reset());
elements['restart-button'].addEventListener('click', () => {
  game.reset();
  showToast('已从第一轮重新开始');
});
elements['help-button'].addEventListener('click', () => elements['help-dialog'].showModal());
elements['close-help-button'].addEventListener('click', () => elements['help-dialog'].close());

phaseDialogs.forEach((dialog) => {
  dialog.addEventListener('cancel', (event) => event.preventDefault());
});

game.subscribe(render);
render(game.snapshot());
