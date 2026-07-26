/**
 * 平台适配层占位实现。核心游戏只调用这些方法，
 * 上架 YouTube Playables / TikTok 时替换成对应 SDK 实现。
 */
export function createWebAdapter() {
  const listeners = new Set();

  document.addEventListener('visibilitychange', () => {
    const event = document.visibilityState === 'visible' ? 'resume' : 'pause';
    for (const listener of listeners) listener(event);
  });

  return {
    name: 'web',
    ready() {
      document.documentElement.dataset.platform = 'web';
    },
    onLifecycle(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** 本地 Demo 不做持久化，正式版由平台存档接口替换。 */
    async save() {
      return false;
    },
    async load() {
      return null;
    },
    haptic() {
      if (navigator.vibrate) navigator.vibrate(10);
    },
  };
}
