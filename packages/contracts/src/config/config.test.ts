import { describe, expect, it } from 'vitest';

import { isDaemonConfig, isPlausibleApiKey, maskSecret } from './index.ts';

describe('config · 密钥脱敏', () => {
  it('DeepSeek 形态只留 sk- 前缀与末 4 位', () => {
    expect(maskSecret('sk-abcdefgh12345678abcd')).toBe('sk-…abcd');
  });

  it('极短密钥整体打码', () => {
    expect(maskSecret('short')).toBe('****');
  });

  it('未知前缀保留头 2 位', () => {
    expect(maskSecret('abcdefghijklmnop')).toBe('ab…mnop');
  });
});

describe('config · 密钥形态校验', () => {
  it('接受 sk- 前缀 + 长串', () => {
    expect(isPlausibleApiKey('sk-1234567890abcdef')).toBe(true);
  });

  it('拒绝过短/无前缀/非字符串', () => {
    expect(isPlausibleApiKey('sk-123')).toBe(false);
    expect(isPlausibleApiKey('1234567890abcdef')).toBe(false);
    expect(isPlausibleApiKey(null)).toBe(false);
  });
});

describe('config · 配置校验', () => {
  const valid = {
    workspaceDir: '/home/user/dfg',
    ai: { provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' },
    comfy: { baseUrl: 'http://127.0.0.1:8188', installPath: null },
    telemetry: { enabled: true },
  };

  it('接受合法配置', () => {
    expect(isDaemonConfig(valid)).toBe(true);
  });

  it('拒绝缺字段/错类型（installPath 必须是 string|null）', () => {
    expect(isDaemonConfig({ ...valid, telemetry: undefined })).toBe(false);
    expect(isDaemonConfig({ ...valid, comfy: { baseUrl: 'http://x', installPath: 3 } })).toBe(
      false,
    );
    expect(isDaemonConfig({ ...valid, ai: { provider: 'openai', model: 'm', baseUrl: 'u' } })).toBe(
      false,
    );
  });
});
