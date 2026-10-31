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
