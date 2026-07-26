export class WebPlatformAdapter {
  loadState(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  saveState(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  removeState(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Storage is an optional platform capability for this demo.
    }
  }

  haptic(pattern = 10) {
    window.navigator?.vibrate?.(pattern);
  }
}
