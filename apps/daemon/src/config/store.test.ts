/**
 * @dforge/daemon · 配置存储 baseUrl 收敛用例（test-remediation 票 02 · §A2-5c）。
 *
 * 语义从严的两道闸：
 * - patch 入口：越界 baseUrl 拒绝（ok:false），**内存与磁盘不改**；
 * - load 入口：磁盘上的历史脏值（旧版本写入 / 已被污染的 config.json）不得静默继承，
 *   对应字段回退默认值（封死「重启后外送通道复活」）。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createConfigStore, defaultConfig } from './store.ts';

const TEMP_ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(
    TEMP_ROOTS.splice(0).map((root) =>
      rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
    ),
  );
});

async function makeStore(rawConfig?: string): Promise<{ configJsonPath: string; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'df-config-'));
  TEMP_ROOTS.push(root);
  const configJsonPath = join(root, 'config.json');
  if (rawConfig !== undefined) {
    await writeFile(configJsonPath, rawConfig, 'utf8');
  }
  return { configJsonPath, root };
}

describe('config store · patch baseUrl 收敛（越界拒绝且不改内存）', () => {
  it('ai.baseUrl 仅放行 DeepSeek 官方域（https）；越界值 4xx 拒绝且内存保持默认', async () => {
    const { configJsonPath } = await makeStore();
    const store = createConfigStore({ configJsonPath, defaultWorkspaceDir: '/df-ws' });

    const rejects = [
      'https://evil.example.com',
      'https://api.deepseek.com.evil.example.com',
      'https://api.deepseek.com@evil.example.com',
      'http://api.deepseek.com', // 明文 http：key 以 Bearer 头外送面，一律拒绝
      'https://api.deepseek.com:8443', // 非默认端口不在 allowlist
      'https://169.254.169.254/latest/meta-data',
      'not-a-url',
      '',
    ];
    for (const baseUrl of rejects) {
      const result = await store.patch({ ai: { baseUrl } });
      expect(result.ok, `ai.baseUrl=${baseUrl}`).toBe(false);
      if (!result.ok) {
        expect(result.message, `ai.baseUrl=${baseUrl}`).toContain('DeepSeek');
      }
    }
    // 全部拒绝后内存不变（仍为默认官方域）
    expect(store.get().ai.baseUrl).toBe('https://api.deepseek.com');
  });

  it('ai.baseUrl 官方域（含 /v1 路径前缀形态）放行并持久化', async () => {
    const { configJsonPath } = await makeStore();
    const store = createConfigStore({ configJsonPath, defaultWorkspaceDir: '/df-ws' });
    const ok = await store.patch({ ai: { baseUrl: 'https://api.deepseek.com/v1' } });
    expect(ok.ok).toBe(true);
    expect(store.get().ai.baseUrl).toBe('https://api.deepseek.com/v1');
  });

  it('comfy.baseUrl 仅放行回环网段（127.0.0.0/8、::1、localhost）；越界拒绝且内存不变', async () => {
    const { configJsonPath } = await makeStore();
    const store = createConfigStore({ configJsonPath, defaultWorkspaceDir: '/df-ws' });

    const rejects = [
      'http://192.168.1.9:8188',
      'http://10.0.0.5:8188',
      'http://evil.example.com:8188',
      'http://localhost.evil.example:8188',
      'http://127.0.0.1@evil.example.com:8188',
      'https://127.0.0.2.evil.example.com:8188',
      'ftp://127.0.0.1:8188',
      'not-a-url',
    ];
    for (const baseUrl of rejects) {
      const result = await store.patch({ comfy: { baseUrl } });
      expect(result.ok, `comfy.baseUrl=${baseUrl}`).toBe(false);
      if (!result.ok) {
        expect(result.message, `comfy.baseUrl=${baseUrl}`).toContain('回环');
      }
    }
    expect(store.get().comfy.baseUrl).toBe('http://127.0.0.1:8188');
  });

  it('comfy.baseUrl 回环全形态放行（127/8 任意段、[::1]、localhost、任意端口）', async () => {
    const { configJsonPath } = await makeStore();
    const store = createConfigStore({ configJsonPath, defaultWorkspaceDir: '/df-ws' });
    for (const baseUrl of [
      'http://127.0.0.1:8188',
      'http://127.8.8.8:8188',
      'http://localhost:8188',
      'http://[::1]:8188',
      'https://127.0.0.1:9188',
    ]) {
      const result = await store.patch({ comfy: { baseUrl } });
      expect(result.ok, `comfy.baseUrl=${baseUrl}`).toBe(true);
      expect(store.get().comfy.baseUrl, `comfy.baseUrl=${baseUrl}`).toBe(baseUrl);
    }
  });
});

describe('config store · load 磁盘脏值收敛（不静默继承越界 baseUrl）', () => {
  it('磁盘上的越界 ai.baseUrl / comfy.baseUrl 载入时回退默认，其余字段保留', async () => {
    const poisoned = {
      workspaceDir: '/df-poisoned-ws',
      ai: { provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://evil.example.com' },
      comfy: { baseUrl: 'http://192.168.1.9:8188', installPath: null },
      telemetry: { enabled: false },
    };
    const { configJsonPath } = await makeStore(`${JSON.stringify(poisoned)}\n`);
    const store = createConfigStore({ configJsonPath, defaultWorkspaceDir: '/df-ws' });
    await store.load();

    const config = store.get();
    expect(config.ai.baseUrl).toBe(defaultConfig('/df-ws').ai.baseUrl);
    expect(config.comfy.baseUrl).toBe(defaultConfig('/df-ws').comfy.baseUrl);
    // 非越界字段照常继承
    expect(config.workspaceDir).toBe('/df-poisoned-ws');
    expect(config.telemetry.enabled).toBe(false);
  });

  it('磁盘上的合法官方域/回环 baseUrl 照常载入（不误伤）', async () => {
    const fine = {
      workspaceDir: '/df-ws',
      ai: { provider: 'deepseek', model: 'deepseek-reasoner', baseUrl: 'https://api.deepseek.com/v1' },
      comfy: { baseUrl: 'http://localhost:8188', installPath: null },
      telemetry: { enabled: true },
    };
    const { configJsonPath } = await makeStore(`${JSON.stringify(fine)}\n`);
    const store = createConfigStore({ configJsonPath, defaultWorkspaceDir: '/df-ws' });
    await store.load();

    expect(store.get().ai.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(store.get().ai.model).toBe('deepseek-reasoner');
    expect(store.get().comfy.baseUrl).toBe('http://localhost:8188');
  });
});
