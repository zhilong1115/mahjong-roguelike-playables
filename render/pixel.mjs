/**
 * 像素渲染：低分辨率 canvas + alpha 硬化，放大后仍然锐利。
 * 全部离线自绘，不引用外部字体或图片，满足 Playables 的自包含要求。
 */

const TILE_W = 34;
const TILE_H = 46;
const FONT_STACK = '"PingFang SC","Hiragino Sans GB","Heiti SC","Microsoft YaHei","Noto Sans SC",sans-serif';
const cache = new Map();

const HONOR_GLYPHS = Object.freeze({ 1: '東', 2: '南', 3: '西', 4: '北', 5: '中', 6: '發', 7: '' });

function px(context, x, y, width, height, color) {
  context.fillStyle = color;
  context.fillRect(x | 0, y | 0, width | 0, height | 0);
}

/** 把抗锯齿边缘硬化成 1-bit，得到真正的像素轮廓。 */
function harden(context, width, height, threshold = 120) {
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] === 0) continue;
    data[index] = data[index] < threshold ? 0 : 255;
  }
  context.putImageData(image, 0, 0);
}

function glyph(context, text, x, y, size, color) {
  const pad = 4;
  const width = Math.ceil(size * (String(text).length + 1)) + pad * 2;
  const height = Math.ceil(size * 1.6) + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const glyphContext = canvas.getContext('2d');
  glyphContext.font = `900 ${size}px ${FONT_STACK}`;
  glyphContext.textAlign = 'center';
  glyphContext.textBaseline = 'middle';
  glyphContext.fillStyle = '#000';
  glyphContext.fillText(text, width / 2, height / 2);
  harden(glyphContext, width, height, 120);
  glyphContext.globalCompositeOperation = 'source-in';
  glyphContext.fillStyle = color;
  glyphContext.fillRect(0, 0, width, height);
  context.drawImage(canvas, Math.round(x - width / 2), Math.round(y - height / 2));
}

function dot(context, cx, cy, radius, outer, inner) {
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      const distance = Math.sqrt(x * x + y * y);
      if (distance <= radius + 0.2) {
        px(context, cx + x, cy + y, 1, 1, distance > radius - 1.1 ? outer : inner);
      }
    }
  }
}

function bambooStick(context, x, y, color, dark) {
  px(context, x - 2, y - 5, 5, 11, color);
  px(context, x - 2, y - 5, 1, 11, dark);
  px(context, x - 2, y, 5, 1, dark);
  px(context, x - 2, y - 5, 5, 1, dark);
  px(context, x - 2, y + 5, 5, 1, dark);
}

const BIRD = [
  '........RRR.........', '.......RRRRR........', '......GGGGGGG.......',
  '.....GGGGGGGGG......', '....GGKKGGGGGGG.....', '..YYGGKKGGGGGGGG....',
  '..YYYGGGGGGGGGGG....', '....GGGGGGGGGGGGD...', '.....GGGGGGGGGGDDD..',
  '....GGGGGGGGGGGDDDD.', '...GGGGDDDDGGGGDDDD.', '...GGGGDDDDDGGGGDDD.',
  '..GGGGGDDDDDGGGGGDD.', '..GGGGGGDDDDGGGGGDD.', '..GGGGGGGDDGGGGGGDD.',
  '...GGGGGGGGGGGGGDDD.', '...GGGGGGGGGGGGDDDD.', '....GGGGGGGGGGDDDD..',
  '.....GGGGGGGGDDDD...', '......GGGGGGDDD.....', '.......GGGGDD.......',
  '........GGD.........', '.......YY...........', '......YY............',
];

function bird(context, cx, cy) {
  const palette = { G: '#1e8a55', D: '#0d5c37', R: '#c0392b', Y: '#e0a02e', K: '#101318' };
  const width = BIRD[0].length;
  const height = BIRD.length;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const code = BIRD[y][x];
      if (code && code !== '.') {
        px(context, cx - (width >> 1) + x, cy - (height >> 1) + y, 1, 1, palette[code]);
      }
    }
  }
}

function tileBody(context, dim) {
  const face = dim ? '#b9b2a4' : '#f6f1e2';
  const high = dim ? '#cdc6b6' : '#fffdf4';
  const low = dim ? '#8e887c' : '#c9c0aa';
  const edge = dim ? '#5a564d' : '#8a7f66';
  px(context, 0, 0, TILE_W, TILE_H, '#2a2118');
  px(context, 1, 1, TILE_W - 2, TILE_H - 2, edge);
  px(context, 1, 1, TILE_W - 2, TILE_H - 3, face);
  px(context, 1, 1, TILE_W - 2, 1, high);
  px(context, 1, 1, 1, TILE_H - 3, high);
  px(context, TILE_W - 2, 2, 1, TILE_H - 4, low);
  px(context, 1, TILE_H - 3, TILE_W - 2, 1, low);
  px(context, 1, TILE_H - 2, TILE_W - 2, 1, '#6d6252');
}

function drawDots(context, rank) {
  const B = '#1b4f9c';
  const BI = '#3a7fd4';
  const R = '#b02a2a';
  const RI = '#dd5a52';
  const G = '#1a7f4b';
  const GI = '#3fae74';
  const cx = (TILE_W / 2) | 0;
  const cy = ((TILE_H - 2) / 2) | 0;
  const put = (x, y, r, o, i) => dot(context, x, y, r, o, i);
  const layouts = {
    1: () => {
      dot(context, cx, cy, 9, R, '#f0f0f0');
      dot(context, cx, cy, 6, B, '#f6f1e2');
      dot(context, cx, cy, 3, R, RI);
    },
    2: () => { put(cx, cy - 8, 4, B, BI); put(cx, cy + 8, 4, G, GI); },
    3: () => { put(cx - 8, cy - 9, 3, B, BI); put(cx, cy, 3, R, RI); put(cx + 8, cy + 9, 3, G, GI); },
    4: () => {
      put(cx - 7, cy - 8, 3, B, BI); put(cx + 7, cy - 8, 3, G, GI);
      put(cx - 7, cy + 8, 3, G, GI); put(cx + 7, cy + 8, 3, B, BI);
    },
    5: () => {
      put(cx - 7, cy - 9, 3, B, BI); put(cx + 7, cy - 9, 3, G, GI); put(cx, cy, 3, R, RI);
      put(cx - 7, cy + 9, 3, G, GI); put(cx + 7, cy + 9, 3, B, BI);
    },
    6: () => {
      for (let i = 0; i < 3; i += 1) {
        put(cx - 7, cy - 10 + i * 10, 3, G, GI);
        put(cx + 7, cy - 10 + i * 10, 3, R, RI);
      }
    },
    7: () => {
      put(cx - 8, cy - 12, 2.6, G, GI); put(cx, cy - 12, 2.6, G, GI); put(cx + 8, cy - 12, 2.6, G, GI);
      for (let i = 0; i < 2; i += 1) {
        for (let j = 0; j < 2; j += 1) put(cx - 6 + j * 12, cy - 1 + i * 10, 2.8, R, RI);
      }
    },
    8: () => {
      for (let i = 0; i < 4; i += 1) {
        put(cx - 7, cy - 13 + i * 9, 2.6, B, BI);
        put(cx + 7, cy - 13 + i * 9, 2.6, B, BI);
      }
    },
    9: () => {
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) {
          const color = i === 0 ? [B, BI] : (i === 1 ? [G, GI] : [R, RI]);
          put(cx - 9 + j * 9, cy - 12 + i * 12, 2.8, color[0], color[1]);
        }
      }
    },
  };
  (layouts[rank] || layouts[1])();
}

function drawBamboo(context, rank) {
  const G = '#1e8a55';
  const D = '#0e5c37';
  const R = '#b02a2a';
  const DR = '#7d1f1c';
  const cx = (TILE_W / 2) | 0;
  const cy = ((TILE_H - 2) / 2) | 0;
  if (rank === 1) {
    bird(context, cx, cy);
    return;
  }
  const layouts = {
    2: [[cx, cy - 7], [cx, cy + 7]],
    3: [[cx, cy - 10], [cx - 7, cy + 4], [cx + 7, cy + 4]],
    4: [[cx - 7, cy - 7], [cx + 7, cy - 7], [cx - 7, cy + 7], [cx + 7, cy + 7]],
    5: [[cx - 8, cy - 8], [cx + 8, cy - 8], [cx, cy], [cx - 8, cy + 8], [cx + 8, cy + 8]],
    6: [[cx - 8, cy - 8], [cx, cy - 8], [cx + 8, cy - 8], [cx - 8, cy + 8], [cx, cy + 8], [cx + 8, cy + 8]],
    7: [[cx, cy - 13], [cx - 8, cy - 2], [cx, cy - 2], [cx + 8, cy - 2], [cx - 8, cy + 10], [cx, cy + 10], [cx + 8, cy + 10]],
    8: [[cx - 5, cy - 13], [cx + 5, cy - 13], [cx - 8, cy - 1], [cx, cy - 1], [cx + 8, cy - 1], [cx - 8, cy + 11], [cx, cy + 11], [cx + 8, cy + 11]],
    9: [[cx - 8, cy - 13], [cx, cy - 13], [cx + 8, cy - 13], [cx - 8, cy], [cx, cy], [cx + 8, cy], [cx - 8, cy + 13], [cx, cy + 13], [cx + 8, cy + 13]],
  };
  (layouts[rank] || layouts[2]).forEach(([x, y], index) => {
    const isRed = (rank === 5 && index === 2) || (rank === 7 && index === 0)
      || (rank === 9 && index >= 3 && index <= 5);
    bambooStick(context, x, y, isRed ? R : G, isRed ? DR : D);
  });
}

function tileSource(tile, dim = false) {
  const key = `tile|${tile.suit}|${tile.rank}|${dim ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = TILE_W;
  canvas.height = TILE_H;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  tileBody(context, dim);

  const cx = (TILE_W / 2) | 0;
  const cy = ((TILE_H - 2) / 2) | 0;
  if (tile.suit === 'man') {
    glyph(context, '一二三四五六七八九'[tile.rank - 1], cx, 13, 13, dim ? '#4b5566' : '#16233a');
    glyph(context, '萬', cx, 31, 14, dim ? '#8d5d5d' : '#b02a2a');
  } else if (tile.suit === 'honor') {
    if (tile.rank === 7) {
      const color = dim ? '#5a6b86' : '#1b3f7a';
      px(context, 7, 9, TILE_W - 14, 1, color);
      px(context, 7, TILE_H - 13, TILE_W - 14, 1, color);
      px(context, 7, 9, 1, TILE_H - 22, color);
      px(context, TILE_W - 8, 9, 1, TILE_H - 22, color);
    } else {
      const color = tile.rank === 5 ? '#c0322b' : (tile.rank === 6 ? '#1a7f4b' : '#16233a');
      glyph(context, HONOR_GLYPHS[tile.rank], cx, cy, 22, color);
    }
  } else if (tile.suit === 'pin') {
    drawDots(context, tile.rank);
  } else {
    drawBamboo(context, tile.rank);
  }

  cache.set(key, canvas);
  return canvas;
}

function scaled(source, scale, className = 'pxc') {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  canvas.className = className;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/* ---------------- 牌背 ---------------- */

const BACK_PALETTE = Object.freeze({
  plain: { base: '#1d3f6e', face: '#2f5f9e', inner: '#25508a', mark: '#3b76bd', foot: '#132b4d' },
  jade: { base: '#14402f', face: '#22664a', inner: '#1b5540', mark: '#3f9c72', foot: '#0d2b20' },
  vermilion: { base: '#5c1a16', face: '#8e2f26', inner: '#75261f', mark: '#c05244', foot: '#3d100d' },
  ink: { base: '#161821', face: '#2a2e3d', inner: '#212533', mark: '#4d5470', foot: '#0d0f15' },
});

function backSource(back = 'plain') {
  const key = `back|${back}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const tone = BACK_PALETTE[back] ?? BACK_PALETTE.plain;
  const canvas = document.createElement('canvas');
  canvas.width = TILE_W;
  canvas.height = TILE_H;
  const context = canvas.getContext('2d');
  px(context, 0, 0, TILE_W, TILE_H, tone.base);
  px(context, 1, 1, TILE_W - 2, TILE_H - 2, tone.face);
  px(context, 2, 2, TILE_W - 4, TILE_H - 4, tone.inner);

  if (back === 'jade') {
    // 菱格
    for (let y = 5; y < TILE_H - 5; y += 6) {
      for (let x = 5; x < TILE_W - 5; x += 6) {
        px(context, x, y, 2, 2, tone.mark);
        px(context, x + 3, y + 3, 1, 1, tone.mark);
      }
    }
  } else if (back === 'vermilion') {
    // 云雷回纹
    for (let y = 6; y < TILE_H - 6; y += 10) {
      px(context, 5, y, TILE_W - 10, 1, tone.mark);
      px(context, 5, y, 1, 4, tone.mark);
      px(context, TILE_W - 6, y - 3, 1, 4, tone.mark);
    }
  } else if (back === 'ink') {
    // 星点
    const dots = [[8, 9], [17, 6], [25, 12], [11, 20], [22, 24], [8, 32], [18, 36], [26, 30]];
    for (const [x, y] of dots) {
      px(context, x, y, 2, 2, tone.mark);
      px(context, x - 1, y + 1, 1, 1, tone.mark);
    }
  } else {
    // 素面回纹点阵
    for (let y = 4; y < TILE_H - 4; y += 4) {
      for (let x = 4; x < TILE_W - 4; x += 4) px(context, x, y, 2, 2, tone.mark);
    }
  }

  px(context, 1, TILE_H - 3, TILE_W - 2, 2, tone.foot);
  cache.set(key, canvas);
  return canvas;
}

/** 牌背：牌堆、牌组选择都用它。 */
export function createTileBackCanvas(back = 'plain', scale = 2) {
  return scaled(backSource(back), scale, 'pxc tileBack');
}

export const TILE_SIZE = Object.freeze({ width: TILE_W, height: TILE_H });

/** @param {import('../core/tiles.mjs').Tile} tile */
export function createTileCanvas(tile, scale = 2, { dim = false } = {}) {
  return scaled(tileSource(tile, dim), scale, 'pxc tileFace');
}

/* ---------------- 像素文字 ---------------- */

let measure = null;

function glyphMask(text, size) {
  if (!measure) measure = document.createElement('canvas').getContext('2d');
  const font = `900 ${size}px ${FONT_STACK}`;
  measure.font = font;
  const width = Math.max(2, Math.ceil(measure.measureText(text).width) + 2);
  const height = Math.ceil(size * 1.42) + 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.font = font;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#000';
  context.fillText(text, width / 2, height / 2);
  harden(context, width, height, 115);
  return canvas;
}

function tinted(mask, color) {
  const canvas = document.createElement('canvas');
  canvas.width = mask.width;
  canvas.height = mask.height;
  const context = canvas.getContext('2d');
  context.drawImage(mask, 0, 0);
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

export function pixelText(text, size, color, shadow = null, fitWidth = 0, maxScale = 3) {
  const mask = glyphMask(String(text), size);
  const offset = shadow ? 1 : 0;
  const canvas = document.createElement('canvas');
  canvas.width = mask.width + offset;
  canvas.height = mask.height + offset;
  const context = canvas.getContext('2d');
  if (shadow) context.drawImage(tinted(mask, shadow), offset, offset);
  context.drawImage(tinted(mask, color), 0, 0);
  let scale = maxScale;
  if (fitWidth) scale = Math.max(1, Math.min(maxScale, Math.floor(fitWidth / canvas.width)));
  return scaled(canvas, scale);
}

export function setPixelText(node, text, size, color, shadow = null, maxScale = 3) {
  if (!node) return;
  const available = node.clientWidth - 4;
  node.replaceChildren(pixelText(text, size, color, shadow, available > 8 ? available : 0, maxScale));
}

/* ---------------- 五系卡面图标 ---------------- */

const FAMILY_PALETTE = Object.freeze({
  charm: { paper: '#dff0f4', ink: '#1d5f79', edge: '#12222b' },
  codex: { paper: '#e7dcf6', ink: '#4b2f7a', edge: '#1d1430' },
  general: { paper: '#f6e3c8', ink: '#8c2f27', edge: '#2a1a12' },
  bone: { paper: '#dcefdc', ink: '#22694a', edge: '#122419' },
  seal: { paper: '#f3d9d4', ink: '#a02620', edge: '#2a1210' },
});

/**
 * 单字印章图标。五系用不同纸色与墨色，配合 CSS 的不同轮廓做区分，
 * 不只靠颜色（0011 的视觉识别要求）。
 */
export function createSealCanvas(character, { family = 'charm', scale = 2, palette } = {}) {
  const tone = palette ?? FAMILY_PALETTE[family] ?? FAMILY_PALETTE.charm;
  const key = `seal|${character}|${tone.paper}|${tone.ink}|${tone.edge}`;
  let source = cache.get(key);
  if (!source) {
    const width = 30;
    const height = 38;
    source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const context = source.getContext('2d');
    px(context, 0, 0, width, height, tone.edge);
    px(context, 1, 1, width - 2, height - 2, tone.paper);
    px(context, 3, 3, width - 6, 1, tone.ink);
    px(context, 3, height - 4, width - 6, 1, tone.ink);
    px(context, 3, 3, 1, height - 6, tone.ink);
    px(context, width - 4, 3, 1, height - 6, tone.ink);
    glyph(context, character, width / 2, height / 2, 19, tone.ink);
    cache.set(key, source);
  }
  return scaled(source, scale);
}

export function clearPixelCache() {
  cache.clear();
}
