/** 启动与依赖组装：平台适配 → Run 工厂 → 界面。 */

import { Run } from './core/run.mjs';
import { createWebAdapter } from './platforms/adapter.mjs';
import { createSaveCoordinator } from './state/save-coordinator.mjs';
import { createLocalStorage, restoreRun, serializeRun } from './state/save.mjs';
import { createApp } from './ui/app.mjs';
import { setAudioEnabled } from './ui/audio.mjs';

const params = new URLSearchParams(location.search);
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const deckParam = params.get('deck');
const skipTitle = params.get('intro') === '0';
// ?tutorial=1 强制直达教学，?tutorial=0 让“开始新局”跳过首次教学（自动化测试用）
const tutorialParam = params.get('tutorial');
const wantTutorial = tutorialParam === '1' ? true : (tutorialParam === '0' ? false : null);

const storage = createLocalStorage();
const adapter = createWebAdapter({ storage });
await adapter.initialize();

const createRun = ({ seed, deckId } = {}) => new Run({
  seed: Number.isFinite(seed) ? seed : (Number.isFinite(seedParam) ? seedParam : 0),
  deckId: deckId ?? deckParam ?? 'plain',
});

// 有存档就先恢复出来，标题页的「继续」直接接上
const saved = await adapter.loadSave();
const initialRun = createRun({});
let savedRun = false;
if (saved && !Number.isFinite(seedParam)) {
  savedRun = restoreRun(initialRun, saved).ok;
}

// 普通状态保留 400ms 防抖；求签等关键状态立即入串行队列。
// 平台存档即使是异步的，也不会出现旧请求晚完成、覆盖新状态。
const saveCoordinator = createSaveCoordinator({
  save: (snapshot) => adapter.save(snapshot),
  debounceMs: 400,
});
let stopWatchingSaves = null;
let activeRunShouldPersist = false;
const scheduleSave = (run) => {
  saveCoordinator.schedule(serializeRun(run));
};
const flushSave = (run) => {
  return saveCoordinator.flush(serializeRun(run));
};
const watchSaves = (run, { silent = false, persist = true } = {}) => {
  stopWatchingSaves?.();
  stopWatchingSaves = null;
  activeRunShouldPersist = persist;
  saveCoordinator.cancelScheduled();
  // 教学局不落档：否则打完教学，标题页会出现「继续上局」并接回教学牌
  if (!persist) return;
  stopWatchingSaves = run.subscribe((state) => {
    const critical = state.status === 'charm-draft'
      || ['charm', 'draft-reroll', 'omen', 'omen-replace'].includes(state.lastEvent?.type);
    if (critical) void flushSave(run);
    else scheduleSave(run);
  });
  // 标题背景的临时 Run 不应凭空制造「继续上局」；真正开局则立即落档。
  if (!silent) void flushSave(run);
};

const app = createApp({ createRun, adapter, storage, onRunAttached: watchSaves });
app.mount({ initialRun, savedRun, autoStart: skipTitle, tutorial: wantTutorial });

adapter.onLifecycle((event) => {
  // 标题背景 Run 与教学 Run 都是临时态，切后台 / 刷新也不能把它们写成正式存档。
  if (event === 'pause' && app.run && activeRunShouldPersist) void flushSave(app.run);
  if (event === 'audio') setAudioEnabled(adapter.isAudioEnabled());
});

// 给自动化测试用的挂载点
globalThis.__tianhu = { get run() { return app.run; }, app, adapter };
