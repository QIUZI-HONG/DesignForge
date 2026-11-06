/**
 * @dforge/daemon · 测试脚手架（**仅测试使用**）。
 *
 * 提供：临时数据根注入、假上游 fetch（记录调用）、日志捕获。
 * 纪律：测试一律注入临时目录（不碰真实 `~/.dforge`）与假 fetch（不出网）。
 *
 * 令牌（audit-d02 · D-02）：夹具 daemon 与生产同口径——**令牌鉴权缺省开启**，令牌经
 * `daemonToken` 注入（不写数据根的令牌文件，测试免落盘竞态），并装饰到 app 上
 * （`dfTestToken`）；`injectJson` 自动携带 `x-df-token`，存量用例零改动；要测「无令牌
 * 401」等对抗形态，用裸 `app.inject` 不带头即可。`authDisabled: true` 显式关闭（仅令牌
 * 鉴权自身的对照用例使用）。
 */

import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import type { DaemonAppOptions } from '../app.ts';
import { createDaemonApp } from '../app.ts';
import { TOKEN_FILE_BASENAME, TOKEN_HEADER } from '../token.ts';

/** injectJson 自动携带令牌所读的 app 装饰键（仅测试脚手架装饰；生产 app 无此键）。 */
declare module 'fastify' {
  interface FastifyInstance {
    dfTestToken?: string | null;
  }
}

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
  /** 本地令牌（鉴权开启时非 null；authDisabled 时为 null）。 */
  token: string | null;
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
  corsOrigins?: string[];
  allowedHosts?: string[];
  /**
   * 本地令牌覆盖：缺省自动生成随机值（测试令牌不落数据根文件）；显式 `null` 走**生产
   * 文件形态**（app 内 `ensureTokenFile` 落 `<dataRoot>/daemon-token`，句柄回读同值）。
   */
  daemonToken?: string | null;
  /** 显式关闭本地令牌鉴权（缺省开启，与生产同口径）。 */
  authDisabled?: boolean;
  /** 请求体上限覆盖（audit-d05 · D-08；缺省走 app 生产口径：env DF_BODY_LIMIT → 32 MB）。 */
  bodyLimit?: number;
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

  // 令牌：鉴权开启时给夹具一个确定令牌（显式覆盖 > 自动随机；`null` = 生产文件形态）
  const authDisabled = options.authDisabled === true;
  const tokenFromFile = options.daemonToken === null;
  const token = authDisabled
    ? null
    : tokenFromFile
      ? null
      : (options.daemonToken ?? randomBytes(32).toString('hex'));

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
    ...(options.corsOrigins === undefined ? {} : { corsOrigins: options.corsOrigins }),
    ...(options.allowedHosts === undefined ? {} : { allowedHosts: options.allowedHosts }),
    ...(token === null ? {} : { daemonToken: token }),
    authDisabled,
    ...(options.bodyLimit === undefined ? {} : { bodyLimit: options.bodyLimit }),
  };
  const app = await createDaemonApp(appOptions);

  // 生产文件形态：令牌由 app 落盘，句柄回读同值（启动时序保证文件先于监听存在）
  const resolvedToken =
    token ??
    (tokenFromFile ? (await readFile(join(dataRoot, TOKEN_FILE_BASENAME), 'utf8')).trim() : null);
  // 令牌装饰：injectJson 据此自动携带（见模块头注释）；authDisabled 时为 null 不装饰
  if (resolvedToken !== null) {
    app.decorate('dfTestToken', resolvedToken);
  }

  // 测试默认把 ComfyUI 指向本机一个大概率不存在的端口前的配置，可按需覆盖
  if (options.comfyBaseUrl !== undefined) {
    await app.inject({
      method: 'PUT',
      url: '/config',
      headers:
        resolvedToken === null
          ? { 'content-type': 'application/json' }
          : { [TOKEN_HEADER]: resolvedToken, 'content-type': 'application/json' },
      payload: JSON.stringify({ comfy: { baseUrl: options.comfyBaseUrl } }),
    });
  }

  return {
    app,
    tempDir,
    dataRoot,
    workspaceDir,
    credentialsPath: join(dataRoot, 'credentials.json'),
    token: resolvedToken,
    capturedLogs,
    fetchCalls,
    async cleanup(): Promise<void> {
      await app.close();
      // 遥测/审计是**追加式落盘**：`app.close()` 返回后仍可能有已在途的写入落在
      // `data/telemetry` 等目录里，与递归删除竞速会抛 ENOTEMPTY（CI runner 上实测：
      // export.test.ts 的 PDF 用例红于 `ENOTEMPTY: rmdir '.../data/telemetry'`）。
      // Node 的 `fs.rm` 对 EBUSY/ENOTEMPTY 一类瞬时错误内置重试——这正是它存在的场景。
      await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}

/** 便捷：JSON 请求（夹具装饰了 `dfTestToken` 时自动携带令牌头；见模块头注释）。
 *
 * `headers` 可追加自定义头（audit-d06 · D-05：`If-Match` 条件保存用例需要）——
 * 与令牌头/content-type 合并，同名时自定义头优先（调用方显式给定即最高意图）。
 */
export async function injectJson(
  app: FastifyInstance,
  options: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    payload?: unknown;
    headers?: Record<string, string>;
  },
): Promise<{ statusCode: number; payload: unknown; raw: string }> {
  const testToken = app.dfTestToken;
  const response = await app.inject({
    method: options.method,
    url: options.url,
    ...(options.payload === undefined
      ? {
          headers: {
            ...(testToken === undefined || testToken === null ? {} : { [TOKEN_HEADER]: testToken }),
            ...(options.headers ?? {}),
          },
        }
      : {
          headers: {
            'content-type': 'application/json',
            ...(testToken === undefined || testToken === null ? {} : { [TOKEN_HEADER]: testToken }),
            ...(options.headers ?? {}),
          },
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
