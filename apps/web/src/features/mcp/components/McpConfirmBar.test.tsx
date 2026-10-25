// @vitest-environment jsdom
/**
 * MCP 确认条组件测试（seam：用户可观察的界面行为——逐项 diff、一次性确认、超时失效）。
 *
 * 达标语义硬要求：**桩必须在 UI 里显式标注**（角标「桩」，且 `data-df-stub="true"` 是门禁挂点）。
 * 样式单轨（工单 06）：样式断言走**类名挂载 + mcp.css 文本**（External CSS 在 jsdom
 * 不计算，先例 verify/a11y-keyboard.test.tsx 注入 CSS）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DaemonRequestError } from '../client';
import { ackApproved, fakeMcpPort, proposalFixture, T0 } from '../test-utils';
import { McpConfirmBar } from './McpConfirmBar';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

/** 渲染确认条（默认注入假端口与冻结时钟）。 */
function renderBar(
  overrides: Parameters<typeof fakeMcpPort>[0] = {},
  proposal = proposalFixture(),
) {
  const port = fakeMcpPort(overrides);
  render(<McpConfirmBar proposal={proposal} port={port} now={() => Date.now()} />);
  return port;
}

describe('MCP 确认条（F9 · 桩）', () => {
  it('显式标注「桩」：角标文案与 data-df-stub 挂点都在', () => {
    renderBar();
    const badge = screen.getByText('桩');
    expect(badge.getAttribute('data-df-stub')).toBe('true');
    expect(badge.getAttribute('title')).toContain('不会真正改动文档');
    // 提案元信息（工具 / 调用方 / 提案 id / 审计 id）可见
    expect(screen.getByText('df_apply_patch')).toBeTruthy();
    expect(screen.getByText('ZCode（MCP）')).toBeTruthy();
    expect(screen.getByText(/prop_1/)).toBeTruthy();
  });

  it('逐项 diff 默认折叠，展开后逐条呈现 op/target/summary', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderBar();
    const toggle = screen.getByRole('button', { name: '展开 diff（1 项）' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(/桩实现：真实 diff/)).toBeNull();

    await user.click(toggle);
    expect(screen.getByRole('button', { name: '收起 diff' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByText(/桩实现：真实 diff 由 P5 网关按 Design IR 生成/)).toBeTruthy();
    expect(screen.getByText('目标 doc-1')).toBeTruthy();
  });

  it('一次性确认：提交后显示结果与桩说明，且不再接受二次确认', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const port = renderBar();
    await user.click(screen.getByRole('button', { name: '确认' }));

    await waitFor(() => {
      expect(screen.getByText('已确认')).toBeTruthy();
    });
    expect(port.ackCalls).toEqual([{ ackToken: 'token-abc', approve: true }]);
    expect(screen.getByText(/桩：未产生真实写入/)).toBeTruthy();
    // 一次性：确认/拒绝都不再存在（token 已消费）
    expect(screen.queryByRole('button', { name: '确认' })).toBeNull();
    expect(screen.queryByRole('button', { name: '拒绝' })).toBeNull();
  });

  it('拒绝是正常决策：落「已拒绝」并保留 diff 可复核', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const port = renderBar({
      ackResult: { ...ackApproved(), decision: 'rejected', note: '用户拒绝该提案，未产生任何写入' },
    });
    await user.click(screen.getByRole('button', { name: '拒绝' }));
    await waitFor(() => {
      expect(screen.getByText('已拒绝')).toBeTruthy();
    });
    expect(port.ackCalls[0]?.approve).toBe(false);
    expect(screen.getByRole('button', { name: '展开 diff（1 项）' })).toBeTruthy();
  });

  it('ack 被拒（重放/无效）：提示需重新发起 dryRun，不出现二次确认', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderBar({
      ackError: new DaemonRequestError(
        'mcp_ack_invalid',
        'ackToken 无效或已被使用（一次性 token 不可复用）',
      ),
    });
    await user.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => {
      expect(screen.getByText(/一次性 token 不可复用/)).toBeTruthy();
    });
    expect(screen.getByText('需重新发起 dryRun 提案')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认' })).toBeNull();
  });

  it('超时失效：倒计时走完后转「已失效」，确认/拒绝不可用', async () => {
    renderBar();
    expect(screen.getByText('剩余 2:00')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(120_500);

    await waitFor(() => {
      expect(screen.getByText('已失效（超时未确认）')).toBeTruthy();
    });
    expect(screen.getByText('需重新发起 dryRun 提案')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认' })).toBeNull();
  });

  it('确认中途失败在服务端判过期（mcp_ack_expired）→ 直接落失效态', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderBar({ ackError: new DaemonRequestError('mcp_ack_expired', 'ackToken 已过期') });
    await user.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => {
      expect(screen.getByText('已失效（超时未确认）')).toBeTruthy();
    });
  });
});

/** 读域内 CSS 文本（jsdom 不计算 External CSS，类规则只能对文件文本断言）。 */
const mcpCss = (): string =>
  readFileSync(resolve(process.cwd(), 'src/features/mcp/components/mcp.css'), 'utf8');

/** 断言 CSS 里有 `.类名 { … }` 规则块，并返回该块文本。 */
function cssRule(css: string, className: string): string {
  const at = css.indexOf(`.${className} {`);
  expect(at, `mcp.css 缺少 .${className} 规则`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('}', at);
  return css.slice(at, end);
}

describe('MCP 确认条 · 样式单轨（工单 06）', () => {
  it('样式挂类不挂内联：确认条子树不产生 style 属性', () => {
    renderBar();
    const bar = document.querySelector('[data-df-mcp-confirm]');
    expect(bar?.classList.contains('dfg-mcp__bar')).toBe(true);
    // 本域无几何算式场景：整棵确认条不允许任何内联样式（豁免登记表在工单 06）
    expect(bar?.querySelector('[style]')).toBeNull();
    // 桩角标挂类（全站唯一的「桩」标注样式走 CSS 承接）
    expect(screen.getByText('桩').className).toContain('dfg-mcp__stub-badge');
  });

  it('关键规则块落盘：外壳/桩角标/终态底色的令牌引用逐一断言', () => {
    const css = mcpCss();
    expect(cssRule(css, 'dfg-mcp__bar')).toContain('var(--dfg-size-modal-md)');
    expect(cssRule(css, 'dfg-mcp__bar')).toContain('var(--dfg-color-surface-raised)');
    expect(cssRule(css, 'dfg-mcp__stub-badge')).toContain('var(--dfg-color-component)');
    expect(cssRule(css, 'dfg-mcp__result')).toContain('var(--dfg-color-success-subtle)');
    expect(cssRule(css, 'dfg-mcp__expired')).toContain('var(--dfg-color-warning-subtle)');
    expect(cssRule(css, 'dfg-mcp__failure')).toContain('var(--dfg-color-danger-subtle)');
  });
});
