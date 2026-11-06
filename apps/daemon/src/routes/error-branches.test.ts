/**
 * 路由错误分支补测（audit-d08 · 缺陷 D-11：daemon 关键分支覆盖 ≥90%）。
 *
 * 口径：只补**路由错误分支**——请求体形状校验（非对象/缺字段/类型不符）、查询参数
 * 校验（非法枚举/非法数值）、状态分支（资产不存在/任务不存在/凭据来源两态/
 * ComfyUI 探测可达与模型清单两态），与既有用例（成功路径为主）互补，不刷成功路径。
 */

import { describe, expect, it } from 'vitest';

import type { TestDaemon } from '../testing/harness.ts';
import { createTestDaemon, injectJson } from '../testing/harness.ts';

/** 假 key 形态（与真实 key 隔离）。 */
const FAKE_KEY = 'sk-fake-1234567890abcd';

/** 市场索引夹具（最小卡片；仅用于 detail/load-plan 的状态分支）。 */
function makeAsset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'gh:anthropics/skills#skills/pdf',
    kind: 'skill',
    name: 'pdf-export',
    displayName: { 'zh-CN': 'PDF 导出', en: 'PDF Export' },
    summary: { 'zh-CN': '把设计稿一键导出为分页 PDF', en: 'Export to PDF' },
    source: {
      repo: 'anthropics/skills',
      repoId: 1,
      path: 'skills/pdf',
      ref: 'a'.repeat(40),
      fetchedAt: '2026-10-15T22:05:11Z',
      license: {
        spdx: 'MIT',
        gate: 'loadable',
        evidence: { path: 'LICENSE', sha256: 'b'.repeat(64) },
      },
      stars: 100,
      pushedAt: '2026-10-01T09:00:00Z',
      archived: false,
      homepage: null,
      upstream: null,
      brandDerived: false,
    },
    capabilities: [],
    facets: { category: '网站设计', lane: 'create', mode: 'components', tags: ['pdf'], scenes: [] },
    quality: {
      score: 0.5,
      dims: { spec: 0.5, maintenance: 0.5, docs: 0.5, security: 0.5, ecosystem: 0.5 },
    },
    installGate: {
      mode: 'loadable',
      licenseGate: 'loadable',
      security: 'pass',
      reasons: [],
      ackRequired: [],
    },
    digest: `sha256:${'c'.repeat(64)}`,
    embeddingRef: null,
    yanked: null,
    ...overrides,
  };
}

function makeIndex(assets: Record<string, unknown>[]): Record<string, unknown> {
  return {
    schema: 'df.marketplace.index/v1',
    generatedAt: '2026-10-15T12:00:00Z',
    collector: {
      name: 'df-market',
      version: '0.1.0',
      runId: 'r1',
      odsWatermark: '2026-10-15T12:00:00Z',
    },
    counts: {
      total: assets.length,
      byKind: { skill: assets.length, plugin: 0, 'design-system': 0, template: 0 },
      loadable: assets.length,
    },
    assets,
  };
}

async function seedIndex(daemon: TestDaemon, content: unknown): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const dir = join(daemon.dataRoot, 'market');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'df.marketplace.index.v1.json'), JSON.stringify(content));
}

/** 断言统一错误信封（code + 400）。 */
function errorCodeOf(payload: unknown): string {
  return (payload as { error: { code: string } }).error.code;
}

describe('market · 查询参数校验分支（parseQuery 扫尾）', () => {
  it('各参数的合法/非法/边界值都按口径进或不出查询（不 500）', async () => {
    const daemon = await createTestDaemon();
    try {
      await seedIndex(daemon, makeIndex([makeAsset()]));
      // 逐组查询：断言请求成功即可（分支本身在 parseQuery；结果形状由既有用例保障）
      const urls = [
        '/market/query?q=%20', // 仅空白 → q 不入参
        '/market/query?kind=skill,bogus,template', // 未知 kind 被过滤，合法的保留
        '/market/query?kind=%20%20', // 全部被过滤 → kinds 不入参
        '/market/query?category=%E7%BD%91%E7%AB%99%E8%AE%BE%E8%AE%A1', // 合法品类（网站设计）
        '/market/query?category=bogus', // 非法品类 → 不入参
        '/market/query?lane=create&mode=components', // 合法 lane + mode
        '/market/query?lane=bogus&mode=bogus', // 非法 lane + mode
        '/market/query?scene=', // 空 scene → 不入参
        '/market/query?scene=%E6%B5%B7%E6%8A%A5', // 非空 scene → 入参
        '/market/query?tags=,,', // 全空 tag → 不入参
        '/market/query?tags=a,b', // 非空 tags → 入参
        '/market/query?loadable=1&sort=score',
        '/market/query?loadable=true&sort=updated',
        '/market/query?sort=name',
        '/market/query?sort=bogus', // 非法 sort → 不入参
        '/market/query?limit=5&offset=2', // 合法分页
        '/market/query?limit=0&offset=-1', // 非法分页 → 不入参
        '/market/query?limit=abc', // 非数字 → NaN → 不入参
      ];
      for (const url of urls) {
        const { statusCode } = await injectJson(daemon.app, { method: 'GET', url });
        expect(statusCode, url).toBe(200);
      }
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('market · load-plan 请求体校验与未知资产', () => {
  it('非对象体 / assetId 非法 / documentId 非字符串 / 未知资产 → 各自错误分支', async () => {
    const daemon = await createTestDaemon();
    try {
      await seedIndex(daemon, makeIndex([makeAsset()]));

      const nonObject = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/load-plan',
        payload: 'not-an-object',
      });
      expect(nonObject.statusCode).toBe(400);
      expect(errorCodeOf(nonObject.payload)).toBe('bad_request');

      const noAssetId = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/load-plan',
        payload: {},
      });
      expect(noAssetId.statusCode).toBe(400);
      expect(errorCodeOf(noAssetId.payload)).toBe('bad_request');

      const emptyAssetId = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/load-plan',
        payload: { assetId: '' },
      });
      expect(emptyAssetId.statusCode).toBe(400);
      expect(errorCodeOf(emptyAssetId.payload)).toBe('bad_request');

      const badDocumentId = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/load-plan',
        payload: { assetId: 'gh:anthropics/skills#skills/pdf', documentId: 42 },
      });
      expect(badDocumentId.statusCode).toBe(200);

      const unknownAsset = await injectJson(daemon.app, {
        method: 'POST',
        url: '/market/load-plan',
        payload: { assetId: 'gh:ghost/repo#nope' },
      });
      expect(unknownAsset.statusCode).toBe(404);
      expect(errorCodeOf(unknownAsset.payload)).toBe('market_asset_not_found');
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('telemetry · 事件写入校验分支', () => {
  it('非对象体 / 未知事件名 / payload 非对象 / 可选字段非字符串 → 各自分支', async () => {
    const daemon = await createTestDaemon();
    try {
      const nonObject = await injectJson(daemon.app, {
        method: 'POST',
        url: '/telemetry/events',
        payload: 'nope',
      });
      expect(nonObject.statusCode).toBe(400);
      expect(errorCodeOf(nonObject.payload)).toBe('telemetry_invalid_event');

      const unknownName = await injectJson(daemon.app, {
        method: 'POST',
        url: '/telemetry/events',
        payload: { name: 'not.an.event' },
      });
      expect(unknownName.statusCode).toBe(400);
      expect(errorCodeOf(unknownName.payload)).toBe('telemetry_invalid_event');

      const payloadString = await injectJson(daemon.app, {
        method: 'POST',
        url: '/telemetry/events',
        payload: { name: 'doc.opened', payload: 'not-object' },
      });
      expect(payloadString.statusCode).toBe(400);
      expect(errorCodeOf(payloadString.payload)).toBe('telemetry_invalid_event');

      const payloadArray = await injectJson(daemon.app, {
        method: 'POST',
        url: '/telemetry/events',
        payload: { name: 'doc.opened', payload: ['array'] },
      });
      expect(payloadArray.statusCode).toBe(400);
      expect(errorCodeOf(payloadArray.payload)).toBe('telemetry_invalid_event');

      // 最小事件：payload 缺省补 {}，sessionId/appVersion/at 非字符串补 null
      const minimal = await injectJson(daemon.app, {
        method: 'POST',
        url: '/telemetry/events',
        payload: {
          name: 'doc.opened',
          sessionId: 7,
          appVersion: 7,
          at: 7,
        },
      });
      expect(minimal.statusCode).toBe(200);
      const result = (minimal.payload as { result: { stored: boolean; reason: string | null } })
        .result;
      expect(result.stored).toBe(true);
    } finally {
      await daemon.cleanup();
    }
  });

  it('查询 limit 的非数字分支回退 200（不 500）', async () => {
    const daemon = await createTestDaemon();
    try {
      for (const url of ['/telemetry/events?limit=abc', '/telemetry/events?limit=-3']) {
        const { statusCode } = await injectJson(daemon.app, { method: 'GET', url });
        expect(statusCode, url).toBe(200);
      }
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('mcp · 提案/确认/审计的错误分支', () => {
  it('提案：非对象体 / args 非对象 / documentId 非字符串 → 各自分支', async () => {
    const daemon = await createTestDaemon();
    try {
      const nonObject = await injectJson(daemon.app, {
        method: 'POST',
        url: '/mcp/proposals',
        payload: 'nope',
      });
      expect(nonObject.statusCode).toBe(400);
      expect(errorCodeOf(nonObject.payload)).toBe('bad_request');

      const argsString = await injectJson(daemon.app, {
        method: 'POST',
        url: '/mcp/proposals',
        payload: { tool: 'df_apply_patch', caller: 'user', args: 'not-object' },
      });
      expect(argsString.statusCode).toBe(201); // args 非对象 → 补 {}，不报错

      const documentIdNumber = await injectJson(daemon.app, {
        method: 'POST',
        url: '/mcp/proposals',
        payload: { tool: 'df_apply_patch', caller: 'user', args: {}, documentId: 42 },
      });
      expect(documentIdNumber.statusCode).toBe(201);
    } finally {
      await daemon.cleanup();
    }
  });

  it('确认：非对象体 / ackToken 空 / approve 非布尔 → bad_request', async () => {
    const daemon = await createTestDaemon();
    try {
      const nonObject = await injectJson(daemon.app, {
        method: 'POST',
        url: '/mcp/ack',
        payload: 'nope',
      });
      expect(nonObject.statusCode).toBe(400);
      expect(errorCodeOf(nonObject.payload)).toBe('bad_request');

      const emptyToken = await injectJson(daemon.app, {
        method: 'POST',
        url: '/mcp/ack',
        payload: { ackToken: '', approve: true },
      });
      expect(emptyToken.statusCode).toBe(400);
      expect(errorCodeOf(emptyToken.payload)).toBe('bad_request');

      const approveString = await injectJson(daemon.app, {
        method: 'POST',
        url: '/mcp/ack',
        payload: { ackToken: 'tok', approve: 'yes' },
      });
      expect(approveString.statusCode).toBe(400);
      expect(errorCodeOf(approveString.payload)).toBe('bad_request');
    } finally {
      await daemon.cleanup();
    }
  });

  it('审计：limit 非数字 / 非正数回退 100（不 500）', async () => {
    const daemon = await createTestDaemon();
    try {
      for (const url of ['/mcp/audit?limit=abc', '/mcp/audit?limit=0', '/mcp/audit?limit=3']) {
        const { statusCode } = await injectJson(daemon.app, { method: 'GET', url });
        expect(statusCode, url).toBe(200);
      }
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('config · 凭据写入校验分支', () => {
  it('非对象体 / provider 非法 → credential_invalid', async () => {
    const daemon = await createTestDaemon();
    try {
      const nonObject = await injectJson(daemon.app, {
        method: 'PUT',
        url: '/config/credentials',
        payload: 'nope',
      });
      expect(nonObject.statusCode).toBe(400);
      expect(errorCodeOf(nonObject.payload)).toBe('credential_invalid');

      const badProvider = await injectJson(daemon.app, {
        method: 'PUT',
        url: '/config/credentials',
        payload: { provider: 'openai', apiKey: FAKE_KEY },
      });
      expect(badProvider.statusCode).toBe(400);
      expect(errorCodeOf(badProvider.payload)).toBe('credential_invalid');
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('config · 连通性自检的两态分支（ComfyUI 可达 / key 两种来源）', () => {
  it('ComfyUI 可达但模型清单未返回（object_info 失败）→ ok + 「模型清单未返回」', async () => {
    const daemon = await createTestDaemon({
      comfyBaseUrl: 'http://127.0.0.1:9187',
      fetchImpl: (url) => {
        if (url.includes('/system_stats')) {
          return Promise.resolve(
            new Response(JSON.stringify({ devices: [{ name: 'cpu', vram_total: 1 }] }), {
              status: 200,
            }),
          );
        }
        return Promise.resolve(new Response('{}', { status: 500 }));
      },
    });
    try {
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/config/connectivity',
      });
      expect(statusCode).toBe(200);
      const report = (
        payload as { result: { items: { id: string; status: string; detail: string }[] } }
      ).result;
      const comfy = report.items.find((item) => item.id === 'comfyui');
      expect(comfy?.status).toBe('ok');
      expect(comfy?.detail).toContain('模型清单未返回');
    } finally {
      await daemon.cleanup();
    }
  });

  it('ComfyUI 可达且模型清单返回 + env 注入 key → ok + checkpoint 数 + 来源环境变量', async () => {
    const daemon = await createTestDaemon({
      comfyBaseUrl: 'http://127.0.0.1:9187',
      envApiKey: FAKE_KEY,
      fetchImpl: (url) => {
        if (url.includes('/system_stats')) {
          return Promise.resolve(new Response(JSON.stringify({ devices: [] }), { status: 200 }));
        }
        if (url.includes('/object_info')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                CheckpointLoaderSimple: {
                  input: { required: { ckpt_name: [['a.safetensors', 'b.safetensors']] } },
                },
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response('{}', { status: 404 }));
      },
    });
    try {
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/config/connectivity',
      });
      expect(statusCode).toBe(200);
      const report = (
        payload as { result: { items: { id: string; status: string; detail: string }[] } }
      ).result;
      const comfy = report.items.find((item) => item.id === 'comfyui');
      expect(comfy?.status).toBe('ok');
      expect(comfy?.detail).toContain('2 个');
      const ai = report.items.find((item) => item.id === 'ai');
      expect(ai?.status).toBe('ok');
      expect(ai?.detail).toContain('环境变量');
    } finally {
      await daemon.cleanup();
    }
  });

  it('key 来自本地凭据库 → 连通性 AI 项标注来源本地凭据库', async () => {
    const daemon = await createTestDaemon();
    try {
      const put = await injectJson(daemon.app, {
        method: 'PUT',
        url: '/config/credentials',
        payload: { apiKey: FAKE_KEY },
      });
      expect(put.statusCode).toBe(200);

      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/config/connectivity',
      });
      expect(statusCode).toBe(200);
      const report = (
        payload as { result: { items: { id: string; status: string; detail: string }[] } }
      ).result;
      const ai = report.items.find((item) => item.id === 'ai');
      expect(ai?.status).toBe('ok');
      expect(ai?.detail).toContain('本地凭据库');
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('documents · 名称校验错误分支', () => {
  it('创建/改名/建页的请求体不是对象（或缺 name）→ doc_invalid_name', async () => {
    const daemon = await createTestDaemon();
    try {
      const createNoBody = await injectJson(daemon.app, { method: 'POST', url: '/documents' });
      expect(createNoBody.statusCode).toBe(400);
      expect(errorCodeOf(createNoBody.payload)).toBe('doc_invalid_name');

      const renameNoBody = await injectJson(daemon.app, {
        method: 'PATCH',
        url: '/documents/doc-x',
        payload: 'nope',
      });
      expect(renameNoBody.statusCode).toBe(400);
      expect(errorCodeOf(renameNoBody.payload)).toBe('doc_invalid_name');

      const pageNoBody = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents/doc-x/pages',
        payload: 'nope',
      });
      expect(pageNoBody.statusCode).toBe(400);
      expect(errorCodeOf(pageNoBody.payload)).toBe('doc_invalid_name');
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('export · 请求体校验错误分支', () => {
  it('非对象体 / 缺 pageId → bad_request（不触达文档层）', async () => {
    const daemon = await createTestDaemon();
    try {
      const nonObject = await injectJson(daemon.app, {
        method: 'POST',
        url: '/export',
        payload: 'nope',
      });
      expect(nonObject.statusCode).toBe(400);
      expect(errorCodeOf(nonObject.payload)).toBe('bad_request');

      const missingPageId = await injectJson(daemon.app, {
        method: 'POST',
        url: '/export',
        payload: { documentId: 'doc-x' },
      });
      expect(missingPageId.statusCode).toBe(400);
      expect(errorCodeOf(missingPageId.payload)).toBe('bad_request');
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('image · 未知任务的取消分支', () => {
  it('取消不存在的 runId → comfy_run_not_found（404 信封）', async () => {
    const daemon = await createTestDaemon();
    try {
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/image/runs/no-such-run/cancel',
      });
      expect(statusCode).toBe(404);
      expect(errorCodeOf(payload)).toBe('comfy_run_not_found');
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('ai · 请求体形状与 SSE 参数错误分支', () => {
  it('非流式：数组体 / 字符串体 → ai_invalid_request', async () => {
    const daemon = await createTestDaemon();
    try {
      const arrayBody = await injectJson(daemon.app, {
        method: 'POST',
        url: '/ai/chat',
        payload: ['not', 'an', 'object'],
      });
      expect(arrayBody.statusCode).toBe(400);
      expect(errorCodeOf(arrayBody.payload)).toBe('ai_invalid_request');

      const stringBody = await injectJson(daemon.app, {
        method: 'POST',
        url: '/ai/chat',
        payload: 'nope',
      });
      expect(stringBody.statusCode).toBe(400);
      expect(errorCodeOf(stringBody.payload)).toBe('ai_invalid_request');
    } finally {
      await daemon.cleanup();
    }
  });

  it('流式：参数非法以 SSE error 帧返回（通道形状不变）', async () => {
    const daemon = await createTestDaemon();
    try {
      const response = await injectJson(daemon.app, {
        method: 'POST',
        url: '/ai/chat',
        payload: { stream: true, messages: 'not-an-array' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.raw).toContain('event: error');
      expect(response.raw).toContain('ai_invalid_request');
    } finally {
      await daemon.cleanup();
    }
  });
});
