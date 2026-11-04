import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
      // tp1-fix 评审发现⑥（Pre-existing 顺手修）：原 `expect((await import(...)).stat(...))
      // .toBeDefined()` 未 await——断言的是 Promise 对象本身，恒真。改为真等 stat：
      // 产物文件必须真实落盘且非空。
      const artifactStat = await stat(artifact.filePath);
      expect(artifactStat.isFile()).toBe(true);
      expect(artifactStat.size).toBeGreaterThan(0);
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

describe('export · 产物路径安全（TC-EXP-06 · documents.security 先例扩展到 export 路由）', () => {
  // 导出链的特化面：产物文件名派生自 documentId/pageId（`<id>-<pageId>.<format>`），
  // 落盘前经 resolveWithin 二次把关（export.ts）。本块钉：恶意 id 读页前置即拒
  // （400 doc_invalid_id，不回显原始 id / 不泄漏目录布局）、伪造 manifest 页 id 整体
  // 拒绝（422 doc_invalid_manifest）、合法 id（含中文）产物只落 exports/ 内、
  // 树外哨兵文件零改动。注：POST /export 的 id 走 JSON body（无 URL 解码层），
  // 攻击形态即解码后的原串（'../victim' / NUL / 控制字符）。

  /** 树外哨兵：workspace 之外的 victim.dfg（穿越直接目标）与 outside/leak.json（深层目标）。 */
  async function plantSentinels(daemon: TestDaemon): Promise<void> {
    await mkdir(join(daemon.tempDir, 'victim.dfg', 'pages'), { recursive: true });
    await writeFile(
      join(daemon.tempDir, 'victim.dfg', 'pages', 'page-1.json'),
      '{"secret":"victim-body"}\n',
    );
    await mkdir(join(daemon.tempDir, 'outside'), { recursive: true });
    await writeFile(join(daemon.tempDir, 'outside', 'leak.json'), '{"secret":"leak"}\n');
  }

  async function sentinelSnapshot(daemon: TestDaemon): Promise<string> {
    return Promise.all([
      readFile(join(daemon.tempDir, 'victim.dfg', 'pages', 'page-1.json'), 'utf8'),
      readFile(join(daemon.tempDir, 'outside', 'leak.json'), 'utf8'),
    ]).then(([victim, leak]) => `${victim}|${leak}`);
  }

  async function seedNamed(daemon: TestDaemon, name: string): Promise<string> {
    const created = await injectJson(daemon.app, {
      method: 'POST',
      url: '/documents',
      payload: { name },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.payload as { result: { document: { id: string } } }).result.document.id;
    const saved = await injectJson(daemon.app, {
      method: 'PUT',
      url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
      payload: { body: PAGE_BODY },
    });
    expect(saved.statusCode).toBe(200);
    return id;
  }

  it('恶意 documentId（穿越/NUL/控制字符）：400 doc_invalid_id 前置即拒，不回显原始 id，树外哨兵零改动', async () => {
    const daemon = await createTestDaemon();
    try {
      const documentId = await seedNamed(daemon, '正常文档');
      await plantSentinels(daemon);
      const before = await sentinelSnapshot(daemon);

      for (const maliciousId of ['../victim', 'a\u0000b', 'a\u0001b']) {
        const res = await injectJson(daemon.app, {
          method: 'POST',
          url: '/export',
          payload: { documentId: maliciousId, pageId: 'page-1', format: 'svg' },
        });
        expect(res.statusCode, maliciousId).toBe(400);
        expect((res.payload as { error: { code: string } }).error.code, maliciousId).toBe(
          'doc_invalid_id',
        );
        // 错误消息与 details 不回显原始 id、不泄漏目录布局
        expect(res.raw, maliciousId).not.toContain(maliciousId);
        expect(res.raw, maliciousId).not.toContain(daemon.tempDir);
      }
      // 树外哨兵零改动（读页前置即拒：根本没走到任何文件写）
      expect(await sentinelSnapshot(daemon)).toBe(before);
      // 树外没有新文件出现（受害者正文原样）
      expect(
        await readFile(join(daemon.tempDir, 'victim.dfg', 'pages', 'page-1.json'), 'utf8'),
      ).toBe('{"secret":"victim-body"}\n');
      // 合法文档不受影响，仍可正常导出
      const ok = await injectJson(daemon.app, {
        method: 'POST',
        url: '/export',
        payload: { documentId, pageId: 'page-1', format: 'svg' },
      });
      expect(ok.statusCode).toBe(200);
    } finally {
      await daemon.cleanup();
    }
  });

  it('伪造 manifest 页 id 越界：422 doc_invalid_manifest 整体拒绝，树外哨兵零改动', async () => {
    const daemon = await createTestDaemon();
    try {
      const documentId = await seedNamed(daemon, '合法文档');
      await plantSentinels(daemon);
      const before = await sentinelSnapshot(daemon);

      // 克隆来的 .dfg 是不可信输入：manifest 塞入越界页 id（指向树外 leak.json）
      const manifestPath = join(daemon.workspaceDir, `${documentId}.dfg`, 'manifest.json');
      const forged = {
        schema: 'df.dfg.manifest/v1',
        id: documentId,
        name: '合法文档',
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        pages: [
          { id: 'page-1', name: 'page-1', updatedAt: '2026-01-01T00:00:00.000Z' },
          { id: '../../../outside/leak', name: 'leak', updatedAt: '2026-01-01T00:00:00.000Z' },
        ],
      };
      await writeFile(manifestPath, `${JSON.stringify(forged, null, 2)}\n`);

      const res = await injectJson(daemon.app, {
        method: 'POST',
        url: '/export',
        payload: { documentId, pageId: 'page-1', format: 'svg' },
      });
      // 恶意页 id 整体拒绝（不是只跳过非法页继续渲染合法页）
      expect(res.statusCode).toBe(422);
      expect((res.payload as { error: { code: string } }).error.code).toBe('doc_invalid_manifest');
      expect(res.raw).not.toContain('../../../outside/leak');
      expect(res.raw).not.toContain(daemon.tempDir);
      // 树外哨兵零改动
      expect(await sentinelSnapshot(daemon)).toBe(before);
      expect(await readFile(join(daemon.tempDir, 'outside', 'leak.json'), 'utf8')).toBe(
        '{"secret":"leak"}\n',
      );
    } finally {
      await daemon.cleanup();
    }
  });

  it('中文 id 正常导出：产物名恰为 <documentId>-<pageId>.<format> 且只出现在 exports/ 内，树外哨兵零改动', async () => {
    const daemon = await createTestDaemon();
    try {
      const documentId = await seedNamed(daemon, '中文-设计稿');
      await plantSentinels(daemon);
      const before = await sentinelSnapshot(daemon);

      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/export',
        payload: { documentId, pageId: 'page-1', format: 'svg' },
      });
      expect(statusCode).toBe(200);
      const artifact = (payload as { result: { artifact: { fileName: string; filePath: string } } })
        .result.artifact;
      // 产物名恰为 <documentId>-<pageId>.<format>（中文保留口径）
      expect(artifact.fileName).toBe(`${documentId}-page-1.svg`);
      // 只落在 exports/ 内
      const exportsDir = join(daemon.dataRoot, 'exports');
      expect(artifact.filePath.startsWith(exportsDir)).toBe(true);
      expect(await readdir(exportsDir)).toEqual([artifact.fileName]);
      // workspace 内只有该 .dfg 目录（导出不得在文档树里落文件）
      expect(await readdir(daemon.workspaceDir)).toEqual([`${documentId}.dfg`]);
      // 树外哨兵零改动
      expect(await sentinelSnapshot(daemon)).toBe(before);
    } finally {
      await daemon.cleanup();
    }
  });
});
