/**
 * @dforge/cli —— CLI `df`（入口与命令表）。
 *
 * 首批子命令（《技能市场规格 v1》§2.2 口径）：`df market collect | score | index | search`，
 * 由 `./market/**` 实现（阶段 A 缺口修复 + 判据链四环）。
 * 可执行入口见 `bin/df.mjs`（Node 原生 TS 类型擦除直跑，独立于编辑器/桌面壳）。
 *
 * 退出码（规格《市场首实现》§6.1）：0 通过 / 1 断言失败 / 2 阻塞；**禁止假绿**。
 */

import { MARKET_USAGE, runMarketCli } from './market/index.ts';

/** CLI 名。 */
export const CLI_BIN_NAME = 'df' as const;

/** 首批子命令（`df market <子命令>`）。 */
export const CLI_MARKET_SUBCOMMANDS = ['collect', 'score', 'index', 'search'] as const;

export const CLI_USAGE = `df —— 设界 CLI

用法：
  df market <子命令>   市场采集线（collect | score | index | search）
  df --help            本帮助

${MARKET_USAGE}`;

export interface CliOutcome {
  command: string;
  exitCode: 0 | 1 | 2;
  summary: Record<string, unknown>;
  blockedReason: string | null;
}

/** CLI 主入口（返回退出码；打印人类可读摘要 + 末尾一行 JSON 供门禁脚本解析）。 */
export async function runCli(
  argv: readonly string[],
  log: (line: string) => void = console.log,
  err: (line: string) => void = console.error,
): Promise<number> {
  const [family, ...rest] = argv;
  if (family === undefined || family === '--help' || family === '-h' || family === 'help') {
    log(CLI_USAGE);
    return 0;
  }
  if (family !== 'market') {
    err(`未知命令：${family}（当前仅支持 market）`);
    err(CLI_USAGE);
    return 2;
  }
  try {
    const outcome = await runMarketCli(rest, log);
    if (outcome.blockedReason !== null) err(`阻塞：${outcome.blockedReason}`);
    log(
      JSON.stringify({ command: outcome.command, exitCode: outcome.exitCode, ...outcome.summary }),
    );
    return outcome.exitCode;
  } catch (error) {
    // 参数错误 → 阻塞语义（未进入可判定状态，禁止假绿）
    err(`参数错误：${error instanceof Error ? error.message : String(error)}`);
    err(MARKET_USAGE);
    return 2;
  }
}
