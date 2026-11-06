/**
 * daemon 请求体上限（audit-d05 · D-08 回归）。
 *
 * 缺陷基线（perf 门禁 @5k 节点实证）：Fastify 缺省 bodyLimit=1MiB——大文档 PUT 报
 * `bad_request: Request body is too large`（英文原文且 413 被折叠成 400）。
 * 修复口径：上限可配置（env `DF_BODY_LIMIT`，缺省上调 32 MB），超限 413 + 人话中文信封。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BODY_LIMIT_ENV,
  bodyLimitFromEnv,
  DAEMON_BODY_LIMIT_DEFAULT,
  formatBodyLimit,
  parseBodyLimit,
} from './body-limit.ts';
import type { TestDaemon } from './testing/harness.ts';
import { createTestDaemon, injectJson } from './testing/harness.ts';
import { TOKEN_HEADER } from './token.ts';

/** 环境隔离：DF_BODY_LIMIT 不泄入/泄出用例（进程 env 是全局态）。 */
let savedEnv: string | undefined;
beforeEach(() => {
  savedEnv = process.env[BODY_LIMIT_ENV];
  delete process.env[BODY_LIMIT_ENV];
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env[BODY_LIMIT_ENV];
  else process.env[BODY_LIMIT_ENV] = savedEnv;
});

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

/** 建一个文档，返回 id（带令牌，injectJson 自动携带）。 */
async function createDocument(daemon: TestDaemon): Promise<string> {
  const created = await injectJson(daemon.app, {
    method: 'POST',
    url: '/documents',
    payload: { name: '大文档' },
  });
  expect(created.statusCode).toBe(201);
  const payload = created.payload as { result: { document: { id: string } } };
  return payload.result.document.id;
}

describe('parseBodyLimit / formatBodyLimit / bodyLimitFromEnv（D-08 配置面）', () => {
  it('parseBodyLimit：kb/mb/gb 大小写不敏感 + 裸字节数', () => {
    expect(parseBodyLimit('32mb')).toBe(32 * 1024 * 1024);
    expect(parseBodyLimit('512KB')).toBe(512 * 1024);
    expect(parseBodyLimit('1GB')).toBe(1024 * 1024 * 1024);
    expect(parseBodyLimit('1048576')).toBe(1024 * 1024);
    expect(parseBodyLimit(' 64kb ')).toBe(64 * 1024);
  });

  it('parseBodyLimit：非法形态/零/超 1GB 上限 → null', () => {
    expect(parseBodyLimit('abc')).toBeNull();
    expect(parseBodyLimit('32 mb')).toBeNull();
    expect(parseBodyLimit('0')).toBeNull();
    expect(parseBodyLimit('2gb')).toBeNull();
    expect(parseBodyLimit('')).toBeNull();
  });

  it('formatBodyLimit：人话形态', () => {
    expect(formatBodyLimit(32 * 1024 * 1024)).toBe('32 MB');
    expect(formatBodyLimit(64 * 1024)).toBe('64 KB');
    expect(formatBodyLimit(4097)).toBe('4097 字节');
  });

  it('bodyLimitFromEnv：未设置 → 缺省 32MB；非法 → 缺省 + stderr 告警（不许静默吞）', () => {
    expect(bodyLimitFromEnv({})).toBe(DAEMON_BODY_LIMIT_DEFAULT);
    const writes: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(bodyLimitFromEnv({ [BODY_LIMIT_ENV]: 'not-a-limit' })).toBe(DAEMON_BODY_LIMIT_DEFAULT);
    } finally {
      process.stderr.write = original;
    }
    expect(writes.some((line) => line.includes(`${BODY_LIMIT_ENV} 值无效`))).toBe(true);
  });
});

describe('daemon 请求体上限（D-08 应用行为）', () => {
  it('缺省 32MB：>1MB 页面正文 PUT 成功（旧基线 1MiB 会 400）且读回一致', async () => {
    await withDaemon(async (daemon) => {
      const id = await createDocument(daemon);
      const pad = 'x'.repeat(1_500_000);
      const saved = await injectJson(daemon.app, {
        method: 'PUT',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
        payload: { body: { pad } },
      });
      expect(saved.statusCode).toBe(200);
      const readBack = await injectJson(daemon.app, {
        method: 'GET',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
      });
      expect(readBack.statusCode).toBe(200);
      const body = (readBack.payload as { result: { body: { pad: string } } }).result.body;
      expect(body.pad).toBe(pad);
    });
  });

  it('env DF_BODY_LIMIT=64kb 覆盖生效：100KB 正文 → 413 body_too_large 人话中文', async () => {
    process.env[BODY_LIMIT_ENV] = '64kb';
    await withDaemon(async (daemon) => {
      const id = await createDocument(daemon);
      const saved = await injectJson(daemon.app, {
        method: 'PUT',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
        payload: { body: { pad: 'y'.repeat(100_000) } },
      });
      expect(saved.statusCode).toBe(413);
      const payload = saved.payload as { ok: boolean; error: { code: string; message: string } };
      expect(payload.ok).toBe(false);
      expect(payload.error.code).toBe('body_too_large');
      expect(payload.error.message).toContain('请求体超过');
      expect(payload.error.message).toContain('DF_BODY_LIMIT');
    });
  });

  it('钩子序不变：无令牌的超大请求 → 401（令牌闸门先于 413 解析）', async () => {
    process.env[BODY_LIMIT_ENV] = '64kb';
    await withDaemon(async (daemon) => {
      const response = await daemon.app.inject({
        method: 'PUT',
        url: '/documents/some-doc/pages/page-1',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ body: { pad: 'z'.repeat(100_000) } }),
      });
      expect(response.statusCode).toBe(401);
      const payload = response.json() as { error: { code: string } };
      expect(payload.error.code).toBe('unauthorized');
    });
  });

  it('显式 bodyLimit 选项优先于 env（测试/门禁注入口径）', async () => {
    process.env[BODY_LIMIT_ENV] = '64kb';
    await withDaemon(
      async (daemon) => {
        const id = await createDocument(daemon);
        const saved = await injectJson(daemon.app, {
          method: 'PUT',
          url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
          payload: { body: { pad: 'w'.repeat(1_000_000) } },
        });
        expect(saved.statusCode).toBe(200);
      },
      { bodyLimit: DAEMON_BODY_LIMIT_DEFAULT },
    );
  });

  it('env 非法：回退缺省（>1MB PUT 成功）且告警可见', async () => {
    process.env[BODY_LIMIT_ENV] = 'not-a-limit';
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      await withDaemon(async (daemon) => {
        expect(stderrSpy.mock.calls.some(([chunk]) => String(chunk).includes('值无效'))).toBe(true);
        const id = await createDocument(daemon);
        const saved = await injectJson(daemon.app, {
          method: 'PUT',
          url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
          payload: { body: { pad: 'v'.repeat(1_500_000) } },
        });
        expect(saved.statusCode).toBe(200);
      });
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
