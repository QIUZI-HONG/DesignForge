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

/** 计时句柄（内部）：合并 signal、超时哨兵与可撤销的计时器。 */
interface Deadline {
  /** 合并后的信号（超时 / 调用方取消都会 abort；reason 区分两者）。 */
  signal: AbortSignal;
  /** 计时到点后必然落定的 promise（拒绝超时哨兵）。 */
  timeout: Promise<never>;
  /** 是否已因到上限被 abort（正文读取据此区分超时与调用方取消）。 */
  timedOut: () => boolean;
  /** 撤掉计时器与调用方监听（请求生命周期结束必须调用）。 */
  dispose: () => void;
}

/**
 * 建立计时句柄：调用方 signal 与上限计时**合并**到同一控制器（任一触发都 abort）。
 * 不合并会让 `{...init, signal}` 覆盖掉调用方信号——取消语义静默失效。
 */
function startDeadline(
  timeoutMs: number,
  external: AbortSignal | undefined,
  toTimeoutError: (timeoutMs: number) => Error,
): Deadline {
  const controller = new AbortController();
  const abortFromExternal = (): void => {
    controller.abort(external?.reason);
  };
  if (external !== undefined) {
    if (external.aborted) abortFromExternal();
    else external.addEventListener('abort', abortFromExternal, { once: true });
  }
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = toTimeoutError(timeoutMs);
      timedOut = true;
      reject(error); // 先 reject（race 立即落定），再取消在飞请求（正文读取据 reason 判定）
      controller.abort(error);
    }, timeoutMs);
  });
  // 总预算语义下 race 可能先于计时器落定（如正文已读完但 dispose 前计时器到点）；
  // 迟到的拒绝必须有消费者，否则会成为 unhandled rejection。
  timeout.catch(() => undefined);
  return {
    signal: controller.signal,
    timeout,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer); // 已落定就撤掉上限计时（别让计时器吊着事件循环）
      external?.removeEventListener('abort', abortFromExternal);
    },
  };
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
 * 界到哪里为止（headers 语义）：只界到「响应头落定」（fetch 本身）——正文慢速滴流
 * 不在本机制界内（流式请求由消费方按需取消）。需要连正文一起界的一元请求用
 * {@link fetchWithinTotalDeadline}。
 */
export async function fetchWithinDeadline(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  toTimeoutError: (timeoutMs: number) => Error,
): Promise<Response> {
  const deadline = startDeadline(timeoutMs, init.signal ?? undefined, toTimeoutError);
  try {
    return await Promise.race([
      fetchImpl(url, { ...init, signal: deadline.signal }),
      deadline.timeout,
    ]);
  } finally {
    deadline.dispose();
  }
}

/** 总预算请求句柄：计时器在响应头到达后**不撤销**，继续界正文读取。 */
export interface TotalDeadlineResponse {
  /** 已落定的响应（正文尚未读取）。 */
  response: Response;
  /** 合并信号（超时 / 调用方取消都会 abort，reason 区分超时哨兵与调用方原因）。 */
  signal: AbortSignal;
  /** 是否已因到上限被 abort。 */
  timedOut: () => boolean;
  /** 撤掉计时器与调用方监听（正文读取结束后必须调用）。 */
  dispose: () => void;
}

/**
 * 一元请求的总预算：一次调用（建连 + 响应头 + 正文）共用同一条上限。
 *
 * 与 {@link fetchWithinDeadline} 同一套 race + abort 机制，唯一区别是**计时器不随
 * 响应头撤销**——「头到了、正文滴流挂死」同样有界失败；调用方读正文时用返回的
 * `signal`（超时到点即 abort）取消自有 reader，读完/放弃后调用 `dispose()`。
 */
export async function fetchWithinTotalDeadline(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  toTimeoutError: (timeoutMs: number) => Error,
): Promise<TotalDeadlineResponse> {
  const deadline = startDeadline(timeoutMs, init.signal ?? undefined, toTimeoutError);
  let response: Response;
  try {
    response = await Promise.race([
      fetchImpl(url, { ...init, signal: deadline.signal }),
      deadline.timeout,
    ]);
  } catch (cause) {
    deadline.dispose();
    throw cause;
  }
  return {
    response,
    signal: deadline.signal,
    timedOut: deadline.timedOut,
    dispose: deadline.dispose,
  };
}
