/**
 * 开发用静态服务器：零依赖，唯一职责是**永不缓存**。
 *
 * `python3 -m http.server` 不发 Cache-Control，浏览器会按启发式缓存 ES module，
 * 改完代码刷新还是旧的，很容易把「代码没生效」误判成「改错了」。
 *
 * 用法：
 *   node tools/dev-server.mjs            # 默认 http://127.0.0.1:4173
 *   node tools/dev-server.mjs 5000       # 换端口
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4173);
const HOST = '127.0.0.1';

const MIME = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
});

const server = createServer(async (request, response) => {
  const sendError = (code, message) => {
    response.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(message);
  };

  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://${HOST}`).pathname);
    let filePath = resolve(ROOT, normalize(pathname).replace(/^[/\\]+/, ''));
    // 不许跳出项目目录
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}/`)) return sendError(403, 'Forbidden');
    if ((await stat(filePath)).isDirectory()) filePath = join(filePath, 'index.html');

    response.writeHead(200, {
      'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
      // 关键：开发期一律不缓存，改完刷新就是新的
      'cache-control': 'no-store, must-revalidate',
      pragma: 'no-cache',
      expires: '0',
    });
    createReadStream(filePath).pipe(response);
  } catch {
    sendError(404, 'Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`天胡 dev server → http://${HOST}:${PORT}/src/`);
  console.log('已关闭缓存：改完文件直接刷新即可，不需要重启服务器。');
});
