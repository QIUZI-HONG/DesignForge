import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
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
      // 产物确实落盘：存在性 + 长度 + 内容哈希与响应产物逐项一致
      const onDisk = await stat(artifact.filePath);
      expect(onDisk.isFile()).toBe(true);
      expect(onDisk.size).toBe(artifact.length);
      const diskBytes = await readFile(artifact.filePath);
      expect(createHash('sha256').update(diskBytes).digest('hex')).toBe(artifact.sha256);
      expect(diskBytes.equals(bytes)).toBe(true);
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

/**
 * web 真实信封夹具（镜像 `apps/web/.../documents-client.ts` 的 `encodePageBody` 输出）：
 * `{ $format: 'dforge.canvas.page', $version: 1, page: ScenePage, tokens }`，
 * ScenePage = 扁平节点表（`nodes: Record<id, node>`，字段集对齐引擎 `model/node.ts`）
 * + `rootIds` 顶层顺序（后者在上）+ `backgroundColor` + `grid`。
 * 这是「画图 → 保存」在 daemon 侧实际落盘的正文形状（§A1 缺陷现场）。
 */
function realCanvasEnvelope(): Record<string, unknown> {
  return {
    $format: 'dforge.canvas.page',
    $version: 1,
    page: {
      id: 'page-1',
      name: '页面 1',
      nodes: {
        'rect-1': {
          id: 'rect-1',
          name: '矩形',
          type: 'rect',
          x: 10,
          y: 20,
          width: 120,
          height: 60,
          rotation: 0,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          fills: [{ type: 'solid', color: '#FF0000', opacity: 1, visible: true }],
          strokes: [],
          effects: [],
          cornerRadius: 8,
        },
        'ellipse-1': {
          id: 'ellipse-1',
          name: '椭圆',
          type: 'ellipse',
          x: 160,
          y: 30,
          width: 60,
          height: 60,
          rotation: 0,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          fills: [{ type: 'solid', color: '#0000FF', opacity: 1, visible: true }],
          strokes: [],
          effects: [],
          cornerRadius: 0,
        },
        'text-1': {
          id: 'text-1',
          name: '文本',
          type: 'text',
          x: 20,
          y: 90,
          width: 80,
          height: 24,
          rotation: 0,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          fills: [{ type: 'solid', color: '#000000', opacity: 1, visible: true }],
          strokes: [],
          effects: [],
          cornerRadius: 0,
          text: {
            characters: '标题',
            fontFamily: 'Noto Sans SC',
            fontSize: 24,
            fontWeight: 400,
            lineHeight: 1.4,
            letterSpacing: 0,
            align: 'left',
            autoResize: 'width_and_height',
          },
        },
        'rect-hidden': {
          id: 'rect-hidden',
          name: '隐藏矩形',
          type: 'rect',
          x: 0,
          y: 0,
          width: 20,
          height: 20,
          rotation: 0,
          visible: false,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          fills: [{ type: 'solid', color: '#00FF00', opacity: 1, visible: true }],
          strokes: [],
          effects: [],
          cornerRadius: 0,
        },
        'inst-1': {
          id: 'inst-1',
          name: '实例',
          type: 'instance',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          rotation: 0,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          fills: [],
          strokes: [],
          effects: [],
          cornerRadius: 0,
          componentId: 'comp-1',
          overrides: {},
        },
      },
      rootIds: ['rect-1', 'ellipse-1', 'text-1', 'rect-hidden', 'inst-1'],
      backgroundColor: '#F5F5F5',
      grid: { size: 10, visible: false, snapToGrid: false, style: 'grid' },
    },
    tokens: {},
  };
}

/** 按 web 保存链路落一份真实信封文档（create → PUT page-1，对齐 saveDesignDocument）。 */
async function seedEnvelopeDocument(daemon: TestDaemon): Promise<string> {
  const created = await injectJson(daemon.app, {
    method: 'POST',
    url: '/documents',
    payload: { name: '真实画布' },
  });
  const id = (created.payload as { result: { document: { id: string } } }).result.document.id;
  const saved = await injectJson(daemon.app, {
    method: 'PUT',
    url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
    payload: { body: realCanvasEnvelope() },
  });
  expect(saved.statusCode).toBe(200);
  return id;
}

describe('export · web 真实信封保存 → 导出（§A1 核心闭环）', () => {
  it('PNG：信封展平生效——产物尺寸取内容包围盒、像素非空（红矩形/蓝椭圆/页面底色）', async () => {
    const daemon = await createTestDaemon();
    try {
      const documentId = await seedEnvelopeDocument(daemon);
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/export',
        payload: { documentId, pageId: 'page-1', format: 'png' },
      });
      expect(statusCode).toBe(200);
      const result = (
        payload as {
          result: { artifact: { base64: string; length: number }; skippedNodes: number };
        }
      ).result;
      // 产物非空且远大于「空场景」的下限（§A1 现状是空白 1440×900）
      expect(result.artifact.length).toBeGreaterThan(0);
      const png = decodePng(Buffer.from(result.artifact.base64, 'base64'));
      // 包围盒：矩形右缘 10+120=130、椭圆右缘 160+60=220；底缘 max(30+60, 90+24)=114
      expect(png.width).toBe(220);
      expect(png.height).toBe(114);
      // 红矩形内部（10–130 × 20–80 → 内点 70,50）
      expect(png.pixel(70, 50)).toEqual([255, 0, 0, 255]);
      // 蓝椭圆中心（160–220 × 30–90 → 中心 190,60）
      expect(png.pixel(190, 60)).toEqual([0, 0, 255, 255]);
      // 远角是页面底色 #F5F5F5（信封的 page.backgroundColor 生效）
      expect(png.pixel(215, 5)).toEqual([245, 245, 245, 255]);
      // 隐藏矩形 + 实例（组件语义不解析）→ skippedNodes = 2
      expect(result.skippedNodes).toBe(2);
    } finally {
      await daemon.cleanup();
    }
  });

  it('SVG：矩形/椭圆/文本与页面底色全部进产物（非空正文）', async () => {
    const daemon = await createTestDaemon();
    try {
      const documentId = await seedEnvelopeDocument(daemon);
      const { payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/export',
        payload: { documentId, pageId: 'page-1', format: 'svg' },
      });
      const artifact = (payload as { result: { artifact: { base64: string } } }).result.artifact;
      const text = Buffer.from(artifact.base64, 'base64').toString('utf8');
      expect(text).toContain('width="220" height="114"');
      expect(text).toContain('fill="#F5F5F5"');
      expect(text).toContain('fill="#FF0000"');
      expect(text).toContain('<ellipse');
      expect(text).toContain('fill="#0000FF"');
      expect(text).toContain('标题');
    } finally {
      await daemon.cleanup();
    }
  });

  it('PDF：MediaBox 取内容包围盒尺寸，含矩形填充操作符', async () => {
    const daemon = await createTestDaemon();
    try {
      const documentId = await seedEnvelopeDocument(daemon);
      const { payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/export',
        payload: { documentId, pageId: 'page-1', format: 'pdf' },
      });
      const artifact = (payload as { result: { artifact: { base64: string } } }).result.artifact;
      const text = Buffer.from(artifact.base64, 'base64').toString('utf8');
      expect(text.startsWith('%PDF-1.4')).toBe(true);
      expect(text).toContain('/MediaBox [0 0 220 114]');
      expect(text).toContain('1 0 0 rg');
      expect(text).toContain('re f');
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('export · 失败态', () => {
  it('导出输出尺寸超限（页面边长 × scale > 8192）→ 400 export_canvas_too_large + 结构化原因', async () => {
    const daemon = await createTestDaemon();
    try {
      const created = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: '超大页面' },
      });
      const id = (created.payload as { result: { document: { id: string } } }).result.document.id;
      // D1 场景的廉价变体：8193×1 页面在 scale1 下即超限（渲染若放行也只分配 8193 像素）
      const saved = await injectJson(daemon.app, {
        method: 'PUT',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
        payload: { body: { width: 8193, height: 1, background: '#FFFFFF', children: [] } },
      });
      expect(saved.statusCode).toBe(200);
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/export',
        payload: { documentId: id, pageId: 'page-1', format: 'png' },
      });
      expect(statusCode).toBe(400);
      const error = (
        payload as { error: { code: string; message: string; details?: Record<string, unknown> } }
      ).error;
      expect(error.code).toBe('export_canvas_too_large');
      expect(error.message).toContain('8192');
      expect(error.details).toMatchObject({ width: 8193, height: 1, scale: 1, maxEdge: 8192 });
    } finally {
      await daemon.cleanup();
    }
  });

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
