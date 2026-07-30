/**
 * 弹簧动效层。
 *
 * 为什么不用 CSS keyframes：keyframes 是一条写死的曲线，起点终点都固定，
 * 动画播到一半被打断就会跳。小丑牌那种「有重量的东西在动」的手感来自
 * 弹簧——目标随时可以改，速度是连续的，超调回弹是物理算出来的。
 *
 * 三条硬规则：
 * 1. 只有真的在动的元素才进 rAF 循环，静下来就自动退出。
 * 2. 元素从 DOM 里被摘掉就自动注销，renderAll 反复重建也不会泄漏。
 * 3. `prefers-reduced-motion` 下所有弹簧瞬间到位，不做常驻浮动。
 */

const REDUCED = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 每个通道：位置、速度、目标、刚度、阻尼。 */
function channel(value = 0, stiffness = 170, damping = 16) {
  return { value, velocity: 0, target: value, stiffness, damping };
}

function step(ch, delta) {
  const force = (ch.target - ch.value) * ch.stiffness - ch.velocity * ch.damping;
  ch.velocity += force * delta;
  ch.value += ch.velocity * delta;
  if (Math.abs(ch.target - ch.value) < 0.0015 && Math.abs(ch.velocity) < 0.0015) {
    ch.value = ch.target;
    ch.velocity = 0;
    return false;
  }
  return true;
}

const states = new WeakMap();
const active = new Set();
let frame = null;
let last = 0;
let motionEnabled = !REDUCED;

function makeState(element, options) {
  return {
    element,
    // lift 单位是 px，rx/ry/rot 是 deg，scale 是倍率
    lift: channel(0, 210, 17),
    scale: channel(1, 240, 15),
    rx: channel(0, 190, 18),
    ry: channel(0, 190, 18),
    rot: channel(0, 200, 16),
    /** 常驻微浮动：卡永远在轻轻呼吸，画面才不像贴图 */
    float: options.float ?? 0,
    phase: Math.random() * Math.PI * 2,
    depth: options.depth ?? 0,
    extra: options.extra ?? '',
  };
}

function write(state, time) {
  const bob = state.float && motionEnabled
    ? Math.sin(time * 0.0016 + state.phase) * state.float
    : 0;
  const tiltRoll = state.float && motionEnabled
    ? Math.sin(time * 0.0011 + state.phase * 1.7) * 0.6
    : 0;
  const lift = state.lift.value + bob;
  const parts = [];
  if (state.depth) parts.push(`perspective(${state.depth}px)`);
  parts.push(`translate3d(0, ${(-lift).toFixed(2)}px, 0)`);
  if (state.rx.value || state.ry.value) {
    parts.push(`rotateX(${state.rx.value.toFixed(2)}deg)`);
    parts.push(`rotateY(${state.ry.value.toFixed(2)}deg)`);
  }
  const roll = state.rot.value + tiltRoll;
  if (roll) parts.push(`rotate(${roll.toFixed(2)}deg)`);
  if (state.scale.value !== 1) parts.push(`scale(${state.scale.value.toFixed(4)})`);
  if (state.extra) parts.push(state.extra);
  state.element.style.transform = parts.join(' ');
}

function tick(stamp) {
  frame = null;
  const delta = last ? Math.min(0.05, (stamp - last) / 1000) : 0.016;
  last = stamp;

  for (const state of active) {
    if (!state.element.isConnected) {
      active.delete(state);
      continue;
    }
    let moving = false;
    moving = step(state.lift, delta) || moving;
    moving = step(state.scale, delta) || moving;
    moving = step(state.rx, delta) || moving;
    moving = step(state.ry, delta) || moving;
    moving = step(state.rot, delta) || moving;
    write(state, stamp);
    // 常驻浮动的卡永远算「在动」，否则呼吸会停
    if (!moving && !(state.float && motionEnabled)) active.delete(state);
  }

  if (active.size) frame = requestAnimationFrame(tick);
  else last = 0;
}

function wake(state) {
  active.add(state);
  if (!frame) {
    last = 0;
    frame = requestAnimationFrame(tick);
  }
}

/** 拿到（必要时创建）某个元素的弹簧状态。 */
export function springFor(element, options = {}) {
  if (!element) return null;
  let state = states.get(element);
  if (!state) {
    state = makeState(element, options);
    states.set(element, state);
    element.classList.add('sprung');
    if (state.float && motionEnabled) wake(state);
  }
  return state;
}

/** 设目标值。弹簧会自己走过去，中途改目标也不会跳。 */
export function springTo(element, targets, options = {}) {
  const state = springFor(element, options);
  if (!state) return;
  for (const [key, value] of Object.entries(targets)) {
    const ch = state[key];
    if (!ch || typeof ch !== 'object') continue;
    ch.target = value;
    if (!motionEnabled) {
      ch.value = value;
      ch.velocity = 0;
    }
  }
  if (!motionEnabled) {
    write(state, 0);
    return;
  }
  wake(state);
}

/**
 * 冲量：直接给速度，不改目标。用来做「被点名时弹一下」——
 * 比设一个临时目标再设回来自然得多，也不会和别的目标打架。
 */
export function impulse(element, { lift = 0, scale = 0, rot = 0 } = {}) {
  if (!motionEnabled) return;
  const state = springFor(element);
  if (!state) return;
  state.lift.velocity += lift;
  state.scale.velocity += scale;
  state.rot.velocity += rot;
  wake(state);
}

/** 把元素恢复到静止姿态并停掉浮动（比如牌被选中前后复位）。 */
export function springReset(element) {
  const state = states.get(element);
  if (!state) return;
  springTo(element, { lift: 0, scale: 1, rx: 0, ry: 0, rot: 0 });
}

/**
 * 卡片手感：常驻微浮 + 指针跟随的 3D 倾斜 + 抬起。
 * 这是小丑牌卡面最直观的一条——卡会朝你的指针歪过去。
 */
export function attachCardMotion(element, { float = 2.4, hoverLift = 10, tilt = 9, depth = 620 } = {}) {
  if (!element || element.dataset.sprungCard === '1') return;
  element.dataset.sprungCard = '1';
  springFor(element, { float, depth });

  if (!matchMedia('(hover:hover)').matches) return;

  element.addEventListener('pointermove', (event) => {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const nx = (event.clientX - rect.left) / rect.width - 0.5;
    const ny = (event.clientY - rect.top) / rect.height - 0.5;
    springTo(element, {
      ry: nx * tilt * 2,
      rx: -ny * tilt * 1.4,
      lift: hoverLift,
      scale: 1.04,
    });
  });
  element.addEventListener('pointerleave', () => {
    springTo(element, { rx: 0, ry: 0, lift: 0, scale: 1 });
  });
  element.addEventListener('pointerdown', () => {
    springTo(element, { lift: hoverLift - 6, scale: 0.98 });
  });
  element.addEventListener('focus', () => springTo(element, { lift: hoverLift, scale: 1.04 }));
  element.addEventListener('blur', () => springTo(element, { lift: 0, scale: 1, rx: 0, ry: 0 }));
}

/**
 * 手牌手感：hover 抬起、选中抬更高并轻微歪一下。
 * 牌不做常驻浮动——14 张一起浮会晃得人眼晕。
 */
export function attachTileMotion(element, { selected = false } = {}) {
  if (!element) return;
  const restLift = selected ? 20 : 0;
  const restRot = selected ? -2.5 : 0;
  springFor(element, { depth: 520 });
  springTo(element, { lift: restLift, rot: restRot, scale: selected ? 1.06 : 1 });

  if (element.dataset.sprungTile === '1') return;
  element.dataset.sprungTile = '1';
  if (!matchMedia('(hover:hover)').matches) return;

  element.addEventListener('pointerenter', () => {
    const base = element.classList.contains('sel') ? 20 : 0;
    springTo(element, { lift: base + 9, scale: 1.07 });
  });
  element.addEventListener('pointerleave', () => {
    const isSelected = element.classList.contains('sel');
    springTo(element, {
      lift: isSelected ? 20 : 0,
      rot: isSelected ? -2.5 : 0,
      scale: isSelected ? 1.06 : 1,
    });
  });
}

/** 设置里关掉动画时，弹簧也要停。 */
export function setSpringMotion(on) {
  motionEnabled = Boolean(on) && !REDUCED;
  if (motionEnabled) return;
  for (const state of active) {
    for (const key of ['lift', 'scale', 'rx', 'ry', 'rot']) {
      state[key].value = state[key].target;
      state[key].velocity = 0;
    }
    write(state, 0);
  }
  active.clear();
  if (frame) cancelAnimationFrame(frame);
  frame = null;
}

export const SPRING_REDUCED = REDUCED;
