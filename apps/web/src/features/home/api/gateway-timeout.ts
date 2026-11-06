/**
 * 网关请求统一超时归一（修复批次 3 · 工作包 C；规格用户故事 7）。
 *
 * 为什么需要这一层：daemon 是本机进程，正常往返在毫秒级；一旦它「活着但不响应」
 * （进程卡死、端口被占却不收发、宿主网络栈黑洞），`fetch` 会**永久 pending**——
 * 界面停在骨架 / loading 上，用户既没有错误也没有重试入口。统一上限把这种情况
 * 变成**有界的失败**，由各客户端归一到自己的稳定错误码。
 *
 * 机制单点（audit-d04 · D-04）：race + abort 的实现已下沉到 `lib/request-timeout`
 * （保存链写路径 30s 同用一份机制），本模块只保留读路径的常量、哨兵错误与委托——
 * 不得再另写第二份 abort+race。
 *
 * 口径（首页数据面一致，勿各自另立）：
 * - 上限是**模块常量** {@link GATEWAY_TIMEOUT_MS}，可经各客户端的 `timeoutMs` 选项注入
 *   （测试用小值，不真等 3s；生产走缺省）；
 * - 到点做两件事：① `AbortController.abort()` 取消在飞请求（真实 fetch 据此释放连接，
 *   不留悬挂 socket）；② 抛出哨兵 {@link GatewayTimeoutError}，由调用方归一
 *   （文档网关 → `DocumentApiError('daemon_timeout')`；市场检索 → `available:false`）；
 * - 首页市场检索的 3s 兜底与 {@link GATEWAY_TIMEOUT_MS} **同源**（见 `components/HomeView`）
 *   ——一个数字一处声明，不得另写第二份。
 *
 * 为什么超时与被拒要分开：不可达（连接被拒/网络错）说明 daemon 没在跑，引导是「启动」；
 * 超时说明 daemon 在跑但不回，引导是「重试 / 排查阻塞」——两类失败的恢复动作不同，
 * 界面用错误码区分（{@link describeApiErrorCode} 的展示码挂点）。
 */

import { t } from '@/i18n';
import { fetchWithinDeadline } from '@/lib/request-timeout';

/** 统一超时上限（毫秒）。
 *
 * 取值 3s：本机回环的 daemon 若 3 秒还不回应，等下去也不会自己好；同时该数字在
 * daemon 端口窗健康探测的最坏耗时（~2.4s，见 `lib/daemon-endpoint`）之上，
 * 不会把「正在探测」误报成超时。首页市场检索的既有 3s 兜底与本常量同源。
 */
export const GATEWAY_TIMEOUT_MS = 3000;

/** 超时哨兵错误（不带错误码：由各客户端归一到自己的错误类型与码）。
 *
 * 消息面向用户（经错误态原样展示）：说清「等到了上限」而不说「连不上」——
 * 后者会误导用户去启动一个其实已在运行的 daemon。
 *
 * 文案经 i18n 目录（键 `home.error.daemonTimeout`，code-review #5）：本模块属数据面，
 * 但这条消息会被 `HomeView` 直渲染（`DocumentApiError.message` → 错误态 description），
 * 故取目录而不是硬编码中文；改文案只改 `apps/web/messages/*.json`。
 */
export class GatewayTimeoutError extends Error {
  /** 触发的上限（毫秒；诊断用）。 */
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(t('home.error.daemonTimeout', { ms: timeoutMs }));
    this.name = 'GatewayTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * 发一个有界的请求：到 `timeoutMs` 未落定即 abort 在飞请求并抛
 * {@link GatewayTimeoutError}；fetch 自身的异常（网络错/被拒）原样抛出，
 * 由调用方归一到各自的错误码。
 *
 * 实现委托 `lib/request-timeout` 的 {@link fetchWithinDeadline}（机制单点，
 * race 对 signal 的必要性论证见彼处）。
 */
export async function fetchWithinTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number = GATEWAY_TIMEOUT_MS,
): Promise<Response> {
  return fetchWithinDeadline(fetchImpl, url, init, timeoutMs, (ms) => new GatewayTimeoutError(ms));
}
