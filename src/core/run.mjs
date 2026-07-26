/**
 * 一局（Run）的状态机。结构见 docs/decisions/0013：
 *
 *   一局 = 三圈（东 / 南 / 西）
 *   一圈 = 三关（闲局 / 庄局 / 圈主）
 *   一关 = 2 副牌打一个累计目标，过关进百宝阁
 *
 * 状态：
 *   blind-select 选关屏：三关并排，闲庄可跳
 *   playing      正在换牌 / 亮组
 *   hu-ready     结构已合法，可以随时胡
 *   charm-draft  亮组后三签选一
 *   hand-won     本副已结算
 *   hand-failed  本副流局
 *   blind-cleared 本关达标
 *   shop         百宝阁
 *   run-over     本关未达标，本局结束
 *   run-complete 三圈通关
 *
 * 只处理规则与状态，不碰 DOM。
 */

import {
  ANTES,
  BLIND_KINDS,
  BLIND_ORDER,
  CODEX,
  CODEX_BY_PATTERN,
  CODEX_MAX_LEVEL,
  CONFIG,
  DECKS,
  GENERAL_LIST,
  blindIndexOf,
  draftCharms,
  getItem,
  listItems,
  pickBoss,
  rollTag,
  shelfFor,
} from '../content/index.mjs';
import { createSolvableDeal } from './deal.mjs';
import {
  classifySelection,
  findHuSolutions,
  physicalCount,
  routeRemains,
  structuralCount,
} from './patterns.mjs';
import { scoreHand } from './scoring.mjs';
import { tilesToChange } from './shanten.mjs';
import { createSeededRng, sortTiles, tileKey } from './tiles.mjs';

export class Run {
  /**
   * @param {object} [options]
   * @param {number} [options.seed]
   * @param {string} [options.deckId]
   * @param {typeof CONFIG} [options.config]
   * @param {typeof ANTES} [options.antes]
   */
  constructor({ seed = 0, deckId = 'plain', config = CONFIG, antes = ANTES } = {}) {
    this.baseline = config;
    this.antes = antes;
    this.listeners = new Set();
    this.start(seed || Math.floor(Math.random() * 1e9), deckId);
  }

  /* ---------------- 生命周期 ---------------- */

  start(seed = this.seed, deckId = this.deckId ?? 'plain') {
    this.seed = seed >>> 0;
    this.deckId = DECKS[deckId] ? deckId : 'plain';
    const deck = DECKS[this.deckId];

    this.gold = deck.modifier.startingGold ?? this.baseline.startingGold;
    this.generalIds = deck.modifier.startingGeneral ? [deck.modifier.startingGeneral] : [];
    this.codexLevels = {};
    this.bones = {};
    this.seals = {};
    this.papers = [];
    this.back = deck.back;
    this.suitBias = null;

    this.anteIndex = 0;
    this.blindKind = 'small';
    this.handIndex = 0;
    this.clearedBlinds = 0;
    this.blindOutcomes = {};      // `${anteIndex}:${kind}` → 'cleared' | 'skipped'
    this.bossIds = this.rollBosses();
    this.tags = [];               // 待生效的手气
    this.pendingFreeBuy = 0;
    this.pendingExtraSwaps = 0;
    this.pendingFreeCharms = 0;

    this.totalScore = 0;
    this.completedBlinds = [];
    this.groupSerial = 1;
    this.shop = null;
    this.resetBlindProgress();
    this.clearHand();
    this.status = 'blind-select';
    this.lastEvent = { type: 'run-start', text: `${DECKS[this.deckId].name}牌组 · 东圈` };
    this.emit();
    return this.snapshot();
  }

  rollBosses() {
    const rng = createSeededRng((this.seed + 60013) >>> 0);
    const used = [];
    return this.antes.map(() => {
      const id = pickBoss(rng, used);
      used.push(id);
      return id;
    });
  }

  resetBlindProgress() {
    this.blindScore = 0;
    this.pendingGold = 0;
    this.handResults = [];
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    if (!this.listeners.size) return;
    const state = this.snapshot();
    for (const listener of this.listeners) listener(state);
  }

  /* ---------------- 圈与关 ---------------- */

  currentAnte() {
    return this.antes[Math.min(this.anteIndex, this.antes.length - 1)];
  }

  currentBoss() {
    return getItem('boss', this.bossIds[this.anteIndex]);
  }

  blindTarget(kind = this.blindKind) {
    return this.currentAnte().targets[kind];
  }

  blindOutcome(anteIndex, kind) {
    return this.blindOutcomes[`${anteIndex}:${kind}`] ?? null;
  }

  /** 选关屏要显示的三张关卡卡片。 */
  blindCards() {
    const ante = this.currentAnte();
    return BLIND_ORDER.map((kind) => ({
      kind,
      ...BLIND_KINDS[kind],
      target: ante.targets[kind],
      boss: kind === 'boss' ? this.currentBoss() : null,
      outcome: this.blindOutcome(this.anteIndex, kind),
      current: kind === this.blindKind,
    }));
  }

  /** 牌组 + 圈主 + 手气叠加之后，这一关真正生效的参数。 */
  effectiveConfig() {
    const deck = DECKS[this.deckId].modifier;
    const boss = (this.blindKind === 'boss' && this.status !== 'blind-select')
      ? (this.currentBoss()?.modifier ?? {})
      : {};
    return {
      ...this.baseline,
      fortuneSlots: Math.max(
        1,
        (boss.fortuneSlots ?? this.baseline.fortuneSlots) + (deck.fortuneSlotsDelta ?? 0),
      ),
      swapsPerHand: Math.max(
        1,
        (boss.swapsPerHand ?? this.baseline.swapsPerHand)
        + (deck.swapsDelta ?? 0)
        + this.pendingExtraSwaps,
      ),
      goldPerEmptySlot: Math.max(
        0,
        this.baseline.goldPerEmptySlot + (deck.goldPerEmptySlotDelta ?? 0),
      ),
    };
  }

  /** 只在圈主关生效的规则，传给结算与发牌。 */
  activeModifiers() {
    if (this.blindKind !== 'boss') return {};
    return this.currentBoss()?.modifier ?? {};
  }

  get config() {
    return this.effectiveConfig();
  }

  /** 开始打当前这一关。 */
  selectBlind() {
    if (this.status !== 'blind-select') return { ok: false, reason: '现在不能开始' };
    this.handIndex = 0;
    this.resetBlindProgress();
    this.dealHand();
    this.emit();
    return { ok: true };
  }

  /** 跳过闲局或庄局，换一张手气。 */
  skipBlind() {
    if (this.status !== 'blind-select') return { ok: false, reason: '现在不能跳局' };
    if (!BLIND_KINDS[this.blindKind].skippable) return { ok: false, reason: '圈主不能跳' };

    const rng = createSeededRng(
      (this.seed + blindIndexOf(this.anteIndex, this.blindKind) * 7717 + 31) >>> 0,
    );
    const tagId = rollTag(rng);
    this.applyTag(tagId);
    this.blindOutcomes[`${this.anteIndex}:${this.blindKind}`] = 'skipped';
    this.lastEvent = { type: 'skip', text: `跳过${BLIND_KINDS[this.blindKind].name}，得到${getItem('tag', tagId).name}`, tagId };
    this.advanceBlindPointer();
    this.emit();
    return { ok: true, tagId };
  }

  applyTag(tagId) {
    const tag = getItem('tag', tagId);
    if (!tag) return;
    if (tag.timing !== 'instant') this.tags = [...this.tags, tagId];
    if (tag.effect.kind === 'gold') this.gold += tag.effect.value;
    if (tag.effect.kind === 'extraSwaps') this.pendingExtraSwaps += tag.effect.value;
    if (tag.effect.kind === 'freePurchase') this.pendingFreeBuy += tag.effect.value;
    if (tag.effect.kind === 'freeCharm') this.pendingFreeCharms += tag.effect.value;
  }

  /** 从待生效栏移除一张已经消费的手气。 */
  consumeTag(tagId) {
    const index = this.tags.indexOf(tagId);
    if (index < 0) return false;
    this.tags = this.tags.filter((_, itemIndex) => itemIndex !== index);
    return true;
  }

  /** 指针推进到下一关；一圈打完就进下一圈。 */
  advanceBlindPointer() {
    const index = BLIND_ORDER.indexOf(this.blindKind);
    if (index < BLIND_ORDER.length - 1) {
      this.blindKind = BLIND_ORDER[index + 1];
      this.status = 'blind-select';
      return;
    }
    if (this.anteIndex >= this.antes.length - 1) {
      this.status = 'run-complete';
      this.lastEvent = { type: 'run-complete', text: `通关！总分 ${this.totalScore}` };
      return;
    }
    this.anteIndex += 1;
    this.blindKind = BLIND_ORDER[0];
    this.status = 'blind-select';
  }

  /* ---------------- 发牌 ---------------- */

  handSeed() {
    return (this.seed
      + this.anteIndex * 104729
      + BLIND_ORDER.indexOf(this.blindKind) * 15991
      + this.handIndex * 7907) >>> 0;
  }

  improvedKinds() {
    return [...new Set([...Object.keys(this.bones), ...Object.keys(this.seals)])];
  }

  clearHand() {
    this.looseTiles = [];
    this.wall = [];
    this.discard = [];
    this.revealedGroups = [];
    this.selectedIds = new Set();
    this.charmIds = [];
    this.charmGold = 0;
    this.draft = null;
    this.usedSealKinds = new Set();
    this.lastHandResult = null;
    this.flavor = null;
    this.swapsRemaining = 0;
  }

  dealHand() {
    const ante = this.currentAnte();
    const modifiers = this.activeModifiers();
    const config = this.effectiveConfig();
    const flavorIndex = (BLIND_ORDER.indexOf(this.blindKind) * ante.handsPerBlind + this.handIndex)
      % ante.flavors.length;

    const deal = createSolvableDeal({
      handId: `a${this.anteIndex}${this.blindKind}h${this.handIndex}`,
      seed: this.handSeed(),
      flavorId: ante.flavors[flavorIndex],
      brokenTiles: ante.brokenTiles + (modifiers.extraBrokenTiles ?? 0),
      guaranteedKinds: this.improvedKinds(),
      suitBias: this.suitBias,
    });

    this.looseTiles = deal.looseTiles;
    this.wall = deal.wall;
    this.discard = [];
    this.flavor = deal.flavor;
    this.revealedGroups = [];
    this.selectedIds = new Set();
    this.swapsRemaining = config.swapsPerHand;
    this.charmIds = [];
    this.charmGold = 0;
    this.draft = null;
    this.usedSealKinds = new Set();
    this.lastHandResult = null;
    this.status = 'playing';
    this.lastEvent = { type: 'deal', text: `第 ${this.handIndex + 1} 副 · 目标 ${deal.flavor.name}` };

    // 手气「签气」：开局先白拿一张灵签
    if (this.pendingFreeCharms > 0) {
      const rng = createSeededRng((this.handSeed() + 4451) >>> 0);
      const [charmId] = draftCharms(rng, 'pair');
      this.charmIds = [charmId];
      this.pendingFreeCharms -= 1;
      this.consumeTag('charm');
      this.lastEvent = { type: 'tag-charm', text: `签气生效 · ${getItem('charm', charmId).name}`, charmId };
    }

    this.refreshStatus();
  }

  /* ---------------- 查询 ---------------- */

  isPlayable() {
    return this.status === 'playing' || this.status === 'hu-ready';
  }

  slotsUsed() {
    return this.revealedGroups.length;
  }

  emptySlots() {
    return Math.max(0, this.config.fortuneSlots - this.slotsUsed());
  }

  selectedTiles() {
    return this.looseTiles.filter((tile) => this.selectedIds.has(tile.id));
  }

  scoringInput(overrides = {}) {
    return {
      revealCount: this.slotsUsed(),
      emptySlots: this.emptySlots(),
      swapsRemaining: this.swapsRemaining,
      charmIds: this.charmIds,
      generalIds: this.generalIds,
      bones: this.bones,
      seals: this.seals,
      codexLevels: this.codexLevels,
      usedSealKinds: this.usedSealKinds,
      modifiers: this.activeModifiers(),
      config: this.config,
      ...overrides,
    };
  }

  bestHu(looseTiles = this.looseTiles, revealedGroups = this.revealedGroups, overrides = {}) {
    const solutions = findHuSolutions(looseTiles, revealedGroups);
    if (!solutions.length) return null;
    let best = null;
    for (const solution of solutions) {
      const scored = scoreHand({ solution, ...this.scoringInput(overrides) });
      if (!best || scored.total > best.total) best = { solution, ...scored };
    }
    return best;
  }

  distance() {
    return tilesToChange(this.looseTiles, this.revealedGroups);
  }

  /** 现在胡的话能拿多少待结算金：空开运位 + 没用完的换牌 + 财签。 */
  projectedGold() {
    const config = this.config;
    return this.emptySlots() * config.goldPerEmptySlot
      + this.swapsRemaining * config.goldPerUnusedSwap
      + this.charmGold;
  }

  refreshStatus() {
    if (this.status !== 'playing' && this.status !== 'hu-ready') return;
    if (this.bestHu()) {
      this.status = 'hu-ready';
      return;
    }
    if (this.swapsRemaining <= 0) {
      this.status = 'hand-failed';
      this.lastEvent = { type: 'hand-failed', text: '换牌用完，本副流局' };
      return;
    }
    this.status = 'playing';
  }

  /* ---------------- 选牌 ---------------- */

  toggleTile(tileId) {
    if (!this.isPlayable()) return false;
    if (!this.looseTiles.some((tile) => tile.id === tileId)) return false;
    if (this.selectedIds.has(tileId)) {
      this.selectedIds.delete(tileId);
    } else {
      if (this.selectedIds.size >= this.config.maxSwapTiles) {
        this.lastEvent = { type: 'error', text: `一次最多选 ${this.config.maxSwapTiles} 张` };
        this.emit();
        return false;
      }
      this.selectedIds.add(tileId);
    }
    this.lastEvent = { type: 'selection', text: '' };
    this.emit();
    return true;
  }

  clearSelection() {
    if (!this.selectedIds.size) return false;
    this.selectedIds.clear();
    this.lastEvent = { type: 'selection', text: '已取消选择' };
    this.emit();
    return true;
  }

  /** 换牌预览：选中的牌可以一次全换掉，消耗 1 次换牌机会。 */
  swapPreview() {
    if (!this.isPlayable()) return { valid: false, text: '本副已经结束' };
    const selected = this.selectedTiles();
    if (!selected.length) return { valid: false, text: '选中要换掉的牌，可以一次换多张' };
    if (this.swapsRemaining <= 0) return { valid: false, text: '换牌次数用完' };
    if (!this.wall.length) return { valid: false, text: '牌墙已空' };
    if (selected.length > this.wall.length) return { valid: false, text: '牌墙不够摸' };

    const sealNames = selected
      .map((tile) => this.seals[tileKey(tile)])
      .filter((sealId, index, list) => sealId && list.indexOf(sealId) === index)
      .map((sealId) => getItem('seal', sealId))
      .filter((seal) => seal?.trigger === 'swapOut')
      .map((seal) => seal.name);

    return {
      valid: true,
      count: selected.length,
      text: sealNames.length
        ? `换掉 ${selected.length} 张 · ${sealNames.join('、')}会触发`
        : `换掉 ${selected.length} 张，消耗 1 次换牌（还剩 ${this.swapsRemaining - 1} 次 · 每次没用掉换 ${this.config.goldPerUnusedSwap} 金）`,
    };
  }

  /** 亮组预览：2–4 张合法组合才能亮。 */
  revealPreview() {
    if (!this.isPlayable()) return { valid: false, text: '本副已经结束' };
    const selected = this.selectedTiles();
    if (selected.length < 2) return { valid: false, text: '选 2–4 张合法组合才能亮' };
    const analysis = classifySelection(selected);
    if (!analysis.valid || analysis.kind === 'swap') {
      return { valid: false, text: analysis.reason ?? '这些牌不能组成对子、顺子、刻子或杠' };
    }
    if (this.slotsUsed() >= this.config.fortuneSlots) {
      return { valid: false, kind: analysis.kind, text: '开运位已用完' };
    }
    if (analysis.kind === 'kong' && !this.wall.length) {
      return { valid: false, kind: 'kong', text: '牌墙已空，无法补牌' };
    }

    const provisional = { kind: analysis.kind, tiles: selected };
    const nextGroups = [...this.revealedGroups, provisional];
    if (!routeRemains(nextGroups)) {
      return { valid: false, kind: analysis.kind, text: '这样亮牌会堵死所有胡牌路线' };
    }
    let nextLoose = this.looseTiles.filter((tile) => !this.selectedIds.has(tile.id));
    if (analysis.kind === 'kong' && this.wall[0]) nextLoose = [...nextLoose, this.wall[0]];
    if (tilesToChange(nextLoose, nextGroups) > this.swapsRemaining) {
      return { valid: false, kind: analysis.kind, text: '亮了就换不回来，本副会胡不了' };
    }

    return {
      valid: true,
      kind: analysis.kind,
      name: analysis.name,
      text: `亮${analysis.name} · 花 1 个开运位 · 三签选一`,
    };
  }

  /* ---------------- 行动 ---------------- */

  /** 一次换掉所有选中的牌，只消耗 1 次换牌机会。 */
  swapSelected() {
    const preview = this.swapPreview();
    if (!preview.valid) {
      this.lastEvent = { type: 'error', text: preview.text };
      this.emit();
      return { ok: false, reason: preview.text };
    }

    const selected = this.selectedTiles();
    const selectedIds = new Set(selected.map((tile) => tile.id));
    this.selectedIds.clear();
    this.looseTiles = this.looseTiles.filter((tile) => !selectedIds.has(tile.id));
    this.discard.push(...selected);

    const drawn = [];
    for (let index = 0; index < selected.length; index += 1) {
      const tile = this.drawOne();
      if (tile) drawn.push(tile);
    }
    this.swapsRemaining -= 1;

    // 牌印 · 换出触发（一次换多张也只按一个牌种触发一次）
    const sealHit = this.fireSeal('swapOut', selected);
    if (sealHit?.seal.effect.kind === 'refundSwap') {
      this.swapsRemaining += sealHit.seal.effect.value;
    }

    this.lastEvent = {
      type: 'swap',
      text: sealHit
        ? `${sealHit.seal.name}触发 · 返还 1 次换牌`
        : `换掉 ${selected.length} 张，剩 ${this.swapsRemaining} 次换牌`,
      discarded: selected,
      drawn,
      sealHit: sealHit?.seal.id ?? null,
    };
    this.refreshStatus();
    this.emit();
    return { ok: true, kind: 'swap', discarded: selected, drawn, sealHit: sealHit?.seal.id ?? null };
  }

  /** 亮出选中的组合，占 1 个开运位，进入三签选一。 */
  revealSelected() {
    const preview = this.revealPreview();
    if (!preview.valid) {
      this.lastEvent = { type: 'error', text: preview.text };
      this.emit();
      return { ok: false, reason: preview.text };
    }

    const selected = this.selectedTiles();
    const selectedIds = new Set(selected.map((tile) => tile.id));
    this.selectedIds.clear();
    this.looseTiles = this.looseTiles.filter((tile) => !selectedIds.has(tile.id));

    const group = {
      id: `g${this.groupSerial++}`,
      kind: preview.kind,
      tiles: sortTiles(selected),
      revealed: true,
      charmId: null,
    };
    this.revealedGroups = [...this.revealedGroups, group];
    const supplement = preview.kind === 'kong' ? this.drawOne() : null;

    const sealHit = this.fireSeal('reveal', group.tiles);
    this.draft = {
      groupId: group.id,
      slotIndex: this.slotsUsed() - 1,
      charmIds: this.rollDraft(group.kind, 0),
      rerollsLeft: sealHit ? 1 : 0,
      rerollSource: sealHit?.seal.id ?? null,
      rolls: 0,
    };
    this.status = 'charm-draft';
    this.lastEvent = {
      type: 'reveal',
      text: sealHit ? `亮组 · ${sealHit.seal.name}给了一次重抽` : '亮组 · 三签选一',
      group,
      supplement,
      sealHit: sealHit?.seal.id ?? null,
    };
    this.emit();
    return { ok: true, kind: preview.kind, group, supplement, draft: this.draft };
  }

  drawOne() {
    const tile = this.wall.shift() ?? null;
    if (tile) this.looseTiles = sortTiles([...this.looseTiles, tile]);
    return tile;
  }

  fireSeal(trigger, tiles) {
    for (const tile of tiles) {
      const kind = tileKey(tile);
      const sealId = this.seals[kind];
      if (!sealId || this.usedSealKinds.has(kind)) continue;
      const seal = getItem('seal', sealId);
      if (!seal || seal.trigger !== trigger) continue;
      this.usedSealKinds.add(kind);
      return { seal, kind };
    }
    return null;
  }

  rollDraft(groupKind, rollIndex) {
    const rng = createSeededRng(
      (this.handSeed() + (this.slotsUsed() - 1) * 7919 + rollIndex * 5077 + 13) >>> 0,
    );
    return draftCharms(rng, groupKind);
  }

  rerollDraft() {
    if (this.status !== 'charm-draft' || !this.draft) return { ok: false, reason: '现在不需要重抽' };
    if (this.draft.rerollsLeft <= 0) return { ok: false, reason: '没有可用的重抽' };
    const group = this.revealedGroups.find((item) => item.id === this.draft.groupId);
    this.draft = {
      ...this.draft,
      rolls: this.draft.rolls + 1,
      rerollsLeft: this.draft.rerollsLeft - 1,
      charmIds: this.rollDraft(group?.kind ?? 'pair', this.draft.rolls + 1),
    };
    this.lastEvent = { type: 'draft-reroll', text: '三签已重抽' };
    this.emit();
    return { ok: true, charmIds: this.draft.charmIds };
  }

  chooseCharm(charmId) {
    if (this.status !== 'charm-draft' || !this.draft) return { ok: false, reason: '现在不需要选签' };
    if (!this.draft.charmIds.includes(charmId)) return { ok: false, reason: '这张灵签不在本次选择里' };
    const charm = getItem('charm', charmId);
    const group = this.revealedGroups.find((item) => item.id === this.draft.groupId);
    if (group) group.charmId = charmId;
    this.charmIds = [...this.charmIds, charmId];

    let goldNow = 0;
    for (const effect of charm.effects ?? []) {
      if (effect.kind === 'goldNow') goldNow += effect.value;
    }
    this.charmGold += goldNow;

    this.draft = null;
    this.status = 'playing';
    this.lastEvent = {
      type: 'charm',
      text: goldNow ? `${charm.name} · +${goldNow} 待结算金` : `${charm.name} 生效`,
      charmId,
      goldNow,
    };
    this.refreshStatus();
    this.emit();
    return { ok: true, charm, goldNow };
  }

  /* ---------------- 结算 ---------------- */

  declareHu() {
    if (this.status !== 'hu-ready') return { ok: false, reason: '现在还不能胡' };
    const best = this.bestHu();
    if (!best) return { ok: false, reason: '现在还不能胡' };

    for (const fired of best.sealsFired ?? []) this.usedSealKinds.add(fired.kind);
    const gold = best.gold + this.charmGold + this.emptySlots() * this.config.goldPerEmptySlot;
    const result = {
      handIndex: this.handIndex,
      anteIndex: this.anteIndex,
      blindKind: this.blindKind,
      flavor: this.flavor,
      patterns: best.patterns,
      chips: best.chips,
      mult: best.mult,
      score: best.total,
      total: best.total,
      steps: best.steps,
      solution: best.solution,
      gold,
      charmGold: this.charmGold,
      slotsUsed: this.slotsUsed(),
      emptySlots: this.emptySlots(),
      charmIds: [...this.charmIds],
      swapsRemaining: this.swapsRemaining,
    };

    this.blindScore += best.total;
    this.pendingGold += gold;
    this.handResults = [...this.handResults, result];
    this.lastHandResult = result;
    this.status = 'hand-won';
    this.lastEvent = { type: 'hu', text: `${best.patterns.join(' · ')}！`, result };
    this.emit();
    return { ok: true, ...result };
  }

  advance() {
    if (this.status !== 'hand-won' && this.status !== 'hand-failed') {
      return { ok: false, reason: '现在不能进入下一副' };
    }
    if (this.status === 'hand-failed') {
      this.handResults = [...this.handResults, {
        handIndex: this.handIndex,
        anteIndex: this.anteIndex,
        blindKind: this.blindKind,
        flavor: this.flavor,
        failed: true,
        score: 0,
        gold: 0,
        slotsUsed: this.slotsUsed(),
      }];
    }

    const ante = this.currentAnte();
    if (this.handIndex < ante.handsPerBlind - 1) {
      this.handIndex += 1;
      this.dealHand();
      this.emit();
      return { ok: true, status: this.status };
    }
    return this.finishBlind();
  }

  finishBlind() {
    const target = this.blindTarget();
    if (this.blindScore < target) {
      this.status = 'run-over';
      this.lastEvent = {
        type: 'run-over',
        text: `${BLIND_KINDS[this.blindKind].name}只打到 ${this.blindScore} / ${target}`,
      };
      this.emit();
      return { ok: true, failed: true };
    }

    const reward = BLIND_KINDS[this.blindKind].reward;
    const banked = this.pendingGold + reward;
    this.gold += banked;
    this.totalScore += this.blindScore;
    this.clearedBlinds += 1;
    this.blindOutcomes[`${this.anteIndex}:${this.blindKind}`] = 'cleared';
    this.completedBlinds = [...this.completedBlinds, {
      anteId: this.currentAnte().id,
      blindKind: this.blindKind,
      name: `${this.currentAnte().name}·${BLIND_KINDS[this.blindKind].name}`,
      score: this.blindScore,
      banked,
      reward,
      hands: [...this.handResults],
    }];
    this.lastBanked = banked;
    this.pendingGold = 0;
    this.pendingExtraSwaps = 0;   // 顺气只管一关
    this.tags = this.tags.filter((tagId) => tagId !== 'swap');

    const wasLastBlind = this.blindKind === BLIND_ORDER.at(-1);
    if (wasLastBlind && this.anteIndex >= this.antes.length - 1) {
      this.status = 'run-complete';
      this.lastEvent = { type: 'run-complete', text: `通关！总分 ${this.totalScore}`, banked };
      this.emit();
      return { ok: true, status: this.status };
    }

    this.shop = this.rollShop(0);
    this.status = 'shop';
    this.lastEvent = { type: 'shop', text: `本关达标，${banked} 金入账`, banked };
    this.emit();
    return { ok: true, status: this.status, banked };
  }

  /** 本局结束后重开一局（同牌组）。 */
  restart(seed = Math.floor(Math.random() * 1e9)) {
    return this.start(seed, this.deckId);
  }

  /** 试玩用：本关重来一次，不清空已入账金币与构筑。 */
  retryBlind() {
    if (this.status !== 'run-over') return { ok: false, reason: '现在不需要重试' };
    this.handIndex = 0;
    this.resetBlindProgress();
    this.status = 'blind-select';
    this.lastEvent = { type: 'retry', text: '重试本关' };
    this.emit();
    return { ok: true };
  }

  /* ---------------- 百宝阁 ---------------- */

  shopIndex() {
    return Math.max(0, this.clearedBlinds - 1);
  }

  rollShop(rerolls = 0) {
    const shelf = shelfFor(this.shopIndex());
    const rng = createSeededRng((this.seed + this.clearedBlinds * 31337 + rerolls * 977 + 7) >>> 0);
    const items = shelf.map((family, slotIndex) => {
      const pool = this.shopPool(family);
      if (!pool.length) return null;
      const item = pool[rng.int(pool.length)];
      return { slotIndex, family, id: item.id, price: item.price, sold: false };
    }).filter(Boolean);
    return { rerolls, items, pending: null };
  }

  /** 番谱定向保底：只出匹配下一圈预告、且还没满级的。 */
  shopPool(family) {
    if (family === 'codex') {
      const upcoming = this.antes[Math.min(this.anteIndex, this.antes.length - 1)].announced;
      const matching = upcoming
        .map((pattern) => CODEX_BY_PATTERN[pattern])
        .filter((book) => book && (this.codexLevels[book.pattern] ?? 0) < CODEX_MAX_LEVEL);
      return matching.length ? matching : [CODEX.pureSuit];
    }
    if (family === 'general') {
      return GENERAL_LIST.filter((item) => !this.generalIds.includes(item.id));
    }
    if (family === 'paper') {
      return listItems('paper').filter((item) => !this.papers.includes(item.id));
    }
    return listItems(family);
  }

  priceOf(offer) {
    return this.pendingFreeBuy > 0 ? 0 : offer.price;
  }

  buy(slotIndex) {
    if (this.status !== 'shop') return { ok: false, reason: '现在不在百宝阁' };
    const offer = this.shop.items.find((item) => item.slotIndex === slotIndex && !item.sold);
    if (!offer) return { ok: false, reason: '这个货位没有商品' };
    if (this.gold < this.priceOf(offer)) return { ok: false, reason: '金币不足' };
    if (offer.family === 'general' && this.generalIds.length >= this.config.generalSlots) {
      return { ok: false, reason: '将位已满' };
    }
    if (offer.family === 'bone' || offer.family === 'seal') {
      this.shop = { ...this.shop, pending: { ...offer } };
      this.lastEvent = { type: 'pick-kind', text: '选择要改造的牌种' };
      this.emit();
      return { ok: true, needsKind: true };
    }
    return this.completePurchase(offer, null);
  }

  confirmKind(kindKey) {
    if (this.status !== 'shop' || !this.shop.pending) return { ok: false, reason: '现在不需要选牌种' };
    return this.completePurchase(this.shop.pending, kindKey);
  }

  cancelPending() {
    if (!this.shop?.pending) return { ok: false };
    this.shop = { ...this.shop, pending: null };
    this.lastEvent = { type: 'cancel', text: '已取消' };
    this.emit();
    return { ok: true };
  }

  completePurchase(offer, kindKey) {
    const item = getItem(offer.family, offer.id);
    if (!item) return { ok: false, reason: '商品不存在' };
    const price = this.priceOf(offer);
    if (this.gold < price) return { ok: false, reason: '金币不足' };

    let replaced = null;
    if (offer.family === 'general') {
      this.generalIds = [...this.generalIds, offer.id];
    } else if (offer.family === 'codex') {
      const level = (this.codexLevels[item.pattern] ?? 0) + 1;
      this.codexLevels = { ...this.codexLevels, [item.pattern]: Math.min(level, CODEX_MAX_LEVEL) };
    } else if (offer.family === 'bone') {
      replaced = this.bones[kindKey] ?? null;
      this.bones = { ...this.bones, [kindKey]: offer.id };
    } else if (offer.family === 'seal') {
      replaced = this.seals[kindKey] ?? null;
      this.seals = { ...this.seals, [kindKey]: offer.id };
    } else if (offer.family === 'paper') {
      this.papers = [...this.papers, offer.id];
      this.suitBias = item.modifier.suitBias ?? this.suitBias;
      this.back = item.modifier.back ?? this.back;
    }

    if (price === 0 && this.pendingFreeBuy > 0) {
      this.pendingFreeBuy -= 1;
      this.consumeTag('freeBuy');
    }
    this.gold -= price;
    this.shop = {
      ...this.shop,
      pending: null,
      items: this.shop.items.map(
        (entry) => (entry.slotIndex === offer.slotIndex ? { ...entry, sold: true } : entry),
      ),
    };
    this.lastEvent = {
      type: 'purchase',
      text: price === 0 ? `${item.name}（免单）` : `${item.name} 已购买`,
      family: offer.family,
      id: offer.id,
      kindKey,
      replaced,
    };
    this.emit();
    return { ok: true, item, kindKey, replaced, price };
  }

  rerollShop() {
    if (this.status !== 'shop') return { ok: false, reason: '现在不在百宝阁' };
    if (this.gold < this.baseline.rerollCost) return { ok: false, reason: '金币不足' };
    this.gold -= this.baseline.rerollCost;
    const sold = new Set(this.shop.items.filter((item) => item.sold).map((item) => item.slotIndex));
    const next = this.rollShop((this.shop.rerolls ?? 0) + 1);
    next.items = next.items.map((item) => (sold.has(item.slotIndex) ? { ...item, sold: true } : item));
    this.shop = next;
    this.lastEvent = { type: 'reroll', text: `刷新 -${this.baseline.rerollCost} 金` };
    this.emit();
    return { ok: true };
  }

  leaveShop() {
    if (this.status !== 'shop') return { ok: false, reason: '现在不在百宝阁' };
    this.shop = null;
    this.clearHand();
    this.advanceBlindPointer();
    this.emit();
    return { ok: true };
  }

  /* ---------------- 快照 ---------------- */

  snapshot() {
    const live = this.isPlayable() || this.status === 'charm-draft';
    const preview = live ? this.bestHu() : (this.lastHandResult ?? null);
    const ante = this.currentAnte();
    const config = this.config;
    const modifiers = this.activeModifiers();
    return {
      status: this.status,
      seed: this.seed,
      deckId: this.deckId,
      deck: DECKS[this.deckId],
      back: this.back,

      anteIndex: this.anteIndex,
      anteNumber: this.anteIndex + 1,
      anteCount: this.antes.length,
      ante,
      blindKind: this.blindKind,
      blind: BLIND_KINDS[this.blindKind],
      blindCards: this.blindCards(),
      boss: this.currentBoss(),
      bossActive: this.blindKind === 'boss' && this.status !== 'blind-select',
      modifiers,
      target: this.blindTarget(),
      handIndex: this.handIndex,
      handNumber: this.handIndex + 1,
      handCount: ante.handsPerBlind,
      flavor: this.flavor,

      looseTiles: [...this.looseTiles],
      revealedGroups: this.revealedGroups.map((group) => ({ ...group, tiles: [...group.tiles] })),
      selectedIds: [...this.selectedIds],
      swapPreview: this.swapPreview(),
      revealPreview: this.revealPreview(),
      upcomingTiles: modifiers.hideWallPreview ? [] : this.wall.slice(0, 2),
      wallCount: this.wall.length,
      structuralCount: structuralCount(this.looseTiles, this.revealedGroups),
      physicalCount: physicalCount(this.looseTiles, this.revealedGroups),

      slotsUsed: this.slotsUsed(),
      slotCount: config.fortuneSlots,
      emptySlots: this.emptySlots(),
      swapsRemaining: this.swapsRemaining,
      swapsPerHand: config.swapsPerHand,
      maxSwapTiles: config.maxSwapTiles,
      goldPerEmptySlot: config.goldPerEmptySlot,
      goldPerUnusedSwap: config.goldPerUnusedSwap,
      emptySlotChips: config.emptySlotChips,
      distance: live ? this.distance() : 0,
      canHu: this.status === 'hu-ready',
      preview,
      projectedGold: live ? this.projectedGold() : 0,

      charmIds: [...this.charmIds],
      draft: this.draft ? { ...this.draft, charmIds: [...this.draft.charmIds] } : null,
      generalIds: [...this.generalIds],
      generalSlots: config.generalSlots,
      codexLevels: { ...this.codexLevels },
      bones: { ...this.bones },
      seals: { ...this.seals },
      papers: [...this.papers],
      tags: [...this.tags],
      pendingFreeBuy: this.pendingFreeBuy,
      usedSealKinds: [...this.usedSealKinds],

      gold: this.gold,
      pendingGold: this.pendingGold,
      blindScore: this.blindScore,
      totalScore: this.totalScore,
      clearedBlinds: this.clearedBlinds,
      shop: this.shop ? { ...this.shop, items: this.shop.items.map((item) => ({ ...item })) } : null,
      rerollCost: this.baseline.rerollCost,
      handResults: [...this.handResults],
      lastHandResult: this.lastHandResult,
      completedBlinds: [...this.completedBlinds],
      lastEvent: this.lastEvent,
    };
  }
}
