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

  it('策略：精确匹配大小写不敏感，`null`（打包壳）恒放行，不通配', () => {
    const policy = createCorsPolicy(['http://localhost:3000']);
    expect(policy.isAllowed('http://localhost:3000')).toBe(true);
    expect(policy.isAllowed('http://LOCALHOST:3000')).toBe(true);
    expect(policy.isAllowed('null')).toBe(true);
    expect(policy.isAllowed('http://evil.example.com')).toBe(false);
    expect(policy.isAllowed('http://localhost:3000.evil.example.com')).toBe(false);
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

  it('打包壳 `Origin: null` 放行（file:// 形态）', async () => {
    await withDaemon(async (daemon) => {
      const response = await daemon.app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'null' },
      });
      expect(response.statusCode).toBe(200);
      expect(headerOf(response, 'access-control-allow-origin')).toBe('null');
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
  it('corsOrigins 选项替换默认白名单（本机来源不再放行）', async () => {
    const daemon = await createTestDaemon({ corsOrigins: ['http://design.test:8080'] });
    try {
      const allowed = await daemon.app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'http://design.test:8080' },
      });
      expect(headerOf(allowed, 'access-control-allow-origin')).toBe('http://design.test:8080');

      const notAllowed = await daemon.app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'http://localhost:3000' },
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
