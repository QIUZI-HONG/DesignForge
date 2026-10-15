/**
 * @dforge/daemon · 应用工厂（Fastify 5）。
 *
 * 组装纪律：
 * - **一切持久化路径从 dataRoot 派生**（context.ts），测试/门禁注入临时目录；
 * - 上游网络调用（DeepSeek / ComfyUI）统一走注入的 `fetchImpl`，测试以假上游记录断言；
 * - 响应形状统一（http.ts）：`{ ok, result|error }`；
 * - 凭据只在 daemon 侧解密使用，任何响应/日志不得出现明文 key。
 */

import { apiFailure, DAEMON_ROUTES } from '@dforge/contracts';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import Fastify from 'fastify';
import type { AiClient } from './ai/client.ts';
import { createAiClient } from './ai/client.ts';
import type { ConfigStore } from './config/store.ts';
import { createConfigStore } from './config/store.ts';
import type { DaemonPaths } from './context.ts';
import { DAEMON_VERSION, defaultDataRoot, resolveDaemonPaths } from './context.ts';
import type { CredentialStore } from './credentials/store.ts';
import { createCredentialStore } from './credentials/store.ts';
import type { DocumentStore } from './documents/store.ts';
import { createDocumentStore } from './documents/store.ts';
import type { ComfyClient } from './image/client.ts';
import { createComfyClient } from './image/client.ts';
import type { MarketService } from './market/service.ts';
import { createMarketService } from './market/service.ts';
import type { McpStub } from './mcp/stub.ts';
import { createMcpStub } from './mcp/stub.ts';
import { registerAiRoutes } from './routes/ai.ts';
import { registerConfigRoutes } from './routes/config.ts';
import { registerDocumentsRoutes } from './routes/documents.ts';
import { registerExportRoutes } from './routes/export.ts';
import { registerImageRoutes } from './routes/image.ts';
import { registerMarketRoutes } from './routes/market.ts';
import { registerMcpRoutes } from './routes/mcp.ts';
import { registerTelemetryRoutes } from './routes/telemetry.ts';
import type { TelemetryStore } from './telemetry/store.ts';
import { createTelemetryStore } from './telemetry/store.ts';

/** 应用构造选项（缺省全部走真实路径；测试通过注入切换）。 */
export interface DaemonAppOptions {
  /** 数据根，缺省 `~/.dforge`。 */
  dataRoot?: string;
  /** 工作目录覆盖（优先于 config.json；门禁/测试注入临时目录）。 */
  workspaceDir?: string;
  /** config.json 路径覆盖。 */
  configPath?: string;
  /** 凭据文件路径覆盖。 */
  credentialsPath?: string;
  /** 凭据主密钥路径覆盖。 */
  credentialsKeyPath?: string;
  /** 市场索引文件路径覆盖（缺省按候选路径探测）。 */
  marketIndexPath?: string;
  /** 上游 HTTP 客户端（DeepSeek / ComfyUI 共用；测试注入假实现）。 */
  fetchImpl?: typeof fetch;
  /** 环境变量 key 覆盖（缺省读 `DF_DEEPSEEK_API_KEY`；测试显式传 null 表示无）。 */
  envApiKey?: string | null;
  /** 时钟注入（测试确定性）。 */
  now?: () => Date;
  /** Fastify 日志（缺省关闭；启用时经 pino 输出 JSON 行）。 */
  logger?: FastifyServerOptions['logger'];
  /** ComfyUI 模型清单缓存 TTL（缺省 60s，架构 §7.7）。 */
  comfyProbeTtlMs?: number;
  /** AI 重试退避序列（测试即时化；缺省 [300, 900]ms，最多重试 2 次）。 */
  aiRetryDelaysMs?: number[];
}

/** 运行时上下文（路由注册共用；所有路径/存储的唯一入口）。 */
export interface DaemonContext {
  paths: DaemonPaths;
  config: ConfigStore;
  credentials: CredentialStore;
  documents: DocumentStore;
  telemetry: TelemetryStore;
  market: MarketService;
  mcp: McpStub;
  comfy: ComfyClient;
  ai: AiClient;
  fetchImpl: typeof fetch;
  now: () => Date;
  comfyProbeTtlMs: number;
  startedAt: Date;
}

/** 创建 daemon 应用（未监听；监听见 server.ts）。 */
export async function createDaemonApp(options: DaemonAppOptions = {}): Promise<FastifyInstance> {
  const dataRoot = options.dataRoot ?? defaultDataRoot();
  const paths = resolveDaemonPaths(dataRoot);

  const config = createConfigStore({
    configJsonPath: options.configPath ?? paths.configJsonPath,
    defaultWorkspaceDir: options.workspaceDir ?? paths.workspaceDirDefault,
  });
  await config.load();

  const credentials = createCredentialStore({
    credentialsPath: options.credentialsPath ?? paths.credentialsPath,
    keyFilePath: options.credentialsKeyPath ?? paths.credentialsKeyPath,
    envApiKey:
      options.envApiKey === undefined
        ? (process.env.DF_DEEPSEEK_API_KEY ?? null)
        : options.envApiKey,
  });
  await credentials.load();

  const telemetry = createTelemetryStore({
    eventsPath: paths.telemetryEventsPath,
    config,
  });
  await telemetry.load();

  const documents = createDocumentStore({ config });

  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? ((): Date => new Date());

  const context: DaemonContext = {
    paths,
    config,
    credentials,
    documents,
    telemetry,
    market: createMarketService({
      indexPath: options.marketIndexPath ?? null,
      candidatePaths: paths.marketIndexCandidates,
    }),
    mcp: createMcpStub({ auditPath: paths.mcpAuditPath }),
    // ComfyUI 客户端在读配置时取当前 baseUrl（设置页改地址立即生效）
    comfy: createComfyClient({
      baseUrl: () => config.get().comfy.baseUrl,
      installPath: () => config.get().comfy.installPath,
      fetchImpl,
      now,
      templatesPath: paths.imageTemplatesPath,
      assetsDir: paths.imageAssetsDir,
      probeTtlMs: options.comfyProbeTtlMs ?? 60_000,
    }),
    ai: createAiClient({
      resolveApiKey: () => credentials.resolveApiKey(),
      config: () => {
        const aiConfig = config.get().ai;
        return { model: aiConfig.model, baseUrl: aiConfig.baseUrl };
      },
      fetchImpl,
      ...(options.aiRetryDelaysMs === undefined ? {} : { retryDelaysMs: options.aiRetryDelaysMs }),
    }),
    fetchImpl,
    now,
    comfyProbeTtlMs: options.comfyProbeTtlMs ?? 60_000,
    startedAt: now(),
  };

  const app = Fastify({ logger: options.logger ?? false });
  registerErrorHandlers(app);

  // GET /health —— 基座握手（verify-daemon 与 FE-12 壳用它判活）
  app.get(DAEMON_ROUTES.health.path, () => ({
    ok: true,
    result: {
      name: '@dforge/daemon',
      version: DAEMON_VERSION,
      startedAt: context.startedAt.toISOString(),
      uptimeMs: context.now().getTime() - context.startedAt.getTime(),
      dataRoot: paths.dataRoot,
      workspaceDir: context.config.get().workspaceDir,
    },
  }));

  registerConfigRoutes(app, context);
  registerDocumentsRoutes(app, context);
  registerExportRoutes(app, context);
  registerAiRoutes(app, context);
  registerImageRoutes(app, context);
  registerMarketRoutes(app, context);
  registerMcpRoutes(app, context);
  registerTelemetryRoutes(app, context);

  return app;
}

/** 统一错误处理：所有失败都以 `{ ok:false, error }` 形状返回。 */
function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((rawError, _request, reply) => {
    const error = rawError as { statusCode?: number; message?: string };
    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
    const message =
      typeof error.message === 'string' ? error.message.slice(0, 300) : '未提供错误信息';
    if (statusCode >= 500) {
      reply.status(500).send(apiFailure('internal', 'daemon 内部错误', { reason: message }));
      return;
    }
    // 4xx（含 Fastify 的 JSON 解析/校验错误）统一归入 bad_request
    reply
      .status(statusCode === 404 ? 404 : 400)
      .send(
        statusCode === 404
          ? apiFailure('not_found', '资源不存在')
          : apiFailure('bad_request', message),
      );
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send(apiFailure('not_found', '路由不存在'));
  });
}
