import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTENT_COUNTS,
  CONTENT_LIBRARY,
  FAMILY_ORDER,
  getItem,
  listItems,
  pickContentItem,
  validateContentLibrary,
} from '../src/content/index.mjs';

test('统一 Library 收录现行 41 张五系功能卡', () => {
  assert.deepEqual(CONTENT_COUNTS, {
    charm: 22,
    codex: 3,
    general: 11,
    bone: 2,
    seal: 3,
  });
  assert.equal(CONTENT_LIBRARY.filter((item) => item.enabled).length, 41);
  assert.deepEqual(validateContentLibrary(), []);
});

test('五系查询全部读取同一 Library 对象', () => {
  for (const family of FAMILY_ORDER) {
    const items = listItems(family);
    assert.equal(items.length, CONTENT_COUNTS[family]);
    for (const item of items) {
      assert.equal(getItem(family, item.id), item);
      assert.equal(item.family, family);
      assert.equal(item.enabled, true);
      assert.equal(item.status, 'test');
      assert.ok(Object.isFrozen(item));
    }
  }
});

test('Library 校验会拦住重复 id 和未登记效果', () => {
  const base = CONTENT_LIBRARY[0];
  const broken = [
    base,
    {
      ...base,
      effects: [{ kind: 'notRegistered', value: 1 }],
    },
  ];
  const errors = validateContentLibrary(broken);
  assert.ok(errors.some((error) => error.includes('重复')));
  assert.ok(errors.some((error) => error.includes('未登记效果')));
});

test('Library weight 可以调整抽取，同权时保持均匀路径', () => {
  const equal = [{ id: 'a', weight: 100 }, { id: 'b', weight: 100 }];
  assert.equal(pickContentItem({ int: () => 1 }, equal).id, 'b');

  const weighted = [{ id: 'rare', weight: 1 }, { id: 'common', weight: 99 }];
  assert.equal(pickContentItem({ next: () => 0.5 }, weighted).id, 'common');
  assert.equal(pickContentItem({ next: () => 0 }, weighted).id, 'rare');
});
