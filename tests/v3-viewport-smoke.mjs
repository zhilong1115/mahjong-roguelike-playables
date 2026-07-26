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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitForPage(client) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await evaluate(client, `document.readyState === 'complete' && Boolean(document.querySelector('#app'))`);
    if (ready) {
      await evaluate(client, `document.fonts.ready.then(() => new Promise((resolve) => setTimeout(resolve, 80)))`);
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
    ? [...document.querySelectorAll('#screen .screenBox, #screen .rowBtns, #screen .shopCard')]
    : [...document.querySelectorAll('#app, #side, #slotBar, #table, #handZone, #actionRow')];
  const visibleCritical = critical.filter(visible);
  const clipped = visibleCritical.map(describe).filter((rect) => (
    rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1
  ));
  const primary = screen
    ? [...document.querySelectorAll('#screen .rowBtns .btn, #screen .shopCard')]
    : [...document.querySelectorAll('#handZone .tile, #btnAct, #btnHu, .charmCard')];
  const touchTargets = primary.filter(visible).map(describe);
  const tileRects = [...document.querySelectorAll('#handZone .tile canvas')].filter(visible).map(describe);
  const handZone = document.querySelector('#handZone');
  const slotBar = document.querySelector('#slotBar');
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
    slotCount: slotBar ? slotBar.children.length : 0,
    selectedCount: document.querySelectorAll('#handZone .tile.sel').length,
    screenOpen: Boolean(screen),
    screenTitle: screen?.querySelector('.title')?.textContent ?? null,
    draftOpen: !document.querySelector('#draftLayer').hidden,
    charmCards: document.querySelectorAll('.charmCard').length,
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
  assert.equal(metrics.handOverflow, false, `${label}: 手牌溢出`);
  assert.ok(metrics.smallestTouchWidth >= 43.5, `${label}: 触控宽度 ${metrics.smallestTouchWidth}`);
  assert.ok(metrics.smallestTouchHeight >= 43.5, `${label}: 触控高度 ${metrics.smallestTouchHeight}`);
  if (expectTiles) {
    assert.equal(metrics.tileCount, tileCount, `${label}: 手上剩下的牌必须都可见`);
    assert.ok(metrics.smallestTileWidth >= 33.5, `${label}: 牌面宽度 ${metrics.smallestTileWidth}`);
    assert.equal(metrics.slotCount, 6, `${label}: 6 个开运位必须都在`);
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
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
}

async function dismissHelp(client) {
  await click(client, '#screen .rowBtns .btn');
}

/** 用页面内的贪心策略打完一副牌，用来把界面推进到三签选一、结算和商店。 */
const AUTOPLAY_HAND = `(() => {
  const app = window.__demo;
  if (!app) return 'missing-hook';
  return app.autoPlayHand();
})()`;

const staticServer = await startStaticServer();
const serverPort = staticServer.address().port;
const debuggerPort = await getFreePort();
const profileDir = await mkdtemp(join(tmpdir(), 'mahjong-v3-chrome-'));
const artifactDir = await mkdtemp(join(tmpdir(), 'mahjong-v3-viewports-'));
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

  // 固定 seed，保证自动试玩路径可复现
  const url = `http://127.0.0.1:${serverPort}/prototype/v3-arcade-demo/?seed=20260725`;
  const results = [];

  for (const viewport of VIEWPORTS) {
    await setViewport(client, viewport);
    await client.send('Page.navigate', { url });
    await waitForPage(client);
    const help = await evaluate(client, METRICS_EXPRESSION);
    assertMetrics(help, viewport, `${viewport.id}-help`, { expectTiles: false });
    assert.equal(help.screenTitle, '天胡', `${viewport.id}: 开局先看到玩法说明`);
    await dismissHelp(client);
    const metrics = await evaluate(client, METRICS_EXPRESSION);
    assertMetrics(metrics, viewport, viewport.id);
    await capture(client, artifactDir, viewport.id);
    results.push({ id: viewport.id, ...metrics });
  }

  // 三签选一面板在最小和最矮视口都要完整可点
  for (const viewport of [VIEWPORTS[0], VIEWPORTS[2]]) {
    await setViewport(client, viewport);
    await client.send('Page.navigate', { url });
    await waitForPage(client);
    await dismissHelp(client);
    const opened = await evaluate(client, `(() => window.__demo.revealFirstLegalGroup())()`);
    assert.equal(opened, true, `${viewport.id}: 起手应当能亮出一组`);
    const metrics = await evaluate(client, METRICS_EXPRESSION);
    assert.equal(metrics.draftOpen, true, `${viewport.id}: 三签选一应当展开`);
    assert.equal(metrics.charmCards, 3, `${viewport.id}: 必须有三张灵签`);
    assertMetrics(metrics, viewport, `draft-${viewport.id}`, { tileCount: metrics.tileCount });
    assert.ok(metrics.tileCount >= 10, `${viewport.id}: 亮组后剩余手牌应当仍然可见`);
    await capture(client, artifactDir, `draft-${viewport.id}`);
    results.push({ id: `draft-${viewport.id}`, ...metrics });
  }

  // 选牌状态要能撑过 resize
  await setViewport(client, VIEWPORTS.at(-1));
  await client.send('Page.navigate', { url });
  await waitForPage(client);
  await dismissHelp(client);
  await click(client, '#handZone .tile');
  await setViewport(client, VIEWPORTS[1]);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  const resized = await evaluate(client, METRICS_EXPRESSION);
  assert.equal(resized.selectedCount, 1, 'resize 后仍然保持已选牌');
  assertMetrics(resized, VIEWPORTS[1], 'resize-state');

  // 结算屏与百宝阁
  await setViewport(client, VIEWPORTS.at(-1));
  await client.send('Page.navigate', { url });
  await waitForPage(client);
  await dismissHelp(client);
  for (let index = 0; index < 3; index += 1) {
    const played = await evaluate(client, AUTOPLAY_HAND);
    assert.equal(played, 'hand-won', `第 ${index + 1} 副应当能自动打到胡牌，实际 ${played}`);
    const result = await evaluate(client, METRICS_EXPRESSION);
    assert.equal(result.screenOpen, true, '胡牌后应当出现结算屏');
    if (index === 0) {
      assertMetrics(result, VIEWPORTS.at(-1), 'hand-result', { expectTiles: false });
      await capture(client, artifactDir, 'hand-result');
    }
    await click(client, '#screen .rowBtns .btn');
  }
  const shop = await evaluate(client, METRICS_EXPRESSION);
  assert.equal(shop.screenTitle, '百宝阁', '三副过关后进入百宝阁');
  for (const viewport of [VIEWPORTS[2], VIEWPORTS[1]]) {
    await setViewport(client, viewport);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
    const metrics = await evaluate(client, METRICS_EXPRESSION);
    assertMetrics(metrics, viewport, `shop-${viewport.id}`, { expectTiles: false });
    await capture(client, artifactDir, `shop-${viewport.id}`);
    results.push({ id: `shop-${viewport.id}`, ...metrics });
  }

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
