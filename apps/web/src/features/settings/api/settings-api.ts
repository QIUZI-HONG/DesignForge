/**
 * @dforge/web · 设置数据面 · 端点封装（FE-09）。
 *
 * 把 daemon 的配置 / 凭据 / 连通性 / 文档四组端点收成一组强类型函数：
 * 组件只依赖本接口（`SettingsApi`），不直接拼 URL、不碰信封形状——
 * 组件测试因此可以注入假 api（记录调用）而不起 daemon。
 *
 * 返回形状刻意「收窄」：写凭据只返回 `CredentialSummary`（掩码摘要），
 * 明文 key 不出调用栈（daemon 侧同样只回掩码，双向一致）。
 */
import {
  type ConfigResponse,
  type ConnectivityReport,
  type CredentialClearResponse,
  type CredentialSetResponse,
  type CredentialSummary,
  DAEMON_ROUTES,
  type DaemonConfigPatch,
  type DaemonHealthResponse,
  type DocumentListResponse,
  type DocumentResponse,
  type DocumentSummary,
} from '@dforge/contracts';

import { createDaemonClient, type DaemonClient } from './daemon-client';

/** 设置族数据面（组件唯一依赖的接口）。 */
export interface SettingsApi {
  /** 读当前配置 + 凭据摘要。 */
  loadConfig(): Promise<ConfigResponse>;
  /** 局部更新配置（未出现的字段保持原值）。 */
  patchConfig(patch: DaemonConfigPatch): Promise<ConfigResponse>;
  /** 写入 DeepSeek key（返回掩码摘要）。 */
  setApiKey(apiKey: string): Promise<CredentialSummary>;
  /** 清除 DeepSeek key（AI 随即降级，不报错）。 */
  clearApiKey(): Promise<CredentialSummary>;
  /** 连通性自检（daemon / ComfyUI / AI 配置；不真调云端）。 */
  checkConnectivity(): Promise<ConnectivityReport>;
  /** 握手信息（数据目录展示用：dataRoot 是「埋点与数据」分区的展示真源）。 */
  loadHealth(): Promise<DaemonHealthResponse>;
  /** 文档清单（冷启动判空）。 */
  listDocuments(): Promise<DocumentListResponse>;
  /** 新建文档（一键示例）。 */
  createDocument(name: string): Promise<DocumentSummary>;
}

/** 由客户端构造数据面（缺省用默认客户端：环境变量 baseUrl + 全局 fetch）。 */
export function createSettingsApi(client: DaemonClient = createDaemonClient()): SettingsApi {
  return {
    loadConfig: () => client.request<ConfigResponse>(DAEMON_ROUTES.config),

    patchConfig: (patch) =>
      client.request<ConfigResponse>(DAEMON_ROUTES.configUpdate, { body: patch }),

    setApiKey: async (apiKey) =>
      (
        await client.request<CredentialSetResponse>(DAEMON_ROUTES.configCredentialsSet, {
          body: { apiKey },
        })
      ).summary,

    clearApiKey: async () =>
      (await client.request<CredentialClearResponse>(DAEMON_ROUTES.configCredentialsClear)).summary,

    checkConnectivity: () => client.request<ConnectivityReport>(DAEMON_ROUTES.configConnectivity),

    loadHealth: () => client.request<DaemonHealthResponse>(DAEMON_ROUTES.health),

    listDocuments: () => client.request<DocumentListResponse>(DAEMON_ROUTES.documents),

    createDocument: async (name) =>
      (await client.request<DocumentResponse>(DAEMON_ROUTES.documentCreate, { body: { name } }))
        .document,
  };
}
