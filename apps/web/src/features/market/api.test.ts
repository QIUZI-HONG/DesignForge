/**
 * 市场数据面客户端测试（接缝：`@/features/market/api`）。
 *
 * 断言的是**对外行为**：URL 形状与 daemon 路由契约一致、信封解包、视图状态归一。
 * 不测实现细节（不 mock 内部函数），网络一律用假 fetch（不真连 daemon）。
 */

import { MARKETPLACE_INDEX_SCHEMA } from '@dforge/contracts';
import { describe, expect, it, vi } from 'vitest';

import { makeAsset, makeMissingIndexResponse, makeQueryResponse } from './__fixtures__/market';
import {
  assetFromDetail,
  buildMarketAssetUrl,
  buildMarketLoadPlanUrl,
  buildMarketQueryUrl,
  buildSourceUrl,
  classifyMarketOutcome,
  classifyWarnings,
  DEFAULT_DAEMON_URL,
  daemonBaseUrl,
  fetchMarketLoadPlan,
  fetchMarketQuery,
  MARKET_COLLECT_COMMAND,
  readEnvelope,
  validateMarketAssetDetail,
  validateMarketQueryResponse,
} from './api';

describe('api · URL 构造', () => {
  it('查询串按 daemon parseQuery 口径序列化（kind 逗号连接、loadable=1）', () => {
    const url = buildMarketQueryUrl('http://127.0.0.1:4318', {
      q: '幻灯片 导出',
      kinds: ['skill', 'plugin'],
      category: 'PPT设计',
      lane: 'create',
      scene: 'ppt-design',
      loadableOnly: true,
      sort: 'name',
      limit: 60,
    });
    expect(url.startsWith('http://127.0.0.1:4318/market/query?')).toBe(true);
    const search = new URL(url).searchParams;
    expect(search.get('q')).toBe('幻灯片 导出');
    expect(search.get('kind')).toBe('skill,plugin');
    expect(search.get('category')).toBe('PPT设计');
    expect(search.get('lane')).toBe('create');
    expect(search.get('scene')).toBe('ppt-design');
    expect(search.get('loadable')).toBe('1');
    expect(search.get('sort')).toBe('name');
    expect(search.get('limit')).toBe('60');
  });

  it('空参数不落查询串（默认取 daemon 缺省）', () => {
    const url = buildMarketQueryUrl('http://127.0.0.1:4318', {});
    expect(new URL(url).search).toBe('');
  });

  it('详情 URL 对 assetId 做 URL 编码（gh:owner/repo#path 形态）', () => {
    const url = buildMarketAssetUrl('http://127.0.0.1:4318', 'gh:acme/skills#skills/pdf-export');
    expect(url).not.toContain('#skills/pdf-export');
    expect(decodeURIComponent(url.split('/market/assets/')[1] ?? '')).toBe(
      'gh:acme/skills#skills/pdf-export',
    );
  });

  it('装载提案路径取契约路由表', () => {
    expect(buildMarketLoadPlanUrl('http://127.0.0.1:4318')).toBe(
      'http://127.0.0.1:4318/market/load-plan',
    );
  });
});

describe('api · 基址解析', () => {
  it('纯委托单点模块：不传环境变量时 = 收敛模块的端口窗起点', () => {
    expect(daemonBaseUrl()).toBe(DEFAULT_DAEMON_URL);
  });

  it('构建期 env 覆盖仍生效（读取口径归单点模块，本模块只委托）', () => {
    const original = process.env.NEXT_PUBLIC_DF_DAEMON_URL;
    process.env.NEXT_PUBLIC_DF_DAEMON_URL = 'http://127.0.0.1:4321/';
    try {
      expect(daemonBaseUrl()).toBe('http://127.0.0.1:4321');
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_DF_DAEMON_URL;
      else process.env.NEXT_PUBLIC_DF_DAEMON_URL = original;
    }
  });
});

describe('api · 信封解包', () => {
  it('成功信封取 result', () => {
    expect(readEnvelope<string>({ ok: true, result: 'x' })).toEqual({ ok: true, result: 'x' });
  });

  it('失败信封取错误码与消息（含 details）', () => {
    const result = readEnvelope({
      ok: false,
      error: { code: 'market_asset_not_found', message: '资产不存在', details: { assetId: 'a' } },
    });
    expect(result).toEqual({
      ok: false,
      error: { code: 'market_asset_not_found', message: '资产不存在', details: { assetId: 'a' } },
    });
  });

  it('形状不符一律按失败处理（绝不当成功）', () => {
    expect(readEnvelope(null).ok).toBe(false);
    expect(readEnvelope('boom').ok).toBe(false);
    expect(readEnvelope({}).ok).toBe(false);
  });
});

describe('api · 视图状态归一（空态不伪造数据）', () => {
  it('索引缺失 → index-missing（页面给采集指引）', () => {
    const response = makeMissingIndexResponse([
      { code: 'index-missing', message: '尚无市场索引（等待采集线产出，属正常空态）' },
    ]);
    expect(classifyMarketOutcome(response)).toBe('index-missing');
    expect(classifyWarnings(response.warnings).indexMissing).toBe(true);
  });

  it('索引损坏 → index-invalid；无结果 → no-result', () => {
    expect(
      classifyMarketOutcome(
        makeMissingIndexResponse([{ code: 'index-invalid', message: '索引不兼容' }]),
      ),
    ).toBe('index-invalid');
    expect(classifyMarketOutcome(makeQueryResponse({ items: [], total: 0 }))).toBe('no-result');
  });

  it('有结果且带非索引告警 → partial（部分失败态）', () => {
    expect(
      classifyMarketOutcome(
        makeQueryResponse({ warnings: [{ code: 'partial-failure', message: '部分来源失败' }] }),
      ),
    ).toBe('partial');
  });

  it('有结果无告警 → ok', () => {
    expect(classifyMarketOutcome(makeQueryResponse())).toBe('ok');
  });

  it('检索索引降级（search-index-*）→ searchDegraded；不计 partial，有结果仍是 ok', () => {
    const missing = makeQueryResponse({
      warnings: [{ code: 'search-index-missing', message: '未找到 BM25 检索索引：当前按字面匹配' }],
    });
    expect(classifyWarnings(missing.warnings).searchDegraded).toBe(true);
    expect(classifyWarnings(missing.warnings).partial).toBe(false);
    expect(classifyMarketOutcome(missing)).toBe('ok');

    const invalid = makeQueryResponse({
      items: [],
      total: 0,
      warnings: [{ code: 'search-index-invalid', message: '检索索引不兼容' }],
    });
    expect(classifyWarnings(invalid.warnings).searchDegraded).toBe(true);
    // 空结果仍是 no-result（降级说明由空态附加「暂按字面匹配」），不是索引缺失空态
    expect(classifyMarketOutcome(invalid)).toBe('no-result');
  });

  it('采集指引是 CLI 口径（不假装前端能补数据）', () => {
    expect(MARKET_COLLECT_COMMAND).toContain('df market collect');
    expect(MARKET_COLLECT_COMMAND).toContain('df market index');
  });
});

describe('api · 取数（假 fetch）', () => {
  it('查询以 GET 取信封', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, result: makeQueryResponse() }), { status: 200 }),
    );
    const result = await fetchMarketQuery(
      { q: 'pdf' },
      { baseUrl: 'http://127.0.0.1:4318', fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result.ok).toBe(true);
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toContain('/market/query?q=pdf');
    expect(call[1].method).toBe('GET');
  });

  it('装载提案以 POST 提交 assetId', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: false, error: { code: 'market_asset_not_found', message: '无' } }),
          {
            status: 404,
          },
        ),
    );
    const result = await fetchMarketLoadPlan('gh:acme/skills#x', {
      baseUrl: 'http://127.0.0.1:4318',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('http://127.0.0.1:4318/market/load-plan');
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(String(call[1].body))).toEqual({
      assetId: 'gh:acme/skills#x',
      documentId: null,
    });
  });

  it('daemon 不可达 → 显式失败（不抛异常，不静默空数据）', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const result = await fetchMarketQuery(
      {},
      { baseUrl: 'http://127.0.0.1:4318', fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('daemon_unreachable');
  });

  it('详情未命中 → null（页面渲染「资源不存在」态）', () => {
    expect(assetFromDetail({ found: false, assetId: 'x' })).toBeNull();
    expect(assetFromDetail({ found: true, asset: makeAsset() })?.id).toBe(
      'gh:acme/skills#skills/pdf-export',
    );
  });
});

describe('api · 溯源链接', () => {
  it('拼 GitHub commit 固定链接（路径为空时指仓库根）', () => {
    const asset = makeAsset();
    expect(buildSourceUrl(asset)).toBe(
      'https://github.com/acme/skills/tree/a1b2c3d4e5f60718293a4b5c6d7e8f9012345678/skills/pdf-export',
    );
    const atRoot = makeAsset({ source: { ...asset.source, path: '' } });
    expect(buildSourceUrl(atRoot)).toBe(
      'https://github.com/acme/skills/tree/a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    );
  });

  it('缺 repo/commit → null（不造死链）', () => {
    const asset = makeAsset({ source: { ...makeAsset().source, ref: '' } });
    expect(buildSourceUrl(asset)).toBeNull();
  });
});

describe('api · 信封与内层形状校验（脏数据不静默）', () => {
  it('result 为 null → 判失败（含 result 键但值为空，绝不当成功）', () => {
    const result = readEnvelope({ ok: true, result: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('null');
  });

  it('result 为 undefined（键存在但无值）→ 判失败', () => {
    expect(readEnvelope({ ok: true, result: undefined }).ok).toBe(false);
  });

  it('泛型调用（无形状校验器）仍取 result（字符串等标量合法）', () => {
    expect(readEnvelope<string>({ ok: true, result: 'x' })).toEqual({ ok: true, result: 'x' });
  });

  it('查询响应形状校验：items / warnings 必须为数组，元素必须为对象', () => {
    const base = {
      schema: MARKETPLACE_INDEX_SCHEMA,
      state: 'empty' as const,
      generatedAt: null,
      total: 0,
      counts: null,
      items: [],
      warnings: [],
    };
    expect(validateMarketQueryResponse(base)).toEqual(base);
    // items 为 null / 对象 / 含 null 元素 → 形状坏
    expect(validateMarketQueryResponse({ ...base, items: null })).toBeNull();
    expect(validateMarketQueryResponse({ ...base, items: {} })).toBeNull();
    expect(validateMarketQueryResponse({ ...base, items: [null] })).toBeNull();
    // warnings 为 null / 含 null 元素 → 形状坏（渲染期读 warning.code 会 TypeError）
    expect(validateMarketQueryResponse({ ...base, warnings: null })).toBeNull();
    expect(validateMarketQueryResponse({ ...base, warnings: [null] })).toBeNull();
    // 标量类型不符 → 形状坏
    expect(validateMarketQueryResponse({ ...base, total: '3' })).toBeNull();
    expect(validateMarketQueryResponse({ ...base, state: 'broken' })).toBeNull();
    expect(validateMarketQueryResponse(null)).toBeNull();
    expect(validateMarketQueryResponse('boom')).toBeNull();
  });

  it('取数：result 为 null → 失败信封（码不是 daemon_unreachable，文案可读）', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, result: null }), { status: 200 }),
    );
    const result = await fetchMarketQuery(
      {},
      { baseUrl: 'http://127.0.0.1:4318', fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).not.toBe('daemon_unreachable');
      expect(result.error.message).toContain('null');
    }
  });

  it('取数：warnings 为 null → 失败信封（页面落错误态，不在渲染期抛 TypeError）', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              schema: MARKETPLACE_INDEX_SCHEMA,
              state: 'empty',
              generatedAt: null,
              total: 0,
              counts: null,
              items: [],
              warnings: null,
            },
          }),
          { status: 200 },
        ),
    );
    const result = await fetchMarketQuery(
      {},
      { baseUrl: 'http://127.0.0.1:4318', fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result.ok).toBe(false);
  });

  it('取数：items 为对象而非数组 → 失败信封（不静默当空结果）', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              schema: MARKETPLACE_INDEX_SCHEMA,
              state: 'empty',
              generatedAt: null,
              total: 0,
              counts: null,
              items: {},
              warnings: [],
            },
          }),
          { status: 200 },
        ),
    );
    const result = await fetchMarketQuery(
      {},
      { baseUrl: 'http://127.0.0.1:4318', fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result.ok).toBe(false);
  });

  it('详情响应形状校验：found 缺失 / asset 为 null → 形状坏', () => {
    expect(validateMarketAssetDetail({ found: false, assetId: 'x' })).toEqual({
      found: false,
      assetId: 'x',
    });
    expect(validateMarketAssetDetail({ found: true, asset: makeAsset() })?.found).toBe(true);
    expect(validateMarketAssetDetail(null)).toBeNull();
    expect(validateMarketAssetDetail({})).toBeNull();
    expect(validateMarketAssetDetail({ found: true, asset: null })).toBeNull();
  });

  it('分类函数容错：warnings 为空/脏输入不抛（防渲染期 TypeError 逃逸）', () => {
    expect(classifyWarnings([]).partial).toBe(false);
    // 契约外的脏输入（页面兜底路径）不允许抛
    const dirty = { items: [], warnings: null } as unknown as Parameters<
      typeof classifyMarketOutcome
    >[0];
    expect(classifyMarketOutcome(dirty)).toBe('no-result');
  });
});
