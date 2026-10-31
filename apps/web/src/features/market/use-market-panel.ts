'use client';

/**
 * 市场面板共享数据面（P1-5 六态提取）。
 *
 * `register.tsx` 的 `MarketPanelSlot`（编辑器左栏页签）与 `app/market/panel/page.tsx`
 * （独立路由）此前逐行同形：同一取数口径（综合评分前 8）、同一本地计数册（FEEDBACK_KEY）、
 * 同一六态派生。本 hook 把这份数据流收口为一处——两侧只差**页面 chrome**
 * （页题/反馈键说明/根元素主题），面板内容与状态机不得再各自漂移。
 *
 * 文档写入（试跑/采纳计数）仍只落 localStorage 计数册，不经 daemon。
 */

import type { MarketAsset } from '@dforge/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { withDaemonEndpoint } from '@/lib/daemon-endpoint';

import { classifyMarketOutcome } from './api';
import { bumpFeedback, type FeedbackEntry, readFeedback } from './feedback';
import { useLoadRecords, useMarketQuery } from './use-market';

/** 面板取数参数：默认综合评分前 8（面板是速览，不做完整检索）。 */
export const PANEL_LIMIT = 8;

type MarketQueryResult = ReturnType<typeof useMarketQuery>;

/** 共享数据面的返回形状（两侧渲染六态所需的一切）。 */
export interface MarketPanelData {
  /** 取数状态（loading / error / ready）。 */
  status: MarketQueryResult['status'];
  /** 取数失败信息（error 态展示用）。 */
  error: MarketQueryResult['error'];
  /** 重试（error 态的恢复入口）。 */
  reload: MarketQueryResult['reload'];
  /** 面板条目（ready 态才非空）。 */
  assets: MarketAsset[];
  /** 六态分类（response 为 null 时 null）。 */
  outcome: ReturnType<typeof classifyMarketOutcome> | null;
  /** 已装载记录 id（面板行角标）。 */
  loadedIds: readonly string[];
  /** 本地计数册快照（客户端读取；SSR 阶段空册）。 */
  feedback: FeedbackEntry[];
  /** 当前选中条目（null = 未选择，面板回退首个）。 */
  selectedId: string | null;
  /** 选中变化（面板行点击）。 */
  setSelectedId: (assetId: string) => void;
  /** 试跑/采纳计数（写本地册，不发请求）。 */
  bump: (assetId: string, field: 'runs' | 'adoptions') => void;
  /** 面板 → 详情（续写当前端点参数，D-3/UX-01 口径）。 */
  openDetail: (assetId: string) => void;
}

/** 市场面板共享数据流（六态渲染组件与两处薄壳共用的唯一来源）。 */
export function useMarketPanelData(): MarketPanelData {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
  const { loadedIds } = useLoadRecords();

  const params = useMemo(() => ({ sort: 'score' as const, limit: PANEL_LIMIT }), []);
  const { status, response, error, reload } = useMarketQuery(params);

  // 本地计数册两侧同一册（FEEDBACK_KEY）；只在客户端读，SSR 阶段给空册。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setFeedback(readFeedback(window.localStorage));
    } catch {
      setFeedback([]);
    }
  }, []);

  const bump = (assetId: string, field: 'runs' | 'adoptions'): void => {
    if (typeof window === 'undefined') return;
    try {
      setFeedback(bumpFeedback(window.localStorage, assetId, field, new Date().toISOString()));
    } catch {
      setFeedback([]);
    }
  };

  const assets = response?.items ?? [];
  const outcome = response === null ? null : classifyMarketOutcome(response);

  return {
    status,
    error,
    reload,
    assets,
    outcome,
    loadedIds,
    feedback,
    selectedId,
    setSelectedId,
    bump,
    openDetail: (assetId: string): void => {
      // 面板 → 详情：续写当前端点参数（D-3/UX-01，口径与市场首页卡片一致）
      router.push(withDaemonEndpoint(`/market/${encodeURIComponent(assetId)}`));
    },
  };
}
