import {
  DEMO_CONFIG,
  FORTUNE_GENERALS,
  ROUND_DEFINITIONS,
  SHOP_ITEMS,
  TEMPORARY_CHARMS,
} from '../content/demo-content.mjs';
import {
  classifySelection,
  findBestHu,
  physicalCount,
  structuralCount,
} from './rules.mjs';
import { createCuratedDeal, sortTiles, tileKey } from './tiles.mjs';

function cloneGroup(group) {
  return { ...group, tiles: [...group.tiles] };
}

function supportedRouteRemains(groups) {
  const pairs = groups.filter((group) => group.kind === 'pair');
  const melds = groups.filter((group) => group.kind !== 'pair');
  const standardPossible = pairs.length <= 1 && melds.length <= 4;
  const pairKeys = pairs.map((group) => tileKey(group.tiles[0]));
  const sevenPairsPossible = melds.length === 0
    && pairs.length <= 7
    && new Set(pairKeys).size === pairKeys.length;
  return standardPossible || sevenPairsPossible;
}

export class RunShopGame {
  constructor({
    config = DEMO_CONFIG,
    rounds = ROUND_DEFINITIONS,
  } = {}) {
    this.config = config;
    this.rounds = rounds;
    this.listeners = new Set();
    this.reset();
  }

  reset() {
    this.gold = this.config.startingGold;
    this.ownedGeneralId = null;
    this.roundIndex = 0;
    this.handIndex = 0;
    this.completedRounds = [];
    this.lastBankedGold = 0;
    this.groupSerial = 1;
    this.resetRoundProgress();
    this.dealCurrentHand();
    return this.snapshot();
  }

  resetRoundProgress() {
    this.roundScore = 0;
    this.roundPendingGold = 0;
    this.handResults = [];
  }

  currentRound() {
    return this.rounds[this.roundIndex];
  }

  currentHandDefinition() {
    return this.currentRound().hands[this.handIndex];
  }

  dealCurrentHand() {
    const definition = this.currentHandDefinition();
    const deal = createCuratedDeal(definition);
    this.looseTiles = deal.looseTiles;
    this.wall = deal.wall;
    this.discard = [];
    this.revealedGroups = [];
    this.selectedIds = new Set();
    this.actionsRemaining = this.config.actionsPerHand;
    this.revealCount = 0;
    this.temporaryCharmIds = [];
    this.lastHandResult = null;
    this.status = 'playing';
    this.lastEvent = { type: 'deal', text: `${definition.name}·第 ${this.handIndex + 1} 副` };
    this.evaluateHand({ allowAutomaticSettlement: false });
    this.emit();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    const state = this.snapshot();
    for (const listener of this.listeners) listener(state);
  }

  isPlayable() {
    return this.status === 'playing' || this.status === 'hu-ready';
  }

  selectedTiles() {
    return this.looseTiles.filter((tile) => this.selectedIds.has(tile.id));
  }

  toggleTile(tileId) {
    if (!this.isPlayable()) return false;
    if (!this.looseTiles.some((tile) => tile.id === tileId)) return false;
    if (this.selectedIds.has(tileId)) {
      this.selectedIds.delete(tileId);
    } else {
      if (this.selectedIds.size >= 4) {
        this.lastEvent = { type: 'error', text: '一次最多选择 4 张牌' };
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
    if (!this.isPlayable() || this.selectedIds.size === 0) return false;
    this.selectedIds.clear();
    this.lastEvent = { type: 'selection', text: '已取消选择' };
    this.emit();
    return true;
  }

  selectionPreview() {
    if (!this.isPlayable()) return { valid: false, kind: null, reason: '当前不能行动', text: '当前不能行动' };
    if (this.actionsRemaining <= 0) return { valid: false, kind: null, reason: '行动已用完', text: '行动已用完' };

    const selected = this.selectedTiles();
    const analysis = classifySelection(selected);
    if (!analysis.valid) return { ...analysis, text: analysis.reason };
    if (analysis.kind === 'swap') {
      if (this.wall.length === 0) return { valid: false, kind: 'swap', reason: '牌墙已空', text: '牌墙已空' };
      return { ...analysis, text: '换掉 1 张·消耗 1 行动' };
    }
    if (this.revealCount >= this.config.maxRevealsPerHand) {
      return { valid: false, kind: analysis.kind, reason: '本副最多亮 2 组', text: '亮组次数已用完' };
    }
    if (analysis.kind === 'kong' && this.wall.length === 0) {
      return { valid: false, kind: 'kong', reason: '牌墙已空，无法补牌', text: '无法补牌' };
    }

    const provisionalGroup = { kind: analysis.kind, tiles: selected };
    if (!supportedRouteRemains([...this.revealedGroups, provisionalGroup])) {
      return {
        valid: false,
        kind: analysis.kind,
        reason: '这样亮组会同时堵死普通胡和七对',
        text: '没有可支持的胡牌路线',
      };
    }
    const charmId = this.currentHandDefinition().charmOrder[this.revealCount];
    const hypotheticalLoose = this.looseTiles.filter(
      (tile) => !selected.some((chosen) => chosen.id === tile.id),
    );
    if (analysis.kind === 'kong' && this.wall[0]) hypotheticalLoose.push(this.wall[0]);
    const projectedHu = findBestHu(hypotheticalLoose, [...this.revealedGroups, provisionalGroup], {
      charmIds: [...this.temporaryCharmIds, charmId],
      generalId: this.ownedGeneralId,
      actionsRemaining: this.actionsRemaining - 1,
    });
    const currentHu = this.bestHu();
    return {
      ...analysis,
      charmId,
      charm: TEMPORARY_CHARMS[charmId],
      projectedHu,
      scoreDelta: projectedHu && currentHu ? projectedHu.total - currentHu.total : null,
      text: `亮${analysis.name}·抽 1 张临时灵签·消耗 1 行动`,
    };
  }

  drawOne() {
    const tile = this.wall.shift() ?? null;
    if (tile) this.looseTiles = sortTiles([...this.looseTiles, tile]);
    return tile;
  }

  performSelectionAction() {
    const preview = this.selectionPreview();
    if (!preview.valid) {
      this.lastEvent = { type: 'error', text: preview.reason ?? preview.text };
      this.emit();
      return { ok: false, reason: preview.reason ?? preview.text };
    }

    const selected = this.selectedTiles();
    const selectedIds = new Set(selected.map((tile) => tile.id));
    this.actionsRemaining -= 1;
    this.selectedIds.clear();
    let result;

    if (preview.kind === 'swap') {
      const discarded = selected[0];
      this.looseTiles = this.looseTiles.filter((tile) => tile.id !== discarded.id);
      this.discard.push(discarded);
      const drawn = this.drawOne();
      result = { ok: true, kind: 'swap', discarded, drawn };
      this.lastEvent = { type: 'swap', text: `换掉一张，剩 ${this.actionsRemaining} 行动`, discarded, drawn };
    } else {
      this.looseTiles = this.looseTiles.filter((tile) => !selectedIds.has(tile.id));
      const group = {
        id: `g${this.groupSerial++}`,
        kind: preview.kind,
        tiles: sortTiles(selected),
        revealed: true,
      };
      this.revealedGroups = [...this.revealedGroups, group];
      this.revealCount += 1;
      const charmId = this.currentHandDefinition().charmOrder[this.revealCount - 1];
      this.temporaryCharmIds = [...this.temporaryCharmIds, charmId];
      const supplement = preview.kind === 'kong' ? this.drawOne() : null;
      const charm = TEMPORARY_CHARMS[charmId];
      result = { ok: true, kind: preview.kind, group, charm, supplement };
      this.lastEvent = {
        type: 'reveal',
        text: `亮${preview.name}，抽到${charm.name}`,
        group,
        charm,
        supplement,
      };
    }

    const automaticSettlement = this.evaluateHand({ allowAutomaticSettlement: true });
    this.emit();
    return { ...result, automaticSettlement };
  }

  bestHu() {
    return findBestHu(this.looseTiles, this.revealedGroups, {
      charmIds: this.temporaryCharmIds,
      generalId: this.ownedGeneralId,
      actionsRemaining: this.actionsRemaining,
    });
  }

  evaluateHand({ allowAutomaticSettlement = true } = {}) {
    const best = this.bestHu();
    if (best) {
      if (this.actionsRemaining === 0 && allowAutomaticSettlement) {
        this.settleHu(best, { automatic: true, emit: false });
        return true;
      }
      this.status = 'hu-ready';
      return false;
    }
    if (this.actionsRemaining === 0 && allowAutomaticSettlement) {
      this.failRound('行动用完，本副未胡', { emit: false });
      return true;
    }
    this.status = 'playing';
    return false;
  }

  declareHu() {
    if (!this.isPlayable()) return { ok: false, reason: '当前不能胡牌' };
    const best = this.bestHu();
    if (!best) {
      this.lastEvent = { type: 'error', text: '现在还不能胡' };
      this.emit();
      return { ok: false, reason: this.lastEvent.text };
    }
    return this.settleHu(best, { automatic: false, emit: true });
  }

  settleHu(best, { automatic = false, emit = true } = {}) {
    if (!this.isPlayable()) return { ok: false, reason: '本副已经结算' };
    const handGold = this.config.goldByRevealCount[this.revealCount];
    const result = {
      ok: true,
      automatic,
      handId: this.currentHandDefinition().id,
      revealCount: this.revealCount,
      gold: handGold,
      score: best.total,
      scoring: best,
      charmIds: [...this.temporaryCharmIds],
      actionsRemaining: this.actionsRemaining,
    };
    this.roundPendingGold += handGold;
    this.roundScore += best.total;
    this.handResults = [...this.handResults, result];
    this.lastHandResult = result;
    this.selectedIds.clear();
    this.status = 'hand-won';
    this.lastEvent = {
      type: 'hu',
      text: `${best.patterns.join('·')}！+${best.total} 分·${handGold} 待结算金`,
      result,
    };
    if (emit) this.emit();
    return result;
  }

  failRound(reason, { emit = true } = {}) {
    const failedScore = this.roundScore;
    const forfeitedGold = this.roundPendingGold;
    this.roundScore = 0;
    this.roundPendingGold = 0;
    this.handResults = [];
    this.selectedIds.clear();
    this.status = 'round-failed';
    this.lastEvent = {
      type: 'round-failed',
      text: `${reason}，本轮待结算奖励已清空`,
      failedScore,
      forfeitedGold,
    };
    if (emit) this.emit();
    return { ok: true, failedScore, forfeitedGold };
  }

  advance() {
    if (this.status !== 'hand-won') return { ok: false, reason: '现在不能进入下一阶段' };
    if (this.handIndex < this.currentRound().hands.length - 1) {
      this.handIndex += 1;
      this.dealCurrentHand();
      return { ok: true, status: this.status };
    }

    const round = this.currentRound();
    if (this.roundScore < round.target) {
      return this.failRound(`累计 ${this.roundScore} 分，未达 ${round.target} 分目标`);
    }

    const bankedGold = this.roundPendingGold;
    this.gold += bankedGold;
    this.lastBankedGold = bankedGold;
    this.completedRounds = [...this.completedRounds, {
      roundId: round.id,
      score: this.roundScore,
      bankedGold,
      hands: [...this.handResults],
    }];
    this.roundPendingGold = 0;
    this.status = this.roundIndex === 0 ? 'shop' : 'run-complete';
    this.lastEvent = {
      type: this.status,
      text: this.status === 'shop'
        ? `本轮达标，${bankedGold} 金已入账`
        : `两轮完成，第二轮 ${this.roundScore} 分`,
      bankedGold,
    };
    this.emit();
    return { ok: true, status: this.status, bankedGold };
  }

  restartRound() {
    if (this.status !== 'round-failed') return { ok: false, reason: '当前不需要重试' };
    this.handIndex = 0;
    this.resetRoundProgress();
    this.dealCurrentHand();
    return { ok: true };
  }

  purchaseGeneral(generalId) {
    if (this.status !== 'shop') return { ok: false, reason: '现在不在商店' };
    if (this.ownedGeneralId) return { ok: false, reason: '本局只能购买一位福将' };
    const general = FORTUNE_GENERALS[generalId];
    if (!general) return { ok: false, reason: '福将不存在' };
    if (this.gold < general.price) return { ok: false, reason: '金币不足' };
    this.gold -= general.price;
    this.ownedGeneralId = general.id;
    this.lastEvent = { type: 'purchase', text: `${general.name}加入整局`, general };
    this.emit();
    return { ok: true, general, gold: this.gold };
  }

  startSecondRound() {
    if (this.status !== 'shop') return { ok: false, reason: '现在不能开始第二轮' };
    if (!this.ownedGeneralId) return { ok: false, reason: '请先购买一位福将' };
    this.roundIndex = 1;
    this.handIndex = 0;
    this.resetRoundProgress();
    this.dealCurrentHand();
    return { ok: true };
  }

  snapshot() {
    const best = this.isPlayable() ? this.bestHu() : null;
    return {
      status: this.status,
      roundNumber: this.roundIndex + 1,
      handNumber: this.handIndex + 1,
      round: this.currentRound(),
      hand: this.currentHandDefinition(),
      target: this.currentRound().target,
      actionsRemaining: this.actionsRemaining,
      looseTiles: [...this.looseTiles],
      revealedGroups: this.revealedGroups.map(cloneGroup),
      selectedIds: [...this.selectedIds],
      selectedTiles: this.selectedTiles(),
      selectionPreview: this.selectionPreview(),
      revealCount: this.revealCount,
      temporaryCharmIds: [...this.temporaryCharmIds],
      temporaryCharms: this.temporaryCharmIds.map((id) => TEMPORARY_CHARMS[id]),
      wallCount: this.wall.length,
      discardCount: this.discard.length,
      structuralCount: structuralCount(this.looseTiles, this.revealedGroups),
      physicalCount: physicalCount(this.looseTiles, this.revealedGroups),
      canHu: Boolean(best),
      bestHu: best,
      roundScore: this.roundScore,
      roundPendingGold: this.roundPendingGold,
      roundPending: Object.freeze({ score: this.roundScore, gold: this.roundPendingGold }),
      gold: this.gold,
      lastBankedGold: this.lastBankedGold,
      ownedGeneralId: this.ownedGeneralId,
      ownedGeneral: this.ownedGeneralId ? FORTUNE_GENERALS[this.ownedGeneralId] : null,
      shopItems: SHOP_ITEMS,
      handResults: [...this.handResults],
      lastHandResult: this.lastHandResult,
      completedRounds: [...this.completedRounds],
      lastEvent: this.lastEvent,
    };
  }
}
