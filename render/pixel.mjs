/**
 * 像素渲染：低分辨率 canvas + alpha 硬化，放大后仍然锐利。
 * 全部离线自绘，不引用外部字体或图片，满足 Playables 的自包含要求。
 */

// 第二轮牌面从 34×46 加宽到 40×54：仍是小像素画，但刻痕、釉面和托板有了呼吸空间。
const TILE_W = 40;
const TILE_H = 54;
const FONT_STACK = '"PingFang SC","Hiragino Sans GB","Heiti SC","Microsoft YaHei","Noto Sans SC",sans-serif';
const cache = new Map();

/** 瓷面的垂直中心：底部 8px 是玉色托板和暗边，图案要整体上移。 */
const FACE_CY = 23;

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
 * 牌骨材质：牌骨不再只是牌底的一条彩带，而是真的换掉整张牌的料子。
 * 玩家扫一眼手牌就能认出哪几张被改造过（这是 0021 的要求）。
 */
const TILE_MATERIALS = Object.freeze({
  ivory: {
    face: '#eee2c6', faceLow: '#d4c19d', high: '#fff8e8', low: '#a89879',
    edge: '#524331', plate: '#688b74', plateLow: '#314f42', mark: null, grain: '#c8b998',
  },
  // 温玉骨：整张牌是半透的玉料，面色发青白
  warmJade: {
    face: '#dcefe3', faceLow: '#c2ddcd', high: '#f4fdf6', low: '#a5c6b3',
    edge: '#587c69', plate: '#17a074', plateLow: '#0b6b4c', mark: '#2fd39c', grain: null,
  },
  // 青竹骨：竹料，面色偏黄绿，还带竖向竹纹
  greenBamboo: {
    face: '#ecefcf', faceLow: '#d6dbab', high: '#fbfce9', low: '#b8bf8d',
    edge: '#6b7243', plate: '#4f9a2f', plateLow: '#2d5f18', mark: '#a8dd63', grain: '#d2d79f',
  },
});

function dimColor(hex, amount = 0.42) {
  const value = parseInt(hex.slice(1), 16);
  const mix = (channel) => Math.round(channel + (0x6b - channel) * amount);
  return `#${[
    mix((value >> 16) & 255), mix((value >> 8) & 255), mix(value & 255),
  ].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * 牌身：上面是象牙面，底部留一条玉色托板——真麻将牌就是象牙面压在竹背上，
 * 这一条是整张牌「立起来」的关键。`material` 换的是整张牌的料子。
 */
function tileBody(context, dim, material = 'ivory') {
  const tone = TILE_MATERIALS[material] ?? TILE_MATERIALS.ivory;
  const pick = (color) => (dim ? dimColor(color) : color);
  const face = pick(tone.face);
  const faceLow = pick(tone.faceLow);
  const high = pick(tone.high);
  const low = pick(tone.low);
  const edge = pick(tone.edge);
  const jade = pick(tone.plate);
  const jadeLow = pick(tone.plateLow);

  // 深木色外壳与右下侧边，先把牌做成一个有厚度的物件。
  px(context, 0, 0, TILE_W, TILE_H, '#171510');
  px(context, 2, 2, TILE_W - 3, TILE_H - 3, edge);
  px(context, TILE_W - 3, 4, 2, TILE_H - 8, '#3b3227');
  px(context, 3, TILE_H - 4, TILE_W - 5, 3, '#29231b');
  // 瓷面（上部），双层内框像一圈微微凸起的釉边。
  px(context, 2, 1, TILE_W - 5, TILE_H - 9, faceLow);
  px(context, 3, 2, TILE_W - 7, TILE_H - 11, face);
  // 竹料的竖纹：只有青竹骨有
  if (tone.grain && !dim) {
    for (let x = 5; x < TILE_W - 5; x += 6) {
      px(context, x, 3, 1, TILE_H - 14, tone.grain);
    }
  }
  // 旧象牙 / 宣纸釉面留几颗纤维和拓印斑，避免大白块像网页按钮。
  if (tone.grain && material === 'ivory' && !dim) {
    for (const [x, y] of [[7, 8], [31, 12], [11, 38], [28, 34], [18, 5], [6, 29], [34, 25]]) {
      px(context, x, y, 1, 1, tone.grain);
    }
  }
  // 面下缘的弧面与玉色托板。
  px(context, 3, TILE_H - 13, TILE_W - 7, 4, faceLow);
  px(context, 2, TILE_H - 9, TILE_W - 5, 5, jade);
  px(context, 3, TILE_H - 5, TILE_W - 7, 2, jadeLow);
  // 左上釉光、右侧阴影和内侧细金线。
  px(context, 3, 2, TILE_W - 7, 1, high);
  px(context, 3, 2, 1, TILE_H - 13, high);
  px(context, TILE_W - 5, 4, 1, TILE_H - 16, low);
  px(context, 4, TILE_H - 14, TILE_W - 9, 1, edge);
  px(context, 5, 4, TILE_W - 11, 1, dim ? low : '#c8aa72');
  // 左上角一枚材质记号，和图案不打架，但一眼能数出有几张被改造
  if (tone.mark) {
    const mark = pick(tone.mark);
    px(context, 3, 3, 5, 5, mark);
    px(context, 3, 3, 4, 1, high);
    px(context, 7, 4, 1, 4, edge);
  }
  roundCorners(context, TILE_W, TILE_H, '#0e0b07');
}

/** 牌印：右上角一枚朱砂小印，说明这张牌挂了事件。 */
function sealMark(context, dim) {
  const body = dim ? '#8d6560' : '#c0392b';
  const light = dim ? '#a8807a' : '#e8695a';
  const dark = dim ? '#5c4340' : '#7d1f1c';
  const x = TILE_W - 10;
  px(context, x, 3, 7, 7, dark);
  px(context, x + 1, 4, 5, 5, body);
  px(context, x + 1, 4, 5, 1, light);
  px(context, x + 2, 5, 1, 3, light);
  px(context, x + 4, 5, 1, 3, dark);
}

function drawDots(context, rank) {
  const B = '#273b45';
  const BI = '#627982';
  const R = '#9d3328';
  const RI = '#c66a54';
  const G = '#3e6f57';
  const GI = '#79a184';
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
  const G = '#52775d';
  const D = '#294b38';
  const R = '#a33a2f';
  const DR = '#70251f';
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

function tileSource(tile, dim = false, material = 'ivory', sealed = false) {
  const key = `tile|${tile.suit}|${tile.rank}|${dim ? 1 : 0}|${material}|${sealed ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = TILE_W;
  canvas.height = TILE_H;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  tileBody(context, dim, material);

  const cx = (TILE_W / 2) | 0;
  const cy = FACE_CY;
  const carve = dim ? null : '#f9eed7';   // 主色下面垫一层纸白，像拓印旁边留出的飞白
  if (tile.suit === 'man') {
    glyph(context, '一二三四五六七八九'[tile.rank - 1], cx, 13, 15,
      dim ? '#5d5b55' : '#232722', { shade: carve });
    glyph(context, '萬', cx, 34, 20, dim ? '#8d655f' : '#9d3328',
      { threshold: 165, weight: 500, levels: 2 });
  } else if (tile.suit === 'honor') {
    if (tile.rank === 7) {
      // 白板：双线方框，比单线更像刻上去的
      const color = dim ? '#69706d' : '#344d52';
      const inner = dim ? '#888d85' : '#718b86';
      const top = 9;
      const bottom = TILE_H - 16;
      px(context, 6, top, TILE_W - 12, 1, color);
      px(context, 6, bottom, TILE_W - 12, 1, color);
      px(context, 6, top, 1, bottom - top, color);
      px(context, TILE_W - 7, top, 1, bottom - top + 1, color);
      px(context, 8, top + 2, TILE_W - 16, 1, inner);
      px(context, 8, bottom - 2, TILE_W - 16, 1, inner);
      px(context, 8, top + 2, 1, bottom - top - 4, inner);
      px(context, TILE_W - 9, top + 2, 1, bottom - top - 4, inner);
    } else {
      const color = tile.rank === 5 ? '#a03329' : (tile.rank === 6 ? '#426e55' : '#252923');
      // 發 / 東 笔画多，阈值调高换回字腔；中 / 南 / 西 / 北 保留刻痕高光
      const dense = tile.rank === 6 || tile.rank === 1;
      glyph(context, HONOR_GLYPHS[tile.rank], cx, cy, dense ? 26 : 24, color,
        dense ? { threshold: 165, weight: 500, levels: 2 } : { shade: carve });
    }
  } else if (tile.suit === 'pin') {
    drawDots(context, tile.rank);
  } else {
    drawBamboo(context, tile.rank);
  }

  if (sealed) sealMark(context, dim);
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
    base: '#211f1a', face: '#45443b', inner: '#34352f', line: '#918b76',
    mark: '#c7bea0', glyph: '#eee2c6', foot: '#12110e',
  },
  jade: {
    base: '#1f352b', face: '#446957', inner: '#315444', line: '#7ca38b',
    mark: '#b0c6ad', glyph: '#e2eadc', foot: '#14241d',
  },
  vermilion: {
    base: '#481914', face: '#87372d', inner: '#6a2b24', line: '#bd6959',
    mark: '#dfa08a', glyph: '#f1d9c3', foot: '#2b100d',
  },
  ink: {
    base: '#11120f', face: '#292c28', inner: '#1d211e', line: '#676d62',
    mark: '#9fa393', glyph: '#e2decf', foot: '#090a08',
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

  px(context, 0, 0, TILE_W, TILE_H, '#171510');
  px(context, 2, 2, TILE_W - 3, TILE_H - 3, tone.base);
  px(context, 3, 2, TILE_W - 6, TILE_H - 11, tone.face);
  px(context, TILE_W - 3, 4, 2, TILE_H - 8, tone.foot);
  // 乌木 / 旧漆上的双层水墨边，中间以断笔做回纹节奏。
  px(context, 5, 5, TILE_W - 11, 1, tone.line);
  px(context, 5, TILE_H - 15, TILE_W - 11, 1, tone.line);
  px(context, 5, 5, 1, TILE_H - 19, tone.line);
  px(context, TILE_W - 6, 5, 1, TILE_H - 19, tone.line);
  px(context, 7, 7, TILE_W - 15, 1, tone.inner);
  px(context, 7, TILE_H - 17, TILE_W - 15, 1, tone.inner);
  px(context, 7, 7, 1, TILE_H - 23, tone.inner);
  px(context, TILE_W - 8, 7, 1, TILE_H - 23, tone.inner);
  for (let x = 9; x < TILE_W - 10; x += 6) {
    px(context, x, 5, 3, 1, tone.mark);
    px(context, x, TILE_H - 15, 3, 1, tone.mark);
  }
  // 四角角花。
  for (const [x, y] of [[4, 4], [TILE_W - 8, 4], [4, TILE_H - 18], [TILE_W - 8, TILE_H - 18]]) {
    px(context, x, y, 4, 2, tone.mark);
    px(context, x, y, 2, 4, tone.mark);
  }

  backEmblem(context, back, tone, (TILE_W / 2) | 0, ((TILE_H - 9) / 2) | 0);

  // 温玉托板 + 高光暗边，和牌面同一套立体规则
  px(context, 2, TILE_H - 9, TILE_W - 5, 5, '#688b74');
  px(context, 3, TILE_H - 5, TILE_W - 7, 2, '#314f42');
  px(context, 3, 2, TILE_W - 6, 1, tone.line);
  px(context, 3, 2, 1, TILE_H - 12, tone.line);
  px(context, TILE_W - 4, 3, 1, TILE_H - 12, tone.foot);
  px(context, 3, TILE_H - 10, TILE_W - 6, 1, tone.foot);
  roundCorners(context, TILE_W, TILE_H, '#0e0b07');

  cache.set(key, canvas);
  return canvas;
}

/** 牌背：牌堆、牌组选择都用它。 */
export function createTileBackCanvas(back = 'plain', scale = 2) {
  return scaled(backSource(back), scale, 'pxc tileBack');
}

export const TILE_SIZE = Object.freeze({ width: TILE_W, height: TILE_H });

/** 牌骨 id → 材质名。内容里没定义材质的牌骨就退回象牙面。 */
export const TILE_MATERIAL_IDS = Object.freeze(Object.keys(TILE_MATERIALS));

/**
 * @param {import('../core/tiles.mjs').Tile} tile
 * @param {number} scale
 * @param {{dim?:boolean, material?:string, sealed?:boolean}} [options]
 */
export function createTileCanvas(tile, scale = 2, { dim = false, material = 'ivory', sealed = false } = {}) {
  const safe = TILE_MATERIALS[material] ? material : 'ivory';
  return scaled(tileSource(tile, dim, safe, sealed), scale, 'pxc tileFace');
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

const LOGO_W = 240;
const LOGO_H = 124;

/**
 * 标题书画印记：一笔不闭合的墨圈托住「天胡」，右下盖朱砂方印，
 * 英文只作为小号识别。Logo 自己透明，能落在任意水墨背景上。
 */
function logoSource() {
  const hit = cache.get('ink-logo');
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = LOGO_W;
  canvas.height = LOGO_H;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;

  // 墨圈故意不闭合；三层透明线与飞白短点让它像落在宣纸上的一笔。
  context.save();
  context.lineCap = 'round';
  context.strokeStyle = 'rgba(28,27,22,.78)';
  context.lineWidth = 10;
  context.beginPath();
  context.arc(108, 58, 49, 0.42, Math.PI * 1.84);
  context.stroke();
  context.strokeStyle = 'rgba(28,27,22,.28)';
  context.lineWidth = 4;
  context.beginPath();
  context.arc(108, 58, 55, 0.56, Math.PI * 1.72);
  context.stroke();
  for (const [x, y, w, a] of [[51, 86, 17, .55], [160, 28, 12, .44], [46, 78, 7, .35]]) {
    context.fillStyle = `rgba(28,27,22,${a})`;
    context.fillRect(x, y, w, 2);
  }
  context.restore();

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '900 70px "Kaiti SC","STKaiti","KaiTi","Songti SC",serif';
  context.fillStyle = '#1d1d18';
  context.shadowColor = 'rgba(255,248,226,.55)';
  context.shadowBlur = 1;
  context.fillText('天', 84, 57);
  context.fillText('胡', 139, 62);
  // 同字轻微错印一次，模拟拓印墨边，不牺牲字腔。
  context.globalAlpha = 0.17;
  context.fillText('天', 83, 58);
  context.fillText('胡', 140, 61);
  context.globalAlpha = 1;
  context.shadowBlur = 0;

  // 朱砂方印。印中只放一个清楚的「胡」字，生成式背景不承担任何文字。
  context.fillStyle = '#a23b2e';
  context.fillRect(176, 54, 35, 35);
  context.strokeStyle = '#6e261f';
  context.lineWidth = 2;
  context.strokeRect(178, 56, 31, 31);
  context.font = '700 22px "Kaiti SC","STKaiti","KaiTi",serif';
  context.fillStyle = '#f2dfbd';
  context.fillText('胡', 193.5, 72.5);

  context.textAlign = 'left';
  context.font = '700 12px Georgia,"Times New Roman",serif';
  context.fillStyle = '#31332c';
  context.fillText('T I A N H U', 73, 107);
  context.fillStyle = 'rgba(162,59,46,.75)';
  context.fillRect(39, 105, 27, 2);
  context.fillStyle = 'rgba(49,51,44,.55)';
  context.fillRect(157, 105, 25, 1);

  cache.set('ink-logo', canvas);
  return canvas;
}

/** 标题页 Logo 保留 Canvas 抗锯齿，不走麻将牌的硬像素缩放。 */
export function createLogoCanvas(scale = 2) {
  const source = logoSource();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  canvas.className = 'logoArt';
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function clearPixelCache() {
  cache.clear();
}
