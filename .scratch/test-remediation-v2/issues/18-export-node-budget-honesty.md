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

## 追加：门禁脚本消费侧（round-2 G3 补记 · fix/v2r-b-export-honesty）

本票三条 blocker 都写在**生产侧**（scene/routes/UI），门禁脚本 `scripts/verify-daemon.mjs`、`scripts/verify-figma-inspect.mjs` 从未列进本票 blockers——历史后果：`/export` 两步只验 sha256/length 自洽与魔数，恰好就是空白/截断产物也能全绿的自洽口径，等于把 honesty 交给消费者自己读 `complete`，而两个消费侧门禁一次都没读过它。

本轮已在这两个脚本的每格式导出循环里补 `export.<format>.complete === true` 断言（step id 带格式名；字段缺失/false 判失败 exit 1，不再跳过）。诚实口径同时写进脚本注释：当前冒烟/功能夹具是 1–2 个节点的极小页面（远低于 `MAX_NODES = 2000`），所以这两步今天**恒过是"构造上看不见"**，不是"已验证大页面截断诚实"；把 `complete` 立为可执行红线只是把契约兜住，真正的大页面截断回归仍需由 `scene.test.ts`/`routes/export.test.ts` 承担。

**未做（deferral）**：给 verify-daemon/verify-figma-inspect 加"构造 >2000 节点页面 → 断言 complete:false 且 truncatedNodes>0"的实跑用例——脚本现用夹具都是极小页面，扩到预算越界需要新引一份 2001+ 节点 fixture 到脚本侧，本票未扩；判为可延后，Node 单元/HTTP 缝已有覆盖。

## 未做的其他项（round-2 G1 补记）

- **失败/部分导出是否阻止覆盖上一次好产物**：`routes/export.ts` 仍是无条件写盘 + HTTP 200（`complete:false` 只反映在响应字段与遥测里），空白产物会覆盖上一次好产物。本轮决定不改写盘语义：G1 的 HTTP 回归要求"corrupt envelope → 200 + complete:false"（不 5xx），把"部分产物"改判 5xx 会把它误报成"没有产物"；改判"complete:false 就不落盘"会破坏 routes/export.test.ts 已确立的 200/字节流契约。诚实性通过 `complete` 字段 + UI/遥测/门禁传播；防止覆盖留给后续票（若产品决定要"失败导出保旧产物"，应新立一票）。

## 收口：空白/部分产物不再静默覆盖好产物（round-2 G1 二次补记 · fix/v2r-b-export-honesty）

上面那条「不改写盘语义」的 deferral **已被本轮推翻并按 G1 要求落地**（覆盖丢的是用户本地产物，属数据损失，不能只靠字段诚实）。状态码语义不动（仍 200，见上段理由），**隔离落在文件名上**：

- `apps/daemon/src/export/index.ts` 新增 `incompleteArtifactFileName(fileName, format)` → `<规范名>.incomplete.<format>`。
- `apps/daemon/src/routes/export.ts`：`rendered.complete === true` → 写规范名（与改前一致）；`false` → **一律**写 `.incomplete` 侧文件，规范名字节永不被动；`artifact.fileName/filePath` 同步指向实际落盘名（响应载荷与磁盘逐字节一致，不出现「说写了、盘上没有」）。
- `packages/contracts/src/export/index.ts`：`ExportResultPayload.preservedPreviousArtifactPath: string | null` —— 部分产物且规范名上确有一份旧产物时给出被保留的路径，否则 `null`。
- 回归：`routes/export.test.ts` 新增两态覆盖用例（SVG + PNG 各一条，PNG 那条同时钉「旧产物像素仍是红矩形 / 新产物像素是页面底色」，正是二轮实测 GOOD 236 字节 → BLANK 7164 字节 的路径）；`export/index.test.ts` 钉隔离名与 `renderExport` 完整性透传。
- 门禁：`verify-daemon` / `verify-figma-inspect` 的导出步现在断 `result.complete === true`，夹具（1–2 节点）走规范名，`.incomplete` 分支由单元/HTTP 缝覆盖（`scene.test.ts` 2001+ 与截断子树计数、`routes/export.test.ts` 预算与坏信封）——ST-1 说的「构造性失明」用「确定性到达截断/跳过分支的用例」这一支补齐，不在门禁脚本侧扩 2001 节点夹具。

实跑（`~/df-evidence/v2r-b/`）：`--filter @dforge/daemon lint` 0；`@dforge/contracts` + `@dforge/daemon` + `@dforge/web` test 0（13/19/167 文件）；`pnpm run typecheck` 0（修掉上一版遗留的 `exactOptionalPropertyTypes` 红：`routes/export.test.ts` 的 `putBodyAndExport` 返回类型）。

## 追加：门禁侧计数红线（round-2 ST-1 二次补记 · fix/v2r-b-export-honesty）

上面「门禁脚本消费侧」只立了 `complete === true` 一条；本轮按 finding 要求补上**计数断言**，两个门禁的每个导出步骤都是「状态 + `complete` + 两个真损失计数」三件一体：

- `scripts/verify-daemon.mjs`：`export.<format>.complete` 之外新增 `export.<format>.counts`
  （`skippedNodes === 0 && truncatedNodes === 0`，夹具是 1 枚合法矩形，非 0 即产物有真损失）。
- `scripts/verify-figma-inspect.mjs`：`complete` 之后新增 `counts` 断言（同口径，夹具 2 枚节点）。
- 「构造性失明」（夹具距 `MAX_NODES=2000` 差约 1999）按 finding 给的第二条路补：不在门禁里塞 2001 节点夹具，
  而由 `scene.test.ts`（2001+ 容器与其子树逐枚计 `truncated`；隐藏子树计 `hidden`）与
  `routes/export.test.ts`（HTTP 200 + `truncatedNodes>0` + `complete:false`；坏信封 `page:null`、`rootIds:[]`、
  诚实空页 `'{}'` 三条）确定性地到达截断/跳过分支——分支覆盖有凭据，门禁红线有兜底。

门禁实跑：`node scripts/verify-daemon.mjs` → **0**（48 步，`export.*.complete`/`export.*.counts` 9 步全 ok；
证据 `gate-verify-daemon.log`）；`node scripts/verify-figma-inspect.mjs`（自起 `--port 0` 临时数据根 daemon）
→ **2**，功能段 21 项断言全 ✓（含 3×complete、3×counts），阻塞原因是「参照集未冻结（REF-01）」——**2 不是通过**，
且不属本票范围（`gate-verify-figma-inspect.log`）。


