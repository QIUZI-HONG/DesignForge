/**
 * 对抗测试（验证方 test/verify-web-b）· 首页文档网关的**异常数据面**穷举。
 *
 * 风险点（任务书 §1）：daemon 不可达 / 超时 / 坏 JSON / 信封字段缺失 / HTTP 4xx-5xx——
 * 每一类都要有**明确出口**：不崩（无未捕获异常）、不静默造数据、错误可读。
 * 本文件只消费公开 API（`createDocumentsGateway`），不改产品代码。
 */
import { describe, expect, it, vi } from 'vitest';

import { createDocumentsGateway, DocumentApiError, describeApiErrorCode } from './documents';

/** 造一个返回给定响应的假 fetch。 */
function fetchReturning(response: Response): typeof fetch {
  return (async () => response) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function gateway(fetchImpl: typeof fetch) {
  return createDocumentsGateway({ baseUrl: 'http://127.0.0.1:4399', fetchImpl });
}

describe('对抗 · 传输层异常归一', () => {
  it('daemon 不可达（fetch 抛错）→ daemon_unreachable，文案给启动引导', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(gateway(fetchImpl).list()).rejects.toMatchObject({
      code: 'daemon_unreachable',
    });
    await expect(gateway(fetchImpl).list()).rejects.toThrow(/daemon 未启动/);
  });

  it('HTTP 500 + HTML 正文（坏 JSON）→ daemon_unreachable「无法解析」，不抛 SyntaxError', async () => {
    const response = new Response('<html>500 Internal Server Error</html>', {
      status: 500,
      headers: { 'content-type': 'text/html' },
    });
    const error = await gateway(fetchReturning(response))
      .list()
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(DocumentApiError);
    expect((error as DocumentApiError).code).toBe('daemon_unreachable');
    expect((error as DocumentApiError).message).toContain('无法解析');
  });

  it('HTTP 404 + 失败信封 → 透传 daemon 错误码（不信 HTTP 状态，只信信封）', async () => {
    const response = jsonResponse(
      { ok: false, error: { code: 'not_found', message: '路由不存在' } },
      404,
    );
    await expect(gateway(fetchReturning(response)).list()).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('HTTP 200 但信封是失败（daemon 内部错误）→ 透传 internal 与原文', async () => {
    const response = jsonResponse(
      { ok: false, error: { code: 'internal', message: 'daemon 内部错误' } },
      200,
    );
    const error = await gateway(fetchReturning(response))
      .list()
      .catch((cause: unknown) => cause);
    expect((error as DocumentApiError).code).toBe('internal');
    expect((error as DocumentApiError).message).toBe('daemon 内部错误');
  });

  it('信封缺 result（{ok:true}）→ 视为未知形状，绝不当作成功', async () => {
    const response = jsonResponse({ ok: true });
    const error = await gateway(fetchReturning(response))
      .list()
      .catch((cause: unknown) => cause);
    expect((error as DocumentApiError).code).toBe('daemon_unreachable');
    expect((error as DocumentApiError).message).toContain('未知形状');
  });

  it('result 字段缺失/类型错（documents 非数组、warnings 缺失）→ 退化为空列表，不崩', async () => {
    const noWarnings = jsonResponse({ ok: true, result: { documents: [] } });
    await expect(gateway(fetchReturning(noWarnings)).list()).resolves.toEqual({
      documents: [],
      warnings: [],
    });

    const garbage = jsonResponse({ ok: true, result: { documents: 'not-an-array' } });
    await expect(gateway(fetchReturning(garbage)).list()).resolves.toEqual({
      documents: [],
      warnings: [],
    });
  });

  it('result 为 null → 目前不是 DocumentApiError（TypeError 逃逸出网关）', async () => {
    // 记录性断言：`{ok:true,result:null}` 能过 isApiSuccess（含 'result' 键），
    // 随后 `result.documents` 抛 TypeError。HomeView 侧把它兜成 daemon_unreachable，
    // 但任何直接消费网关的调用方都要自己接住 TypeError——错误类型未归一。
    const response = jsonResponse({ ok: true, result: null });
    await expect(gateway(fetchReturning(response)).list()).rejects.toThrow(TypeError);
  });

  it('daemon 不响应（请求悬挂）→ 网关没有超时，Promise 永久 pending（UI 停在骨架）', async () => {
    const never = (async () => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    let settled = false;
    void gateway(never)
      .list()
      .then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(settled).toBe(false); // 无 AbortSignal/超时：卡住即永久 loading
  });

  it('删除接口同样归一（坏 JSON → daemon_unreachable）', async () => {
    const response = new Response('not json', { status: 502 });
    await expect(gateway(fetchReturning(response)).remove('doc-1')).rejects.toMatchObject({
      code: 'daemon_unreachable',
    });
  });

  it('展示码口径：E_DF_ 前缀 + 大写下划线（错误态可核对）', () => {
    expect(describeApiErrorCode('daemon_unreachable')).toBe('E_DF_DAEMON_UNREACHABLE');
    expect(describeApiErrorCode('doc_not_found')).toBe('E_DF_DOC_NOT_FOUND');
  });

  it('请求头与路径：GET 列表带 accept；创建带 content-type 与 JSON 体', async () => {
    const calls: { url: string; init?: RequestInit | undefined }[] = [];
    const recording = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return jsonResponse({ ok: true, result: { documents: [], warnings: [] } });
    }) as unknown as typeof fetch;
    await gateway(recording).list();
    expect(calls[0]?.url).toBe('http://127.0.0.1:4399/documents');
    expect(calls[0]?.init?.method).toBe('GET');
  });
});

describe('对抗 · 网关参数边界', () => {
  it('baseUrl 尾斜杠不产生双斜杠路径', async () => {
    const seen: string[] = [];
    const recording = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return jsonResponse({ ok: true, result: { documents: [], warnings: [] } });
    }) as unknown as typeof fetch;
    const client = createDocumentsGateway({
      baseUrl: 'http://127.0.0.1:4399/',
      fetchImpl: recording,
    });
    await client.list();
    expect(seen[0]).toBe('http://127.0.0.1:4399/documents');
  });

  it('文档 id 走路径编码（避免路径穿越式注入）', async () => {
    const seen: string[] = [];
    const recording = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return jsonResponse({ ok: true, result: { id: 'x', deleted: true } });
    }) as unknown as typeof fetch;
    await gateway(recording).remove('../../../etc/passwd');
    expect(seen[0]).not.toContain('../');
    expect(seen[0]).toContain('..%2F');
  });

  it('create 的名字原样进请求体（不本地改写，服务端仍是唯一真源）', async () => {
    const bodies: unknown[] = [];
    const recording = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(init?.body);
      return jsonResponse({ ok: true, result: { document: { id: 'a', name: 'a' } } }, 201);
    }) as unknown as typeof fetch;
    await gateway(recording).create('含空格 与表情🙂');
    expect(String(bodies[0])).toContain('含空格 与表情🙂');
    void vi.fn();
  });
});
