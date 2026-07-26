/**
 * 存档：显式 schemaVersion + 逐版本迁移函数。
 * 无法解析的旧档不会被静默覆盖，而是返回 null 让上层决定。
 *
 * 手内状态整份存下来（手牌、牌墙、已亮组），这样任何时刻退出都能原样恢复，
 * 不依赖「重新按 seed 推演」这种容易和规则改动一起腐烂的做法。
 */

import { makeTile } from '../core/tiles.mjs';

export const SCHEMA_VERSION = 3;

const serializeTile = (tile) => `${tile.id}|${tile.suit}|${tile.rank}`;
const deserializeTile = (text) => {
  const [id, suit, rank] = text.split('|');
  return makeTile(id, suit, Number(rank));
};

/** @param {import('../core/run.mjs').Run} run */
export function serializeRun(run) {
  return {
    schemaVersion: SCHEMA_VERSION,
    seed: run.seed,
    deckId: run.deckId,
    status: run.status,
    anteIndex: run.anteIndex,
    blindKind: run.blindKind,
    handIndex: run.handIndex,
    clearedBlinds: run.clearedBlinds,
    blindOutcomes: { ...run.blindOutcomes },
    bossIds: [...run.bossIds],
    gold: run.gold,
    pendingGold: run.pendingGold,
    blindScore: run.blindScore,
    totalScore: run.totalScore,
    groupSerial: run.groupSerial,
    generalIds: [...run.generalIds],
    codexLevels: { ...run.codexLevels },
    bones: { ...run.bones },
    seals: { ...run.seals },
    papers: [...run.papers],
    back: run.back,
    suitBias: run.suitBias,
    tags: [...run.tags],
    pendingFreeBuy: run.pendingFreeBuy,
    pendingExtraSwaps: run.pendingExtraSwaps,
    pendingFreeCharms: run.pendingFreeCharms,
    hand: {
      looseTiles: run.looseTiles.map(serializeTile),
      wall: run.wall.map(serializeTile),
      discard: run.discard.map(serializeTile),
      flavorId: run.flavor?.id ?? null,
      revealedGroups: run.revealedGroups.map((group) => ({
        id: group.id,
        kind: group.kind,
        charmId: group.charmId ?? null,
        tiles: group.tiles.map(serializeTile),
      })),
      swapsRemaining: run.swapsRemaining,
      charmIds: [...run.charmIds],
      charmGold: run.charmGold,
      usedSealKinds: [...run.usedSealKinds],
      draft: run.draft ? { ...run.draft, charmIds: [...run.draft.charmIds] } : null,
    },
    shop: run.shop
      ? { ...run.shop, items: run.shop.items.map((item) => ({ ...item })), pending: run.shop.pending }
      : null,
    handResults: run.handResults.map(stripResult),
    completedBlinds: run.completedBlinds.map((blind) => ({
      ...blind,
      hands: blind.hands.map(stripResult),
    })),
  };
}

/** 结算结果里的 steps 和分解只用于动画，不进存档。 */
function stripResult(result) {
  const { steps, solution, ...rest } = result;
  return rest;
}

/** @param {import('../core/run.mjs').Run} run */
export function restoreRun(run, data) {
  const save = migrate(data);
  if (!save) return { ok: false, reason: '无法识别的存档' };

  run.seed = save.seed >>> 0;
  run.deckId = save.deckId ?? 'plain';
  run.status = save.status;
  run.anteIndex = save.anteIndex;
  run.blindKind = save.blindKind;
  run.handIndex = save.handIndex;
  run.clearedBlinds = save.clearedBlinds ?? 0;
  run.blindOutcomes = { ...save.blindOutcomes };
  run.bossIds = [...save.bossIds];
  run.gold = save.gold;
  run.pendingGold = save.pendingGold;
  run.blindScore = save.blindScore;
  run.totalScore = save.totalScore;
  run.groupSerial = save.groupSerial ?? 1;
  run.generalIds = [...save.generalIds];
  run.codexLevels = { ...save.codexLevels };
  run.bones = { ...save.bones };
  run.seals = { ...save.seals };
  run.papers = [...(save.papers ?? [])];
  run.back = save.back ?? 'plain';
  run.suitBias = save.suitBias ?? null;
  run.tags = [...(save.tags ?? [])];
  run.pendingFreeBuy = save.pendingFreeBuy ?? 0;
  run.pendingExtraSwaps = save.pendingExtraSwaps ?? 0;
  run.pendingFreeCharms = save.pendingFreeCharms ?? 0;

  const hand = save.hand;
  run.looseTiles = hand.looseTiles.map(deserializeTile);
  run.wall = hand.wall.map(deserializeTile);
  run.discard = hand.discard.map(deserializeTile);
  run.revealedGroups = hand.revealedGroups.map((group) => ({
    id: group.id,
    kind: group.kind,
    charmId: group.charmId ?? null,
    revealed: true,
    tiles: group.tiles.map(deserializeTile),
  }));
  run.swapsRemaining = hand.swapsRemaining;
  run.charmIds = [...hand.charmIds];
  run.charmGold = hand.charmGold ?? 0;
  run.usedSealKinds = new Set(hand.usedSealKinds ?? []);
  run.draft = hand.draft ? { ...hand.draft, charmIds: [...hand.draft.charmIds] } : null;
  run.selectedIds = new Set();
  run.flavor = hand.flavorId ? { id: hand.flavorId, name: hand.flavorId, hint: '' } : null;

  run.shop = save.shop
    ? { ...save.shop, items: save.shop.items.map((item) => ({ ...item })) }
    : null;
  run.handResults = [...save.handResults];
  run.completedBlinds = (save.completedBlinds ?? []).map((blind) => ({ ...blind }));
  // steps 与分解不进存档，恢复时只保留可以展示的结果摘要
  run.lastHandResult = save.status === 'hand-won' ? (save.handResults.at(-1) ?? null) : null;
  run.lastEvent = { type: 'restore', text: '已恢复上次进度' };
  run.emit();
  return { ok: true };
}

/**
 * 版本迁移。每一版都写显式函数，不做「尽量猜」。
 * v1 → v2：牌种改造从单张实体牌改成整个牌种，`tileMods` 拆成 `bones` / `seals`。
 * v2 → v3：加入圈关结构，`roundIndex` 变成 `anteIndex` + `blindKind`。
 */
export function migrate(data) {
  if (!data || typeof data !== 'object') return null;
  let save = data;

  if (save.schemaVersion === 1) {
    const { tileMods = {}, ...rest } = save;
    const bones = {};
    const seals = {};
    for (const [kind, mod] of Object.entries(tileMods)) {
      if (mod?.bone) bones[kind] = mod.bone;
      if (mod?.seal) seals[kind] = mod.seal;
    }
    save = { ...rest, bones, seals, schemaVersion: 2 };
  }

  if (save.schemaVersion === 2) {
    const { roundIndex = 0, roundScore = 0, completedRounds = [], ...rest } = save;
    save = {
      ...rest,
      schemaVersion: 3,
      deckId: 'plain',
      anteIndex: Math.min(roundIndex, 2),
      blindKind: 'small',
      clearedBlinds: completedRounds.length,
      blindOutcomes: {},
      bossIds: ['oneEye', 'threeRounds', 'ironAbacus'],
      blindScore: roundScore,
      papers: [],
      back: 'plain',
      suitBias: null,
      tags: [],
      pendingFreeBuy: 0,
      pendingExtraSwaps: 0,
      pendingFreeCharms: 0,
      completedBlinds: completedRounds.map((round) => ({
        anteId: round.roundId ?? 'east',
        blindKind: 'small',
        name: round.name ?? '旧存档',
        score: round.score ?? 0,
        banked: round.banked ?? 0,
        reward: 0,
        hands: round.hands ?? [],
      })),
    };
  }

  if (save.schemaVersion !== SCHEMA_VERSION) return null;
  if (!save.hand || !Array.isArray(save.hand.looseTiles)) return null;
  if (typeof save.anteIndex !== 'number' || !save.blindKind) return null;
  return save;
}

const STORAGE_KEY = 'tianhu.run.v3';

/** 浏览器本地存档；平台存档由 adapter 覆盖。 */
export function createLocalStorage(storage = globalThis.localStorage) {
  return {
    async load() {
      try {
        const raw = storage?.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    async save(data) {
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(data));
        return true;
      } catch {
        return false;
      }
    },
    async clear() {
      try {
        storage?.removeItem(STORAGE_KEY);
        return true;
      } catch {
        return false;
      }
    },
  };
}
