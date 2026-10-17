'use client';

/**
 * 市场取数 hook（页面与组件之间的数据缝；组件层只收数据，不自己发请求）。
 *
 * 纪律：
 * - **只有这里发请求**（`fetchMarketQuery` / `fetchMarketAsset` / `fetchMarketLoadPlan`），
 *   页面与展示组件保持纯 props——测试可以只测组件，或用假 fetch 测 hook；
 * - 失败不抛异常（信封语义）：`status='error'` + 可读 `error` 文案，页面渲染错误态；
 * - 本地装载记录（`localStorage`）只在客户端读，SSR 阶段给空册（避免水合不一致）。
 */

import type {
  MarketAsset,
  MarketLoadPlan,
  MarketQueryParams,
  MarketQueryResponse,
} from '@dforge/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { assetFromDetail, fetchMarketAsset, fetchMarketLoadPlan, fetchMarketQuery } from './api';
import {
  LOADED_RECORDS_KEY,
  type LoadStoreLike,
  loadedAssetIds,
  readLoadRecords,
  removeLoadRecord,
  writeLoadRecord,
} from './load-store';
import type { LoadRecord } from './load-token';
import { appendMarketPage, hasMorePages } from './pagination';

/** 查询结果状态。 */
export interface MarketQueryState {
  status: 'loading' | 'ready' | 'error';
  response: MarketQueryResponse | null;
  error: string | null;
  /** 失败码（daemon 码或前端归一码；错误态展示用，`status!=='error'` 时为 null）。 */
  errorCode: string | null;
}

/** 查询 hook（`params` 变化即重新取数；`reload` 手动重取）。 */
export function useMarketQuery(
  params: MarketQueryParams,
  options: { baseUrl?: string; enabled?: boolean } = {},
): MarketQueryState & { reload: () => void } {
  const [state, setState] = useState<MarketQueryState>({
    status: 'loading',
    response: null,
    error: null,
    errorCode: null,
  });
  const [nonce, setNonce] = useState(0);
  const key = JSON.stringify(params);
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState((previous) => ({ ...previous, status: 'loading' }));
    // 依赖项用序列化键（对象字面量每次渲染都变）：请求参数从键还原，保证依赖列表完整。
    const request = fetchMarketQuery(JSON.parse(key) as MarketQueryParams, {
      signal: controller.signal,
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    });
    void request.then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        setState({ status: 'ready', response: result.result, error: null, errorCode: null });
      } else {
        setState({
          status: 'error',
          response: null,
          error: result.error.message,
          errorCode: result.error.code,
        });
      }
    });
    return () => {
      controller.abort();
    };
  }, [key, enabled, options.baseUrl, nonce]);

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { ...state, reload };
}

/** 资产详情 hook（未命中 → `asset=null`；请求失败 → `status='error'` + `errorCode`）。
 *
 * `errorCode` 是 E2 的分流依据：daemon 对「资产不存在」回 `market_asset_not_found`
 * （404），页面据此渲染独立 not-found 空态；其余码（含 `daemon_unreachable`）才是连接/服务错误。
 */
export function useMarketAsset(
  assetId: string,
  options: { baseUrl?: string } = {},
): {
  status: 'loading' | 'ready' | 'error';
  asset: MarketAsset | null;
  error: string | null;
  errorCode: string | null;
  reload: () => void;
} {
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'error';
    asset: MarketAsset | null;
    error: string | null;
    errorCode: string | null;
  }>({ status: 'loading', asset: null, error: null, errorCode: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading', asset: null, error: null, errorCode: null });
    void fetchMarketAsset(assetId, {
      signal: controller.signal,
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        setState({
          status: 'ready',
          asset: assetFromDetail(result.result),
          error: null,
          errorCode: null,
        });
      } else {
        setState({
          status: 'error',
          asset: null,
          error: result.error.message,
          errorCode: result.error.code,
        });
      }
    });
    return () => {
      controller.abort();
    };
  }, [assetId, options.baseUrl, nonce]);

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { ...state, reload };
}

/** 装载提案 hook（`assetId=null` 表示未选资产：不请求）。 */
export function useLoadPlan(
  assetId: string | null,
  options: { baseUrl?: string } = {},
): {
  status: 'idle' | 'loading' | 'ready' | 'error';
  plan: MarketLoadPlan | null;
  error: string | null;
} {
  const [state, setState] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'error';
    plan: MarketLoadPlan | null;
    error: string | null;
  }>({ status: 'idle', plan: null, error: null });

  useEffect(() => {
    if (assetId === null) {
      setState({ status: 'idle', plan: null, error: null });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading', plan: null, error: null });
    void fetchMarketLoadPlan(assetId, {
      signal: controller.signal,
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        setState({ status: 'ready', plan: result.result, error: null });
      } else {
        setState({ status: 'error', plan: null, error: result.error.message });
      }
    });
    return () => {
      controller.abort();
    };
  }, [assetId, options.baseUrl]);

  return state;
}

/** 本地装载记录册 hook（写入即持久化到 `localStorage`）。 */
export function useLoadRecords(): {
  records: LoadRecord[];
  loadedIds: string[];
  save: (record: LoadRecord) => void;
  remove: (assetId: string) => void;
} {
  const [records, setRecords] = useState<LoadRecord[]>([]);

  const storage = useMemo<LoadStoreLike | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (storage === null) return;
    setRecords(readLoadRecords(storage));
  }, [storage]);

  const save = useCallback(
    (record: LoadRecord) => {
      if (storage === null) return;
      setRecords(writeLoadRecord(storage, record));
    },
    [storage],
  );

  const remove = useCallback(
    (assetId: string) => {
      if (storage === null) return;
      setRecords(removeLoadRecord(storage, assetId));
    },
    [storage],
  );

  return { records, loadedIds: loadedAssetIds(records), save, remove };
}

/** 增量分页的状态（内部；按参数序列化键隔离）。 */
interface PagedExtra {
  key: string;
  /** 下一页的**服务端 offset**（= 已请求页的原始条数之和；不是去重后的卡片数）。 */
  cursor: number;
  items: MarketAsset[];
  done: boolean;
  loading: boolean;
  error: string | null;
}

/** 列表分页 hook（DEF-R1 / DEF-02）：首屏取数 +「加载更多」增量累加。
 *
 * 口径：
 * - 过滤/检索/排序参数变化 → 累积按序列化键**自动失效**（旧响应晚到也按 key 丢弃）；
 * - 游标 `cursor` 按服务端**原始页长**推进（`offset + result.items.length`），
 *   不拿去重后的卡片数当 offset——否则重复项会让后续页跳过真实条目（DEF-02）；
 * - 追加按 id 去重；终点以服务端 `total` 为准（空页亦视为终点）；
 * - 失败不抛异常：保留已载内容与游标，`loadMoreState='error'` + 可重试（同一 offset）。
 */
export function useMarketPagination(
  params: MarketQueryParams,
  options: { baseUrl?: string; enabled?: boolean } = {},
): MarketQueryState & {
  reload: () => void;
  items: MarketAsset[];
  loadMore: () => void;
  loadMoreState: 'idle' | 'loading' | 'error' | 'done';
  loadMoreError: string | null;
  /** 是否还有下一页（游标未到服务端 total 且未判定终点）。 */
  hasMore: boolean;
} {
  const query = useMarketQuery(params, options);
  const key = JSON.stringify(params);
  const firstPage = query.response?.items ?? [];
  const total = query.response?.total ?? 0;
  const [extra, setExtra] = useState<PagedExtra>({
    key,
    cursor: firstPage.length,
    items: [],
    done: false,
    loading: false,
    error: null,
  });
  const busy = useRef(false);

  // 参数变化或重取首屏后旧累积自动失效；游标从首屏页长起步（读时比对 key 兜底）。
  useEffect(() => {
    busy.current = false;
    setExtra({
      key,
      cursor: firstPage.length,
      items: [],
      done: false,
      loading: false,
      error: null,
    });
  }, [key, query.response, firstPage.length]);

  const active: PagedExtra =
    extra.key === key
      ? extra
      : { key, cursor: firstPage.length, items: [], done: false, loading: false, error: null };

  const items = appendMarketPage(firstPage, active.items);
  const loadMoreState: 'idle' | 'loading' | 'error' | 'done' =
    active.error !== null ? 'error' : active.loading ? 'loading' : active.done ? 'done' : 'idle';
  const hasMore = hasMorePages(active.cursor, total) && !active.done;

  const loadMore = useCallback(() => {
    if (busy.current || active.loading || active.done || !hasMorePages(active.cursor, total))
      return;
    busy.current = true;
    const offset = active.cursor;
    setExtra({ key, cursor: offset, items: active.items, done: false, loading: true, error: null });
    void fetchMarketQuery(
      { ...params, offset },
      { ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }) },
    )
      .then((result) => {
        busy.current = false;
        setExtra((previous) => {
          if (previous.key !== key) return previous; // 参数已变：丢弃旧响应
          if (!result.ok) {
            return { ...previous, loading: false, error: result.error.message };
          }
          const nextCursor = offset + result.result.items.length;
          const merged = appendMarketPage(
            firstPage,
            appendMarketPage(previous.items, result.result.items),
          );
          return {
            key,
            cursor: nextCursor,
            items: merged.slice(firstPage.length),
            done:
              result.result.items.length === 0 || !hasMorePages(nextCursor, result.result.total),
            loading: false,
            error: null,
          };
        });
      })
      .catch((error: unknown) => {
        busy.current = false;
        setExtra((previous) =>
          previous.key === key
            ? {
                ...previous,
                loading: false,
                error: error instanceof Error ? error.message : String(error),
              }
            : previous,
        );
      });
  }, [
    active.cursor,
    active.done,
    active.items,
    active.loading,
    firstPage,
    key,
    options.baseUrl,
    params,
    total,
  ]);

  return { ...query, items, loadMore, loadMoreState, loadMoreError: active.error, hasMore };
}

/** 存储键透出（测试与调试用；写入形状见 `load-store`）。 */
export { LOADED_RECORDS_KEY };
