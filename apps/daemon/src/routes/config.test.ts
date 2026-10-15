import { stat } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { createTestDaemon, injectJson } from '../testing/harness.ts';

/** 假 key 形态（与真实 key 隔离：断言任何响应/日志/文件不含它）。 */
const FAKE_KEY = 'sk-fake-1234567890abcd';

describe('config · GET /config', () => {
  it('首启返回默认配置，凭据为未配置（不含任何 key 字段明文）', async () => {
    const daemon = await createTestDaemon();
    try {
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'GET',
        url: '/config',
      });
      expect(statusCode).toBe(200);
      const result = (
        payload as {
          result: {
            config: Record<string, unknown>;
            credentials: { deepseek: Record<string, unknown> };
          };
        }
      ).result;
      expect(result.config.workspaceDir).toBe(daemon.workspaceDir);
      expect((result.config.ai as Record<string, unknown>).provider).toBe('deepseek');
      expect(result.credentials.deepseek.hasKey).toBe(false);
      expect(result.credentials.deepseek.maskedKey).toBeNull();
      expect(JSON.stringify(payload)).not.toContain('apiKey');
    } finally {
      await daemon.cleanup();
    }
  });

  it('环境变量注入的 key 只回掩码与来源（source=env）', async () => {
    const daemon = await createTestDaemon({ envApiKey: FAKE_KEY });
    try {
      const { payload } = await injectJson(daemon.app, { method: 'GET', url: '/config' });
      const summary = (
        payload as { result: { credentials: { deepseek: Record<string, unknown> } } }
      ).result.credentials.deepseek;
      expect(summary.hasKey).toBe(true);
      expect(summary.source).toBe('env');
      expect(summary.maskedKey).toBe('sk-…abcd');
      expect(JSON.stringify(payload)).not.toContain(FAKE_KEY);
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('config · PUT /config（局部更新与校验）', () => {
  it('工作目录规范化并存盘（GET 回读为新值）', async () => {
    const daemon = await createTestDaemon();
    try {
      const target = `${daemon.tempDir}/新建 目录/../工作区`;
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'PUT',
        url: '/config',
        payload: { workspaceDir: target },
      });
      expect(statusCode).toBe(200);
      const config = (payload as { result: { config: { workspaceDir: string } } }).result.config;
      expect(config.workspaceDir).toBe(`${daemon.tempDir}/工作区`);

      const readBack = await injectJson(daemon.app, { method: 'GET', url: '/config' });
      expect(
        (readBack.payload as { result: { config: { workspaceDir: string } } }).result.config
          .workspaceDir,
      ).toBe(`${daemon.tempDir}/工作区`);
    } finally {
      await daemon.cleanup();
    }
  });

  it('非法值拒绝（工作目录落在文件下 → config_invalid；配置保持原值）', async () => {
    const daemon = await createTestDaemon();
    try {
      // 先造一个文件，再把它当作目录父级 → mkdir 必然失败
      const blocker = `${daemon.tempDir}/blocker.txt`;
      await (await import('node:fs/promises')).writeFile(blocker, 'x');
      const bad = await injectJson(daemon.app, {
        method: 'PUT',
        url: '/config',
        payload: { workspaceDir: `${blocker}/sub` },
      });
      expect(bad.statusCode).toBe(400);
      const error = (bad.payload as { error: { code: string } }).error;
      expect(error.code).toBe('config_invalid');

      const readBack = await injectJson(daemon.app, { method: 'GET', url: '/config' });
      expect(
        (readBack.payload as { result: { config: { workspaceDir: string } } }).result.config
          .workspaceDir,
      ).toBe(daemon.workspaceDir);
    } finally {
      await daemon.cleanup();
    }
  });

  it('非法 baseUrl / provider / 布尔值拒绝', async () => {
    const daemon = await createTestDaemon();
    try {
      for (const payload of [
        { comfy: { baseUrl: 'not-a-url' } },
        { ai: { provider: 'openai' } },
        { telemetry: { enabled: 'yes' } },
      ]) {
        const { statusCode, payload: body } = await injectJson(daemon.app, {
          method: 'PUT',
          url: '/config',
          payload,
        });
        expect(statusCode).toBe(400);
        expect((body as { error: { code: string } }).error.code).toBe('config_invalid');
      }
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('config · 凭据写入与清除（key 永不下行）', () => {
  it('写入 key：响应只回掩码；文件 0600 且不含明文', async () => {
    const daemon = await createTestDaemon();
    try {
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'PUT',
        url: '/config/credentials',
        payload: { apiKey: FAKE_KEY },
      });
      expect(statusCode).toBe(200);
      const summary = (
        payload as { result: { summary: { maskedKey: string; hasKey: boolean; source: string } } }
      ).result.summary;
      expect(summary.hasKey).toBe(true);
      expect(summary.maskedKey).toBe('sk-…abcd');
      expect(summary.source).toBe('stored');
      expect(JSON.stringify(payload)).not.toContain(FAKE_KEY);

      const fileStat = await stat(daemon.credentialsPath);
      expect(fileStat.mode & 0o777).toBe(0o600);
      const raw = await (await import('node:fs/promises')).readFile(daemon.credentialsPath, 'utf8');
      expect(raw).not.toContain(FAKE_KEY);
      expect(raw).toContain('aes-256-gcm');
    } finally {
      await daemon.cleanup();
    }
  });

  it('形态非法的 key 拒绝（credential_invalid）', async () => {
    const daemon = await createTestDaemon();
    try {
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'PUT',
        url: '/config/credentials',
        payload: { apiKey: ['plain', 'wrong'].join('-') },
      });
      expect(statusCode).toBe(400);
      expect((payload as { error: { code: string } }).error.code).toBe('credential_invalid');
    } finally {
      await daemon.cleanup();
    }
  });

  it('清除 key 后 AI 进入降级态（不报错，degraded=no-credentials）', async () => {
    const daemon = await createTestDaemon();
    try {
      await injectJson(daemon.app, {
        method: 'PUT',
        url: '/config/credentials',
        payload: { apiKey: FAKE_KEY },
      });
      const cleared = await injectJson(daemon.app, {
        method: 'DELETE',
        url: '/config/credentials',
      });
      expect(cleared.statusCode).toBe(200);
      const result = (
        cleared.payload as { result: { summary: { hasKey: boolean }; cleared: boolean } }
      ).result;
      expect(result.cleared).toBe(true);
      expect(result.summary.hasKey).toBe(false);

      const chat = await injectJson(daemon.app, {
        method: 'POST',
        url: '/ai/chat',
        payload: { messages: [{ role: 'user', content: '画一个圆' }] },
      });
      expect(chat.statusCode).toBe(200);
      const response = (chat.payload as { result: { degraded: boolean; degradedReason: string } })
        .result;
      expect(response.degraded).toBe(true);
      expect(response.degradedReason).toBe('no-credentials');
    } finally {
      await daemon.cleanup();
    }
  });

  it('key 不出现在日志（logger 开启下 PUT 后检查捕获日志与响应）', async () => {
    const daemon = await createTestDaemon({ logger: true });
    try {
      const response = await injectJson(daemon.app, {
        method: 'PUT',
        url: '/config/credentials',
        payload: { apiKey: FAKE_KEY },
      });
      const readBack = await injectJson(daemon.app, { method: 'GET', url: '/config' });
      const logText = daemon.capturedLogs.join('\n');
      for (const text of [response.raw, readBack.raw, logText]) {
        expect(text).not.toContain(FAKE_KEY);
        expect(text).not.toContain('1234567890ab'); // key 的任何显著片段都不应出现
      }
      // 捕获确实在工作（否则断言无意义）：请求日志应含路由
      expect(logText).toContain('/config/credentials');
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('config · POST /config/connectivity（诊断自检）', () => {
  it('三项自检齐备：daemon ok / ComfyUI 未启动（结构化） / AI 未配置；且不触达云端', async () => {
    const daemon = await createTestDaemon();
    try {
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/config/connectivity',
      });
      expect(statusCode).toBe(200);
      const report = (
        payload as {
          result: {
            items: { id: string; status: string; code: string | null; actions: string[] }[];
            checkedAt: string;
          };
        }
      ).result;
      expect(report.items.map((item) => item.id)).toEqual(['daemon', 'comfyui', 'ai']);
      expect(report.items[0]?.status).toBe('ok');
      const comfy = report.items[1];
      expect(comfy?.status).toBe('unavailable');
      expect(comfy?.code).toBe('comfy_unreachable');
      expect(comfy?.actions).toContain('retry-probe');
      const ai = report.items[2];
      expect(ai?.status).toBe('not-configured');
      expect(ai?.code).toBeNull();

      // 不真调云端：所有上游调用都指向本机（ComfyUI 探测），没有 api.deepseek.com
      expect(daemon.fetchCalls.length).toBeGreaterThan(0);
      for (const call of daemon.fetchCalls) {
        expect(call.url).toContain('127.0.0.1');
      }
    } finally {
      await daemon.cleanup();
    }
  });
});
