/**
 * 市场数据面客户端（daemon `/market` 路由；D1–D6 的唯一取数入口）。
 *
 * 口径（《技能市场规格 v1》§6 + 《市场首实现》§6.2）：
 * - **索引缺失/损坏是空态，不是错误**：daemon 用 `warnings`（`index-missing`/`index-invalid`）
 *   表达，本模块把它们归一成视图状态（`classifyMarketOutcome`），页面据此给「去跑采集」指引；
 *   任何情况下**不伪造数据**（无索引就是空态，不造样例卡片）。
 * - **单信封栈（票 130）**：信封拆包与 result 形状校验收口在传输层——`requestJson` 把
 *   `MarketShapeValidator` 适配成 transport `validate` 谓词传给 `daemonRequest`，脏 result
 *   （`{ok:true,result:null}` / 内层字段类型不符）在解包点即判 `daemon_bad_response`
 *   （reason=invalid-shape）；本模块不再二次拆包（原第二份信封拆包已删），传输结果经
 *   {@link toMarketEnvelope} 单点映射为 `MarketEnvelope`（ADR-0004：错误映射留消费方适配层）。
 *   页面拿到的一定是形状已验的数据——渲染路径不再有抛 TypeError 的输入（W1 缺陷：此前的
 *   坏响应走到渲染期整树卸载 = 白屏）。
 * - 路径一律取 `@dforge/contracts` 的 `DAEMON_ROUTES`（路径单一真源），不硬编码字符串。
 */

import type {
  MarketAsset,
  MarketAssetDetailResponse,
  MarketInstallResponse,
  MarketLoadPlan,
  MarketQueryParams,
  MarketQueryResponse,
  MarketQueryWarning,
} from '@dforge/contracts';
import { DAEMON_ROUTES, encodeMarketQuery } from '@dforge/contracts';

import { DAEMON_ENDPOINT_DEFAULT, resolveDaemonEndpointSync } from '@/lib/daemon-endpoint';
import {
  request as daemonRequest,
  TRANSPORT_BAD_RESPONSE_REASONS,
  type TransportResult,
} from '@/lib/daemon-transport';

import type { MarketInstallClient } from './load-token';

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
 * 内层形状校验器：把 result 收窄为契约类型；形状不符返回 null（经 {@link toValidatePredicate}
 * 适配成 transport `validate` 谓词，脏 result 在传输层解包点归一为失败）。
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
  /** 单请求超时上限（毫秒；测试注入小值；缺省走传输层 30s）。 */
  timeoutMs?: number;
}

/**
 * 取 daemon 基址的**同步**快路径（查询参数 → env → 端口窗起点；不探测）。
 *
 * 只用于「创建时就要一个字符串」的宿主/测试；**取数路径不经过它**——无注入 `baseUrl`
 * 时 `requestJson` 把解析交给传输层的异步 `resolveDaemonEndpoint()`（端口窗健康探测
 * 4318..4350，命中即止、进程内缓存）。此前这里用同步解析导致首页市场检索只能打到
 * 端口窗起点，端口漂移时整块市场「不可用」（评审 F3）。
 */
export function daemonBaseUrl(): string {
  return resolveDaemonEndpointSync();
}

/**
 * 把形状校验器适配成 transport `validate` 类型谓词（票 130）：校验器返回非 null 即收窄为 T。
 * 适配只此一处——校验器签名（T | null）与传输层谓词签名（value is T）在此换算。
 */
function toValidatePredicate<T>(
  validator: MarketShapeValidator<T>,
): (value: unknown) => value is T {
  return (value: unknown): value is T => validator(value) !== null;
}

/**
 * 判断传输失败 details 是否携带 invalid-shape 理由（对照 transport 导出常量取值，不另写字面量）。
 * 归一判据方向性保守（票 130 / 评审 F4）：只有 invalid-shape 保留 `daemon_bad_response`，
 * 其余坏响应理由（invalid-json / malformed-envelope / 无理由）一律归一 `daemon_unreachable`。
 */
function isInvalidShapeReason(details: unknown): boolean {
  return (
    typeof details === 'object' &&
    details !== null &&
    (details as { reason?: unknown }).reason === TRANSPORT_BAD_RESPONSE_REASONS.invalidShape
  );
}

/**
 * 传输结果 → 市场信封的**唯一失败映射点**（票 130；ADR-0004：错误映射留消费方适配层）。
 * 归一判据方向性保守（评审 F4）：
 * - `daemon_bad_response` 且 reason=invalid-shape → 保留 `daemon_bad_response`（daemon 活着、
 *   答的是坏数据——内层形状坏，与「服务不可达」不是同一用户动作）；
 * - 其余 `daemon_bad_response`（invalid-json / malformed-envelope / 无理由）→
 *   `daemon_unreachable`（网关活着但上游答不出可用信封——与不可达同一用户动作：确认服务 /
 *   重试；message/details 保留技术细节，便于诊断）；
 * - `daemon_unreachable` / `daemon_timeout` → `daemon_unreachable`；
 * - 其余（daemon 线上码）原码透传，details 保留。
 */
function toMarketEnvelope<T>(result: TransportResult<T>): MarketEnvelope<T> {
  if (result.ok) return { ok: true, result: result.value };
  if (result.code === 'daemon_bad_response') {
    if (isInvalidShapeReason(result.details)) {
      return failure(result.code, result.message, result.details);
    }
    return failure('daemon_unreachable', result.message, result.details);
  }
  if (result.code === 'daemon_unreachable' || result.code === 'daemon_timeout') {
    return failure('daemon_unreachable', result.message);
  }
  return failure(result.code, result.message, result.details);
}

/** 造一个失败信封（内部小工具，避免每处重复字面量）。 */
function failure(
  code: string,
  message: string,
  details?: unknown,
): { ok: false; error: MarketFailure } {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(typeof details === 'object' && details !== null
        ? { details: details as Record<string, unknown> }
        : {}),
    },
  };
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

/** 查询路径（含序列化查询串；URL 构造器与传输层共用这一份，避免路径两处漂移）。 */
function marketQueryPath(
  params: MarketQueryParams,
  options?: { limit?: number; offset?: number },
): string {
  // 分页覆盖是 URL 构造器的便利参数（不属于 MarketQueryParams）；合并后交协议层编码。
  const merged: MarketQueryParams = { ...params };
  if (options?.limit !== undefined) merged.limit = options.limit;
  if (options?.offset !== undefined) merged.offset = options.offset;
  const query = encodeMarketQuery(merged);
  return `${DAEMON_ROUTES.marketQuery.path}${query.length > 0 ? `?${query}` : ''}`;
}

/** 查询串序列化（口径与 daemon `routes/market.ts` 的解码表同源：contracts `encodeMarketQuery`）。 */
export function buildMarketQueryUrl(
  baseUrl: string,
  params: MarketQueryParams,
  options?: { limit?: number; offset?: number },
): string {
  return `${baseUrl}${marketQueryPath(params, options)}`;
}

/** 资产详情路径（路径参数需 URL 编码——id 形如 `gh:owner/repo#path`）。 */
function marketAssetPath(assetId: string): string {
  return DAEMON_ROUTES.marketAsset.path.replace(':assetId', encodeURIComponent(assetId));
}

/** 资产详情 URL（路径参数需 URL 编码——id 形如 `gh:owner/repo#path`）。 */
export function buildMarketAssetUrl(baseUrl: string, assetId: string): string {
  return `${baseUrl}${marketAssetPath(assetId)}`;
}

/** 装载提案 URL。 */
export function buildMarketLoadPlanUrl(baseUrl: string): string {
  return `${baseUrl}${DAEMON_ROUTES.marketLoadPlan.path}`;
}

/** 装载安装 URL（票③：daemon 真写端点，路径单一真源）。 */
export function buildMarketInstallUrl(baseUrl: string): string {
  return `${baseUrl}${DAEMON_ROUTES.marketInstall.path}`;
}

async function requestJson<T>(
  path: string,
  options: MarketClientOptions & {
    method?: 'GET' | 'POST';
    body?: unknown;
    validate: MarketShapeValidator<T>;
  },
): Promise<MarketEnvelope<T>> {
  const method = options.body === undefined ? (options.method ?? 'GET') : 'POST';
  // 无注入 baseUrl 时不预解析：传输层走异步 `resolveDaemonEndpoint()`（端口窗探测 +
  // 进程内缓存）；注入 baseUrl 时按原样使用（测试/宿主显式指向）。
  // validate 必填（票 130）：四 fetcher 全带校验器，脏 result 在传输层解包点即判
  // daemon_bad_response（invalid-shape）——市场页拿到的一定是形状已验的数据。
  const result = await daemonRequest<T>(
    { method, path },
    {
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.body === undefined ? {} : { body: options.body }),
      validate: toValidatePredicate(options.validate),
    },
  );
  // 失败映射单点（票 130）：客户端层只透传原始错误与归一码（票 06 / spec P1-2）——
  // 不在这里拼界面文案，「中文人话 + 下一步 + 技术详情」由展示层经共享归类
  // （`@/lib/daemon-failure`）生成；坏响应归一口径见 {@link toMarketEnvelope}。
  return toMarketEnvelope(result);
}

/** 查询市场（含空态/告警；不抛错——失败走信封；内层形状校验后页面不会读到脏字段）。 */
export function fetchMarketQuery(
  params: MarketQueryParams,
  options: MarketClientOptions = {},
): Promise<MarketEnvelope<MarketQueryResponse>> {
  return requestJson<MarketQueryResponse>(marketQueryPath(params), {
    ...options,
    validate: validateMarketQueryResponse,
  });
}

/** 取资产详情（未命中时 daemon 回 `market_asset_not_found`）。 */
export function fetchMarketAsset(
  assetId: string,
  options: MarketClientOptions = {},
): Promise<MarketEnvelope<MarketAssetDetailResponse>> {
  return requestJson<MarketAssetDetailResponse>(marketAssetPath(assetId), {
    ...options,
    validate: validateMarketAssetDetail,
  });
}

/** 取装载提案（dryRun 前置；可装载提案随响应携带一次性 ackToken——票③ install 消费）。 */
export function fetchMarketLoadPlan(
  assetId: string,
  options: MarketClientOptions & { documentId?: string | null } = {},
): Promise<MarketEnvelope<MarketLoadPlan>> {
  return requestJson<MarketLoadPlan>(DAEMON_ROUTES.marketLoadPlan.path, {
    ...options,
    validate: validateMarketLoadPlan,
    body: { assetId, documentId: options.documentId ?? null },
  });
}

/** 装载安装响应形状校验（缺任一必需键返回 null → 归一 daemon_bad_response）。 */
export function validateMarketInstallResponse(value: unknown): MarketInstallResponse | null {
  if (!isRecord(value)) return null;
  if (typeof value.schema !== 'string' || value.schema.length === 0) return null;
  if (typeof value.assetId !== 'string' || value.assetId.length === 0) return null;
  if (typeof value.kind !== 'string' || value.kind.length === 0) return null;
  if (typeof value.slug !== 'string' || value.slug.length === 0) return null;
  if (typeof value.targetPath !== 'string' || value.targetPath.length === 0) return null;
  if (typeof value.digest !== 'string' || value.digest.length === 0) return null;
  if (!Array.isArray(value.files) || !value.files.every((file) => typeof file === 'string')) {
    return null;
  }
  if (typeof value.loadedAt !== 'string' || value.loadedAt.length === 0) return null;
  if (typeof value.auditId !== 'string' || value.auditId.length === 0) return null;
  return value as unknown as MarketInstallResponse;
}

/** 发起真实装载（POST /market/install；一次性 ackToken 来自装载提案）。 */
export function fetchMarketInstall(
  input: { assetId: string; ackToken: string },
  options: MarketClientOptions = {},
): Promise<MarketEnvelope<MarketInstallResponse>> {
  return requestJson<MarketInstallResponse>(DAEMON_ROUTES.marketInstall.path, {
    ...options,
    validate: validateMarketInstallResponse,
    body: { assetId: input.assetId, ackToken: input.ackToken },
  });
}

/**
 * 组装装载客户端（`LoadConfirmDialog` 的 `install` 注入点；页面侧构造一次传入）。
 * 信封 → 装载会话 outcome：成功只取记账/渲染所需真值字段，失败透传 daemon 原始错误码
 * （装载状态机据此映射前端词表并保留原码做诊断）。
 */
export function makeMarketInstallClient(options: MarketClientOptions = {}): MarketInstallClient {
  return async (input) => {
    const envelope = await fetchMarketInstall(input, options);
    if (envelope.ok) {
      return {
        ok: true,
        digest: envelope.result.digest,
        loadedAt: envelope.result.loadedAt,
        targetPath: envelope.result.targetPath,
        files: [...envelope.result.files],
      };
    }
    return { ok: false, code: envelope.error.code, message: envelope.error.message };
  };
}

/**
 * 取详情里的资产（未命中返回 null——调用方据此渲染「资源不存在」态，不再造空卡片）。
 */
export function assetFromDetail(response: MarketAssetDetailResponse): MarketAsset | null {
  return response.found ? response.asset : null;
}

/** 视图状态：ok / 无结果 / 索引缺失（空态·去跑采集）/ 索引损坏（空态）/ 部分失败。 */
export type MarketOutcome = 'ok' | 'no-result' | 'index-missing' | 'index-invalid' | 'partial';

/** 告警分类（`index-*` 归空态；`search-index-*` 归检索降级提示；其余归部分失败）。
 *
 * 三族**不合并**（E1 口径）：`index-*` 表示连卡片都没有（空态给采集指引）；
 * `search-index-*` 表示有卡片但检索退化为字面匹配（结果照常展示 + 「暂按字面匹配」提示）。
 *
 * 脏输入（非数组）容错为空告警：本函数是**页面渲染路径**上的一环，抛 TypeError 会
 * 让整树卸载（无错误边界时 = 白屏）；形状该在解包点被拦（见 `validateMarketQueryResponse`），
 * 这里只是最后一道不崩的底线。
 */
export function classifyWarnings(warnings: readonly MarketQueryWarning[] | null | undefined): {
  indexMissing: boolean;
  indexInvalid: boolean;
  searchDegraded: boolean;
  partial: boolean;
} {
  const list = Array.isArray(warnings) ? warnings : [];
  const indexMissing = list.some((warning) => warning?.code === 'index-missing');
  const indexInvalid = list.some((warning) => warning?.code === 'index-invalid');
  const searchDegraded = list.some(
    (warning) =>
      warning?.code === 'search-index-missing' || warning?.code === 'search-index-invalid',
  );
  return {
    indexMissing,
    indexInvalid,
    searchDegraded,
    partial: list.some(
      (warning) =>
        warning?.code !== 'index-missing' &&
        warning?.code !== 'index-invalid' &&
        warning?.code !== 'search-index-missing' &&
        warning?.code !== 'search-index-invalid',
    ),
  };
}

/** 检索索引降级判定（`search-index-*`）——页面据此给「暂按字面匹配」提示（E1）。 */
export function isSearchDegraded(
  warnings: readonly MarketQueryWarning[] | null | undefined,
): boolean {
  return classifyWarnings(warnings).searchDegraded;
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
