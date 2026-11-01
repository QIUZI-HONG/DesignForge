# 18: fix · 导出节点预算静默截断，却报告「完整产物」

**What to build:** 导出被截断时必须如实报告。现状：`apps/daemon/src/export/scene.ts:42` `MAX_NODES = 2000`；`:121-122` `budget.used += 1; if (budget.used > MAX_NODES) return null;` —— **返回 null 但不给 `budget.skipped` 计数**，`:190` 原样回 `skippedNodes: budget.skipped`，`apps/daemon/src/routes/export.ts:96-98` 把它放进成功响应。后果：>2000 节点的页面只出前 2000 个（父容器已发出、子节点被丢），HTTP 200、UI 显示导出成功、`skippedNodes: 0`。这正是本仓纪律最反对的「把未判定/部分结果当绿报」（`implementation-workflow.md:81`）。测试只喂个位数节点。

**可达性（与上一轮 A1 同窗口，必须照此定级）**：`main` 上 `extractScene` 读不懂 web 信封（只认顶层 `children`/`nodes` 数组，见 `scene.ts:171-176`），所以真实 web 文档走导出会先撞上 A1 的空产物问题；本条的静默截断需要**直接 PUT 顶层形状正文**才触发（本机进程，或上一轮 A2 的 CORS 利用链）。修 A1（上一轮票 01）时若不一起修本条，信封分支一通就立刻变成「用户可见的静默截断」。

**Blocked by:** 上一轮票 01（export-envelope）—— 两条同一函数，必须同一票或明确先后，禁止两票各改 `extractScene` 一半。**已解除**：票 01 的信封展平在基线内（`e1ecb84`），本票只在展平后的 `extractEnvelopeNode` 上动预算，未再改展平逻辑。

**Status:** code-complete（Node 门禁全绿；证据 `~/df-evidence/v2-18/`；未在浏览器实跑导出面板）

blockers:

- [x] 预算耗尽计入 `skippedNodes`（或独立 `truncatedNodes` 字段），并在响应里显式 `complete: false`
  - 取独立字段：`truncatedNodes` 与 `skippedNodes` 语义不同（结构不识别 vs 预算耗尽），合并计数会让 UI 无法说明原因。
- [x] `routes/export.ts` 在截断时不得返回「成功」语义：给出结构化告警字段，UI 必须区分「完整导出 / 部分导出」
  - 判据按后半句落：截断时仍 HTTP 200（产物本身有效，5xx 会把「部分结果」误报成「没有结果」），但响应必须带 `complete` + 两个计数，web 客户端缺 `complete` 即判 `daemon_invalid_response`（不默认完整），导出面板显示「部分导出 …」并列出缺失节点数。
- [x] 新增用例：2001+ 节点顶层场景 → 断言报告非零截断；与上一轮票 01 的信封用例共用夹具
  - 三层各一条：`scene.test.ts`（顶层 + 信封 2001）、`routes/export.test.ts`（HTTP 200 现场景 + 信封场景）、`export-client.test.ts` / `ExportPanel.test.tsx`（客户端与 UI）。

## 完成记录（2026-11-01 · 串行实现，提交于集成分支）

改动面 13 文件 / +423 −27：`packages/contracts/src/export/index.ts`（新增 `ExportResultPayload`）、daemon `export/scene.ts`（`ExtractBudget.truncated` + `RenderScene.truncatedNodes/complete`）、`export/index.ts`、`routes/export.ts`（遥测与响应带完整性）、web `inspect-export`（client 解析 + 面板两态 + i18n + CSS）、四个测试文件。

`complete` 是布尔保证（`skipped === 0 && truncated === 0`），`truncatedNodes` 是**下界**（容器被截后其子树不再遍历）——消费者判「完整/部分」只准读 `complete`，两个计数只用于说明规模。契约里已写死这条口径。

未做的部分：`scene.ts` 的递归改迭代（预算护栏本身够用，不在本票 DoD 内）；浏览器实跑导出面板（本机缺 `libnspr4/libnss3` 等，挂待人工）。

门禁实况：`pnpm run lint` 0 · `pnpm run typecheck` 0 · `pnpm run test` 0（9 包 315 测试文件全绿）· `guard:tokens` 0 · `guard:vocab` 0 · `guard:feature-boundaries` 0 · i18n 键集 1103↔1103 · `verify:daemon` 需 `NODE_OPTIONS="--experimental-strip-types"` 才 0（42/42），裸跑 exit 2 是脚本没自带该标志的环境问题，非本票引入。

## 基线核对（2026-11-01 · 集成分支 integration/test-remediation-v2 @ 3f3603c）

工单正文行号取自 main@a838281，已过期。新基线上的实况坐标、上一轮已做掉的部分、剩余缺口与判据修正：
`~/df-evidence/test-remediation-v2/notes/baseline-audit.md` 同名小节（开工前必读）。
