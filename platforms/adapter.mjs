/**
 * 平台适配层。核心游戏只依赖这个接口，YouTube / TikTok 各写一个实现。
 *
 * @typedef {object} PlatformAdapter
 * @property {string} name
 * @property {() => Promise<void>} initialize
 * @property {() => void} signalFirstFrame
 * @property {() => void} signalReady
 * @property {() => Promise<object|null>} loadSave
 * @property {(data: object) => Promise<boolean>} save
 * @property {(score: number) => Promise<void>} submitScore
 * @property {() => boolean} isAudioEnabled
 * @property {(handler: (event: 'pause'|'resume'|'audio', payload?: unknown) => void) => () => void} onLifecycle
 * @property {(pattern?: number) => void} haptic
 */

import { createLocalStorage } from '../state/save.mjs';

/** @returns {PlatformAdapter} */
export function createWebAdapter({ storage = createLocalStorage() } = {}) {
  const listeners = new Set();
  const notify = (event, payload) => {
    for (const listener of listeners) listener(event, payload);
  };

  return {
    name: 'web',

    async initialize() {
      document.documentElement.dataset.platform = 'web';
      document.addEventListener('visibilitychange', () => {
        notify(document.visibilityState === 'visible' ? 'resume' : 'pause');
      });
    },

    signalFirstFrame() {
      document.documentElement.dataset.firstFrame = '1';
    },

    signalReady() {
      document.documentElement.dataset.ready = '1';
    },

    loadSave: () => storage.load(),
    save: (data) => storage.save(data),

    async submitScore() {
      // 本地版本不上传成绩；平台实现里替换成 SDK 调用。
    },

    isAudioEnabled: () => true,

    onLifecycle(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },

    haptic(pattern = 10) {
      navigator.vibrate?.(pattern);
    },
  };
}
