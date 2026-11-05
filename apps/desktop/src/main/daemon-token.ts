/**
 * 桌面壳 · daemon 本地令牌读取与页面注入（audit-d02 · D-02）。
 *
 * daemon 缺省开启本地令牌鉴权后，壳内页面对 daemon 的每个请求都要携带 `x-df-token`。
 * 壳是本机进程（与 daemon 同用户），**读令牌文件**即合法获取路径——本机文件权限就是边界
 * （daemon 侧令牌文件 `<dataRoot>/daemon-token`，0600）。壳把它经查询串 `?dfToken=`
 * 注入装载页；web 侧单点模块（`apps/web/src/lib/daemon-endpoint.ts`）读到即持久化，
 * 后续导航/刷新不依赖 URL。
 *
 * 纪律：
 * - 令牌文件**只读**——壳绝不创建/重写（写权在 daemon；复用语义由 daemon 保证）；
 * - 文件缺失/不可读 → 返回 null，装载 URL 不添参数（页面请求会 401 并给引导——
 *   这比壳静默吞掉鉴权失败更诚实）；
 * - 查询参数键 `dfToken` 与 web 侧单点模块的定义**对齐**（两处同名常量，注释互指）。
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** daemon 令牌文件名（单源在 `apps/daemon/src/token.ts`；壳侧同名复制，跨包不引码）。 */
export const DAEMON_TOKEN_FILE_BASENAME = 'daemon-token' as const;

/** 令牌查询参数键（单源在 `apps/web/src/lib/daemon-endpoint.ts`；壳侧同名复制）。 */
export const DAEMON_TOKEN_QUERY_KEY = 'dfToken' as const;

/** 数据根解析（与 daemon 缺省口径一致：`DF_DATA_ROOT` 覆盖，否则 `~/.dforge`）。 */
export function daemonTokenPathFor(env: Record<string, string | undefined>): string {
  const dataRoot = env.DF_DATA_ROOT?.trim() || join(homedir(), '.dforge');
  return join(dataRoot, DAEMON_TOKEN_FILE_BASENAME);
}

/** 读令牌（缺失/空白/读失败 → null；只读不写）。 */
export async function readDaemonToken(
  env: Record<string, string | undefined>,
): Promise<string | null> {
  try {
    const raw = await readFile(daemonTokenPathFor(env), 'utf8');
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
  } catch {
    return null;
  }
}

/**
 * 装载 URL 追加令牌参数（已有同名参数则覆盖；保留既有查询串与 hash）。
 * 无效 URL 原样返回（loadTarget 的 URL 都由壳自己构造，此为兜底不炸装载）。
 */
export function appendTokenParam(targetUrl: string, token: string): string {
  try {
    const parsed = new URL(targetUrl);
    parsed.searchParams.set(DAEMON_TOKEN_QUERY_KEY, token);
    return parsed.toString();
  } catch {
    return targetUrl;
  }
}
