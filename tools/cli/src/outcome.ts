/**
 * CLI 子命令分发的**统一结果形状**（`df market` / `df config` 共用；入口按它收口打印）。
 *
 * 为什么单列一个小模块（code-review #4）：`Index.CliOutcome`、`config.ConfigCliOutcome`、
 * `market.MarketCliOutcome` 曾各自逐字声明同一形状（字段漂移无编译期约束）；这里给出
 * 唯一定义，各命令族只做**具名别名**（保留各自可读名，不改变任何对外类型名）。
 *
 * 三态语义（禁止假绿）：`exitCode` 0 通过 / 1 断言失败 / 2 阻塞——`blockedReason` 非 null
 * 时入口先打「阻塞：…」再打 JSON 摘要，供门禁脚本解析。
 */
export interface CliOutcome {
  command: string;
  exitCode: 0 | 1 | 2;
  summary: Record<string, unknown>;
  blockedReason: string | null;
}
