/**
 * scripts/lib/pixels.mjs 自测：差异包围盒（`diff.bbox`）的辨别力。
 *
 * 为什么用真实 pixelmatch 产物：包围盒的判据（哪些像素算「差异」）必须与比对库的实际
 * 涂色行为一致，而不是与我们对库行为的想象一致——夹具直接跑 pixelmatch + pngjs。
 *
 * 用法：`node scripts/tests/bbox-of-diff.test.mjs`（node:test；退出码 0 全过 / 1 有失败）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import { bboxOfDiff } from '../lib/pixels.mjs';

/** 造一张纯色图，并在给定矩形里涂另一个颜色。 */
function makePng(width, height, background, patch) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const [r, g, b] = patch !== undefined && inRect(x, y, patch) ? patch.color : background;
      png.data[index] = r;
      png.data[index + 1] = g;
      png.data[index + 2] = b;
      png.data[index + 3] = 255;
    }
  }
  return png;
}

function inRect(x, y, { x: rx, y: ry, width: rw, height: rh }) {
  return x >= rx && x < rx + rw && y >= ry && y < ry + rh;
}

/** 逐像素比对，返回 pixelmatch 的差异图。 */
function diffOf(refPng, actualPng) {
  const diffPng = new PNG({ width: refPng.width, height: refPng.height });
  pixelmatch(refPng.data, actualPng.data, diffPng.data, refPng.width, refPng.height, {
    threshold: 0.1,
    includeAA: false,
  });
  return diffPng;
}

test('有差异：包围盒精确覆盖差异矩形（含边界像素）', () => {
  const ref = makePng(20, 12, [255, 255, 255]);
  const patch = { x: 4, y: 3, width: 6, height: 4, color: [0, 0, 0] };
  const actual = makePng(20, 12, [255, 255, 255], patch);
  const diffPng = diffOf(ref, actual);
  assert.deepEqual(bboxOfDiff(diffPng), { x: 4, y: 3, width: 6, height: 4 });
});

test('无差异：返回 null（不得给零宽包围盒或全图包围盒）', () => {
  const ref = makePng(8, 8, [200, 200, 200]);
  const actual = makePng(8, 8, [200, 200, 200]);
  assert.equal(bboxOfDiff(diffOf(ref, actual)), null);
});

test('两处分离差异：包围盒取并集（x/y/宽高同时覆盖两处）', () => {
  const ref = makePng(20, 10, [255, 255, 255]);
  const actual = makePng(20, 10, [255, 255, 255], {
    x: 1,
    y: 1,
    width: 2,
    height: 2,
    color: [0, 0, 0],
  });
  // 再涂第二处（右上角）
  for (let y = 6; y < 9; y += 1) {
    for (let x = 15; x < 19; x += 1) {
      const index = (y * 20 + x) * 4;
      actual.data[index] = 0;
      actual.data[index + 1] = 0;
      actual.data[index + 2] = 0;
    }
  }
  const bbox = bboxOfDiff(diffOf(ref, actual));
  assert.deepEqual(bbox, { x: 1, y: 1, width: 18, height: 8 });
});

test('差异在右上角：x/y 不为 0 时坐标不被截断（抓「恒 null/恒全图」的假绿）', () => {
  const ref = makePng(16, 16, [255, 255, 255]);
  const patch = { x: 12, y: 0, width: 4, height: 3, color: [255, 0, 0] };
  const actual = makePng(16, 16, [255, 255, 255], patch);
  assert.deepEqual(bboxOfDiff(diffOf(ref, actual)), { x: 12, y: 0, width: 4, height: 3 });
});

test('单像素差异：宽高为 1（退化边界）', () => {
  const ref = makePng(6, 6, [255, 255, 255]);
  const actual = makePng(6, 6, [255, 255, 255], {
    x: 5,
    y: 5,
    width: 1,
    height: 1,
    color: [0, 0, 0],
  });
  assert.deepEqual(bboxOfDiff(diffOf(ref, actual)), { x: 5, y: 5, width: 1, height: 1 });
});
