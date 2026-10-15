/**
 * 市场 CLI 子命令的**统一出口形状**（判据链四条子命令共用）。
 *
 * 为什么单独成文件：collect / score / index / search 原先各自重写了一份
 * `{ exitCode, summary, blockedReason }` 接口——形状漂移无人守（改一处漏三处）。
 * 这里给出唯一真源；各命令文件保留自己的类型别名（对外名不变，内部指向本类型）。
 */

/** 门禁三态退出码（0 通过 / 1 断言失败 / 2 阻塞；禁止假绿）。 */
export type MarketExitCode = 0 | 1 | 2;

/** 子命令出口：退出码 + 摘要（证据 JSON 同源）+ 阻塞原因（exitCode=2 时必有）。 */
export interface MarketCommandOutcome {
  exitCode: MarketExitCode;
  summary: Record<string, unknown>;
  blockedReason: string | null;
}

/** 构造通过（exitCode=0、无阻塞原因）的出口对象。 */
export function ok(summary: Record<string, unknown>): MarketCommandOutcome {
  return { exitCode: 0, summary, blockedReason: null };
}

/** 构造阻塞（exitCode=2）的出口对象——阻塞必须说明原因，不留空串。 */
export function blocked(
  summary: Record<string, unknown>,
  blockedReason: string,
): MarketCommandOutcome {
  return { exitCode: 2, summary, blockedReason };
}
