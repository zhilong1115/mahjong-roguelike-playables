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

const MIME = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
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
  const screen = document.querySelector('#screen');
  const critical = screen
    ? [...document.querySelectorAll('#screen .screenBox, #screen .rowBtns, #screen .shopCard, #screen .blindCard')]
    : [...document.querySelectorAll('#app, #side, #slotBar, #table, #handZone, #actionRow')];
  const clipped = critical.filter(visible).map(describe).filter((rect) => (
    rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1
  ));
  const primary = screen
    ? [...document.querySelectorAll('#screen .rowBtns .btn, #screen .shopCard, #screen .kindBtn, #screen .blindActions .btn')]
    : [...document.querySelectorAll('#handZone .tile, #btnAct, #btnHu, .charmPick')];
  const touchTargets = primary.filter(visible).map(describe);
  const tileRects = [...document.querySelectorAll('#handZone .tile canvas')].filter(visible).map(describe);
  const handZone = document.querySelector('#handZone');
  return {
    viewport: { width: innerWidth, height: innerHeight },
    pageScroll: document.documentElement.scrollWidth > innerWidth + 1
      || document.documentElement.scrollHeight > innerHeight + 1
      || document.body.scrollWidth > innerWidth + 1
      || document.body.scrollHeight > innerHeight + 1,
    clipped,
    smallestTouchWidth: Math.min(...touchTargets.map((rect) => rect.width)),
    smallestTouchHeight: Math.min(...touchTargets.map((rect) => rect.height)),
    tileCount: tileRects.length,
    smallestTileWidth: Math.min(...tileRects.map((rect) => rect.width)),
    handOverflow: handZone ? handZone.scrollWidth > handZone.clientWidth + 1 : false,
    handScrollWidth: handZone?.scrollWidth ?? 0,
    handClientWidth: handZone?.clientWidth ?? 0,
    slotCount: document.querySelectorAll('#slotBar .slot').length,
    buildCards: document.querySelectorAll('#buildBar .buildCard').length,
    selectedCount: document.querySelectorAll('#handZone .tile.sel').length,
    screenTitle: screen?.querySelector('.title')?.textContent ?? null,
    draftOpen: !document.querySelector('#draftLayer').hidden,
    charmCards: document.querySelectorAll('.charmPick').length,
    kindButtons: document.querySelectorAll('#kindGrid .kindBtn').length,
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

  // seed 1 能让测试玩家稳定打过东圈闲局，便于覆盖两副制结算与商店流程。
  const baseUrl = `http://127.0.0.1:${serverPort}/src/?seed=1`;
  const url = `${baseUrl}&intro=0`;
  const results = [];

  // 标题页不应为背景 Run 自动造存档；点「开始新局」后应立即订阅并落档。
  await setViewport(client, VIEWPORTS[0]);
  await client.send('Page.navigate', { url: baseUrl });
  await waitForPage(client);
  const titleMetrics = await evaluate(client, METRICS_EXPRESSION);
  assertMetrics(titleMetrics, VIEWPORTS[0], 'title-mobile-narrow', { expectTiles: false });
  assert.equal(await evaluate(client, `localStorage.getItem('tianhu.run.v3')`), null,
    '标题背景不应自动生成存档');
  await click(client, '#screen .titleMenu > .btn.big');
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 460));
  const newRunSave = await evaluate(client, `JSON.parse(localStorage.getItem('tianhu.run.v3') ?? 'null')`);
  assert.equal(newRunSave?.status, 'blind-select', '开始新局应当自动保存');
  const firstSelect = await evaluate(client, METRICS_EXPRESSION);
  assert.equal(firstSelect.screenTitle, '东圈', '新局先进入东圈选关');
  assertMetrics(firstSelect, VIEWPORTS[0], 'blind-select-mobile-narrow', { expectTiles: false });

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
    await capture(client, artifactDir, viewport.id);
    results.push({ id: viewport.id, ...metrics });
  }

  // 三签选一：最窄竖屏与主横屏都要完整可点
  for (const viewport of [VIEWPORTS[0], VIEWPORTS[2]]) {
    await setViewport(client, viewport);
    await client.send('Page.navigate', { url });
    await waitForPage(client);
    await startCurrentBlind(client, `draft-${viewport.id}`);
    await evaluate(client, INSTALL_AUTOPLAY);
    const opened = await evaluate(client, `(() => { globalThis.__playToHu(); return globalThis.__revealOne(); })()`);
    assert.equal(opened, true, `${viewport.id}: 应当能亮出一组`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
    const metrics = await evaluate(client, METRICS_EXPRESSION);
    assert.equal(metrics.draftOpen, true, `${viewport.id}: 三签选一应当展开`);
    assert.equal(metrics.charmCards, 3, `${viewport.id}: 必须有三张灵签`);
    assertMetrics(metrics, viewport, `draft-${viewport.id}`, { tileCount: metrics.tileCount });
    await capture(client, artifactDir, `draft-${viewport.id}`);
    results.push({ id: `draft-${viewport.id}`, ...metrics });
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

  // 选关 → 两副结算 → 百宝阁 → 选牌种 → 下一关选关
  await setViewport(client, VIEWPORTS.at(-1));
  await client.send('Page.navigate', { url });
  await waitForPage(client);
  await startCurrentBlind(client, 'settlement-flow');
  await evaluate(client, INSTALL_AUTOPLAY);
  const handsPerBlind = await evaluate(client, 'globalThis.__tianhu.app.state.handCount');
  assert.equal(handsPerBlind, 2, '当前每关应当打两副');
  for (let index = 0; index < handsPerBlind; index += 1) {
    const status = await evaluate(client, 'globalThis.__autoHand(0)');
    assert.ok(['hand-won', 'hand-failed'].includes(status), `第 ${index + 1} 副异常状态 ${status}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 4200));
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
  assert.equal(shop.screenTitle, '百宝阁', '两副过关后进入百宝阁');
  for (const viewport of [VIEWPORTS[2], VIEWPORTS[1]]) {
    await setViewport(client, viewport);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 160));
    const metrics = await evaluate(client, METRICS_EXPRESSION);
    assertMetrics(metrics, viewport, `shop-${viewport.id}`, { expectTiles: false });
    await capture(client, artifactDir, `shop-${viewport.id}`);
    results.push({ id: `shop-${viewport.id}`, ...metrics });
  }

  // 锻牌位要能走完「选牌种」这一步
  await setViewport(client, VIEWPORTS.at(-1));
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

  // 完成改造并离店后，要回到当前圈的下一关，不能直接发牌。
  await click(client, '#kindGrid .kindBtn');
  await click(client, '#screen .rowBtns .btn.green.big');
  const nextBlind = await evaluate(client, METRICS_EXPRESSION);
  assert.equal(nextBlind.screenTitle, '东圈', '离店后应当回到东圈选关');
  assert.equal(await evaluate(client, 'globalThis.__tianhu.run.blindKind'), 'big',
    '闲局之后应当轮到庄局');
  assertMetrics(nextBlind, VIEWPORTS.at(-1), 'next-blind-select', { expectTiles: false });

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
