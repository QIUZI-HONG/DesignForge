#!/usr/bin/env node
/**
 * guard-electron-baseline —— 桌面壳安全基线守卫（预留挂点，**未实现**）。
 *
 * 用途：断言 apps/desktop 的 Electron 安全基线四顶不被放宽：
 *   contextIsolation=true / sandbox=true / nodeIntegration=false / webSecurity=true；
 *   并核壳内渲染一致性（验收标准 §3）相关开关。
 * 接管票：FE-12（最小壳）；四守卫全量归后续期票。
 * 退出码语义：**0 = 通过 / 1 = 违规 / 2 = 阻塞（未实现，或前置条件不成立）**。
 * 说明：本脚本**不接入 CI**；FE-12 落地时本守卫随壳一起接入。
 */
console.error('guard-electron-baseline：未实现（FE-12 接入）——退出码 2 = 阻塞，禁止当作通过。');
process.exit(2);
