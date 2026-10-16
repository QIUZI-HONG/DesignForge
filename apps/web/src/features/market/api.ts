/**
 * 市场数据面客户端（daemon `/market` 路由；D1–D6 的唯一取数入口）。
 *
 * 口径（《技能市场规格 v1》§6 + 《市场首实现》§6.2）：
 * - **索引缺失/损坏是空态，不是错误**：daemon 用 `warnings`（`index-missing`/`index-invalid`）
 *   表达，本模块把它们归一成视图状态（`classifyMarketOutcome`），页面据此给「去跑采集」指引；
 *   任何情况下**不伪造数据**（无索引就是空态，不造样例卡片）。
 * - 信封统一 `{ok, result|error}`（`apps/daemon/src/http.ts`）：HTTP 层只看信封，不看状态码分支。
 * - **信封与内层都要验形状**：`{ok:true,result:null}` 与「内层字段为 null / 类型不符」同样是坏响应，
 *   在解包点归一为带码失败（`daemon_bad_response`），页面拿到的一定是形状已验的数据——
 *   渲染路径不再有抛 TypeError 的输入（W1 缺陷：此前的坏响应走到渲染期整树卸载 = 白屏）。
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
import { DAEMON_ROUTES } from '@dforge/contracts';

import { DAEMON_ENDPOINT_DEFAULT, resolveDaemonEndpointSync } from '@/lib/daemon-endpoint';

/**
 * daemon 缺省地址（端口窗起点）。解析顺序**全站收敛**在 `@/lib/daemon-endpoint`
 * （ADR-0004 裁决 ①）——本模块不另立口径，env 读取也只在收敛模块内发生。
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

/**
 * 内层形状校验器：把 result 收窄为契约类型；形状不符返回 null（`readEnvelope` 据此归一为失败）。
 * 为什么在信封层做：`{ok:true,result:null}` / 内层字段为 null 的「信封状坏响应」此前能过
 * `isApiSuccess`，一路走到渲染期才抛 TypeError（整树卸载 = 白屏）；把判定前移到解包点，
 * 页面只需处理「成功 = 形状已验」与「失败 = 有码有文案」两种情况。
 */
export type MarketShapeValidator<T> = (result: unknown) => T | null;

/** 客户端可注入点（测试与门禁用假 fetch，不真连网络）。 */
export interface MarketClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * 取 daemon 基址——纯委托 `@/lib/daemon-endpoint`（解析顺序与环境变量读取都在那里，
 * 本模块不再暴露 env 注入口；测试要注入环境请用收敛模块的 `envUrl` 选项或其单测）。
 */
export function daemonBaseUrl(): string {
  return resolveDaemonEndpointSync();
}

/** 规范化未知的 JSON 为信封（缺 result / result 为空 / 形状不符一律按失败处理——绝不当成功）。 */
export function readEnvelope<T>(
  value: unknown,
  validate?: MarketShapeValidator<T>,
): MarketEnvelope<T> {
  if (typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === true) {
    const record = value as Record<string, unknown>;
    if (!('result' in record)) {
      // 缺 result：连信封形状都不是（daemon 契约里 result 是必有键）
      return failure('daemon_bad_response', '本地服务响应缺 result 字段（已按错误处理）');
    }
    const raw = record.result;
    if (raw === null || raw === undefined) {
      // `{ok:true,result:null}`：信封说成功但载荷为空——这是坏响应，不是空数据
      return failure('daemon_bad_response', '本地服务返回了空结果（result 为 null，已按错误处理）');
    }
    if (validate !== undefined) {
      const shaped = validate(raw);
      if (shaped === null) {
        return failure(
          'daemon_bad_response',
          '本地服务返回的 result 形状不符合契约（已按错误处理，可重试）',
        );
      }
      return { ok: true, result: shaped };
    }
    return { ok: true, result: raw as T };
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const rawError = record.error;
    if (rawError !== undefined && rawError !== null) {
      const error = rawError as Record<string, unknown>;
      const failure_: MarketFailure = {
        code: typeof error.code === 'string' ? error.code : 'internal',
        message: typeof error.message === 'string' ? error.message : '本地服务返回了未知错误',
      };
      if (typeof error.details === 'object' && error.details !== null) {
        failure_.details = error.details as Record<string, unknown>;
      }
      return { ok: false, error: failure_ };
    }
  }
  return failure('internal', '本地服务响应不是可识别的 JSON 信封');
}

/** 造一个失败信封（内部小工具，避免每处重复字面量）。 */
function failure(code: string, message: string): { ok: false; error: MarketFailure } {
  return { ok: false, error: { code, message } };
}

/** 判断值是否为非 null 对象（形状校验的最小单元）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 查询响应形状校验：字段类型不符返回 null（归一为结构化错误，绝不让页面读脏字段）。 */
export function validateMarketQueryResponse(value: unknown): MarketQueryResponse | null {
  if (!isRecord(value)) return null;
  const { schema, state, generatedAt, total, counts, items, warnings } = value;
  if (typeof schema !== 'string' || schema.length === 0) return null;
  if (state !== 'ok' && state !== 'empty') return null;
  if (generatedAt !== null && typeof generatedAt !== 'string') return null;
  if (typeof total !== 'number' || !Number.isFinite(total)) return null;
  if (counts !== null && !isRecord(counts)) return null;
  // items/warnings 必须是数组，且元素必须是对象——页面/分类函数随后直接读其字段
  if (!Array.isArray(items) || !items.every(isRecord)) return null;
  if (!Array.isArray(warnings) || !warnings.every(isRecord)) return null;
  return value as unknown as MarketQueryResponse;
}

/** 详情响应形状校验（found 判别 + asset 非空）。 */
export function validateMarketAssetDetail(value: unknown): MarketAssetDetailResponse | null {
  if (!isRecord(value)) return null;
  if (value.found === true) {
    return isRecord(value.asset) ? (value as unknown as MarketAssetDetailResponse) : null;
  }
  if (value.found === false) {
    return typeof value.assetId === 'string'
      ? (value as unknown as MarketAssetDetailResponse)
      : null;
  }
  return null;
}

/** 装载提案形状校验（确认框直接读这些字段，缺一项即形状坏）。 */
export function validateMarketLoadPlan(value: unknown): MarketLoadPlan | null {
  if (!isRecord(value)) return null;
  if (typeof value.assetId !== 'string') return null;
  if (typeof value.mode !== 'string') return null;
  if (typeof value.loadable !== 'boolean') return null;
  if (
    !Array.isArray(value.ackRequired) ||
    !value.ackRequired.every((ack) => typeof ack === 'string')
  ) {
    return null;
  }
  if (!isRecord(value.license)) return null;
  return value as unknown as MarketLoadPlan;
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
  options: MarketClientOptions & {
    method?: 'GET' | 'POST';
    body?: unknown;
    validate?: MarketShapeValidator<T>;
  },
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
    return readEnvelope<T>(payload, options.validate);
  } catch (error) {
    return {
      ok: false,
      error: { code: 'daemon_unreachable', message: `无法连接本地服务：${String(error)}` },
    };
  }
}

/** 查询市场（含空态/告警；不抛错——失败走信封；内层形状校验后页面不会读到脏字段）。 */
export function fetchMarketQuery(
  params: MarketQueryParams,
  options: MarketClientOptions = {},
): Promise<MarketEnvelope<MarketQueryResponse>> {
  const base = options.baseUrl ?? daemonBaseUrl();
  return requestJson<MarketQueryResponse>(buildMarketQueryUrl(base, params), {
    ...options,
    validate: validateMarketQueryResponse,
  });
}

/** 取资产详情（未命中时 daemon 回 `market_asset_not_found`）。 */
export function fetchMarketAsset(
  assetId: string,
  options: MarketClientOptions = {},
): Promise<MarketEnvelope<MarketAssetDetailResponse>> {
  const base = options.baseUrl ?? daemonBaseUrl();
  return requestJson<MarketAssetDetailResponse>(buildMarketAssetUrl(base, assetId), {
    ...options,
    validate: validateMarketAssetDetail,
  });
}

/** 取装载提案（dryRun 前置；真实写入归 MCP 确认桩）。 */
export function fetchMarketLoadPlan(
  assetId: string,
  options: MarketClientOptions & { documentId?: string | null } = {},
): Promise<MarketEnvelope<MarketLoadPlan>> {
  const base = options.baseUrl ?? daemonBaseUrl();
  return requestJson<MarketLoadPlan>(buildMarketLoadPlanUrl(base), {
    ...options,
    validate: validateMarketLoadPlan,
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

/** 告警分类（`index-*` 归空态；其余归部分失败）。
 *
 * 脏输入（非数组）容错为空告警：本函数是**页面渲染路径**上的一环，抛 TypeError 会
 * 让整树卸载（无错误边界时 = 白屏）；形状该在解包点被拦（见 `validateMarketQueryResponse`），
 * 这里只是最后一道不崩的底线。
 */
export function classifyWarnings(warnings: readonly MarketQueryWarning[] | null | undefined): {
  indexMissing: boolean;
  indexInvalid: boolean;
  partial: boolean;
} {
  const list = Array.isArray(warnings) ? warnings : [];
  const indexMissing = list.some((warning) => warning?.code === 'index-missing');
  const indexInvalid = list.some((warning) => warning?.code === 'index-invalid');
  return {
    indexMissing,
    indexInvalid,
    partial: list.some(
      (warning) => warning?.code !== 'index-missing' && warning?.code !== 'index-invalid',
    ),
  };
}

/**
 * 归一查询响应到视图状态。
 * 优先级：索引缺失/损坏（空态·给采集指引）> 无结果（空态·清筛选）> 部分失败（结果区提示）> ok。
 * 脏 `items`（非数组）按空结果处理（同上：渲染路径不抛）。
 */
export function classifyMarketOutcome(response: MarketQueryResponse): MarketOutcome {
  const { indexMissing, indexInvalid, partial } = classifyWarnings(response.warnings);
  if (indexMissing) return 'index-missing';
  if (indexInvalid) return 'index-invalid';
  const items = Array.isArray(response.items) ? response.items : [];
  if (items.length === 0) return 'no-result';
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
