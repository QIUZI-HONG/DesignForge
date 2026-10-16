/**
 * daemon 端点（基址）解析 —— **全站单点收敛**（ADR-0004 裁决 ①）。
 *
 * 为什么必须单点：daemon 端口是有纪律的（从 `DAEMON_PORT_BASE` 起 +1 探测，上限
 * `DAEMON_PORT_MAX_OFFSET`，见 `@dforge/contracts` 的 `ipc/routes.ts`），而前端曾有三处
 * 并存口径——首页「查询参数 → env → 端口窗探测」、FE-10 家族「env → 4318」、
 * 编辑器工作区「查询参数 → env → 4318」。同一会话里不同面板可能指向不同端口
 * （画布连得上、市场连不上，或反之），排查成本高且不可测。本模块把解析顺序钉死为一处，
 * 所有 feature 一律经此取基址——**不得各自读 env / 查参 / 拼缺省端口**。
 *
 * 统一顺序（先到先用，全站一致）：
 *   1. 查询参数 `?daemon=http://host:port`（门禁/调试/宿主显式指向；原样使用，**不探测**）；
 *   2. 构建期环境变量 `NEXT_PUBLIC_DF_DAEMON_URL`（Electron 壳/部署注入）；
 *   3. 缺省端点 `DAEMON_ENDPOINT_DEFAULT`（端口窗起点），异步路径下继续端口窗健康探测。
 *
 * 两个入口，按消费方需要取：
 * - `resolveDaemonEndpointSync()`：**同步**快路径（查询参数 → env → 缺省起点），不探测——
 *   给「创建端口时就要一个字符串」的消费方（AI / MCP / 出图 / 诊断 / 设置 / 市场 / 画布工作室）；
 *   刻意**不缓存**（纯函数；读了什么就是什么，测试与会话切换无残留）。
 * - `resolveDaemonEndpoint()`：**异步**完整路径（探测 4318..4350，命中即止，进程内缓存），
 *   全段不可达抛 `DaemonEndpointError('daemon_unreachable')`——给页面级取数（首页），
 *   让页面立刻进错误态并给重试，而不是等请求超时。
 *
 * 端口窗起点/宽度取自 `@dforge/contracts`（与 daemon 自身的端口纪律同源）；**端点串本身
 * 也由契约包的纯构造函数单点给出**（`daemonEndpointDefault` / `daemonEndpointForPort`）——
 * 本模块不再自拼 `http://127.0.0.1:<port>`（code-review #2：注释写「同源」实为第二份复制）。
 * 依赖方向：`features/* → lib/*` 允许；`lib/* → features/*` **禁止**（本模块不认识任何 feature）。
 *
 * 第三个入口（修复批次 4 · 工作包 B / D-3 / UX-01）：**站内跳转的端点传递**——
 * `withDaemonEndpoint(href)` 把「当前页面的 `?daemon=`」续写到站内地址上（React 侧经
 * `useDaemonEndpointHref(href)` 消费）。为什么必须单点：客户端跳转（首页卡片→编辑器、
 * 市场卡片→详情、各回跳）一旦丢了查询参数，下一页面就会回退到端口窗探测——在同源网关/
 * 非默认端口形态下整页「无法连接本地服务」（UX-01 第一手复现）。只做**查询参数形态**的传递：
 * 当前页没有 `?daemon=`（env 注入的壳/部署形态）时不追加，canonical URL 保持干净。
 */

import {
  DAEMON_PORT_BASE,
  DAEMON_PORT_MAX_OFFSET,
  daemonEndpointDefault,
  daemonEndpointForPort,
} from '@dforge/contracts';
import { useEffect, useState } from 'react';

/** daemon 缺省端点（端口纪律的起点，本机回环；端点串由契约包单点构造）。 */
export const DAEMON_ENDPOINT_DEFAULT = daemonEndpointDefault();

/** 单个候选端点的健康探测超时（毫秒；本地回环，超时即视为不在）。 */
export const DAEMON_PROBE_TIMEOUT_MS = 400;

/** 探测并发批大小（端口窗分 6 批，最坏 ~2.4s 出结论；一次打满只会白占端口）。 */
export const DAEMON_PROBE_BATCH_SIZE = 6;

/** 解析失败（全段不可达）。`code` 与各消费方的错误码口径对齐（页面据此进错误态）。 */
export class DaemonEndpointError extends Error {
  readonly code = 'daemon_unreachable';

  constructor(message: string) {
    super(message);
    this.name = 'DaemonEndpointError';
  }
}

/** 解析选项（`envUrl`/`search` 显式给出时跳过环境/窗口读取，便于测试与宿主注入）。 */
export interface DaemonEndpointOptions {
  /** 注入的 fetch（测试用；缺省用全局 fetch）。 */
  fetchImpl?: typeof fetch;
  /**
   * 环境变量覆盖：**给出属性**（含显式 `undefined`）即以它为准、不再读 `process.env`——
   * 宿主（Electron/门禁）与测试要「明确不要 env」时靠这个区分「没给」与「给了空」。
   */
  envUrl?: string | undefined;
  /** 显式查询串（缺省读 `window.location.search`；服务端无 window 时视为无查询串）。 */
  search?: string | undefined;
}

/** 去掉尾部斜杠（拼路径时避免双斜杠）。 */
function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** 归一一个候选串：空白/空串视为未给；命中则去尾斜杠。 */
function normalizeCandidate(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimTrailingSlash(trimmed);
}

/**
 * 环境变量取值。
 *
 * 为什么写 `process.env.NEXT_PUBLIC_DF_DAEMON_URL` 这个**静态成员表达式**（而不是把
 * `process.env` 整个传进来）：Next 只在构建期内联字面量形式的 `NEXT_PUBLIC_*` 访问，
 * 动态取键在浏览器里拿不到值（会静默回落缺省端口）。**全仓仅此一处**读取该变量。
 */
function envEndpoint(options: DaemonEndpointOptions): string | undefined {
  const raw = 'envUrl' in options ? options.envUrl : process.env.NEXT_PUBLIC_DF_DAEMON_URL;
  return normalizeCandidate(raw);
}

/** daemon 端点查询参数的键名（读取与站内传递共用同一处定义）。 */
export const DAEMON_ENDPOINT_QUERY_KEY = 'daemon';

/** 从查询串取显式端点（`?daemon=`）。 */
function searchEndpoint(options: DaemonEndpointOptions): string | undefined {
  const search =
    options.search ?? (typeof window === 'undefined' ? undefined : window.location.search);
  if (typeof search !== 'string' || search === '') return undefined;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return normalizeCandidate(params.get(DAEMON_ENDPOINT_QUERY_KEY));
}

/** 同步解析（查询参数 → env → 缺省起点；不探测、不缓存）。 */
export function resolveDaemonEndpointSync(options: DaemonEndpointOptions = {}): string {
  return searchEndpoint(options) ?? envEndpoint(options) ?? DAEMON_ENDPOINT_DEFAULT;
}

/**
 * 端点值是否可以传播（http/https 绝对地址）。
 *
 * 为什么不照搬 `normalizeCandidate` 的宽容口径：解析端的「显式值原样使用」是门禁/调试的
 * 逃生口（`?daemon=…` 写错了当场暴露），而**传播**是把值带给后续页面——垃圾值（相对串、
 * `javascript:` 等）不该被续写进更多 URL；非法即不传播，下一页面退回本模块的正常解析顺序。
 */
function isPropagatableEndpoint(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** 当前页面的端点参数值（**仅**查询参数形态；无参/空白/非法 → null）。 */
function currentEndpointParam(options: DaemonEndpointOptions): string | null {
  const value = searchEndpoint(options);
  if (value === undefined || !isPropagatableEndpoint(value)) return null;
  return value;
}

/** 站内地址（应用内相对路径；`//host` 协议相对地址算站外）。 */
function isInternalHref(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

/**
 * 站内跳转地址 + 当前页面的 daemon 端点参数（D-3 / UX-01）。
 *
 * 规则（外部可观测行为；`daemon-endpoint.test.ts` 是可执行规范）：
 * - 当前页带合法 `?daemon=` → 续写到站内地址（`?`/`&` 按需选分隔符；已有同名参数则覆盖，
 *   幂等——重复调用结果一致）；当前页没有（或值非法）→ **原样返回**（canonical URL 干净）；
 * - **只动 `daemon` 这一个参数**：其余查询串与转义逐字保留（不用 `URLSearchParams` 重建
 *   整串——它会把 `%20` 规范化成 `+`，改变既有地址的字节形态）；
 * - 保留 `#hash`（参数插在 hash 之前）；站外地址（绝对 URL、`//host`、`#anchor`）一律不改
 *   ——不把本地端点泄到站外，也不给外部链接添参数。
 */
export function withDaemonEndpoint(href: string, options: DaemonEndpointOptions = {}): string {
  const endpoint = currentEndpointParam(options);
  if (endpoint === null || !isInternalHref(href)) return href;

  const hashAt = href.indexOf('#');
  const hash = hashAt === -1 ? '' : href.slice(hashAt);
  const base = hashAt === -1 ? href : href.slice(0, hashAt);
  const assignment = `${DAEMON_ENDPOINT_QUERY_KEY}=${encodeURIComponent(endpoint)}`;

  // 同名参数已在地址里 → 就地替换（幂等）；否则按「已有查询串 → &，否则 ?」追加
  const existing = new RegExp(`(^|[?&])${DAEMON_ENDPOINT_QUERY_KEY}=[^&#]*`);
  if (existing.test(base)) {
    return `${base.replace(existing, `$1${assignment}`)}${hash}`;
  }
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}${assignment}${hash}`;
}

/**
 * `withDaemonEndpoint` 的 React 绑定：返回**渲染期安全**的地址。
 *
 * 首帧返回基址（与 SSR 输出逐字一致——客户端组件在 App Router 里也会被服务端预渲染，
 * 渲染期直接读 `window.location` 会造成 hydration 属性不一致），挂载后经 effect 补上端点
 * 参数。消费方：`<a href>` 这类进标记的地址（卡片、回首页链接）；只走事件回调的跳转
 * （`router.push` / `location.assign`）直接在回调里调纯函数，不需要本 hook。
 */
export function useDaemonEndpointHref(href: string): string {
  const [resolved, setResolved] = useState(href);
  useEffect(() => {
    setResolved(withDaemonEndpoint(href));
  }, [href]);
  return resolved;
}

/** 端口窗候选（顺序 = 探测顺序：起点 → 起点 + 上限偏移；端点串由契约包单点构造）。 */
export function daemonEndpointCandidates(): string[] {
  const candidates: string[] = [];
  for (let offset = 0; offset <= DAEMON_PORT_MAX_OFFSET; offset += 1) {
    candidates.push(daemonEndpointForPort(DAEMON_PORT_BASE + offset));
  }
  return candidates;
}

/** 进程内缓存（同一会话只探一次；`resetDaemonEndpointCache` 供测试复位）。 */
let cachedEndpoint: string | null = null;

/** 复位探测缓存（测试用；生产会话内不需要）。 */
export function resetDaemonEndpointCache(): void {
  cachedEndpoint = null;
}

/** 单个候选是否活着（/health 200）。 */
async function isDaemonAlive(endpoint: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(`${endpoint}/health`, {
      signal: AbortSignal.timeout(DAEMON_PROBE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** 异步解析（查询参数 → env → 端口窗探测；结果缓存；不可达抛 `DaemonEndpointError`）。 */
export async function resolveDaemonEndpoint(options: DaemonEndpointOptions = {}): Promise<string> {
  if (cachedEndpoint !== null) return cachedEndpoint;

  const explicit = searchEndpoint(options) ?? envEndpoint(options);
  if (explicit !== undefined) {
    cachedEndpoint = explicit;
    return explicit;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const candidates = daemonEndpointCandidates();

  // 快路径：绝大多数会话 daemon 就在端口窗起点（命中即止，只探一次）
  const first = candidates[0];
  if (first !== undefined && (await isDaemonAlive(first, fetchImpl))) {
    cachedEndpoint = first;
    return first;
  }

  // 漂移路径：其余候选分批并行（批内并发、批间串行，避免一次性打满整个端口窗）
  const rest = candidates.slice(1);
  for (let start = 0; start < rest.length; start += DAEMON_PROBE_BATCH_SIZE) {
    const batch = rest.slice(start, start + DAEMON_PROBE_BATCH_SIZE);
    const probeResults = await Promise.all(
      batch.map(async (candidate) => ({
        candidate,
        alive: await isDaemonAlive(candidate, fetchImpl),
      })),
    );
    // 批内并发结果顺序不稳定：按候选端口顺序复检，保证命中确定性
    const hit = batch.find(
      (candidate) => probeResults.find((result) => result.candidate === candidate)?.alive === true,
    );
    if (hit !== undefined) {
      cachedEndpoint = hit;
      return hit;
    }
  }

  throw new DaemonEndpointError(
    `本地服务不可达：已探测端口 ${String(DAEMON_PORT_BASE)}–${String(
      DAEMON_PORT_BASE + DAEMON_PORT_MAX_OFFSET,
    )}，请确认 daemon 已启动。`,
  );
}
