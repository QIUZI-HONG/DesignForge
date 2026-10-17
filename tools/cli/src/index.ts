/**
 * @dforge/cli —— CLI `df`（入口与命令表）。
 *
 * 命令族：
 * - `df market collect | score | index | search`（《技能市场规格 v1》§2.2 口径，`./market/**`）；
 * - `df config set-key --stdin | --clear`（修复批次 3 工作包 F：凭据 stdin 注入，`./config/**`）。
 * 可执行入口见 `bin/df.mjs`（Node 原生 TS 类型擦除直跑，独立于编辑器/桌面壳）。
 *
 * 退出码（规格《市场首实现》§6.1）：0 通过 / 1 断言失败 / 2 阻塞；**禁止假绿**。
 */

import { CONFIG_USAGE, runConfigCli } from './config/index.ts';
import { MARKET_USAGE, runMarketCli } from './market/index.ts';
import type { CliOutcome } from './outcome.ts';

export type { CliOutcome } from './outcome.ts';

/** CLI 名。 */
export const CLI_BIN_NAME = 'df' as const;

/** 首批子命令（`df market <子命令>`）。 */
export const CLI_MARKET_SUBCOMMANDS = ['collect', 'score', 'index', 'search'] as const;

/** 命令族（`df <族> <子命令>`）。 */
export const CLI_FAMILIES = ['market', 'config'] as const;

export const CLI_USAGE = `df —— 设界 CLI

用法：
  df market <子命令>   市场采集线（collect | score | index | search）
  df config set-key    本地凭据（--stdin 注入 / --clear 清除）
  df --help            本帮助

${MARKET_USAGE}

${CONFIG_USAGE}`;

/** 命令族执行 + 统一收口（打印人类可读摘要 + 末尾一行 JSON 供门禁脚本解析）。 */
async function dispatchFamily(
  run: (
    rest: readonly string[],
    log: (line: string) => void,
    err: (line: string) => void,
  ) => Promise<CliOutcome>,
  usage: string,
  rest: readonly string[],
  log: (line: string) => void,
  err: (line: string) => void,
): Promise<number> {
  try {
    const outcome = await run(rest, log, err);
    if (outcome.blockedReason !== null) err(`阻塞：${outcome.blockedReason}`);
    log(
      JSON.stringify({ command: outcome.command, exitCode: outcome.exitCode, ...outcome.summary }),
    );
    return outcome.exitCode;
  } catch (error) {
    // 参数错误 → 阻塞语义（未进入可判定状态，禁止假绿）
    err(`参数错误：${error instanceof Error ? error.message : String(error)}`);
    err(usage);
    return 2;
  }
}

/** CLI 主入口（返回退出码）。 */
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
  if (family === 'market') {
    return dispatchFamily((args, out) => runMarketCli(args, out), MARKET_USAGE, rest, log, err);
  }
  if (family === 'config') {
    return dispatchFamily(
      (args, out, errOut) => runConfigCli(args, out, errOut),
      CONFIG_USAGE,
      rest,
      log,
      err,
    );
  }
  err(`未知命令：${family}（当前支持 market | config）`);
  err(CLI_USAGE);
  return 2;
}
