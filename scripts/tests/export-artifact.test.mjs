/**
 * `scripts/lib/export-artifact.mjs` 的产物判定回归（审计 08 · R-07-01）。
 *
 * 为什么需要：e2e 的导出断言必须证明「产物里画了什么」。本测试用**已知内容**的合成
 * PNG / SVG / PDF 固定判定函数的正反两面——尤其要钉住「空白产物不得判通过」，
 * 避免判定器自己假绿（只回布尔、把白底当内容、把完成文案当产物）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PNG } from 'pngjs';

import {
  decodeArtifactPayload,
  inspectPdf,
  inspectPng,
  inspectSvg,
  pdfHasFillColor,
} from '../lib/export-artifact.mjs';

/** 造一张纯色 PNG（可叠加一个实心矩形；颜色为 [r,g,b,a]）。 */
function makePng({ width, height, background, rect = null }) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      png.data[at] = background[0];
      png.data[at + 1] = background[1];
      png.data[at + 2] = background[2];
      png.data[at + 3] = background[3];
    }
  }
  if (rect !== null) {
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        const at = (y * width + x) * 4;
        png.data[at] = rect.color[0];
        png.data[at + 1] = rect.color[1];
        png.data[at + 2] = rect.color[2];
        png.data[at + 3] = rect.color[3];
      }
    }
  }
  return PNG.sync.write(png);
}

/** 造一个最小可用 PDF（结构与 daemon 简化渲染器同形；判定只读结构/内容流）。 */
function makePdf({ width, height, commands }) {
  const content = `${commands.join('\n')}\n`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> /Contents 4 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}endstream\nendobj\n`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += object;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

const WHITE = [255, 255, 255, 255];
const RED = [255, 0, 0, 255];

test('PNG：背景 + 预期矩形 → 通过；空白产物 → 如实失败', () => {
  const expected = {
    width: 40,
    height: 30,
    background: '#FFFFFF',
    shapes: [{ x: 5, y: 5, width: 10, height: 8, color: '#FF0000' }],
  };
  const good = inspectPng(
    makePng({
      width: 40,
      height: 30,
      background: WHITE,
      rect: { x: 5, y: 5, width: 10, height: 8, color: RED },
    }),
    expected,
  );
  assert.equal(good.ok, true, good.problems.join('; '));
  assert.equal(good.width, 40);
  assert.equal(good.height, 30);
  assert.equal(good.backgroundMatches, true);
  assert.equal(good.shapes[0].match, true);
  assert.ok(
    good.nonBackgroundPixels >= 80,
    `nonBackgroundPixels=${String(good.nonBackgroundPixels)}`,
  );

  const blank = inspectPng(makePng({ width: 40, height: 30, background: WHITE }), expected);
  assert.equal(blank.ok, false);
  assert.equal(blank.shapes[0].match, false);
  assert.equal(blank.nonBackgroundPixels, 0);
  assert.match(blank.problems.join('; '), /内容|矩形|背景/);
});

test('PNG：尺寸不符 → 失败（尺寸不是内容判定的替代品）', () => {
  const result = inspectPng(makePng({ width: 20, height: 10, background: WHITE }), {
    width: 40,
    height: 30,
  });
  assert.equal(result.ok, false);
  assert.match(result.problems.join('; '), /尺寸/);
});

test('PNG：白底 vs 页面底色 #F5F5F5 → 判为背景未生效（容差 3，不能放过 10 的差）', () => {
  const result = inspectPng(makePng({ width: 40, height: 30, background: WHITE }), {
    width: 40,
    height: 30,
    background: '#F5F5F5',
  });
  assert.equal(result.backgroundMatches, false);
  assert.match(result.problems.join('; '), /背景未生效/);
});

test('SVG：背景 + 节点 → 通过；只有背景 → 失败', () => {
  const expected = {
    width: 40,
    height: 30,
    background: '#F5F5F5',
    shapes: [{ width: 10, height: 8, color: '#FF0000' }],
  };
  const good = inspectSvg(
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30">',
      '<rect x="0" y="0" width="40" height="30" fill="#F5F5F5"/>',
      '<rect x="5" y="5" width="10" height="8" fill="#FF0000"/>',
      '</svg>',
    ].join('\n'),
    expected,
  );
  assert.equal(good.ok, true, good.problems.join('; '));
  assert.equal(good.rectCount, 2);
  assert.equal(good.backgroundMatches, true);
  assert.equal(good.shapes[0].match, true);

  const blank = inspectSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect x="0" y="0" width="40" height="30" fill="#FFFFFF"/></svg>',
    expected,
  );
  assert.equal(blank.ok, false);
  assert.equal(blank.shapes[0].match, false);
  assert.match(blank.problems.join('; '), /节点|矩形|背景/);
});

test('PDF：页尺寸/内容流填充色 → 通过；只有背景 → 失败', () => {
  const goodBytes = makePdf({
    width: 40,
    height: 30,
    commands: ['1 1 1 rg', '0 0 40 30 re f', '1 0 0 rg', '5 5 10 8 re f'],
  });
  const good = inspectPdf(goodBytes);
  assert.equal(good.isPdf, true);
  assert.equal(good.pageCount, 1);
  assert.deepEqual(good.mediaBox, { width: 40, height: 30 });
  assert.equal(pdfHasFillColor(good, '#FF0000'), true);

  const blank = inspectPdf(
    makePdf({ width: 40, height: 30, commands: ['1 1 1 rg', '0 0 40 30 re f'] }),
  );
  assert.equal(blank.isPdf, true);
  assert.equal(pdfHasFillColor(blank, '#FF0000'), false);
});

test('导出响应信封：base64 / length / sha256 自洽；失败信封 → null', () => {
  const png = makePng({ width: 2, height: 2, background: WHITE });
  const artifact = {
    format: 'png',
    mimeType: 'image/png',
    fileName: 'doc-page-1.png',
    length: png.length,
    sha256: 'placeholder',
    base64: png.toString('base64'),
  };
  const decoded = decodeArtifactPayload({ ok: true, result: { artifact } });
  assert.notEqual(decoded, null);
  assert.equal(decoded.format, 'png');
  assert.equal(decoded.bytes.length, png.length);
  assert.equal(decoded.lengthMatches, true);

  assert.equal(decodeArtifactPayload({ ok: false, error: { code: 'x' } }), null);
  assert.equal(decodeArtifactPayload({ ok: true, result: {} }), null);
});
