// @vitest-environment jsdom
/**
 * MCP 确认条宿主位测试（seam：`McpConfirmHost` 渲染 + 模块级提案总线 API + DOM 挂点）。
 *
 * 缺陷现场（UX 巡检 spec P1-1 / 票 05）：ack 200 后宿主在 `onSettled` 里
 * `clearMcpProposal()` 把确认条整体撤下（约 150ms 内消失），终态文案
 * 「已确认/已拒绝 + 桩注」审批人根本看不到。
 *
 * 本文件锁宿主位的**终态留存**语义：
 * - ack 落定（批准/拒绝）后确认条**不立即撤下**，终态文案持续可见；
 * - 留存有界：至新提案替换或提案 TTL（expiresAt）到期；
 * - 既有语义不回退：过期态（超时未确认）照常展示、新提案替换即重置。
 *
 * fetch 以桩拦截（`createMcpPort()` 缺省捕获全局 fetch）——不连真 daemon。
 */
import type { McpAckResponse, McpProposalResponse } from '@dforge/contracts';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearMcpProposal,
  currentMcpProposal,
  McpConfirmHost,
  publishMcpProposal,
} from './mcp-host';

/** 基准时刻（与 mcp feature 测试夹具同源口径）。 */
const T0 = Date.parse('2026-10-15T00:00:00.000Z');

/** 提案夹具（daemon 桩响应形状；TTL 120s）。 */
function proposalFixture(overrides: Partial<McpProposalResponse> = {}): McpProposalResponse {
  return {
    proposalId: 'prop_1',
    tool: 'df_apply_patch',
    caller: 'mcp:zcode',
    dryRun: true,
    diff: {
      documentId: 'doc-1',
      baseRev: null,
      ops: [
        {
          op: 'df_apply_patch',
          target: 'doc-1',
          summary: '桩实现：真实 diff 由 P5 网关按 Design IR 生成',
        },
      ],
      beforeHash: null,
      afterHash: null,
    },
    ackToken: 'token-abc',
    expiresAt: new Date(T0 + 120_000).toISOString(),
    auditId: 'audit_1',
    stub: true,
    ...overrides,
  };
}

/** ack 批准响应夹具。 */
function ackApproved(): McpAckResponse {
  return {
    proposalId: 'prop_1',
    applied: false,
    decision: 'approved',
    auditId: 'audit_1',
    note: '桩实现：已确认，真实写入由 P5 网关执行（本段不改动文档）',
  };
}

/** 统一信封响应桩（readEnvelope 只消费 `json()`）。 */
function envelopeResponse(result: unknown): {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
} {
  return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(T0);
  clearMcpProposal();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearMcpProposal();
});

describe('MCP 确认条宿主位（终态留存）', () => {
  it('有提案即渲染确认条（宿主位在场，pending 可确认）', () => {
    render(<McpConfirmHost />);
    expect(screen.queryByText('桩')).toBeNull();

    act(() => {
      publishMcpProposal(proposalFixture());
    });
    const bar = document.querySelector('[data-df-mcp-confirm]');
    expect(bar?.getAttribute('data-df-mcp-confirm')).toBe('pending');
    expect(screen.getByText('桩')).toBeTruthy();
    expect(currentMcpProposal()?.proposalId).toBe('prop_1');
  });

  it('批准 ack 成功后终态留存：不立即撤条，TTL 窗口内终态文案持续可见', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => envelopeResponse(ackApproved())),
    );
    render(<McpConfirmHost />);
    act(() => {
      publishMcpProposal(proposalFixture());
    });

    await user.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => {
      expect(screen.getByText('已确认')).toBeTruthy();
    });
    expect(
      document.querySelector('[data-df-mcp-confirm]')?.getAttribute('data-df-mcp-confirm'),
    ).toBe('approved');

    // 留存：在提案 TTL 窗口内持续推进，终态文案与桩注始终可见
    // （既有缺陷在落定瞬间已整体撤条）
    await vi.advanceTimersByTimeAsync(60_000);
    expect(screen.getByText('已确认')).toBeTruthy();
    expect(screen.getByText(/桩：未产生真实写入/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认' })).toBeNull();
  });

  it('终态留存有界：提案 TTL 到期后确认条撤下（宿主位仍在场）', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => envelopeResponse(ackApproved())),
    );
    render(<McpConfirmHost />);
    act(() => {
      publishMcpProposal(proposalFixture());
    });

    await user.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => {
      expect(screen.getByText('已确认')).toBeTruthy();
    });

    // TTL（120s）之内留存，到期撤条——撤的是整条终态确认条，宿主容器保留
    await vi.advanceTimersByTimeAsync(60_000);
    expect(screen.getByText('已确认')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(screen.queryByText('已确认')).toBeNull();
    expect(document.querySelector('[data-df-mcp-confirm]')).toBeNull();
    expect(document.querySelector('[data-df-mcp-bar-host]')).not.toBeNull();
  });

  it('新提案替换即重置（既有语义）：旧终态被替换，新提案回到可确认；旧留存计时到点不误撤新条', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const ackBodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { body?: string }) => {
        if (init?.body !== undefined) ackBodies.push(JSON.parse(init.body));
        return envelopeResponse(ackApproved());
      }),
    );
    render(<McpConfirmHost />);
    act(() => {
      publishMcpProposal(proposalFixture());
    });
    await user.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => {
      expect(screen.getByText('已确认')).toBeTruthy();
    });

    // 新提案进来：确认条整体重置（新 token、回到 pending 可确认）
    act(() => {
      publishMcpProposal(
        proposalFixture({
          proposalId: 'prop_2',
          ackToken: 'token-2',
          expiresAt: new Date(T0 + 240_000).toISOString(),
        }),
      );
    });
    expect(screen.queryByText('已确认')).toBeNull();
    expect(screen.getByRole('button', { name: '确认' })).toBeTruthy();
    expect(screen.getByText('剩余 4:00')).toBeTruthy();

    // 旧提案的留存计时（T0+120s）到点：身份守卫，不得撤掉已替换的新确认条
    await vi.advanceTimersByTimeAsync(121_000);
    expect(screen.getByRole('button', { name: '确认' })).toBeTruthy();
    expect(document.querySelector('[data-df-mcp-bar-host]')).not.toBeNull();

    // 新提案可正常确认（一次性 token 用的是新 token）
    await user.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => {
      expect(screen.getByText('已确认')).toBeTruthy();
    });
    const secondAck = ackBodies[1] as { ackToken?: string; approve?: boolean };
    expect(secondAck).toEqual({ ackToken: 'token-2', approve: true });
    expect(ackBodies).toHaveLength(2);
  });

  it('过期态既有行为不回退：超时未确认显示「已失效」，宿主不撤（持续可见直至替换）', async () => {
    render(<McpConfirmHost />);
    act(() => {
      publishMcpProposal(proposalFixture());
    });

    // 不确认，直接越过 TTL → expired；文案保持，宿主不撤条
    await vi.advanceTimersByTimeAsync(121_000);
    expect(screen.getByText('已失效（超时未确认）')).toBeTruthy();
    expect(screen.getByText('需重新发起 dryRun 提案')).toBeTruthy();
    expect(
      document.querySelector('[data-df-mcp-confirm]')?.getAttribute('data-df-mcp-confirm'),
    ).toBe('expired');
  });
});
