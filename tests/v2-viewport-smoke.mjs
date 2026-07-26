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
  const openShop = document.querySelector('#shop-dialog[open]');
  const critical = openShop
    ? [...document.querySelectorAll('#shop-dialog .dialog-shell, #shop-dialog .shop-grid, #shop-dialog .shop-footer, #shop-dialog .shop-card')]
    : [...document.querySelectorAll('#app, .fortune-shelf, .table-frame, .hand-zone, .action-console, .hud-cabinet')];
  const visibleCritical = critical.filter(visible);
  const clipped = visibleCritical.map(describe).filter((rect) => (
    rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1
  ));
  const touchTargets = [...document.querySelectorAll('.tile-button, .arcade-button, .shop-card')]
    .filter(visible)
    .map(describe);
  const smallestTouchWidth = Math.min(...touchTargets.map((rect) => rect.width));
  const smallestTouchHeight = Math.min(...touchTargets.map((rect) => rect.height));
  const tileRects = [...document.querySelectorAll('.hand-zone .tile-button canvas')].filter(visible).map(describe);
  const handZone = document.querySelector('.hand-zone');
  return {
    viewport: { width: innerWidth, height: innerHeight },
    pageScroll: document.documentElement.scrollWidth > innerWidth + 1
      || document.documentElement.scrollHeight > innerHeight + 1
      || document.body.scrollWidth > innerWidth + 1
      || document.body.scrollHeight > innerHeight + 1,
    documentSize: {
      width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    },
    clipped,
    smallestTouchWidth,
    smallestTouchHeight,
    tileCount: tileRects.length,
    smallestTileWidth: Math.min(...tileRects.map((rect) => rect.width)),
    handOverflow: handZone.scrollWidth > handZone.clientWidth + 1 || handZone.scrollHeight > handZone.clientHeight + 1,
    selectedCount: document.querySelectorAll('.tile-button.is-selected').length,
    shopOpen: Boolean(openShop),
  };
})()`;

async function capture(client, artifactDir, name) {
  const shot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(join(artifactDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
}

function assertMetrics(metrics, viewport, label) {
  assert.deepEqual(metrics.viewport, { width: viewport.width, height: viewport.height }, `${label}: viewport`);
  assert.equal(metrics.pageScroll, false, `${label}: accidental page scroll`);
  assert.deepEqual(metrics.clipped, [], `${label}: clipped critical UI`);
  assert.equal(metrics.handOverflow, false, `${label}: hand overflow`);
  assert.ok(metrics.smallestTouchWidth >= 47.5, `${label}: touch width ${metrics.smallestTouchWidth}`);
  assert.ok(metrics.smallestTouchHeight >= 47.5, `${label}: touch height ${metrics.smallestTouchHeight}`);
  if (!metrics.shopOpen) {
    assert.equal(metrics.tileCount, 14, `${label}: fourteen visible tiles`);
    assert.ok(metrics.smallestTileWidth >= 45.5, `${label}: tile width ${metrics.smallestTileWidth}`);
  }
}

async function click(client, selector) {
  const clicked = await evaluate(client, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.click();
    return true;
  })()`);
  assert.equal(clicked, true, `missing clickable ${selector}`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
}

async function reachShop(client) {
  for (const discard of ['9s', 'N', '9s']) {
    await click(client, `[data-tile-code="${discard}"]`);
    await click(client, '#action-button');
    await click(client, '#hu-button');
    await click(client, '#next-hand-button');
  }
  assert.equal(await evaluate(client, `document.querySelector('#shop-dialog')?.open`), true, 'shop opens after three hands');
}

const staticServer = await startStaticServer();
const serverPort = staticServer.address().port;
const debuggerPort = await getFreePort();
const profileDir = await mkdtemp(join(tmpdir(), 'mahjong-v2-chrome-'));
const artifactDir = await mkdtemp(join(tmpdir(), 'mahjong-v2-viewports-'));
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

  const url = `http://127.0.0.1:${serverPort}/prototype/v2-run-shop-demo/`;
  const results = [];
  for (const viewport of VIEWPORTS) {
    await setViewport(client, viewport);
    await client.send('Page.navigate', { url });
    await waitForPage(client);
    const metrics = await evaluate(client, METRICS_EXPRESSION);
    assertMetrics(metrics, viewport, viewport.id);
    await capture(client, artifactDir, viewport.id);
    results.push({ id: viewport.id, ...metrics });
  }

  await setViewport(client, VIEWPORTS.at(-1));
  await client.send('Page.navigate', { url });
  await waitForPage(client);
  await click(client, '[data-tile-code="9s"]');
  await setViewport(client, VIEWPORTS[1]);
  const resized = await evaluate(client, METRICS_EXPRESSION);
  assert.equal(resized.selectedCount, 1, 'selected tile survives resize');
  assertMetrics(resized, VIEWPORTS[1], 'resize-state');

  await setViewport(client, VIEWPORTS.at(-1));
  await client.send('Page.navigate', { url });
  await waitForPage(client);
  await reachShop(client);
  for (const viewport of [VIEWPORTS[2], VIEWPORTS[1]]) {
    await setViewport(client, viewport);
    const metrics = await evaluate(client, METRICS_EXPRESSION);
    assertMetrics(metrics, viewport, `shop-${viewport.id}`);
    await capture(client, artifactDir, `shop-${viewport.id}`);
    results.push({ id: `shop-${viewport.id}`, ...metrics });
  }

  console.log(JSON.stringify({ ok: true, artifactDir, results }, null, 2));
} finally {
  client?.close();
  chrome.kill('SIGTERM');
  staticServer.close();
  await rm(profileDir, { recursive: true, force: true });
  if (process.env.KEEP_VIEWPORT_ARTIFACTS !== '1') {
    await rm(artifactDir, { recursive: true, force: true });
  }
}
