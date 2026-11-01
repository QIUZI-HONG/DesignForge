# 06: fix · 门禁三态退出码映射与优先级（前置失败不得报「真违规」）

**What to build:** 判据原文 `implementation-workflow.md:71-81`：`1` = 门禁已实现且发现真违规，`2` = 未实现/前置条件不成立。本轮日志证明两类被混发：

- node 版本前置不成立（`ERR_UNKNOWN_FILE_EXTENSION ".ts"`，本机 node 22.16 vs 开发机 node 24）→ `verify-mcp-stub` / `verify-ai-two-state` / `verify-image-two-state` A 轮 **exit=1**。
- Chromium 缺系统库 → `verify-figma-review` **exit=1**，而同因的 `verify-figma-home/editor/panels/inspect/inspector/component` 同轮 **exit=2**。同一族、同一原因、两种码。
- 优先级倒置：`scripts/verify-mk-04.mjs:490-492`、`verify-mk-05.mjs:540` 让 `blocked` 覆盖 `failed` —— 同时存在真违规与未判定时只报 2，真违规从退出码消失。（文档只在 `:91-93` 为 `guard-vocab` / `guard-feature-boundaries` 写了「1 优先于 2 且同屏列出」，本票是把**同一原则**铺到门禁族，不是逐字违令。）

**Blocked by:** 05（同一批 spawn/挂载形态改动，先做完 05 再收退出码，避免二次返工）

**Status:** ready-for-agent

blockers:

- [ ] spawn/launch/依赖缺失类失败统一走 `blocked(...)`：`.ts` 载入失败、Chromium 缺失、参照集缺失、daemon 起不来一律 2
- [ ] 全族统一「有 failed 即 1，并同屏列出 blocked 计数」；`verify-mk-04/05` 两处优先级修正
- [ ] 对抗夹具入 `scripts/tests/`（同轮既有 failed 又有 blocked 的载荷），断言退出码为 1 且两类明细分列
- [ ] 在 node 22 与 node 24 两种环境各跑一遍受影响门禁，退出码与结论文案一致
- [ ] 复跑本轮 Phase A/B，`gate-summary*.tsv` 的 exit 列不得再出现「同因两码」
