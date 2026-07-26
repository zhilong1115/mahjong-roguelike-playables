import assert from 'node:assert/strict';
import test from 'node:test';

import { createSaveCoordinator } from '../src/state/save-coordinator.mjs';

const nextMicrotask = () => new Promise((resolve) => queueMicrotask(resolve));

test('立即存档严格串行，旧请求完成前不会发起新请求', async () => {
  const calls = [];
  const pending = [];
  let active = 0;
  let maxActive = 0;
  const coordinator = createSaveCoordinator({
    save(snapshot) {
      calls.push(snapshot.version);
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise((resolve) => pending.push((result) => {
        active -= 1;
        resolve(result);
      }));
    },
  });

  const first = coordinator.flush({ version: 1 });
  await nextMicrotask();
  const second = coordinator.flush({ version: 2 });
  await nextMicrotask();

  assert.deepEqual(calls, [1], '第二个 adapter.save 必须等第一个完成');
  pending.shift()(true);
  assert.equal(await first, true);
  await nextMicrotask();
  assert.deepEqual(calls, [1, 2]);

  pending.shift()(true);
  assert.equal(await second, true);
  await coordinator.whenIdle();
  assert.equal(maxActive, 1);
});

test('前一次存档失败不会堵死后续最新快照', async () => {
  const calls = [];
  const coordinator = createSaveCoordinator({
    async save(snapshot) {
      calls.push(snapshot.version);
      if (snapshot.version === 1) throw new Error('temporary platform failure');
      return true;
    },
  });

  const first = coordinator.flush({ version: 1 });
  const second = coordinator.flush({ version: 2 });
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.deepEqual(calls, [1, 2]);
});

test('普通存档保留防抖，立即存档会取消尚未入队的旧快照', async () => {
  const timers = new Map();
  const calls = [];
  let timerId = 0;
  const coordinator = createSaveCoordinator({
    save: async (snapshot) => {
      calls.push(snapshot.version);
      return true;
    },
    debounceMs: 400,
    setTimer(handler, delay) {
      const id = ++timerId;
      timers.set(id, { handler, delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
  });

  coordinator.schedule({ version: 1 });
  coordinator.schedule({ version: 2 });
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 400);

  const [{ handler }] = timers.values();
  timers.clear();
  handler();
  await coordinator.whenIdle();
  assert.deepEqual(calls, [2], '防抖只保存最后一份普通快照');

  coordinator.schedule({ version: 3 });
  const immediate = coordinator.flush({ version: 4 });
  assert.equal(timers.size, 0, '关键快照应取消未触发的普通保存');
  assert.equal(await immediate, true);
  assert.deepEqual(calls, [2, 4]);
});
