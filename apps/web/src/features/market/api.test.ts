/**
 * 市场数据面客户端测试（接缝：`@/features/market/api`）。
 *
 * 断言的是**对外行为**：URL 形状与 daemon 路由契约一致、信封解包、视图状态归一。
 * 不测实现细节（不 mock 内部函数），网络一律用假 fetch（不真连 daemon）。
 */

import { MARKETPLACE_INDEX_SCHEMA } from '@dforge/contracts';
import { describe, expect, it, vi } from 'vitest';

import { t } from '@/i18n';
import { resetDaemonEndpointCache } from '@/lib/daemon-endpoint';
import { classifyDaemonFailure } from '@/lib/daemon-failure';

import { makeAsset, makeMissingIndexResponse, makeQueryResponse } from './__fixtures__/market';
import {
  assetFromDetail,
  buildMarketAssetUrl,
  buildMarketInstallUrl,
  buildMarketLoadPlanUrl,
  buildMarketQueryUrl,
  buildSourceUrl,
  classifyMarketOutcome,
  classifyWarnings,
  DEFAULT_DAEMON_URL,
  daemonBaseUrl,
  fetchMarketAsset,
  fetchMarketInstall,
  fetchMarketLoadPlan,
  fetchMarketQuery,
  MARKET_COLLECT_COMMAND,
  makeMarketInstallClient,
  validateMarketAssetDetail,
  validateMarketInstallResponse,
  validateMarketQueryResponse,
} from './api';

describe('api · URL 构造', () => {
  it('查询串按 contracts encodeMarketQuery 口径序列化（kind 逗号连接、loadable=1）', () => {
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

  it('分页覆盖参数（options.limit/offset）优先于 params 且不丢其他参数', () => {
    const url = buildMarketQueryUrl(
      'http://127.0.0.1:4318',
      { q: '图标', limit: 60 },
      { limit: 12, offset: 24 },
    );
    const search = new URL(url).searchParams;
    expect(search.get('q')).toBe('图标');
    expect(search.get('limit')).toBe('12');
    expect(search.get('offset')).toBe('24');
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

describe('api · 默认路径端口窗探测（评审 F3）', () => {
  it('无注入 baseUrl → 异步解析：4318 不健康、4319 健康时请求打到 4319', async () => {
    // 旧实现用 resolveDaemonEndpointSync()（缺省 4318、不探测），端口漂移时整块市场不可用。
    resetDaemonEndpointCache();
    vi.stubEnv('NEXT_PUBLIC_DF_DAEMON_URL', '');
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/health')) {
        return new Response('{}', { status: url.includes(':4319') ? 200 : 503 });
      }
      return new Response(JSON.stringify({ ok: true, result: makeQueryResponse() }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const result = await fetchMarketQuery({ q: 'pdf' }, { fetchImpl });
      expect(result.ok).toBe(true);
      const marketCall = calls.find((url) => url.includes('/market/query'));
      expect(marketCall?.startsWith('http://127.0.0.1:4319')).toBe(true);
    } finally {
      resetDaemonEndpointCache();
      vi.unstubAllEnvs();
    }
  });
});

describe('api · 信封解包（fetch 路径 · 票 #130 单信封栈）', () => {
  const ENVELOPE_BASE = 'http://127.0.0.1:4318';

  it('成功信封取 result（MarketEnvelope 形状不变）', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, result: makeQueryResponse() }), { status: 200 }),
    );
    const result = await fetchMarketQuery(
      { q: 'pdf' },
      { baseUrl: ENVELOPE_BASE, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result).toEqual({ ok: true, result: makeQueryResponse() });
  });

  it('daemon 业务错误信封：原码透传 + details 保留（不归一、不换码）', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: 'market_asset_not_found',
              message: '资产不存在',
              details: { assetId: 'a' },
            },
          }),
          { status: 404 },
        ),
    );
    const result = await fetchMarketAsset('gh:no/such#x', {
      baseUrl: ENVELOPE_BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'market_asset_not_found',
        message: '资产不存在',
        details: { assetId: 'a' },
      },
    });
  });

  it('响应体不是可用信封（null 体 / 纯文本 / 空对象）→ 判失败且归一 daemon_unreachable', async () => {
    // 反代错页族（评审 F4）：上游答不出可用信封，与「服务不可达」同一用户动作
    // （确认服务 / 重试）。直测迁为 fetch 路径（原 readEnvelope 直测锁的是生产不走的分支）。
    const bodies: Array<[string, string]> = [
      ['JSON null 体', 'null'],
      ['纯文本体', 'boom'],
      ['空对象体', '{}'],
    ];
    for (const [name, body] of bodies) {
      const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));
      const result = await fetchMarketQuery(
        { q: 'pdf' },
        { baseUrl: ENVELOPE_BASE, fetchImpl: fetchImpl as unknown as typeof fetch },
      );
      expect(result.ok, name).toBe(false);
      if (!result.ok) expect(result.error.code, name).toBe('daemon_unreachable');
    }
  });

  it('{ok:true} 缺 result 键 → daemon_unreachable（脏信封绝不当成功；JSON 下 result:undefined 同形）', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const result = await fetchMarketQuery(
      {},
      { baseUrl: ENVELOPE_BASE, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('daemon_unreachable');
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
    if (!result.ok) {
      expect(result.error.code).toBe('daemon_unreachable');
      // 客户端层只透传原始错误（票 06 / P1-2）：不在这里拼界面文案，人话由展示层归类生成
      expect(result.error.message).toBe('ECONNREFUSED');
    }
  });

  it('反代 502 HTML（非 JSON）→ daemon_unreachable（网络族），message/details 保留技术细节', async () => {
    // 故障形态：同源网关把 daemon 失联代理成 502，正文是 HTML 而不是信封。
    // 旧码：transport 的 daemon_bad_response 原样透出 → 市场错误态落「非网络族」，
    // 用户看到的是技术串而不是「确认服务已启动 / 重试」。
    const fetchImpl = vi.fn(
      async () =>
        new Response('<html>502 Bad Gateway</html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
    );
    const result = await fetchMarketQuery(
      { q: 'pdf' },
      { baseUrl: 'http://127.0.0.1:4318', fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('daemon_unreachable');
    // 技术细节保留（便于诊断），不换成拼给人看的界面文案
    expect(result.error.message.length).toBeGreaterThan(0);
    expect(result.error.details).toEqual({ reason: 'invalid-json' });
    expect(
      classifyDaemonFailure({ message: result.error.message, code: result.error.code }).isNetwork,
    ).toBe(true);
  });

  it('HTTP 有响应的 4xx/5xx 线上码照旧透传（不被 F4 一并归一）', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: false, error: { code: 'market_asset_not_found', message: '无' } }),
          { status: 404, headers: { 'content-type': 'application/json' } },
        ),
    );
    const result = await fetchMarketAsset('gh:no/such#x', {
      baseUrl: 'http://127.0.0.1:4318',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('market_asset_not_found');
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
  it('取数：{ok:true,result:null} → daemon_bad_response（invalid-shape 保留族，绝不归一 unreachable）', async () => {
    // 直测迁为 fetch 路径（票 #130）：{ok:true,result:undefined} 经 JSON 序列化与
    // 缺 result 键同形（→ daemon_unreachable，见上组用例）；result:null 键在值空，
    // transport validate 谓词判形失败 → invalid-shape，归一判据方向性保守：保留原码。
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, result: null }), { status: 200 }),
    );
    const result = await fetchMarketQuery(
      {},
      { baseUrl: 'http://127.0.0.1:4318', fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('daemon_bad_response');
      // 传输层判形理由进 details（诊断保留）；文案走 transport i18n 键，适配层不拼裸串
      expect(result.error.details).toEqual({ reason: 'invalid-shape' });
      expect(result.error.message).toBe(t('daemon.transport.invalidShape'));
    }
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

  it('取数：warnings 为 null → daemon_bad_response（页面落错误态，不在渲染期抛 TypeError）', async () => {
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
    if (!result.ok) expect(result.error.code).toBe('daemon_bad_response');
  });

  it('取数：items 为对象而非数组 → daemon_bad_response（形状不符不归一，绝不静默当空结果）', async () => {
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
    if (!result.ok) {
      expect(result.error.code).toBe('daemon_bad_response');
      expect(result.error.details).toEqual({ reason: 'invalid-shape' });
    }
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

describe('api · 装载安装客户端（票③ market-load-loop）', () => {
  const INSTALL_RESPONSE = {
    schema: MARKETPLACE_INDEX_SCHEMA,
    assetId: 'gh:acme/skills#skills/pdf-export',
    kind: 'skill',
    slug: 'pdf-export',
    targetPath: '.dfg/market/skill/pdf-export/',
    digest: 'sha256:9f2c',
    files: ['SKILL.md', 'references/notes.md'],
    loadedAt: '2026-11-08T00:00:00.000Z',
    auditId: 'audit_1',
  };

  it('装载安装路径取契约路由表（POST /market/install）', () => {
    expect(buildMarketInstallUrl('http://127.0.0.1:4318')).toBe(
      'http://127.0.0.1:4318/market/install',
    );
  });

  it('响应形状校验：缺 digest/files/loadedAt 等任一字段即 null（不给渲染路径脏数据）', () => {
    expect(validateMarketInstallResponse(INSTALL_RESPONSE)).not.toBeNull();
    for (const key of ['digest', 'files', 'loadedAt', 'targetPath', 'assetId', 'schema']) {
      const broken: Record<string, unknown> = { ...INSTALL_RESPONSE };
      delete broken[key];
      expect(validateMarketInstallResponse(broken)).toBeNull();
    }
    expect(validateMarketInstallResponse(null)).toBeNull();
    expect(validateMarketInstallResponse('nope')).toBeNull();
  });

  it('fetchMarketInstall 以 POST 提交 assetId+ackToken，并经形状校验解包', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, result: INSTALL_RESPONSE }), { status: 200 }),
    );
    const result = await fetchMarketInstall(
      { assetId: 'gh:acme/skills#skills/pdf-export', ackToken: 'tok-1' },
      { baseUrl: 'http://127.0.0.1:4318', fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.digest).toBe('sha256:9f2c');
    expect(result.result.loadedAt).toBe('2026-11-08T00:00:00.000Z');
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('http://127.0.0.1:4318/market/install');
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(String(call[1].body))).toEqual({
      assetId: 'gh:acme/skills#skills/pdf-export',
      ackToken: 'tok-1',
    });
  });

  it('daemon 拒绝（market_install_*）原样透传错误码；形状坏响应归一 daemon_bad_response', async () => {
    const rejected = await fetchMarketInstall(
      { assetId: 'a', ackToken: 't' },
      {
        baseUrl: 'http://127.0.0.1:4318',
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({
              ok: false,
              error: { code: 'market_install_digest_mismatch', message: '不符' },
            }),
            { status: 422 },
          )) as unknown as typeof fetch,
      },
    );
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error.code).toBe('market_install_digest_mismatch');

    const malformed = await fetchMarketInstall(
      { assetId: 'a', ackToken: 't' },
      {
        baseUrl: 'http://127.0.0.1:4318',
        fetchImpl: (async () =>
          new Response(JSON.stringify({ ok: true, result: { assetId: 'a' } }), {
            status: 200,
          })) as unknown as typeof fetch,
      },
    );
    expect(malformed.ok).toBe(false);
    if (malformed.ok) return;
    expect(malformed.error.code).toBe('daemon_bad_response');
  });

  it('makeMarketInstallClient：信封 → 装载会话 outcome（成功取真值，失败取码）', async () => {
    const okClient = makeMarketInstallClient({
      baseUrl: 'http://127.0.0.1:4318',
      fetchImpl: (async () =>
        new Response(JSON.stringify({ ok: true, result: INSTALL_RESPONSE }), {
          status: 200,
        })) as unknown as typeof fetch,
    });
    const ok = await okClient({ assetId: 'a', ackToken: 't' });
    expect(ok).toEqual({
      ok: true,
      digest: 'sha256:9f2c',
      loadedAt: '2026-11-08T00:00:00.000Z',
      targetPath: '.dfg/market/skill/pdf-export/',
      files: ['SKILL.md', 'references/notes.md'],
    });

    const failClient = makeMarketInstallClient({
      baseUrl: 'http://127.0.0.1:4318',
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: 'market_install_source_unavailable', message: '缺凭据' },
          }),
          { status: 503 },
        )) as unknown as typeof fetch,
    });
    const fail = await failClient({ assetId: 'a', ackToken: 't' });
    expect(fail).toEqual({
      ok: false,
      code: 'market_install_source_unavailable',
      message: '缺凭据',
    });
  });
});
