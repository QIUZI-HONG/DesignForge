/**
 * @dforge/daemon · 本地建议生成器测试（票 03 / spec P0-2）。
 *
 * 断言口径（spec「Testing Decisions」· 纯函数层）：**表驱动断言关键词族 → 建议结构**，
 * 只测外部可见的输入输出（content 文本 + suggestions 契约结构），不测内部模板拼装；
 * 另断言「同输入同输出」确定性与空 / 无关键词输入的兜底。
 */
import { describe, expect, it } from 'vitest';

import { generateLocalAdvice } from './local-advisor.ts';

/** 契约合法的建议 kind（AiSuggestion 全集）。 */
const SUGGESTION_KINDS = new Set(['configure-credentials', 'retry-later', 'check-network', 'manual-edit']);

describe('本地建议生成器 · 关键词族识别（表驱动）', () => {
  it.each([
    { topic: '按钮', prompts: ['给首屏加一个主按钮', 'add a primary button to the hero', 'CTA 要更突出'] },
    { topic: '颜色', prompts: ['把背景颜色统一为暖色', '配色再紧凑一点', 'unify the color'] },
    { topic: '圆角', prompts: ['把圆角统一为 8', '卡片 radius 改小'] },
    { topic: '布局', prompts: ['间距和对齐统一一下', '整体布局更紧凑', '图标排列居中'] },
    { topic: '文本', prompts: ['标题文字改大一点', '字体换成无衬线', 'body text smaller'] },
  ])('「$topic」族：content 给出该族分步建议，suggestions 追加对应 manual-edit 条目', ({ topic, prompts }) => {
    for (const prompt of prompts) {
      const advice = generateLocalAdvice(prompt);
      // 正文可读且结构完整：非空 + 分步编号 + 注意事项段
      expect(advice.content.length).toBeGreaterThan(0);
      expect(advice.content).toContain('注意事项');
      expect(advice.content).toMatch(/\n\d+\./);
      // 关键词族被识别为建议对象（路由到对应族的分步建议）
      expect(advice.content).toContain(topic);
      // suggestions 结构契约合法，且为该族追加了 manual-edit 条目
      expect(advice.suggestions.length).toBeGreaterThanOrEqual(1);
      for (const suggestion of advice.suggestions) {
        expect(SUGGESTION_KINDS.has(suggestion.kind)).toBe(true);
        expect(suggestion.title.length).toBeGreaterThan(0);
      }
      expect(advice.suggestions.some((suggestion) => suggestion.title.includes(topic))).toBe(true);
    }
  });

  it('多族混提（票面示例）：按钮 + 圆角 同时成段，且族序固定（确定性排序）', () => {
    const advice = generateLocalAdvice('给首屏加一个主按钮，并把圆角统一为 8');
    const buttonAt = advice.content.indexOf('针对「按钮」');
    const radiusAt = advice.content.indexOf('「圆角」');
    expect(buttonAt).toBeGreaterThanOrEqual(0);
    expect(radiusAt).toBeGreaterThan(buttonAt);
    // 每族一条 manual-edit 建议
    expect(advice.suggestions).toHaveLength(2);
    expect(advice.suggestions.every((suggestion) => suggestion.kind === 'manual-edit')).toBe(true);
  });
});

describe('本地建议生成器 · 确定性与兜底', () => {
  it('同输入同输出：任意提示词两次调用结果深度相等', () => {
    for (const prompt of ['给首屏加一个主按钮，并把圆角统一为 8', '把背景颜色统一为暖色', '']) {
      expect(generateLocalAdvice(prompt)).toEqual(generateLocalAdvice(prompt));
    }
  });

  it('空输入：兜底文案非空且结构完整，不产出族建议', () => {
    for (const prompt of ['', '   ', '\n\t']) {
      const advice = generateLocalAdvice(prompt);
      expect(advice.content.length).toBeGreaterThan(0);
      expect(advice.content).toContain('注意事项');
      expect(advice.suggestions).toEqual([]);
    }
  });

  it('无关键词输入：同样走兜底（不硬凑族建议）', () => {
    const advice = generateLocalAdvice('让首页更有呼吸感');
    expect(advice.content.length).toBeGreaterThan(0);
    expect(advice.content).toContain('注意事项');
    expect(advice.suggestions).toEqual([]);
  });

  it('大小写不敏感：英文关键词大小写均命中同一族', () => {
    const lower = generateLocalAdvice('add a button');
    const upper = generateLocalAdvice('ADD A BUTTON');
    expect(upper.content).toBe(lower.content);
  });
});
