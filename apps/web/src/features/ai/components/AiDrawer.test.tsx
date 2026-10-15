// @vitest-environment jsdom
/**
 * AI 抽屉组件测试（seam：用户可观察的界面行为——输入、步骤流、角标、重试）。
 *
 * 断言口径：可见文案（i18n 真源）、可访问角色、`data-df-*` 状态挂点（门禁取样契约）；
 * 流式细节由 stream.test.ts 负责，这里只验「界面是否如实呈现状态机的状态」。
 */
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
