import { describe, expect, it } from 'vitest';

import { parseAiChatRequest } from './index.ts';

describe('ai · 请求解析（前端与 daemon 共用的唯一入口校验）', () => {
  it('接受最小合法请求', () => {
    const result = parseAiChatRequest({ messages: [{ role: 'user', content: '画一个圆' }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.messages).toEqual([{ role: 'user', content: '画一个圆' }]);
    expect(result.value).not.toHaveProperty('stream');
  });

  it('接受完整字段并逐项回填', () => {
    const result = parseAiChatRequest({
      provider: 'deepseek',
      model: 'deepseek-reasoner',
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
      ],
      stream: true,
      temperature: 0.7,
      maxTokens: 1024,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stream).toBe(true);
    expect(result.value.temperature).toBe(0.7);
    expect(result.value.maxTokens).toBe(1024);
  });

  it('拒绝空 messages / 非法 role / 非字符串 content', () => {
    expect(parseAiChatRequest({ messages: [] }).ok).toBe(false);
    expect(parseAiChatRequest({}).ok).toBe(false);
    expect(parseAiChatRequest({ messages: [{ role: 'tool', content: 'x' }] }).ok).toBe(false);
    expect(parseAiChatRequest({ messages: [{ role: 'user', content: 1 }] }).ok).toBe(false);
  });

  it('拒绝越界 temperature 与非正 maxTokens', () => {
    const bad = parseAiChatRequest({
      messages: [{ role: 'user', content: 'x' }],
      temperature: 3,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain('temperature');
    expect(
      parseAiChatRequest({ messages: [{ role: 'user', content: 'x' }], maxTokens: 0 }).ok,
    ).toBe(false);
  });

  it('拒绝非 deepseek 供应商（适配层未开前不静默接受）', () => {
    const result = parseAiChatRequest({
      messages: [{ role: 'user', content: 'x' }],
      provider: 'openai',
    });
    expect(result.ok).toBe(false);
  });

  it('未知字段忽略（前向兼容，不报错）', () => {
    const result = parseAiChatRequest({
      messages: [{ role: 'user', content: 'x' }],
      futureField: { nested: true },
    });
    expect(result.ok).toBe(true);
  });
});
