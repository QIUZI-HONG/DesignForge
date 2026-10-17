// @vitest-environment jsdom
/**
 * 对抗测试（验证方 test/verify-web-b）· MCP 确认条的**一次性**与**桩标注**。
 *
 * 风险点（任务书 §4）：重复/并发同 token 的 ack；超时失效；桩标注是否在**所有出口**都在。
 * 既有测试已覆盖「单次确认 / 重放失败 / 超时」；本文件补三类对抗面：
 * 1) 同一帧内连点两次（并发双击）；
 * 2) 四个出口（pending/approved/rejected/expired/failed）的桩标注挂点；
 * 3) 畸形 `expiresAt`（非日期）不得崩、不得变成可确认。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

/** 桩标注挂点必须存在（UI/证据口径一致的机器可读锚）。 */
function expectStubBadge(): void {
  const badge = document.querySelector('[data-df-stub="true"]');
  expect(badge, '桩标注挂点 data-df-stub 缺失').not.toBeNull();
  expect(badge?.textContent).toContain('桩');
}

describe('对抗 · 一次性 ack 的并发面', () => {
  it('同一帧内连点两次「确认」→ 只发出一次 ack（令牌只消费一次）', async () => {
    const port = fakeMcpPort();
    render(<McpConfirmBar proposal={proposalFixture()} port={port} now={() => Date.now()} />);

    const approve = screen.getByRole('button', { name: '确认' });
    // fireEvent 不经 user-event 的间隔：两次点击落在同一 macrotask 内
    fireEvent.click(approve);
    fireEvent.click(approve);

    await waitFor(() => {
      expect(port.ackCalls.length).toBeGreaterThan(0);
    });
    expect(port.ackCalls).toHaveLength(1);
  });

  it('提交中再点「拒绝」→ 第二个动作被丢弃（不允许对同一 token 二次表态）', async () => {
    let release: (() => void) | undefined;
    const port = fakeMcpPort();
    const slowAck = {
      ...port,
      ack: async (request: { ackToken: string; approve: boolean }) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return await port.ack(request);
      },
    };
    render(<McpConfirmBar proposal={proposalFixture()} port={slowAck} now={() => Date.now()} />);

    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    release?.();

    await waitFor(() => {
      expect(screen.getByText('已确认')).toBeTruthy();
    });
    expect(port.ackCalls).toHaveLength(1);
    expect(port.ackCalls[0]?.approve).toBe(true);
  });
});

describe('对抗 · 桩标注在所有出口', () => {
  it('pending（初始）就有桩标注', () => {
    render(
      <McpConfirmBar proposal={proposalFixture()} port={fakeMcpPort()} now={() => Date.now()} />,
    );
    expectStubBadge();
  });

  it('approved 出口：桩标注 + 「未产生真实写入」说明都在', async () => {
    render(
      <McpConfirmBar proposal={proposalFixture()} port={fakeMcpPort()} now={() => Date.now()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => {
      expect(screen.getByText('已确认')).toBeTruthy();
    });
    expectStubBadge();
    expect(screen.getByText(/未产生真实写入/)).toBeTruthy();
  });

  it('rejected 出口：桩标注 + 说明都在', async () => {
    render(
      <McpConfirmBar
        proposal={proposalFixture()}
        port={fakeMcpPort({
          ackResult: { ...ackApproved(), decision: 'rejected', note: '用户拒绝该提案' },
        })}
        now={() => Date.now()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    await waitFor(() => {
      expect(screen.getByText('已拒绝')).toBeTruthy();
    });
    expectStubBadge();
  });

  it('expired 出口（超时）：桩标注仍在，且不可再确认', async () => {
    render(
      <McpConfirmBar proposal={proposalFixture()} port={fakeMcpPort()} now={() => Date.now()} />,
    );
    await vi.advanceTimersByTimeAsync(121_000);
    await waitFor(() => {
      expect(screen.getByText(/已失效/)).toBeTruthy();
    });
    expectStubBadge();
    expect(screen.queryByRole('button', { name: '确认' })).toBeNull();
  });

  it('failed 出口（令牌无效/重放）：桩标注仍在，提示重新发起 dryRun', async () => {
    const failing = fakeMcpPort({
      ackError: new DaemonRequestError('mcp_ack_invalid', 'ackToken 无效或已被使用'),
    });
    render(
      <McpConfirmBar
        proposal={proposalFixture({
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        })}
        port={failing}
        now={() => Date.now()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('ackToken 无效');
    });
    expectStubBadge();
  });
});

describe('对抗 · 畸形输入不崩', () => {
  it('expiresAt 非日期字符串 → 判为已失效（保守拒绝），不展示 NaN 倒计时、不崩', () => {
    const port = fakeMcpPort();
    render(
      <McpConfirmBar
        proposal={proposalFixture({ expiresAt: 'not-a-date' })}
        port={port}
        now={() => Date.now()}
      />,
    );
    expect(screen.getByText(/已失效/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('NaN');
    expect(screen.queryByRole('button', { name: '确认' })).toBeNull();
  });

  it('expiresAt 已过期（服务端给过去时刻）→ 同样不可确认', () => {
    render(
      <McpConfirmBar
        proposal={proposalFixture({ expiresAt: new Date(T0 - 1000).toISOString() })}
        port={fakeMcpPort()}
        now={() => Date.now()}
      />,
    );
    expect(screen.getByText(/已失效/)).toBeTruthy();
  });

  it('diff.ops 为空数组 → 展开按钮仍可点，不崩（文案计数为 0）', () => {
    const proposal = proposalFixture();
    render(
      <McpConfirmBar
        proposal={{ ...proposal, diff: { ...proposal.diff, ops: [] } }}
        port={fakeMcpPort()}
        now={() => Date.now()}
      />,
    );
    expect(screen.getByRole('button', { name: /展开 diff/ })).toBeTruthy();
  });
});
