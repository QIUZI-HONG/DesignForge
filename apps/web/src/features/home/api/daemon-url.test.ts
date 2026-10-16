/**
 * daemon 基址解析测试（FE-02）。
 *
 * 为什么需要它：前端不与 daemon 同进程，端口可能因占用漂移（daemon 从 4318 起 +1 探测）——
 * 解析顺序固定为：显式查询参数 → 构建期环境变量 → 端口段健康探测。
 * 期望值取自契约（DAEMON_PORT_BASE / DAEMON_PORT_MAX_OFFSET）与规格端口纪律。
 */
import { DAEMON_PORT_BASE, DAEMON_PORT_MAX_OFFSET } from '@dforge/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  DAEMON_DEFAULT_URL,
  daemonBaseUrlCandidates,
  resetDaemonBaseUrlCache,
  resolveDaemonBaseUrl,
} from './daemon-url';

// 模块内缓存会跨用例残留（同一进程内只探一次是**设计**），逐用例复位保证独立
beforeEach(() => {
  resetDaemonBaseUrlCache();
});

/** 造一个假 fetch：只有命中的 URL 返回 200，其余抛网络错。 */
function fakeHealth(healthy: string[]) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (healthy.some((target) => url.startsWith(target))) {
      return { ok: true, status: 200 } as Response;
    }
    throw new TypeError('ECONNREFUSED');
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('daemonBaseUrlCandidates', () => {
  it('从契约端口起点开始，覆盖「起点 + 上限偏移」整段', () => {
    const candidates = daemonBaseUrlCandidates();
    expect(candidates[0]).toBe(DAEMON_DEFAULT_URL);
    expect(candidates).toHaveLength(DAEMON_PORT_MAX_OFFSET + 1);
    expect(candidates[1]).toBe(`http://127.0.0.1:${String(DAEMON_PORT_BASE + 1)}`);
    expect(candidates.at(-1)).toBe(
      `http://127.0.0.1:${String(DAEMON_PORT_BASE + DAEMON_PORT_MAX_OFFSET)}`,
    );
  });
});

describe('resolveDaemonBaseUrl', () => {
  it('显式查询参数优先（原样使用，不探测）', async () => {
    const { fetchImpl, calls } = fakeHealth([]);
    const resolved = await resolveDaemonBaseUrl({
      search: '?daemon=http://127.0.0.1:4999',
      fetchImpl,
    });
    expect(resolved).toBe('http://127.0.0.1:4999');
    expect(calls).toEqual([]);
  });

  it('环境变量次之（构建期覆盖）', async () => {
    const { fetchImpl } = fakeHealth([]);
    const resolved = await resolveDaemonBaseUrl({
      envUrl: 'http://127.0.0.1:4400/',
      fetchImpl,
    });
    expect(resolved).toBe('http://127.0.0.1:4400');
  });

  it('默认探到 4318 上的健康 daemon', async () => {
    const { fetchImpl, calls } = fakeHealth([DAEMON_DEFAULT_URL]);
    await expect(resolveDaemonBaseUrl({ fetchImpl })).resolves.toBe(DAEMON_DEFAULT_URL);
    expect(calls[0]).toBe(`${DAEMON_DEFAULT_URL}/health`);
  });

  it('端口漂移时探到后续端口', async () => {
    const drifted = `http://127.0.0.1:${String(DAEMON_PORT_BASE + 3)}`;
    const { fetchImpl } = fakeHealth([drifted]);
    await expect(resolveDaemonBaseUrl({ fetchImpl })).resolves.toBe(drifted);
  });

  it('整段端口都不可达 → 抛阻塞错（页面据此进错误态，不无限等待）', async () => {
    const { fetchImpl } = fakeHealth([]);
    await expect(resolveDaemonBaseUrl({ fetchImpl })).rejects.toMatchObject({
      code: 'daemon_unreachable',
    });
  });

  it('解析结果进程内缓存（同一会话只探一次）', async () => {
    const { fetchImpl, calls } = fakeHealth([DAEMON_DEFAULT_URL]);
    await resolveDaemonBaseUrl({ fetchImpl });
    await resolveDaemonBaseUrl({ fetchImpl });
    expect(calls).toHaveLength(1);
  });
});
