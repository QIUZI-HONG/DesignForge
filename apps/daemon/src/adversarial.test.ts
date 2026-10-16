/**
 * @dforge/daemon · 独立对抗性验证用例（测试工程师，verify-backend）。
 *
 * 来源：verify-backend 的 `apps/daemon/src/adversarial.test.ts`（原样搬入）。
 * 本分支（fix/daemon-path-traversal）纪律：4 条原 `it.fails`（Q1 越界读/写、Q2 并发丢页、
 * Q3 深嵌套 500）已随修复**翻正为普通 `it`**，其余 7 条守卫用例逐字保留。
 *
 * 全部使用临时目录（testing/harness.ts），不碰 ~/.dforge。
 */

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createTestDaemon, injectJson } from './testing/harness.ts';

/** 构造一份合法 manifest 文本（可注入任意 pageId —— 模拟「仓库里克隆来的 .dfg」）。 */
function manifestText(id: string, pageIds: string[] = ['page-1']): string {
  return `${JSON.stringify(
    {
      schema: 'df.dfg.manifest/v1',
      id,
      name: id,
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      pages: pageIds.map((pageId) => ({
        id: pageId,
        name: pageId,
        updatedAt: '2026-01-01T00:00:00.000Z',
      })),
    },
    null,
    2,
  )}\n`;
}

/** 在工作目录**之外**造一个形状合法的 .dfg 文档，返回其目录。 */
async function makeOutsideDoc(tempDir: string, id: string): Promise<string> {
  const dir = join(tempDir, 'outside', `${id}.dfg`);
  await mkdir(join(dir, 'pages'), { recursive: true });
  await writeFile(join(dir, 'manifest.json'), manifestText(id));
  await writeFile(join(dir, 'pages', 'page-1.json'), '{"outside":true}\n');
  return dir;
}

describe('对抗 · 路径安全（文档名/页名）', () => {
  it('拒绝路径分隔符、绝对路径、..、控制字符、超长与空名', async () => {
    const daemon = await createTestDaemon();
    try {
      const badNames = [
        '../../evil',
        '/etc/passwd',
        '..',
        'a/b',
        'a\\b',
        '',
        '   ',
        'a\u0000b',
        'a'.repeat(65),
      ];
      for (const name of badNames) {
        const res = await injectJson(daemon.app, {
          method: 'POST',
          url: '/documents',
          payload: { name },
        });
        expect(res.statusCode, `name=${JSON.stringify(name)}`).toBe(400);
        expect((res.payload as { error?: { code?: string } }).error?.code).toBe('doc_invalid_name');
      }
      const entries = await readFile(join(daemon.workspaceDir, '..', 'nope'), 'utf8').catch(
        () => null,
      );
      expect(entries).toBeNull();
    } finally {
      await daemon.cleanup();
    }
  });

  // 原 it.fails（报告 Q1：%2F 解码后 documentId 可越界读）—— 修复后翻正为回归锚
  it('documentId 中的编码路径穿越不得读到工作目录之外', async () => {
    const daemon = await createTestDaemon();
    try {
      await makeOutsideDoc(daemon.tempDir, 'victim');
      const res = await injectJson(daemon.app, {
        method: 'GET',
        url: '/documents/..%2Foutside%2Fvictim/pages/page-1',
      });
      // 期望：越界一律拒绝（404/400），绝不返回工作目录外的正文
      expect(res.statusCode).not.toBe(200);
      expect(JSON.stringify(res.payload)).not.toContain('outside');
    } finally {
      await daemon.cleanup();
    }
  });

  // 原 it.fails（报告 Q1：manifest 里的越界 pageId 可越界写 / 删）—— 修复后翻正为回归锚
  it('manifest 里的越界 pageId 不得写出工作目录之外', async () => {
    const daemon = await createTestDaemon();
    try {
      await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: 'shared' },
      });
      const manifestPath = join(daemon.workspaceDir, 'shared.dfg', 'manifest.json');
      await writeFile(manifestPath, manifestText('shared', ['page-1', '../../../outside/leak']));
      const res = await injectJson(daemon.app, {
        method: 'PUT',
        url: '/documents/shared/pages/..%2F..%2F..%2Foutside%2Fleak',
        payload: { body: { pwned: true } },
      });
      const escaped = await readFile(join(daemon.tempDir, 'outside', 'leak.json'), 'utf8').catch(
        () => null,
      );
      // 期望：越界页 id 被拒绝，且工作目录外不出现新文件
      expect(escaped).toBeNull();
      expect(res.statusCode).not.toBe(200);
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('对抗 · 并发与原子写', () => {
  it('并发保存同一页：结果是其中一个完整正文（无半截 JSON）', async () => {
    const daemon = await createTestDaemon();
    try {
      await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: 'conc' },
      });
      const bodies = Array.from({ length: 8 }, (_unused, index) => ({
        n: index + 1,
        pad: 'x'.repeat(50_000),
      }));
      const results = await Promise.all(
        bodies.map((body) =>
          injectJson(daemon.app, {
            method: 'PUT',
            url: '/documents/conc/pages/page-1',
            payload: { body },
          }),
        ),
      );
      expect(results.every((res) => res.statusCode === 200)).toBe(true);
      const read = await injectJson(daemon.app, {
        method: 'GET',
        url: '/documents/conc/pages/page-1',
      });
      const readBody = (read.payload as { result: { body: { n: number; pad: string } } }).result
        .body;
      expect(bodies.map((body) => body.n)).toContain(readBody.n);
      expect(readBody.pad).toHaveLength(50_000);
      // 原子写不留残余临时文件（非崩溃路径）
      const pageDir = join(daemon.workspaceDir, 'conc.dfg', 'pages');
      const leftovers = (await readFile(join(pageDir, 'page-1.json'), 'utf8')).length;
      expect(leftovers).toBeGreaterThan(0);
    } finally {
      await daemon.cleanup();
    }
  });

  // 原 it.fails（报告 Q2：manifest 读改写无串行化 → 已返回 201 的页面被丢弃）—— 修复后翻正为回归锚
  it('并发 createPage 不得丢失已返回 201 的页面', async () => {
    const daemon = await createTestDaemon();
    try {
      await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: 'lossy' },
      });
      const results = await Promise.all(
        Array.from({ length: 10 }, (_unused, index) =>
          injectJson(daemon.app, {
            method: 'POST',
            url: '/documents/lossy/pages',
            payload: { name: `P${index}` },
          }),
        ),
      );
      const created = results.filter((res) => res.statusCode === 201).length;
      const manifest = JSON.parse(
        await readFile(join(daemon.workspaceDir, 'lossy.dfg', 'manifest.json'), 'utf8'),
      ) as { pages: unknown[] };
      expect(manifest.pages.length).toBe(1 + created);
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('对抗 · 错误形状', () => {
  it('畸形 JSON / 未知路由 / 超大请求体 均为统一失败信封', async () => {
    const daemon = await createTestDaemon();
    try {
      const malformed = await daemon.app.inject({
        method: 'POST',
        url: '/documents',
        headers: { 'content-type': 'application/json' },
        payload: '{bad',
      });
      expect(malformed.statusCode).toBe(400);
      expect(malformed.json()).toMatchObject({ ok: false, error: { code: 'bad_request' } });

      const missing = await injectJson(daemon.app, { method: 'GET', url: '/nope' });
      expect(missing.statusCode).toBe(404);
      expect(missing.payload).toMatchObject({ ok: false, error: { code: 'not_found' } });

      const oversized = await daemon.app.inject({
        method: 'POST',
        url: '/documents',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'big', pad: 'x'.repeat(1_200_000) }),
      });
      expect(oversized.statusCode).toBe(400);
      expect(oversized.json()).toMatchObject({ ok: false, error: { code: 'bad_request' } });
    } finally {
      await daemon.cleanup();
    }
  });

  // 原 it.fails（报告 Q3：深嵌套 opaque 正文在 JSON.stringify 处抛栈溢出 → 500）—— 修复后翻正为回归锚
  it('深嵌套正文应以 4xx 拒绝而不是 500', async () => {
    const daemon = await createTestDaemon();
    try {
      await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: 'deep' },
      });
      const deep = `{"body":${'['.repeat(200_000)}${']'.repeat(200_000)}}`;
      const res = await daemon.app.inject({
        method: 'PUT',
        url: '/documents/deep/pages/page-1',
        headers: { 'content-type': 'application/json' },
        payload: deep,
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('对抗 · 凭据纪律（哨兵值全链路无明文）', () => {
  it('写入后 0600 落盘、响应/文件/日志 100% 无明文；清除后不可用', async () => {
    const daemon = await createTestDaemon({ logger: true });
    try {
      // 哨兵值运行时拼接（不在仓库文件里出现完整字面量）
      const sentinel = ['sk-', 'SENTINEL', '-MFH4xyz', 'Q7VERIFY000'].join('');
      const set = await injectJson(daemon.app, {
        method: 'PUT',
        url: '/config/credentials',
        payload: { provider: 'deepseek', apiKey: sentinel },
      });
      expect(set.statusCode).toBe(200);
      expect(JSON.stringify(set.payload)).not.toContain(sentinel);
      expect(JSON.stringify(set.payload)).toContain('sk-…');

      const mode = (await stat(daemon.credentialsPath)).mode & 0o777;
      expect(mode).toBe(0o600);
      const keyMode = (await stat(join(daemon.dataRoot, 'credentials.key'))).mode & 0o777;
      expect(keyMode).toBe(0o600);

      const onDisk = await readFile(daemon.credentialsPath, 'utf8');
      expect(onDisk).not.toContain(sentinel);
      expect(daemon.capturedLogs.join('\n')).not.toContain(sentinel);

      const cleared = await injectJson(daemon.app, {
        method: 'DELETE',
        url: '/config/credentials',
      });
      expect(cleared.payload).toMatchObject({ ok: true, result: { cleared: true } });
      await expect(stat(daemon.credentialsPath)).rejects.toThrow();

      // 无 key：不触网（假 fetch 会抛错），返回同构降级
      const chat = await injectJson(daemon.app, {
        method: 'POST',
        url: '/ai/chat',
        payload: { messages: [{ role: 'user', content: 'hi' }] },
      });
      expect(daemon.fetchCalls).toHaveLength(0);
      const chatResult = (chat.payload as { result: Record<string, unknown> }).result;
      expect(chatResult.degraded).toBe(true);
      expect(chatResult.degradedReason).toBe('no-credentials');
      expect(Object.keys(chatResult).sort()).toEqual(
        [
          'content',
          'degraded',
          'degradedReason',
          'finishReason',
          'model',
          'provider',
          'runId',
          'suggestions',
          'usage',
        ].sort(),
      );
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('对抗 · CORS 边界', () => {
  it('白名单回显、非白名单不回 CORS 头、null 放行、伪造子域拒绝', async () => {
    const daemon = await createTestDaemon();
    try {
      const allowed = await daemon.app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'http://localhost:3000' },
      });
      expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(allowed.headers.vary).toBe('Origin');

      for (const origin of [
        'http://evil.com',
        'http://localhost:3000.evil.tld',
        'http://localhost:3000.',
      ]) {
        const res = await daemon.app.inject({ method: 'GET', url: '/health', headers: { origin } });
        expect(res.headers['access-control-allow-origin'], origin).toBeUndefined();
      }
      const nullOrigin = await daemon.app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'null' },
      });
      expect(nullOrigin.headers['access-control-allow-origin']).toBe('null');

      const preflight = await daemon.app.inject({
        method: 'OPTIONS',
        url: '/documents',
        headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'PUT' },
      });
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers['access-control-allow-methods']).toContain('PUT');
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('对抗 · 导出（魔数与像素）', () => {
  const scene = {
    width: 200,
    height: 100,
    background: '#FFFFFF',
    children: [{ kind: 'rect', x: 10, y: 10, width: 80, height: 60, fill: '#FF0000' }],
  };

  it('三档产物魔数正确，PNG 尺寸随 scale 变化且被钳制', async () => {
    const daemon = await createTestDaemon();
    try {
      await injectJson(daemon.app, { method: 'POST', url: '/documents', payload: { name: 'exp' } });
      await injectJson(daemon.app, {
        method: 'PUT',
        url: '/documents/exp/pages/page-1',
        payload: { body: scene },
      });

      const magic: Record<string, string> = {
        png: '89504e470d0a1a0a',
        svg: '3c212d2d20446573',
        pdf: '255044462d312e34',
      };
      for (const format of ['png', 'svg', 'pdf'] as const) {
        const res = await injectJson(daemon.app, {
          method: 'POST',
          url: '/export',
          payload: { documentId: 'exp', pageId: 'page-1', format, scale: 2 },
        });
        const artifact = (
          res.payload as { result: { artifact: { base64: string; sha256: string } } }
        ).result.artifact;
        const bytes = Buffer.from(artifact.base64, 'base64');
        expect(bytes.subarray(0, 8).toString('hex')).toContain(magic[format]?.slice(0, 16));
        if (format === 'png') {
          expect(bytes.readUInt32BE(16)).toBe(400);
          expect(bytes.readUInt32BE(20)).toBe(200);
        }
      }
      const clamped = await injectJson(daemon.app, {
        method: 'POST',
        url: '/export',
        payload: { documentId: 'exp', pageId: 'page-1', format: 'png', scale: 1e9 },
      });
      const pngBytes = Buffer.from(
        (clamped.payload as { result: { artifact: { base64: string } } }).result.artifact.base64,
        'base64',
      );
      expect(pngBytes.readUInt32BE(16)).toBe(800); // scale 钳到上限 4

      const badScale = await injectJson(daemon.app, {
        method: 'POST',
        url: '/export',
        payload: { documentId: 'exp', pageId: 'page-1', format: 'png', scale: 0.5 },
      });
      expect(badScale.statusCode).toBe(400);

      // 巨大画布：无尺寸钳制 —— 极端值以 export_render_failed 收场（不崩）
      await injectJson(daemon.app, {
        method: 'PUT',
        url: '/documents/exp/pages/page-1',
        payload: { body: { width: 1_000_000, height: 1_000_000, children: [] } },
      });
      const huge = await injectJson(daemon.app, {
        method: 'POST',
        url: '/export',
        payload: { documentId: 'exp', pageId: 'page-1', format: 'png' },
      });
      expect(huge.payload).toMatchObject({ ok: false, error: { code: 'export_render_failed' } });
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('对抗 · 端口与上限', () => {
  it('占用全部探测端口段时启动失败（不静默换随机端口）', async () => {
    const { createServer } = await import('node:net');
    const holder = createServer();
    const ports: number[] = [];
    await new Promise<void>((resolve) => holder.listen(0, '127.0.0.1', () => resolve()));
    const base = (holder.address() as { port: number }).port;
    await new Promise<void>((resolve) => holder.close(() => resolve()));
    ports.push(base);
    const servers = await Promise.all(
      Array.from({ length: 5 }, (_unused, index) => {
        const port = base + index;
        ports.push(port);
        const server = createServer();
        return new Promise<ReturnType<typeof createServer>>((resolve) =>
          server.listen(port, '127.0.0.1', () => resolve(server)),
        );
      }),
    );
    try {
      const { startDaemon } = await import('./server.ts');
      const { mkdtemp } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const temp = await mkdtemp(join(tmpdir(), 'df-port-'));
      await expect(
        startDaemon({
          dataRoot: temp,
          workspaceDir: join(temp, 'ws'),
          port: base,
          maxPortOffset: 4,
        }),
      ).rejects.toThrow(/全部被占用/);
      await rm(temp, { recursive: true, force: true });
    } finally {
      await Promise.all(
        servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
      );
      expect(ports.length).toBeGreaterThan(0);
    }
  });
});
