/**
 * @dforge/daemon · 启动与端口探测。
 *
 * 端口纪律（简报 §2）：从 4318 起探测，占用则 +1，上限 +32（超出即失败，不静默换随机端口——
 * 前端与证据需要可预期的端口段）。
 */

import { DAEMON_PORT_BASE, DAEMON_PORT_MAX_OFFSET } from '@dforge/contracts';
import type { FastifyInstance } from 'fastify';
import type { DaemonAppOptions } from './app.ts';
import { createDaemonApp } from './app.ts';

/** 启动选项。 */
export interface StartDaemonOptions extends DaemonAppOptions {
  host?: string;
  /** 起始端口（缺省 4318）。 */
  port?: number;
  /** 端口尝试上限偏移（缺省 +32）。 */
  maxPortOffset?: number;
}

/** 已监听的 daemon 句柄。 */
export interface RunningDaemon {
  app: FastifyInstance;
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

function isAddrInUse(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
  );
}

/** 启动 daemon（探测端口后监听；失败抛出，不吞错）。 */
export async function startDaemon(options: StartDaemonOptions = {}): Promise<RunningDaemon> {
  const app = await createDaemonApp(options);
  const host = options.host ?? '127.0.0.1';
  const basePort = options.port ?? DAEMON_PORT_BASE;
  const maxOffset = options.maxPortOffset ?? DAEMON_PORT_MAX_OFFSET;

  let lastError: unknown = null;
  for (let offset = 0; offset <= maxOffset; offset += 1) {
    const port = basePort + offset;
    try {
      await app.listen({ host, port });
      const address = app.server.address();
      const actualPort = typeof address === 'object' && address !== null ? address.port : port;
      return {
        app,
        host,
        port: actualPort,
        url: `http://${host}:${actualPort}`,
        close: async (): Promise<void> => {
          await app.close();
        },
      };
    } catch (error) {
      lastError = error;
      if (!isAddrInUse(error)) {
        await app.close();
        throw error;
      }
    }
  }
  await app.close();
  throw new Error(
    `端口 ${basePort}–${basePort + maxOffset} 全部被占用，daemon 无法启动：${String(lastError)}`,
  );
}
