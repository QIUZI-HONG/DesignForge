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

/** 坏信封：声明了页面格式却给不出 page，抽取无从核对节点表 → 空白产物。 */
const BLANK_ENVELOPE_BODY = { $format: 'dforge.canvas.page', $version: 1, page: null, tokens: {} };

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
        // 实例的主组件必须同页在位（票 17 写侧守门：悬空引用拒绝落盘；
        // 旧夹具缺这枚节点，恰好复现「能写不可读」的锁定形状）
        'comp-1': {
          id: 'comp-1',
          name: '主组件',
          type: 'component',
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
          children: [],
          variantProperties: null,
          componentSetId: null,
        },
      },
      rootIds: ['rect-1', 'ellipse-1', 'text-1', 'rect-hidden', 'inst-1', 'comp-1'],
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
          result: {
            artifact: { base64: string; length: number };
            skippedNodes: number;
            truncatedNodes: number;
            complete: boolean;
          };
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
      // 隐藏矩形 = 非损失（不进 skipped）；仅实例（组件语义不解析）算真损失 → skippedNodes = 1
      expect(result.skippedNodes).toBe(1);
      expect(result.truncatedNodes).toBe(0);
      // 实例未展开是实打实的损失 → complete=false（隐藏层单独不会把它拉成 false）
      expect(result.complete).toBe(false);
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

describe('export · 节点预算截断必须如实上报', () => {
  /** 按 web 信封形状落一份含 count 个顶层矩形的文档，返回文档 id。 */
  async function seedWideDocument(daemon: TestDaemon, count: number): Promise<string> {
    const nodes: Record<string, unknown> = {};
    const rootIds: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const id = `rect-${String(index)}`;
      nodes[id] = {
        id,
        name: id,
        type: 'rect',
        x: index,
        y: 0,
        width: 10,
        height: 10,
        visible: true,
        fills: [],
        children: [],
      };
      rootIds.push(id);
    }
    const created = await injectJson(daemon.app, {
      method: 'POST',
      url: '/documents',
      payload: { name: '超限画布' },
    });
    const documentId = (created.payload as { result: { document: { id: string } } }).result.document
      .id;
    const saved = await injectJson(daemon.app, {
      method: 'PUT',
      url: `/documents/${encodeURIComponent(documentId)}/pages/page-1`,
      payload: {
        body: {
          $format: 'dforge.canvas.page',
          $version: 1,
          page: { id: 'page-1', name: '页面 1', nodes, rootIds, backgroundColor: '#FFFFFF' },
          tokens: {},
        },
      },
    });
    expect(saved.statusCode).toBe(200);
    return documentId;
  }

  it('超出 2000 上限：HTTP 200 但响应必须声明部分产物（截断非零 + complete=false）', async () => {
    const daemon = await createTestDaemon();
    try {
      const documentId = await seedWideDocument(daemon, 2001);
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/export',
        payload: { documentId, pageId: 'page-1', format: 'svg' },
      });
      expect(statusCode).toBe(200);
      const result = (
        payload as {
          result: {
            artifact: { length: number };
            skippedNodes: number;
            truncatedNodes: number;
            complete: boolean;
          };
        }
      ).result;
      expect(result.artifact.length).toBeGreaterThan(0);
      expect(result.truncatedNodes).toBe(1);
      expect(result.skippedNodes).toBe(0);
      expect(result.complete).toBe(false);
    } finally {
      await daemon.cleanup();
    }
  });

  it('未触顶且无跳过：complete=true（不被误报成部分产物）', async () => {
    const daemon = await createTestDaemon();
    try {
      const documentId = await seedWideDocument(daemon, 5);
      const { payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/export',
        payload: { documentId, pageId: 'page-1', format: 'svg' },
      });
      const result = (
        payload as { result: { skippedNodes: number; truncatedNodes: number; complete: boolean } }
      ).result;
      expect(result.complete).toBe(true);
      expect(result.truncatedNodes).toBe(0);
      expect(result.skippedNodes).toBe(0);
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('export · 未判定/零产物不得认证为完整（票 18 红线，HTTP 缝）', () => {
  /** 直接 PUT 任意正文（含坏信封）并导出，返回 HTTP 状态 + result（或 error）。 */
  async function putBodyAndExport(
    daemon: TestDaemon,
    body: unknown,
  ): Promise<{
    putStatus: number;
    statusCode: number;
    result: Record<string, unknown> | undefined;
  }> {
    const created = await injectJson(daemon.app, {
      method: 'POST',
      url: '/documents',
      payload: { name: `坏信封-${Math.random().toString(36).slice(2)}` },
    });
    const documentId = (created.payload as { result: { document: { id: string } } }).result.document
      .id;
    const saved = await injectJson(daemon.app, {
      method: 'PUT',
      url: `/documents/${encodeURIComponent(documentId)}/pages/page-1`,
      payload: { body },
    });
    const exported = await injectJson(daemon.app, {
      method: 'POST',
      url: '/export',
      payload: { documentId, pageId: 'page-1', format: 'svg' },
    });
    return {
      putStatus: saved.statusCode,
      statusCode: exported.statusCode,
      result: (exported.payload as { result?: Record<string, unknown> }).result,
    };
  }

  it('坏信封（page:null）：HTTP 200 但必须 complete=false（不得把空白产物认证为完整）', async () => {
    const daemon = await createTestDaemon();
    try {
      const { putStatus, statusCode, result } = await putBodyAndExport(daemon, {
        $format: 'dforge.canvas.page',
        $version: 1,
        page: null,
        tokens: {},
      });
      expect(putStatus).toBe(200);
      expect(statusCode).toBe(200);
      expect(result).toBeDefined();
      expect(result?.complete).toBe(false);
    } finally {
      await daemon.cleanup();
    }
  });

  it('信封有可渲染节点但 rootIds 为空：产物空 → complete=false', async () => {
    const daemon = await createTestDaemon();
    try {
      const nodes: Record<string, unknown> = {};
      for (let index = 0; index < 5; index += 1) {
        const id = `rect-${String(index)}`;
        nodes[id] = {
          id,
          type: 'rect',
          x: index * 12,
          y: 0,
          width: 10,
          height: 10,
          visible: true,
          fills: [],
          children: [],
        };
      }
      const { putStatus, statusCode, result } = await putBodyAndExport(daemon, {
        $format: 'dforge.canvas.page',
        $version: 1,
        page: { id: 'page-1', nodes, rootIds: [], backgroundColor: '#FFFFFF' },
        tokens: {},
      });
      expect(putStatus).toBe(200);
      expect(statusCode).toBe(200);
      expect(result).toBeDefined();
      expect(result?.complete).toBe(false);
    } finally {
      await daemon.cleanup();
    }
  });

  it('全新空页正文 "{}"：无节点无损失 → complete=true（诚实的空页面，与上两条区分开）', async () => {
    const daemon = await createTestDaemon();
    try {
      const { putStatus, statusCode, result } = await putBodyAndExport(daemon, {});
      expect(putStatus).toBe(200);
      expect(statusCode).toBe(200);
      expect(result).toBeDefined();
      expect(result?.complete).toBe(true);
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('export · 部分/空白产物不得静默覆盖上一次好产物（票 18 二轮 G1）', () => {
  /** 本段用到的响应形状子集。 */
  interface ExportResultShape {
    artifact: {
      fileName: string;
      filePath: string;
      base64: string;
      length: number;
      sha256: string;
    };
    skippedNodes: number;
    truncatedNodes: number;
    complete: boolean;
    preservedPreviousArtifactPath: string | null;
  }

  function exportResult(payload: unknown): ExportResultShape {
    return (payload as { result: ExportResultShape }).result;
  }

  /** 先导一份完整产物，再把同一页改成 `brokenBody` 并重导，返回两次的 result + 好产物字节。 */
  async function overwriteProbe(format: 'svg' | 'png', brokenBody: unknown) {
    const daemon = await createTestDaemon();
    const documentId = await seedDocument(daemon);
    const good = await injectJson(daemon.app, {
      method: 'POST',
      url: '/export',
      payload: { documentId, pageId: 'page-1', format },
    });
    expect(good.statusCode).toBe(200);
    const goodResult = exportResult(good.payload);
    expect(goodResult.complete).toBe(true);
    expect(goodResult.preservedPreviousArtifactPath).toBeNull();
    const canonicalPath = goodResult.artifact.filePath;
    const goodBytes = await readFile(canonicalPath);
    // 规范名上的落盘字节 == 响应载荷（先钉住基线，再谈「没被动过」）
    expect(goodBytes).toEqual(Buffer.from(goodResult.artifact.base64, 'base64'));

    // 同一页改成坏正文：抽取走到空白产物（二轮实测 7164 字节空白 PNG）
    const broken = await injectJson(daemon.app, {
      method: 'PUT',
      url: `/documents/${encodeURIComponent(documentId)}/pages/page-1`,
      payload: { body: brokenBody },
    });
    expect(broken.statusCode).toBe(200);
    const bad = await injectJson(daemon.app, {
      method: 'POST',
      url: '/export',
      payload: { documentId, pageId: 'page-1', format },
    });
    expect(bad.statusCode).toBe(200);
    const badResult = exportResult(bad.payload);
    return { daemon, documentId, canonicalPath, goodBytes, goodResult, badResult };
  }

  it('SVG：空白产物的字节不进规范名，上一次好产物一字节未动，且如实给出被保留的路径', async () => {
    const probed = await overwriteProbe('svg', BLANK_ENVELOPE_BODY);
    try {
      const { badResult, canonicalPath, goodBytes } = probed;
      expect(badResult.complete).toBe(false);
      // 上一次好产物被保住（不是「覆盖后再也找不回」）
      expect(badResult.preservedPreviousArtifactPath).toBe(canonicalPath);
      expect(await readFile(canonicalPath)).toEqual(goodBytes);
      // 本次字节落在隔离侧文件，且与响应载荷逐字节一致（不出现「说写了、盘上没有」）
      expect(badResult.artifact.filePath).not.toBe(canonicalPath);
      expect(badResult.artifact.fileName).toBe(
        `${probed.documentId}-page-1.incomplete-${badResult.artifact.sha256.slice(0, 12)}.svg`,
      );
      expect(await readFile(badResult.artifact.filePath)).toEqual(
        Buffer.from(badResult.artifact.base64, 'base64'),
      );
    } finally {
      await probed.daemon.cleanup();
    }
  });

  it('PNG：二轮实测的「7164 字节空白 PNG 顶掉好产物」路径已被隔离', async () => {
    const probed = await overwriteProbe('png', BLANK_ENVELOPE_BODY);
    try {
      const { badResult, canonicalPath, goodBytes } = probed;
      expect(badResult.complete).toBe(false);
      expect(badResult.preservedPreviousArtifactPath).toBe(canonicalPath);
      const stillGood = await readFile(canonicalPath);
      expect(stillGood).toEqual(goodBytes);
      expect(stillGood.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      // 空白产物自身的像素必须是页面底色（证明它确实是「没走到任何节点」的产物，不是误判）
      const blank = decodePng(Buffer.from(badResult.artifact.base64, 'base64'));
      expect(blank.pixel(0, 0)).toEqual([255, 255, 255, 255]);
      // 好产物里仍能看到原来的红色矩形（第 10,10 像素起）
      const good = decodePng(goodBytes);
      expect(good.pixel(20, 20)).toEqual([255, 0, 0, 255]);
    } finally {
      await probed.daemon.cleanup();
    }
  });

  it('存量正文「有内容却没被渲染」的形状：不得认证完整，字节不得进规范名（三轮 E1）', async () => {
    const probed = await overwriteProbe('svg', {
      width: 100,
      height: 100,
      background: '#FFFFFF',
      // 引擎真实页面用 nodes: Record<id, node>；存量分支消费不了对象形态的根表
      children: { a: { kind: 'rect', x: 0, y: 0, width: 10, height: 10 } },
    });
    try {
      const { badResult, canonicalPath, goodBytes } = probed;
      expect(badResult.complete).toBe(false);
      expect(badResult.skippedNodes).toBeGreaterThan(0);
      expect(badResult.preservedPreviousArtifactPath).toBe(canonicalPath);
      expect(await readFile(canonicalPath)).toEqual(goodBytes);
      expect(badResult.artifact.filePath).not.toBe(canonicalPath);
      expect(await readFile(badResult.artifact.filePath)).toEqual(
        Buffer.from(badResult.artifact.base64, 'base64'),
      );
    } finally {
      await probed.daemon.cleanup();
    }
  });

  it('同一页两次不同的部分产物各落各的侧文件，且各自字节仍可取回（三轮 E2）', async () => {
    const daemon = await createTestDaemon();
    try {
      const documentId = await seedDocument(daemon);
      const partialBodies: unknown[] = [
        { width: 100, height: 100, background: '#FFFFFF', children: { a: { kind: 'rect' } } },
        { width: 120, height: 120, background: '#FFFFFF', nodes: 'oops', extra: { b: 1 } },
      ];
      const results: ExportResultShape[] = [];
      for (const body of partialBodies) {
        const saved = await injectJson(daemon.app, {
          method: 'PUT',
          url: `/documents/${encodeURIComponent(documentId)}/pages/page-1`,
          payload: { body },
        });
        expect(saved.statusCode).toBe(200);
        const exported = await injectJson(daemon.app, {
          method: 'POST',
          url: '/export',
          payload: { documentId, pageId: 'page-1', format: 'svg' },
        });
        expect(exported.statusCode).toBe(200);
        const result = exportResult(exported.payload);
        expect(result.complete).toBe(false);
        results.push(result);
      }
      // 二轮实测：4 次部分导出共用一个侧文件，后一次把前一次顶掉，前 3 个响应的
      // filePath/sha256/length 全部对自己报的路径失效。
      expect(results.length).toBe(partialBodies.length);
      const sidecars = new Set(results.map((result) => result.artifact.filePath));
      expect(sidecars.size).toBe(results.length);
      for (const result of results) {
        expect(await readFile(result.artifact.filePath)).toEqual(
          Buffer.from(result.artifact.base64, 'base64'),
        );
      }
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
