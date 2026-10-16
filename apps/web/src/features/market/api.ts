/**
 * 市场数据面客户端（daemon `/market` 路由；D1–D6 的唯一取数入口）。
 *
 * 口径（《技能市场规格 v1》§6 + 《市场首实现》§6.2）：
 * - **索引缺失/损坏是空态，不是错误**：daemon 用 `warnings`（`index-missing`/`index-invalid`）
 *   表达，本模块把它们归一成视图状态（`classifyMarketOutcome`），页面据此给「去跑采集」指引；
 *   任何情况下**不伪造数据**（无索引就是空态，不造样例卡片）。
 * - 信封统一 `{ok, result|error}`（`apps/daemon/src/http.ts`）：HTTP 层只看信封，不看状态码分支。
 * - 路径一律取 `@dforge/contracts` 的 `DAEMON_ROUTES`（路径单一真源），不硬编码字符串。
 */

import type {
  MarketAsset,
  MarketAssetDetailResponse,
  MarketLoadPlan,
  MarketQueryParams,
  MarketQueryResponse,
  MarketQueryWarning,
} from '@dforge/contracts';
import { DAEMON_ROUTES, isApiSuccess } from '@dforge/contracts';

import { DAEMON_ENDPOINT_DEFAULT, resolveDaemonEndpointSync } from '@/lib/daemon-endpoint';

/**
 * daemon 缺省地址（端口窗起点）。解析顺序（`?daemon=` → `NEXT_PUBLIC_DF_DAEMON_URL` →
 * 缺省起点）**全站收敛**在 `@/lib/daemon-endpoint`（ADR-0004 裁决 ①）——本模块不另立口径。
 */
export const DEFAULT_DAEMON_URL = DAEMON_ENDPOINT_DEFAULT;

/** 失败信封的归一形状（daemon 错误码表 + 可读消息）。 */
export interface MarketFailure {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** 取数结果信封（成功带 result，失败带 error）。 */
export type MarketEnvelope<T> = { ok: true; result: T } | { ok: false; error: MarketFailure };

/** 客户端可注入点（测试与门禁用假 fetch，不真连网络）。 */
export interface MarketClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * 从收敛模块取 daemon 基址（顺序与 env 读取口径见 `@/lib/daemon-endpoint`）。
 *
 * `env` 参数用于测试注入（给出即以此为准，不再读 `process.env`）；
 * 不传则读静态 `process.env.NEXT_PUBLIC_DF_DAEMON_URL`（Next 构建期内联口径）。
 */
export function daemonBaseUrl(env?: Record<string, string | undefined>): string {
  return resolveDaemonEndpointSync(
    env === undefined ? {} : { envUrl: env.NEXT_PUBLIC_DF_DAEMON_URL },
  );
}

/** 规范化未知的 JSON 为信封（缺 result 视为失败——形状不符绝不当成功）。 */
export function readEnvelope<T>(value: unknown): MarketEnvelope<T> {
  if (isApiSuccess<T>(value)) return { ok: true, result: value.result };
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const rawError = record.error;
    if (rawError !== undefined && rawError !== null) {
      const error = rawError as Record<string, unknown>;
      const failure: MarketFailure = {
        code: typeof error.code === 'string' ? error.code : 'internal',
        message: typeof error.message === 'string' ? error.message : '本地服务返回了未知错误',
      };
      if (typeof error.details === 'object' && error.details !== null) {
        failure.details = error.details as Record<string, unknown>;
      }
      return { ok: false, error: failure };
    }
  }
  return { ok: false, error: { code: 'internal', message: '本地服务响应不是可识别的 JSON 信封' } };
}

/** 查询串序列化（字段口径与 daemon `routes/market.ts` 的 parseQuery 一致）。 */
export function buildMarketQueryUrl(
  baseUrl: string,
  params: MarketQueryParams,
  options?: { limit?: number; offset?: number },
): string {
  const search = new URLSearchParams();
  if (params.q !== undefined && params.q.length > 0) search.set('q', params.q);
  if (params.kinds !== undefined && params.kinds.length > 0)
    search.set('kind', params.kinds.join(','));
  if (params.category !== undefined) search.set('category', params.category);
  if (params.lane !== undefined) search.set('lane', params.lane);
  if (params.mode !== undefined) search.set('mode', params.mode);
  if (params.scene !== undefined) search.set('scene', params.scene);
  if (params.tags !== undefined && params.tags.length > 0)
    search.set('tags', params.tags.join(','));
  if (params.loadableOnly === true) search.set('loadable', '1');
  if (params.sort !== undefined) search.set('sort', params.sort);
  const limit = options?.limit ?? params.limit;
  if (limit !== undefined) search.set('limit', String(limit));
  const offset = options?.offset ?? params.offset;
  if (offset !== undefined && offset > 0) search.set('offset', String(offset));
  const query = search.toString();
  return `${baseUrl}${DAEMON_ROUTES.marketQuery.path}${query.length > 0 ? `?${query}` : ''}`;
}

/** 资产详情 URL（路径参数需 URL 编码——id 形如 `gh:owner/repo#path`）。 */
export function buildMarketAssetUrl(baseUrl: string, assetId: string): string {
  const path = DAEMON_ROUTES.marketAsset.path.replace(':assetId', encodeURIComponent(assetId));
  return `${baseUrl}${path}`;
}

/** 装载提案 URL。 */
export function buildMarketLoadPlanUrl(baseUrl: string): string {
  return `${baseUrl}${DAEMON_ROUTES.marketLoadPlan.path}`;
}

async function requestJson<T>(
  url: string,
  options: MarketClientOptions & { method?: 'GET' | 'POST'; body?: unknown },
): Promise<MarketEnvelope<T>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const init: RequestInit = { method: options.method ?? 'GET' };
  if (options.signal !== undefined) init.signal = options.signal;
  if (options.body !== undefined) {
    init.method = 'POST';
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }
  try {
    const response = await fetchImpl(url, init);
    const payload: unknown = await response.json();
    return readEnvelope<T>(payload);
  } catch (error) {
    return {
      ok: false,
      error: { code: 'daemon_unreachable', message: `无法连接本地服务：${String(error)}` },
    };
  }
}

/** 查询市场（含空态/告警；不抛错——失败走信封）。 */
export function fetchMarketQuery(
  params: MarketQueryParams,
  options: MarketClientOptions = {},
): Promise<MarketEnvelope<MarketQueryResponse>> {
  const base = options.baseUrl ?? daemonBaseUrl();
  return requestJson<MarketQueryResponse>(buildMarketQueryUrl(base, params), options);
}

/** 取资产详情（未命中时 daemon 回 `market_asset_not_found`）。 */
export function fetchMarketAsset(
  assetId: string,
  options: MarketClientOptions = {},
): Promise<MarketEnvelope<MarketAssetDetailResponse>> {
  const base = options.baseUrl ?? daemonBaseUrl();
  return requestJson<MarketAssetDetailResponse>(buildMarketAssetUrl(base, assetId), options);
}

/** 取装载提案（dryRun 前置；真实写入归 MCP 确认桩）。 */
export function fetchMarketLoadPlan(
  assetId: string,
  options: MarketClientOptions & { documentId?: string | null } = {},
): Promise<MarketEnvelope<MarketLoadPlan>> {
  const base = options.baseUrl ?? daemonBaseUrl();
  return requestJson<MarketLoadPlan>(buildMarketLoadPlanUrl(base), {
    ...options,
    body: { assetId, documentId: options.documentId ?? null },
  });
}

/**
 * 取详情里的资产（未命中返回 null——调用方据此渲染「资源不存在」态，不再造空卡片）。
 */
export function assetFromDetail(response: MarketAssetDetailResponse): MarketAsset | null {
  return response.found ? response.asset : null;
}

/** 视图状态：ok / 无结果 / 索引缺失（空态·去跑采集）/ 索引损坏（空态）/ 部分失败。 */
export type MarketOutcome = 'ok' | 'no-result' | 'index-missing' | 'index-invalid' | 'partial';

/** 告警分类（`index-*` 归空态；其余归部分失败）。 */
export function classifyWarnings(warnings: readonly MarketQueryWarning[]): {
  indexMissing: boolean;
  indexInvalid: boolean;
  partial: boolean;
} {
  const indexMissing = warnings.some((warning) => warning.code === 'index-missing');
  const indexInvalid = warnings.some((warning) => warning.code === 'index-invalid');
  return {
    indexMissing,
    indexInvalid,
    partial: warnings.some(
      (warning) => warning.code !== 'index-missing' && warning.code !== 'index-invalid',
    ),
  };
}

/**
 * 归一查询响应到视图状态。
 * 优先级：索引缺失/损坏（空态·给采集指引）> 无结果（空态·清筛选）> 部分失败（结果区提示）> ok。
 */
export function classifyMarketOutcome(response: MarketQueryResponse): MarketOutcome {
  const { indexMissing, indexInvalid, partial } = classifyWarnings(response.warnings);
  if (indexMissing) return 'index-missing';
  if (indexInvalid) return 'index-invalid';
  if (response.items.length === 0) return 'no-result';
  if (partial) return 'partial';
  return 'ok';
}

/** 采集指引命令（空态给用户「去跑采集」——MK 线的 CLI 口径，不假装能自动补数据）。 */
export const MARKET_COLLECT_COMMAND = 'df market collect && df market score && df market index';

/** 溯源链接（D2/D1「查看来源」）：GitHub 上该资产根目录的 commit 固定链接。 */
export function buildSourceUrl(asset: MarketAsset): string | null {
  const repo = asset.source.repo;
  const ref = asset.source.ref;
  if (repo.length === 0 || ref.length === 0) return null;
  const path = asset.source.path;
  const suffix = path.length > 0 ? `/${path}` : '';
  return `https://github.com/${repo}/tree/${ref}${suffix}`;
}
