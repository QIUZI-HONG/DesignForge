/**
 * daemon 交互失败的**归类单点**（票 06 / spec P1-2：错误面中文化）。
 *
 * 缺陷现场：三面（AI 抽屉失败态 / 顶栏保存态 / 市场错误态）各自把客户端层透出的
 * 原始 message 直接拼进界面文案——daemon 不可达时浏览器 fetch 抛 `TypeError: Failed to fetch`，
 * 用户看到的是「保存失败：Failed to fetch」「无法连接本地服务：TypeError: Failed to fetch」
 * 这类裸英文技术串。
 *
 * 本模块把「失败原文 → 呈现口径」的判定收敛为一个**纯函数**（零 DOM，三面共用）：
 * - **网络层失败**（fetch/TypeError 族、超时哨兵（D-04）、网关族 5xx（D-10），各形态
 *   原文不同）→ `isNetwork: true`，错误码归一为 `DAEMON_UNREACHABLE`（与市场客户端
 *   既有归一码一致）；界面据此渲染中文人话（「无法连接本地服务——请确认 daemon 已
 *   启动」）+ 与场景匹配的下一步，原始 message 进**可折叠技术详情**（报障可引用，
 *   不再直接暴露）；
 * - **其余失败**（daemon 明确拒绝等）→ 原样透传：daemon 给的 message 本就是中文人话，
 *   技术细节由调用方的既有呈现承担。
 *
 * 判定只认两层证据（按序）：调用方给的归一码（`daemon_unreachable`）→ 失败原文的
 * 运行时特征串。不猜、不联网探测。
 */

/** 网络层失败的归一错误码（展示统一大写形态；报障可引用）。 */
export const DAEMON_UNREACHABLE_CODE = 'DAEMON_UNREACHABLE';

/** 归类结果（三面共用的呈现口径输入）。 */
export interface DaemonFailureView {
  /** 是否网络层失败（daemon 不可达——用户侧动作是「确认服务已启动」，不是改配置）。 */
  isNetwork: boolean;
  /** 错误码：网络失败归一 `DAEMON_UNREACHABLE`；其余透传调用方码（没有则 null）。 */
  code: string | null;
  /** 原始技术信息（可折叠技术详情里展示；报障可引用）。 */
  raw: string;
}

/**
 * 各运行时 fetch 失败的原文特征（不区分大小写）：
 * - `Failed to fetch`：Chromium（含 `TypeError: Failed to fetch`）；
 * - `NetworkError when attempting to fetch resource`：Firefox；
 * - `Load failed`：WebKit/Safari；
 * - `fetch failed`：Node（undici，SSR/门禁侧取数）；
 * - `请求超时`：本仓客户端超时哨兵（audit-d04 · D-04，`lib/request-timeout` 的
 *   `RequestTimeoutError` 文案族，gateway-timeout 的 `home.error.daemonTimeout` 同含
 *   此短语）——「等到了上限还没回应」与「连不上」的用户动作一致（重试），归同一族。
 */
const NETWORK_MESSAGE_PATTERNS: readonly RegExp[] = [
  /failed to fetch/i,
  /networkerror when attempting to fetch/i,
  /load failed/i,
  /fetch failed/i,
  /请求超时/,
];

/** 归类一次 daemon 交互失败（纯函数；`code` 为调用方已知的失败码，可省）。 */
export function classifyDaemonFailure(input: {
  message: string;
  code?: string | null;
}): DaemonFailureView {
  const raw = input.message;
  const code = input.code ?? null;
  const codeSaysUnreachable =
    code !== null && code.toUpperCase() === DAEMON_UNREACHABLE_CODE.toUpperCase();
  const messageSaysUnreachable = NETWORK_MESSAGE_PATTERNS.some((pattern) => pattern.test(raw));
  if (codeSaysUnreachable || messageSaysUnreachable) {
    return { isNetwork: true, code: DAEMON_UNREACHABLE_CODE, raw };
  }
  return { isNetwork: false, code, raw };
}
