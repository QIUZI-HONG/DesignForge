/**
 * daemon 请求统一超时机制（audit-d04 · D-04）。
 *
 * 为什么需要第二个超时常量：`features/home/api/gateway-timeout` 的 3s 上限服务的是
 * **读路径**（首页列表 / 市场检索——本机回环毫秒级往返，3s 不回应等下去也不会好）；
 * 保存链是**写路径**（找档 / 建档 / 建页 / 逐页 PUT 正文），daemon 侧要刷盘，慢盘
 * （WSL2 IO 抖动、机械盘、实时扫描）下单请求合法耗时可以到秒级——30s 留一个数量级
 * 余量，避免慢盘误伤（audit-d04 建议值）。机制与 gateway-timeout **同源**：race + abort
 * 的实现只在本模块写一份，gateway-timeout 委托到这里，不再各自另写第二份。
 *
 * 口径：
 * - 上限是**模块常量** {@link DAEMON_REQUEST_TIMEOUT_MS}，可经各客户端的 `timeoutMs`
 *   选项注入（测试用小值，不真等 30s；生产走缺省）；**按请求计界**——一次保存由多个
 *   请求组成，每个请求各自有界，不是整次保存共享一个预算（单请求挂死即有界失败）；
 * - 到点做两件事：① `AbortController.abort()` 取消在飞请求（真实 fetch 据此释放连接，
 *   不留悬挂 socket）；② 抛出哨兵 {@link RequestTimeoutError}，由调用方归一到自己的
 *   失败形状（documents-client → `{ok:false,error}`；daemon-client →
 *   `DaemonClientError('network')`）；
 * - 超时文案经 i18n（键 `daemon.requestTimeout`）并含「请求超时」短语——
 *   `lib/daemon-failure` 据此把它归入网络族，保存态渲染统一人话失败文案（D-10 单形态），
 *   文案自带「请稍后重试」的下一步：用户重按保存即可恢复（J9 的「超时+可重试」）。
 */

import { t } from '@/i18n';

/** daemon 写路径请求统一超时上限（毫秒）。
 *
 * 取值 30s：本机回环的正常请求在毫秒级；写路径要等 daemon 刷盘，慢盘抖动下合法耗时
 * 可到秒级——30s 比它高一个数量级，误伤概率可忽略；同时远大于首页读路径的
 * {@link GATEWAY_TIMEOUT_MS}（3s），两档各服务各的路径（读快写慢），不互相借用。
 * 注入点：各客户端 `timeoutMs` 选项（测试给小值，不真等 30s）。
 */
export const DAEMON_REQUEST_TIMEOUT_MS = 30_000;

/** 请求超时哨兵错误（不带错误码：由各客户端归一到自己的失败形状）。
 *
 * 消息面向用户（会进保存态技术详情 / 设置页错误）：说清「等到了上限」而不是
 * 「连不上」——超时时 daemon 往往活着，引导错成「启动服务」会误导排查方向；
 * 「请稍后重试」给出与场景匹配的下一步（保存按钮仍在，重按即可）。
 *
 * 文案经 i18n 目录（键 `daemon.requestTimeout`，与 gateway-timeout 的
 * `home.error.daemonTimeout` 同口径）：本模块属数据面，但消息会被界面层直渲染，
 * 故取目录而不是硬编码中文；改文案只改 `apps/web/messages/*.json`。
 */
export class RequestTimeoutError extends Error {
  /** 触发的上限（毫秒；诊断用）。 */
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(t('daemon.requestTimeout', { ms: timeoutMs }));
    this.name = 'RequestTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * 发一个有界的请求：到 `timeoutMs` 未落定即 abort 在飞请求并抛
 * `toTimeoutError(timeoutMs)`；fetch 自身的异常（网络错/被拒）原样抛出，
 * 由调用方归一到各自的失败形状。
 *
 * 为什么用 `Promise.race` 而不只依赖 signal：注入的 fetch 替身（或宿主实现）
 * 可能既不看 signal 也不落定——`abort()` 单靠自己是**喂给 fetch 的请求**，
 * 不是对调用方的承诺；race 才能保证本函数自己到点必然落定。
 *
 * 界到哪里为止：只界到「响应头落定」（fetch 本身）——正文慢速滴流不在本机制界内
 * （与 gateway-timeout 同一口径；「头到了正文挂死」未在审计实证内，不为它扩面）。
 */
export async function fetchWithinDeadline(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  toTimeoutError: (timeoutMs: number) => Error,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(toTimeoutError(timeoutMs)); // 先 reject（race 立即落定），再取消在飞请求
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([fetchImpl(url, { ...init, signal: controller.signal }), timeout]);
  } finally {
    clearTimeout(timer); // 已落定就撤掉上限计时（别让计时器吊着事件循环）
  }
}
