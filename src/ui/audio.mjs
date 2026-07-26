/**
 * 音效：全部用 WebAudio 现场合成，不打包任何音频文件。
 * 平台静音开关通过 setEnabled 控制。
 */

let context = null;
let enabled = true;

function ensureContext() {
  if (!enabled) return null;
  if (!context) {
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  if (context.state === 'suspended') context.resume().catch(() => {});
  return context;
}

function beep(frequency, duration = 0.06, type = 'square', volume = 0.05) {
  const audio = ensureContext();
  if (!audio) return;
  try {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.value = volume;
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
    oscillator.stop(audio.currentTime + duration + 0.02);
  } catch {
    /* 静音环境忽略 */
  }
}

export const sfx = {
  select: () => beep(720, 0.04),
  deal: () => beep(320, 0.05, 'triangle', 0.04),
  swap: () => beep(430, 0.07),
  reveal: () => { beep(560, 0.07); setTimeout(() => beep(780, 0.09), 70); },
  charm: () => { beep(880, 0.06); setTimeout(() => beep(1180, 0.09), 60); },
  /** 结算时一步比一步高的「加码」声。 */
  chip: (index = 0) => beep(420 + Math.min(index, 14) * 42, 0.06, 'square', 0.045),
  mult: (index = 0) => beep(300 + Math.min(index, 10) * 55, 0.09, 'triangle', 0.06),
  coin: () => { beep(1046, 0.05); setTimeout(() => beep(1318, 0.07), 45); },
  hu: () => { beep(523, 0.1); setTimeout(() => beep(659, 0.1), 90); setTimeout(() => beep(784, 0.2), 180); },
  bad: () => { beep(180, 0.18, 'sawtooth', 0.05); setTimeout(() => beep(120, 0.3, 'sawtooth', 0.05), 140); },
};

export function setAudioEnabled(next) {
  enabled = Boolean(next);
  if (!enabled && context) context.suspend().catch(() => {});
}

export function isAudioEnabled() {
  return enabled;
}
