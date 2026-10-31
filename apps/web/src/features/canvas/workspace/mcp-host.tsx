'use client';

/**
 * MCP 确认条容器（FE-10 F9 的**常驻宿主位**）。
 *
 * 为什么需要宿主：确认条不是面板，而是「全局一次性确认」——它必须常驻、不随面板开合消失。
 * daemon 的 `/mcp/proposals` 是**一次性 dryRun 响应**（没有「待确认列表」路由），
 * 因此宿主位只负责「有提案就渲染确认条」：提案从 `window` 自定义事件
 * `dforge:mcp-proposal` 进来（MCP 客户端桥 / 未来网关把 `POST /mcp/proposals` 的响应投递到页面）。
 * 这是本段（桩）的合理边界——真实推送通道归 P5 的 MCP 网关票，写在报告里作为跨票待办。
 *
 * **终态留存（UX 巡检 P1-1）**：ack 落定（批准/拒绝）后确认条**不撤**——终态文案
 * 「已确认/已拒绝 + 桩注」持续可见，直至新提案替换（提案换新即重置是既有语义）或提案
 * TTL（expiresAt）到期。一次性 token 语义在确认条内部（发出即消费），与留存互不影响。
 *
 * DOM 挂点：容器带 `data-df-mcp-bar-host`（无提案时也渲染，便于门禁断言「宿主位在场」）。
 */

import type { McpProposalResponse } from '@dforge/contracts';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { type McpConfirmationState, McpConfirmBar } from '@/features/mcp';

/** 提案事件名（跨票契约：谁拿到 dryRun 响应谁投递）。 */
export const MCP_PROPOSAL_EVENT = 'dforge:mcp-proposal';

/** 提案总线（模块级；页面里任何代码都可 `publishMcpProposal(...)`）。 */
let pending: McpProposalResponse | null = null;
const listeners = new Set<() => void>();

/** 投递一份待确认提案。 */
export function publishMcpProposal(proposal: McpProposalResponse): void {
  pending = proposal;
  for (const listener of listeners) listener();
}

/** 当前待确认提案（无 → null）。 */
export function currentMcpProposal(): McpProposalResponse | null {
  return pending;
}

/** 清空（确认/拒绝后调用）。 */
export function clearMcpProposal(): void {
  pending = null;
  for (const listener of listeners) listener();
}

/** MCP 确认条宿主位。 */
export function McpConfirmHost() {
  const [mounted, setMounted] = useState(false);
  const proposal = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
    () => null,
  );
  const retentionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMounted(true);
    const onEvent = (event: Event): void => {
      const detail = (event as CustomEvent<McpProposalResponse>).detail;
      if (detail !== undefined && detail !== null) publishMcpProposal(detail);
    };
    window.addEventListener(MCP_PROPOSAL_EVENT, onEvent);
    return () => {
      window.removeEventListener(MCP_PROPOSAL_EVENT, onEvent);
    };
  }, []);

  // 终态留存的上界（P1-1）：ack 落定后起计时，提案 TTL（expiresAt）到期即撤条；
  // 到期时若提案已被新提案替换则不动（身份守卫，避免误撤替换后的确认条）。
  const handleSettled = useCallback((state: McpConfirmationState) => {
    const settled = state.proposal;
    if (retentionTimer.current !== null) clearTimeout(retentionTimer.current);
    const delay = Math.max(0, Date.parse(settled.expiresAt) - Date.now());
    retentionTimer.current = setTimeout(() => {
      if (currentMcpProposal() === settled) clearMcpProposal();
    }, delay);
  }, []);

  // 卸载回收计时器（不漏悬挂定时器）
  useEffect(
    () => () => {
      if (retentionTimer.current !== null) clearTimeout(retentionTimer.current);
    },
    [],
  );

  return (
    <div className="dfc-ws-mcp" data-df-mcp-bar-host="">
      {mounted && proposal !== null ? (
        <McpConfirmBar proposal={proposal} onSettled={handleSettled} />
      ) : null}
    </div>
  );
}
