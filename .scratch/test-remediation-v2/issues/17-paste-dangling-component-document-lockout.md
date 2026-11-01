# 17: fix · 粘贴产生的悬空组件引用无校验落盘 → 整份文档不可重开（潜伏）

**What to build:** 写入侧与读取侧的校验强度必须对称——现在是**写不校验、读全校验**，一旦悬空引用进了盘，整份文档就打不开。链路：

- `packages/engine/src/clipboard/clipboard.ts:122-124` 载荷自检**有意**不套用 `missing-component`/`missing-component-set`（注释写明「跨页粘贴靠 `componentRemap` 接手」），`:398` 在没有 remap 时保留原 `componentId`；
- `apps/web/src/features/canvas/state/session.ts:829` `pasteCommands(payload, { pageId, ids })` —— **从不传 `componentRemap`**；
- `apps/web/src/features/canvas/persistence/documents-client.ts:190-196` `encodePageBody` 原样封装落盘，零校验；
- 读回 `documents-client.ts:276` → `packages/engine/src/serialize/serialize.ts:166-172`：`validateDocument` 有**任何** issue 就 `throw`，`packages/engine/src/scene/validate.ts:451-459` 的 `missing-component` 正在其列 → 载入返回「文档结构非法」，用户在 UI 里**再也打不开这份文档**（除手工改 JSON 无恢复路径）。
- 引擎侧 `packages/engine/src/__verify__/clipboard-hierarchy.test.ts:109-128` 反而把悬空引用**钉成期望行为**。

**可达性（独立复核结论，必须照此定级，不许写成「正在丢用户数据」）**：今天**走不到** —— 页面切换 API `setPageId` 全仓只在 `apps/web/src/features/canvas/workspace/workspace-session.ts:206` 以 `firstPageId` 调用一次（无页签切换），且 `session.ts:305` 的 `clipboardPort` 在生产里**没有任何非测试注入点**（系统剪贴板读回路径未接线）。所以这是**潜伏类**：任意未来「页签切换 / 系统剪贴板接线 / 外部载荷导入」一落地即成不可逆锁定。同族的跨父级坐标问题见上一轮票 07（B4），本票只处理**引用完整性**。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] 粘贴时若无 `componentRemap`：要么连带主组件一起复制，要么把实例降级为普通帧/删实例——**不得留下悬空引用**
- [ ] 写入侧对称校验：`saveDesignDocument` 前跑一次 `validateDocument`，非空 issue 拒绝落盘并给出可执行提示（不许静默写坏）
- [ ] 读回侧要有「可打开的降级路径」（只读/修复模式），结构非法不得等于文档死刑
- [ ] 端到端用例：复制实例 → 粘贴到另一页/另一文档 → 保存 → 重开（本轮覆盖空洞：这一段零覆盖，现有并发/往返用例全绕开真形状）
- [ ] 修正 `clipboard-hierarchy.test.ts:109-128` 的期望（悬空引用不该是「正确行为」），并在 `clipboard.ts:122-124` 注释里改口径

## 基线核对（2026-11-01 · 集成分支 integration/test-remediation-v2 @ 3f3603c）

工单正文行号取自 main@a838281，已过期。新基线上的实况坐标、上一轮已做掉的部分、剩余缺口与判据修正：
`~/df-evidence/test-remediation-v2/notes/baseline-audit.md` 同名小节（开工前必读）。
