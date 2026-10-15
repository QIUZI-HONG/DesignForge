/**
 * @dforge/daemon · 数据目录布局与运行时上下文。
 *
 * 数据根 `dataRoot` 缺省 `~/.dforge`（与凭据库同根；架构 v1.1 §5.6），
 * 测试/门禁通过参数注入临时目录——**所有持久化路径都从 DataRoot 派生**，
 * 不允许在业务代码里硬编码第二个根。
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

/** daemon 持久化路径集合（单一真源，路由与客户端只从这里取）。 */
export interface DaemonPaths {
  dataRoot: string;
  configJsonPath: string;
  credentialsPath: string;
  credentialsKeyPath: string;
  /** 工作目录缺省值（可被 config.workspaceDir 覆盖）。 */
  workspaceDirDefault: string;
  /** 市场索引候选路径（按序探测；MK-04 产物为 `ads/df.marketplace.index.v1.json`）。 */
  marketIndexCandidates: string[];
  telemetryEventsPath: string;
  mcpAuditPath: string;
  /** 导出产物落盘目录（本地优先：产物不出机）。 */
  exportsDir: string;
  /** 出图产出资产（按内容哈希命名，天然去重）。 */
  imageAssetsDir: string;
  /** workflow 模板（用户自定；缺省用内置模板）。 */
  imageTemplatesPath: string;
}

/** 从数据根派生全部路径。 */
export function resolveDaemonPaths(dataRoot: string): DaemonPaths {
  return {
    dataRoot,
    configJsonPath: join(dataRoot, 'config.json'),
    credentialsPath: join(dataRoot, 'credentials.json'),
    credentialsKeyPath: join(dataRoot, 'credentials.key'),
    workspaceDirDefault: join(dataRoot, 'workspace'),
    marketIndexCandidates: [
      join(dataRoot, 'market', 'df.marketplace.index.v1.json'),
      join(dataRoot, 'market', 'ads', 'df.marketplace.index.v1.json'),
    ],
    telemetryEventsPath: join(dataRoot, 'telemetry', 'events.jsonl'),
    mcpAuditPath: join(dataRoot, 'audit', 'mcp-audit.jsonl'),
    exportsDir: join(dataRoot, 'exports'),
    imageAssetsDir: join(dataRoot, 'image', 'assets'),
    imageTemplatesPath: join(dataRoot, 'image', 'templates.json'),
  };
}

/** 缺省数据根（`~/.dforge`）。 */
export function defaultDataRoot(): string {
  return join(homedir(), '.dforge');
}

/** daemon 包版本（与 package.json 同步维护；握手信息用）。 */
export const DAEMON_VERSION = '0.0.0' as const;
