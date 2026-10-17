#!/usr/bin/env node
/**
 * guard-deps —— 依赖方向守卫（预留挂点，**未实现**）。
 *
 * 用途：断言工作区依赖方向与包边界，至少覆盖：
 *   - 依赖方向 apps → services/tools → packages，禁止反向与成环；
 *   - `@dforge/engine` 零 DOM / 零浏览器依赖（纯 TS 内核）；
 *   - `@dforge/ui` 组件「禁裸值」（一律经双基准令牌引用）。
 *
 * 预期口径（与 ADR-0004 的补记一致，接入实现时照此判定，不另立标准）：
 *   - **允许的具名例外**：`apps/daemon → services/ingest`（单一真源：daemon 的市场检索与
 *     CLI `df market search` 共用 `searchMarketIndex`，避免中文分词口径漂移；见 ADR-0004
 *     「app → services 依赖方向例外与 `./ads` 服务公开面登记」补记）——**只此一条方向例外**，
 *     其它 apps → services 引用按越界判违规；
 *   - **服务包公开面 = `package.json` 的 `exports` 子路径**：daemon 消费 ingest 只能经
 *     `@dforge/ingest/ads` 这类子路径，深导入 `services/ingest/src/**` 判违规；
 *   - 反向（packages/services → apps）与成环一律判违规（exit 1）。
 * 接管票：后续期「四守卫」票（骨架文档 §3 显式圈外，本票只预留脚本名与退出码语义）。
 * 退出码语义：**0 = 通过 / 1 = 违规 / 2 = 阻塞（未实现，或前置条件不成立）**。
 * 说明：本脚本**不接入 CI**；接入时随「四守卫」对应票一并改 CI。
 */
console.error('guard-deps：未实现（后续票接入）——退出码 2 = 阻塞，禁止当作通过。');
process.exit(2);
