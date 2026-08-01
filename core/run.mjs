/**
 * 一局（Run）的状态机。结构见 docs/decisions/0017：
 *
 *   标准局 = 东 / 南两圈；西圈可在通关后选择加赛
 *   一圈 = 三关（闲局 / 庄局 / 圈主）
 *   一关 = 1 副牌打一个目标，过关进百宝阁
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
 *   run-complete 标准局或加赛通关
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
  GENERAL_ARCHETYPES,
  GENERAL_LIST,
  blindIndexOf,
  getItem,
  listItems,
  pickContentItem,
  pickBoss,
  rollTag,
  shelfFor,
} from '../content/index.mjs';
import {
  CHARM_LIST,
  OMEN_IDS,
  draftCharmOffers,
  rollCharmTierSlots,
} from '../content/charms.mjs';
import { HAND_FLAVORS, createSolvableDeal } from './deal.mjs';
import {
  classifySelection,
  findHuSolutions,
  physicalCount,
  routeRemains,
  structuralCount,
} from './patterns.mjs';
import { scoreHand } from './scoring.mjs';
import { tilesToChange } from './shanten.mjs';
import {
  TILE_KINDS,
  createSeededRng,
  kindName,
  makeTile,
  parseKind,
  parseTileNotation,
  shuffleInPlace,
  sortTiles,
  tileKey,
} from './tiles.mjs';

const cloneOmen = (omen) => (omen ? { ...omen } : null);
const cloneActiveChoice = (choice) => (choice ? {
  ...choice,
  choices: (choice.choices ?? []).map((entry) => ({ ...entry })),
  preview: choice.preview ? { ...choice.preview, patternsAfter: [...(choice.preview.patternsAfter ?? [])] } : null,
} : null);

/** MurmurHash3 风格的 32-bit finalizer，打散相邻 seed 的首个 RNG 输出。 */
function avalanche32(value) {
  let hash = Number(value) >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function archetypePotential(looseTiles, revealedGroups, archetype) {
  const tiles = [...looseTiles, ...revealedGroups.flatMap((group) => group.tiles)];
  const counts = new Map();
  for (const tile of tiles) counts.set(tileKey(tile), (counts.get(tileKey(tile)) ?? 0) + 1);

  if (archetype === 'pairs') {
    return [...counts.values()].reduce((score, count) => score + Math.min(2, count) * 4 + Math.floor(count / 2) * 8, 0);
  }
  if (archetype === 'thunder') {
    return [...counts.values()].reduce((score, count) => score + count * count * 3, 0);
  }

  let score = revealedGroups.filter((group) => group.kind === 'chow').length * 30;
  for (const suit of ['man', 'pin', 'sou']) {
    for (let start = 1; start <= 7; start += 1) {
      const present = [0, 1, 2].filter((offset) => (counts.get(`${suit}:${start + offset}`) ?? 0) > 0).length;
      score += present * present;
    }
  }
  return score;
}

function cloneDraft(draft) {
  if (!draft) return null;
  return {
    ...draft,
    charmIds: [...(draft.charmIds ?? [])],
    tierSlots: [...(draft.tierSlots ?? [])],
    offers: (draft.offers ?? []).map((offer) => ({ ...offer })),
    appliedOmen: cloneOmen(draft.appliedOmen),
    pendingOmenReplacement: draft.pendingOmenReplacement
      ? {
        ...draft.pendingOmenReplacement,
        current: cloneOmen(draft.pendingOmenReplacement.current),
        next: cloneOmen(draft.pendingOmenReplacement.next),
      }
      : null,
    pendingSatchelReplacement: draft.pendingSatchelReplacement
      ? { ...draft.pendingSatchelReplacement }
      : null,
    ...(draft.pendingFateChoice
      ? { pendingFateChoice: {
        ...draft.pendingFateChoice,
        choices: (draft.pendingFateChoice.choices ?? []).map((choice) => ({ ...choice })),
      } }
      : {}),
  };
}

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
    this.activeAnteCount = Math.min(
      this.antes.length,
      Math.max(1, this.baseline.standardAnteCount ?? this.antes.length),
    );
    this.blindKind = 'small';
    this.handIndex = 0;
    this.clearedBlinds = 0;
    this.blindOutcomes = {};      // `${anteIndex}:${kind}` → 'cleared' | 'skipped'
    this.bossIds = this.rollBosses();
    this.tags = [];               // 待生效的手气
    this.pendingFreeBuy = 0;
    this.pendingExtraSwaps = 0;
    this.pendingFreeCharms = 0;
    this.pendingOmen = null;
    this.blindEntryPendingOmen = null;

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
    // 失败重试要回到进关时的待缘状态，不能把失败尝试里的签兆带回来或刷掉。
    this.blindEntryPendingOmen = cloneOmen(this.pendingOmen);
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
    if (this.anteIndex >= this.activeAnteCount - 1) {
      this.status = 'run-complete';
      if (this.activeAnteCount >= this.antes.length) this.pendingOmen = null;
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
    this.charmInstances = [];
    this.charmGold = 0;
    this.satchel = [];
    this.activeChoice = null;
    this.bonusSwapsRemaining = 0;
    this.fateSatchelUsed = false;
    this.wallShuffleCount = 0;
    this.draft = null;
    this.omenTriggeredThisHand = false;
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
    this.previewCount = deal.previewCount ?? 2;
    this.revealedGroups = [];
    this.selectedIds = new Set();
    this.swapsRemaining = config.swapsPerHand;
    this.charmIds = [];
    this.charmInstances = [];
    this.charmGold = 0;
    this.satchel = [];
    this.activeChoice = null;
    this.bonusSwapsRemaining = 0;
    this.fateSatchelUsed = false;
    this.wallShuffleCount = 0;
    this.draft = null;
    this.omenTriggeredThisHand = false;
    this.usedSealKinds = new Set();
    this.lastHandResult = null;
    this.status = 'playing';
    this.lastEvent = { type: 'deal', text: `第 ${this.handIndex + 1} 副 · 目标 ${deal.flavor.name}` };

    // 手气「签气」：固定给银色助势签，不抽改命、彩签或签兆。
    if (this.pendingFreeCharms > 0) {
      const charmId = 'doubleJoy';
      this.charmIds = [charmId];
      this.charmInstances = [{
        instanceId: `tag:${this.handSeed()}:0`,
        charmId,
        tier: getItem('charm', charmId).tier,
        role: getItem('charm', charmId).functionRole,
        source: 'tag',
      }];
      this.pendingFreeCharms -= 1;
      this.consumeTag('charm');
      this.lastEvent = { type: 'tag-charm', text: `签气生效 · ${getItem('charm', charmId).name}`, charmId };
    }

    this.refreshStatus();
  }

  /**
   * 用固定牌谱替换当前这一副，跳过随机发牌。
   *
   * 只给教学关用：教学的每一步都要能预期「点这里会发生什么」，
   * 靠 seed 去撞出一副合适的牌太脆——换个平衡数值教学就崩了。
   * 牌谱记法见 `parseTileNotation`（例：`111m 234m 99p E`）。
   *
   * @param {{hand:string|string[], wall:string|string[], flavorId?:string, swaps?:number}} script
   */
  loadScriptedHand({ hand, wall = [], flavorId = 'mixed', swaps = null }) {
    const build = (notation, prefix) => parseTileNotation(notation)
      .map((spec, index) => makeTile(`${prefix}${index}`, spec.suit, spec.rank));

    this.looseTiles = sortTiles(build(hand, 'th'));
    this.wall = build(wall, 'tw');
    this.discard = [];
    this.flavor = HAND_FLAVORS[flavorId] ?? HAND_FLAVORS.mixed;
    this.previewCount = Math.min(2, this.wall.length);
    this.revealedGroups = [];
    this.selectedIds = new Set();
    this.swapsRemaining = swaps ?? this.effectiveConfig().swapsPerHand;
    this.charmIds = [];
    this.charmInstances = [];
    this.charmGold = 0;
    this.satchel = [];
    this.activeChoice = null;
    this.bonusSwapsRemaining = 0;
    this.fateSatchelUsed = false;
    this.wallShuffleCount = 0;
    this.draft = null;
    this.omenTriggeredThisHand = false;
    this.usedSealKinds = new Set();
    this.lastHandResult = null;
    this.status = 'playing';
    this.lastEvent = { type: 'deal', text: '教学牌局' };
    this.refreshStatus();
    this.emit();
    return { ok: true };
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
      rewardableSwapsRemaining: this.rewardableSwapsRemaining(),
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

  dominantArchetype() {
    const counts = new Map();
    const firstSeen = new Map();
    for (const [index, generalId] of this.generalIds.entries()) {
      const archetype = getItem('general', generalId)?.archetype;
      if (!GENERAL_ARCHETYPES.includes(archetype)) continue;
      counts.set(archetype, (counts.get(archetype) ?? 0) + 1);
      if (!firstSeen.has(archetype)) firstSeen.set(archetype, index);
    }
    return [...counts.keys()].sort((left, right) => (
      counts.get(right) - counts.get(left)
      || firstSeen.get(left) - firstSeen.get(right)
    ))[0] ?? null;
  }

  /** 现在胡的话能拿多少待结算金：空开运位 + 没用完的换牌 + 财签。 */
  projectedGold() {
    const config = this.config;
    return this.emptySlots() * config.goldPerEmptySlot
      + this.rewardableSwapsRemaining() * config.goldPerUnusedSwap
      + this.charmGold;
  }

  rewardableSwapsRemaining() {
    return Math.max(0, this.swapsRemaining - this.bonusSwapsRemaining);
  }

  hasRecoverySatchel() {
    return this.satchel.some((entry) => {
      const charm = getItem('charm', entry.charmId);
      if (charm?.active?.kind === 'addSwaps') return true;
      if (charm?.active?.kind === 'changeTile') {
        return !this.fateSatchelUsed && this.looseTiles.length > 0;
      }
      return false;
    });
  }

  refreshStatus() {
    if (this.status !== 'playing' && this.status !== 'hu-ready') return;
    if (this.bestHu()) {
      this.status = 'hu-ready';
      return;
    }
    if (this.swapsRemaining <= 0 && !this.hasRecoverySatchel()) {
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
    if (this.bonusSwapsRemaining > 0) this.bonusSwapsRemaining -= 1;

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
    this.draft = this.createCharmDraft(group, sealHit);
    if (!this.draft) {
      // 内容配置不完整时不让状态机卡进一个无法选择的签局。
      this.lastEvent = { type: 'error', text: '当前没有足够的合法灵签' };
      this.status = 'playing';
      this.refreshStatus();
      this.emit();
      return { ok: false, reason: this.lastEvent.text };
    }
    this.status = 'charm-draft';
    this.lastEvent = {
      type: 'reveal',
      text: sealHit
        ? `亮组 · ${sealHit.seal.name}给了一次重抽`
        : `亮组 · ${this.draft.offerCount} 签选一`,
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

  /** 当前求签之后，本局是否还存在理论上的下一次求签。 */
  hasFutureCharmDraft() {
    if (this.emptySlots() > 0) return true;
    if (this.handIndex < this.currentAnte().handsPerBlind - 1) return true;
    const blindIndex = BLIND_ORDER.indexOf(this.blindKind);
    return this.anteIndex < this.activeAnteCount - 1 || blindIndex < BLIND_ORDER.length - 1;
  }

  draftSeed(slotIndex, salt, rollIndex = 0) {
    const combined = (
      this.handSeed()
      ^ Math.imul(slotIndex + 1, 0x9e3779b1)
      ^ Math.imul(rollIndex + 1, 0x85ebca6b)
      ^ Math.imul(Number(salt) >>> 0, 0xc2b2ae35)
    ) >>> 0;
    return avalanche32(combined);
  }

  unavailableReserveCharmIds() {
    const excluded = [];
    if (this.wall.length < 4) excluded.push('washWall');
    if (this.fateSatchelUsed || !this.looseTiles.length) excluded.push('turnStone');
    return excluded;
  }

  /**
   * 构建完整且可存档的签局。签阶 RNG 与内容 RNG 使用不同 salt；
   * pendingOmen 只有在增强签局完整生成后才会清空。
   */
  createCharmDraft(group, sealHit) {
    const slotIndex = this.slotsUsed() - 1;
    const draftId = `d:a${this.anteIndex}:${this.blindKind}:h${this.handIndex}:s${slotIndex}:${group.id}`;
    const pending = (!this.omenTriggeredThisHand && this.pendingOmen?.consumeOn === 'nextCharmDraft')
      ? cloneOmen(this.pendingOmen)
      : null;

    const build = (omen) => {
      const offerCount = omen?.omenId === OMEN_IDS.extraChoice ? 4 : 3;
      const excludeDelayedOmens = Boolean(omen) || !this.hasFutureCharmDraft();
      const excludeCharmIds = !omen && this.pendingOmen?.sourceCharmId
        ? [this.pendingOmen.sourceCharmId]
        : [];
      excludeCharmIds.push(...this.unavailableReserveCharmIds());
      if (this.distance() <= 0) {
        excludeCharmIds.push(...CHARM_LIST
          .filter((item) => item.effects?.some((effect) => effect.kind === 'fateChooseOne'))
          .map((item) => item.id));
      }
      const tierRng = createSeededRng(this.draftSeed(
        slotIndex,
        omen ? 27077 : 17011,
      ));
      const tierSlots = rollCharmTierSlots(tierRng, group.kind, {
        offerCount,
        minimumTier: omen?.omenId === OMEN_IDS.luckyTier ? 'gold' : null,
        rainbowChance: omen?.omenId === OMEN_IDS.luckyTier ? 0.15 : 0,
        excludeDelayedOmens,
        excludeCharmIds,
      });
      const contentRng = createSeededRng(this.draftSeed(slotIndex, omen ? 39019 : 13, 0));
      const rolled = draftCharmOffers(contentRng, group.kind, {
        offerCount,
        tierSlots,
        excludeDelayedOmens,
        excludeCharmIds,
        preferredArchetype: this.dominantArchetype(),
      });
      if (rolled.length !== offerCount) return null;
      if (omen?.omenId === OMEN_IDS.luckyTier
        && !rolled.some((offer) => offer.tier === 'gold' || offer.tier === 'rainbow')) {
        return null;
      }
      const offers = rolled.map((offer, index) => ({
        ...offer,
        offerId: `${draftId}:r0:o${index}`,
      }));
      return {
        draftId,
        groupId: group.id,
        slotIndex,
        offerCount,
        tierSlots: offers.map((offer) => offer.tier),
        appliedOmen: omen ? { ...omen, appliedAtDraftId: draftId } : null,
        offers,
        // 兼容旧 UI；新 UI 以 offers / offerId 为准。
        charmIds: offers.map((offer) => offer.charmId),
        rerollsLeft: sealHit ? 1 : 0,
        rerollSource: sealHit?.seal.id ?? null,
        rolls: 0,
        pendingOmenReplacement: null,
        pendingSatchelReplacement: null,
      };
    };

    const enhanced = pending ? build(pending) : null;
    const draft = enhanced ?? build(null);
    if (!draft) return null;
    if (enhanced) {
      this.pendingOmen = null;
      this.omenTriggeredThisHand = true;
    }
    return draft;
  }

  draftContentOptions(draft) {
    const options = {
      excludeDelayedOmens: Boolean(draft.appliedOmen) || !this.hasFutureCharmDraft(),
      excludeCharmIds: !draft.appliedOmen && this.pendingOmen?.sourceCharmId
        ? [this.pendingOmen.sourceCharmId]
        : [],
      preferredArchetype: this.dominantArchetype(),
    };
    options.excludeCharmIds.push(...this.unavailableReserveCharmIds());
    if (this.distance() <= 0) {
      options.excludeCharmIds.push(...CHARM_LIST
        .filter((item) => item.effects?.some((effect) => effect.kind === 'fateChooseOne'))
        .map((item) => item.id));
    }
    return options;
  }

  /**
   * seeded 重抽恰好与原签完全相同时，枚举当前固定职责 / 签阶下的合法组合。
   * 只有确实存在另一套完整且不重复的 offers 才替换；否则允许原样返回。
   */
  findAlternativeDraftOffers(draft, groupKind, options) {
    const excluded = new Set(options.excludeCharmIds ?? []);
    const slotDefaults = ['group', 'pattern', 'wild', 'extra'];
    const chosenIds = new Set();
    const chosen = [];

    const candidatesFor = (index) => {
      const slotRole = draft.offers?.[index]?.slotRole ?? slotDefaults[index] ?? 'extra';
      let pool = CHARM_LIST.filter((item) => !excluded.has(item.id));
      if (options.excludeDelayedOmens) {
        pool = pool.filter((item) => item.omen?.consumeOn !== 'nextCharmDraft');
      }
      if (slotRole !== 'extra') pool = pool.filter((item) => item.draftRole === slotRole);
      if (slotRole === 'group') {
        const matching = pool.filter((item) => item.match?.includes(groupKind));
        if (matching.length) pool = matching;
      }
      pool = pool.filter((item) => (
        item.tier === draft.tierSlots[index] && !chosenIds.has(item.id)
      ));
      if (slotRole === 'pattern' && options.preferredArchetype) {
        const matching = pool.filter((item) => item.archetype === options.preferredArchetype);
        if (matching.length) pool = matching;
      }

      // 当前签放到最后：先寻找真正改变内容的完整合法组合，同时保持稳定顺序。
      const currentId = draft.offers?.[index]?.charmId;
      return [...pool].sort((left, right) => (
        Number(left.id === currentId) - Number(right.id === currentId)
      ));
    };

    const search = (index) => {
      if (index >= draft.offerCount) {
        return chosen.some((offer, offerIndex) => (
          offer.charmId !== draft.offers?.[offerIndex]?.charmId
        ));
      }
      const slotRole = draft.offers?.[index]?.slotRole ?? slotDefaults[index] ?? 'extra';
      for (const item of candidatesFor(index)) {
        chosenIds.add(item.id);
        chosen.push({
          charmId: item.id,
          tier: item.tier,
          role: item.functionRole,
          draftRole: item.draftRole,
          slotRole,
        });
        if (search(index + 1)) return true;
        chosen.pop();
        chosenIds.delete(item.id);
      }
      return false;
    };

    return search(0) ? chosen : null;
  }

  rollDraftOffers(draft, groupKind, rollIndex) {
    const contentRng = createSeededRng(this.draftSeed(
      draft.slotIndex,
      draft.appliedOmen ? 39019 : 13,
      rollIndex,
    ));
    const options = this.draftContentOptions(draft);
    let rolled = draftCharmOffers(contentRng, groupKind, {
      offerCount: draft.offerCount,
      tierSlots: draft.tierSlots,
      ...options,
    });
    if (rolled.length !== draft.offerCount) return null;
    const unchanged = rolled.every((offer, index) => (
      offer.charmId === draft.offers?.[index]?.charmId
    ));
    if (unchanged) {
      rolled = this.findAlternativeDraftOffers(draft, groupKind, options) ?? rolled;
    }
    return rolled.map((offer, index) => ({
      ...offer,
      offerId: `${draft.draftId}:r${rollIndex}:o${index}`,
    }));
  }

  rerollDraft() {
    if (this.status !== 'charm-draft' || !this.draft) return { ok: false, reason: '现在不需要重抽' };
    if (this.draft.rerollsLeft <= 0) return { ok: false, reason: '没有可用的重抽' };
    if (this.draft.pendingOmenReplacement) return { ok: false, reason: '请先决定是否替换待缘' };
    if (this.draft.pendingSatchelReplacement) return { ok: false, reason: '请先决定替换哪张锦囊' };
    if (this.draft.pendingFateChoice) return { ok: false, reason: '请先完成或取消改命选择' };
    const group = this.revealedGroups.find((item) => item.id === this.draft.groupId);
    const nextRoll = this.draft.rolls + 1;
    const offers = this.rollDraftOffers(this.draft, group?.kind ?? 'pair', nextRoll);
    if (!offers) return { ok: false, reason: '当前没有足够的合法灵签可重抽' };
    this.draft = {
      ...this.draft,
      rolls: nextRoll,
      rerollsLeft: this.draft.rerollsLeft - 1,
      offers,
      charmIds: offers.map((offer) => offer.charmId),
    };
    this.lastEvent = { type: 'draft-reroll', text: `${this.draft.offerCount} 张灵签已重抽` };
    this.emit();
    return { ok: true, charmIds: this.draft.charmIds, offers: this.draft.offers };
  }

  chooseCharm(charmId) {
    if (this.status !== 'charm-draft' || !this.draft) return { ok: false, reason: '现在不需要选签' };
    const offer = this.draft.offers?.find((item) => item.charmId === charmId);
    if (!offer) return { ok: false, reason: '这张灵签不在本次选择里' };
    return this.chooseDraftOffer(offer.offerId);
  }

  /** 新 UI 的 canonical 选签入口，避免未来同名签实例造成歧义。 */
  chooseDraftOffer(offerId) {
    if (this.status !== 'charm-draft' || !this.draft) return { ok: false, reason: '现在不需要选签' };
    if (this.draft.pendingOmenReplacement) return { ok: false, reason: '请先决定是否替换待缘' };
    if (this.draft.pendingSatchelReplacement) return { ok: false, reason: '请先决定替换哪张锦囊' };
    if (this.draft.pendingFateChoice) return { ok: false, reason: '请先完成或取消改命选择' };
    const offer = this.draft.offers?.find((item) => item.offerId === offerId);
    if (!offer) return { ok: false, reason: '这张灵签不在本次选择里' };
    const charm = getItem('charm', offer.charmId);
    if (!charm) return { ok: false, reason: '灵签内容不存在' };

    if (charm.resolution === 'reserve') {
      if (charm.active?.kind === 'shuffleWall' && this.wall.length < (charm.active.minimumWall ?? 4)) {
        return { ok: false, reason: '剩余牌墙太短，洗壁锦囊已经无法使用' };
      }
      if (charm.active?.kind === 'changeTile'
        && (this.fateSatchelUsed || !this.looseTiles.length)) {
        return { ok: false, reason: '本副已经没有合法的点石目标' };
      }
      if (this.satchel.length >= 3) {
        this.draft = {
          ...this.draft,
          pendingSatchelReplacement: {
            offerId: offer.offerId,
            charmId: charm.id,
            tier: offer.tier,
          },
        };
        this.lastEvent = { type: 'satchel-replace', text: '锦囊位已满，选择一张替换' };
        this.emit();
        return { ok: true, needsSatchelReplace: true, satchel: this.satchel.map((entry) => ({ ...entry })) };
      }
      return this.finishReserveChoice(offer, charm);
    }

    const fateEffect = charm.effects?.find((effect) => effect.kind === 'fateChooseOne');
    if (fateEffect) {
      const choices = this.fateChoices(fateEffect.archetype);
      if (!choices.length) return { ok: false, reason: '当前没有能改善成胡的改牌目标' };
      this.draft = {
        ...this.draft,
        pendingFateChoice: {
          offerId: offer.offerId,
          charmId: charm.id,
          archetype: fateEffect.archetype,
          distanceBefore: this.distance(),
          selectedTileId: null,
          choices,
        },
      };
      this.lastEvent = { type: 'fate-choice', text: `${charm.name} · 选择要改变的牌` };
      this.emit();
      return { ok: true, needsFateChoice: true, choiceCount: choices.length };
    }

    const nextOmen = charm.omen ? {
      omenId: charm.omen.omenId,
      sourceCharmId: charm.id,
      acquiredAtBlind: `${this.anteIndex}:${this.blindKind}`,
      consumeOn: charm.omen.consumeOn,
    } : null;

    if (nextOmen && this.pendingOmen) {
      this.draft = {
        ...this.draft,
        pendingOmenReplacement: {
          offerId: offer.offerId,
          charmId: charm.id,
          current: cloneOmen(this.pendingOmen),
          next: cloneOmen(nextOmen),
        },
      };
      this.lastEvent = { type: 'omen-replace', text: '待缘位已有签兆，是否替换？' };
      this.emit();
      return {
        ok: true,
        needsOmenReplace: true,
        current: cloneOmen(this.pendingOmen),
        next: cloneOmen(nextOmen),
      };
    }
    return this.finishCharmChoice(offer, charm, nextOmen);
  }

  finishReserveChoice(offer, charm, replaceIndex = null) {
    if (!this.draft) return { ok: false, reason: '签局已经结束' };
    const instance = {
      instanceId: offer.offerId,
      charmId: charm.id,
      tier: offer.tier,
      role: 'active',
      source: 'draft',
    };
    const nextSatchel = this.satchel.map((entry) => ({ ...entry }));
    let replaced = null;
    if (Number.isInteger(replaceIndex)) {
      if (!nextSatchel[replaceIndex]) return { ok: false, reason: '要替换的锦囊位不存在' };
      replaced = nextSatchel[replaceIndex];
      nextSatchel[replaceIndex] = instance;
    } else {
      if (nextSatchel.length >= 3) return { ok: false, reason: '锦囊位已满' };
      nextSatchel.push(instance);
    }
    const group = this.revealedGroups.find((item) => item.id === this.draft.groupId);
    if (group) group.reserveCharmId = charm.id;
    this.satchel = nextSatchel;
    this.draft = null;
    this.status = 'playing';
    this.lastEvent = {
      type: 'satchel-reserve',
      text: replaced ? `${charm.name}收入锦囊，替换${getItem('charm', replaced.charmId)?.name ?? '旧锦囊'}` : `${charm.name}收入锦囊`,
      charmId: charm.id,
      replaced,
    };
    this.refreshStatus();
    this.emit();
    return { ok: true, reserved: true, charm, instance, replaced };
  }

  confirmSatchelReplacement(index) {
    const pending = this.draft?.pendingSatchelReplacement;
    if (this.status !== 'charm-draft' || !pending) {
      return { ok: false, reason: '现在不需要替换锦囊' };
    }
    const offer = this.draft.offers?.find((entry) => entry.offerId === pending.offerId);
    const charm = getItem('charm', pending.charmId);
    if (!offer || !charm) return { ok: false, reason: '新锦囊已经不存在' };
    return this.finishReserveChoice(offer, charm, index);
  }

  cancelSatchelReplacement() {
    if (this.status !== 'charm-draft' || !this.draft?.pendingSatchelReplacement) {
      return { ok: false, reason: '现在不需要替换锦囊' };
    }
    this.draft = { ...this.draft, pendingSatchelReplacement: null };
    this.lastEvent = { type: 'satchel-replace-cancel', text: '返回三签选择' };
    this.emit();
    return { ok: true };
  }

  finishCharmChoice(offer, charm, nextOmen = null, fateChange = null) {
    const group = this.revealedGroups.find((item) => item.id === this.draft.groupId);
    const instance = {
      instanceId: offer.offerId,
      charmId: charm.id,
      tier: offer.tier,
      role: offer.role,
      source: 'draft',
    };
    if (group) {
      group.charmId = charm.id;
      group.charmInstanceId = instance.instanceId;
    }
    this.charmIds = [...this.charmIds, charm.id];
    this.charmInstances = [...this.charmInstances, instance];

    let goldNow = 0;
    for (const effect of charm.effects ?? []) {
      if (effect.kind === 'goldNow') goldNow += effect.value;
    }
    this.charmGold += goldNow;
    if (nextOmen) this.pendingOmen = cloneOmen(nextOmen);

    this.draft = null;
    this.status = 'playing';
    this.lastEvent = {
      type: 'charm',
      text: fateChange
        ? `${charm.name} · ${kindName(tileKey(fateChange.before))}化为${kindName(tileKey(fateChange.after))} · 还差 ${fateChange.distanceAfter} 张`
        : nextOmen
        ? `${charm.name} · 待下次求签应验`
        : (goldNow ? `${charm.name} · +${goldNow} 待结算金` : `${charm.name} 生效`),
      charmId: charm.id,
      offerId: offer.offerId,
      goldNow,
      pendingOmen: cloneOmen(this.pendingOmen),
      fateChange,
    };
    this.refreshStatus();
    this.emit();
    return {
      ok: true,
      charm,
      instance,
      goldNow,
      fateChange,
      pendingOmen: cloneOmen(this.pendingOmen),
    };
  }

  /**
   * 定向改命：穷举所有「原牌 → 目标牌」组合，只保留真实降低还差张数的合法结果。
   * potential 只决定 UI 排序，不替玩家自动提交选择。
   */
  fateChoices(archetype = 'dragon') {
    const distanceBefore = this.distance();
    if (!Number.isFinite(distanceBefore) || distanceBefore <= 0 || !this.looseTiles.length) return [];

    const kindCounts = new Map();
    for (const tile of [
      ...this.looseTiles,
      ...this.revealedGroups.flatMap((group) => group.tiles),
    ]) {
      const kind = tileKey(tile);
      kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
    }

    const choices = [];
    for (let index = 0; index < this.looseTiles.length; index += 1) {
      const before = this.looseTiles[index];
      for (const kind of TILE_KINDS) {
        if (kind === tileKey(before)) continue;
        // 改命仍使用标准四副牌库，不凭空造出第五张同牌。
        if ((kindCounts.get(kind) ?? 0) >= 4) continue;
        const spec = parseKind(kind);
        const after = makeTile(before.id, spec.suit, spec.rank);
        const candidate = [...this.looseTiles];
        candidate[index] = after;
        const sorted = sortTiles(candidate);
        const distanceAfter = tilesToChange(sorted, this.revealedGroups);
        if (distanceAfter >= distanceBefore) continue;
        const potential = archetypePotential(sorted, this.revealedGroups, archetype);
        choices.push({
          tileId: before.id,
          beforeKind: tileKey(before),
          targetKind: kind,
          distanceAfter,
          potential,
        });
      }
    }
    return choices;
  }

  selectFateTile(tileId) {
    const pending = this.draft?.pendingFateChoice;
    if (this.status !== 'charm-draft' || !pending) return { ok: false, reason: '现在不需要选择改命牌' };
    if (!pending.choices.some((choice) => choice.tileId === tileId)) {
      return { ok: false, reason: '这张牌没有能改善成胡的目标' };
    }
    this.draft = {
      ...this.draft,
      pendingFateChoice: { ...pending, selectedTileId: tileId },
    };
    this.lastEvent = { type: 'fate-source', text: '选择要变成的牌' };
    this.emit();
    return { ok: true };
  }

  backFateTile() {
    const pending = this.draft?.pendingFateChoice;
    if (this.status !== 'charm-draft' || !pending) return { ok: false, reason: '现在不在改命选择中' };
    this.draft = {
      ...this.draft,
      pendingFateChoice: { ...pending, selectedTileId: null },
    };
    this.lastEvent = { type: 'fate-back', text: '重新选择要改变的牌' };
    this.emit();
    return { ok: true };
  }

  cancelFateChoice() {
    if (this.status !== 'charm-draft' || !this.draft?.pendingFateChoice) {
      return { ok: false, reason: '现在不在改命选择中' };
    }
    this.draft = { ...this.draft, pendingFateChoice: null };
    this.lastEvent = { type: 'fate-cancel', text: '返回三签选择' };
    this.emit();
    return { ok: true };
  }

  confirmFateTarget(targetKind) {
    const pending = this.draft?.pendingFateChoice;
    if (this.status !== 'charm-draft' || !pending?.selectedTileId) {
      return { ok: false, reason: '请先选择要改变的牌' };
    }
    const savedChoice = pending.choices.find((choice) => (
      choice.tileId === pending.selectedTileId && choice.targetKind === targetKind
    ));
    if (!savedChoice) return { ok: false, reason: '这个改牌目标不在合法列表中' };
    const before = this.looseTiles.find((tile) => tile.id === savedChoice.tileId);
    const offer = this.draft.offers?.find((item) => item.offerId === pending.offerId);
    const charm = getItem('charm', pending.charmId);
    if (!before || tileKey(before) !== savedChoice.beforeKind || !offer || !charm) {
      return { ok: false, reason: '改命签状态已经失效' };
    }

    const physicalTiles = [
      ...this.looseTiles,
      ...this.revealedGroups.flatMap((group) => group.tiles),
    ];
    if (physicalTiles.filter((tile) => tileKey(tile) === targetKind).length >= 4) {
      return { ok: false, reason: '牌库中已经有四张这种牌' };
    }

    const spec = parseKind(savedChoice.targetKind);
    const after = makeTile(before.id, spec.suit, spec.rank);
    const nextLoose = sortTiles(this.looseTiles.map((tile) => tile.id === before.id ? after : tile));
    const distanceBefore = this.distance();
    const distanceAfter = tilesToChange(nextLoose, this.revealedGroups);
    if (distanceAfter >= distanceBefore) return { ok: false, reason: '这个目标已经不能改善成胡' };
    this.looseTiles = nextLoose;
    this.selectedIds.clear();
    const fateChange = {
      before,
      after,
      distanceBefore,
      distanceAfter,
      archetype: pending.archetype,
    };
    return this.finishCharmChoice(offer, charm, null, fateChange);
  }

  confirmPendingOmen() {
    if (this.status !== 'charm-draft' || !this.draft?.pendingOmenReplacement) {
      return { ok: false, reason: '现在不需要替换待缘' };
    }
    const replacement = this.draft.pendingOmenReplacement;
    const offer = this.draft.offers.find((item) => item.offerId === replacement.offerId);
    const charm = getItem('charm', replacement.charmId);
    if (!offer || !charm) return { ok: false, reason: '替换的灵签已经不存在' };
    return this.finishCharmChoice(offer, charm, replacement.next);
  }

  cancelPendingOmenReplacement() {
    if (this.status !== 'charm-draft' || !this.draft?.pendingOmenReplacement) {
      return { ok: false, reason: '现在不需要替换待缘' };
    }
    this.draft = { ...this.draft, pendingOmenReplacement: null };
    this.lastEvent = { type: 'omen-replace-cancel', text: '保留原有签兆' };
    this.emit();
    return { ok: true };
  }

  pointStoneChoices() {
    if (this.fateSatchelUsed || !this.looseTiles.length) return [];
    const kindCounts = new Map();
    for (const tile of [
      ...this.looseTiles,
      ...this.revealedGroups.flatMap((group) => group.tiles),
    ]) {
      const kind = tileKey(tile);
      kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
    }
    const distanceBefore = this.distance();
    const choices = [];
    for (let index = 0; index < this.looseTiles.length; index += 1) {
      const before = this.looseTiles[index];
      for (const targetKind of TILE_KINDS) {
        if (targetKind === tileKey(before) || (kindCounts.get(targetKind) ?? 0) >= 4) continue;
        const spec = parseKind(targetKind);
        const after = makeTile(before.id, spec.suit, spec.rank);
        const candidate = sortTiles(this.looseTiles.map((tile) => tile.id === before.id ? after : tile));
        const distanceAfter = tilesToChange(candidate, this.revealedGroups);
        choices.push({
          tileId: before.id,
          beforeKind: tileKey(before),
          targetKind,
          distanceAfter,
          improves: distanceAfter < distanceBefore,
        });
      }
    }
    return choices;
  }

  beginSatchelUse(instanceId) {
    if (!this.isPlayable()) return { ok: false, reason: '现在不能使用锦囊' };
    if (this.activeChoice) return { ok: false, reason: '请先完成当前锦囊' };
    const instance = this.satchel.find((entry) => entry.instanceId === instanceId);
    const charm = instance ? getItem('charm', instance.charmId) : null;
    if (!instance || !charm?.active) return { ok: false, reason: '锦囊不存在' };
    if (charm.active.kind === 'shuffleWall' && this.wall.length < (charm.active.minimumWall ?? 4)) {
      return { ok: false, reason: '剩余牌墙不足 4 张，不能再洗壁' };
    }
    if (charm.active.kind === 'changeTile' && this.fateSatchelUsed) {
      return { ok: false, reason: '本副已经用过一次改命锦囊' };
    }
    const choices = charm.active.kind === 'changeTile' ? this.pointStoneChoices() : [];
    if (charm.active.kind === 'changeTile' && !choices.length) {
      return { ok: false, reason: '当前没有合法的点石目标' };
    }
    this.activeChoice = {
      instanceId,
      charmId: charm.id,
      mode: charm.active.kind === 'changeTile' ? 'source' : 'confirm',
      selectedTileId: null,
      selectedTargetKind: null,
      distanceBefore: this.distance(),
      choices,
      preview: null,
    };
    this.lastEvent = { type: 'satchel-open', text: `${charm.name} · 确认使用` };
    this.emit();
    return { ok: true, needsTarget: charm.active.kind === 'changeTile' };
  }

  cancelSatchelUse() {
    if (!this.activeChoice) return { ok: false, reason: '现在没有打开锦囊' };
    this.activeChoice = null;
    this.lastEvent = { type: 'satchel-cancel', text: '锦囊已收回' };
    this.emit();
    return { ok: true };
  }

  selectSatchelTile(tileId) {
    const choice = this.activeChoice;
    if (!choice || choice.mode !== 'source') return { ok: false, reason: '现在不需要选择原牌' };
    if (!choice.choices.some((entry) => entry.tileId === tileId)) {
      return { ok: false, reason: '这张牌没有合法目标' };
    }
    this.activeChoice = {
      ...choice,
      mode: 'target',
      selectedTileId: tileId,
      selectedTargetKind: null,
      preview: null,
    };
    this.lastEvent = { type: 'satchel-source', text: '选择要变成的牌' };
    this.emit();
    return { ok: true };
  }

  selectSatchelTarget(targetKind) {
    const choice = this.activeChoice;
    if (!choice || choice.mode !== 'target' || !choice.selectedTileId) {
      return { ok: false, reason: '请先选择要改变的牌' };
    }
    const saved = choice.choices.find((entry) => (
      entry.tileId === choice.selectedTileId && entry.targetKind === targetKind
    ));
    const before = this.looseTiles.find((tile) => tile.id === choice.selectedTileId);
    if (!saved || !before || tileKey(before) !== saved.beforeKind) {
      return { ok: false, reason: '这个点石目标已经失效' };
    }
    const spec = parseKind(targetKind);
    const after = makeTile(before.id, spec.suit, spec.rank);
    const candidate = sortTiles(this.looseTiles.map((tile) => tile.id === before.id ? after : tile));
    const best = this.bestHu(candidate, this.revealedGroups);
    this.activeChoice = {
      ...choice,
      mode: 'preview',
      selectedTargetKind: targetKind,
      preview: {
        beforeKind: saved.beforeKind,
        targetKind,
        distanceBefore: choice.distanceBefore,
        distanceAfter: saved.distanceAfter,
        canHuAfter: Boolean(best),
        patternsAfter: best?.patterns ?? [],
      },
    };
    this.lastEvent = { type: 'satchel-preview', text: '确认后才会消费锦囊' };
    this.emit();
    return { ok: true, preview: this.activeChoice.preview };
  }

  backSatchelChoice() {
    const choice = this.activeChoice;
    if (!choice) return { ok: false, reason: '现在没有打开锦囊' };
    if (choice.mode === 'preview') {
      this.activeChoice = { ...choice, mode: 'target', selectedTargetKind: null, preview: null };
    } else if (choice.mode === 'target') {
      this.activeChoice = { ...choice, mode: 'source', selectedTileId: null, selectedTargetKind: null, preview: null };
    } else {
      return this.cancelSatchelUse();
    }
    this.lastEvent = { type: 'satchel-back', text: '返回上一步' };
    this.emit();
    return { ok: true };
  }

  confirmSatchelUse() {
    const choice = this.activeChoice;
    const instance = choice ? this.satchel.find((entry) => entry.instanceId === choice.instanceId) : null;
    const charm = instance ? getItem('charm', instance.charmId) : null;
    if (!choice || !instance || !charm?.active) return { ok: false, reason: '锦囊状态已经失效' };

    let detail = '';
    if (charm.active.kind === 'addSwaps') {
      this.swapsRemaining += charm.active.value;
      this.bonusSwapsRemaining += charm.active.value;
      detail = `额外 +${charm.active.value} 次换牌`;
    } else if (charm.active.kind === 'shuffleWall') {
      if (this.wall.length < (charm.active.minimumWall ?? 4)) return { ok: false, reason: '剩余牌墙不足 4 张' };
      const beforeIds = this.wall.map((tile) => tile.id).join('|');
      const rng = createSeededRng(avalanche32(
        this.handSeed() ^ Math.imul(this.wallShuffleCount + 1, 0x6d2b79f5),
      ));
      const shuffled = shuffleInPlace([...this.wall], rng);
      if (shuffled.length > 1 && shuffled.map((tile) => tile.id).join('|') === beforeIds) {
        shuffled.push(shuffled.shift());
      }
      this.wall = shuffled;
      this.wallShuffleCount += 1;
      detail = '剩余牌墙已重洗';
    } else if (charm.active.kind === 'changeTile') {
      if (choice.mode !== 'preview' || !choice.selectedTileId || !choice.selectedTargetKind) {
        return { ok: false, reason: '请先选好原牌和目标牌' };
      }
      const saved = choice.choices.find((entry) => (
        entry.tileId === choice.selectedTileId && entry.targetKind === choice.selectedTargetKind
      ));
      const before = this.looseTiles.find((tile) => tile.id === choice.selectedTileId);
      if (!saved || !before || tileKey(before) !== saved.beforeKind) return { ok: false, reason: '点石目标已经失效' };
      const physicalTiles = [...this.looseTiles, ...this.revealedGroups.flatMap((group) => group.tiles)];
      if (physicalTiles.filter((tile) => tileKey(tile) === saved.targetKind).length >= 4) {
        return { ok: false, reason: '牌局中已经有四张这种牌' };
      }
      const spec = parseKind(saved.targetKind);
      const after = makeTile(before.id, spec.suit, spec.rank);
      this.looseTiles = sortTiles(this.looseTiles.map((tile) => tile.id === before.id ? after : tile));
      this.selectedIds.clear();
      this.fateSatchelUsed = true;
      detail = `${kindName(saved.beforeKind)}化为${kindName(saved.targetKind)}`;
    } else {
      return { ok: false, reason: '未知锦囊效果' };
    }

    this.satchel = this.satchel.filter((entry) => entry.instanceId !== instance.instanceId);
    this.activeChoice = null;
    this.lastEvent = { type: 'satchel-used', text: `${charm.name} · ${detail}`, charmId: charm.id };
    this.refreshStatus();
    this.emit();
    return { ok: true, charm, detail };
  }

  /* ---------------- 结算 ---------------- */

  declareHu() {
    if (this.status !== 'hu-ready') return { ok: false, reason: '现在还不能胡' };
    const best = this.bestHu();
    if (!best) return { ok: false, reason: '现在还不能胡' };

    for (const fired of best.sealsFired ?? []) this.usedSealKinds.add(fired.kind);
    // goldNow 在选签时记入 charmGold，scoreHand 会主动跳过，避免胡牌时重复触发。
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
      charmInstances: this.charmInstances.map((instance) => ({ ...instance })),
      swapsRemaining: this.swapsRemaining,
      rewardableSwapsRemaining: this.rewardableSwapsRemaining(),
      unusedSatchel: this.satchel.map((entry) => ({ ...entry })),
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
    if (wasLastBlind && this.anteIndex >= this.activeAnteCount - 1) {
      this.status = 'run-complete';
      if (this.activeAnteCount >= this.antes.length) this.pendingOmen = null;
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

  /** 标准短局通关后进入剩余圈数；当前即西圈三关。 */
  continueChallenge() {
    if (this.status !== 'run-complete' || this.activeAnteCount >= this.antes.length) {
      return { ok: false, reason: '现在没有可进入的加赛' };
    }
    this.activeAnteCount = this.antes.length;
    this.anteIndex += 1;
    this.blindKind = BLIND_ORDER[0];
    this.handIndex = 0;
    this.resetBlindProgress();
    this.clearHand();
    this.status = 'blind-select';
    this.lastEvent = { type: 'challenge', text: `进入${this.currentAnte().name}加赛` };
    this.emit();
    return { ok: true, status: this.status };
  }

  /** 试玩用：本关重来一次，不清空已入账金币与构筑。 */
  retryBlind() {
    if (this.status !== 'run-over') return { ok: false, reason: '现在不需要重试' };
    this.pendingOmen = cloneOmen(this.blindEntryPendingOmen);
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
    const shopIndex = this.shopIndex();
    const shelf = shelfFor(shopIndex);
    const rng = createSeededRng((this.seed + this.clearedBlinds * 31337 + rerolls * 977 + 7) >>> 0);
    const generalDraft = shelf.every((family) => family === 'general');
    const stage = generalDraft ? Math.min(3, Math.floor(shopIndex / 2) + 1) : null;
    const pickedKeys = new Set();
    const items = shelf.map((family, slotIndex) => {
      const archetype = generalDraft ? GENERAL_ARCHETYPES[slotIndex] : null;
      let pool = this.shopPool(family, { stage, archetype })
        .filter((item) => !pickedKeys.has(`${family}:${item.id}`));
      if (!pool.length && family === 'general' && archetype) {
        pool = this.shopPool(family, { archetype })
          .filter((item) => !pickedKeys.has(`${family}:${item.id}`));
      }
      if (!pool.length) return null;
      const item = pickContentItem(rng, pool);
      pickedKeys.add(`${family}:${item.id}`);
      return { slotIndex, family, id: item.id, price: item.price, sold: false };
    }).filter(Boolean);
    return {
      kind: generalDraft ? 'general-draft' : 'shop',
      stage,
      generalPicked: null,
      rerolls,
      items,
      pending: null,
    };
  }

  /** 番谱定向保底：只出匹配下一圈预告、且还没满级的。 */
  shopPool(family, { stage = null, archetype = null } = {}) {
    if (family === 'codex') {
      const upcoming = this.antes[Math.min(this.anteIndex, this.antes.length - 1)].announced;
      const matching = upcoming
        .map((pattern) => CODEX_BY_PATTERN[pattern])
        .filter((book) => book && (this.codexLevels[book.pattern] ?? 0) < CODEX_MAX_LEVEL);
      return matching.length ? matching : [CODEX.pureSuit];
    }
    if (family === 'general') {
      return GENERAL_LIST.filter((item) => (
        !this.generalIds.includes(item.id)
        && (stage === null || item.stage === stage)
        && (!archetype || item.archetype === archetype)
      ));
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
    if (offer.family === 'general' && this.shop.kind === 'general-draft' && this.shop.generalPicked) {
      return { ok: false, reason: '本次请将已经选择过了' };
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
      generalPicked: offer.family === 'general' && this.shop.kind === 'general-draft'
        ? offer.id
        : this.shop.generalPicked,
      items: this.shop.items.map(
        (entry) => (
          entry.slotIndex === offer.slotIndex
          || (offer.family === 'general' && this.shop.kind === 'general-draft' && entry.family === 'general')
            ? { ...entry, sold: true }
            : entry
        ),
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
    if (this.shop.kind === 'general-draft') return { ok: false, reason: '请将台不可刷新' };
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
      anteCount: this.activeAnteCount,
      challengeAvailable: this.status === 'run-complete' && this.activeAnteCount < this.antes.length,
      challengeActive: this.activeAnteCount >= this.antes.length
        && this.anteIndex >= (this.baseline.standardAnteCount ?? 2),
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
      upcomingTiles: modifiers.hideWallPreview ? [] : this.wall.slice(0, this.previewCount ?? 2),
      wallCount: this.wall.length,
      structuralCount: structuralCount(this.looseTiles, this.revealedGroups),
      physicalCount: physicalCount(this.looseTiles, this.revealedGroups),

      slotsUsed: this.slotsUsed(),
      slotCount: config.fortuneSlots,
      emptySlots: this.emptySlots(),
      swapsRemaining: this.swapsRemaining,
      bonusSwapsRemaining: this.bonusSwapsRemaining,
      rewardableSwapsRemaining: this.rewardableSwapsRemaining(),
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
      charmInstances: this.charmInstances.map((instance) => ({ ...instance })),
      satchel: this.satchel.map((entry) => ({ ...entry })),
      activeChoice: cloneActiveChoice(this.activeChoice),
      fateSatchelUsed: this.fateSatchelUsed,
      wallShuffleCount: this.wallShuffleCount,
      draft: cloneDraft(this.draft),
      pendingOmen: cloneOmen(this.pendingOmen),
      blindEntryPendingOmen: cloneOmen(this.blindEntryPendingOmen),
      omenTriggeredThisHand: this.omenTriggeredThisHand,
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
