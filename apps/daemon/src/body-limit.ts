/**
 * @dforge/daemon · 请求体上限（audit-d05 · D-08）。
 *
 * 缺陷基线（perf 门禁 @5k 节点实证）：Fastify 缺省 bodyLimit=1MiB——5k 节点级文档 PUT
 * 报 `bad_request: Request body is too large`（413 被旧错误处理器折叠成 400 英文报错，
 * 用户不可读）。本模块把上限**可配置化**：
 * - env `DF_BODY_LIMIT`：`32mb` / `512kb` / 裸字节数（`33554432`）皆可，大小写不敏感；
 * - **缺省上调到 32 MB**：本机回环 + 令牌鉴权面内，请求体不是远程攻击面，但解析进内存
 *   仍需有界——32 MB 对 5k 节点文档（数 MB 级，见 documents.process 崩溃恢复用例口径）
 *   留一个数量级余量，同时挡住误用的超大写入；
 * - 非法值不阻断启动：stderr 告警 + 回退缺省（本地应用的可用性优先，配置错误要可见）。
 */

/** 缺省请求体上限：32 MB（5k 节点文档数 MB 级 + 一个数量级余量）。 */
export const DAEMON_BODY_LIMIT_DEFAULT = 32 * 1024 * 1024;

/** 配置上限（防误配置把本地进程吃穿内存）；超过按非法值回退缺省。 */
export const DAEMON_BODY_LIMIT_MAX = 1024 * 1024 * 1024;

/** `DF_BODY_LIMIT` 环境变量名。 */
export const BODY_LIMIT_ENV = 'DF_BODY_LIMIT' as const;

/**
 * 解析请求体上限值：`32mb` / `512kb` / `1gb`（大小写不敏感）或裸字节数。
 * 非法（格式错 / ≤0 / 超过 1 GB 上限）→ null（调用方回退缺省并告警）。
 */
export function parseBodyLimit(raw: string): number | null {
  const match = /^(\d+)(kb|mb|gb)?$/i.exec(raw.trim());
  if (match === null) return null;
  const value = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase();
  const factor = unit === 'kb' ? 1024 : unit === 'mb' ? 1024 * 1024 : unit === 'gb' ? 1024 ** 3 : 1;
  const bytes = value * factor;
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > DAEMON_BODY_LIMIT_MAX) return null;
  return bytes;
}

/** 上限的人话形态（错误文案与告警用）：1024 → "1 KB"、32MB → "32 MB"、非整除 → 字节数。 */
export function formatBodyLimit(bytes: number): string {
  if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)} MB`;
  if (bytes % 1024 === 0) return `${bytes / 1024} KB`;
  return `${bytes} 字节`;
}

/**
 * 从环境读请求体上限：未设置 → 缺省 32 MB；非法值 → stderr 告警 + 回退缺省
 * （配置错误必须可见，不许静默吞）。
 */
export function bodyLimitFromEnv(env: Record<string, string | undefined>): number {
  const raw = env[BODY_LIMIT_ENV];
  if (raw === undefined || raw.trim() === '') return DAEMON_BODY_LIMIT_DEFAULT;
  const parsed = parseBodyLimit(raw);
  if (parsed === null) {
    process.stderr.write(
      `[daemon] ${BODY_LIMIT_ENV} 值无效（"${raw}"）：应为 ${formatBodyLimit(DAEMON_BODY_LIMIT_MAX)} 以内的字节数或 kb/mb/gb 形式（如 32mb）——回退缺省 ${formatBodyLimit(DAEMON_BODY_LIMIT_DEFAULT)}\n`,
    );
    return DAEMON_BODY_LIMIT_DEFAULT;
  }
  return parsed;
}
