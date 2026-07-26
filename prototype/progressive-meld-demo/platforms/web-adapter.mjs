export class WebPlatformAdapter {
  async initialize() {}
  signalFirstFrame() {}
  signalReady() {}
  async loadSave() { return null; }
  async save() {}
  async submitScore() {}
  async getLanguage() { return navigator.language || 'zh-CN'; }
  async isAudioEnabled() { return true; }
  onAudioChange() { return () => {}; }
  onPause(callback) {
    const handler = () => {
      if (document.visibilityState === 'hidden') callback();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }
  onResume(callback) {
    const handler = () => {
      if (document.visibilityState === 'visible') callback();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }
}
