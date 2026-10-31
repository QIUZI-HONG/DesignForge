/**
 * @dforge/daemon · 访问控制对抗用例（test-remediation 票 02）。
 *
 * 依据 `~/df-evidence/test-2026-10-31/report.md` §A2（安全三连）：
 * - Host 校验缺失 → DNS rebinding 形态的同源请求直达（本文件「Host 校验」组）；
 * - `Origin: null` 无条件放行 → 沙箱 iframe 跨源读写（cors.test.ts / adversarial.test.ts）；
 * - `PUT /config` 任意 baseUrl → 存储 key 外送（本文件「baseUrl 收敛」组）。
 *
 * 全部使用临时目录与假上游（testing/harness.ts），不碰 ~/.dforge、不真实出网。
 */

import { describe, expect, it } from 'vitest';

import { createTestDaemon, injectJson } from './testing/harness.ts';

/** 默认 DeepSeek 官方 baseUrl（config/store.ts 缺省值，allowlist 锚点）。 */
const DEFAULT_AI_BASE_URL = 'https://api.deepseek.com';

describe('对抗 · 访问控制（baseUrl 收敛：凭据只发往 allowlist 域）', () => {
  /** 哨兵 key 运行时拼接（不进仓库字面量）。 */
  const sentinel = ['sk-', 'AC-SENTINEL', '-02KEY', '000XYZ'].join('');

  it('改 ai.baseUrl 为任意域被 4xx 拒绝、内存不变；凭据只发往官方域', async () => {
    const daemon = await createTestDaemon();
    try {
      // 已配置 key 的前提（§A2-5c 利用链第二步）
      const setKey = await injectJson(daemon.app, {
        method: 'PUT',
        url: '/config/credentials',
        payload: { provider: 'deepseek', apiKey: sentinel },
      });
      expect(setKey.statusCode).toBe(200);

      // 第一步「换地址」被配置入口拒绝：4xx 且不改内存
      for (const baseUrl of [
        'https://evil.example.com',
        'http://api.deepseek.com.evil.example.com',
        'https://api.deepseek.com@evil.example.com',
      ]) {
        const res = await injectJson(daemon.app, {
          method: 'PUT',
          url: '/config',
          payload: { ai: { baseUrl } },
        });
        expect(res.statusCode, `ai.baseUrl=${baseUrl}`).toBe(400);
        expect(
          (res.payload as { error?: { code?: string } }).error?.code,
          `ai.baseUrl=${baseUrl}`,
        ).toBe('config_invalid');
      }
      const config = await injectJson(daemon.app, { method: 'GET', url: '/config' });
      expect(
        (config.payload as { result: { config: { ai: { baseUrl: string } } } }).result.config.ai
          .baseUrl,
      ).toBe(DEFAULT_AI_BASE_URL);

      // AI 请求仍只发往官方域：假上游会记录全部出网调用
      const chat = await injectJson(daemon.app, {
        method: 'POST',
        url: '/ai/chat',
        payload: { messages: [{ role: 'user', content: 'hi' }] },
      });
      expect(chat.statusCode).toBe(200);
      expect(daemon.fetchCalls.length).toBeGreaterThan(0);
      for (const call of daemon.fetchCalls) {
        expect(call.url.startsWith(`${DEFAULT_AI_BASE_URL}/`), `出网 url=${call.url}`).toBe(true);
        expect(call.url).not.toContain('evil');
      }
    } finally {
      await daemon.cleanup();
    }
  });

  it('改 comfy.baseUrl 为非回环被 4xx 拒绝、内存不变；出图探测不触达内网/公网', async () => {
    const daemon = await createTestDaemon();
    try {
      for (const baseUrl of [
        'http://192.168.1.9:8188',
        'http://10.0.0.5:8188',
        'http://evil.example.com:8188',
      ]) {
        const res = await injectJson(daemon.app, {
          method: 'PUT',
          url: '/config',
          payload: { comfy: { baseUrl } },
        });
        expect(res.statusCode, `comfy.baseUrl=${baseUrl}`).toBe(400);
        expect(
          (res.payload as { error?: { code?: string } }).error?.code,
          `comfy.baseUrl=${baseUrl}`,
        ).toBe('config_invalid');
      }
      const config = await injectJson(daemon.app, { method: 'GET', url: '/config' });
      expect(
        (config.payload as { result: { config: { comfy: { baseUrl: string } } } }).result.config
          .comfy.baseUrl,
      ).toBe('http://127.0.0.1:8188');

      // 探测走的是内存配置（默认回环死端口），绝不触达被拒地址
      await injectJson(daemon.app, { method: 'GET', url: '/image/probe' });
      for (const call of daemon.fetchCalls) {
        expect(new URL(call.url).hostname, `出网 url=${call.url}`).toMatch(
          /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/,
        );
      }
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('对抗 · 访问控制（Host 头校验）', () => {
  it('DNS rebinding 形态：非回环 Host 一律 403 forbidden（带端口/子域伪装/纯域名）', async () => {
    const daemon = await createTestDaemon();
    try {
      for (const host of [
        'evil.rebind.example',
        'evil.rebind.example:4318',
        'localhost.evil.example',
        '127.0.0.1.evil.example',
        'localhost:80.evil.example',
        '0.0.0.0',
        '192.168.1.9:8188',
        '[fe80::1]:4318',
      ]) {
        const res = await daemon.app.inject({
          method: 'GET',
          url: '/health',
          headers: { host },
        });
        expect(res.statusCode, `host=${host}`).toBe(403);
        expect(res.json(), `host=${host}`).toMatchObject({
          ok: false,
          error: { code: 'forbidden' },
        });
      }
    } finally {
      await daemon.cleanup();
    }
  });

  it('回环 Host 全放行：127.0.0.0/8、localhost、[::1]、任意端口、大小写与尾点', async () => {
    const daemon = await createTestDaemon();
    try {
      for (const host of [
        '127.0.0.1:4318',
        '127.9.9.9',
        'localhost:3000',
        'LOCALHOST:4318',
        '[::1]:4318',
        '[::1]',
        '127.0.0.1.',
      ]) {
        const res = await daemon.app.inject({
          method: 'GET',
          url: '/health',
          headers: { host },
        });
        expect(res.statusCode, `host=${host}`).toBe(200);
        expect((res.json() as { ok: boolean }).ok, `host=${host}`).toBe(true);
      }
    } finally {
      await daemon.cleanup();
    }
  });

  it('Host 拒绝发生在路由之前：未知路由与写方法同样 403（无 API 语义泄露）', async () => {
    const daemon = await createTestDaemon();
    try {
      const notFound = await daemon.app.inject({
        method: 'GET',
        url: '/documents',
        headers: { host: 'evil.rebind.example' },
      });
      expect(notFound.statusCode).toBe(403);
      expect(notFound.json()).toMatchObject({ ok: false, error: { code: 'forbidden' } });

      const write = await daemon.app.inject({
        method: 'PUT',
        url: '/config',
        headers: { host: 'evil.rebind.example', 'content-type': 'application/json' },
        payload: JSON.stringify({ telemetry: { enabled: false } }),
      });
      expect(write.statusCode).toBe(403);
      // 拒绝在路由前：内存配置不得被这次请求改动
      const config = await injectJson(daemon.app, { method: 'GET', url: '/config' });
      expect(
        (config.payload as { result: { config: { telemetry: { enabled: boolean } } } }).result.config
          .telemetry.enabled,
      ).toBe(true);
    } finally {
      await daemon.cleanup();
    }
  });
});
