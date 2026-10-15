#!/usr/bin/env node
/**
 * guard-mcp-contract —— MCP 契约快照守卫（预留挂点，**未实现**）。
 *
 * 用途：对跨端契约做快照比对（契约类型定义在 `@dforge/contracts`）：
 *   - MCP 工具集形状（dryRun → 一次性 ackToken → 审计，架构说明 v1.1 §4.5.4）；
 *   - daemon ↔ web ↔ CLI 的跨进程消息契约；
 *   契约漂移 = 违规（1），参照集未冻结 / 快照缺失 = 阻塞（2）。
 * 接管票：MCP 契约票（本段 MCP 确认走桩）；四守卫全量归后续期票。
 * 退出码语义：**0 = 通过 / 1 = 违规 / 2 = 阻塞（未实现，或参照集未冻结）**。
 * 说明：本脚本**不接入 CI**；接入时随契约票一并改 CI。
 */
console.error('guard-mcp-contract：未实现（后续票接入）——退出码 2 = 阻塞，禁止当作通过。');
process.exit(2);
