/**
 * `df config` 子命令分发（工作包 F · 凭据 stdin 注入）。
 *
 * 动机（修复批次 3 规格）：验收中实际发生 API key 经非受控渠道（聊天）流转——
 * 需要一条**顺手且安全**的注入通道：key 只从标准输入进（不进 argv / shell 历史）、
 * 不回显、经既有凭据接口（`PUT /config/credentials`，daemon 侧 0600 加密落库）送达，
 * 输出只打掩码摘要（如 `sk-…0zzz`）。
 *
 * 用法与退出码（与 `df market` 同款三态语义）：
 * ```
 * df config set-key --stdin [--daemon <url>]
 * df config set-key --clear [--daemon <url>]
 * ```
 * `0` 成功 / `1` 断言失败（本命令无断言面）/ `2` 阻塞（参数错误、daemon 不可达、凭据被拒）。
 *
 * 安全纪律：明文 key 只存在于本命令调用栈内；错误路径只回传 daemon 的结构化文案
 * （daemon 侧已保证不含明文），任何分支都不得把 stdin 内容写进输出。
 */

import type { Readable } from 'node:stream';

import {
  type CredentialClearResponse,
  type CredentialSetResponse,
  type CredentialSummary,
  DAEMON_ROUTES,
} from '@dforge/contracts';

import { CliUsageError, parseArgv } from '../market/args.ts';
import { CLI_DAEMON_DEFAULT_URL, requestDaemon, resolveDaemonBaseUrl } from './daemon.ts';

export const CONFIG_USAGE = `df config —— 本地凭据（DeepSeek API key；工作包 F）

用法：
  df config set-key --stdin   从标准输入读 key 并写入本地凭据库（不回显）
  df config set-key --clear   清除本地凭据库中的 key（AI 随即进入降级态）
  df config --help            本帮助

选项：
  --stdin               从标准输入读取 key（管道/重定向均可；推荐 echo -n 'sk-…' | … ——
                        key 不落 shell 历史，也无需经聊天等非受控渠道传递）
  --clear               清除本地凭据库中的 key（环境变量来源不受影响）
  --daemon <url>        本地服务基址（缺省 NEXT_PUBLIC_DF_DAEMON_URL 或 ${CLI_DAEMON_DEFAULT_URL}）

安全：key 经内存直达本机 daemon（AES-256-GCM 落库 0600）；不带 argv 传 key、不回显、
      不落日志；输出只含掩码摘要（形如 sk-…abcd）。
退出码：0 成功 / 2 阻塞（参数错误、daemon 不可达、凭据被拒）。`;

/** 子命令分发结果（与 `df market` 的 outcome 形状一致，供入口统一打印）。 */
export interface ConfigCliOutcome {
  command: string;
  exitCode: 0 | 1 | 2;
  summary: Record<string, unknown>;
  blockedReason: string | null;
}

/** stdin 的消费面（TTY 时经 `setRawMode` 关回显；测试可注入假流）。 */
export interface CliStdin extends Readable {
  readonly isTTY?: boolean;
  setRawMode?: (mode: boolean) => void;
}

/**
 * 读 stdin 的 key，直到一行/EOF（本命令唯一的输入通道）。
 *
 * 两态：
 * - 管道/重定向（非 TTY，即 `--stdin` 的主用法）：读完即取，天然不回显；
 * - **TTY（交互直跑）**：关终端回显（raw 模式）逐字符读一行——key 不打屏、不进 shell 历史；
 *   回车确认、Ctrl+C 取消、退格可改；提示与结束换行走 stderr（stdout 保持机器可读）。
 */
async function readKeyFromStdin(stream: CliStdin, err: (line: string) => void): Promise<string> {
  const interactive = stream.isTTY === true && typeof stream.setRawMode === 'function';
  stream.setEncoding('utf8');

  if (!interactive) {
    let raw = '';
    for await (const chunk of stream) raw += String(chunk);
    return raw.trim();
  }

  err('请输入 DeepSeek API key（输入不回显；回车确认，Ctrl+C 取消）：');
  stream.setRawMode?.(true);
  stream.resume();
  let raw = '';
  try {
    for await (const chunk of stream) {
      for (const char of String(chunk)) {
        if (char === '\r' || char === '\n') {
          err('');
          return raw;
        }
        if (char === '\u0003') throw new CliUsageError('已取消（Ctrl+C）');
        if (char === '\u007f' || char === '\b') {
          raw = raw.slice(0, -1);
          continue;
        }
        raw += char;
      }
    }
    return raw;
  } finally {
    stream.setRawMode?.(false);
  }
}

/** 掩码摘要 → 机器可读输出字段（daemon 摘要即掩码，明文不可能经过这里）。 */
function summaryFields(summary: CredentialSummary): Record<string, unknown> {
  return {
    provider: summary.provider,
    hasKey: summary.hasKey,
    maskedKey: summary.maskedKey,
    source: summary.source,
    updatedAt: summary.updatedAt,
  };
}

/** 执行 `df config <子命令>`（argv 不含 `config`）。 */
export async function runConfigCli(
  argv: readonly string[],
  log: (line: string) => void = console.log,
  err: (line: string) => void = console.error,
  stdin: CliStdin = process.stdin,
): Promise<ConfigCliOutcome> {
  const sub = argv[0] ?? 'help';
  const rest = argv.slice(1);

  if (sub === 'help' || sub === '--help' || sub === '-h') {
    log(CONFIG_USAGE);
    return { command: 'config help', exitCode: 0, summary: {}, blockedReason: null };
  }
  if (sub !== 'set-key') {
    throw new CliUsageError(`未知子命令：config ${sub}（支持 set-key）`);
  }

  const parsed = parseArgv(rest, { value: ['daemon'], flags: ['stdin', 'clear'] });
  if (parsed.help) {
    log(CONFIG_USAGE);
    return { command: 'config set-key', exitCode: 0, summary: {}, blockedReason: null };
  }
  const useStdin = parsed.flag('stdin');
  const useClear = parsed.flag('clear');
  if (useStdin === useClear) {
    throw new CliUsageError(
      'set-key 需恰给其一：--stdin（管道注入）或 --clear（清除本地 key）；' +
        'argv 直接传 key 会进 shell 历史，本命令刻意不支持',
    );
  }

  const baseUrl = resolveDaemonBaseUrl(parsed.value('daemon'));

  if (useClear) {
    const result = await requestDaemon<CredentialClearResponse>(
      baseUrl,
      DAEMON_ROUTES.configCredentialsClear,
    );
    if (!result.ok) {
      return {
        command: 'config set-key',
        exitCode: 2,
        summary: { daemon: baseUrl, error: result.failure.message },
        blockedReason: result.failure.message,
      };
    }
    log('已清除本地 DeepSeek API key（AI 随即进入降级态；环境变量来源不受影响）');
    return {
      command: 'config set-key',
      exitCode: 0,
      summary: {
        daemon: baseUrl,
        cleared: result.value.cleared,
        ...summaryFields(result.value.summary),
      },
      blockedReason: null,
    };
  }

  const apiKey = await readKeyFromStdin(stdin, err);
  if (apiKey === '') {
    throw new CliUsageError('标准输入为空：未读到 API key');
  }

  const result = await requestDaemon<CredentialSetResponse>(
    baseUrl,
    DAEMON_ROUTES.configCredentialsSet,
    { apiKey },
  );
  if (!result.ok) {
    return {
      command: 'config set-key',
      exitCode: 2,
      summary: { daemon: baseUrl, error: result.failure.message },
      blockedReason: result.failure.message,
    };
  }

  const summary = result.value.summary;
  const sourceLabel = summary.source === 'env' ? '环境变量（优先，只读）' : '本地凭据库';
  log(`已写入 DeepSeek API key（掩码：${summary.maskedKey ?? 'sk-…'}，来源：${sourceLabel}）`);
  return {
    command: 'config set-key',
    exitCode: 0,
    summary: { daemon: baseUrl, ...summaryFields(summary) },
    blockedReason: null,
  };
}
