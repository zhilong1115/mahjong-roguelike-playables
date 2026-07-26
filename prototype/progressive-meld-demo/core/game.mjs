import {
  classifySelection,
  detectHuPatterns,
  findHuSolution,
  findUnlockedHuSolution,
  GROUPS,
  physicalCount,
  scoreGroups,
  structuralCount,
} from './rules.mjs';
import { createScenario } from './scenarios.mjs';
import { sortTiles, tileKey } from './tiles.mjs';

export class ProgressiveMeldGame {
  constructor(options = {}) {
    this.listeners = new Set();
    this.groupSerial = 1;
    this.reset(options);
  }

  reset({ scenario = 'simple', seed } = {}) {
    const setup = createScenario(scenario, seed);
    this.scenario = setup.scenario;
    this.seed = setup.seed;
    this.looseTiles = setup.looseTiles;
    this.wall = setup.wall;
    this.discard = [];
    this.groups = [];
    this.selectedIds = new Set();
    this.swapsLeft = setup.swaps;
    this.status = 'active';
    this.finalScore = null;
    this.huPatterns = [];
    this.lastEvent = { type: 'start', text: `${this.scenario.name}开始` };
    this.groupSerial = 1;
    this.emit();
    return this.snapshot();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of this.listeners) listener(this.snapshot());
  }

  selectedTiles() {
    return this.looseTiles.filter((tile) => this.selectedIds.has(tile.id));
  }

  toggleTile(tileId) {
    if (this.status !== 'active') return false;
    if (!this.looseTiles.some((tile) => tile.id === tileId)) return false;
    if (this.selectedIds.has(tileId)) {
      this.selectedIds.delete(tileId);
    } else {
      if (this.selectedIds.size >= 4) {
        this.lastEvent = { type: 'error', text: '一次最多选择 4 张' };
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
    if (!this.selectedIds.size) return;
    this.selectedIds.clear();
    this.lastEvent = { type: 'selection', text: '已取消选择' };
    this.emit();
  }

  selectionPreview() {
    const selected = this.selectedTiles();
    const analysis = classifySelection(selected);
    if (!analysis.valid) return { ...analysis, text: analysis.reason };

    if (analysis.kind === 'swap') {
      if (this.swapsLeft <= 0) {
        return { valid: false, kind: 'swap', reason: '换牌次数已用完', text: '换牌次数已用完' };
      }
      if (!this.wall.length) {
        return { valid: false, kind: 'swap', reason: '牌墙已空', text: '牌墙已空' };
      }
      return { ...analysis, text: `换掉 ${selected.length} 张 · 摸 1 张` };
    }

    const pairCount = this.groups.filter((group) => group.kind === 'pair').length;
    const meldCount = this.groups.filter((group) => group.kind !== 'pair').length;
    if (analysis.kind === 'pair' && pairCount >= 1) {
      return {
        valid: false,
        kind: 'pair',
        reason: '将位已有对子；先拆开或用第三张升级',
        text: '将位已占用',
      };
    }
    if (analysis.kind !== 'pair' && meldCount >= 4) {
      return {
        valid: false,
        kind: analysis.kind,
        reason: '四个面子槽已经占满',
        text: '面子槽已满',
      };
    }
    if (analysis.kind === 'kong' && !this.wall.length) {
      return { valid: false, kind: 'kong', reason: '没有补张牌可摸', text: '牌墙已空' };
    }
    return {
      ...analysis,
      text: `锁定${analysis.cn} · ${analysis.chips} 筹码`,
    };
  }

  performSelectionAction() {
    if (this.status !== 'active') return { ok: false, reason: '本局已经结束' };
    const selected = this.selectedTiles();
    const preview = this.selectionPreview();
    if (!preview.valid) {
      this.lastEvent = { type: 'error', text: preview.reason || preview.text };
      this.emit();
      return { ok: false, reason: preview.reason || preview.text };
    }
    if (preview.kind === 'swap') return this.swapSelected();
    return this.lockSelected(preview.kind);
  }

  drawOne() {
    const tile = this.wall.shift();
    if (!tile) return null;
    this.looseTiles = sortTiles([...this.looseTiles, tile]);
    return tile;
  }

  swapSelected() {
    const selected = this.selectedTiles();
    if (selected.length !== 1 || this.swapsLeft <= 0 || !this.wall.length) {
      return { ok: false, reason: '现在不能换牌' };
    }
    const discarded = selected[0];
    this.looseTiles = this.looseTiles.filter((tile) => tile.id !== discarded.id);
    this.discard.push(discarded);
    this.swapsLeft -= 1;
    this.selectedIds.clear();
    const drawn = this.drawOne();
    this.lastEvent = {
      type: 'swap',
      text: `换掉一张，摸到新牌`,
      discarded,
      drawn,
    };
    this.emit();
    return { ok: true, discarded, drawn };
  }

  lockSelected(kind) {
    const selected = this.selectedTiles();
    const preview = this.selectionPreview();
    if (!preview.valid || preview.kind !== kind || kind === 'swap') {
      return { ok: false, reason: preview.reason || '不能锁定这组牌' };
    }

    const group = {
      id: `g${this.groupSerial++}`,
      kind,
      tiles: sortTiles(selected),
      committed: kind === 'kong',
    };
    const selectedSet = new Set(selected.map((tile) => tile.id));
    this.looseTiles = this.looseTiles.filter((tile) => !selectedSet.has(tile.id));
    this.groups = [...this.groups, group];
    this.selectedIds.clear();

    let supplement = null;
    if (kind === 'kong') supplement = this.drawOne();
    this.lastEvent = {
      type: 'lock',
      text: kind === 'kong' ? '杠！补摸一张，不消耗换牌' : `${GROUPS[kind].cn}已归位`,
      group,
      supplement,
    };
    this.emit();
    return { ok: true, group, supplement };
  }

  interactWithGroup(groupId) {
    if (this.status !== 'active') return { ok: false, reason: '本局已经结束' };
    const group = this.groups.find((candidate) => candidate.id === groupId);
    if (!group) return { ok: false, reason: '组合不存在' };

    const selected = this.selectedTiles();
    if (selected.length === 1 && tileKey(selected[0]) === tileKey(group.tiles[0])) {
      if (group.kind === 'pair') return this.upgradeGroup(groupId, 'pung');
      if (group.kind === 'pung') return this.upgradeGroup(groupId, 'kong');
    }

    if (group.committed) {
      this.lastEvent = { type: 'error', text: '杠已经补牌，不能再拆开' };
      this.emit();
      return { ok: false, reason: this.lastEvent.text };
    }

    this.groups = this.groups.filter((candidate) => candidate.id !== groupId);
    this.looseTiles = sortTiles([...this.looseTiles, ...group.tiles]);
    this.selectedIds.clear();
    this.lastEvent = { type: 'unlock', text: `${GROUPS[group.kind].cn}已拆回手牌`, group };
    this.emit();
    return { ok: true, group };
  }

  upgradeGroup(groupId, nextKind) {
    const group = this.groups.find((candidate) => candidate.id === groupId);
    const selected = this.selectedTiles();
    if (!group || selected.length !== 1) return { ok: false, reason: '无法升级组合' };
    if (tileKey(selected[0]) !== tileKey(group.tiles[0])) return { ok: false, reason: '牌面不相同' };
    if (group.kind === 'pair' && nextKind !== 'pung') return { ok: false, reason: '对子只能升级为刻子' };
    if (group.kind === 'pung' && nextKind !== 'kong') return { ok: false, reason: '刻子只能升级为杠' };
    if (nextKind === 'kong' && !this.wall.length) return { ok: false, reason: '没有补张牌可摸' };

    const added = selected[0];
    this.looseTiles = this.looseTiles.filter((tile) => tile.id !== added.id);
    this.selectedIds.clear();
    group.kind = nextKind;
    group.tiles = sortTiles([...group.tiles, added]);
    group.committed = nextKind === 'kong';

    let supplement = null;
    if (nextKind === 'kong') supplement = this.drawOne();
    this.lastEvent = {
      type: 'upgrade',
      text: nextKind === 'kong' ? '刻子升杠！补摸一张' : '将牌升级为刻子',
      group,
      supplement,
    };
    this.emit();
    return { ok: true, group, supplement };
  }

  huSolution() {
    return findHuSolution(this.looseTiles, this.groups);
  }

  handCanFormHu() {
    return Boolean(this.huSolution());
  }

  canHu() {
    if (this.looseTiles.length !== 0) return false;
    const pairCount = this.groups.filter((group) => group.kind === 'pair').length;
    const meldCount = this.groups.filter((group) => group.kind !== 'pair').length;
    return pairCount === 1 && meldCount === 4 && Boolean(this.huSolution());
  }

  hasLockConflict() {
    return this.groups.length > 0
      && !this.handCanFormHu()
      && Boolean(findUnlockedHuSolution(this.looseTiles, this.groups));
  }

  declareHu() {
    if (this.status !== 'active') return { ok: false, reason: '本局已经结算' };
    if (!this.canHu()) {
      const reason = this.handCanFormHu()
        ? '牌型已经成形，请先把剩余组合归位'
        : this.hasLockConflict() ? '当前锁组挡住了胡牌，先拆一组试试' : '现在还不能胡';
      this.lastEvent = { type: 'error', text: reason };
      this.emit();
      return { ok: false, reason };
    }

    const finalGroups = this.groups;
    this.selectedIds.clear();
    this.huPatterns = detectHuPatterns(finalGroups);
    this.finalScore = scoreGroups(finalGroups, { includeHuBonus: true });
    this.status = 'won';
    this.lastEvent = { type: 'hu', text: `${this.huPatterns.join(' · ')}！`, score: this.finalScore };
    this.emit();
    return { ok: true, score: this.finalScore, patterns: this.huPatterns };
  }

  concede() {
    if (this.status !== 'active' || this.swapsLeft > 0 || this.canHu() || this.handCanFormHu()) {
      return { ok: false, reason: '现在不能流局' };
    }
    this.status = 'lost';
    this.lastEvent = { type: 'lost', text: '换牌用完，本副流局' };
    this.emit();
    return { ok: true };
  }

  pendingScore() {
    return scoreGroups(this.groups);
  }

  snapshot() {
    const hu = this.huSolution();
    return {
      scenario: this.scenario,
      seed: this.seed,
      looseTiles: [...this.looseTiles],
      groups: this.groups.map((group) => ({ ...group, tiles: [...group.tiles] })),
      selectedIds: [...this.selectedIds],
      selectedTiles: this.selectedTiles(),
      selectionPreview: this.selectionPreview(),
      swapsLeft: this.swapsLeft,
      wallCount: this.wall.length,
      discardCount: this.discard.length,
      status: this.status,
      canHu: this.canHu(),
      handCanFormHu: Boolean(hu),
      hasLockConflict: this.hasLockConflict(),
      pendingScore: this.pendingScore(),
      finalScore: this.finalScore,
      huPatterns: [...this.huPatterns],
      structuralCount: structuralCount(this.looseTiles, this.groups),
      physicalCount: physicalCount(this.looseTiles, this.groups),
      lastEvent: this.lastEvent,
    };
  }
}
