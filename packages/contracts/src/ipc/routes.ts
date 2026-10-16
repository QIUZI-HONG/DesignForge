/**
 * @dforge/contracts · daemon 路由表（路径与方法的唯一真源）。
 *
 * 前端票（FE-02/03/06/08/09/10/11）直接引用本表拼 URL，避免路径字符串各写一份导致漂移；
 * 新增路由必须在此登记，daemon 侧用例与 routes 用例双向断言存在性。
 */

/** 单条路由的传输元数据。 */
export interface DaemonRouteSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** 路由模板；`:` 前缀段为路径参数（需 encodeURIComponent 后拼入）。 */
  path: string;
}

/** daemon 本段全量路由（键名即用途，供前端按需取）。 */
export const DAEMON_ROUTES = {
  health: { method: 'GET', path: '/health' },
  config: { method: 'GET', path: '/config' },
  configUpdate: { method: 'PUT', path: '/config' },
  configCredentialsSet: { method: 'PUT', path: '/config/credentials' },
  configCredentialsClear: { method: 'DELETE', path: '/config/credentials' },
  configConnectivity: { method: 'POST', path: '/config/connectivity' },
  documents: { method: 'GET', path: '/documents' },
  documentCreate: { method: 'POST', path: '/documents' },
  documentGet: { method: 'GET', path: '/documents/:documentId' },
  documentRename: { method: 'PATCH', path: '/documents/:documentId' },
  documentDelete: { method: 'DELETE', path: '/documents/:documentId' },
  documentPageCreate: { method: 'POST', path: '/documents/:documentId/pages' },
  documentPageGet: { method: 'GET', path: '/documents/:documentId/pages/:pageId' },
  documentPageSave: { method: 'PUT', path: '/documents/:documentId/pages/:pageId' },
  documentPageDelete: { method: 'DELETE', path: '/documents/:documentId/pages/:pageId' },
  exportDocument: { method: 'POST', path: '/export' },
  aiStatus: { method: 'GET', path: '/ai/status' },
  aiChat: { method: 'POST', path: '/ai/chat' },
  imageProbe: { method: 'GET', path: '/image/probe' },
  imageTemplates: { method: 'GET', path: '/image/templates' },
  imageRunsCreate: { method: 'POST', path: '/image/runs' },
  imageRunsList: { method: 'GET', path: '/image/runs' },
  imageRunGet: { method: 'GET', path: '/image/runs/:runId' },
  imageRunCancel: { method: 'POST', path: '/image/runs/:runId/cancel' },
  marketQuery: { method: 'GET', path: '/market/query' },
  marketAsset: { method: 'GET', path: '/market/assets/:assetId' },
  marketLoadPlan: { method: 'POST', path: '/market/load-plan' },
  mcpPropose: { method: 'POST', path: '/mcp/proposals' },
  mcpAck: { method: 'POST', path: '/mcp/ack' },
  mcpAudit: { method: 'GET', path: '/mcp/audit' },
  telemetryAppend: { method: 'POST', path: '/telemetry/events' },
  telemetryQuery: { method: 'GET', path: '/telemetry/events' },
  telemetryClear: { method: 'DELETE', path: '/telemetry/events' },
} as const satisfies Record<string, DaemonRouteSpec>;

/** 路由键名联合类型。 */
export type DaemonRouteKey = keyof typeof DAEMON_ROUTES;

/** daemon 监听端口探测起点（占用则 +1，上限起点 +32）。 */
export const DAEMON_PORT_BASE = 4318;

/** daemon 监听端口探测上限偏移。 */
export const DAEMON_PORT_MAX_OFFSET = 32;

/**
 * 本机回环 daemon 端点（纯构造，无副作用；端口纪律只允许 127.0.0.1）。
 *
 * 为什么放在契约包：CLI（`tools/cli/src/config/daemon.ts`）与 web 单点模块
 * （`apps/web/src/lib/daemon-endpoint.ts`，ADR-0004 ①）都要构造端点串——此前各自
 * 自拼 `http://127.0.0.1:${DAEMON_PORT_BASE}`（注释写「同源」实为第二份复制，code-review #2）。
 * 这里给出**唯一构造点**：与端口常量同处一地，改端口纪律只改这一行。
 */
export function daemonEndpointForPort(port: number): string {
  return `http://127.0.0.1:${String(port)}`;
}

/** 缺省 daemon 端点（端口纪律起点；消费方不得再自拼第二份）。 */
export function daemonEndpointDefault(): string {
  return daemonEndpointForPort(DAEMON_PORT_BASE);
}
