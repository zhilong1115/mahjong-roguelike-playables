/**
 * 全屏背景 shader。
 *
 * 这是「质感」里性价比最高的一块：静止的 CSS 渐变永远是死的，
 * 一层缓慢流动的噪声会让整个画面开始呼吸。参考小丑牌的做法——
 * 它的底也是一个全屏 fragment shader，不是图片。
 *
 * 三条硬规则：
 * 1. 拿不到 WebGL 就安静退场，CSS 渐变仍然兜底，不能白屏。
 * 2. `prefers-reduced-motion` 或动画关掉时只画一帧静态图。
 * 3. 标签页不可见时停掉 rAF，别在后台烧电。
 */

const VERTEX_SOURCE = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/*
 * 值噪声 + 域扭曲的 fbm。用 hash 而不是纹理，保持零外部资源。
 * 两层扭曲已经足够出「缓慢翻涌」的感觉，再多只会更糊也更慢。
 */
const FRAGMENT_SOURCE = `
precision mediump float;
uniform vec2 uSize;
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uGlow;
uniform float uIntensity;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float total = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    total += noise(p) * amplitude;
    p *= 2.02;
    amplitude *= 0.5;
  }
  return total;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec2 p = (gl_FragCoord.xy - 0.5 * uSize) / min(uSize.x, uSize.y);
  float t = uTime * 0.06;

  // 域扭曲：让噪声自己推着自己走，出漩涡而不是平移
  vec2 warp = vec2(
    fbm(p * 2.1 + vec2(t, -t * 0.7)),
    fbm(p * 2.1 + vec2(4.7 - t * 0.8, t * 1.1))
  );
  float field = fbm(p * 2.6 + warp * 1.6 + vec2(0.0, t * 0.4));

  vec3 color = mix(uDeep, uMid, smoothstep(0.25, 0.85, field));
  // 高处那一缕亮色，像牌桌上方的一盏灯
  float glow = smoothstep(0.62, 1.0, field) * uIntensity;
  color = mix(color, uGlow, glow * 0.55);

  // 中央聚光 + 四周压暗，把视线拉回牌桌
  float spot = 1.0 - smoothstep(0.0, 1.05, length(p * vec2(0.85, 1.15)));
  color *= 0.78 + spot * 0.62;

  // 极轻的颗粒，避免大面积渐变出现色带
  float grain = (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) * 0.022;
  gl_FragColor = vec4(color + grain, 1.0);
}
`;

/** 每个圈 / 圈主一套底色，画面会跟着关卡变冷变热。 */
export const BACKDROP_TONES = Object.freeze({
  default: { deep: [0.070, 0.068, 0.058], mid: [0.220, 0.241, 0.204], glow: [0.520, 0.551, 0.451] },
  east: { deep: [0.060, 0.073, 0.064], mid: [0.190, 0.270, 0.224], glow: [0.489, 0.592, 0.493] },
  south: { deep: [0.087, 0.075, 0.052], mid: [0.286, 0.270, 0.173], glow: [0.620, 0.568, 0.326] },
  west: { deep: [0.061, 0.065, 0.073], mid: [0.206, 0.225, 0.246], glow: [0.480, 0.505, 0.531] },
  boss: { deep: [0.110, 0.043, 0.038], mid: [0.350, 0.105, 0.082], glow: [0.674, 0.274, 0.205] },
  title: { deep: [0.057, 0.058, 0.050], mid: [0.226, 0.244, 0.207], glow: [0.568, 0.526, 0.357] },
});

const REDUCED = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {{setTone:(name:string)=>void, setEnabled:(on:boolean)=>void, destroy:()=>void}|null}
 */
export function createBackdrop(canvas) {
  if (!canvas) return null;
  const gl = canvas.getContext('webgl', {
    alpha: false, antialias: false, depth: false, stencil: false,
    powerPreference: 'low-power',
  }) || canvas.getContext('experimental-webgl');
  if (!gl) return null;

  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const uSize = gl.getUniformLocation(program, 'uSize');
  const uTime = gl.getUniformLocation(program, 'uTime');
  const uDeep = gl.getUniformLocation(program, 'uDeep');
  const uMid = gl.getUniformLocation(program, 'uMid');
  const uGlow = gl.getUniformLocation(program, 'uGlow');
  const uIntensity = gl.getUniformLocation(program, 'uIntensity');

  // 底是低频大色块，半分辨率完全够用，省一半像素填充
  const RESOLUTION_SCALE = 0.5;
  let width = 0;
  let height = 0;
  let frame = null;
  let running = false;
  let animated = !REDUCED;
  let clock = 0;
  let lastStamp = 0;

  const current = { deep: [...BACKDROP_TONES.default.deep], mid: [...BACKDROP_TONES.default.mid], glow: [...BACKDROP_TONES.default.glow] };
  const target = { deep: [...current.deep], mid: [...current.mid], glow: [...current.glow] };

  function resize() {
    const next = Math.max(1, Math.round(innerWidth * RESOLUTION_SCALE));
    const nextHeight = Math.max(1, Math.round(innerHeight * RESOLUTION_SCALE));
    if (next === width && nextHeight === height) return;
    width = next;
    height = nextHeight;
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
  }

  function draw(stamp = 0) {
    frame = null;
    resize();
    const delta = lastStamp ? Math.min(0.05, (stamp - lastStamp) / 1000) : 0.016;
    lastStamp = stamp;
    if (animated) clock += delta;

    // 换圈换圈主时底色缓慢过渡，不要硬切
    for (const key of ['deep', 'mid', 'glow']) {
      for (let index = 0; index < 3; index += 1) {
        current[key][index] += (target[key][index] - current[key][index]) * Math.min(1, delta * 2.2);
      }
    }

    gl.uniform2f(uSize, width, height);
    gl.uniform1f(uTime, clock);
    gl.uniform3fv(uDeep, current.deep);
    gl.uniform3fv(uMid, current.mid);
    gl.uniform3fv(uGlow, current.glow);
    gl.uniform1f(uIntensity, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (running && animated) frame = requestAnimationFrame(draw);
  }

  function start() {
    if (frame || !running) return;
    lastStamp = 0;
    frame = requestAnimationFrame(draw);
  }

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = null;
  }

  const onVisibility = () => {
    if (document.hidden) stop();
    else start();
  };
  const onResize = () => {
    // 静态模式下不会有下一帧，尺寸变了必须补画一张
    if (!animated) draw(performance.now());
  };

  running = true;
  addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  if (animated) start();
  else draw(0);

  return {
    setTone(name) {
      const tone = BACKDROP_TONES[name] ?? BACKDROP_TONES.default;
      target.deep = [...tone.deep];
      target.mid = [...tone.mid];
      target.glow = [...tone.glow];
      if (!animated) draw(performance.now());
    },
    /** 设置里把动画关掉时，底也应该停下来，只留一张静态图。 */
    setEnabled(on) {
      animated = Boolean(on) && !REDUCED;
      if (animated) start();
      else {
        stop();
        draw(performance.now());
      }
    },
    destroy() {
      running = false;
      stop();
      removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
