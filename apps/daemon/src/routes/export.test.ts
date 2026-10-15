import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';
import type { TestDaemon } from '../testing/harness.ts';
import { createTestDaemon, injectJson } from '../testing/harness.ts';

/** 页面夹具：白底 + 一个红色矩形 + 一个蓝色椭圆。 */
const PAGE_BODY = {
  width: 200,
  height: 100,
  background: '#FFFFFF',
  children: [
    { kind: 'rect', x: 10, y: 10, width: 40, height: 30, fill: '#FF0000' },
    { kind: 'ellipse', x: 100, y: 20, width: 40, height: 40, fill: '#0000FF' },
  ],
};

async function seedDocument(daemon: TestDaemon): Promise<string> {
  const created = await injectJson(daemon.app, {
    method: 'POST',
    url: '/documents',
    payload: { name: '导出源' },
  });
  const id = (created.payload as { result: { document: { id: string } } }).result.document.id;
  const saved = await injectJson(daemon.app, {
    method: 'PUT',
    url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
    payload: { body: PAGE_BODY },
  });
  expect(saved.statusCode).toBe(200);
  return id;
}

interface DecodedPng {
  width: number;
  height: number;
  pixel(x: number, y: number): [number, number, number, number];
}

/** 解码测试用 PNG（我们编码时固定 filter=0，故按行去前缀字节即可读像素）。 */
function decodePng(bytes: Buffer): DecodedPng {
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  const chunks: { type: string; data: Buffer }[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
  }
  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR');
  expect(ihdr).toBeDefined();
  if (ihdr === undefined) throw new Error('unreachable');
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const idat = Buffer.concat(
    chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data),
  );
  const raw = inflateSync(idat);
  const stride = width * 4;
  return {
    width,
    height,
    pixel(x: number, y: number): [number, number, number, number] {
      const rowStart = y * (stride + 1);
      expect(raw[rowStart]).toBe(0);
      const start = rowStart + 1 + x * 4;
      return [raw[start] ?? -1, raw[start + 1] ?? -1, raw[start + 2] ?? -1, raw[start + 3] ?? -1];
    },
  };
}

describe('export · 三格式产物', () => {
  it('SVG：矢量文本含背景与矩形/椭圆；sha256 与 base64 自洽', async () => {
    const daemon = await createTestDaemon();
    try {
      const documentId = await seedDocument(daemon);
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/export',
        payload: { documentId, pageId: 'page-1', format: 'svg' },
      });
      expect(statusCode).toBe(200);
      const result = (
        payload as {
          result: {
            artifact: {
              base64: string;
              sha256: string;
              length: number;
              fileName: string;
              mimeType: string;
              filePath: string;
            };
          };
        }
      ).result;
      const artifact = result.artifact;
      const bytes = Buffer.from(artifact.base64, 'base64');
      expect(bytes.length).toBe(artifact.length);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
      const text = bytes.toString('utf8');
      expect(text).toContain('<svg');
      expect(text).toContain('width="200" height="100"');
      expect(text).toContain('fill="#FF0000"');
      expect(text).toContain('<ellipse');
      expect(text).toContain('fill="#0000FF"');
      expect(artifact.mimeType).toBe('image/svg+xml');
      expect(artifact.fileName).toBe(`${documentId}-page-1.svg`);
      expect((await import('node:fs/promises')).stat(artifact.filePath)).toBeDefined();
    } finally {
      await daemon.cleanup();
    }
  });

  it('PNG：真 PNG 解码（尺寸与像素颜色断言；scale=2 生效）', async () => {
    const daemon = await createTestDaemon();
    try {
      const documentId = await seedDocument(daemon);
      const { payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/export',
        payload: { documentId, pageId: 'page-1', format: 'png', scale: 2 },
      });
      const artifact = (payload as { result: { artifact: { base64: string } } }).result.artifact;
      const png = decodePng(Buffer.from(artifact.base64, 'base64'));
      expect(png.width).toBe(400);
      expect(png.height).toBe(200);
      // 背景白（右下角远处）
      expect(png.pixel(390, 190)).toEqual([255, 255, 255, 255]);
      // 红色矩形内部（原坐标 10–50 × 10–40 → scale2: 20–100 × 20–80）
      expect(png.pixel(60, 50)).toEqual([255, 0, 0, 255]);
      // 蓝色椭圆中心（原 100–140 × 20–60 → 中心 240,80）
      expect(png.pixel(240, 80)).toEqual([0, 0, 255, 255]);
      // 椭圆外（同一包围盒的角落在椭圆之外）仍是背景
      expect(png.pixel(202, 42)).toEqual([255, 255, 255, 255]);
    } finally {
      await daemon.cleanup();
    }
  });

  it('PDF：最小合法文档（版本头、MediaBox 尺寸、填充操作符、EOF）', async () => {
    const daemon = await createTestDaemon();
    try {
      const documentId = await seedDocument(daemon);
      const { payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/export',
        payload: { documentId, pageId: 'page-1', format: 'pdf' },
      });
      const artifact = (payload as { result: { artifact: { base64: string; mimeType: string } } })
        .result.artifact;
      const text = Buffer.from(artifact.base64, 'base64').toString('utf8');
      expect(text.startsWith('%PDF-1.4')).toBe(true);
      expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
      expect(text).toContain('/MediaBox [0 0 200 100]');
      expect(text).toContain('1 0 0 rg');
      expect(text).toContain('10 60 40 30 re f');
      expect(text).toContain('xref');
      expect(artifact.mimeType).toBe('application/pdf');
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('export · 失败态', () => {
  it('不支持的格式 → 400 export_unsupported_format', async () => {
    const daemon = await createTestDaemon();
    try {
      const documentId = await seedDocument(daemon);
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/export',
        payload: { documentId, pageId: 'page-1', format: 'jpg' },
      });
      expect(statusCode).toBe(400);
      expect((payload as { error: { code: string } }).error.code).toBe('export_unsupported_format');
    } finally {
      await daemon.cleanup();
    }
  });

  it('页面不存在 → 404 export_page_not_found；文档不存在 → 404 doc_not_found', async () => {
    const daemon = await createTestDaemon();
    try {
      const documentId = await seedDocument(daemon);
      const missingPage = await injectJson(daemon.app, {
        method: 'POST',
        url: '/export',
        payload: { documentId, pageId: 'page-9', format: 'png' },
      });
      expect(missingPage.statusCode).toBe(404);
      expect((missingPage.payload as { error: { code: string } }).error.code).toBe(
        'export_page_not_found',
      );

      const missingDoc = await injectJson(daemon.app, {
        method: 'POST',
        url: '/export',
        payload: { documentId: '不存在', pageId: 'page-1', format: 'png' },
      });
      expect(missingDoc.statusCode).toBe(404);
      expect((missingDoc.payload as { error: { code: string } }).error.code).toBe('doc_not_found');
    } finally {
      await daemon.cleanup();
    }
  });
});
