// @vitest-environment jsdom
/**
 * MCP 确认条组件测试（seam：用户可观察的界面行为——逐项 diff、一次性确认、超时失效）。
 *
 * 达标语义硬要求：**桩必须在 UI 里显式标注**（角标「桩」，且 `data-df-stub="true"` 是门禁挂点）。
 */
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
