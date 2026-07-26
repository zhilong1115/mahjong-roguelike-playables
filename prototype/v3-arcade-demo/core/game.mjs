import {
  CHARMS,
  CHARM_LIST,
  DEMO_CONFIG,
  GENERALS,
  GENERAL_LIST,
  ROUNDS,
} from '../content/content.mjs';
import { createSolvableDeal, flavorForHand } from './deal.mjs';
import {
  classifySelection,
  findBestHu,
  physicalCount,
  routeRemains,
  structuralCount,
  tilesToChange,
} from './rules.mjs';
import { createSeededRng, sortTiles, tileKey } from './tiles.mjs';

const GROUP_NAMES = Object.freeze({ pair: '对子', chow: '顺子', pung: '刻子', kong: '杠' });

function cloneGroup(group) {
  return { ...group, tiles: [...group.tiles] };
}

function brokenTilesFor(roundIndex) {
  return roundIndex === 0 ? 2 : 3;
}

function draftFor(seed, slotIndex, revealedKind) {
  const rng = createSeededRng(seed + slotIndex * 7919 + 13);
  const groupPool = CHARM_LIST.filter(
    (charm) => charm.tag === 'group' && charm.match?.includes(revealedKind),
  );
  const patternPool = CHARM_LIST.filter((charm) => charm.tag === 'pattern');
  const wildPool = CHARM_LIST.filter((charm) => charm.tag === 'wild');
  const fallback = CHARM_LIST.filter((charm) => charm.tag !== 'group');

  const options = [];
  const take = (pool) => {
    const candidates = pool.filter((charm) => !options.some((chosen) => chosen.id === charm.id));
    if (!candidates.length) return;
    options.push(rng.pick(candidates));
  };
  take(groupPool.length ? groupPool : fallback);
  take(patternPool);
  take(wildPool);
  while (options.length < 3) take(CHARM_LIST);
  return options.map((charm) => charm.id);
}

export class ArcadeGame {
  constructor({ config = DEMO_CONFIG, rounds = ROUNDS, seed = 0 } = {}) {
    this.config = config;
    this.rounds = rounds;
    this.baseSeed = seed || Math.floor(Math.random() * 1e9);
    this.listeners = new Set();
    this.reset();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    const state = this.snapshot();
    for (const listener of this.listeners) listener(state);
  }

  reset(seed = this.baseSeed) {
    this.baseSeed = seed;
    this.gold = this.config.startingGold;
    this.generalIds = [];
    this.roundIndex = 0;
    this.handIndex = 0;
    this.totalScore = 0;
    this.completedRounds = [];
    this.groupSerial = 1;
    this.shopOffer = null;
    this.resetRoundProgress();
    this.dealHand();
    this.emit();
    return this.snapshot();
  }

  resetRoundProgress() {
    this.roundScore = 0;
    this.pendingGold = 0;
    this.handResults = [];
  }

  currentRound() {
    return this.rounds[this.roundIndex];
  }

  handSeed() {
    return (this.baseSeed + this.roundIndex * 104729 + this.handIndex * 7907) >>> 0;
  }

  dealHand() {
    const flavorId = flavorForHand(this.roundIndex, this.handIndex);
    const deal = createSolvableDeal({
      handId: `r${this.roundIndex}h${this.handIndex}`,
      seed: this.handSeed(),
      flavorId,
      brokenTiles: brokenTilesFor(this.roundIndex),
    });

    this.looseTiles = deal.looseTiles;
    this.wall = deal.wall;
    this.discard = [];
    this.flavor = deal.flavor;
    this.revealedGroups = [];
    this.selectedIds = new Set();
    this.swapsRemaining = this.config.swapsPerHand;
    this.charmIds = [];
    this.charmGold = 0;
    this.pendingDraft = null;
    this.lastHandResult = null;
    this.status = 'playing';
    this.lastEvent = { type: 'deal', text: `第 ${this.handIndex + 1} 副 · 目标牌型 ${deal.flavor.name}` };
    this.refreshStatus();
    return deal;
  }

  /* ---------- 查询 ---------- */

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

  scoringOptions() {
    return {
      charmIds: this.charmIds,
      generalIds: this.generalIds,
      swapsRemaining: this.swapsRemaining,
      revealCount: this.slotsUsed(),
      emptySlots: this.emptySlots(),
    };
  }

  bestHu() {
    return findBestHu(this.looseTiles, this.revealedGroups, this.scoringOptions());
  }

  distance() {
    return tilesToChange(this.looseTiles, this.revealedGroups);
  }

  projectedGold(scoring = null) {
    const base = this.emptySlots() * this.config.goldPerEmptySlot;
    return base + this.charmGold + (scoring?.bonusGold ?? 0);
  }

  refreshStatus() {
    if (this.status !== 'playing' && this.status !== 'hu-ready') return;
    const best = this.bestHu();
    if (best) {
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

  /* ---------- 选牌 ---------- */

  toggleTile(tileId) {
    if (!this.isPlayable()) return false;
    if (!this.looseTiles.some((tile) => tile.id === tileId)) return false;
    if (this.selectedIds.has(tileId)) {
      this.selectedIds.delete(tileId);
    } else {
      if (this.selectedIds.size >= 4) {
        this.lastEvent = { type: 'error', text: '一次最多选 4 张' };
        this.emit();
        return false;
      }
      this.selectedIds.add(tileId);
    }
    this.lastEvent = { type: 'selection', text: this.selectionPreview().text };
    this.emit();
    return true;
  }

  clearSelection() {
    if (this.selectedIds.size === 0) return false;
    this.selectedIds.clear();
    this.lastEvent = { type: 'selection', text: '已取消选择' };
    this.emit();
    return true;
  }

  selectionPreview() {
    if (!this.isPlayable()) return { valid: false, kind: null, text: '本副已经结束' };
    const selected = this.selectedTiles();
    const analysis = classifySelection(selected);
    if (!analysis.valid) return { ...analysis, text: analysis.reason };

    if (analysis.kind === 'swap') {
      if (this.swapsRemaining <= 0) return { valid: false, kind: 'swap', text: '换牌次数用完' };
      if (!this.wall.length) return { valid: false, kind: 'swap', text: '牌墙已空' };
      return { ...analysis, text: `换掉 1 张，摸 ${this.wall[0] ? '下一张' : ''}` };
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
    const nextDistance = tilesToChange(nextLoose, nextGroups);
    if (nextDistance > this.swapsRemaining) {
      return { valid: false, kind: analysis.kind, text: '亮了就换不回来，本副会胡不了' };
    }

    return {
      ...analysis,
      text: `亮${analysis.name} · 花 1 个开运位 · 三签选一`,
      goldCost: this.config.goldPerEmptySlot,
      nextDistance,
    };
  }

  /* ---------- 行动 ---------- */

  drawOne() {
    const tile = this.wall.shift() ?? null;
    if (tile) this.looseTiles = sortTiles([...this.looseTiles, tile]);
    return tile;
  }

  performAction() {
    const preview = this.selectionPreview();
    if (!preview.valid) {
      this.lastEvent = { type: 'error', text: preview.text };
      this.emit();
      return { ok: false, reason: preview.text };
    }

    const selected = this.selectedTiles();
    const selectedIds = new Set(selected.map((tile) => tile.id));
    this.selectedIds.clear();

    if (preview.kind === 'swap') {
      const discarded = selected[0];
      this.looseTiles = this.looseTiles.filter((tile) => tile.id !== discarded.id);
      this.discard.push(discarded);
      const drawn = this.drawOne();
      this.swapsRemaining -= 1;
      this.lastEvent = {
        type: 'swap',
        text: `换掉 1 张，摸到 1 张，剩 ${this.swapsRemaining} 次换牌`,
        discarded,
        drawn,
      };
      this.refreshStatus();
      this.emit();
      return { ok: true, kind: 'swap', discarded, drawn };
    }

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

    this.pendingDraft = {
      groupId: group.id,
      slotIndex: this.slotsUsed() - 1,
      charmIds: draftFor(this.handSeed(), this.slotsUsed() - 1, preview.kind),
    };
    this.status = 'charm-draft';
    this.lastEvent = {
      type: 'reveal',
      text: `亮${GROUP_NAMES[preview.kind]} · 三签选一`,
      group,
      supplement,
    };
    this.emit();
    return { ok: true, kind: preview.kind, group, supplement, draft: this.pendingDraft };
  }

  chooseCharm(charmId) {
    if (this.status !== 'charm-draft' || !this.pendingDraft) {
      return { ok: false, reason: '现在不需要选签' };
    }
    if (!this.pendingDraft.charmIds.includes(charmId)) {
      return { ok: false, reason: '这张灵签不在本次选择里' };
    }
    const charm = CHARMS[charmId];
    const group = this.revealedGroups.find((item) => item.id === this.pendingDraft.groupId);
    if (group) group.charmId = charmId;
    this.charmIds = [...this.charmIds, charmId];

    let goldNow = 0;
    for (const effect of charm.effects) {
      if (effect.kind === 'goldNow') goldNow += effect.value;
    }
    this.charmGold += goldNow;

    this.pendingDraft = null;
    this.status = 'playing';
    this.lastEvent = {
      type: 'charm',
      text: goldNow ? `${charm.name} · +${goldNow} 待结算金` : `${charm.name} 生效`,
      charm,
      goldNow,
    };
    this.refreshStatus();
    this.emit();
    return { ok: true, charm, goldNow };
  }

  declareHu() {
    if (this.status !== 'hu-ready') return { ok: false, reason: '现在还不能胡' };
    const best = this.bestHu();
    if (!best) return { ok: false, reason: '现在还不能胡' };

    const gold = this.projectedGold(best);
    const result = {
      handIndex: this.handIndex,
      flavor: this.flavor,
      score: best.total,
      scoring: best,
      gold,
      slotsUsed: this.slotsUsed(),
      emptySlots: this.emptySlots(),
      charmIds: [...this.charmIds],
      swapsRemaining: this.swapsRemaining,
    };
    this.roundScore += best.total;
    this.pendingGold += gold;
    this.handResults = [...this.handResults, result];
    this.lastHandResult = result;
    this.status = 'hand-won';
    this.lastEvent = {
      type: 'hu',
      text: `${best.patterns.join(' · ')}！${best.chips} × ${best.mult} = ${best.total}`,
      result,
    };
    this.emit();
    return { ok: true, ...result };
  }

  /* ---------- 流程 ---------- */

  advance() {
    if (this.status !== 'hand-won' && this.status !== 'hand-failed') {
      return { ok: false, reason: '现在不能进入下一副' };
    }
    if (this.status === 'hand-failed') {
      this.handResults = [...this.handResults, {
        handIndex: this.handIndex,
        flavor: this.flavor,
        score: 0,
        gold: 0,
        failed: true,
        slotsUsed: this.slotsUsed(),
      }];
    }

    const round = this.currentRound();
    if (this.handIndex < round.handCount - 1) {
      this.handIndex += 1;
      this.dealHand();
      this.emit();
      return { ok: true, status: this.status };
    }

    if (this.roundScore < round.target) {
      return this.failRound(`累计 ${this.roundScore} 分，未达 ${round.target} 分`);
    }

    const banked = this.pendingGold;
    this.gold += banked;
    this.totalScore += this.roundScore;
    this.completedRounds = [...this.completedRounds, {
      roundId: round.id,
      name: round.name,
      score: this.roundScore,
      banked,
      hands: [...this.handResults],
    }];
    this.lastBanked = banked;
    this.pendingGold = 0;

    if (this.roundIndex >= this.rounds.length - 1) {
      this.status = 'run-complete';
      this.lastEvent = { type: 'run-complete', text: `通关！总分 ${this.totalScore}` };
      this.emit();
      return { ok: true, status: this.status };
    }

    this.status = 'shop';
    this.shopOffer = this.rollShop();
    this.lastEvent = { type: 'shop', text: `本轮达标，${banked} 金入账` };
    this.emit();
    return { ok: true, status: this.status, banked };
  }

  failRound(reason) {
    const lostScore = this.roundScore;
    const lostGold = this.pendingGold;
    this.resetRoundProgress();
    this.status = 'round-failed';
    this.lastEvent = { type: 'round-failed', text: `${reason}，待结算金币清空`, lostScore, lostGold };
    this.emit();
    return { ok: true, failed: true, lostScore, lostGold };
  }

  retryRound() {
    if (this.status !== 'round-failed') return { ok: false, reason: '现在不需要重试' };
    this.handIndex = 0;
    this.resetRoundProgress();
    this.dealHand();
    this.emit();
    return { ok: true };
  }

  rollShop(seedOffset = 0) {
    const rng = createSeededRng((this.baseSeed + this.roundIndex * 31337 + seedOffset * 977) >>> 0);
    const pool = GENERAL_LIST.filter((general) => !this.generalIds.includes(general.id));
    const picks = [];
    while (picks.length < Math.min(this.config.shopSize, pool.length)) {
      const candidate = rng.pick(pool);
      if (!picks.some((item) => item.id === candidate.id)) picks.push(candidate);
    }
    return { rerolls: seedOffset, items: picks.map((item) => item.id) };
  }

  rerollShop() {
    if (this.status !== 'shop') return { ok: false, reason: '现在不在百宝阁' };
    if (this.gold < this.config.rerollCost) return { ok: false, reason: '金币不足' };
    this.gold -= this.config.rerollCost;
    this.shopOffer = this.rollShop((this.shopOffer?.rerolls ?? 0) + 1);
    this.lastEvent = { type: 'reroll', text: `刷新 -${this.config.rerollCost} 金` };
    this.emit();
    return { ok: true };
  }

  buyGeneral(generalId) {
    if (this.status !== 'shop') return { ok: false, reason: '现在不在百宝阁' };
    if (!this.shopOffer?.items.includes(generalId)) return { ok: false, reason: '货架上没有这位福将' };
    const general = GENERALS[generalId];
    if (this.generalIds.length >= this.config.generalSlots) return { ok: false, reason: '福将位已满' };
    if (this.gold < general.price) return { ok: false, reason: '金币不足' };
    this.gold -= general.price;
    this.generalIds = [...this.generalIds, generalId];
    this.shopOffer = {
      ...this.shopOffer,
      items: this.shopOffer.items.filter((id) => id !== generalId),
    };
    this.lastEvent = { type: 'purchase', text: `${general.name} 加入队伍`, general };
    this.emit();
    return { ok: true, general };
  }

  leaveShop() {
    if (this.status !== 'shop') return { ok: false, reason: '现在不在百宝阁' };
    this.roundIndex += 1;
    this.handIndex = 0;
    this.resetRoundProgress();
    this.dealHand();
    this.emit();
    return { ok: true };
  }

  /* ---------- 快照 ---------- */

  snapshot() {
    const playable = this.isPlayable();
    const live = playable || this.status === 'charm-draft';
    const best = live ? this.bestHu() : (this.lastHandResult?.scoring ?? null);
    const round = this.currentRound();
    return {
      status: this.status,
      seed: this.baseSeed,
      roundIndex: this.roundIndex,
      roundNumber: this.roundIndex + 1,
      roundCount: this.rounds.length,
      round,
      target: round.target,
      handIndex: this.handIndex,
      handNumber: this.handIndex + 1,
      handCount: round.handCount,
      flavor: this.flavor,
      looseTiles: [...this.looseTiles],
      revealedGroups: this.revealedGroups.map(cloneGroup),
      selectedIds: [...this.selectedIds],
      selectedTiles: this.selectedTiles(),
      selectionPreview: this.selectionPreview(),
      slotsUsed: this.slotsUsed(),
      slotCount: this.config.fortuneSlots,
      emptySlots: this.emptySlots(),
      swapsRemaining: this.swapsRemaining,
      charmIds: [...this.charmIds],
      pendingDraft: this.pendingDraft ? { ...this.pendingDraft } : null,
      nextTile: this.wall[0] ?? null,
      upcomingTiles: this.wall.slice(0, 2),
      wallCount: this.wall.length,
      distance: live ? this.distance() : 0,
      canHu: this.status === 'hu-ready',
      preview: best,
      projectedGold: this.projectedGold(live ? best : null),
      charmGold: this.charmGold,
      structuralCount: structuralCount(this.looseTiles, this.revealedGroups),
      physicalCount: physicalCount(this.looseTiles, this.revealedGroups),
      roundScore: this.roundScore,
      pendingGold: this.pendingGold,
      gold: this.gold,
      generalIds: [...this.generalIds],
      generalSlots: this.config.generalSlots,
      shopOffer: this.shopOffer ? { ...this.shopOffer, items: [...this.shopOffer.items] } : null,
      rerollCost: this.config.rerollCost,
      handResults: [...this.handResults],
      lastHandResult: this.lastHandResult,
      completedRounds: [...this.completedRounds],
      totalScore: this.totalScore,
      lastEvent: this.lastEvent,
    };
  }
}
