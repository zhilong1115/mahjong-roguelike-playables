/**
 * 动画层：结算时逐条播放 scoring steps，做出「牌值一格格往上跳」的爆分节奏。
 *
 * 三条硬规则：
 * 1. 玩家随时可以点一下快进，剩下的步骤立刻收敛（Playable 的节奏不能被动画绑架）。
 * 2. `prefers-reduced-motion` 下所有时长归零，逻辑结果完全一致。
 * 3. 动画只读状态、不改状态；分数由 core/scoring 算好，这里只负责表演。
 */

const REDUCED = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Timeline {
  constructor() {
    this.skipped = false;
    this.running = false;
    /** 1 = 正常，2 = 快，Infinity = 关掉动画 */
    this.speed = 1;
  }

  begin() {
    this.skipped = false;
    this.running = true;
  }

  end() {
    this.running = false;
    this.skipped = false;
  }

  /** 玩家点击 / 空格：把剩下的步骤快进完。 */
  skip() {
    if (this.running) this.skipped = true;
  }

  wait(ms) {
    const scaled = ms / (this.speed || 1);
    if (REDUCED || this.skipped || !Number.isFinite(scaled) || scaled <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, scaled));
  }
}

/** 给元素加一个一次性动画 class，动画结束后自动移除。 */
export function pulse(element, className, duration = 320) {
  if (!element || REDUCED) return;
  element.classList.remove(className);
  // 强制重排，保证同一个 class 能连续触发
  void element.offsetWidth;
  element.classList.add(className);
  setTimeout(() => element.classList.remove(className), duration);
}

/**
 * 飘字。chips 蓝、mult 红、gold 金。
 * @param {Element|null} anchor
 */
export function floatText(anchor, text, tone = 'chips', layer = document.body) {
  if (!anchor || REDUCED) return;
  const rect = anchor.getBoundingClientRect();
  const node = document.createElement('div');
  node.className = `floatText tone-${tone}`;
  node.textContent = text;
  node.style.left = `${rect.left + rect.width / 2}px`;
  node.style.top = `${rect.top + rect.height * 0.2}px`;
  layer.appendChild(node);
  setTimeout(() => node.remove(), 900);
}

/** 数字滚动。回调里自己决定怎么写入 DOM。 */
export function countUp(from, to, duration, onFrame) {
  if (REDUCED || duration <= 0 || from === to) {
    onFrame(to);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let done = false;
    // 后台标签页里 rAF 会被冻结，必须有超时兜底，否则结算会永远卡住
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      onFrame(to);
      resolve();
    };
    const guard = setTimeout(finish, duration + 400);
    const start = performance.now();
    const tick = (now) => {
      if (done) return;
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      onFrame(Math.round(from + (to - from) * eased));
      if (progress < 1) requestAnimationFrame(tick);
      else finish();
    };
    requestAnimationFrame(tick);
  });
}

/** 屏幕震动，强度按分数量级。 */
export function shake(element, intensity = 1) {
  if (!element || REDUCED) return;
  const clamped = Math.max(0.4, Math.min(3, intensity));
  element.style.setProperty('--shake', `${clamped * 3}px`);
  pulse(element, 'shaking', 260 + clamped * 40);
}

/** 一串元素依次入场。 */
export async function stagger(elements, className, gap, timeline) {
  for (const element of elements) {
    pulse(element, className);
    await timeline.wait(gap);
  }
}

export const MOTION_REDUCED = REDUCED;
