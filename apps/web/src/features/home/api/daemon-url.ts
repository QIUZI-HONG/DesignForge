/**
 * daemon 基址解析（FE-02 消费入口）——解析本体已**收敛**到 `@/lib/daemon-endpoint`
 * （ADR-0004 裁决 ①：全站单点，顺序 = `?daemon=` → `NEXT_PUBLIC_DF_DAEMON_URL` →
 * 端口窗探测 4318..4350）。
 *
 * 本模块只保留首页特有的两件事：
 * 1. **名字沿用**（`resolveDaemonBaseUrl` / `DAEMON_DEFAULT_URL` / `daemonBaseUrlCandidates`
 *    / `resetDaemonBaseUrlCache`），首页组件与既有测试的消费面不变；
 * 2. **错误类型归一**：收敛模块抛 `DaemonEndpointError`，而首页数据面的唯一错误类型是
 *    `DocumentApiError`（`HomeView` 按 `instanceof` 决定展示哪类恢复引导）——在此转换，
 *    让首页继续只处理一种错误类型。
 *
 * 纪律：**不得**在本文件（或任何消费方）另立端口口径；要改顺序/常量，只改收敛模块。
 */
import {
  DaemonEndpointError,
  type DaemonEndpointOptions,
  resolveDaemonEndpoint,
} from '@/lib/daemon-endpoint';

import { DocumentApiError } from './documents';

export {
  DAEMON_ENDPOINT_DEFAULT as DAEMON_DEFAULT_URL,
  type DaemonEndpointOptions as ResolveDaemonBaseUrlOptions,
  daemonEndpointCandidates as daemonBaseUrlCandidates,
  resetDaemonEndpointCache as resetDaemonBaseUrlCache,
} from '@/lib/daemon-endpoint';

/** 解析 daemon 基址（结果缓存；全段不可达抛 `DocumentApiError('daemon_unreachable')`）。 */
export async function resolveDaemonBaseUrl(options: DaemonEndpointOptions = {}): Promise<string> {
  try {
    return await resolveDaemonEndpoint(options);
  } catch (cause) {
    if (cause instanceof DaemonEndpointError) {
      throw new DocumentApiError(cause.code, cause.message);
    }
    throw cause;
  }
}
