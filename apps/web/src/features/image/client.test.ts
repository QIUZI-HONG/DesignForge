/**
 * 出图端口测试（seam：注入 fetch 后的请求面与解包语义）。
 *
 * 关键断言：提交失败的 details（actions/missing/available）必须原样透给 UI 层
 * （未启动/缺模型态的「提示与动作」全靠它）。
 */
import { describe, expect, it, vi } from 'vitest';

import { createImagePort, DaemonRequestError } from './client';
import { failureOf } from './failure';

function jsonResponse(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status });
}

describe('出图端口', () => {
  it('submit：POST /image/runs 并解包任务句柄', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { runId: 'run-9', state: 'queued', queuePosition: null, etaMsHint: null },
          202,
        ),
      );
    const port = createImagePort({ baseUrl: 'http://127.0.0.1:4318', fetchImpl });
    const handle = await port.submit({ inputs: { positive: 'icon', width: 768 } });
    expect(handle.runId).toBe('run-9');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:4318/image/runs');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ inputs: { positive: 'icon', width: 768 } });
  });

  it('未启动失败：错误码与 actions/missing/available 完整落到 UI 视图', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: 'comfy_unreachable',
            message: '未检测到本地 ComfyUI 服务（http://127.0.0.1:59999）',
            details: { actions: ['retry-probe', 'set-base-url'], missing: [], available: [] },
          },
        }),
        { status: 503 },
      ),
    );
    const port = createImagePort({ baseUrl: 'http://127.0.0.1:4318', fetchImpl });
    const error = await port
      .submit({ inputs: { positive: 'icon' } })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DaemonRequestError);
    const view = failureOf(error);
    expect(view.code).toBe('comfy_unreachable');
    expect(view.actions).toEqual(['retry-probe', 'set-base-url']);
  });

  it('status/cancel：路径参数被编码，方法正确', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse({ runId: 'a b', state: 'canceled' })));
    const port = createImagePort({ baseUrl: 'http://127.0.0.1:4318', fetchImpl });
    await port.status('a b');
    await port.cancel('a b');
    const [firstCall, secondCall] = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(firstCall?.[0]).toBe('http://127.0.0.1:4318/image/runs/a%20b');
    expect(firstCall?.[1].method).toBe('GET');
    expect(secondCall?.[0]).toBe('http://127.0.0.1:4318/image/runs/a%20b/cancel');
    expect(secondCall?.[1].method).toBe('POST');
  });

  it('非 daemon 异常也映射为可渲染视图（内部错误兜底）', () => {
    const view = failureOf(new Error('网络中断'));
    expect(view.code).toBe('internal');
    expect(view.message).toBe('网络中断');
  });
});
