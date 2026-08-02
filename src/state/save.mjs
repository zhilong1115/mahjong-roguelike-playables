/**
 * 存档：显式 schemaVersion + 逐版本迁移函数。
 * 无法解析的旧档不会被静默覆盖，而是返回 null 让上层决定。
 *
 * 手内状态整份存下来（手牌、牌墙、已亮组），这样任何时刻退出都能原样恢复，
 * 不依赖「重新按 seed 推演」这种容易和规则改动一起腐烂的做法。
 */

import { makeTile } from '../core/tiles.mjs';
import { CHARMS } from '../content/charms.mjs';

export const SCHEMA_VERSION = 5;

const serializeTile = (tile) => `${tile.id}|${tile.suit}|${tile.rank}`;
const deserializeTile = (text) => {
  const [id, suit, rank] = text.split('|');
  return makeTile(id, suit, Number(rank));
};

const cloneOmen = (omen) => (omen ? { ...omen } : null);
const cloneActiveChoice = (choice) => (choice ? {
  ...choice,
  choices: (choice.choices ?? []).map((entry) => ({ ...entry })),
  preview: choice.preview ? { ...choice.preview, patternsAfter: [...(choice.preview.patternsAfter ?? [])] } : null,
} : null);

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

/** @param {import('../core/run.mjs').Run} run */
export function serializeRun(run) {
  return {
    schemaVersion: SCHEMA_VERSION,
    seed: run.seed,
    deckId: run.deckId,
    status: run.status,
    anteIndex: run.anteIndex,
    activeAnteCount: run.activeAnteCount,
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
    pendingOmen: cloneOmen(run.pendingOmen),
    blindEntryPendingOmen: cloneOmen(run.blindEntryPendingOmen),
    hand: {
      looseTiles: run.looseTiles.map(serializeTile),
      wall: run.wall.map(serializeTile),
      discard: run.discard.map(serializeTile),
      flavorId: run.flavor?.id ?? null,
      previewCount: run.previewCount ?? 2,
      revealedGroups: run.revealedGroups.map((group) => ({
        id: group.id,
        kind: group.kind,
        charmId: group.charmId ?? null,
        charmInstanceId: group.charmInstanceId ?? null,
        reserveCharmId: group.reserveCharmId ?? null,
        tiles: group.tiles.map(serializeTile),
      })),
      swapsRemaining: run.swapsRemaining,
      bonusSwapsRemaining: run.bonusSwapsRemaining,
      charmIds: [...run.charmIds],
      charmInstances: run.charmInstances.map((instance) => ({ ...instance })),
      satchel: run.satchel.map((instance) => ({ ...instance })),
      activeChoice: cloneActiveChoice(run.activeChoice),
      fateSatchelUsed: run.fateSatchelUsed,
      wallShuffleCount: run.wallShuffleCount,
      charmGold: run.charmGold,
      usedSealKinds: [...run.usedSealKinds],
      omenTriggeredThisHand: run.omenTriggeredThisHand,
      draft: cloneDraft(run.draft),
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
  const standardAnteCount = Math.min(
    run.antes.length,
    Math.max(1, run.baseline.standardAnteCount ?? run.antes.length),
  );
  run.activeAnteCount = Number.isInteger(save.activeAnteCount)
    ? Math.min(run.antes.length, Math.max(standardAnteCount, save.activeAnteCount))
    : (save.anteIndex >= standardAnteCount ? run.antes.length : standardAnteCount);
  run.blindKind = save.blindKind;
  run.handIndex = Math.min(
    Math.max(0, Number.isInteger(save.handIndex) ? save.handIndex : 0),
    Math.max(0, run.currentAnte().handsPerBlind - 1),
  );
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
  run.pendingOmen = cloneOmen(save.pendingOmen);
  run.blindEntryPendingOmen = cloneOmen(save.blindEntryPendingOmen);

  const hand = save.hand;
  run.looseTiles = hand.looseTiles.map(deserializeTile);
  run.wall = hand.wall.map(deserializeTile);
  run.discard = hand.discard.map(deserializeTile);
  run.revealedGroups = hand.revealedGroups.map((group) => ({
    id: group.id,
    kind: group.kind,
    charmId: group.charmId ?? null,
    charmInstanceId: group.charmInstanceId ?? null,
    reserveCharmId: group.reserveCharmId ?? null,
    revealed: true,
    tiles: group.tiles.map(deserializeTile),
  }));
  run.swapsRemaining = hand.swapsRemaining;
  run.bonusSwapsRemaining = hand.bonusSwapsRemaining ?? 0;
  run.charmIds = [...(hand.charmIds ?? [])];
  run.charmInstances = (hand.charmInstances ?? []).map((instance) => ({ ...instance }));
  run.satchel = (hand.satchel ?? []).slice(0, 3).map((instance) => ({ ...instance }));
  run.activeChoice = cloneActiveChoice(hand.activeChoice);
  run.fateSatchelUsed = Boolean(hand.fateSatchelUsed);
  run.wallShuffleCount = Math.max(0, Number(hand.wallShuffleCount) || 0);
  run.charmGold = hand.charmGold ?? 0;
  run.usedSealKinds = new Set(hand.usedSealKinds ?? []);
  run.omenTriggeredThisHand = Boolean(hand.omenTriggeredThisHand);
  run.draft = cloneDraft(hand.draft);
  run.selectedIds = new Set();
  run.flavor = hand.flavorId ? { id: hand.flavorId, name: hand.flavorId, hint: '' } : null;
  const fallbackPreviewCount = hand.flavorId === 'sevenPairs'
    ? 2
    : Math.max(2, run.currentAnte()?.brokenTiles ?? 2);
  run.previewCount = Number.isInteger(hand.previewCount) && hand.previewCount > 0
    ? hand.previewCount
    : fallbackPreviewCount;

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
 * v3 → v4：灵签变为带固定签阶的实例；签局保存 offers / tierSlots；加入待缘状态。
 * v4 → v5：加入三格主动锦囊、主动目标中间态，以及额外 / 可兑换换牌分账。
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

  if (save.schemaVersion === 3) {
    const hand = save.hand ?? {};
    const charmIds = [...(hand.charmIds ?? [])];
    const charmInstances = Array.isArray(hand.charmInstances)
      ? hand.charmInstances.map((instance) => ({ ...instance }))
      : charmIds.map((charmId, index) => ({
        instanceId: `legacy:charm:${index}:${charmId}`,
        charmId,
        tier: CHARMS[charmId]?.tier ?? 'silver',
        role: CHARMS[charmId]?.functionRole ?? 'momentum',
        source: 'legacy',
      }));

    let draft = null;
    if (hand.draft) {
      const oldDraft = hand.draft;
      const draftId = oldDraft.draftId
        ?? `legacy:d:${save.seed ?? 0}:${save.anteIndex ?? 0}:${save.blindKind ?? 'small'}:${save.handIndex ?? 0}:${oldDraft.groupId ?? 'group'}`;
      const oldCharmIds = oldDraft.charmIds
        ?? oldDraft.offers?.map((offer) => offer.charmId)
        ?? [];
      const offers = Array.isArray(oldDraft.offers)
        ? oldDraft.offers.map((offer, index) => {
          const item = CHARMS[offer.charmId];
          return {
            offerId: offer.offerId ?? `${draftId}:r${oldDraft.rolls ?? 0}:o${index}`,
            charmId: offer.charmId,
            tier: offer.tier ?? item?.tier ?? 'silver',
            role: offer.role ?? item?.functionRole ?? 'momentum',
            draftRole: offer.draftRole ?? item?.draftRole ?? item?.role ?? 'wild',
            slotRole: offer.slotRole ?? ['group', 'pattern', 'wild', 'extra'][index] ?? 'extra',
          };
        })
        : oldCharmIds.map((charmId, index) => {
          const item = CHARMS[charmId];
          return {
            offerId: `${draftId}:r${oldDraft.rolls ?? 0}:o${index}`,
            charmId,
            tier: item?.tier ?? 'silver',
            role: item?.functionRole ?? 'momentum',
            draftRole: item?.draftRole ?? item?.role ?? 'wild',
            slotRole: ['group', 'pattern', 'wild', 'extra'][index] ?? 'extra',
          };
        });
      draft = {
        ...oldDraft,
        draftId,
        offerCount: oldDraft.offerCount ?? offers.length,
        tierSlots: oldDraft.tierSlots
          ? [...oldDraft.tierSlots]
          : offers.map((offer) => offer.tier),
        appliedOmen: cloneOmen(oldDraft.appliedOmen),
        offers,
        charmIds: offers.map((offer) => offer.charmId),
        pendingOmenReplacement: oldDraft.pendingOmenReplacement
          ? {
            ...oldDraft.pendingOmenReplacement,
            current: cloneOmen(oldDraft.pendingOmenReplacement.current),
            next: cloneOmen(oldDraft.pendingOmenReplacement.next),
          }
          : null,
      };
    }

    save = {
      ...save,
      schemaVersion: 4,
      pendingOmen: cloneOmen(save.pendingOmen),
      blindEntryPendingOmen: cloneOmen(save.blindEntryPendingOmen),
      hand: {
        ...hand,
        charmIds,
        charmInstances,
        omenTriggeredThisHand: Boolean(hand.omenTriggeredThisHand),
        draft,
      },
    };
  }

  if (save.schemaVersion === 4) {
    const hand = save.hand ?? {};
    save = {
      ...save,
      schemaVersion: 5,
      hand: {
        ...hand,
        bonusSwapsRemaining: 0,
        satchel: [],
        activeChoice: null,
        fateSatchelUsed: false,
        wallShuffleCount: 0,
        draft: cloneDraft(hand.draft),
      },
    };
  }

  if (save.schemaVersion !== SCHEMA_VERSION) return null;
  if (!save.hand || !Array.isArray(save.hand.looseTiles)) return null;
  if (typeof save.anteIndex !== 'number' || !save.blindKind) return null;
  return save;
}

const STORAGE_KEY = 'tianhu.run.v5';
const LEGACY_STORAGE_KEYS = Object.freeze(['tianhu.run.v4', 'tianhu.run.v3']);

/** 浏览器本地存档；平台存档由 adapter 覆盖。 */
export function createLocalStorage(storage = globalThis.localStorage) {
  return {
    async load() {
      for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
        try {
          const raw = storage?.getItem(key);
          if (raw) return JSON.parse(raw);
        } catch {
          // 某一代存档损坏时继续尝试旧键；成功写入新版后旧键会被清理。
        }
      }
      return null;
    },
    async save(data) {
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(data));
        // 只有 v5 写入成功后才删除旧键，避免迁移过程中把唯一可用存档清掉。
        for (const key of LEGACY_STORAGE_KEYS) storage?.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
    async clear() {
      try {
        storage?.removeItem(STORAGE_KEY);
        for (const key of LEGACY_STORAGE_KEYS) storage?.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}
