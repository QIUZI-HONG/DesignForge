// @vitest-environment jsdom
/**
 * AI 抽屉组件测试（seam：用户可观察的界面行为——输入、步骤流、角标、重试）。
 *
 * 断言口径：可见文案（i18n 真源）、可访问角色、`data-df-*` 状态挂点（门禁取样契约）；
 * 流式细节由 stream.test.ts 负责，这里只验「界面是否如实呈现状态机的状态」。
 * 样式单轨（工单 06）：样式断言走**类名挂载 + ai.css 文本**（External CSS 在 jsdom
 * 不计算，内联样式对象已收敛为域内 CSS——先例：`verify/a11y-keyboard.test.tsx` 注入 CSS）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { controllableAiPort, degradedResponse, fakeAiPort, okResponse } from '../test-utils';
import { AiDrawer } from './AiDrawer';

/** 步骤行（data-df-step 是门禁与测试共用的对外挂点）。 */
const stepRow = (id: string) => document.querySelector(`[data-df-step="${id}"]`);

describe('AI 抽屉（F4）', () => {
  it('提交自然语言 → 四步流转并渲染结果（queued/llm/validate/compile 全程可见）', async () => {
    const user = userEvent.setup();
    const port = fakeAiPort({
      runs: [
        [
          {
            type: 'start',
            runId: 'ai_1',
            provider: 'deepseek',
            model: 'deepseek-chat',
            degraded: false,
          },
          { type: 'delta', delta: '按钮组已生成' },
          { type: 'done', response: okResponse('按钮组已生成') },
        ],
      ],
    });
    render(<AiDrawer port={port} defaultOpen />);

    await user.type(screen.getByRole('textbox', { name: '描述修改' }), '加一个按钮组');
    await user.click(screen.getByRole('button', { name: '生成' }));

    await waitFor(() => {
      expect(screen.getByText('按钮组已生成')).toBeTruthy();
    });
    // 四步全部收敛为已完成的语义
    for (const id of ['queued', 'llm', 'validate', 'compile']) {
      expect(stepRow(id)?.getAttribute('data-df-step-status')).toBe('done');
    }
    // 步骤文案是中文（ADR-0003），步骤 id 只做挂点
    expect(within(screen.getByRole('list', { name: '生成步骤' })).getByText('排队')).toBeTruthy();
    expect(port.streamCalls).toBe(1);
  });

  it('降级态：与真态同构渲染 + 显式角标「本地模板」+ 建议动作', async () => {
    const user = userEvent.setup();
    const port = fakeAiPort({
      runs: [
        [
          {
            type: 'start',
            runId: 'ai_d',
            provider: 'deepseek',
            model: 'deepseek-chat',
            degraded: true,
          },
          { type: 'done', response: degradedResponse() },
        ],
      ],
    });
    render(<AiDrawer port={port} defaultOpen onConfigureCredentials={() => undefined} />);

    await user.type(screen.getByRole('textbox', { name: '描述修改' }), '加一个按钮组');
    await user.click(screen.getByRole('button', { name: '生成' }));

    const badge = await screen.findByText('本地模板');
    expect(badge.getAttribute('data-df-badge')).toBe('local-template');
    // 降级也走完四步（同构），并且给出可操作建议
    expect(stepRow('compile')?.getAttribute('data-df-step-status')).toBe('done');
    expect(screen.getByText('未配置 DeepSeek API key')).toBeTruthy();
    expect(screen.getByRole('button', { name: '去配置 key' })).toBeTruthy();
  });

  it('真态不出角标（角标只由 degraded 决定）', async () => {
    const user = userEvent.setup();
    const port = fakeAiPort({
      runs: [
        [
          {
            type: 'start',
            runId: 'ai_1',
            provider: 'deepseek',
            model: 'deepseek-chat',
            degraded: false,
          },
          { type: 'done', response: okResponse() },
        ],
      ],
    });
    render(<AiDrawer port={port} defaultOpen />);
    await user.type(screen.getByRole('textbox', { name: '描述修改' }), '画一个图标');
    await user.click(screen.getByRole('button', { name: '生成' }));
    await screen.findByText('已生成按钮组');
    expect(screen.queryByText('本地模板')).toBeNull();
  });

  it('失败可重试：失败落在所在步上，点重试后重新从 queued 走完', async () => {
    const user = userEvent.setup();
    const port = fakeAiPort({
      runs: [
        [
          {
            type: 'start',
            runId: 'ai_1',
            provider: 'deepseek',
            model: 'deepseek-chat',
            degraded: false,
          },
          { type: 'error', error: { code: 'ai_invalid_request', message: '上游连接中断' } },
        ],
        [
          {
            type: 'start',
            runId: 'ai_2',
            provider: 'deepseek',
            model: 'deepseek-chat',
            degraded: false,
          },
          { type: 'done', response: okResponse('重试成功') },
        ],
      ],
    });
    render(<AiDrawer port={port} defaultOpen />);

    await user.type(screen.getByRole('textbox', { name: '描述修改' }), '加一个按钮组');
    await user.click(screen.getByRole('button', { name: '生成' }));

    await screen.findByText('上游连接中断');
    expect(stepRow('llm')?.getAttribute('data-df-step-status')).toBe('failed');

    await user.click(screen.getByRole('button', { name: '重试' }));
    await screen.findByText('重试成功');
    expect(stepRow('llm')?.getAttribute('data-df-step-status')).toBe('done');
    expect(port.streamCalls).toBe(2);
  });

  it('运行中：提交按钮禁用并标 busy（防重复提交）', async () => {
    const user = userEvent.setup();
    const port = controllableAiPort();
    render(<AiDrawer port={port} defaultOpen />);

    await user.type(screen.getByRole('textbox', { name: '描述修改' }), '加一个按钮组');
    await user.click(screen.getByRole('button', { name: '生成' }));

    await waitFor(() => {
      expect(stepRow('queued')?.getAttribute('data-df-step-status')).toBe('active');
    });
    const submit = screen.getByRole('button', { name: '正在生成' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    port.release();
    await screen.findByText('已生成按钮组');
  });

  it('未配置 key 时给出降级提示（来自 /ai/status，不报错）', async () => {
    const port = fakeAiPort({ runs: [[]] });
    render(<AiDrawer port={port} defaultOpen />);
    expect(await screen.findByText(/未配置 DeepSeek key/)).toBeTruthy();
    expect(port.statusCalls).toBe(1);
  });
});

/** 读域内 CSS 文本（jsdom 不计算 External CSS，类规则只能对文件文本断言）。 */
const aiCss = (): string =>
  readFileSync(resolve(process.cwd(), 'src/features/ai/components/ai.css'), 'utf8');

/** 断言 CSS 里有 `.类名 { … }` 规则块，并返回该块文本。 */
function cssRule(css: string, className: string): string {
  const at = css.indexOf(`.${className} {`);
  expect(at, `ai.css 缺少 .${className} 规则`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('}', at);
  return css.slice(at, end);
}

describe('AI 抽屉 · 样式单轨（工单 06）', () => {
  it('样式挂类不挂内联：抽屉内容树不产生 style 属性', () => {
    render(<AiDrawer port={fakeAiPort({ runs: [] })} defaultOpen />);
    const root = document.querySelector('[data-df-panel="ai"]');
    expect(root?.classList.contains('dfg-ai__body')).toBe(true);
    // 本域无几何算式场景：整个内容树不允许任何内联样式（豁免登记表在工单 06）
    expect(root?.querySelector('[style]')).toBeNull();
  });

  it('步骤强调色由 data-df-step-status 状态选择器承接（不再 JS 算色）', () => {
    const css = aiCss();
    // 缺省（queued）= 文字禁用色；active/done/failed 各自覆盖——与原 stepAccent 同语义
    expect(cssRule(css, 'dfg-ai__step-label')).toContain('var(--dfg-color-text-disabled)');
    expect(css).toContain("[data-df-step-status='active'] .dfg-ai__step-label");
    expect(css).toContain('var(--dfg-color-primary)');
    expect(css).toContain("[data-df-step-status='done'] .dfg-ai__step-label");
    expect(css).toContain('var(--dfg-color-success)');
    expect(css).toContain("[data-df-step-status='failed'] .dfg-ai__step-label");
    expect(css).toContain('var(--dfg-color-danger)');
  });

  it('关键规则块落盘：提示条/角标/文本域的颜色与几何全部引用令牌', () => {
    const css = aiCss();
    expect(cssRule(css, 'dfg-ai__hint')).toContain('var(--dfg-color-warning-subtle)');
    expect(cssRule(css, 'dfg-ai__badge')).toContain('var(--dfg-color-component)');
    expect(cssRule(css, 'dfg-ai__textarea')).toContain('var(--dfg-size-textarea-min-height)');
    // 类挂载抽查：步骤行与建议清单挂预期类
    render(<AiDrawer port={fakeAiPort({ runs: [] })} defaultOpen />);
    expect(document.querySelector('[data-df-step="queued"]')?.className).toContain(
      'dfg-ai__step-row',
    );
    expect(document.querySelector('[data-df-panel="ai"] textarea')?.className).toContain(
      'dfg-ai__textarea',
    );
  });
});
