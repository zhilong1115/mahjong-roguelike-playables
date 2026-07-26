const TILE_WIDTH = 34;
const TILE_HEIGHT = 46;
const tileCache = new Map();

const HONOR_GLYPHS = Object.freeze({
  1: '东',
  2: '南',
  3: '西',
  4: '北',
  5: '中',
  6: '发',
  7: '',
});

function pixel(context, x, y, width, height, color) {
  context.fillStyle = color;
  context.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
}

function hardenAlpha(context, width, height, threshold = 110) {
  const image = context.getImageData(0, 0, width, height);
  for (let index = 3; index < image.data.length; index += 4) {
    image.data[index] = image.data[index] < threshold ? 0 : 255;
  }
  context.putImageData(image, 0, 0);
}

function pixelGlyph(context, text, x, y, size, color) {
  const padding = 4;
  const width = Math.ceil(size * 1.9) + padding * 2;
  const height = Math.ceil(size * 1.8) + padding * 2;
  const glyph = document.createElement('canvas');
  glyph.width = width;
  glyph.height = height;
  const glyphContext = glyph.getContext('2d');
  glyphContext.font = `900 ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  glyphContext.textAlign = 'center';
  glyphContext.textBaseline = 'middle';
  glyphContext.fillStyle = '#000';
  glyphContext.fillText(text, width / 2, height / 2);
  hardenAlpha(glyphContext, width, height);
  glyphContext.globalCompositeOperation = 'source-in';
  glyphContext.fillStyle = color;
  glyphContext.fillRect(0, 0, width, height);
  context.drawImage(glyph, Math.round(x - width / 2), Math.round(y - height / 2));
}

function drawTileBody(context) {
  pixel(context, 0, 0, TILE_WIDTH, TILE_HEIGHT, '#211a13');
  pixel(context, 1, 1, TILE_WIDTH - 2, TILE_HEIGHT - 2, '#887c65');
  pixel(context, 1, 1, TILE_WIDTH - 2, TILE_HEIGHT - 3, '#f6f1e2');
  pixel(context, 2, 2, TILE_WIDTH - 4, 1, '#fffdf4');
  pixel(context, 2, 2, 1, TILE_HEIGHT - 6, '#fffdf4');
  pixel(context, TILE_WIDTH - 3, 3, 1, TILE_HEIGHT - 7, '#c9c0aa');
  pixel(context, 2, TILE_HEIGHT - 4, TILE_WIDTH - 4, 1, '#b2a78f');
  pixel(context, 2, TILE_HEIGHT - 3, TILE_WIDTH - 4, 1, '#6d6252');
}

function drawDot(context, centerX, centerY, radius, dark, light) {
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      const distance = Math.sqrt(x * x + y * y);
      if (distance <= radius + 0.15) {
        pixel(context, centerX + x, centerY + y, 1, 1, distance > radius - 1 ? dark : light);
      }
    }
  }
}

function drawDots(context, rank) {
  const blue = ['#173f80', '#3e7ac4'];
  const green = ['#176342', '#43a777'];
  const red = ['#932d28', '#d85449'];
  const centerX = TILE_WIDTH / 2;
  const centerY = (TILE_HEIGHT - 2) / 2;
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
  points[rank].forEach(([x, y, radius, palette]) => {
    drawDot(context, centerX + x, centerY + y, radius, palette[0], palette[1]);
  });
}

function drawBambooStick(context, x, y, color, dark) {
  pixel(context, x - 2, y - 5, 5, 11, color);
  pixel(context, x - 2, y - 5, 1, 11, dark);
  pixel(context, x - 2, y, 5, 1, dark);
  pixel(context, x - 2, y - 5, 5, 1, dark);
  pixel(context, x - 2, y + 5, 5, 1, dark);
}

function drawBambooBird(context) {
  const green = '#247653';
  const dark = '#164f3a';
  const red = '#b63b31';
  pixel(context, 15, 10, 5, 5, green);
  pixel(context, 12, 14, 11, 12, green);
  pixel(context, 9, 18, 6, 9, dark);
  pixel(context, 20, 17, 6, 5, green);
  pixel(context, 23, 19, 4, 2, dark);
  pixel(context, 18, 11, 2, 2, '#f6f1e2');
  pixel(context, 19, 12, 1, 1, dark);
  pixel(context, 10, 26, 4, 8, dark);
  pixel(context, 14, 25, 4, 11, green);
  pixel(context, 18, 25, 4, 8, dark);
  pixel(context, 12, 35, 4, 2, red);
  pixel(context, 19, 34, 4, 2, red);
}

function drawBamboo(context, rank) {
  if (rank === 1) {
    drawBambooBird(context);
    return;
  }
  const centerX = TILE_WIDTH / 2;
  const centerY = (TILE_HEIGHT - 2) / 2;
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
    const isRed = rank === 5 && index === 2;
    drawBambooStick(context, centerX + x, centerY + y, isRed ? '#a7352e' : '#287c55', isRed ? '#70221d' : '#16563a');
  });
}

function normalizeSuit(suit) {
  if (['m', 'man', 'characters'].includes(suit)) return 'man';
  if (['p', 'pin', 'dots'].includes(suit)) return 'pin';
  if (['s', 'sou', 'bamboo'].includes(suit)) return 'sou';
  return 'honor';
}

function renderTileSource(tile) {
  const suit = normalizeSuit(tile.suit);
  const key = `${suit}:${tile.rank}`;
  if (tileCache.has(key)) return tileCache.get(key);

  const canvas = document.createElement('canvas');
  canvas.width = TILE_WIDTH;
  canvas.height = TILE_HEIGHT;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  drawTileBody(context);

  if (suit === 'man') {
    pixelGlyph(context, '一二三四五六七八九'[tile.rank - 1], TILE_WIDTH / 2, 13, 13, '#18263d');
    pixelGlyph(context, '萬', TILE_WIDTH / 2, 31, 14, '#a5332c');
  } else if (suit === 'honor') {
    if (tile.rank === 7) {
      pixel(context, 7, 9, TILE_WIDTH - 14, 1, '#234a83');
      pixel(context, 7, TILE_HEIGHT - 13, TILE_WIDTH - 14, 1, '#234a83');
      pixel(context, 7, 9, 1, TILE_HEIGHT - 22, '#234a83');
      pixel(context, TILE_WIDTH - 8, 9, 1, TILE_HEIGHT - 22, '#234a83');
    } else {
      const color = tile.rank === 5 ? '#b53c33' : tile.rank === 6 ? '#26784f' : '#18263d';
      pixelGlyph(context, HONOR_GLYPHS[tile.rank] || '?', TILE_WIDTH / 2, TILE_HEIGHT / 2 - 1, 22, color);
    }
  } else if (suit === 'pin') {
    drawDots(context, tile.rank);
  } else {
    drawBamboo(context, tile.rank);
  }

  tileCache.set(key, canvas);
  return canvas;
}

export function createTileCanvas(tile, className = '') {
  const source = renderTileSource(tile);
  const canvas = document.createElement('canvas');
  canvas.width = TILE_WIDTH * 3;
  canvas.height = TILE_HEIGHT * 3;
  canvas.className = className;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function createFortuneCanvas(glyph, colors = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 72;
  canvas.height = 88;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  const paper = colors.paper || '#e4cc91';
  const ink = colors.ink || '#7e2d27';
  const edge = colors.edge || '#3a2114';
  pixel(context, 0, 0, 72, 88, edge);
  pixel(context, 4, 4, 64, 80, paper);
  pixel(context, 7, 7, 58, 3, ink);
  pixel(context, 7, 78, 58, 3, ink);
  pixel(context, 7, 10, 3, 68, ink);
  pixel(context, 62, 10, 3, 68, ink);
  pixelGlyph(context, glyph, 36, 44, 34, ink);
  return canvas;
}

export function clearPixelArtCache() {
  tileCache.clear();
}
