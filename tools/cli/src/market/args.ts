/**
 * `df market *` 子命令的共享参数解析（无依赖、可单测）。
 *
 * 口径：`--flag value` 取值、`--flag` 取值（布尔）；未知选项一律报错（用法错误 → exit 2，
 * 与 MK-01/MK-02/MK-03 CLI 的退出码语义一致：禁止静默忽略参数）。
 */

/** 用法错误（参数不对，非断言失败）。 */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

export interface ArgvSpec {
  /** 需要取值的选项（`--name value`）。 */
  value?: readonly string[];
  /** 布尔开关（`--name`）。 */
  flags?: readonly string[];
}

export interface ParsedArgv {
  value: (name: string) => string | null;
  flag: (name: string) => boolean;
  /** 是否出现 `--help` / `-h`。 */
  help: boolean;
}

/** 解析 argv（不消费的命令名由调用方先行剥离）。 */
export function parseArgv(argv: readonly string[], spec: ArgvSpec): ParsedArgv {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new CliUsageError(`未知位置参数：${arg}（用法见 --help）`);
    }
    const name = arg.slice(2);
    if (spec.flags?.includes(name)) {
      flags.add(name);
      continue;
    }
    if (spec.value?.includes(name)) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new CliUsageError(`选项 --${name} 缺参数值`);
      }
      values.set(name, next);
      index += 1;
      continue;
    }
    throw new CliUsageError(`未知选项：${arg}（用法见 --help）`);
  }

  return {
    value: (name) => values.get(name) ?? null,
    flag: (name) => flags.has(name),
    help,
  };
}

/** 取正整数选项（缺省值可注入；非法即抛用法错误）。 */
export function intOption(
  parsed: ParsedArgv,
  name: string,
  fallback: number | null,
): number | null {
  const raw = parsed.value(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new CliUsageError(`--${name} 必须为正整数（实际：${raw}）`);
  }
  return value;
}

/** 取逗号分隔列表选项。 */
export function listOption(parsed: ParsedArgv, name: string): string[] | null {
  const raw = parsed.value(name);
  if (raw === null) return null;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}
