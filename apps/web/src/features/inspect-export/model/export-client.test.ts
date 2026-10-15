/**
 * 导出客户端（daemon `POST /export`）规格。
 *
 * 断言的是**对外契约**：请求形状（路由/字段/PNG 才带 scale）、成功解包（artifact）、
 * 失败解包（错误码 + 文案）、进程不可达（离线码）、超时——面板据这些分支出错误态与重试。
 */

import { DAEMON_PORT_BASE, DAEMON_ROUTES } from '@dforge/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createExportClient } from './export-client';

/** 构造一个 JSON 响应（只用到 fetch 契约的最小面）。 */
function jsonResponse(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

/** 造一份合法的导出产物（形状按 @dforge/contracts）。 */
function artifactPayload(): Record<string, unknown> {
  return {
    format: 'png',
    mimeType: 'image/png',
    fileName: 'export_p1.png',
    length: 1234,
    sha256: 'a'.repeat(64),
    base64: 'iVBORw0KGgo=',
    filePath: '/tmp/exports/export_p1.png',
  };
}

describe('createExportClient · 请求形状', () => {
  it('POST 到契约路由，缺省基址为 daemon 端口基准', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { ok: true, result: { artifact: artifactPayload() } }),
    );
    const client = createExportClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.exportDocument({ documentId: 'doc1', pageId: 'p1', format: 'svg' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://127.0.0.1:${DAEMON_PORT_BASE}${DAEMON_ROUTES.exportDocument.path}`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      documentId: 'doc1',
      pageId: 'p1',
      format: 'svg',
    });
  });

  it('PNG 才带 scale（SVG/PDF 为矢量，不带多余字段）', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { ok: true, result: { artifact: artifactPayload() } }),
    );
    const client = createExportClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.exportDocument({ documentId: 'doc1', pageId: 'p1', format: 'png', scale: 2 });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      documentId: 'doc1',
      pageId: 'p1',
      format: 'png',
      scale: 2,
    });
  });

  it('自定义基址（宿主经配置注入）', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { ok: true, result: { artifact: artifactPayload() } }),
    );
    const client = createExportClient({
      baseUrl: 'http://127.0.0.1:9999',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.exportDocument({ documentId: 'doc1', pageId: 'p1', format: 'pdf' });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe('http://127.0.0.1:9999/export');
  });
});

describe('createExportClient · 结果解包', () => {
  it('成功：返回产物（含 length / sha256，供证据引用）', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        ok: true,
        result: { artifact: artifactPayload(), skippedNodes: 0, maxScale: 4 },
      }),
    );
    const client = createExportClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const outcome = await client.exportDocument({
      documentId: 'doc1',
      pageId: 'p1',
      format: 'png',
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('应成功');
    expect(outcome.artifact.length).toBe(1234);
    expect(outcome.artifact.sha256).toHaveLength(64);
    expect(outcome.artifact.mimeType).toBe('image/png');
  });

  it('daemon 500（渲染失败）：解包错误码与文案', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(500, {
        ok: false,
        error: { code: 'export_render_failed', message: '渲染失败：坏数据' },
      }),
    );
    const client = createExportClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const outcome = await client.exportDocument({
      documentId: 'doc1',
      pageId: 'p1',
      format: 'pdf',
    });
    expect(outcome).toEqual({
      ok: false,
      code: 'export_render_failed',
      message: '渲染失败：坏数据',
    });
  });

  it('进程不可达（fetch 抛错）：离线码（面板据此出「本地服务未启动」）', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const client = createExportClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const outcome = await client.exportDocument({
      documentId: 'doc1',
      pageId: 'p1',
      format: 'png',
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('应失败');
    expect(outcome.code).toBe('daemon_offline');
    expect(outcome.message).toContain('fetch failed');
  });

  it('响应不是合法信封：给出 invalid_response（不静默成功）', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { hello: 'world' }));
    const client = createExportClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const outcome = await client.exportDocument({
      documentId: 'doc1',
      pageId: 'p1',
      format: 'png',
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('应失败');
    expect(outcome.code).toBe('daemon_invalid_response');
  });
});

describe('createExportClient · 超时', () => {
  it('超时：给出 timeout 码（不悬挂）', async () => {
    const fetchImpl = vi.fn(
      () => new Promise<Response>(() => undefined), // 永不结算
    );
    const client = createExportClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 20,
    });
    const outcome = await client.exportDocument({
      documentId: 'doc1',
      pageId: 'p1',
      format: 'png',
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('应失败');
    expect(outcome.code).toBe('timeout');
  });
});
