/**
 * documents-client 请求超时测试（audit-d04 · D-04 / J9 数据面红转绿）。
 *
 * J9 实证（audit-2026-11）：保存链 fetch 无 AbortController，请求挂 30s 顶栏恒
 * 「保存中…」——用户既没有错误也没有重试入口。本文件钉住修复后的外部行为：
 * - fetch 替身**永不落定**（daemon 活着但不响应 / 网线被拔的挂死形态）→ 注入小上限后
 *   保存调用必须**有界失败**，错误文案是超时人话（含「请求超时」），且被
 *   `classifyDaemonFailure` 归入网络族（保存态据此渲染统一人话 + 可重试）；
 * - 到点必须真取消在飞请求（替身观察到 signal abort——真实 fetch 据此释放连接）；
 * - 失败后重试可恢复（替身恢复落定 → 保存成功）。
 * 上限经 `timeoutMs` 选项注入（生产缺省 `DAEMON_REQUEST_TIMEOUT_MS`=30s，测试不等真值）。
 */
import { describe, expect, it } from 'vitest';

import { classifyDaemonFailure } from '@/lib/daemon-failure';
import { DAEMON_REQUEST_TIMEOUT_MS } from '@/lib/request-timeout';

import { createDocumentsClient } from './documents-client';

/** 永不落定、但观察到 abort 的 fetch 替身（模拟 daemon 活着但不响应）。 */
function hangingFetch(state: { aborted: boolean }): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    void input;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        state.aborted = true;
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
      // 既不 resolve 也不 reject：调用方只能靠超时上限脱身（正是 J9 的挂死形态）
    });
  }) as typeof fetch;
}

/** 正常 daemon 信封（PUT 页正文成功）。 */
function okEnvelope(): Response {
  return new Response(JSON.stringify({ ok: true, result: { pageId: 'page-1' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** 前一半请求挂死、之后恢复正常的 fetch 替身（验证「超时后重试可恢复」）。 */
function hangThenRecoverFetch(
  hang: { remaining: number },
  state: { aborted: boolean },
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (hang.remaining > 0) {
      hang.remaining -= 1;
      return hangingFetch(state)(input, init);
    }
    return Promise.resolve(okEnvelope());
  }) as typeof fetch;
}

describe('documents-client 请求超时（audit-d04 · D-04 / J9 数据面）', () => {
  it('请求永不落定 → 注入上限后有界失败：错误含「请求超时」且归网络族（统一人话形态）', async () => {
    const state = { aborted: false };
    const client = createDocumentsClient({
      baseUrl: 'http://daemon.test',
      fetchImpl: hangingFetch(state),
      timeoutMs: 120,
    });

    const startedAt = Date.now();
    const result = await client.savePage('doc_1', 'page-1', { body: {} });
    const elapsed = Date.now() - startedAt;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('请求超时');
    expect(result.error).toContain('请稍后重试');
    // 归网络族：保存态据此渲染 editor.save.failed.network 统一文案（D-10 单形态）
    expect(classifyDaemonFailure({ message: result.error }).isNetwork).toBe(true);
    // 有界：远小于 5s 测试超时（注入 120ms 上限生效，不是永久 pending）
    expect(elapsed).toBeLessThan(4_000);
  });

  it('到上限真取消在飞请求（替身观察到 signal abort；不留下悬挂请求）', async () => {
    const state = { aborted: false };
    const client = createDocumentsClient({
      baseUrl: 'http://daemon.test',
      fetchImpl: hangingFetch(state),
      timeoutMs: 120,
    });

    const result = await client.savePage('doc_1', 'page-1', { body: {} });
    expect(result.ok).toBe(false);
    // race 落定之外，abort() 也已发出（真实 fetch 据此释放连接）
    expect(state.aborted).toBe(true);
  });

  it('超时失败后重试可恢复（替身恢复落定 → 保存成功）', async () => {
    const state = { aborted: false };
    const hang = { remaining: 1 };
    const client = createDocumentsClient({
      baseUrl: 'http://daemon.test',
      fetchImpl: hangThenRecoverFetch(hang, state),
      timeoutMs: 120,
    });

    const first = await client.savePage('doc_1', 'page-1', { body: {} });
    expect(first.ok).toBe(false);

    const second = await client.savePage('doc_1', 'page-1', { body: {} });
    expect(second.ok).toBe(true);
  });

  it('缺省上限常量为写路径量级 30s（慢盘余量之内、不是无界；audit-d04 建议值）', () => {
    // 钉住量级：写路径上限是 30s（读路径 3s 的量级对照在 gateway-timeout 自身测试钉）
    expect(DAEMON_REQUEST_TIMEOUT_MS).toBe(30_000);
  });
});
