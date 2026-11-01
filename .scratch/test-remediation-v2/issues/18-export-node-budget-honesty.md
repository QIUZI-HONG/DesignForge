# 18: fix · 导出节点预算静默截断，却报告「完整产物」

**What to build:** 导出被截断时必须如实报告。现状：`apps/daemon/src/export/scene.ts:42` `MAX_NODES = 2000`；`:121-122` `budget.used += 1; if (budget.used > MAX_NODES) return null;` —— **返回 null 但不给 `budget.skipped` 计数**，`:190` 原样回 `skippedNodes: budget.skipped`，`apps/daemon/src/routes/export.ts:96-98` 把它放进成功响应。后果：>2000 节点的页面只出前 2000 个（父容器已发出、子节点被丢），HTTP 200、UI 显示导出成功、`skippedNodes: 0`。这正是本仓纪律最反对的「把未判定/部分结果当绿报」（`implementation-workflow.md:81`）。测试只喂个位数节点。

**可达性（与上一轮 A1 同窗口，必须照此定级）**：`main` 上 `extractScene` 读不懂 web 信封（只认顶层 `children`/`nodes` 数组，见 `scene.ts:171-176`），所以真实 web 文档走导出会先撞上 A1 的空产物问题；本条的静默截断需要**直接 PUT 顶层形状正文**才触发（本机进程，或上一轮 A2 的 CORS 利用链）。修 A1（上一轮票 01）时若不一起修本条，信封分支一通就立刻变成「用户可见的静默截断」。

**Blocked by:** 上一轮票 01（export-envelope）—— 两条同一函数，必须同一票或明确先后，禁止两票各改 `extractScene` 一半

**Status:** ready-for-agent

blockers:

- [ ] 预算耗尽计入 `skippedNodes`（或独立 `truncatedNodes` 字段），并在响应里显式 `complete: false`
- [ ] `routes/export.ts` 在截断时不得返回「成功」语义：给出结构化告警字段，UI 必须区分「完整导出 / 部分导出」
- [ ] 新增用例：2001+ 节点顶层场景 → 断言报告非零截断；与上一轮票 01 的信封用例共用夹具

## 基线核对（2026-11-01 · 集成分支 integration/test-remediation-v2 @ 3f3603c）

工单正文行号取自 main@a838281，已过期。新基线上的实况坐标、上一轮已做掉的部分、剩余缺口与判据修正：
`~/df-evidence/test-remediation-v2/notes/baseline-audit.md` 同名小节（开工前必读）。
