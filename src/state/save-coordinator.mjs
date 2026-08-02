/**
 * 存档调度器：普通状态防抖，关键状态立即入队。
 *
 * 所有真正的 `save` 调用严格串行，因此旧请求不可能在新请求之后
 * 才完成并把新存档覆盖回旧状态。一次保存失败也不会阻断后续队列。
 */
export function createSaveCoordinator({
  save,
  debounceMs = 400,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  if (typeof save !== 'function') throw new TypeError('save coordinator requires a save function');

  let debounceTimer = null;
  let scheduledSnapshot = null;
  let queue = Promise.resolve();

  const enqueue = (snapshot) => {
    const task = queue
      .then(() => save(snapshot))
      .catch(() => false);
    // task 已把失败收敛为 false；仍显式转成 void 队尾，避免调用方
    // 忽略返回 Promise 时产生 unhandled rejection。
    queue = task.then(() => undefined, () => undefined);
    return task;
  };

  const cancelScheduled = () => {
    if (debounceTimer !== null) clearTimer(debounceTimer);
    debounceTimer = null;
    scheduledSnapshot = null;
  };

  const schedule = (snapshot) => {
    if (debounceTimer !== null) clearTimer(debounceTimer);
    scheduledSnapshot = snapshot;
    debounceTimer = setTimer(() => {
      debounceTimer = null;
      const next = scheduledSnapshot;
      scheduledSnapshot = null;
      void enqueue(next);
    }, debounceMs);
  };

  const flush = (snapshot) => {
    cancelScheduled();
    return enqueue(snapshot);
  };

  return Object.freeze({
    schedule,
    flush,
    cancelScheduled,
    /** 只等待已入队的保存；尚在防抖窗口内的快照不包含在内。 */
    whenIdle: () => queue,
  });
}
