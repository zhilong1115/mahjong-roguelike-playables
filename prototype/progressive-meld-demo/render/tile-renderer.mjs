import { HONORS } from '../core/tiles.mjs';

const WIDTH = 34;
const HEIGHT = 46;
const cache = new Map();

function pixel(ctx, x, y, width, height, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
}

function crispify(ctx, width, height, threshold = 110) {
  const image = ctx.getImageData(0, 0, width, height);
  for (let index = 3; index < image.data.length; index += 4) {
    image.data[index] = image.data[index] < threshold ? 0 : 255;
  }
  ctx.putImageData(image, 0, 0);
}

function pixelGlyph(ctx, text, x, y, size, color) {
  const padding = 4;
  const width = Math.ceil(size * 1.8) + padding * 2;
  const height = Math.ceil(size * 1.7) + padding * 2;
  const glyph = document.createElement('canvas');
  glyph.width = width;
  glyph.height = height;
  const glyphContext = glyph.getContext('2d');
  glyphContext.font = `900 ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  glyphContext.textAlign = 'center';
  glyphContext.textBaseline = 'middle';
  glyphContext.fillStyle = '#000';
  glyphContext.fillText(text, width / 2, height / 2);
  crispify(glyphContext, width, height);
  glyphContext.globalCompositeOperation = 'source-in';
  glyphContext.fillStyle = color;
  glyphContext.fillRect(0, 0, width, height);
  ctx.drawImage(glyph, Math.round(x - width / 2), Math.round(y - height / 2));
}

function drawBody(ctx) {
  pixel(ctx, 0, 0, WIDTH, HEIGHT, '#211a13');
  pixel(ctx, 1, 1, WIDTH - 2, HEIGHT - 2, '#887c65');
  pixel(ctx, 1, 1, WIDTH - 2, HEIGHT - 3, '#f5eedc');
  pixel(ctx, 2, 2, WIDTH - 4, 1, '#fffdf3');
  pixel(ctx, 2, 2, 1, HEIGHT - 6, '#fffdf3');
  pixel(ctx, WIDTH - 3, 3, 1, HEIGHT - 7, '#c4b99f');
  pixel(ctx, 2, HEIGHT - 4, WIDTH - 4, 1, '#b1a58c');
  pixel(ctx, 2, HEIGHT - 3, WIDTH - 4, 1, '#665b4b');
}

function dot(ctx, centerX, centerY, radius, outer, inner) {
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      const distance = Math.sqrt(x * x + y * y);
      if (distance <= radius + 0.15) {
        pixel(ctx, centerX + x, centerY + y, 1, 1, distance > radius - 1 ? outer : inner);
      }
    }
  }
}

function drawDots(ctx, rank) {
  const blue = ['#173f80', '#3e7ac4'];
  const green = ['#176342', '#43a777'];
  const red = ['#932d28', '#d85449'];
  const centerX = WIDTH / 2;
  const centerY = (HEIGHT - 2) / 2;
  const points = {
    1: [[0, 0, 7, red]],
    2: [[0, -8, 4, blue], [0, 8, 4, green]],
    3: [[-7, -9, 3, blue], [0, 0, 3, red], [7, 9, 3, green]],
    4: [[-7, -8, 3, blue], [7, -8, 3, green], [-7, 8, 3, green], [7, 8, 3, blue]],
    5: [[-7, -9, 3, blue], [7, -9, 3, green], [0, 0, 3, red], [-7, 9, 3, green], [7, 9, 3, blue]],
    6: [[-7, -10, 3, green], [7, -10, 3, red], [-7, 0, 3, green], [7, 0, 3, red], [-7, 10, 3, green], [7, 10, 3, red]],
    7: [[-8, -12, 2, green], [0, -12, 2, green], [8, -12, 2, green], [-6, 0, 3, red], [6, 0, 3, red], [-6, 10, 3, red], [6, 10, 3, red]],
    8: [[-7, -13, 2, blue], [7, -13, 2, blue], [-7, -4, 2, blue], [7, -4, 2, blue], [-7, 5, 2, blue], [7, 5, 2, blue], [-7, 14, 2, blue], [7, 14, 2, blue]],
    9: [[-9, -12, 2, blue], [0, -12, 2, blue], [9, -12, 2, blue], [-9, 0, 2, green], [0, 0, 2, green], [9, 0, 2, green], [-9, 12, 2, red], [0, 12, 2, red], [9, 12, 2, red]],
  };
  for (const [x, y, radius, palette] of points[rank]) {
    dot(ctx, centerX + x, centerY + y, radius, palette[0], palette[1]);
  }
}

function bamboo(ctx, x, y, color, dark) {
  pixel(ctx, x - 2, y - 5, 5, 11, color);
  pixel(ctx, x - 2, y - 5, 1, 11, dark);
  pixel(ctx, x - 2, y, 5, 1, dark);
  pixel(ctx, x - 2, y - 5, 5, 1, dark);
  pixel(ctx, x - 2, y + 5, 5, 1, dark);
}

function drawBamboo(ctx, rank) {
  if (rank === 1) {
    pixelGlyph(ctx, '雀', WIDTH / 2, HEIGHT / 2 - 1, 19, '#247653');
    pixel(ctx, 20, 12, 3, 3, '#c64739');
    return;
  }
  const centerX = WIDTH / 2;
  const centerY = (HEIGHT - 2) / 2;
  const layouts = {
    2: [[0, -7], [0, 7]],
    3: [[0, -10], [-7, 5], [7, 5]],
    4: [[-7, -7], [7, -7], [-7, 7], [7, 7]],
    5: [[-8, -8], [8, -8], [0, 0], [-8, 8], [8, 8]],
    6: [[-8, -8], [0, -8], [8, -8], [-8, 8], [0, 8], [8, 8]],
    7: [[0, -13], [-8, -2], [0, -2], [8, -2], [-8, 10], [0, 10], [8, 10]],
    8: [[-5, -13], [5, -13], [-8, -1], [0, -1], [8, -1], [-8, 11], [0, 11], [8, 11]],
    9: [[-8, -13], [0, -13], [8, -13], [-8, 0], [0, 0], [8, 0], [-8, 13], [0, 13], [8, 13]],
  };
  layouts[rank].forEach(([x, y], index) => {
    const red = rank === 5 && index === 2;
    bamboo(ctx, centerX + x, centerY + y, red ? '#a7352e' : '#287c55', red ? '#70221d' : '#16563a');
  });
}

function renderSource(tile) {
  const key = `${tile.suit}:${tile.rank}`;
  if (cache.has(key)) return cache.get(key);

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  drawBody(ctx);

  if (tile.suit === 'man') {
    pixelGlyph(ctx, '一二三四五六七八九'[tile.rank - 1], WIDTH / 2, 13, 13, '#18263d');
    pixelGlyph(ctx, '萬', WIDTH / 2, 31, 14, '#a5332c');
  } else if (tile.suit === 'honor') {
    if (tile.rank === 7) {
      pixel(ctx, 7, 9, WIDTH - 14, 1, '#234a83');
      pixel(ctx, 7, HEIGHT - 13, WIDTH - 14, 1, '#234a83');
      pixel(ctx, 7, 9, 1, HEIGHT - 22, '#234a83');
      pixel(ctx, WIDTH - 8, 9, 1, HEIGHT - 22, '#234a83');
    } else {
      const color = tile.rank === 5 ? '#b53c33' : tile.rank === 6 ? '#26784f' : '#18263d';
      pixelGlyph(ctx, HONORS[tile.rank].glyph, WIDTH / 2, HEIGHT / 2 - 1, 22, color);
    }
  } else if (tile.suit === 'pin') {
    drawDots(ctx, tile.rank);
  } else {
    drawBamboo(ctx, tile.rank);
  }

  cache.set(key, canvas);
  return canvas;
}

export function createTileCanvas(tile, className = '') {
  const source = renderSource(tile);
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * 3;
  canvas.height = HEIGHT * 3;
  canvas.className = className;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function clearTileRenderCache() {
  cache.clear();
}
