import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CORS_ORIGINS_ENV,
  CORS_ORIGINS_ENV_ALIAS,
  corsOriginsFromEnv,
  createCorsPolicy,
  DEFAULT_CORS_ORIGINS,
  parseCorsOrigins,
} from '../cors.ts';
import type { TestDaemon } from '../testing/harness.ts';
import { createTestDaemon } from '../testing/harness.ts';

/** 壳内置静态服务的源码（票 14：静态模式来源形状须两侧同源，见「静态模式配对」组）。 */
const SHELL_STATIC_SERVER_SOURCE = fileURLToPath(
  new URL('../../../desktop/src/main/static-server.ts', import.meta.url),
);

/**
 * 起一个与壳内置静态服务**同形**的真 http 服务：绑定 `127.0.0.1` + 系统分配端口
 * （`listen(0, '127.0.0.1')`），返回其来源——壳装载页面后浏览器发出的 Origin 正是它。
 */
function startLoopbackStaticFixture(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html>');
  });
  return new Promise((resolveStart, rejectStart) => {
    server.once('error', rejectStart);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolveStart({
        origin: `http://127.0.0.1:${String(address.port)}`,
        close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
      });
    });
  });
}

/** 取响应头（Fastify inject 头名小写）。 */
function headerOf(response: { headers: Record<string, unknown> }, name: string): unknown {
  return response.headers[name];
}

async function withDaemon<T>(run: (daemon: TestDaemon) => Promise<T>): Promise<T> {
  const daemon = await createTestDaemon();
  try {
    return await run(daemon);
  } finally {
    await daemon.cleanup();
  }
}

describe('cors · 策略解析', () => {
  it('默认白名单仅本机开发来源', () => {
    expect(DEFAULT_CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
    expect(parseCorsOrigins(undefined)).toEqual([...DEFAULT_CORS_ORIGINS]);
    expect(parseCorsOrigins('')).toEqual([...DEFAULT_CORS_ORIGINS]);
  });

  it('环境变量覆盖：逗号分隔、去空白、URL 规范化、去重、非法项丢弃', () => {
    expect(parseCorsOrigins(' http://localhost:3000 , http://192.168.1.9:8080/ ')).toEqual([
      'http://localhost:3000',
      'http://192.168.1.9:8080',
    ]);
    expect(parseCorsOrigins('http://a.test/,http://a.test')).toEqual(['http://a.test']);
    // 全部非法 → 回退默认（宁可少放行，不回退到通配）
    expect(parseCorsOrigins('not-a-url,also bad')).toEqual([...DEFAULT_CORS_ORIGINS]);
  });

  it('env 读取：主名优先，其次 DF_ 别名', () => {
    expect(corsOriginsFromEnv({ [CORS_ORIGINS_ENV]: 'http://localhost:3000' })).toEqual([
      'http://localhost:3000',
    ]);
    expect(corsOriginsFromEnv({ [CORS_ORIGINS_ENV_ALIAS]: 'http://localhost:5173' })).toEqual([
      'http://localhost:5173',
    ]);
    expect(corsOriginsFromEnv({})).toEqual([...DEFAULT_CORS_ORIGINS]);
  });

  it('策略：精确匹配大小写不敏感，`null`（沙箱 iframe/file://）不再放行，不通配', () => {
    const policy = createCorsPolicy(['http://localhost:3000']);
    expect(policy.isAllowed('http://localhost:3000')).toBe(true);
    expect(policy.isAllowed('http://LOCALHOST:3000')).toBe(true);
    // Origin: null 是浏览器对沙箱 iframe / file:// 等不可信上下文的**真实**产出，
    // 放行等于对任意网页开门（§A2-5a）；壳已弃用 file:// 装载，不再是无条件放行理由
    expect(policy.isAllowed('null')).toBe(false);
    expect(policy.isAllowed('http://evil.example.com')).toBe(false);
    expect(policy.isAllowed('http://localhost:3000.evil.example.com')).toBe(false);
  });
});

describe('cors · 壳静态模式配对（回环任意端口，票 14 / 证据 §C1）', () => {
  it('壳内置静态服务以 127.0.0.1:随机端口装载产物（静态模式的来源形状）', () => {
    const source = readFileSync(SHELL_STATIC_SERVER_SOURCE, 'utf8');
    // 端口 0 = 系统分配；绑定 127.0.0.1（壳静态模式不监听 0.0.0.0）
    expect(source).toContain("server.listen(0, '127.0.0.1'");
    expect(source).toMatch(/origin: `http:\/\/127\.0\.0\.1:\$\{address\.port\}`/);
  });

  it('策略放行 127.0.0.1 / localhost 任意端口；非回环主机仍拒绝（不放宽到任意 origin）', () => {
    const policy = createCorsPolicy();
    for (const origin of [
      'http://127.0.0.1:53211',
      'http://127.0.0.1',
      'http://localhost:53211',
      'https://localhost:8443',
      'http://LOCALHOST:53211',
    ]) {
      expect(policy.isAllowed(origin), origin).toBe(true);
    }
    for (const origin of [
      // 仅 127.0.0.1 / localhost：其余 127/8、子域伪装、内网与公网一律不放行
      'http://127.0.0.2:53211',
      'http://127.0.0.1.evil.example:53211',
      'http://localhost.evil.example:53211',
      'http://192.168.1.9:53211',
      'http://evil.example.com',
      'null',
      'file:///opt/dforge/index.html',
    ]) {
      expect(policy.isAllowed(origin), origin).toBe(false);
    }
  });

  it('静态随机端口来源 → inject 放行（GET 带 allow-origin + vary；预检 204）', async () => {
    const fixture = await startLoopbackStaticFixture();
    try {
      await withDaemon(async (daemon) => {
        const get = await daemon.app.inject({
          method: 'GET',
          url: '/health',
          headers: { origin: fixture.origin },
        });
        expect(get.statusCode).toBe(200);
        expect(headerOf(get, 'access-control-allow-origin')).toBe(fixture.origin);
        expect(String(headerOf(get, 'vary')).toLowerCase()).toContain('origin');

        const preflight = await daemon.app.inject({
          method: 'OPTIONS',
          url: '/documents',
          headers: { origin: fixture.origin, 'access-control-request-method': 'POST' },
        });
        expect(preflight.statusCode).toBe(204);
        expect(headerOf(preflight, 'access-control-allow-origin')).toBe(fixture.origin);
        expect(headerOf(preflight, 'access-control-allow-methods')).toBe(
          'GET,POST,PUT,PATCH,DELETE',
        );
      });
    } finally {
      await fixture.close();
    }
  });

  it('对抗面不回退：非回环 origin 无放行头；回环 origin + 非回环 Host 仍 403（钩子顺序）', async () => {
    const fixture = await startLoopbackStaticFixture();
    try {
      await withDaemon(async (daemon) => {
        for (const origin of ['http://evil.example.com', 'http://127.0.0.2:53211', 'null']) {
          const response = await daemon.app.inject({
            method: 'GET',
            url: '/health',
            headers: { origin },
          });
          // CORS 语义不变：服务端照常处理（200），但不回放行头（浏览器自行拒绝）
          expect(response.statusCode).toBe(200);
          expect(headerOf(response, 'access-control-allow-origin'), origin).toBeUndefined();
        }

        // Host 校验（票 02）先于 CORS：来源合法不代表 Host 合法（DNS rebinding 面不可回退）
        const rebinding = await daemon.app.inject({
          method: 'GET',
          url: '/health',
          headers: { origin: fixture.origin, host: 'evil.rebind.example' },
        });
        expect(rebinding.statusCode).toBe(403);
        expect(headerOf(rebinding, 'access-control-allow-origin')).toBeUndefined();
      });
    } finally {
      await fixture.close();
    }
  });
});

describe('cors · 响应头（白名单受控放行）', () => {
  it('白名单来源（localhost/127.0.0.1:3000）拿到 allow-origin + vary', async () => {
    await withDaemon(async (daemon) => {
      for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000']) {
        const response = await daemon.app.inject({
          method: 'GET',
          url: '/health',
          headers: { origin },
        });
        expect(response.statusCode).toBe(200);
        expect(headerOf(response, 'access-control-allow-origin')).toBe(origin);
        expect(String(headerOf(response, 'vary')).toLowerCase()).toContain('origin');
      }
    });
  });

  it('非白名单来源：无 allow-origin 头，但 API 语义不变（仍是 200 + 正常信封）', async () => {
    await withDaemon(async (daemon) => {
      const response = await daemon.app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'http://evil.example.com' },
      });
      expect(response.statusCode).toBe(200);
      expect(headerOf(response, 'access-control-allow-origin')).toBeUndefined();
      expect((response.json() as { ok: boolean }).ok).toBe(true);
    });
  });

  it('无 Origin（curl/Node/壳内同源网关）：不加任何 CORS 头，正常响应', async () => {
    await withDaemon(async (daemon) => {
      const response = await daemon.app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      expect(headerOf(response, 'access-control-allow-origin')).toBeUndefined();
      expect(headerOf(response, 'vary')).toBeUndefined();
    });
  });

  it('`Origin: null`（沙箱 iframe / file://）不再放行：无 allow-origin 头，API 语义不变', async () => {
    await withDaemon(async (daemon) => {
      const response = await daemon.app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'null' },
      });
      // 服务端语义保持 200（真正的访问控制边界在回环监听 + Host 校验 + 未来令牌），
      // 但**不回放行头**——浏览器据此拒绝跨源读取（§A2-5a）
      expect(response.statusCode).toBe(200);
      expect(headerOf(response, 'access-control-allow-origin')).toBeUndefined();
      expect((response.json() as { ok: boolean }).ok).toBe(true);
    });
  });

  it('写方法同样带 CORS 头（PUT/DELETE）', async () => {
    await withDaemon(async (daemon) => {
      const put = await daemon.app.inject({
        method: 'PUT',
        url: '/config',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        payload: JSON.stringify({ telemetry: { enabled: true } }),
      });
      expect(put.statusCode).toBe(200);
      expect(headerOf(put, 'access-control-allow-origin')).toBe('http://localhost:3000');

      const del = await daemon.app.inject({
        method: 'DELETE',
        url: '/config/credentials',
        headers: { origin: 'http://127.0.0.1:3000' },
      });
      expect(del.statusCode).toBe(200);
      expect(headerOf(del, 'access-control-allow-origin')).toBe('http://127.0.0.1:3000');
    });
  });
});

describe('cors · 预检（OPTIONS 短路）', () => {
  it('白名单预检：204 + 方法/头/缓存头齐备', async () => {
    await withDaemon(async (daemon) => {
      const response = await daemon.app.inject({
        method: 'OPTIONS',
        url: '/documents',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      });
      expect(response.statusCode).toBe(204);
      expect(headerOf(response, 'access-control-allow-origin')).toBe('http://localhost:3000');
      expect(headerOf(response, 'access-control-allow-methods')).toBe('GET,POST,PUT,PATCH,DELETE');
      expect(headerOf(response, 'access-control-allow-headers')).toBe('content-type');
      expect(headerOf(response, 'access-control-max-age')).toBe('600');
      expect(String(headerOf(response, 'vary')).toLowerCase()).toContain('origin');
    });
  });

  it('非白名单预检：无放行头（浏览器自行拒绝）', async () => {
    await withDaemon(async (daemon) => {
      const response = await daemon.app.inject({
        method: 'OPTIONS',
        url: '/documents',
        headers: { origin: 'http://evil.example.com', 'access-control-request-method': 'POST' },
      });
      expect(headerOf(response, 'access-control-allow-origin')).toBeUndefined();
      expect(headerOf(response, 'access-control-allow-methods')).toBeUndefined();
    });
  });

  it('无 Origin 的裸 OPTIONS 不进预检短路（保持原路由语义：404）', async () => {
    await withDaemon(async (daemon) => {
      const response = await daemon.app.inject({ method: 'OPTIONS', url: '/documents' });
      expect(response.statusCode).toBe(404);
      expect(headerOf(response, 'access-control-allow-origin')).toBeUndefined();
    });
  });
});

describe('cors · 注入覆盖（测试/部署可配）', () => {
  it('corsOrigins 选项替换显式白名单，但回环任意端口规则恒生效（壳静态配对的缺省语义）', async () => {
    const daemon = await createTestDaemon({ corsOrigins: ['http://design.test:8080'] });
    try {
      const allowed = await daemon.app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'http://design.test:8080' },
      });
      expect(headerOf(allowed, 'access-control-allow-origin')).toBe('http://design.test:8080');

      // 回环任意端口不受显式白名单影响：壳以系统分配的 127.0.0.1 随机端口装载产物，
      // 端口不可预知、无人写入 DFORGE_CORS_ORIGINS（§C1）——这条规则必须是缺省语义
      const loopback = await daemon.app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'http://127.0.0.1:54321' },
      });
      expect(headerOf(loopback, 'access-control-allow-origin')).toBe('http://127.0.0.1:54321');

      const notAllowed = await daemon.app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'http://evil.example.com' },
      });
      expect(headerOf(notAllowed, 'access-control-allow-origin')).toBeUndefined();
    } finally {
      await daemon.cleanup();
    }
  });

  it('CORS 不影响统一错误形状（失败响应同样按白名单带放行头，前端可读错误体）', async () => {
    await withDaemon(async (daemon) => {
      const response = await daemon.app.inject({
        method: 'GET',
        url: '/documents/不存在',
        headers: { origin: 'http://localhost:3000' },
      });
      expect(response.statusCode).toBe(404);
      expect((response.json() as { error: { code: string } }).error.code).toBe('doc_not_found');
      expect(headerOf(response, 'access-control-allow-origin')).toBe('http://localhost:3000');
    });
  });
});
