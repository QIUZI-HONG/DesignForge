import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { TestDaemon } from '../testing/harness.ts';
import { createTestDaemon, injectJson } from '../testing/harness.ts';
import {
  authDisabledFromEnv,
  ensureTokenFile,
  extractPresentedToken,
  TOKEN_FILE_BASENAME,
  TOKEN_HEADER,
} from '../token.ts';

/** 取响应头（Fastify inject 头名小写）。 */
function headerOf(response: { headers: Record<string, unknown> }, name: string): unknown {
  return response.headers[name];
}

async function withDaemon<T>(
  run: (daemon: TestDaemon) => Promise<T>,
  options: Parameters<typeof createTestDaemon>[0] = {},
): Promise<T> {
  const daemon = await createTestDaemon(options);
  try {
    return await run(daemon);
  } finally {
    await daemon.cleanup();
  }
}

/**
 * 令牌鉴权 · 对抗回归（audit-d02 · D-02 验收五条）。
 * 缺陷基线（h1-probe）：`Origin: null` 拿 ACAO + 200 全量文档；白名单外写请求照常进业务。
 */
describe('token · 对抗回归（D-02 五条）', () => {
  it('① 无令牌 GET /documents → 401 unauthorized 统一信封（中文 message）', async () => {
    await withDaemon(async (daemon) => {
      const response = await daemon.app.inject({ method: 'GET', url: '/documents' });
      expect(response.statusCode).toBe(401);
      const payload = response.json() as {
        ok: boolean;
        error: { code: string; message: string };
      };
      expect(payload.ok).toBe(false);
      expect(payload.error.code).toBe('unauthorized');
      expect(payload.error.message).toContain('令牌');
    });
  });

  it('② 错令牌 → 401；`Authorization: Bearer` 合法令牌 → 200', async () => {
    await withDaemon(async (daemon) => {
      const wrong = await daemon.app.inject({
        method: 'GET',
        url: '/documents',
        headers: { [TOKEN_HEADER]: 'deadbeef-wrong-token' },
      });
      expect(wrong.statusCode).toBe(401);
      expect((wrong.json() as { error: { code: string } }).error.code).toBe('unauthorized');

      const bearer = await daemon.app.inject({
        method: 'GET',
        url: '/documents',
        headers: { authorization: `Bearer ${daemon.token}` },
      });
      expect(bearer.statusCode).toBe(200);
      expect((bearer.json() as { ok: boolean }).ok).toBe(true);
    });
  });

  it('③ `Origin: null` + 无令牌 → 401 且无 ACAO 头（缺陷基线的「ACAO null + 200」不再出现）', async () => {
    await withDaemon(async (daemon) => {
      const response = await daemon.app.inject({
        method: 'GET',
        url: '/documents',
        headers: { origin: 'null' },
      });
      expect(response.statusCode).toBe(401);
      expect(headerOf(response, 'access-control-allow-origin')).toBeUndefined();
      expect(headerOf(response, 'vary')).toBeUndefined();
    });
  });

  it('④ 合法令牌 + 白名单 Origin → 200 + ACAO 回显（合法来源行为不变）', async () => {
    await withDaemon(async (daemon) => {
      const response = await daemon.app.inject({
        method: 'GET',
        url: '/documents',
        headers: { origin: 'http://localhost:3000', [TOKEN_HEADER]: daemon.token ?? '' },
      });
      expect(response.statusCode).toBe(200);
      expect(headerOf(response, 'access-control-allow-origin')).toBe('http://localhost:3000');
    });
  });

  it('⑤ authDisabled（DF_AUTH_DISABLED=1 形态）→ 旧行为：无令牌照常 200', async () => {
    await withDaemon(
      async (daemon) => {
        expect(daemon.token).toBeNull();
        const response = await injectJson(daemon.app, { method: 'GET', url: '/documents' });
        expect(response.statusCode).toBe(200);
        expect((response.payload as { ok: boolean }).ok).toBe(true);
      },
      { authDisabled: true },
    );
  });
});

describe('token · 豁免面（/health 与 CORS 预检）', () => {
  it('/health 无令牌 200（端点发现握手依赖它；端口窗探测/门禁判活）', async () => {
    await withDaemon(async (daemon) => {
      const response = await daemon.app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { ok: boolean }).ok).toBe(true);
    });
  });

  it('CORS 预检（OPTIONS + access-control-request-method）无令牌 → 204（白名单/null Origin 均放行头）', async () => {
    await withDaemon(async (daemon) => {
      for (const origin of ['http://localhost:3000', 'null']) {
        const response = await daemon.app.inject({
          method: 'OPTIONS',
          url: '/documents',
          headers: {
            origin,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'content-type,x-df-token',
          },
        });
        expect(response.statusCode, origin).toBe(204);
        expect(headerOf(response, 'access-control-allow-origin'), origin).toBe(origin);
        expect(String(headerOf(response, 'access-control-allow-headers'))).toContain('x-df-token');
      }
    });
  });

  it('带查询串的 /health 同样豁免（?probe=1 形态不误伤）', async () => {
    await withDaemon(async (daemon) => {
      const response = await daemon.app.inject({ method: 'GET', url: '/health?probe=1' });
      expect(response.statusCode).toBe(200);
    });
  });
});

describe('token · 令牌头提取', () => {
  it('x-df-token 优先；Bearer 兼容（大小写不敏感前缀）；都缺失 → null', () => {
    expect(extractPresentedToken({ [TOKEN_HEADER]: 'abc' })).toBe('abc');
    expect(extractPresentedToken({ authorization: 'Bearer abc' })).toBe('abc');
    expect(extractPresentedToken({ authorization: 'BEARER abc' })).toBe('abc');
    expect(extractPresentedToken({ authorization: 'bearer   abc  ' })).toBe('abc');
    expect(extractPresentedToken({})).toBeNull();
    expect(extractPresentedToken({ authorization: 'Bearer ' })).toBeNull();
    expect(extractPresentedToken({ authorization: 'Basic abc' })).toBeNull();
    // 两头并存：x-df-token 优先（显式头语义更强）
    expect(extractPresentedToken({ [TOKEN_HEADER]: 'a', authorization: 'Bearer b' })).toBe('a');
  });

  it('authDisabledFromEnv 只认 `1`（显式开启才关，缺省恒开）', () => {
    expect(authDisabledFromEnv({})).toBe(false);
    expect(authDisabledFromEnv({ DF_AUTH_DISABLED: '' })).toBe(false);
    expect(authDisabledFromEnv({ DF_AUTH_DISABLED: '0' })).toBe(false);
    expect(authDisabledFromEnv({ DF_AUTH_DISABLED: 'true' })).toBe(false);
    expect(authDisabledFromEnv({ DF_AUTH_DISABLED: '1' })).toBe(true);
  });
});

describe('token · 令牌文件（<dataRoot>/daemon-token，0600）', () => {
  it('首建生成 64 位 hex、0600 权限；再读复用同值（不重置）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'df-token-test-'));
    try {
      const tokenPath = join(dir, 'nested', TOKEN_FILE_BASENAME);
      const first = await ensureTokenFile(tokenPath);
      expect(first).toMatch(/^[0-9a-f]{64}$/);
      const info = await stat(tokenPath);
      expect(info.mode & 0o777).toBe(0o600);
      expect((await readFile(tokenPath, 'utf8')).trim()).toBe(first);
      // 已存在 → 复用（绝不重置：重置会踢掉所有在线客户端）
      expect(await ensureTokenFile(tokenPath)).toBe(first);
      // 权限被放宽（如 umask/外部 chmod）→ 收紧回 0600
      const { chmod } = await import('node:fs/promises');
      await chmod(tokenPath, 0o664);
      expect(await ensureTokenFile(tokenPath)).toBe(first);
      expect((await stat(tokenPath)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('空文件（损坏态）→ 重建新令牌，不返回空串', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'df-token-test-'));
    try {
      const tokenPath = join(dir, TOKEN_FILE_BASENAME);
      const { writeFile } = await import('node:fs/promises');
      await writeFile(tokenPath, '  \n', 'utf8');
      const token = await ensureTokenFile(tokenPath);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('daemon 启动即在数据根落令牌文件（ensureTokenFile 接线），生产缺省走文件形态', async () => {
    // daemonToken: null = 生产文件形态（app 内 ensureTokenFile 落盘，句柄回读同值）
    await withDaemon(
      async (daemon) => {
        const tokenOnDisk = (
          await readFile(join(daemon.dataRoot, TOKEN_FILE_BASENAME), 'utf8')
        ).trim();
        expect(tokenOnDisk).toBe(daemon.token);
        // 句柄令牌真实可用（injectJson 自动携带）
        const probe = await injectJson(daemon.app, { method: 'GET', url: '/documents' });
        expect(probe.statusCode).toBe(200);
      },
      { daemonToken: null },
    );
  });
});
