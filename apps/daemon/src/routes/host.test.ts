import { request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ALLOWED_HOSTS_ENV,
  ALLOWED_HOSTS_ENV_ALIAS,
  allowedHostsFromEnv,
  createHostPolicy,
  DEFAULT_ALLOWED_HOSTS,
  hostnameFromHostHeader,
  parseAllowedHosts,
} from '../host.ts';
import type { TestDaemon } from '../testing/harness.ts';
import { createTestDaemon } from '../testing/harness.ts';
import { startDaemon } from '../server.ts';

async function withDaemon<T>(run: (daemon: TestDaemon) => Promise<T>): Promise<T> {
  const daemon = await createTestDaemon();
  try {
    return await run(daemon);
  } finally {
    await daemon.cleanup();
  }
}

/** 断言 403 统一失败信封（host_not_allowed），且不带 CORS 放行头。 */
async function expectForbidden(
  response: Awaited<ReturnType<TestDaemon['app']['inject']>>,
): Promise<void> {
  expect(response.statusCode).toBe(403);
  const body = response.json() as { ok: boolean; error: { code: string } };
  expect(body.ok).toBe(false);
  expect(body.error.code).toBe('host_not_allowed');
  expect(response.headers['access-control-allow-origin']).toBeUndefined();
}

describe('host · 请求级 Host allowlist（DNS-rebinding 防线）', () => {
  it('伪造 Host（evil.example）→ 403 host_not_allowed（TC-SEC-02 实证形态收口）', async () => {
    await withDaemon(async (daemon) => {
      await expectForbidden(
        await daemon.app.inject({ method: 'GET', url: '/health', headers: { host: 'evil.example' } }),
      );
      await expectForbidden(
        await daemon.app.inject({
          method: 'GET',
          url: '/health',
          headers: { host: 'evil.example:4318' },
        }),
      );
      // 大小写不敏感
      await expectForbidden(
        await daemon.app.inject({ method: 'GET', url: '/health', headers: { host: 'EVIL.example' } }),
      );
    });
  });

  it('伪造 Host 的写请求同样 403（E4 实锤：伪造 Host DELETE 曾 200 执行）', async () => {
    await withDaemon(async (daemon) => {
      await expectForbidden(
        await daemon.app.inject({
          method: 'DELETE',
          url: '/documents/whatever',
          headers: { host: 'evil.example' },
        }),
      );
      await expectForbidden(
        await daemon.app.inject({
          method: 'POST',
          url: '/telemetry/events',
          headers: { host: 'evil.example', 'content-type': 'application/json' },
          payload: JSON.stringify({ name: 'doc.created', payload: {} }),
        }),
      );
    });
  });

  it('回环三形态放行：127.0.0.1:<port> / localhost:<port> / [::1]:<port>（含网关 127.0.0.1:<网关端口> 形态）', async () => {
    await withDaemon(async (daemon) => {
      for (const host of [
        '127.0.0.1:4318',
        'localhost:4318',
        '[::1]:4318',
        '::1',
        // 同源网关 /df/* 形态：undici fetch 转发时剥除 Host、按 daemonUrl 重建——
        // daemon 实收 Host=127.0.0.1:<daemon 端口>；即使原样转发浏览器 Host 也是
        // 127.0.0.1:<网关端口>，hostname 均为回环，天然通过
        '127.0.0.1:5173',
        'LOCALHOST:4318',
      ]) {
        const response = await daemon.app.inject({ method: 'GET', url: '/health', headers: { host } });
        expect(response.statusCode, host).toBe(200);
        expect((response.json() as { ok: boolean }).ok, host).toBe(true);
      }
    });
  });

  it('回环相似域不误放行（精确匹配，不做后缀/结尾点归一）', async () => {
    await withDaemon(async (daemon) => {
      for (const host of ['localhost.evil.example', '127.0.0.1.evil.example', 'localhost.']) {
        await expectForbidden(
          await daemon.app.inject({ method: 'GET', url: '/health', headers: { host } }),
        );
      }
    });
  });

  it('未命中 allowlist 的 Host 对未知路由同样 403（钩子先于路由与 404）', async () => {
    await withDaemon(async (daemon) => {
      const response = await daemon.app.inject({
        method: 'GET',
        url: '/no-such-route',
        headers: { host: 'evil.example' },
      });
      expect(response.statusCode).toBe(403);
      expect((response.json() as { error: { code: string } }).error.code).toBe('host_not_allowed');
    });
  });

  it('Host 缺失：HTTP/1.0 形态→403 保守拒绝（真监听裸 socket）；HTTP/1.1 无 Host 由 Node 解析器 400 兜底', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'df-host-'));
    // port 0 → 内核分配空闲端口（远离 3000/4318），不与既有探测段冲突
    const running = await startDaemon({
      dataRoot: join(temp, 'data'),
      workspaceDir: join(temp, 'ws'),
      port: 0,
    });
    try {
      // HTTP/1.1 无 Host：Node 解析器直接 400（请求到不了应用层；分层防御的第一道）
      const http11NoHost = await new Promise<{ status: number | undefined; body: string }>(
        (resolve, reject) => {
          const req = httpRequest(
            {
              host: running.host,
              port: running.port,
              path: '/health',
              method: 'GET',
              setHost: false,
              timeout: 5_000,
            },
            (response) => {
              let body = '';
              response.on('data', (chunk: Buffer) => {
                body += String(chunk);
              });
              response.on('end', () => resolve({ status: response.statusCode, body }));
            },
          );
          req.on('error', reject);
          req.on('timeout', () => req.destroy(new Error('请求超时')));
          req.end();
        },
      );
      expect(http11NoHost.status).toBe(400);

      // HTTP/1.0 无 Host（合法形态，解析器放行）→ 应用层钩子保守 403
      const raw = (requestText: string) =>
        new Promise<string>((resolve, reject) => {
          const socket = netConnect({ host: running.host, port: running.port }, () => {
            socket.write(requestText);
          });
          socket.setTimeout(5_000);
          let data = '';
          socket.on('data', (chunk: Buffer) => {
            data += String(chunk);
          });
          socket.on('close', () => resolve(data));
          socket.on('timeout', () => socket.destroy(new Error('响应超时')));
          socket.on('error', reject);
        });

      const http10NoHost = await raw('GET /health HTTP/1.0\r\n\r\n');
      expect(http10NoHost).toContain('403');
      expect(http10NoHost).toContain('host_not_allowed');

      // 对照：HTTP/1.0 带回环 Host → 200
      const http10Loopback = await raw(`GET /health HTTP/1.0\r\nHost: 127.0.0.1:${running.port}\r\n\r\n`);
      expect(http10Loopback).toContain('200');
    } finally {
      await running.close();
      await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

describe('host · 允许清单解析（真源函数）', () => {
  it('hostnameFromHostHeader：去端口、方括号 IPv6、大小写归一', () => {
    expect(hostnameFromHostHeader('127.0.0.1:4318')).toBe('127.0.0.1');
    expect(hostnameFromHostHeader('localhost')).toBe('localhost');
    expect(hostnameFromHostHeader('LOCALHOST:3000')).toBe('localhost');
    expect(hostnameFromHostHeader('[::1]:4318')).toBe('::1');
    expect(hostnameFromHostHeader('[::1]')).toBe('::1');
    expect(hostnameFromHostHeader('::1')).toBe('::1');
    expect(hostnameFromHostHeader('evil.example:8080')).toBe('evil.example');
    expect(hostnameFromHostHeader('  evil.example ')).toBe('evil.example');
    expect(hostnameFromHostHeader('')).toBe('');
  });

  it('parseAllowedHosts：逗号分隔、去空白、小写、去重、空项丢弃、全空回退默认', () => {
    expect(parseAllowedHosts(undefined)).toEqual([...DEFAULT_ALLOWED_HOSTS]);
    expect(parseAllowedHosts('')).toEqual([...DEFAULT_ALLOWED_HOSTS]);
    expect(parseAllowedHosts(' devbox.example , [::1] , DEVBOX.example ,, ')).toEqual([
      'devbox.example',
      '::1',
    ]);
    // 条目允许带端口（按 Host 头同一解析器归一为 hostname）
    expect(parseAllowedHosts('myhost:8443')).toEqual(['myhost']);
    // 单一合法项缺失回退默认（宁可少放行，不放空清单）
    expect(parseAllowedHosts(',,,')).toEqual([...DEFAULT_ALLOWED_HOSTS]);
  });

  it('env 读取：主名优先，其次 DF_ 别名；并集扩展（回环默认项恒在）', () => {
    expect(
      allowedHostsFromEnv({
        [ALLOWED_HOSTS_ENV]: 'main.example',
        [ALLOWED_HOSTS_ENV_ALIAS]: 'alias.example',
      }),
    ).toEqual([...DEFAULT_ALLOWED_HOSTS, 'main.example']);
    expect(allowedHostsFromEnv({ [ALLOWED_HOSTS_ENV_ALIAS]: 'alias.example' })).toEqual([
      ...DEFAULT_ALLOWED_HOSTS,
      'alias.example',
    ]);
    expect(allowedHostsFromEnv({})).toEqual([...DEFAULT_ALLOWED_HOSTS]);
    // 回环项重复出现不产生重复条目
    expect(allowedHostsFromEnv({ [ALLOWED_HOSTS_ENV_ALIAS]: '::1' })).toEqual([
      ...DEFAULT_ALLOWED_HOSTS,
    ]);
  });

  it('策略：hostname 精确匹配（大小写不敏感），相似域不误放行', () => {
    const policy = createHostPolicy(['127.0.0.1', 'localhost', '::1']);
    expect(policy.isAllowed('127.0.0.1')).toBe(true);
    expect(policy.isAllowed('LocalHost')).toBe(true);
    expect(policy.isAllowed('::1')).toBe(true);
    expect(policy.isAllowed('evil.example')).toBe(false);
    expect(policy.isAllowed('localhost.evil.example')).toBe(false);
    expect(policy.isAllowed('')).toBe(false);
  });
});

describe('host · 允许清单扩展', () => {
  it('DF_ALLOWED_HOSTS env 扩展生效（app 真读 process.env 路径）', async () => {
    const previous = process.env[ALLOWED_HOSTS_ENV_ALIAS];
    process.env[ALLOWED_HOSTS_ENV_ALIAS] = 'dfenv.example';
    const daemon = await createTestDaemon();
    try {
      const allowed = await daemon.app.inject({
        method: 'GET',
        url: '/health',
        headers: { host: 'dfenv.example:8080' },
      });
      expect(allowed.statusCode).toBe(200);
      const denied = await daemon.app.inject({
        method: 'GET',
        url: '/health',
        headers: { host: 'still-evil.example' },
      });
      expect(denied.statusCode).toBe(403);
      // 回环仍在默认集内（扩展是并集，不是替换）
      const loopback = await daemon.app.inject({
        method: 'GET',
        url: '/health',
        headers: { host: '127.0.0.1:4318' },
      });
      expect(loopback.statusCode).toBe(200);
    } finally {
      await daemon.cleanup();
      if (previous === undefined) delete process.env[ALLOWED_HOSTS_ENV_ALIAS];
      else process.env[ALLOWED_HOSTS_ENV_ALIAS] = previous;
    }
  });

  it('allowedHosts 选项替换默认清单（与 corsOrigins 同口径；测试/部署注入）', async () => {
    const daemon = await createTestDaemon({ allowedHosts: ['design.test'] });
    try {
      const allowed = await daemon.app.inject({
        method: 'GET',
        url: '/health',
        headers: { host: 'design.test:8080' },
      });
      expect(allowed.statusCode).toBe(200);
      // 替换语义：默认回环名不再放行
      const denied = await daemon.app.inject({
        method: 'GET',
        url: '/health',
        headers: { host: 'localhost:80' },
      });
      expect(denied.statusCode).toBe(403);
    } finally {
      await daemon.cleanup();
    }
  });
});
