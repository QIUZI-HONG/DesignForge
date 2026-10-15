/**
 * daemon 客户端测试（FE-09 · 设置数据面）。
 *
 * 断言角度：外部可观测行为——请求落点（URL/方法/体）、信封解包结果、
 * 失败路径的错误形状（api / network 两类）、以及「凭据永不以明文回流」的硬约束。
 * 假 fetch 记录调用（不出网）；期望值一律写死（不按实现口径重算）。
 */
import { DAEMON_PORT_BASE, DAEMON_ROUTES } from '@dforge/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDaemonClient, DaemonClientError, resolveDaemonBaseUrl } from './daemon-client';
import { createSettingsApi } from './settings-api';

const BASE = `http://127.0.0.1:${String(DAEMON_PORT_BASE)}`;

/** 请求记录。 */
interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

/** 造一个记录调用的假 fetch。 */
function makeFetch(handler: (call: RecordedCall) => Response | Promise<Response>): {
  calls: RecordedCall[];
  fetchImpl: typeof fetch;
} {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    const call: RecordedCall = { url, method: init?.method ?? 'GET', body };
    calls.push(call);
    return handler(call);
  };
  return { calls, fetchImpl };
}

/** JSON 响应。 */
function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveDaemonBaseUrl', () => {
  it('默认指向本地 daemon 端口起点（与契约 DAEMON_PORT_BASE 一致）', () => {
    vi.stubEnv('NEXT_PUBLIC_DF_DAEMON_URL', '');
    expect(resolveDaemonBaseUrl()).toBe(BASE);
  });

  it('环境变量可覆盖，并去掉尾部斜杠（避免拼出 //）', () => {
    vi.stubEnv('NEXT_PUBLIC_DF_DAEMON_URL', `${BASE}/`);
    expect(resolveDaemonBaseUrl()).toBe(BASE);
  });
});

describe('daemon 请求：信封解包与错误形状', () => {
  it('成功信封 { ok: true, result } 解包为 result', async () => {
    const { calls, fetchImpl } = makeFetch(() =>
      jsonResponse({ ok: true, result: { hello: '世界' } }),
    );
    const client = createDaemonClient({ fetchImpl });
    await expect(client.request(DAEMON_ROUTES.health)).resolves.toEqual({ hello: '世界' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}/health`);
    expect(calls[0]?.method).toBe('GET');
  });

  it('失败信封抛 kind=api 错误，携带错误码 / 文案 / 状态码', async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse(
        { ok: false, error: { code: 'config_invalid', message: '工作目录不可写：/root/x' } },
        400,
      ),
    );
    const client = createDaemonClient({ fetchImpl });
    const error: unknown = await client
      .request(DAEMON_ROUTES.configUpdate)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DaemonClientError);
    const typed = error as DaemonClientError;
    expect(typed.kind).toBe('api');
    expect(typed.code).toBe('config_invalid');
    expect(typed.message).toBe('工作目录不可写：/root/x');
    expect(typed.status).toBe(400);
  });

  it('daemon 未启动（fetch 抛错）抛 kind=network 错误，不吞异常', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const client = createDaemonClient({ fetchImpl });
    const error: unknown = await client.request(DAEMON_ROUTES.config).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DaemonClientError);
    const typed = error as DaemonClientError;
    expect(typed.kind).toBe('network');
    expect(typed.code).toBeNull();
  });

  it('非 JSON 响应体按 network 类故障处理（网关/代理异常响应）', async () => {
    const { fetchImpl } = makeFetch(
      () => new Response('<html>bad gateway</html>', { status: 502 }),
    );
    const client = createDaemonClient({ fetchImpl });
    const error: unknown = await client.request(DAEMON_ROUTES.config).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DaemonClientError);
    expect((error as DaemonClientError).kind).toBe('network');
  });
});

describe('settings api：端点落点与载荷', () => {
  it('loadConfig 读 GET /config（配置 + 凭据摘要）', async () => {
    const payload = {
      config: {
        workspaceDir: '/home/u/设界',
        ai: { provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' },
        comfy: { baseUrl: 'http://127.0.0.1:8188', installPath: null },
        telemetry: { enabled: true },
      },
      credentials: {
        deepseek: {
          provider: 'deepseek',
          hasKey: true,
          maskedKey: 'sk-…abcd',
          source: 'stored',
          updatedAt: '2026-10-15T08:00:00.000Z',
        },
      },
    };
    const { calls, fetchImpl } = makeFetch(() => jsonResponse({ ok: true, result: payload }));
    const api = createSettingsApi(createDaemonClient({ fetchImpl }));
    const result = await api.loadConfig();
    expect(result.config.workspaceDir).toBe('/home/u/设界');
    expect(result.credentials.deepseek.maskedKey).toBe('sk-…abcd');
    expect(calls[0]?.url).toBe(`${BASE}/config`);
  });

  it('patchConfig 走 PUT /config，只发局部补丁', async () => {
    const { calls, fetchImpl } = makeFetch(() =>
      jsonResponse({ ok: true, result: { config: {}, credentials: {} } }),
    );
    const api = createSettingsApi(createDaemonClient({ fetchImpl }));
    await api.patchConfig({ telemetry: { enabled: false } });
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.url).toBe(`${BASE}/config`);
    expect(calls[0]?.body).toEqual({ telemetry: { enabled: false } });
  });

  it('setApiKey 走 PUT /config/credentials：请求携带新 key，但返回结构只有掩码', async () => {
    const rawKey = 'sk-abcdefgh12345678';
    const { calls, fetchImpl } = makeFetch(() =>
      jsonResponse({
        ok: true,
        result: {
          summary: {
            provider: 'deepseek',
            hasKey: true,
            maskedKey: 'sk-…5678',
            source: 'stored',
            updatedAt: '2026-10-15T08:00:00.000Z',
          },
        },
      }),
    );
    const api = createSettingsApi(createDaemonClient({ fetchImpl }));
    const summary = await api.setApiKey(rawKey);
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.url).toBe(`${BASE}/config/credentials`);
    expect(calls[0]?.body).toEqual({ apiKey: rawKey });
    expect(summary.maskedKey).toBe('sk-…5678');
    expect(JSON.stringify(summary)).not.toContain(rawKey);
  });

  it('clearApiKey 走 DELETE /config/credentials', async () => {
    const { calls, fetchImpl } = makeFetch(() =>
      jsonResponse({
        ok: true,
        result: {
          cleared: true,
          summary: {
            provider: 'deepseek',
            hasKey: false,
            maskedKey: null,
            source: null,
            updatedAt: null,
          },
        },
      }),
    );
    const api = createSettingsApi(createDaemonClient({ fetchImpl }));
    const summary = await api.clearApiKey();
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toBe(`${BASE}/config/credentials`);
    expect(summary.hasKey).toBe(false);
  });

  it('checkConnectivity 走 POST /config/connectivity，返回逐项状态', async () => {
    const report = {
      checkedAt: '2026-10-15T08:00:00.000Z',
      items: [
        { id: 'daemon', label: '本地服务', status: 'ok', detail: null, actions: [], code: null },
        {
          id: 'comfyui',
          label: 'ComfyUI 出图',
          status: 'unavailable',
          detail: '未检测到本地服务',
          actions: ['retry-probe'],
          code: 'comfy_unreachable',
        },
      ],
    };
    const { calls, fetchImpl } = makeFetch(() => jsonResponse({ ok: true, result: report }));
    const api = createSettingsApi(createDaemonClient({ fetchImpl }));
    const result = await api.checkConnectivity();
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe(`${BASE}/config/connectivity`);
    expect(result.items.map((item) => item.status)).toEqual(['ok', 'unavailable']);
  });

  it('listDocuments 走 GET /documents；createDocument 走 POST /documents { name }', async () => {
    const summary = {
      id: '示例设计',
      name: '示例设计',
      directory: '/home/u/设界/示例设计.dfg',
      createdAt: '2026-10-15T08:00:00.000Z',
      updatedAt: '2026-10-15T08:00:00.000Z',
      pageCount: 1,
      sizeBytes: 128,
    };
    const { calls, fetchImpl } = makeFetch((call) =>
      call.method === 'POST'
        ? jsonResponse({ ok: true, result: { document: summary } }, 201)
        : jsonResponse({ ok: true, result: { documents: [], warnings: [] } }),
    );
    const api = createSettingsApi(createDaemonClient({ fetchImpl }));
    const list = await api.listDocuments();
    expect(list.documents).toEqual([]);
    expect(calls[0]?.url).toBe(`${BASE}/documents`);
    const created = await api.createDocument('示例设计');
    expect(calls[1]?.method).toBe('POST');
    expect(calls[1]?.body).toEqual({ name: '示例设计' });
    expect(created.id).toBe('示例设计');
    expect(created.directory).toBe('/home/u/设界/示例设计.dfg');
  });

  it('api 失败向上原样抛出（调用方按 code 分支）', async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse(
        { ok: false, error: { code: 'credential_invalid', message: 'API key 形态不合法' } },
        400,
      ),
    );
    const api = createSettingsApi(createDaemonClient({ fetchImpl }));
    const error: unknown = await api.setApiKey('sk-short').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DaemonClientError);
    expect((error as DaemonClientError).code).toBe('credential_invalid');
  });
});
