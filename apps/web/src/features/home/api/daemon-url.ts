/**
 * daemon 基址解析（FE-02）。
 *
 * 为什么不硬编码端口：daemon 有**端口纪律**（从 4318 起 +1 探测，上限 +32，见
 * `@dforge/contracts` 的 `DAEMON_PORT_BASE/MAX_OFFSET`），前端必须能跟上这段漂移。
 *
 * 解析顺序（先到先用）：
 * 1. 显式查询参数 `?daemon=http://host:port`——开发与 e2e 的显式指向，**原样使用不探测**；
 * 2. 构建期环境变量 `NEXT_PUBLIC_DF_DAEMON_URL`（Electron 壳/部署注入）；
 * 3. 端口段健康探测（GET /health）：按批并行、命中即止，结果进程内缓存。
 *
 * 全段不可达 → 抛 `daemon_unreachable`（页面据此立刻进错误态并给重试，而不是等请求超时）。
 */
import { DAEMON_PORT_BASE, DAEMON_PORT_MAX_OFFSET } from '@dforge/contracts';

import { DocumentApiError } from './documents';

/** daemon 缺省地址（端口纪律的起点）。 */
export const DAEMON_DEFAULT_URL = `http://127.0.0.1:${String(DAEMON_PORT_BASE)}`;

/** 单个候选的健康探测超时（毫秒；本地回环，超时即视为不在）。 */
const PROBE_TIMEOUT_MS = 400;

/** 探测并发批大小（33 个候选分 6 批，最坏 ~2.4s 出结论）。 */
const PROBE_BATCH_SIZE = 6;

/** 进程内缓存（同一会话只探一次；`resetDaemonBaseUrlCache` 供测试复位）。 */
let cachedBaseUrl: string | null = null;

/** 去掉尾部斜杠（拼路径时避免双斜杠）。 */
function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/** 端口段候选（顺序 = 探测顺序）。 */
export function daemonBaseUrlCandidates(): string[] {
  const candidates: string[] = [];
  for (let offset = 0; offset <= DAEMON_PORT_MAX_OFFSET; offset += 1) {
    candidates.push(`http://127.0.0.1:${String(DAEMON_PORT_BASE + offset)}`);
  }
  return candidates;
}

/** 复位缓存（测试用；生产会话内不需要）。 */
export function resetDaemonBaseUrlCache(): void {
  cachedBaseUrl = null;
}

/** 从查询串里取显式 daemon 地址。 */
function daemonUrlFromSearch(search: string | undefined): string | null {
  if (search === undefined || search === '') return null;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const value = params.get('daemon');
  return value === null || value.trim() === '' ? null : trimTrailingSlash(value.trim());
}

/** 单个候选是否活着（/health 200）。 */
async function isDaemonAlive(baseUrl: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** 解析选项（`envUrl`/`search` 显式给出时跳过环境读取，便于测试）。 */
export interface ResolveDaemonBaseUrlOptions {
  /** 注入的 fetch（测试用）。 */
  fetchImpl?: typeof fetch;
  /** 构建期环境变量覆盖（缺省读 `NEXT_PUBLIC_DF_DAEMON_URL`）。 */
  envUrl?: string | undefined;
  /** 查询串（缺省读 `window.location.search`）。 */
  search?: string;
}

/** 解析 daemon 基址（结果缓存；不可达抛 `daemon_unreachable`）。 */
export async function resolveDaemonBaseUrl(
  options: ResolveDaemonBaseUrlOptions = {},
): Promise<string> {
  if (cachedBaseUrl !== null) return cachedBaseUrl;

  const fromSearch = daemonUrlFromSearch(
    options.search ?? (typeof window === 'undefined' ? undefined : window.location.search),
  );
  if (fromSearch !== null) {
    cachedBaseUrl = fromSearch;
    return fromSearch;
  }

  const envUrl =
    options.envUrl ?? process.env.NEXT_PUBLIC_DF_DAEMON_URL ?? undefined;
  if (envUrl !== undefined && envUrl.trim() !== '') {
    const normalized = trimTrailingSlash(envUrl.trim());
    cachedBaseUrl = normalized;
    return normalized;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const candidates = daemonBaseUrlCandidates();

  // 快路径：绝大多数会话 daemon 就在 4318（命中即止，只探一次）
  const first = candidates[0];
  if (first !== undefined && (await isDaemonAlive(first, fetchImpl))) {
    cachedBaseUrl = first;
    return first;
  }

  // 漂移路径：其余候选分批并行（批内并发、批间串行，避免一次性打 33 个端口）
  const rest = candidates.slice(1);
  for (let start = 0; start < rest.length; start += PROBE_BATCH_SIZE) {
    const batch = rest.slice(start, start + PROBE_BATCH_SIZE);
    const probeResults = await Promise.all(
      batch.map(async (candidate) => ({
        candidate,
        alive: await isDaemonAlive(candidate, fetchImpl),
      })),
    );
    // 批内并发结果顺序不稳定：按候选端口顺序复检，保证命中确定性
    const hit = batch.find(
      (candidate) => probeResults.find((result) => result.candidate === candidate)?.alive === true,
    );
    if (hit !== undefined) {
      cachedBaseUrl = hit;
      return hit;
    }
  }

  throw new DocumentApiError(
    'daemon_unreachable',
    `本地服务不可达：已探测端口 ${String(DAEMON_PORT_BASE)}–${String(
      DAEMON_PORT_BASE + DAEMON_PORT_MAX_OFFSET,
    )}，请确认 daemon 已启动。`,
  );
}
