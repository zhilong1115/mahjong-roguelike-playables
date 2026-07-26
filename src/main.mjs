/** 启动与依赖组装：平台适配 → Run 工厂 → 界面。 */

import { Run } from './core/run.mjs';
import { createWebAdapter } from './platforms/adapter.mjs';
import { createLocalStorage, restoreRun, serializeRun } from './state/save.mjs';
import { createApp } from './ui/app.mjs';
import { setAudioEnabled } from './ui/audio.mjs';

const params = new URLSearchParams(location.search);
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const deckParam = params.get('deck');
const skipTitle = params.get('intro') === '0';

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

// 每次状态变化都写一次本地存档；平台版换成 adapter 的存档接口
let saveTimer = null;
let stopWatchingSaves = null;
const scheduleSave = (run) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => adapter.save(serializeRun(run)), 400);
};
const watchSaves = (run, { silent = false } = {}) => {
  stopWatchingSaves?.();
  clearTimeout(saveTimer);
  stopWatchingSaves = run.subscribe(() => scheduleSave(run));
  // 标题背景的临时 Run 不应凭空制造「继续上局」；真正开局则立即落档。
  if (!silent) scheduleSave(run);
};

const app = createApp({ createRun, adapter, storage, onRunAttached: watchSaves });
app.mount({ initialRun, savedRun, autoStart: skipTitle });

adapter.onLifecycle((event) => {
  if (event === 'pause' && app.run) adapter.save(serializeRun(app.run));
  if (event === 'audio') setAudioEnabled(adapter.isAudioEnabled());
});

// 给自动化测试用的挂载点
globalThis.__tianhu = { get run() { return app.run; }, app, adapter };
