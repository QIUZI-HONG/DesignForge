/**
 * @dforge/daemon · 测试脚手架（**仅测试使用**）。
 *
 * 提供：临时数据根注入、假上游 fetch（记录调用）、日志捕获。
 * 纪律：测试一律注入临时目录（不碰真实 `~/.dforge`）与假 fetch（不出网）。
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import type { DaemonAppOptions } from '../app.ts';
import { createDaemonApp } from '../app.ts';

/** 假上游调用记录。 */
export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/** 测试 daemon 句柄。 */
export interface TestDaemon {
  app: FastifyInstance;
  tempDir: string;
  dataRoot: string;
  workspaceDir: string;
  credentialsPath: string;
  capturedLogs: string[];
  fetchCalls: FetchCall[];
  cleanup(): Promise<void>;
}

/** 测试选项：fetchImpl 为假上游实现；不传则任何出网调用都会失败（防止意外触网）。 */
export interface TestDaemonOptions {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  envApiKey?: string | null;
  logger?: boolean;
  now?: () => Date;
  marketIndexPath?: string;
  aiRetryDelaysMs?: number[];
  comfyBaseUrl?: string;
  mcpAckTtlMs?: number;
}

/** 创建测试用 daemon（临时目录 + 假上游 + 日志捕获）。 */
export async function createTestDaemon(options: TestDaemonOptions = {}): Promise<TestDaemon> {
  const tempDir = await mkdtemp(join(tmpdir(), 'df-inf01-'));
  const dataRoot = join(tempDir, 'data');
  const workspaceDir = join(tempDir, 'workspace');
  const capturedLogs: string[] = [];
  const fetchCalls: FetchCall[] = [];

  const recordingFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    fetchCalls.push({
      url,
      method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
      headers: Object.fromEntries(headers.entries()),
      body: typeof init?.body === 'string' ? init.body : null,
    });
    if (options.fetchImpl === undefined) {
      throw new Error(`测试未注入假上游，禁止真实出网：${url}`);
    }
    return options.fetchImpl(url, init);
  };

  const appOptions: DaemonAppOptions = {
    dataRoot,
    workspaceDir,
    fetchImpl: recordingFetch as typeof fetch,
    envApiKey: options.envApiKey === undefined ? null : options.envApiKey,
    logger:
      options.logger === true
        ? {
            level: 'info',
            stream: {
              write: (message: string) => {
                capturedLogs.push(message);
              },
            },
          }
        : false,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.marketIndexPath === undefined ? {} : { marketIndexPath: options.marketIndexPath }),
    ...(options.aiRetryDelaysMs === undefined ? {} : { aiRetryDelaysMs: options.aiRetryDelaysMs }),
    ...(options.mcpAckTtlMs === undefined ? {} : { mcpAckTtlMs: options.mcpAckTtlMs }),
  };
  const app = await createDaemonApp(appOptions);

  // 测试默认把 ComfyUI 指向本机一个大概率不存在的端口前的配置，可按需覆盖
  if (options.comfyBaseUrl !== undefined) {
    await app.inject({
      method: 'PUT',
      url: '/config',
      payload: { comfy: { baseUrl: options.comfyBaseUrl } },
    });
  }

  return {
    app,
    tempDir,
    dataRoot,
    workspaceDir,
    credentialsPath: join(dataRoot, 'credentials.json'),
    capturedLogs,
    fetchCalls,
    async cleanup(): Promise<void> {
      await app.close();
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

/** 便捷：JSON 请求。 */
export async function injectJson(
  app: FastifyInstance,
  options: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string; payload?: unknown },
): Promise<{ statusCode: number; payload: unknown; raw: string }> {
  const response = await app.inject({
    method: options.method,
    url: options.url,
    ...(options.payload === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify(options.payload),
        }),
  });
  let payload: unknown = null;
  try {
    payload = response.json();
  } catch {
    payload = null;
  }
  return { statusCode: response.statusCode, payload, raw: response.payload };
}
