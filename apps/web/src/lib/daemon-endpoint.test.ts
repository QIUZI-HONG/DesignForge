/**
 * daemon 端点解析测试（ADR-0004 裁决 ①的**可执行规范**）。
 *
 * 断言角度：外部可观测行为——解析顺序（查询参数 → env → 缺省起点/端口窗探测）、
 * 命中确定性、缓存语义、失败错误码。期望值取自契约端口常量（不按实现口径重算）。
 */
import { DAEMON_PORT_BASE, DAEMON_PORT_MAX_OFFSET } from '@dforge/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DAEMON_ENDPOINT_DEFAULT,
  DaemonEndpointError,
  daemonEndpointCandidates,
  resetDaemonEndpointCache,
  resolveDaemonEndpoint,
  resolveDaemonEndpointSync,
  withDaemonEndpoint,
} from './daemon-endpoint';

// 探测结果进程内缓存是**设计**（同一会话只探一次）——逐用例复位保证独立
beforeEach(() => {
  resetDaemonEndpointCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** 造一个假 fetch：只有命中的端点返回 200，其余抛网络错；记录调用顺序。 */
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

describe('端口窗常量与候选', () => {
  it('缺省端点 = 契约端口起点', () => {
    expect(DAEMON_ENDPOINT_DEFAULT).toBe(`http://127.0.0.1:${String(DAEMON_PORT_BASE)}`);
  });

  it('候选覆盖「起点 → 起点 + 上限偏移」整段且顺序即探测顺序', () => {
    const candidates = daemonEndpointCandidates();
    expect(candidates[0]).toBe(DAEMON_ENDPOINT_DEFAULT);
    expect(candidates).toHaveLength(DAEMON_PORT_MAX_OFFSET + 1);
    expect(candidates[1]).toBe(`http://127.0.0.1:${String(DAEMON_PORT_BASE + 1)}`);
    expect(candidates.at(-1)).toBe(
      `http://127.0.0.1:${String(DAEMON_PORT_BASE + DAEMON_PORT_MAX_OFFSET)}`,
    );
  });
});

describe('resolveDaemonEndpointSync（同步快路径）', () => {
  it('查询参数优先（去尾斜杠、不探测）', () => {
    expect(resolveDaemonEndpointSync({ search: '?daemon=http://127.0.0.1:4999/' })).toBe(
      'http://127.0.0.1:4999',
    );
  });

  it('查询参数命中时不看 env（顺序固定）', () => {
    expect(
      resolveDaemonEndpointSync({
        search: '?daemon=http://127.0.0.1:4999',
        envUrl: 'http://127.0.0.1:4400',
      }),
    ).toBe('http://127.0.0.1:4999');
  });

  it('env 次之；空白/空串视为未配置', () => {
    expect(resolveDaemonEndpointSync({ search: '', envUrl: ' http://127.0.0.1:4400/ ' })).toBe(
      'http://127.0.0.1:4400',
    );
    expect(resolveDaemonEndpointSync({ search: '', envUrl: '   ' })).toBe(DAEMON_ENDPOINT_DEFAULT);
  });

  it('显式给出 envUrl（含 undefined）即不读 process.env', () => {
    vi.stubEnv('NEXT_PUBLIC_DF_DAEMON_URL', 'http://127.0.0.1:4555');
    expect(resolveDaemonEndpointSync({ search: '', envUrl: undefined })).toBe(
      DAEMON_ENDPOINT_DEFAULT,
    );
  });

  it('未给 envUrl 时读静态 process.env.NEXT_PUBLIC_DF_DAEMON_URL（Next 构建期内联口径）', () => {
    vi.stubEnv('NEXT_PUBLIC_DF_DAEMON_URL', 'http://127.0.0.1:4321');
    expect(resolveDaemonEndpointSync({ search: '' })).toBe('http://127.0.0.1:4321');
  });

  it('服务端（无 window）不看不存在的查询串，回落缺省', () => {
    vi.stubEnv('NEXT_PUBLIC_DF_DAEMON_URL', '');
    expect(resolveDaemonEndpointSync()).toBe(DAEMON_ENDPOINT_DEFAULT);
  });
});

describe('resolveDaemonEndpoint（异步完整路径）', () => {
  it('查询参数优先且不探测', async () => {
    const { fetchImpl, calls } = fakeHealth([]);
    await expect(
      resolveDaemonEndpoint({ search: '?daemon=http://127.0.0.1:4999', fetchImpl }),
    ).resolves.toBe('http://127.0.0.1:4999');
    expect(calls).toEqual([]);
  });

  it('env 次之且不探测（构建期覆盖）', async () => {
    const { fetchImpl, calls } = fakeHealth([]);
    await expect(
      resolveDaemonEndpoint({ search: '', envUrl: 'http://127.0.0.1:4400/', fetchImpl }),
    ).resolves.toBe('http://127.0.0.1:4400');
    expect(calls).toEqual([]);
  });

  it('缺省探到端口窗起点上的健康 daemon', async () => {
    const { fetchImpl, calls } = fakeHealth([DAEMON_ENDPOINT_DEFAULT]);
    await expect(resolveDaemonEndpoint({ search: '', fetchImpl })).resolves.toBe(
      DAEMON_ENDPOINT_DEFAULT,
    );
    expect(calls[0]).toBe(`${DAEMON_ENDPOINT_DEFAULT}/health`);
  });

  it('端口漂移时探到后续端口', async () => {
    const drifted = `http://127.0.0.1:${String(DAEMON_PORT_BASE + 3)}`;
    const { fetchImpl } = fakeHealth([drifted]);
    await expect(resolveDaemonEndpoint({ search: '', fetchImpl })).resolves.toBe(drifted);
  });

  it('整段端口都不可达 → 抛 daemon_unreachable（页面据此进错误态）', async () => {
    const { fetchImpl } = fakeHealth([]);
    await expect(resolveDaemonEndpoint({ search: '', fetchImpl })).rejects.toBeInstanceOf(
      DaemonEndpointError,
    );
    await expect(resolveDaemonEndpoint({ search: '', fetchImpl })).rejects.toMatchObject({
      code: 'daemon_unreachable',
    });
  });

  it('探测结果进程内缓存（同一会话只探一次）', async () => {
    const { fetchImpl, calls } = fakeHealth([DAEMON_ENDPOINT_DEFAULT]);
    await resolveDaemonEndpoint({ search: '', fetchImpl });
    await resolveDaemonEndpoint({ search: '', fetchImpl });
    expect(calls).toHaveLength(1);
  });
});

describe('withDaemonEndpoint（站内跳转携带当前端点 · D-3/UX-01）', () => {
  const endpoint = 'http://127.0.0.1:4999';
  const encoded = encodeURIComponent(endpoint);
  const onEndpoint = { search: `?daemon=${encoded}` };

  it('当前页带 ?daemon= → 站内地址追加同一参数（编码原样）', () => {
    expect(withDaemonEndpoint('/editor?documentId=x', onEndpoint)).toBe(
      `/editor?documentId=x&daemon=${encoded}`,
    );
  });

  it('href 无查询串时用 ? 起头（不是 &）', () => {
    expect(withDaemonEndpoint('/market', onEndpoint)).toBe(`/market?daemon=${encoded}`);
  });

  it('当前页没有 ?daemon= → 原样返回（canonical/壳形态 URL 保持干净）', () => {
    expect(withDaemonEndpoint('/editor?documentId=x', { search: '', envUrl: endpoint })).toBe(
      '/editor?documentId=x',
    );
    expect(withDaemonEndpoint('/market', { search: '?other=1' })).toBe('/market');
  });

  it('非法端点值丢弃（非 http(s)：不往后续页面传播垃圾参数）', () => {
    expect(withDaemonEndpoint('/market', { search: '?daemon=not-a-url' })).toBe('/market');
    expect(withDaemonEndpoint('/market', { search: '?daemon=javascript%3Aalert(1)' })).toBe(
      '/market',
    );
  });

  it('幂等：href 已带同一参数时不重复追加（调用两次结果一致）', () => {
    const once = withDaemonEndpoint('/market?kind=skill', onEndpoint);
    expect(withDaemonEndpoint(once, onEndpoint)).toBe(once);
  });

  it('保留 hash（参数插在 # 之前）', () => {
    expect(withDaemonEndpoint('/editor?documentId=x#top', onEndpoint)).toBe(
      `/editor?documentId=x&daemon=${encoded}#top`,
    );
  });

  it('其余查询串与转义逐字保留（%20 不被规范化成 +）', () => {
    expect(withDaemonEndpoint('/editor?documentId=%E6%B5%B7%E6%8A%A5%20A', onEndpoint)).toBe(
      `/editor?documentId=%E6%B5%B7%E6%8A%A5%20A&daemon=${encoded}`,
    );
  });

  it('外部/绝对地址原样返回（不向站外泄端点）', () => {
    expect(withDaemonEndpoint('https://example.com/a?b=1', onEndpoint)).toBe(
      'https://example.com/a?b=1',
    );
    expect(withDaemonEndpoint('//cdn.example.com/x', onEndpoint)).toBe('//cdn.example.com/x');
    expect(withDaemonEndpoint('#anchor', onEndpoint)).toBe('#anchor');
  });
});
