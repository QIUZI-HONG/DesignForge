/**
 * @dforge/contracts —— 设界跨进程契约唯一真源（纯类型 + 手写校验，零运行时依赖）。
 *
 * 归属裁决（见 df-charting 简报 §2）：文档模型（Design IR：文档/页面/节点/样式类型）
 * 归 `@dforge/engine`；本包只放**传输/API/市场/事件**形状——文档载荷正文以 JSON（opaque）
 * 承载 + 元数据强类型，**不反向依赖 engine**。依赖方向：contracts →（无）。
 *
 * 命名空间：
 * - `ipc/`       请求/响应信封、错误码表、路由表、基础守卫
 * - `config/`    daemon 配置、凭据摘要（掩码）、连通性自检
 * - `documents/` 文档 CRUD 载荷与 `.dfg` 目录态元数据（manifest.json）
 * - `export/`    导出请求/结果（PNG/SVG/PDF）
 * - `ai/`        AI 代理（BYOK；无 key/失败 → 与真响应同构的降级响应）
 * - `image/`     出图调度（ComfyUI；未启动/缺模型 → 结构化错误态）
 * - `market/`    df.marketplace.index/v1 类型（以 docs/spec/marketplace-spec-v1.md 为准）
 * - `mcp/`       MCP 确认桩契约（dryRun → 一次性 ackToken → 审计）
 * - `telemetry/` 本地埋点事件形状（默认仅本地）
 * - `evidence/`  验收证据 JSON 字段（对齐《前端验收标准 v1》§4）
 */

/** 包标识（供冒烟测试与契约快照校验使用）。 */
export const CONTRACTS_PACKAGE = '@dforge/contracts' as const;

export * from './ai/index.ts';
export * from './config/index.ts';
export * from './documents/index.ts';
export * from './evidence/index.ts';
export * from './export/index.ts';
export * from './image/index.ts';
export * from './ipc/index.ts';
export * from './market/index.ts';
export * from './mcp/index.ts';
export * from './telemetry/index.ts';
