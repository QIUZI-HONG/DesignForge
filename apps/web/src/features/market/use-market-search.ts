'use client';

/**
 * 首页市场结果线取数（arch-v1 · 票① · 候选 5：收回 market 公开面）。
 *
 * 为什么在 market：同一页面此前有两条取数路径——HomeView 既用 `useUpdatableCount`
 * （market 公开面），又自建 `home/api/market.ts`（复制 URL 构造/鉴权/信封/3s deadline），
 * 而「降级为不可用」状态没进公开面，消费方只能绕行自建。本模块把取数、deadline 与
 * 降级状态收进 market 公开面，home 只留 UI 态（防抖参数由调用方给）。
 *
 * 口径（与旧 home/api/market.ts 一致，勿各自另立）：
 * - 索引缺失/无匹配都是空态而非错误；daemon 不可达同样降级为 `available:false`
 *   ——首页搜索框不能因为市场侧不可用而整体报错；
 * - 3s 兜底（{@link MARKET_SEARCH_DEADLINE_MS}）：到上限仍未落定先落「市场不可用」
 *   降级态（可读出口），结果迟到再覆盖（自愈）；
 * - 检索降级（`search-index-*`）→ `searchDegraded`（复用市场页同一判定 `isSearchDegraded`）。
 *
 * 取数本身走 `./api` 的 `fetchMarketQuery`（信封/超时/形状校验单点），本模块只做
 * 「查询 → 结果线」的映射与 hook 状态机。
 */
import { displayText, type MarketAssetKind } from '@dforge/contracts';
import { useEffect, useState } from 'react';

import { fetchMarketQuery, isSearchDegraded } from './api';

/** 结果线条数上限（下拉里的一行分组，给多了喧宾夺主）。 */
export const MARKET_RESULT_LIMIT = 5;

/** 读路径兜底上限（毫秒）。与首页网关的 3s 同一数量级：本机回环 3 秒不回等下去也不会好。 */
export const MARKET_SEARCH_DEADLINE_MS = 3_000;

/** 输入防抖（毫秒；与首页既有口径一致，调用方可覆盖）。 */
export const MARKET_SEARCH_DEBOUNCE_MS = 200;

/** 一条市场命中（下拉展示用）。 */
export interface MarketSearchHit {
  id: string;
  name: string;
  kind: MarketAssetKind;
}

/** 检索结果（`available:false` = 市场侧不可用/未就绪，UI 显示降级提示行）。 */
export interface MarketSearchResult {
  available: boolean;
  items: MarketSearchHit[];
  /** 检索索引降级（有卡片但检索退化为字面匹配）：首页与市场页同口径给提示。 */
  searchDegraded: boolean;
}

/** hook 对外状态（与首页顶栏 `MarketPanelState` 同形）。 */
export interface MarketSearchHitsState {
  loading: boolean;
  available: boolean;
  items: MarketSearchHit[];
  degraded: boolean;
}

/** 取数选项（`search` 是测试/宿主注入口；其余给出时覆盖缺省）。 */
export interface MarketSearchOptions {
  /** 注入的检索实现（测试/宿主；缺省走 `searchMarketHits`）。 */
  search?: (query: string) => Promise<MarketSearchResult>;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** 单请求超时上限（毫秒；缺省 = 调用方的 deadline）。 */
  timeoutMs?: number;
  /** 输入防抖（毫秒；缺省 {@link MARKET_SEARCH_DEBOUNCE_MS}）。 */
  debounceMs?: number;
  /** 兜底上限（毫秒；缺省 {@link MARKET_SEARCH_DEADLINE_MS}）。 */
  deadlineMs?: number;
}

/** 不可用降级结果（任何失败都走这里，不抛给页面）。 */
const UNAVAILABLE: MarketSearchResult = {
  available: false,
  items: [],
  searchDegraded: false,
};

/** 可用空态（空查询/索引缺失）。 */
const EMPTY: MarketSearchResult = { available: true, items: [], searchDegraded: false };

/**
 * 检索技能市场资产（任何失败都降级为可用性标记，不抛错）。
 * 旧 `home/api/market.ts` 的 `searchMarketAssets` 等价实现，取数改走 `fetchMarketQuery`。
 */
export async function searchMarketHits(
  query: string,
  options: {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<MarketSearchResult> {
  const trimmed = query.trim();
  if (trimmed === '') return EMPTY;

  const limit = MARKET_RESULT_LIMIT;
  const envelope = await fetchMarketQuery(
    { q: trimmed, limit },
    {
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    },
  );
  if (!envelope.ok) return UNAVAILABLE;

  const items = Array.isArray(envelope.result.items) ? envelope.result.items : [];
  return {
    available: true,
    items: items.slice(0, limit).map((asset) => ({
      id: asset.id,
      name: displayText(asset.displayName, asset.name),
      kind: asset.kind,
    })),
    searchDegraded: isSearchDegraded(envelope.result.warnings),
  };
}

/**
 * 首页市场结果线 hook：输入防抖 + 3s deadline + 降级态。
 *
 * 出口保证（三条，不允许永久 loading）：① 落定即用真实结果；② 被拒 → 落「市场不可用」
 * 降级态（拒绝不逃逸成 unhandled rejection）；③ 超上限仍未落定 → 先落降级态给可读出口，
 * 结果迟到再覆盖（自愈）。
 */
export function useMarketSearchHits(
  query: string,
  options: MarketSearchOptions = {},
): MarketSearchHitsState {
  const {
    search,
    baseUrl,
    fetchImpl,
    debounceMs = MARKET_SEARCH_DEBOUNCE_MS,
    deadlineMs = MARKET_SEARCH_DEADLINE_MS,
    timeoutMs = deadlineMs,
  } = options;
  const [state, setState] = useState<MarketSearchHitsState>({
    loading: false,
    available: true,
    items: [],
    degraded: false,
  });

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === '') {
      setState({ loading: false, available: true, items: [], degraded: false });
      return undefined;
    }

    let cancelled = false;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    setState((current) => ({ ...current, loading: true }));

    const timer = setTimeout(() => {
      deadline = setTimeout(() => {
        if (!cancelled) {
          setState({ loading: false, available: false, items: [], degraded: false });
        }
      }, deadlineMs);
      const run =
        search ??
        ((value: string) =>
          searchMarketHits(value, {
            ...(baseUrl === undefined ? {} : { baseUrl }),
            ...(fetchImpl === undefined ? {} : { fetchImpl }),
            timeoutMs,
          }));
      // `Promise.resolve().then(…)`：连「同步抛错」的实现也归一到拒绝路径，异常不逃出定时器回调
      void Promise.resolve()
        .then(() => run(trimmed))
        .then(
          (result) => {
            if (deadline !== null) clearTimeout(deadline);
            if (cancelled) return;
            setState({
              loading: false,
              available: result.available,
              items: result.items,
              degraded: result.searchDegraded,
            });
          },
          () => {
            if (deadline !== null) clearTimeout(deadline);
            if (cancelled) return;
            setState({ loading: false, available: false, items: [], degraded: false });
          },
        );
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (deadline !== null) clearTimeout(deadline);
    };
  }, [query, search, baseUrl, fetchImpl, debounceMs, deadlineMs, timeoutMs]);

  return state;
}
