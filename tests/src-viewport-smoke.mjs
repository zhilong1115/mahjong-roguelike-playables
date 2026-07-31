import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const VIEWPORTS = [
  { id: 'mobile-narrow-portrait', width: 360, height: 800 },
  { id: 'mobile-standard-portrait', width: 390, height: 844 },
  { id: 'mobile-landscape', width: 844, height: 390 },
  { id: 'tablet-portrait', width: 768, height: 1024 },
  { id: 'square-embed', width: 960, height: 960 },
  { id: 'desktop-hd', width: 1280, height: 720 },
];
const COMPACT_LANDSCAPES = [
  // 真人手机反馈来自比 required 844×390 更窄的横屏；这一档专门防止第 14 张掉到第二行。
  { id: 'phone-compact-landscape', width: 667, height: 375 },
];

const MIME = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
});

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const relative = normalize(pathname).replace(/^[/\\]+/, '');
      let filePath = resolve(ROOT, relative);
      if (!filePath.startsWith(`${ROOT}/`) && filePath !== ROOT) throw new Error('Path outside root');
      if ((await stat(filePath)).isDirectory()) filePath = join(filePath, 'index.html');
      const body = await readFile(filePath);
      response.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveServer(server));
  });
}

function chromePath() {
  return process.env.CHROME_BIN
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

async function waitForDebugger(port) {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw lastError || new Error('Chrome DevTools did not start');
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.serial = 0;
    this.pending = new Map();
    this.socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id) return;
      const task = this.pending.get(message.id);
      if (!task) return;
      this.pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error.message));
      else task.resolve(message.result);
    };
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolveOpen, reject) => {
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = ++this.serial;
    return new Promise((resolveTask, reject) => {
      this.pending.set(id, { resolve: resolveTask, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitForPage(client) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await evaluate(client, `document.readyState === 'complete' && Boolean(globalThis.__tianhu)`);
    if (ready) {
      // 发牌动画会短暂位移牌面，等它结束再测量
      await evaluate(client, `document.fonts.ready.then(() => new Promise((resolve) => setTimeout(resolve, 600)))`);
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error('Demo page did not become ready');
}

async function setViewport(client, viewport) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.width < 600,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
}



const METRICS_EXPRESSION = `(() => {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const describe = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      selector: element.id ? '#' + element.id : '.' + [...element.classList].join('.'),
      left: Math.round(rect.left * 10) / 10,
      top: Math.round(rect.top * 10) / 10,
      right: Math.round(rect.right * 10) / 10,
      bottom: Math.round(rect.bottom * 10) / 10,
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
    };
  };
  const intersect = (a, b) => ({
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  });
  const visibleRatio = (element) => {
    const original = element.getBoundingClientRect();
    let clipped = intersect(original, { left: 0, top: 0, right: innerWidth, bottom: innerHeight });
    let ancestor = element.parentElement;
    while (ancestor) {
      const style = getComputedStyle(ancestor);
      if (/(hidden|clip|auto|scroll)/.test(style.overflow + style.overflowX + style.overflowY)) {
        clipped = intersect(clipped, ancestor.getBoundingClientRect());
      }
      ancestor = ancestor.parentElement;
    }
    const width = Math.max(0, clipped.right - clipped.left);
    const height = Math.max(0, clipped.bottom - clipped.top);
    const area = Math.max(1, original.width * original.height);
    return (width * height) / area;
  };
  const centerIsReachable = (element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(hit && (hit === element || element.contains(hit)));
  };
  const describeBlocked = (element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      ...describe(element),
      text: element.textContent?.trim() ?? '',
      hit: hit ? (hit.id ? '#' + hit.id : '.' + [...hit.classList].join('.')) : null,
      hitText: hit?.textContent?.trim() ?? '',
    };
  };
  const screen = document.querySelector('#screen');
  const draftLayer = document.querySelector('#draftLayer');
  const draftOpen = draftLayer && !draftLayer.hidden;
  const critical = draftOpen
    ? [...document.querySelectorAll('#draftLayer, #draftPanel, #draftTitle, #draftNotice:not([hidden]), #draftCards, .charmPick, .omenCompare, .fateChooser, .fateHand, .fateTargetGrid, #draftActions, #draftActions .btn')]
    : screen
    ? [...document.querySelectorAll('#screen .screenBox, #screen .rowBtns, #screen .shopCard, #screen .blindCard, #screen .libraryTabs, #screen .libraryGrid')]
    : [...document.querySelectorAll('#app, #side, #buildPanel, #slotBar, #table, #handZone, #actionRow, #omenSlot')];
  const clipped = critical.filter(visible).filter((element) => visibleRatio(element) < .98).map(describe);
  const primary = draftOpen
    ? [...document.querySelectorAll('#draftLayer .charmPick, #draftLayer .fateOption, #draftActions .btn')]
    : screen
    ? [...document.querySelectorAll('#screen .rowBtns .btn, #screen .shopCard, #screen .kindBtn, #screen .blindActions .btn, #screen .libraryTab')]
    : [...document.querySelectorAll('#handZone .tile, #btnSwap, #btnReveal, #btnHu, #omenSlot')];
  const actionable = primary.filter((element) => !element.disabled && !element.classList.contains('cant') && !element.classList.contains('sold'));
  const touchTargets = actionable.filter(visible).map(describe);
  const blockedTargets = actionable.filter(visible).filter((element) => !centerIsReachable(element)).map(describeBlocked);
  const tileRects = [...document.querySelectorAll('#handZone .tile canvas')].filter(visible).map(describe);
  const handZone = document.querySelector('#handZone');
  const main = document.querySelector('#main');
  const side = document.querySelector('#side');
  const sortedTileTops = tileRects.map((rect) => rect.top).sort((a, b) => a - b);
  const handRowTops = [];
  for (const top of sortedTileTops) {
    if (!handRowTops.length || top - handRowTops.at(-1) > 20) handRowTops.push(top);
  }
  const charmCards = [...document.querySelectorAll('.charmPick')];
  return {
    viewport: { width: innerWidth, height: innerHeight },
    pageScroll: document.documentElement.scrollWidth > innerWidth + 1
      || document.documentElement.scrollHeight > innerHeight + 1
      || document.body.scrollWidth > innerWidth + 1
      || document.body.scrollHeight > innerHeight + 1,
    clipped,
    blockedTargets,
    smallestTouchWidth: Math.min(...touchTargets.map((rect) => rect.width)),
    smallestTouchHeight: Math.min(...touchTargets.map((rect) => rect.height)),
    tileCount: tileRects.length,
    smallestTileWidth: Math.min(...tileRects.map((rect) => rect.width)),
    handOverflow: handZone ? handZone.scrollWidth > handZone.clientWidth + 1 : false,
    handScrollWidth: handZone?.scrollWidth ?? 0,
    handClientWidth: handZone?.clientWidth ?? 0,
    handRows: handRowTops.length,
    mainWidth: Math.round((main?.getBoundingClientRect().width ?? 0) * 10) / 10,
    sideWidth: Math.round((side?.getBoundingClientRect().width ?? 0) * 10) / 10,
    hudStatCount: document.querySelectorAll('#statPanel .stat').length,
    buildPanelParent: document.querySelector('#buildPanel')?.parentElement?.id ?? null,
    slotCount: document.querySelectorAll('#slotBar .slot').length,
    slotBarHeight: Math.round((document.querySelector('#slotBar')?.getBoundingClientRect().height ?? 0) * 10) / 10,
    smallestSlotHeight: Math.min(...[...document.querySelectorAll('#slotBar .slot')]
      .filter(visible).map((slot) => slot.getBoundingClientRect().height)),
    buildCards: document.querySelectorAll('#buildBar .buildCard').length,
    selectedCount: document.querySelectorAll('#handZone .tile.sel').length,
    screenTitle: screen?.querySelector('.title')?.textContent ?? null,
    draftOpen,
    draftParent: draftLayer?.parentElement?.id ?? null,
    charmCards: charmCards.length,
    tierLabels: charmCards.map((card) => card.querySelector('.tierName')?.textContent ?? ''),
    tierMarks: charmCards.map((card) => card.querySelector('.tierMarks')?.textContent?.length ?? 0),
    offerCount: Number(draftLayer?.dataset.offerCount ?? 0),
    fateMode: draftLayer?.dataset.mode === 'fate',
    fateOptions: document.querySelectorAll('#draftCards .fateOption').length,
    fateTargets: document.querySelectorAll('#draftCards .fateTarget').length,
    omenText: document.querySelector('#omenSlot')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
    omenInsideSlots: Boolean(document.querySelector('#slotBar #omenSlot')),
    kindButtons: document.querySelectorAll('#kindGrid .kindBtn').length,
    libraryCards: document.querySelectorAll('#screen .libraryCard').length,
    activeLibraryFamily: document.querySelector('#screen .libraryTab.active')?.dataset.family ?? null,
  };
})()`;

async function capture(client, artifactDir, name) {
  const shot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(join(artifactDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
}

function assertMetrics(metrics, viewport, label, { expectTiles = true, tileCount = 14 } = {}) {
  assert.deepEqual(metrics.viewport, { width: viewport.width, height: viewport.height }, `${label}: viewport`);
  assert.equal(metrics.pageScroll, false, `${label}: 页面级滚动`);
  assert.deepEqual(metrics.clipped, [], `${label}: 关键区域被裁切`);
  assert.deepEqual(metrics.blockedTargets, [], `${label}: 关键操作被遮挡`);
  assert.equal(metrics.handOverflow, false,
    `${label}: 手牌溢出 ${metrics.handScrollWidth}/${metrics.handClientWidth}`);
  assert.ok(metrics.smallestTouchWidth >= 43.5, `${label}: 触控宽度 ${metrics.smallestTouchWidth}`);
  assert.ok(metrics.smallestTouchHeight >= 43.5, `${label}: 触控高度 ${metrics.smallestTouchHeight}`);
  if (expectTiles) {
    assert.equal(metrics.tileCount, tileCount, `${label}: 手牌数量`);
    assert.ok(metrics.smallestTileWidth >= 33.5, `${label}: 牌面宽度 ${metrics.smallestTileWidth}`);
    assert.equal(metrics.slotCount, 6, `${label}: 6 个开运位`);
  }
}

/**
 * 等一个条件成立。结算动画的时长会随手感调整，测试不能写死 sleep，
 * 否则每次改节奏都要回来改测试。
 */
async function waitUntil(client, expression, { timeout = 20000, step = 150, label = '条件' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await evaluate(client, expression)) return true;
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, step));
  }
}

async function click(client, selector) {
  const clicked = await evaluate(client, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  assert.equal(clicked, true, `missing clickable ${selector}`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 60));
}

async function pressKey(client, key) {
  const code = /^[1-4]$/.test(key) ? `Digit${key}` : key;
  const windowsVirtualKeyCode = key === 'Enter'
    ? 13
    : key === 'Escape'
      ? 27
      : key.charCodeAt(0);
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode,
  });
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode,
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 40));
}

async function startCurrentBlind(client, label) {
  const before = await evaluate(client, 'globalThis.__tianhu.run.status');
  assert.equal(before, 'blind-select', `${label}: 应当先进入选关屏`);
  await click(client, '#screen .blindCard.current .blindActions .btn.green');
  const after = await evaluate(client, 'globalThis.__tianhu.run.status');
  assert.ok(['playing', 'hu-ready'].includes(after), `${label}: 开打后异常状态 ${after}`);
  // 发牌动画会短暂旋转并放大牌的 bounding box，等它完成再量布局。
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 600));
}

/** 页面内的自动打牌：和 tests/helpers/auto-play.mjs 同一套策略。 */
const INSTALL_AUTOPLAY = `(async () => {
  const { tilesToChange } = await import('/src/core/shanten.mjs');
  const run = globalThis.__tianhu.run;
  const support = (tile, tiles) => tiles.reduce((score, other) => {
    if (other.id === tile.id || other.suit !== tile.suit) return score;
    if (other.rank === tile.rank) return score + 3;
    if (tile.suit === 'honor') return score;
    const gap = Math.abs(other.rank - tile.rank);
    return gap === 1 ? score + 2 : gap === 2 ? score + 1 : score;
  }, 0);
  globalThis.__revealOne = () => {
    const best = run.bestHu();
    if (!best) return false;
    const looseIds = new Set(run.looseTiles.map((tile) => tile.id));
    for (const group of best.solution.groups) {
      if (group.revealed || !group.tiles.every((tile) => looseIds.has(tile.id))) continue;
      for (const tile of group.tiles) run.toggleTile(tile.id);
      if (run.revealPreview().valid && run.revealSelected().ok) return true;
      run.clearSelection();
    }
    return false;
  };
  globalThis.__playToHu = () => {
    let guard = 0;
    while (guard++ < 40 && run.status === 'playing') {
      const next = run.wall[0];
      let best = null;
      for (const tile of run.looseTiles) {
        if (tile.suit === next.suit && tile.rank === next.rank) continue;
        const candidate = [...run.looseTiles.filter((item) => item.id !== tile.id), next];
        const distance = tilesToChange(candidate, run.revealedGroups);
        const lonely = -support(tile, run.looseTiles);
        if (!best || distance < best.distance
          || (distance === best.distance && lonely > best.lonely)) best = { tile, distance, lonely };
      }
      if (!best) break;
      run.toggleTile(best.tile.id);
      run.swapSelected();
    }
    return run.status;
  };
  globalThis.__autoHand = (revealTarget = 0) => {
    let guard = 0;
    while (guard++ < 40) {
      if (run.status === 'charm-draft') { run.chooseCharm(run.draft.charmIds[0]); continue; }
      if (run.status === 'hu-ready') {
        if (run.slotsUsed() < revealTarget && globalThis.__revealOne()) continue;
        run.declareHu();
        break;
      }
      if (run.status !== 'playing') break;
      const next = run.wall[0];
      let best = null;
      for (const tile of run.looseTiles) {
        if (tile.suit === next.suit && tile.rank === next.rank) continue;
        const candidate = [...run.looseTiles.filter((item) => item.id !== tile.id), next];
        const distance = tilesToChange(candidate, run.revealedGroups);
        const lonely = -support(tile, run.looseTiles);
        if (!best || distance < best.distance
          || (distance === best.distance && lonely > best.lonely)) best = { tile, distance, lonely };
      }
      if (!best) break;
      run.toggleTile(best.tile.id);
      run.swapSelected();
    }
    return run.status;
  };
  return true;
})()`;

const staticServer = await startStaticServer();
const serverPort = staticServer.address().port;
const debuggerPort = await getFreePort();
const profileDir = await mkdtemp(join(tmpdir(), 'tianhu-chrome-'));
const artifactDir = await mkdtemp(join(tmpdir(), 'tianhu-viewports-'));
const chrome = spawn(chromePath(), [
  '--headless=new',
  '--disable-gpu',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--no-first-run',
  '--no-default-browser-check',
  '--mute-audio',
  `--remote-debugging-port=${debuggerPort}`,
  `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: 'ignore' });

let client;
try {
  const targets = await waitForDebugger(debuggerPort);
  const pageTarget = targets.find((target) => target.type === 'page');
  assert.ok(pageTarget?.webSocketDebuggerUrl, 'headless Chrome page target');
  client = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await client.open();
  await client.send('Page.enable');
  await client.send('Runtime.enable');

  // seed 1 能让测试玩家稳定打过东圈闲局，便于覆盖单副结算与商店流程。
  const baseUrl = `http://127.0.0.1:${serverPort}/src/?seed=1`;
  const url = `${baseUrl}&intro=0`;
  const results = [];

  // 标题页不应为背景 Run 自动造存档；点「开始新局」后应立即订阅并落档。
  await setViewport(client, VIEWPORTS[0]);
  await client.send('Page.navigate', { url: baseUrl });
  await waitForPage(client);
  const titleMetrics = await evaluate(client, METRICS_EXPRESSION);
  assertMetrics(titleMetrics, VIEWPORTS[0], 'title-mobile-narrow', { expectTiles: false });
  await capture(client, artifactDir, 'title-mobile-narrow-portrait');
  assert.equal(await evaluate(client, `localStorage.getItem('tianhu.run.v4')`), null,
    '标题背景不应自动生成存档');
  await click(client, '#screen .titleMenu > .btn.big');
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 460));
  const newRunSave = await evaluate(client, `JSON.parse(localStorage.getItem('tianhu.run.v4') ?? 'null')`);
  assert.equal(newRunSave?.status, 'blind-select', '开始新局应当自动保存');
  const firstSelect = await evaluate(client, METRICS_EXPRESSION);
  assert.equal(firstSelect.screenTitle, '东圈', '新局先进入东圈选关');
  assertMetrics(firstSelect, VIEWPORTS[0], 'blind-select-mobile-narrow', { expectTiles: false });

  // 存档若停在求签，标题 / 帮助只能覆盖它，不能靠快捷键暗中选签或取消状态。
  await startCurrentBlind(client, 'covered-draft');
  await evaluate(client, INSTALL_AUTOPLAY);
  assert.equal(await evaluate(client, `(() => { globalThis.__playToHu(); return globalThis.__revealOne(); })()`), true,
    'covered-draft: 应当先构造出求签状态');
  const savedDraft = await evaluate(client, `(async () => {
    const { serializeRun } = await import('/src/state/save.mjs');
    const run = globalThis.__tianhu.run;
    run.pendingOmen = {
      omenId: 'luckyTier', sourceCharmId: 'luckyOmen',
      acquiredAtBlind: 'covered-draft', consumeOn: 'nextCharmDraft'
    };
    run.emit();
    localStorage.setItem('tianhu.run.v4', JSON.stringify(serializeRun(run)));
    return JSON.stringify({
      status: run.status,
      draft: run.draft,
      pendingOmen: run.pendingOmen,
      charmIds: run.charmIds,
      charmInstances: run.charmInstances,
    });
  })()`);
  const restoreUrl = `http://127.0.0.1:${serverPort}/src/`;
  await client.send('Page.navigate', { url: restoreUrl });
  await waitForPage(client);
  const covered = await evaluate(client, `(() => ({
    status: globalThis.__tianhu.run.status,
    screen: Boolean(document.querySelector('#screen')),
    draftHidden: document.querySelector('#draftLayer').hidden,
    draftInert: document.querySelector('#draftLayer').inert,
    focusInsideDraft: document.querySelector('#draftLayer').contains(document.activeElement),
  }))()`);
  assert.equal(covered.status, 'charm-draft', '应恢复到求签状态');
  assert.equal(covered.screen, true, '恢复求签存档时仍应先显示标题');
  assert.equal(covered.draftHidden, true, '标题覆盖时求签层必须隐藏');
  assert.equal(covered.draftInert, true, '标题覆盖时求签层必须不可交互');
  assert.equal(covered.focusInsideDraft, false, '隐藏求签不能从标题抢走焦点');

  for (const key of ['1', 'Escape', 'Enter']) await pressKey(client, key);
  const afterTitleKeys = await evaluate(client, `(() => {
    const run = globalThis.__tianhu.run;
    return JSON.stringify({
      status: run.status,
      draft: run.draft,
      pendingOmen: run.pendingOmen,
      charmIds: run.charmIds,
      charmInstances: run.charmInstances,
    });
  })()`);
  assert.equal(afterTitleKeys, savedDraft, '标题覆盖时 1 / Esc / Enter 不得改变求签或待缘状态');

  assert.equal(await evaluate(client, `(() => {
    const help = [...document.querySelectorAll('#screen .btn')].find((node) => node.textContent.trim() === '玩法');
    help?.click();
    return Boolean(help);
  })()`), true, '标题页应能打开玩法帮助');
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
  for (const key of ['1', 'Escape', 'Enter']) await pressKey(client, key);
  const afterHelpKeys = await evaluate(client, `(() => {
    const run = globalThis.__tianhu.run;
    return JSON.stringify({
      status: run.status,
      draft: run.draft,
      pendingOmen: run.pendingOmen,
      charmIds: run.charmIds,
      charmInstances: run.charmInstances,
    });
  })()`);
  assert.equal(afterHelpKeys, savedDraft, '帮助覆盖时 1 / Esc / Enter 不得改变求签或待缘状态');
  await click(client, '#screen .rowBtns .btn.green.big');
  await click(client, '#screen .titleMenu > .btn.green.big');
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  assert.equal(await evaluate(client, `Boolean(document.querySelector('#screen'))`), false,
    '点继续后应关闭标题覆盖');
  assert.equal(await evaluate(client, `document.querySelector('#draftLayer').hidden`), false,
    '点继续后应恢复求签层');
  assert.equal(await evaluate(client, `document.activeElement?.classList.contains('charmPick') ?? false`), true,
    '点继续后焦点应进入求签选项');
  const firstRestoredCharm = await evaluate(client, `globalThis.__tianhu.run.draft.offers[0].charmId`);
  await pressKey(client, '1');
  const restoredPick = await evaluate(client, `(() => ({
    draftClosed: globalThis.__tianhu.run.draft === null,
    picked: globalThis.__tianhu.run.charmInstances.at(-1)?.charmId,
    focus: document.activeElement?.id ?? '',
  }))()`);
  assert.equal(restoredPick.draftClosed, true, '点继续后数字键 1 应能完成选签');
  assert.equal(restoredPick.picked, firstRestoredCharm, '数字键 1 应选择恢复签局的第一张');
  assert.ok(['btnHu', 'btnReveal', 'btnSwap'].includes(restoredPick.focus), '恢复签局选完后焦点应回到主要操作');

  // 百牌谱：五系页签在 required 六视口都可见、可点，卡牌列表只在面板内滚动。
  for (const viewport of VIEWPORTS) {
    await setViewport(client, viewport);
    await client.send('Page.navigate', { url: baseUrl });
    await waitForPage(client);
    await click(client, '#screen .titleMenu .libraryOpen');
    const charmLibrary = await evaluate(client, METRICS_EXPRESSION);
    assert.equal(charmLibrary.screenTitle, '百牌谱', `${viewport.id}: 应打开功能牌图鉴`);
    assert.equal(charmLibrary.activeLibraryFamily, 'charm', `${viewport.id}: 默认显示灵签`);
    assert.equal(charmLibrary.libraryCards, 19, `${viewport.id}: 应显示 19 张灵签`);
    assertMetrics(charmLibrary, viewport, `library-charm-${viewport.id}`, { expectTiles: false });
    await click(client, '#screen .libraryTab[data-family="general"]');
    const generalLibrary = await evaluate(client, METRICS_EXPRESSION);
    assert.equal(generalLibrary.activeLibraryFamily, 'general', `${viewport.id}: 福将页签应切换`);
    assert.equal(generalLibrary.libraryCards, 11, `${viewport.id}: 应显示 11 位福将`);
    assertMetrics(generalLibrary, viewport, `library-general-${viewport.id}`, { expectTiles: false });
    if (viewport.id === 'mobile-narrow-portrait' || viewport.id === 'mobile-landscape') {
      await capture(client, artifactDir, `library-${viewport.id}`);
    }
    results.push({ id: `library-${viewport.id}`, ...generalLibrary });
  }

  for (const viewport of VIEWPORTS) {
    await setViewport(client, viewport);
    await client.send('Page.navigate', { url });
    await waitForPage(client);
    const select = await evaluate(client, METRICS_EXPRESSION);
    assert.equal(select.screenTitle, '东圈', `${viewport.id}: 应当显示选关屏`);
    assertMetrics(select, viewport, `blind-select-${viewport.id}`, { expectTiles: false });
    await startCurrentBlind(client, viewport.id);
    const metrics = await evaluate(client, METRICS_EXPRESSION);
    assertMetrics(metrics, viewport, viewport.id);
    assert.equal(metrics.hudStatCount, 4, `${viewport.id}: 恢复四项资源状态`);
    assert.equal(metrics.buildPanelParent, 'side', `${viewport.id}: 本局构筑应回到左栏`);
    if (viewport.width / viewport.height >= .95) {
      assert.equal(metrics.handRows, 1, `${viewport.id}: 横屏 14 张手牌必须单排`);
    } else {
      assert.ok(metrics.handRows <= 2, `${viewport.id}: 竖屏手牌最多两排`);
    }
    const expectedSlotHeight = viewport.id === 'mobile-landscape' ? 71.5
      : viewport.width <= 420 ? 55.5
        : viewport.width / viewport.height < .95 ? 63.5 : 105.5;
    assert.ok(metrics.smallestSlotHeight >= expectedSlotHeight,
      `${viewport.id}: 大开运位高度 ${metrics.smallestSlotHeight}/${expectedSlotHeight}`);
    await capture(client, artifactDir, viewport.id);
    results.push({ id: viewport.id, ...metrics });
  }

  // 紧凑真机横屏：不是 required 平台矩阵，但直接覆盖本次真人反馈。
  for (const viewport of COMPACT_LANDSCAPES) {
    await setViewport(client, viewport);
    await client.send('Page.navigate', { url });
    await waitForPage(client);
    await startCurrentBlind(client, viewport.id);
    const metrics = await evaluate(client, METRICS_EXPRESSION);
    assertMetrics(metrics, viewport, viewport.id);
    assert.equal(metrics.handRows, 1, `${viewport.id}: 14 张手牌必须单排`);
    assert.equal(metrics.hudStatCount, 4, `${viewport.id}: 不为换行问题删除状态`);
    assert.equal(metrics.buildPanelParent, 'side', `${viewport.id}: 构筑仍在左栏`);
    assert.ok(metrics.sideWidth <= 116.5, `${viewport.id}: 左栏应进入紧凑档 ${metrics.sideWidth}`);
    assert.ok(metrics.mainWidth >= 535, `${viewport.id}: 主牌区应得到足够宽度 ${metrics.mainWidth}`);
    assert.ok(metrics.smallestSlotHeight >= 57.5,
      `${viewport.id}: 紧凑开运位仍要可读 ${metrics.smallestSlotHeight}`);
    await capture(client, artifactDir, viewport.id);
    results.push({ id: viewport.id, ...metrics });
  }

  // 普通三签：required 六视口都要完整可点，且签阶不能只靠颜色。
  for (const viewport of VIEWPORTS) {
    await setViewport(client, viewport);
    await client.send('Page.navigate', { url });
    await waitForPage(client);
    await startCurrentBlind(client, `draft-${viewport.id}`);
    await evaluate(client, INSTALL_AUTOPLAY);
    const opened = await evaluate(client, `(() => { globalThis.__playToHu(); return globalThis.__revealOne(); })()`);
    assert.equal(opened, true, `${viewport.id}: 应当能亮出一组`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 600));
    const metrics = await evaluate(client, METRICS_EXPRESSION);
    assert.equal(metrics.draftOpen, true, `${viewport.id}: 三签选一应当展开`);
    assert.equal(metrics.charmCards, 3, `${viewport.id}: 必须有三张灵签`);
    assert.equal(metrics.offerCount, 3, `${viewport.id}: 普通签局必须三选一`);
    assert.equal(metrics.draftParent, 'app', `${viewport.id}: 求签层必须是 #app 根级子层`);
    assert.equal(metrics.tierLabels.every((label) => ['银签', '金签', '彩签'].includes(label)), true,
      `${viewport.id}: 每张签必须写明签阶`);
    assert.equal(metrics.tierMarks.every((count, index) => (
      count === ({ 银签: 1, 金签: 2, 彩签: 3 })[metrics.tierLabels[index]]
    )), true, `${viewport.id}: 签纹数量必须匹配签阶`);
    assertMetrics(metrics, viewport, `draft-${viewport.id}`, { tileCount: metrics.tileCount });
    assert.ok(metrics.smallestTouchWidth >= 47.5, `${viewport.id}: 灵签触控宽度`);
    assert.ok(metrics.smallestTouchHeight >= 47.5, `${viewport.id}: 灵签触控高度`);
    if (viewport.id === 'mobile-narrow-portrait' || viewport.id === 'mobile-landscape') {
      await capture(client, artifactDir, `draft-${viewport.id}`);
    }
    results.push({ id: `draft-${viewport.id}`, ...metrics });

    // 视觉夹具：选签后，顶部开运位放完整签面；中央亮组只放一张代表牌与水墨字标。
    const meldFixture = await evaluate(client, `(() => {
      const run = globalThis.__tianhu.run;
      const group = run.revealedGroups[0];
      group.charmId = 'doubleJoy';
      group.charmTier = 'gold';
      run.draft = null;
      run.status = 'playing';
      run.emit();
      return true;
    })()`);
    assert.equal(meldFixture, true, `${viewport.id}: 应能建立亮组视觉夹具`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
    const compactMeld = await evaluate(client, `(() => ({
      melds: document.querySelectorAll('#revealZone .meld').length,
      heroTiles: document.querySelectorAll('#revealZone .meldHeroTile canvas').length,
      ink: document.querySelector('#revealZone .meldInkText')?.textContent?.trim() ?? '',
      slotArtwork: document.querySelectorAll('#slotBar .slotArtwork').length,
    }))()`);
    assert.deepEqual(compactMeld, { melds: 1, heroTiles: 1, ink: '对', slotArtwork: 1 },
      `${viewport.id}: 一组只能显示一张代表牌、水墨字标和一张完整签面`);
    const meldMetrics = await evaluate(client, METRICS_EXPRESSION);
    assertMetrics(meldMetrics, viewport, `meld-${viewport.id}`, { tileCount: meldMetrics.tileCount });
    if (viewport.id === 'mobile-narrow-portrait' || viewport.id === 'mobile-landscape') {
      await capture(client, artifactDir, `meld-${viewport.id}`);
    }
    results.push({ id: `meld-${viewport.id}`, ...meldMetrics });
  }

  // 金色改命：required 六视口都要完成「选原牌 → 选目标牌」，并可用 Esc 返回上一步。
  for (const viewport of VIEWPORTS) {
    await setViewport(client, viewport);
    await client.send('Page.navigate', { url });
    await waitForPage(client);
    await startCurrentBlind(client, `fate-${viewport.id}`);
    const began = await evaluate(client, `(async () => {
      const { makeTile, parseTileNotation, sortTiles } = await import('/src/core/tiles.mjs');
      const run = globalThis.__tianhu.run;
      run.looseTiles = sortTiles(parseTileNotation('123m 456m 789m 111p 2s 3s')
        .map((spec, index) => makeTile('fate-' + index, spec.suit, spec.rank)));
      run.revealedGroups = [];
      run.status = 'charm-draft';
      run.draft = {
        draftId: 'viewport-fate', groupId: 'missing', offerCount: 1,
        offers: [{ offerId: 'viewport-fate:o0', charmId: 'thunderGather', tier: 'gold', role: 'fate' }],
        charmIds: ['thunderGather'], tierSlots: ['gold'],
        pendingOmenReplacement: null, pendingFateChoice: null,
      };
      run.emit();
      return run.chooseDraftOffer('viewport-fate:o0');
    })()`);
    assert.equal(began.needsFateChoice, true, `${viewport.id}: 聚雷签应进入目标选择`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 160));

    const sourceMetrics = await evaluate(client, METRICS_EXPRESSION);
    assert.equal(sourceMetrics.fateMode, true, `${viewport.id}: 改命层应标记 fate mode`);
    assert.equal(sourceMetrics.fateOptions, 14, `${viewport.id}: 应重画完整 14 张未亮手牌`);
    assert.equal(sourceMetrics.fateTargets, 0, `${viewport.id}: 第一步不应提前显示目标牌`);
    assertMetrics(sourceMetrics, viewport, `fate-source-${viewport.id}`);
    assert.ok(sourceMetrics.smallestTouchWidth >= 47.5, `${viewport.id}: 改命原牌触控宽度`);
    assert.ok(sourceMetrics.smallestTouchHeight >= 47.5, `${viewport.id}: 改命原牌触控高度`);

    await click(client, '#draftCards .fateSource:not(:disabled)');
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
    const targetMetrics = await evaluate(client, METRICS_EXPRESSION);
    assert.ok(targetMetrics.fateTargets > 0, `${viewport.id}: 选原牌后应显示合法目标牌`);
    assertMetrics(targetMetrics, viewport, `fate-target-${viewport.id}`);
    if (viewport.id === 'mobile-narrow-portrait' || viewport.id === 'mobile-landscape') {
      await capture(client, artifactDir, `fate-target-${viewport.id}`);
    }

    await pressKey(client, 'Escape');
    assert.equal(await evaluate(client, `globalThis.__tianhu.run.draft.pendingFateChoice.selectedTileId`), null,
      `${viewport.id}: 目标步骤按 Esc 应返回原牌步骤`);
    await click(client, '#draftCards .fateSource:not(:disabled)');
    await click(client, '#draftCards .fateTarget');
    const finished = await evaluate(client, `(() => ({
      draftClosed: globalThis.__tianhu.run.draft === null,
      picked: globalThis.__tianhu.run.charmIds.at(-1),
      distance: globalThis.__tianhu.run.distance(),
    }))()`);
    assert.equal(finished.draftClosed, true, `${viewport.id}: 选择目标后应提交并关闭签局`);
    assert.equal(finished.picked, 'thunderGather', `${viewport.id}: 应取得聚雷签`);
    assert.ok(finished.distance < 1, `${viewport.id}: 目标选择应真实改善成胡距离`);
    results.push({ id: `fate-${viewport.id}`, ...targetMetrics });
  }

  // 广缘签兆：下一次求签变成四选一，第四张固定银签；数字键 4 能真正选中。
  for (const viewport of VIEWPORTS) {
    await setViewport(client, viewport);
    await client.send('Page.navigate', { url });
    await waitForPage(client);
    await startCurrentBlind(client, `wide-draft-${viewport.id}`);
    await evaluate(client, INSTALL_AUTOPLAY);
    const opened = await evaluate(client, `(() => {
      const run = globalThis.__tianhu.run;
      run.pendingOmen = {
        omenId: 'extraChoice', sourceCharmId: 'wideOmen',
        acquiredAtBlind: 'test', consumeOn: 'nextCharmDraft'
      };
      run.emit();
      globalThis.__playToHu();
      return globalThis.__revealOne();
    })()`);
    assert.equal(opened, true, `${viewport.id}: 广缘后应当能打开求签`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 600));
    const draftState = await evaluate(client, `(() => {
      const draft = globalThis.__tianhu.run.draft;
      return {
        draftId: draft.draftId,
        offerCount: draft.offerCount,
        tiers: draft.offers.map((offer) => offer.tier),
        appliedOmen: draft.appliedOmen?.omenId,
        fourth: draft.offers[3]?.charmId,
      };
    })()`);
    assert.equal(draftState.offerCount, 4, `${viewport.id}: 广缘必须四选一`);
    assert.equal(draftState.tiers[3], 'silver', `${viewport.id}: 加签位固定银签`);
    assert.equal(draftState.appliedOmen, 'extraChoice', `${viewport.id}: 签局要记录已应验签兆`);
    const metrics = await evaluate(client, METRICS_EXPRESSION);
    assert.equal(metrics.charmCards, 4, `${viewport.id}: 必须显示四张灵签`);
    assert.equal(metrics.offerCount, 4, `${viewport.id}: UI 必须进入四签布局`);
    assertMetrics(metrics, viewport, `wide-draft-${viewport.id}`, { tileCount: metrics.tileCount });
    assert.ok(metrics.smallestTouchWidth >= 47.5, `${viewport.id}: 四签触控宽度`);
    assert.ok(metrics.smallestTouchHeight >= 47.5, `${viewport.id}: 四签触控高度`);
    if (viewport.id === 'mobile-narrow-portrait' || viewport.id === 'mobile-landscape') {
      await capture(client, artifactDir, `wide-draft-${viewport.id}`);
    }
    const picked = await evaluate(client, `(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }));
      const run = globalThis.__tianhu.run;
      return {
        draftClosed: run.draft === null,
        picked: run.charmInstances.at(-1)?.charmId,
      };
    })()`);
    assert.equal(picked.draftClosed, true, `${viewport.id}: 数字键 4 应关闭签局`);
    assert.equal(picked.picked, draftState.fourth, `${viewport.id}: 数字键 4 应选第四张`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 40));
    assert.ok(
      ['btnHu', 'btnReveal', 'btnSwap'].includes(await evaluate(client, `document.activeElement?.id ?? ''`)),
      `${viewport.id}: 选签关闭后焦点应回到主要操作`,
    );
    results.push({ id: `wide-draft-${viewport.id}`, ...metrics });
  }

  // 待缘已有内容时不能静默覆盖；竖屏和主横屏都要能取消并确认替换。
  for (const viewport of [VIEWPORTS[0], VIEWPORTS[2]]) {
    await setViewport(client, viewport);
    await client.send('Page.navigate', { url });
    await waitForPage(client);
    await startCurrentBlind(client, `omen-replacement-${viewport.id}`);
    await evaluate(client, INSTALL_AUTOPLAY);
    assert.equal(await evaluate(client, `(() => { globalThis.__playToHu(); return globalThis.__revealOne(); })()`), true);
    const replacementSetup = await evaluate(client, `(() => {
      const run = globalThis.__tianhu.run;
      const draft = run.draft;
      const index = draft.offers.length - 1;
      const offer = { ...draft.offers[index], charmId: 'wideOmen', tier: 'gold', role: 'omen' };
      const offers = draft.offers.map((item, itemIndex) => itemIndex === index ? offer : item);
      run.draft = {
        ...draft,
        offers,
        charmIds: offers.map((item) => item.charmId),
        tierSlots: offers.map((item) => item.tier),
      };
      run.pendingOmen = {
        omenId: 'luckyTier', sourceCharmId: 'luckyOmen',
        acquiredAtBlind: 'test', consumeOn: 'nextCharmDraft'
      };
      run.emit();
      const result = run.chooseDraftOffer(offer.offerId);
      return { draftId: draft.draftId, offerId: offer.offerId, offers: JSON.stringify(offers), needs: result.needsOmenReplace };
    })()`);
    assert.equal(replacementSetup.needs, true, `${viewport.id}: 待缘位已满时必须进入替换确认`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 160));
    const replacementMetrics = await evaluate(client, METRICS_EXPRESSION);
    assert.equal(replacementMetrics.draftOpen, true, `${viewport.id}: 替换确认仍属于同一个求签层`);
    assertMetrics(replacementMetrics, viewport, `omen-replacement-${viewport.id}`, {
      tileCount: replacementMetrics.tileCount,
    });
    assert.ok(replacementMetrics.smallestTouchHeight >= 47.5, `${viewport.id}: 替换按钮触控高度`);
    await capture(client, artifactDir, `omen-replacement-${viewport.id}`);
    const cancelled = await evaluate(client, `(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const run = globalThis.__tianhu.run;
      return {
        draftId: run.draft?.draftId,
        offers: JSON.stringify(run.draft?.offers),
        replacement: run.draft?.pendingOmenReplacement,
        pending: run.pendingOmen?.sourceCharmId,
      };
    })()`);
    assert.equal(cancelled.draftId, replacementSetup.draftId, `${viewport.id}: Esc 不能重抽签局`);
    assert.equal(cancelled.offers, replacementSetup.offers, `${viewport.id}: Esc 不能改变签内容或签阶`);
    assert.equal(cancelled.replacement, null, `${viewport.id}: Esc 应返回原选签`);
    assert.equal(cancelled.pending, 'luckyOmen', `${viewport.id}: 取消替换必须保留旧缘`);

    assert.equal(await evaluate(client, `globalThis.__tianhu.run.chooseDraftOffer('${replacementSetup.offerId}').needsOmenReplace`), true);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
    await click(client, '#draftActions .btn.gold');
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
    const confirmed = await evaluate(client, `(() => ({
      draftClosed: globalThis.__tianhu.run.draft === null,
      pending: globalThis.__tianhu.run.pendingOmen?.sourceCharmId,
      focus: document.activeElement?.id ?? '',
      announcement: document.querySelector('#toast')?.textContent ?? '',
    }))()`);
    assert.equal(confirmed.draftClosed, true, `${viewport.id}: 确认替换后签局应关闭`);
    assert.equal(confirmed.pending, 'wideOmen', `${viewport.id}: 确认替换后应保留新缘`);
    assert.ok(['btnHu', 'btnReveal', 'btnSwap'].includes(confirmed.focus), `${viewport.id}: 替换后焦点应回到主要操作`);
    assert.match(confirmed.announcement, /广缘签/, `${viewport.id}: 替换结果应通过 live toast 宣告`);
  }

  // 选牌状态要撑过 resize
  await setViewport(client, VIEWPORTS.at(-1));
  await client.send('Page.navigate', { url });
  await waitForPage(client);
  await startCurrentBlind(client, 'resize-state');
  await click(client, '#handZone .tile');
  await setViewport(client, VIEWPORTS[1]);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 220));
  const resized = await evaluate(client, METRICS_EXPRESSION);
  assert.equal(resized.selectedCount, 1, 'resize 后仍然保持已选牌');
  assertMetrics(resized, VIEWPORTS[1], 'resize-state');

  // 短局通关页在全部 required 视口都要能看到西圈加赛入口
  for (const viewport of VIEWPORTS) {
    await setViewport(client, viewport);
    await client.send('Page.navigate', { url });
    await waitForPage(client);
    await evaluate(client, `(() => {
      const run = globalThis.__tianhu.run;
      run.anteIndex = 1;
      run.blindKind = 'boss';
      run.activeAnteCount = 2;
      run.totalScore = 4321;
      run.completedBlinds = [];
      run.status = 'run-complete';
      run.lastEvent = { type: 'run-complete', text: '短局通关' };
      run.emit();
    })()`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 180));
    const complete = await evaluate(client, METRICS_EXPRESSION);
    assert.equal(complete.screenTitle, '短局通关', `${viewport.id}: 应显示短局通关页`);
    assert.equal(
      await evaluate(client, `Boolean([...document.querySelectorAll('#screen button')]
        .find((button) => button.textContent.includes('西圈加赛')))`),
      true,
      `${viewport.id}: 应显示西圈加赛入口`,
    );
    assertMetrics(complete, viewport, `short-complete-${viewport.id}`, { expectTiles: false });
    results.push({ id: `short-complete-${viewport.id}`, ...complete });
  }

  // 选关 → 单副结算 → 请将三选一 → 下一关 → 普通百宝阁 → 选牌种
  await setViewport(client, VIEWPORTS.at(-1));
  await client.send('Page.navigate', { url });
  await waitForPage(client);
  await startCurrentBlind(client, 'settlement-flow');
  await evaluate(client, INSTALL_AUTOPLAY);
  const handsPerBlind = await evaluate(client, 'globalThis.__tianhu.app.state.handCount');
  assert.equal(handsPerBlind, 1, '当前每关应当只打一副');
  for (let index = 0; index < handsPerBlind; index += 1) {
    const status = await evaluate(client, 'globalThis.__autoHand(0)');
    assert.ok(['hand-won', 'hand-failed'].includes(status), `第 ${index + 1} 副异常状态 ${status}`);
    await waitUntil(client, "Boolean(document.querySelector('#screen .title')?.textContent)", {
      label: `第 ${index + 1} 副结算屏`,
    });
    const settled = await evaluate(client, METRICS_EXPRESSION);
    assert.ok(settled.screenTitle, `第 ${index + 1} 副结束后应当出现结算屏`);
    if (index === 0) {
      assertMetrics(settled, VIEWPORTS.at(-1), 'hand-result', { expectTiles: false });
      await capture(client, artifactDir, 'hand-result');
    }
    await click(client, '#screen .rowBtns .btn');
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }

  const shop = await evaluate(client, METRICS_EXPRESSION);
  assert.equal(shop.screenTitle, '请将台 · 三选一', '第一家店应当进入阶段 1 请将台');
  for (const viewport of [VIEWPORTS[2], VIEWPORTS[1]]) {
    await setViewport(client, viewport);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 160));
    const metrics = await evaluate(client, METRICS_EXPRESSION);
    assertMetrics(metrics, viewport, `general-draft-${viewport.id}`, { expectTiles: false });
    await capture(client, artifactDir, `general-draft-${viewport.id}`);
    results.push({ id: `general-draft-${viewport.id}`, ...metrics });
  }

  // 请将台只能买一位；购买后回到庄局选关，再打进第二家普通百宝阁。
  await setViewport(client, VIEWPORTS.at(-1));
  const pickedGeneral = await evaluate(client, `(() => {
    const run = globalThis.__tianhu.run;
    run.gold += 50;
    const offer = run.shop.items[0];
    const result = run.buy(offer.slotIndex);
    return { ok: result.ok, picked: run.shop.generalPicked, allSold: run.shop.items.every((item) => item.sold) };
  })()`);
  assert.equal(pickedGeneral.ok, true, '请将台应当能购买一位福将');
  assert.equal(Boolean(pickedGeneral.picked), true, '请将台应记录已选福将');
  assert.equal(pickedGeneral.allSold, true, '选择一位后另外两位应一起锁定');
  await click(client, '#screen .rowBtns .btn.green.big');
  let nextBlind = await evaluate(client, METRICS_EXPRESSION);
  assert.equal(nextBlind.screenTitle, '东圈', '离开请将台后回到东圈选关');
  assert.equal(await evaluate(client, 'globalThis.__tianhu.run.blindKind'), 'big', '下一关应为庄局');

  await startCurrentBlind(client, 'support-shop-flow');
  const secondStatus = await evaluate(client, 'globalThis.__autoHand(0)');
  assert.ok(['hand-won', 'hand-failed'].includes(secondStatus), `庄局异常状态 ${secondStatus}`);
  await waitUntil(client, "Boolean(document.querySelector('#screen .title')?.textContent)", {
    label: '庄局结算屏',
  });
  await click(client, '#screen .rowBtns .btn');
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  const supportShop = await evaluate(client, METRICS_EXPRESSION);
  assert.equal(supportShop.screenTitle, '百宝阁', '第二家店应当恢复长期商品百宝阁');

  // 锻牌位要能走完「选牌种」这一步
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 160));
  const opened = await evaluate(client, `(() => {
    const run = globalThis.__tianhu.run;
    const offer = run.shop.items.find((item) => item.family === 'bone' || item.family === 'seal');
    if (!offer) return false;
    run.gold += 50;
    return run.buy(offer.slotIndex).needsKind === true;
  })()`);
  assert.equal(opened, true, '锻牌位应当进入选牌种');
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 160));
  const picker = await evaluate(client, METRICS_EXPRESSION);
  assert.equal(picker.kindButtons, 34, '选牌种要列出 34 个牌种');
  assertMetrics(picker, VIEWPORTS.at(-1), 'kind-picker', { expectTiles: false });
  await capture(client, artifactDir, 'kind-picker');
  results.push({ id: 'kind-picker', ...picker });

  // 完成改造并离店后，要回到圈主选关，不能直接发牌。
  await click(client, '#kindGrid .kindBtn');
  await click(client, '#screen .rowBtns .btn.green.big');
  nextBlind = await evaluate(client, METRICS_EXPRESSION);
  assert.equal(nextBlind.screenTitle, '东圈', '离店后应当回到东圈选关');
  assert.equal(await evaluate(client, 'globalThis.__tianhu.run.blindKind'), 'boss',
    '庄局之后应当轮到圈主');
  assertMetrics(nextBlind, VIEWPORTS.at(-1), 'next-blind-select', { expectTiles: false });

  // 独立重开后先跳闲局，再跳庄局；虽然 status 始终是 blind-select，屏幕也必须立即
  // 重绘到圈主；旧的「跳局」按钮不能留在 DOM 中继续接受点击。
  await evaluate(client, `globalThis.__tianhu.app.startRun({ seed: 20260728 })`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
  const skippedSmall = await evaluate(client, `(() => {
    const current = document.querySelector('#screen .blindCard.current');
    const skip = [...(current?.querySelectorAll('.blindActions .btn') ?? [])]
      .find((button) => button.textContent.trim() === '跳局');
    if (!skip) return false;
    skip.click();
    return true;
  })()`);
  assert.equal(skippedSmall, true, '闲局应当可以跳过');
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
  const skippedBig = await evaluate(client, `(() => {
    const current = document.querySelector('#screen .blindCard.current');
    const skip = [...(current?.querySelectorAll('.blindActions .btn') ?? [])]
      .find((button) => button.textContent.trim() === '跳局');
    if (!skip) return false;
    globalThis.__oldBigSkipButton = skip;
    skip.click();
    return true;
  })()`);
  assert.equal(skippedBig, true, '庄局选关卡应当提供跳局按钮');
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
  const afterBigSkip = await evaluate(client, `(() => {
    const current = document.querySelector('#screen .blindCard.current');
    const currentButtons = [...(current?.querySelectorAll('.blindActions .btn') ?? [])];
    const oldSkip = globalThis.__oldBigSkipButton;
    return {
      runBlindKind: globalThis.__tianhu.run.blindKind,
      screenShowsBoss: current?.classList.contains('kind-boss') ?? false,
      currentName: current?.querySelector('.cName')?.textContent?.trim() ?? null,
      currentHasSkip: currentButtons.some((button) => button.textContent.trim() === '跳局'),
      focusIsCurrentStart: document.activeElement === currentButtons
        .find((button) => button.textContent.trim() === '开打'),
      oldSkipStillClickable: Boolean(oldSkip?.isConnected && !oldSkip.disabled),
    };
  })()`);
  assert.deepEqual(afterBigSkip, {
    runBlindKind: 'boss',
    screenShowsBoss: true,
    currentName: '圈主',
    currentHasSkip: false,
    focusIsCurrentStart: true,
    oldSkipStillClickable: false,
  }, '跳过庄局后选关屏必须立即刷新到圈主，且移除旧跳局按钮');

  console.log(JSON.stringify({ ok: true, artifactDir, results }, null, 2));
} finally {
  client?.close();
  chrome.kill('SIGTERM');
  staticServer.close();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  if (process.env.KEEP_VIEWPORT_ARTIFACTS !== '1') {
    await rm(artifactDir, { recursive: true, force: true }).catch(() => {});
  }
}
