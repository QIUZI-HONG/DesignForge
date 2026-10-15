/**
 * 文档接口客户端测试（FE-02）。
 *
 * 断言口径：HTTP 层对外行为——请求方法/路径/查询串/请求体形状（走 contracts 路由表）、
 * 信封解包（成功取 result、失败抛带码错误）、网络异常归一为 `daemon_unreachable`。
 * 用注入的假 fetch 记录调用（不起真服务）；期望值来自契约（DAEMON_ROUTES / 错误码表）。
 */
import {
  DAEMON_ROUTES,
  type DocumentListResponse,
  type DocumentSummary,
} from '@dforge/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createDocumentsGateway,
  describeApiErrorCode,
  DocumentApiError,
} from './documents';

const BASE = 'http://127.0.0.1:4318';

function summary(id: string, name: string): DocumentSummary {
  return {
    id,
    name,
    directory: `/data/${id}.dfg`,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-15T08:00:00.000Z',
    pageCount: 2,
    sizeBytes: 2048,
  };
}

/** 造一个假 fetch：按调用序返回预置响应，并记录请求。 */
function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  let index = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses[index] ?? responses[responses.length - 1];
    index += 1;
    return {
      ok: (next?.status ?? 200) < 400,
      status: next?.status ?? 200,
      json: async () => next?.body,
    } as Response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const LIST: DocumentListResponse = { documents: [summary('海报-A', '海报 A')], warnings: [] };

describe('createDocumentsGateway.list', () => {
  it('GET /documents 并解出 { documents, warnings }', async () => {
    const { fetchImpl, calls } = fakeFetch([{ body: { ok: true, result: LIST } }]);
    const gateway = createDocumentsGateway({ baseUrl: BASE, fetchImpl });

    await expect(gateway.list()).resolves.toEqual(LIST);
    expect(calls[0]?.url).toBe(`${BASE}${DAEMON_ROUTES.documents.path}`);
    expect(calls[0]?.init?.method).toBe('GET');
  });

  it('路径参数与基础地址都不带多余斜杠', async () => {
    const { fetchImpl, calls } = fakeFetch([{ body: { ok: true, result: LIST } }]);
    const gateway = createDocumentsGateway({ baseUrl: `${BASE}/`, fetchImpl });
    await gateway.list();
    expect(calls[0]?.url).toBe(`${BASE}/documents`);
  });

  it('失败信封 → 抛 DocumentApiError（码来自 daemon）', async () => {
    const { fetchImpl } = fakeFetch([
      { status: 500, body: { ok: false, error: { code: 'internal', message: 'daemon 内部错误' } } },
    ]);
    const gateway = createDocumentsGateway({ baseUrl: BASE, fetchImpl });
    await expect(gateway.list()).rejects.toMatchObject({
      name: 'DocumentApiError',
      code: 'internal',
    });
  });

  it('网络异常 → 归一为 daemon_unreachable', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const gateway = createDocumentsGateway({ baseUrl: BASE, fetchImpl });
    const error = await gateway.list().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(DocumentApiError);
    expect((error as DocumentApiError).code).toBe('daemon_unreachable');
  });

  it('响应不是合法 JSON → 归一为 daemon_unreachable（不把 500 页面当数据）', async () => {
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      }) as unknown as Response) as typeof fetch;
    const gateway = createDocumentsGateway({ baseUrl: BASE, fetchImpl });
    await expect(gateway.list()).rejects.toMatchObject({ code: 'daemon_unreachable' });
  });
});

describe('createDocumentsGateway.create', () => {
  it('POST /documents，JSON 体只带 name，返回新文档摘要', async () => {
    const created = summary('新文档', '新文档');
    const { fetchImpl, calls } = fakeFetch([
      { status: 201, body: { ok: true, result: { document: created } } },
    ]);
    const gateway = createDocumentsGateway({ baseUrl: BASE, fetchImpl });

    await expect(gateway.create('新文档')).resolves.toEqual(created);
    expect(calls[0]?.url).toBe(`${BASE}/documents`);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ name: '新文档' }));
    expect((calls[0]?.init?.headers as Record<string, string>)['content-type']).toContain(
      'application/json',
    );
  });

  it('重名冲突 → 抛码为 doc_exists 的错误（供 UI 提示）', async () => {
    const { fetchImpl } = fakeFetch([
      { status: 409, body: { ok: false, error: { code: 'doc_exists', message: '同名文档已存在' } } },
    ]);
    const gateway = createDocumentsGateway({ baseUrl: BASE, fetchImpl });
    await expect(gateway.create('海报 A')).rejects.toMatchObject({ code: 'doc_exists' });
  });
});

describe('createDocumentsGateway.remove', () => {
  it('DELETE /documents/:id（id 编码后拼入）', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { body: { ok: true, result: { id: '海报 A', deleted: true } } },
    ]);
    const gateway = createDocumentsGateway({ baseUrl: BASE, fetchImpl });

    await expect(gateway.remove('海报 A')).resolves.toEqual({ id: '海报 A', deleted: true });
    expect(calls[0]?.url).toBe(`${BASE}/documents/%E6%B5%B7%E6%8A%A5%20A`);
    expect(calls[0]?.init?.method).toBe('DELETE');
  });

  it('文档不存在 → 抛码为 doc_not_found 的错误', async () => {
    const { fetchImpl } = fakeFetch([
      { status: 404, body: { ok: false, error: { code: 'doc_not_found', message: '文档不存在' } } },
    ]);
    const gateway = createDocumentsGateway({ baseUrl: BASE, fetchImpl });
    await expect(gateway.remove('x')).rejects.toMatchObject({ code: 'doc_not_found' });
  });
});

describe('describeApiErrorCode', () => {
  it('daemon 错误码 → 展示用码（E_DF_ 前缀，供错误态展示）', () => {
    expect(describeApiErrorCode('doc_exists')).toBe('E_DF_DOC_EXISTS');
    expect(describeApiErrorCode('daemon_unreachable')).toBe('E_DF_DAEMON_UNREACHABLE');
  });
});

describe('createDocumentsGateway 其他', () => {
  it('list 的非数组 warnings 容错为空数组（daemon 契约外的脏响应不崩 UI）', async () => {
    const { fetchImpl } = fakeFetch([
      { body: { ok: true, result: { documents: [summary('a', 'A')] } } },
    ]);
    const gateway = createDocumentsGateway({ baseUrl: BASE, fetchImpl });
    const result = await gateway.list();
    expect(result.warnings).toEqual([]);
    expect(result.documents).toHaveLength(1);
  });

  it('fetchImpl 缺省时用全局 fetch', async () => {
    const spy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: LIST }) }) as Response);
    vi.stubGlobal('fetch', spy);
    try {
      const gateway = createDocumentsGateway({ baseUrl: BASE });
      await gateway.list();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
