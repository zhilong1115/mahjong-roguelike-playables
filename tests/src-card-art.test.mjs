import assert from 'node:assert/strict';
import { access, stat } from 'node:fs/promises';
import test from 'node:test';

import { listContentItems } from '../src/content/library.mjs';
import { CARD_ART_COUNTS, resolveCardArtwork } from '../src/render/card-art.mjs';

test('现行灵签与福将都有稳定且不重复的图谱位置', () => {
  for (const family of ['charm', 'general']) {
    const items = listContentItems(family).filter((item) => item.resolution !== 'reserve');
    const resolved = items.map((item) => resolveCardArtwork(family, item.id));
    assert.equal(items.length, CARD_ART_COUNTS[family]);
    assert.ok(resolved.every((art) => art.found));
    assert.equal(new Set(resolved.map((art) => art.index)).size, items.length);
  }
});

test('三张主动锦囊使用独立代码绘制物件，不占用旧灵签图谱格', () => {
  const satchels = listContentItems('charm').filter((item) => item.resolution === 'reserve');
  assert.equal(satchels.length, CARD_ART_COUNTS.satchel);
  assert.deepEqual(satchels.map((item) => item.id), ['extraRounds', 'washWall', 'turnStone']);
  assert.ok(satchels.every((item) => resolveCardArtwork('charm', item.id).found === false));
});

test('两张离线 WebP 图谱存在且总计低于 600 KB', async () => {
  const paths = [
    new URL('../src/assets/art/charm-atlas-v1.webp', import.meta.url),
    new URL('../src/assets/art/general-atlas-v1.webp', import.meta.url),
  ];
  await Promise.all(paths.map((path) => access(path)));
  const sizes = await Promise.all(paths.map((path) => stat(path).then((entry) => entry.size)));
  assert.ok(sizes.reduce((sum, size) => sum + size, 0) < 600 * 1024);
});

test('两张水墨背景离线存在且总计低于 900 KB', async () => {
  const paths = [
    new URL('../src/assets/art/ink-table-v1.webp', import.meta.url),
    new URL('../src/assets/art/ink-title-v1.webp', import.meta.url),
  ];
  await Promise.all(paths.map((path) => access(path)));
  const sizes = await Promise.all(paths.map((path) => stat(path).then((entry) => entry.size)));
  assert.ok(sizes.reduce((sum, size) => sum + size, 0) < 900 * 1024);
});
