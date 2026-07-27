/**
 * 像素渲染：低分辨率 canvas + alpha 硬化，放大后仍然锐利。
 * 全部离线自绘，不引用外部字体或图片，满足 Playables 的自包含要求。
 */

const TILE_W = 34;
const TILE_H = 46;
const FONT_STACK = '"PingFang SC","Hiragino Sans GB","Heiti SC","Microsoft YaHei","Noto Sans SC",sans-serif';
const cache = new Map();

/** 象牙面的垂直中心：底部 6px 是玉色托板，图案要整体上移。 */
const FACE_CY = 20;

const HONOR_GLYPHS = Object.freeze({ 1: '東', 2: '南', 3: '西', 4: '北', 5: '中', 6: '發', 7: '' });

function px(context, x, y, width, height, color) {
  context.fillStyle = color;
  context.fillRect(x | 0, y | 0, width | 0, height | 0);
}

/**
 * 把抗锯齿边缘硬化成 1-bit，得到真正的像素轮廓。
 * `levels = 2` 时改成两级：笔画密的字（發、東）纯 1-bit 会糊成一坨，
 * 留一档半调既保住字腔，也仍然是硬边像素。
 */
function harden(context, width, height, threshold = 120, levels = 1) {
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  const half = Math.round(threshold * 0.45);
  for (let index = 3; index < data.length; index += 4) {
    const alpha = data[index];
    if (alpha === 0) continue;
    if (levels > 1) {
      data[index] = alpha < half ? 0 : (alpha < threshold ? 130 : 255);
    } else {
      data[index] = alpha < threshold ? 0 : 255;
    }
  }
  context.putImageData(image, 0, 0);
}

/**
 * 硬化成 1-bit 的字模，可以反复上色。
 * `threshold` 越高留下的像素越少：笔画密的字（萬、發）调高才不会糊成一坨。
 * `weight` 让密集字用细字重，进一步保住字腔。
 */
function glyphSprite(text, size, color, threshold = 120, weight = 900, levels = 1) {
  const pad = 4;
  const width = Math.ceil(size * (String(text).length + 1)) + pad * 2;
  const height = Math.ceil(size * 1.6) + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const glyphContext = canvas.getContext('2d');
  glyphContext.font = `${weight} ${size}px ${FONT_STACK}`;
  glyphContext.textAlign = 'center';
  glyphContext.textBaseline = 'middle';
  glyphContext.fillStyle = '#000';
  glyphContext.fillText(text, width / 2, height / 2);
  harden(glyphContext, width, height, threshold, levels);
  glyphContext.globalCompositeOperation = 'source-in';
  glyphContext.fillStyle = color;
  glyphContext.fillRect(0, 0, width, height);
  return canvas;
}

/**
 * 画一个字。默认带「雕刻感」：先在下面垫一层暗色，再压上主色，
 * 小字号下比纯色块更清楚，也更像刻进牌面里。
 */
const OUTLINE_OFFSETS = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];

function glyph(context, text, x, y, size, color, {
  shade = null, lift = null, outline = null, outlineWidth = 1, drop = 0,
  threshold = 120, weight = 900, levels = 1,
} = {}) {
  const main = glyphSprite(text, size, color, threshold, weight, levels);
  const left = Math.round(x - main.width / 2);
  const top = Math.round(y - main.height / 2);
  if (outline) {
    const ring = glyphSprite(text, size, outline, threshold, weight, levels);
    for (let step = 1; step <= outlineWidth; step += 1) {
      for (const [dx, dy] of OUTLINE_OFFSETS) {
        context.drawImage(ring, left + dx * step, top + dy * step);
      }
    }
    if (drop) {
      for (let step = 1; step <= drop; step += 1) {
        context.drawImage(ring, left, top + outlineWidth + step);
      }
    }
  }
  if (shade) context.drawImage(glyphSprite(text, size, shade, threshold, weight, levels), left, top + 1);
  if (lift) context.drawImage(glyphSprite(text, size, lift, threshold, weight, levels), left, top - 1);
  context.drawImage(main, left, top);
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

/** 把四个角各削掉一个像素，牌就不再是硬邦邦的方块。 */
function roundCorners(context, width, height, color) {
  px(context, 0, 0, 1, 1, color);
  px(context, width - 1, 0, 1, 1, color);
  px(context, 0, height - 1, 1, 1, color);
  px(context, width - 1, height - 1, 1, 1, color);
}

/** 同样是削角，但直接挖成透明，用在需要透出背景的牌匾上。 */
function cutCorners(context, width, height) {
  context.clearRect(0, 0, 1, 1);
  context.clearRect(width - 1, 0, 1, 1);
  context.clearRect(0, height - 1, 1, 1);
  context.clearRect(width - 1, height - 1, 1, 1);
}

/**
 * 牌身：上面是象牙面，底部留一条玉色托板——真麻将牌就是象牙面压在竹背上，
 * 这一条是整张牌「立起来」的关键。
 */
function tileBody(context, dim) {
  const face = dim ? '#b9b2a4' : '#f7f2e4';
  const faceLow = dim ? '#a9a294' : '#e8e0cb';
  const high = dim ? '#cdc6b6' : '#fffefa';
  const low = dim ? '#8e887c' : '#cdc4ad';
  const edge = dim ? '#5a564d' : '#7d7159';
  const jade = dim ? '#4d6157' : '#2f7d5c';
  const jadeLow = dim ? '#35443d' : '#1d5340';

  // 外框
  px(context, 0, 0, TILE_W, TILE_H, '#241c13');
  // 象牙面（上部）
  px(context, 1, 1, TILE_W - 2, TILE_H - 6, face);
  // 面下缘微微变深，做出弧面感
  px(context, 1, TILE_H - 10, TILE_W - 2, 4, faceLow);
  // 玉色托板（底部）
  px(context, 1, TILE_H - 6, TILE_W - 2, 4, jade);
  px(context, 1, TILE_H - 3, TILE_W - 2, 2, jadeLow);
  // 高光与暗边
  px(context, 1, 1, TILE_W - 2, 1, high);
  px(context, 1, 1, 1, TILE_H - 7, high);
  px(context, TILE_W - 2, 2, 1, TILE_H - 8, low);
  px(context, 1, TILE_H - 7, TILE_W - 2, 1, edge);
  roundCorners(context, TILE_W, TILE_H, '#0e0b07');
}

function drawDots(context, rank) {
  const B = '#1b4f9c';
  const BI = '#3a7fd4';
  const R = '#b02a2a';
  const RI = '#dd5a52';
  const G = '#1a7f4b';
  const GI = '#3fae74';
  const cx = (TILE_W / 2) | 0;
  const cy = FACE_CY;
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
  const cy = FACE_CY;
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
  const cy = FACE_CY;
  const carve = dim ? null : '#ffffff';   // 主色下面垫一层白，做出刻痕的反光
  if (tile.suit === 'man') {
    glyph(context, '一二三四五六七八九'[tile.rank - 1], cx, 12, 14,
      dim ? '#4b5566' : '#16233a', { shade: carve });
    glyph(context, '萬', cx, 29, 18, dim ? '#8d5d5d' : '#a8231f',
      { threshold: 165, weight: 500, levels: 2 });
  } else if (tile.suit === 'honor') {
    if (tile.rank === 7) {
      // 白板：双线方框，比单线更像刻上去的
      const color = dim ? '#5a6b86' : '#1b3f7a';
      const inner = dim ? '#7d8ba3' : '#3f6cae';
      const top = 8;
      const bottom = TILE_H - 14;
      px(context, 6, top, TILE_W - 12, 1, color);
      px(context, 6, bottom, TILE_W - 12, 1, color);
      px(context, 6, top, 1, bottom - top, color);
      px(context, TILE_W - 7, top, 1, bottom - top + 1, color);
      px(context, 8, top + 2, TILE_W - 16, 1, inner);
      px(context, 8, bottom - 2, TILE_W - 16, 1, inner);
      px(context, 8, top + 2, 1, bottom - top - 4, inner);
      px(context, TILE_W - 9, top + 2, 1, bottom - top - 4, inner);
    } else {
      const color = tile.rank === 5 ? '#b8291f' : (tile.rank === 6 ? '#12704a' : '#16233a');
      // 發 / 東 笔画多，阈值调高换回字腔；中 / 南 / 西 / 北 保留刻痕高光
      const dense = tile.rank === 6 || tile.rank === 1;
      glyph(context, HONOR_GLYPHS[tile.rank], cx, cy, dense ? 23 : 21, color,
        dense ? { threshold: 165, weight: 500, levels: 2 } : { shade: carve });
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
  plain: {
    base: '#122846', face: '#2b5a95', inner: '#1f4677', line: '#4d8bd0',
    mark: '#8fc0f0', glyph: '#d8ecff', foot: '#0c1c33',
  },
  jade: {
    base: '#0f3223', face: '#22664a', inner: '#17503a', line: '#3f9c72',
    mark: '#7fd4aa', glyph: '#d6f5e6', foot: '#082116',
  },
  vermilion: {
    base: '#48120f', face: '#8e2f26', inner: '#6d241d', line: '#c05244',
    mark: '#f09a86', glyph: '#ffe2d6', foot: '#2e0a08',
  },
  ink: {
    base: '#0d0f16', face: '#2a2e3d', inner: '#1e2230', line: '#535c7d',
    mark: '#8f98bd', glyph: '#dfe4f7', foot: '#07080d',
  },
});

/** 牌背中央的纹章，四款各有一个可辨认的图形。 */
function backEmblem(context, back, tone, cx, cy) {
  if (back === 'jade') {
    // 菱形套菱形
    for (let radius = 7; radius >= 3; radius -= 4) {
      for (let offset = -radius; offset <= radius; offset += 1) {
        const height = radius - Math.abs(offset);
        px(context, cx + offset, cy - height, 1, 1, tone.mark);
        px(context, cx + offset, cy + height, 1, 1, tone.mark);
      }
    }
    px(context, cx - 1, cy - 1, 3, 3, tone.glyph);
    return;
  }
  if (back === 'vermilion') {
    // 回字纹
    px(context, cx - 7, cy - 7, 15, 15, tone.line);
    px(context, cx - 5, cy - 5, 11, 11, tone.face);
    px(context, cx - 3, cy - 3, 7, 7, tone.mark);
    px(context, cx - 1, cy - 1, 3, 3, tone.face);
    return;
  }
  if (back === 'ink') {
    // 北斗七星
    const stars = [[-7, -7], [-2, -5], [3, -3], [7, 0], [3, 4], [-2, 6], [-7, 4]];
    for (const [dx, dy] of stars) {
      px(context, cx + dx, cy + dy, 2, 2, tone.mark);
      px(context, cx + dx, cy + dy - 1, 1, 1, tone.glyph);
    }
    return;
  }
  // 素面：中央一枚铜钱
  for (let y = -7; y <= 7; y += 1) {
    for (let x = -7; x <= 7; x += 1) {
      if (Math.hypot(x, y) <= 7.2) px(context, cx + x, cy + y, 1, 1, tone.mark);
    }
  }
  for (let y = -5; y <= 5; y += 1) {
    for (let x = -5; x <= 5; x += 1) {
      if (Math.hypot(x, y) <= 5.2) px(context, cx + x, cy + y, 1, 1, tone.face);
    }
  }
  px(context, cx - 2, cy - 2, 4, 4, tone.glyph);
  px(context, cx - 1, cy - 1, 2, 2, tone.inner);
}

/**
 * 牌背：外框 + 内嵌线框 + 四角装饰 + 中央纹章 + 底部玉托。
 * 结构和牌面保持一致，翻面时不会「换了一张牌」。
 */
function backSource(back = 'plain') {
  const key = `back|${back}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const tone = BACK_PALETTE[back] ?? BACK_PALETTE.plain;
  const canvas = document.createElement('canvas');
  canvas.width = TILE_W;
  canvas.height = TILE_H;
  const context = canvas.getContext('2d');

  px(context, 0, 0, TILE_W, TILE_H, '#241c13');
  px(context, 1, 1, TILE_W - 2, TILE_H - 6, tone.base);
  px(context, 2, 2, TILE_W - 4, TILE_H - 8, tone.face);
  // 内嵌细线框
  px(context, 4, 4, TILE_W - 8, 1, tone.line);
  px(context, 4, TILE_H - 11, TILE_W - 8, 1, tone.line);
  px(context, 4, 4, 1, TILE_H - 15, tone.line);
  px(context, TILE_W - 5, 4, 1, TILE_H - 15, tone.line);
  // 四角小方块
  for (const [x, y] of [[3, 3], [TILE_W - 5, 3], [3, TILE_H - 12], [TILE_W - 5, TILE_H - 12]]) {
    px(context, x, y, 2, 2, tone.mark);
  }

  backEmblem(context, back, tone, (TILE_W / 2) | 0, ((TILE_H - 6) / 2) | 0);

  // 玉色托板 + 高光暗边，和牌面同一套立体规则
  px(context, 1, TILE_H - 6, TILE_W - 2, 4, '#2f7d5c');
  px(context, 1, TILE_H - 3, TILE_W - 2, 2, '#1d5340');
  px(context, 1, 1, TILE_W - 2, 1, tone.line);
  px(context, 1, 1, 1, TILE_H - 7, tone.line);
  px(context, TILE_W - 2, 2, 1, TILE_H - 8, tone.foot);
  px(context, 1, TILE_H - 7, TILE_W - 2, 1, tone.foot);
  roundCorners(context, TILE_W, TILE_H, '#0e0b07');

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
  charm: { paper: '#eaf7fa', shade: '#c2dfe7', ink: '#1d5f79', accent: '#4fb3d0', edge: '#12222b' },
  codex: { paper: '#f0e8fb', shade: '#cfc0e8', ink: '#4b2f7a', accent: '#9a7ce0', edge: '#1d1430' },
  general: { paper: '#fbeed6', shade: '#e0c69c', ink: '#8c2f27', accent: '#e0a44a', edge: '#2a1a12' },
  bone: { paper: '#e7f6e6', shade: '#c0dfc4', ink: '#22694a', accent: '#5cbf8a', edge: '#122419' },
  seal: { paper: '#fbe3dd', shade: '#e3bab2', ink: '#a02620', accent: '#d9584c', edge: '#2a1210' },
});

/**
 * 单字印章牌匾。五系用不同纸色、墨色和顶部色带，配合 CSS 的不同轮廓做区分，
 * 不只靠颜色（0011 的视觉识别要求）。
 */
export function createSealCanvas(character, { family = 'charm', scale = 2, palette } = {}) {
  const tone = palette ?? FAMILY_PALETTE[family] ?? FAMILY_PALETTE.charm;
  const accent = tone.accent ?? tone.ink;
  const shadeTone = tone.shade ?? tone.paper;
  const key = `seal|${character}|${tone.paper}|${tone.ink}|${tone.edge}|${accent}`;
  let source = cache.get(key);
  if (!source) {
    const width = 30;
    const height = 38;
    source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const context = source.getContext('2d');
    // 外框 + 纸面 + 下缘阴影，做出一块厚牌匾
    px(context, 0, 0, width, height, tone.edge);
    px(context, 1, 1, width - 2, height - 2, tone.paper);
    px(context, 1, height - 5, width - 2, 3, shadeTone);
    // 顶部系别色带
    px(context, 1, 1, width - 2, 3, accent);
    px(context, 1, 1, width - 2, 1, tone.paper);
    px(context, 1, 4, width - 2, 1, tone.ink);
    // 双层内框
    px(context, 3, 7, width - 6, 1, tone.ink);
    px(context, 3, height - 5, width - 6, 1, tone.ink);
    px(context, 3, 7, 1, height - 12, tone.ink);
    px(context, width - 4, 7, 1, height - 12, tone.ink);
    px(context, 5, 9, width - 10, 1, accent);
    px(context, 5, height - 7, width - 10, 1, accent);
    // 四角刻痕
    for (const [x, y] of [[3, 7], [width - 4, 7], [3, height - 5], [width - 4, height - 5]]) {
      px(context, x, y, 1, 1, accent);
    }
    glyph(context, character, width / 2, height / 2 + 2, 19, tone.ink, { shade: '#ffffff' });
    cutCorners(context, width, height);
    cache.set(key, source);
  }
  return scaled(source, scale);
}

/* ---------------- 标题 logo ---------------- */

const LOGO_W = 132;
const LOGO_H = 66;

/**
 * 标题像素牌匾：朱漆底 + 双层金框 + 削角，两个大字用黑描边压金面，
 * 下面一条 TIANHU 飘带。整块是一张 canvas，放大后仍然是硬像素。
 */
function logoSource() {
  const hit = cache.get('logo');
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = LOGO_W;
  canvas.height = LOGO_H;
  const context = canvas.getContext('2d');

  const plateH = 48;
  // 阴影 → 外框 → 金框 → 朱漆面
  px(context, 3, 4, LOGO_W - 4, plateH, '#120c07');
  px(context, 0, 0, LOGO_W - 4, plateH, '#1c1209');
  px(context, 2, 2, LOGO_W - 8, plateH - 4, '#c99527');
  px(context, 3, 3, LOGO_W - 10, 1, '#f7dd8e');
  px(context, 4, 4, LOGO_W - 12, plateH - 8, '#8c2f27');
  px(context, 4, 4, LOGO_W - 12, 1, '#b8483c');
  px(context, 4, plateH - 5, LOGO_W - 12, 1, '#5c1a16');
  // 削角，去掉方块感
  for (const [x, y] of [[0, 0], [LOGO_W - 5, 0], [0, plateH - 1], [LOGO_W - 5, plateH - 1]]) {
    context.clearRect(x, y, 1, 1);
  }
  // 面上的暗色底纹，像老木匾的刻线
  for (let y = 7; y < plateH - 6; y += 4) {
    px(context, 6, y, LOGO_W - 16, 1, '#7d2822');
  }

  const cy = (plateH / 2) | 0;
  glyph(context, '天', 40, cy, 34, '#f5cf5c', { outline: '#170d06', outlineWidth: 2, drop: 1, lift: '#fff0b4' });
  glyph(context, '胡', 90, cy, 34, '#f5cf5c', { outline: '#170d06', outlineWidth: 2, drop: 1, lift: '#fff0b4' });

  // 飘带
  const ribbonY = plateH - 4;
  px(context, 20, ribbonY, LOGO_W - 44, 15, '#151d26');
  px(context, 21, ribbonY + 1, LOGO_W - 46, 13, '#2f9e63');
  px(context, 21, ribbonY + 1, LOGO_W - 46, 1, '#5fd193');
  px(context, 21, ribbonY + 12, LOGO_W - 46, 1, '#1b6e42');
  glyph(context, 'TIANHU', LOGO_W / 2 - 2, ribbonY + 7, 11, '#f2efe4', { shade: '#0f3a24' });

  cache.set('logo', canvas);
  return canvas;
}

/** 标题页 logo。scale 越大越锐利，不会糊。 */
export function createLogoCanvas(scale = 3) {
  return scaled(logoSource(), scale, 'pxc logoArt');
}

export function clearPixelCache() {
  cache.clear();
}
