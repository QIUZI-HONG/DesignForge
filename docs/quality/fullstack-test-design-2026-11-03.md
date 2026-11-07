# 设界 · DesignForge —— 全栈测试设计与评审报告 v1

- 日期：2026-11-03
- 角色：资深全栈测试架构师（按 code-review 纪律执行：多子代理并行侦察 → 事实底稿 → 分区起草 → 独立整合复核）
- 事实来源：6 路只读侦察子代理对仓库的实测（每条结论可回溯到代码路径），非模板想象。**本文档不编造仓库中不存在的架构**；模板与实际形态不一致处逐条显式映射或标注「不适用」。
- 交付物定位：可执行、可追溯、可自动化的测试方案；用例均含前置/步骤/预期，可转 vitest / daemon 集成 / RTL / playwright 门禁 / 手工执行。

---

## 0. 项目信息（实测填充）

| 项 | 实测结论 | 证据 |
|---|---|---|
| 项目名称 | 设界 · DesignForge——本地优先的类 Figma 设计工作台（毕业设计） | `README.md:1-13` |
| 技术栈 | pnpm monorepo · Node ≥22 · TypeScript strict · Biome · vitest · Next.js 16 App Router + React 18 + zustand · canvaskit-wasm 0.42（Skia WASM）· Fastify 5 · Electron 44 · intl-messageformat（zh-CN 唯一暴露） | `pnpm-workspace.yaml`、`apps/*` |
| 架构 | 本地优先三支柱：①本地真值（`.dfg` 目录态文档、可 Git diff、离线完整可用）②受控 AI（DeepSeek BYOK 文本上云 + ComfyUI 本地出图）③数据飞轮（GitHub 技能市场采集→四层→评分→检索）。四端形态：`apps/web`（Next 前端）/ `apps/daemon`（Fastify 本地服务，127.0.0.1:4318 起 +1 探测，上限 +32）/ `apps/desktop`（Electron 壳）/ `tools/cli`（`df`）。跨进程通信=纯 REST（33 条路由，真源 `packages/contracts/src/ipc/routes.ts`）+ 一处 SSE（`POST /ai/chat`）；无 WebSocket | `README.md:5-9`、`apps/daemon/src/server.ts` |
| 数据库 | **无任何数据库**（全仓无 SQL/ORM/迁移代码）。持久化=本地文件系统：数据根 `~/.dforge`（`DF_DATA_ROOT` 可覆盖），`.dfg` 目录态文档（`manifest.json` + `pages/<pageId>.json`）+ localStorage（版本快照/评论/回收站） | `apps/daemon/src/documents/store.ts`、`docs` 侦察底稿 |
| 存储 | 文件系统原子写（临时文件→fsync→rename，`apps/daemon/src/fs-atomic.ts`）；无对象存储/消息队列/Redis；图片资产仅 ComfyUI 出图产物（sha256 命名），**无用户图片上传** | `apps/daemon/src/image/client.ts` |
| 实时协作 | **无多人实时协同（官方明确不做）**：CRDT/OT/WebSocket/presence 全仓零命中；`docs/plan/architecture-v1.1.md` §2.2 明示取舍。「双窗口只读同步」仅文档承诺、代码未实现 | 协作侦察底稿 |
| 权限 | 无登录/OAuth/JWT/RBAC/鉴权 token；安全边界=回环监听+CORS 白名单（白名单外不加放行头但**照常处理请求**；`Origin: null` 恒放行）——代码注释自认的取舍 | `apps/daemon/src/cors.ts:13,67,83` |
| 部署 | web=Vercel（designforge-snowy.vercel.app，prebuilt）；daemon/desktop=本地进程，无安装分发（无 electron-builder）；无 CI 部署 job | 提交 `a838281`、`apps/desktop/package.json` |
| 需求/接口文档 | 需求真源=`docs/plan/`（architecture-v1.1、skeleton-and-package-layout-v1）+ GitHub Issues（wayfinder:map）；接口真源=`packages/contracts/src/ipc/routes.ts`；已知缺陷源=`docs/quality/ux-audit-2026-10-30.md`（54 项） | — |
| 测试环境 | 开发机 WSL2/node 24（全量含浏览器门禁+Electron）；CI=ubuntu/node 22/30min 单 job（无 Chromium、无 Electron 二进制、无 gh 凭据、无仓外证据）；门禁三态 0/1/2（2=阻塞，禁假绿） | `docs/agents/implementation-workflow.md`、`.github/workflows/ci.yml` |

**模板 → 实际形态映射声明**（本方案对用户模板的适配原则）：

| 模板预设 | 本项目实际 | 本方案处理 |
|---|---|---|
| 云数据库/多租户/RBAC | 无 DB、单用户本地 | 第四章映射为「文件系统持久化 + localStorage 专项」，DB 项列预留 |
| WebSocket 实时协作 | 明确不做 | 第五章改为「现状判定 + SSE/轮询专项 + 协作立项预留清单」 |
| 对象存储/签名 URL/病毒扫描 | 无对象存储、无上传 | 不适用，残余风险登记 |
| 分享链接/通知中心 | 未实现（分享按钮禁用占位） | 不适用，列入十、残余风险 |
| 权限越权 IDOR | 无多用户模型 | 映射为「本地特权面滥用」（CSRF/DNS rebinding/路径遍历） |
| 插件沙箱 | 无插件运行时；市场 load-plan 仅元数据不执行代码 | 第六章供应链条目覆盖 |

---

## 假设与待补充清单（禁止编造项的显式登记）

| # | 假设/待补充 | 影响 |
|---|---|---|
| H-1 | 无独立需求规格说明书；以 `docs/plan/` + Issues 为需求真源，用例「追溯」列锚定这些文档与代码路径 | 追溯粒度=票/文档章节级 |
| H-2 | CI 与开发机非同环境（CI 无 Chromium/Electron/gh 凭据/仓外证据，runner 慢 3–4×） | 用例的自动化层级须区分「本机可跑」与「CI 可跑」 |
| H-3 | Figma 视觉参照集 `~/df-evidence/reference-v1` 未冻结（REF-01）→ 全部 pixelmatch 门禁处于 exit 2 阻塞态 | 视觉回归当前无拦截面 |
| H-4 | `verify:perf` 基线 provisional（模板阈值未实采校准，20k 档阈值全 null） | 性能验收标准待定 |
| H-5 | ComfyUI 实例/模型清单未确认；`services/comfy` 是纯占位（无 API 客户端代码），出图客户端实际在 `apps/daemon/src/image/client.ts` | 出图测试依赖 mock 上游 |
| H-6 | DeepSeek 线上可用性未验证；测试一律用本机 mock 上游（OpenAI 兼容 SSE） | 真上游行为属外部依赖 |
| H-7 | Vercel 线上产物与本地 `next build` 产物行为一致性未验证 | 兼容性章节只覆盖本地 |
| H-8 | 目标用户硬件档位/并发规模未定义 | 性能阈值只能以基线校准产出 |
| H-9 | Windows/macOS 打包分发未定义（无 electron-builder） | 桌面兼容性测试范围仅限 dev 运行态 |
| H-10 | 市场真实数据集与 mk-01…05 证据在仓外 `~/df-evidence/`，CI 不可用 | 市场门禁只能离线重放冻结样本 |

---

## 一、测试范围与风险矩阵

风险定级口径：P0=数据丢失/损坏、崩溃、安全暴露；P1=核心功能缺陷；P2=体验/次要功能；P3=边缘/打磨。覆盖依据=现有测试与门禁对该模块的既有拦截；残余风险=本轮测试后仍无拦截的部分。

| # | 模块 | 主要风险点 | 等级 | 覆盖依据（现状） | 残余风险 |
|---|---|---|---|---|---|
| 1 | 文档存储 `.dfg`（daemon） | 崩溃半态、跨进程覆盖丢数据、manifest/pages 不一致、路径逃逸 | **P0** | daemon 13 测试文件：10 路由全测+adversarial+documents.security；原子写+mutex+409 已实现 | 无故障注入常态化（kill -9/磁盘满）、双窗口覆盖无用户提示 |
| 2 | AI 文本代理（SSE） | **已知断点 3.1**：raw.writeHead 绕过 cors.ts→浏览器端必然 Failed to fetch；**3.2** validate/compile 假步骤；BYOK 泄漏 | **P0** | verify-ai-two-state（两态取证，未接 CI）；daemon ai 路由有测试 | CORS 缺陷未修（现状必红）；上游内容无脱敏 |
| 3 | 凭据与本地特权面 | 无鉴权+`Origin:null` 放行+白名单外照常执行→恶意网页 CSRF/DNS rebinding 可读写删文档、消耗 key | **P0** | cors 白名单实现；无 CSRF 专项测试 | 本地特权面滥用无任何自动化拦截 |
| 4 | 引擎内核（命令栈/序列化） | 撤销链损坏、序列化非幂等、NaN/超深/原型污染 | P1 | engine 25 测试文件含固定种子 fuzz；verify:engine 已接 CI（含序列化哈希独立复核） | 无属性测试（fast-check 类）；historyLimit 溢出行为未测 |
| 5 | 导出 PNG/SVG/PDF | 已知简化实现：PNG 文本/位图跳过、SVG 字体不嵌、手写 PDF-1.4 | P1 | daemon export 测试（含 PDF 用例）；e2e editor 场景含导出 | 文本不画的产物差距未在门禁断言；15s 超时行为未测 |
| 6 | 画布渲染（Skia） | 大文档全量重绘退化、wasm 内存泄漏、字体静默回退 | P1 | verify:perf（M1–M7，provisional 恒阻塞）；e2e smoke 含 Skia 首帧断言 | 性能基线未转正=性能回归无拦截；ParagraphCache 泄漏无专项 |
| 7 | Electron 壳 | 安全基线退化、外链/导航逃逸、静态服务路径遍历 | P1 | guard:electron-baseline 已接 CI（静态 AST+声明点唯一）；desktop 13 静态测试 | 真壳三段门禁（shell-parity）未接 CI；主装载页无 CSP |
| 8 | localStorage 本地态 | 配额满/禁用/坏 JSON；版本快照仅存浏览器（清数据即失） | P1 | web 164 测试文件覆盖 16 features（含 editor-review 6 件） | 配额/隐私模式边界无测试；「快照非持久」无用户警示断言 |
| 9 | MCP 提案闸门 | 重放/过期/哈希泄漏、审计 JSONL 完整性 | P1 | verify-mcp-stub（真起 daemon，重放 403/过期 410 已验）；mcp 路由有测试 | guard:mcp-contract 未实现（exit 2）；崩溃恢复未做（内存态） |
| 10 | 市场与数据飞轮 | 索引损坏降级、load-plan 代码执行风险、ingest 限速熔断 | P2 | ingest 52 测试文件（含 --replay）；verify-mk-01…05（需仓外证据）；guard:vocab 已接 CI | mk 门禁未接 CI；真实数据集回归靠离线重放 |
| 11 | 出图（ComfyUI 调度） | 未启动态、run 内存态进程退出即失、轮询取消 | P2 | verify-image-two-state（两态）；image 路由有测试 | run 崩溃丢失已登记为 P4b 未实现 |
| 12 | 桌面壳装载链 | 装载目标回退链、壳内存活超时误杀（D-8） | P2 | verify-shell-parity 三段式（smoke/alive/parity，未接 CI） | 无二进制环境（CI）只能静态断言 |
| 13 | CLI（df） | set-key 注入面、退出码契约 | P2 | cli 9 测试文件（含占位 GH_TOKEN 先例） | — |
| 14 | i18n / 快捷键 / a11y | 硬编码中文（ADR-0003 防线）、键位不一致（**3.3**）、键盘可达性 | P2 | guard:tokens+guard:vocab 间接拦文案；web RTL 测试 | a11y 无系统测试；命令面板 CSS 未挂载（3.3）未修 |
| 15 | 遥测/审计 JSONL | 脱敏失效、文件权限、追加写竞态 | P3 | contracts sanitize 测试；telemetry 路由测试 | JSONL 非原子追加（单进程假设）无测试 |
| 16 | **模板项：多人实时协同/云 DB/对象存储/分享/通知/RBAC** | — | 不适用 | 官方明确不做或未实现 | 若立项须先补第五章预留清单 |

---

## 二、测试环境与测试数据策略

### 2.1 环境分层

| 层 | 环境 | 可跑内容 | 不可跑内容 |
|---|---|---|---|
| E1 开发机（WSL2，node 24） | 全量：`pnpm verify` + 浏览器门禁（Chromium 经 `BENCH_CHROME_EXECUTABLE` 或 `~/.cache/ms-playwright/chromium-*`，playwright-core 1.63 锁 chromium-1243）+ Electron 壳（`node apps/desktop/tools/fetch-electron.cjs`，需镜像）+ mock 上游 | 真实 DeepSeek/ComfyUI 依赖的验收（用 mock 替代） |
| E2 CI（ubuntu，node 22，30min） | lint/typecheck/test/test:scripts + 4 guard + verify:engine + 三步阻塞语义断言 | 任何浏览器/Electron 门禁、读仓外证据 |
| E3 Vercel 线上 | 只读烟测（路由可达、产物加载） | 写操作、凭据相关 |

环境纪律（摘自 `docs/agents/implementation-workflow.md`，违反即数据事故先例）：
- 测试一律**临时数据根 + 空闲端口**（远离 3000/4318），**禁止**连接开发机在跑的 daemon 或读写真实 `~/.dforge`（曾发生哨兵 key 覆盖真 key 事故）。
- **禁用 /tmp**（tmpfs 3.9G）；中间产物落 `/home/QIU/df-wt/<票号>/` 或仓外证据 `~/df-evidence/<票号>/`。
- 临时目录删除用可重试删除 `rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })`（追加写在 close 后仍有在途写入，ENOTEMPTY 竞态）。
- 浏览器门禁一律 `next build` + 生产装载，**禁用 next dev**（Turbopack dev 源不加载客户端引导件，断言假红）。

### 2.2 测试数据策略

| 数据类 | 策略 | 来源/工具 |
|---|---|---|
| 确定性大文档 | 引擎确定性基准文档 1k/5k/20k 节点三档，同种子可复现 | `packages/engine/src/testing/benchmark-doc.ts`（verify-perf 同源） |
| 正常文档夹具 | 最小 `.dfg`（manifest v1 + 单页）→ 中型多页含 8 节点类型全覆盖 → 组件/实例嵌套 | 手工构造 + `documents-client.ts` 信封 `{$format:'dforge.canvas.page',$version:1,page,tokens}` |
| 畸形语料 | 坏 manifest（schema 不符）、深度 1025/1026 边界对（exceedsJsonDepth 判 depth>1024）、NaN/±Infinity、`__proto__` 注入、超 64 字符文档名、路径分隔符、非 NFC 文档名、NUL 页 id、非法 UTF-8 JSON | 手工构造；daemon 现有 adversarial 测试扩展 |
| mock 上游 | DeepSeek=本机 OpenAI 兼容 SSE 桩（两态：无 key / 有 key+哨兵）；ComfyUI=probe/run 桩（未启动态是一等验收对象） | `verify-ai-two-state.mjs`、`verify-image-two-state.mjs` 同款 |
| 市场样本 | 离线冻结样本进仓（CI 无仓外证据，先例：ingest 冻结样本 + `--replay`） | `df market collect --replay` |
| 视觉参照集 | 冻结流程见九章 9.2；冻结前全部 pixelmatch 门禁保持 exit 2 | `~/df-evidence/reference-v1` |
| 数据库快照（映射） | 「数据库快照」→ 数据根快照：`tar -C <dataRoot> -cf - . | sha256sum` 前后哈希比对，用于故障注入后完整性核对 | 见 TC-DR-02 |
| 数据清理 | 每用例自建临时数据根，用例结束可重试删除；证据归档 `~/df-evidence/<票号>/`；仓库内不留任何运行产物 | 纪律见 2.1 |

### 2.3 测试数据隔离核对清单

1. 用例基址/数据根显式给临时值，禁止「缺省即连本机」；
2. 并行用例端口互斥（freePort 探测后锁定，先例 `scripts/lib/gates.mjs`）；
3. 哨兵 key 演练后立即轮换（`DF_DEEPSEEK_API_KEY` 与凭据库双检）；
4. localStorage 类用例用独立 browser context（playwright）或 jsdom beforeEach 清键；
5. 收工前核对端口已释放（按精确 PID，禁止 `pkill -f` 模式杀进程）。

---

## 三、详细测试用例表

> 本章收录 3.1–3.11 功能分区用例与 3.12 出图用例；安全（TC-SEC-01…12）、性能（TC-PERF-01…06）、灾备（TC-DR-01…06）三张表分别落在 6.2 / 7.2 / 7.3（编号全局互通，不重复排印）。全部用例遵循统一列式；自动化层级区分「本机可跑」与「CI 可跑」（见 2.1 环境分层）。

> 口径说明（3.1–3.3 分区）：优先级 P0<P1<P2；测试类型取自 功能/边界/并发/故障注入/安全/兼容性/a11y；「自动化建议」给具体测试层级与位置。snap 语义按仓库实现为**闭区间**（距离 ≤6px 吸、>6px 不吸；`packages/engine/src/snap/snap.ts` 头注释登记了简报「5.9 不吸 / 6.0 吸」不可同时成立的偏离裁决），本表边界值据此取 6.0 吸 / 5.99 吸 / 6.1 不吸。「现覆盖」=已有测试位置（回归保持），「缺口」=需新增。

### 3.1 引擎内核（TC-ENG-01…10）

| 用例ID | 模块 | 优先级 | 测试类型 | 前置条件 | 操作步骤 | 预期结果 | 测试数据 | 自动化建议 | 追溯 |
|---|---|---|---|---|---|---|---|---|---|
| TC-ENG-01 | 命令栈·撤销/重做 | P0 | 功能 | `CommandStack` 实例（freeze:true）；基准文档含 frame/rect/text/component/instance | ①固定种子 mulberry32 生成 100 步混合命令序列逐条 `dispatch`；②记录文档 JSON 快照 A；③循环 `undo()` 直至 `canUndo===false`，记录快照 B；④循环 `redo()` 直至 `canRedo===false`，记录快照 C | ③undo 次数=历史条数且 B=初始文档；④C 与 A **逐字段相同**（stableStringify 相等）；全程无就地写入抛错（深冻结验证唯一写入口） | 种子 [1, 7, 20261015]；命令集=node.insert/move/update/remove、page.*、group/ungroup、component/instance 系列 | vitest 单测@packages/engine（已有 `src/__verify__/command-stack-fuzz.test.ts` 固定种子 fuzz，新增种子只需扩表） | packages/engine/src/commands/stack.ts（不变式 3）；`__verify__/command-stack-fuzz.test.ts`；docs/plan/architecture-v1.1.md §4.1 |
| TC-ENG-02 | 命令栈·事务原子性 | P0 | 故障注入 | 同上基准文档；构造混合事务：[合法 node.move, 非法命令（nodeId 不存在）] | ①记录 dispatch 前文档快照与 `canUndo`；②`dispatch([合法, 非法])`；③捕获异常后再取快照与 `canUndo`、`history()` | ②抛 `CommandError`，`code` 为领域错误码（如 `node-not-found`）或 `transaction-failed`，`commandIndex` 指向非法命令下标；③文档快照与①逐字节相同、`canUndo` 不变、`history().undo` 长度不变（失败不留半态、不入历史） | 非法命令用 `node.update` 指向不存在节点；另备一条 `enqueue` 后 `flush` 失败路径断言 `lastError` 非空且文档不变 | vitest 单测@packages/engine（`src/commands/commands.test.ts` 已有同类，补 commandIndex/code 断言） | packages/engine/src/commands/stack.ts L110-139（事务原子不变式 2）、L287-304（toCommandError） |
| TC-ENG-03 | 命令栈·enqueue 微任务合并 | P1 | 功能 | 基准文档；drag 模拟场景 | ①同一宏任务内连续 `enqueue` 3 条 node.move（含 label）；②读 `pendingCount`；③`await Promise.resolve()`（微任务结算）后读 `history()`；④另测显式 `flush()` 提前结算 | ②`pendingCount=3`；③历史**只新增 1 条**（3 条命令合并进同一事务），label 取最后一次传入值；④`flush()` 后 `pendingCount=0`，同微任务后续 enqueue 进入下一轮 | 3 条 `node.move`（dx/dy 各异）；失败注入版：enqueue 含非法命令→错误进 `lastError`/`onError`，不炸调用栈 | vitest 单测@packages/engine（`commands.test.ts:194` 已覆盖合并主路径） | packages/engine/src/commands/stack.ts L151-180（不变式 4）；src/commands/commands.test.ts |
| TC-ENG-04 | 命令栈·historyLimit 溢出 | P1 | 边界 | `new CommandStack(doc, { historyLimit: 200 })` | ①连续 `dispatch` 20000 条 node.move；②读 `history().undo.length`；③`while(stack.undo())` 计数；④再读目标节点 x 坐标；⑤undo 到底后新 dispatch 一条，检查 redo | ②`undo.length ≤ 200`（最老条目被 shift 淘汰）；③undo 次数 ≤200；④`x === 初始 x + (20000 - undone)`（只有存活的 200 条可回退）；⑤新 dispatch 后 `canRedo===false`（redo 栈被清空） | 20000 条 `node.move dx=dy=1`；对照组 historyLimit:3（invariants.test.ts:175 已有小栈用例） | vitest 单测@packages/engine（fuzz 测试已覆盖 20000 步档，含耗时上界 15s/5s） | packages/engine/src/commands/stack.ts L250-254（#pushHistory shift）；`__verify__/command-stack-fuzz.test.ts` L449-475 |
| TC-ENG-05 | 序列化·幂等往返与稳定键序 | P0 | 功能 | 含全部 8 种节点类型的文档（rect/ellipse/text/frame/group/component/component_set/instance） | ①`s1 = serializeDocument(doc)`；②`doc2 = parseDocument(s1).document`；③`s2 = serializeDocument(doc2)`；④对同一 doc 乱序构造两个等价对象（键插入顺序不同）分别序列化 | ③`s1 === s2` 逐字节相同；④两串输出**逐字节相同**（稳定键序）；②解析结果 `version=1`、`enveloped=true`，信封 `$format='dforge.designir'`/`$version=1` | 8 节点全型文档 + 嵌套 frame（3 层）；裸文档（无信封）输入应解析成功且 `enveloped=false` | vitest 单测@packages/engine（`serialize/serialize.test.ts`、`__verify__/serialize-edges.test.ts` 已有，补 8 型全覆盖往返） | packages/engine/src/serialize/serialize.ts（模块头：稳定键序可 Git diff）；`roundTripDocument` L175-179 |
| TC-ENG-06 | 序列化·非有限数拒绝 | P0 | 边界/安全 | 合法文档；将某节点 patch 为 `x: NaN` / `y: Infinity` / `width: -Infinity` 三变体 | ①对含 NaN 文档调 `serializeDocument`；②对 ±Infinity 变体同测；③对含 NaN 的 JSON 串调 `parseDocument`；④断言错误对象类型与字段 | ①②③均抛 `DomainError`，`code='invalid-argument'`，消息含非有限值**路径**（如 `…nodes.n1.x=NaN`）；文档/输出不产生静默 `null` 折叠；合法文档不受影响 | `node.update` patch `{x: NaN}`；`{y: Infinity}`；`{width: -Infinity}`；原始 JSON 串注入版 | vitest 单测@packages/engine | packages/engine/src/serialize/serialize.ts L79-95（assertSerializableNumbers，B2 缺陷修复） |
| TC-ENG-07 | 序列化·超深拒止 | P0 | 边界 | 构造嵌套超限载荷：节点链 513 层 frame、值结构 2049 层对象 | ①513 层节点链文档→`serializeDocument`；②同载荷→`parseDocument`；③2049 层值结构→两入口同测；④512 层/2048 层合法边界→两入口应通过 | ①②③均抛 `DomainError('invalid-argument')` 且消息含上限值（`512`/`2048`）与链路格式化串，**不是**原生 RangeError/TypeError（递归前守门）；④恰好在上限内的载荷序列化+解析成功。**注意双层口径**：引擎 Design IR 为 512（节点链）/2048（值结构），daemon 页面 JSON 为 1024（见 TC-DOC-03），两者独立守门 | 深嵌套 fixture 用循环生成（frame 套 frame 513 层；普通对象套 2049 层） | vitest 单测@packages/engine（validate.ts 导出常量可直接断言上限值） | packages/engine/src/scene/validate.ts L26-29（MAX_NESTING_DEPTH=512 / MAX_VALUE_DEPTH=2048）；serialize.ts L144-148（导入同口径） |
| TC-ENG-08 | 序列化·__proto__ 剥离 | P1 | 安全 | 载荷：合法文档 JSON 中混入自有 `__proto__` 键（`JSON.parse('{"__proto__":{...},...}')`） | ①`parseDocument` 解析该载荷；②断言 `Object.prototype` 未被污染（`({}).polluted === undefined`）；③产物再 `serializeDocument` 与干净载荷产物比对；④对 `cloneDocument`、命令栈 `dispatch`（cloneCommand 路径）注入同载荷 | ①解析成功且 `__proto__` 键被**静默丢弃**（与未知字段同裁决，两态出口不变）；②无原型污染；③产物与无 `__proto__` 干净文档逐字节一致；④cloneDocument/dispatch 路径同样丢弃且不抛错 | `{"$format":"dforge.designir","$version":1,"document":{...,"__proto__":{"polluted":1}}}`；`{"__proto__":{"x":1},"type":"node.update",…}` | vitest 单测@packages/engine（serialize + commands 两处） | packages/engine/src/serialize/serialize.ts L47-63（skip 而非 assign-再-delete）、L148-163（parseDocument 丢弃点裁决）；stack.ts L274-284 |
| TC-ENG-09 | snap·阈值边界 | P1 | 边界 | 移动体 rect(100,0,50,50)；目标 rect 左边缘分别置于 105.9 / 106 / 106.1 | ①目标左缘 105.9 → `computeSnap`；②106（恰 6px）→ `computeSnap`；③106.1 → `computeSnap`；④zoom=2 时用 `snapThresholdWorld(2)=3` 复测同组；⑤zoom=0/负数/NaN 时 `snapThresholdWorld` | ①`dx≈5.9` 吸附；②`dx≈6` **吸附**（闭区间端点）；③无吸附（返回 `NO_SNAP`，dx=dy=0、guides 空）；④世界阈值 3 下 2.9 吸/3.1 不吸（屏幕手感恒定）；⑤非法 zoom 回落 6 | 目标位置 105.9/106/106.1 三档 + zoom ∈ {0.5, 2, 0, NaN} 换算档 | vitest 单测@packages/engine（`snap/snap.test.ts:37-45` 已钉三条边界，补 zoom 换算档） | packages/engine/src/snap/snap.ts L19-25（SNAP_THRESHOLD_PX=6、闭区间偏离说明）、snap.test.ts |
| TC-ENG-10 | 组件·实例覆盖与父组件联动 | P1 | 功能 | 文档含主组件 C(fill 红) + 实例 I(componentId=C)；I 无覆盖 | ①改 C 的 fills→取 I 渲染视图（resolveInstanceTree）；②`instance.setOverride` 给 I 虚路径打 fills=蓝；③再改 C 的 fills=绿；④`instance.resetOverride` 清覆盖后再改 C | ①I 随父组件联动（fill 红，实例不落盘子树、解析读主组件活值）；②I 显示蓝（`instanceOverrides` 表含该路径 patch）；③I **仍为蓝**（覆盖优先），未覆盖属性（宽高等）继续随 C；④清后 I 回随 C（绿）；逆命令可 undo 各步 | 主组件 C(60×40, fill 红)；覆盖 patch `{fills:[蓝]}`；reset path 省略=清空全部 | vitest 单测@packages/engine（`components/components.test.ts` + `scene/instance.ts` 解析） | packages/engine/src/components/components.ts L160-189；src/scene/instance.ts（实例只存 componentId+overrides，架构 v1.1 §4.1） |

### 3.2 画布渲染（TC-RND-01…06）

| 用例ID | 模块 | 优先级 | 测试类型 | 前置条件 | 操作步骤 | 预期结果 | 测试数据 | 自动化建议 | 追溯 |
|---|---|---|---|---|---|---|---|---|---|
| TC-RND-01 | CanvasKit 加载 | P0 | 故障注入 | 注入假 `loadScript`（可编程失败）+ 假全局 `CanvasKitInit`；`resetCanvasKitCache()` 清缓存 | ①loadScript 拒绝→`loadCanvasKit()`；②同一会话再次调用；③修复 loadScript 后第三次调用；④成功后并发调用 3 次；⑤脚本成功但全局缺失→再调 | ①抛 `Error('CanvasKit 脚本加载失败：<src>')`；②**再次抛错且重新走加载路径**（失败不缓存，可重试）；③成功返回实例；④3 次返回**同一个** Promise/实例（single-flight）；⑤抛 `'CanvasKit 脚本已加载，但全局 CanvasKitInit 不存在（资产损坏？）'` 且缓存仍为空 | fake loadScript 计数器；assetDir='/canvaskit'；默认脚本 URL 断言 `<dir>/canvaskit.js` | vitest 单测@apps/web（`runtime/canvaskit-loader.test.ts` 已有，补重试计数断言） | apps/web/src/features/canvas/runtime/canvaskit-loader.ts L75-93（失败不缓存注释） |
| TC-RND-02 | 帧循环 | P1 | 功能 | `createFrameLoop(draw, fakeScheduler)`（假时钟注入） | ①同一帧内连续 `request()`×5；②推进 fakeScheduler 触发回调；③读 `renderedFrames`；④绘制中再 `request()`；⑤`stop()` 后推进时钟；⑥`renderNow()` | ①②只绘制 **1 帧**（幂等合并，拖拽 8ms 高频 pointermove 不打爆帧率）；③`renderedFrames===1`；④不产生并发第二帧（handle 非空即忽略）；⑤`stop()` 后不再绘制且 `running===false`；⑥立即同步绘制 1 帧（门禁断言用） | fakeScheduler 记录 request/cancel 次数；draw 计数器 | vitest 单测@apps/web（frame-loop 纯逻辑可直接注入假调度器） | apps/web/src/features/canvas/render/frame-loop.ts（request 幂等合并、renderNow 语义） |
| TC-RND-03 | 渲染管线·大文档退化 | P0 | 性能/边界 | 生产构建 + 真实 Chromium；文档分别 1k/5k/20k 节点档 | ①`pnpm verify:perf` 真链路采集（M1 首帧/M2 帧间隔与耗时 p95/M6 堆采样/M7 clip 率）；②20k 档加载→缩放至 0.02→拖拽平移；③核对门禁退出码 | ①全程无白屏崩溃、无 wasm OOM；20k 档 m1-m5 基线值全为 null（**记录性指标，无通过线**）随证据留存；②每帧全量重绘（清屏→dpr→平移→缩放→drawScene，无视口剔除）表现为帧耗时随节点数线性增长——记录进基线 `rounds[]`；③当前 `provisional:true` → 门禁**恒 exit 2 阻塞（禁假绿）**，不得伪造通过 | 节点档 1k/5k/20k；viewport 1440×900、dpr 1.5（与 perf-baseline machine 口径一致） | playwright 浏览器门禁（scripts/verify-perf.mjs）+ 20k 档 fixture 生成脚本 | docs/quality/perf-baseline-v1.json（20k 档 null=记录性；provisional 恒阻塞）；scripts/verify-perf.mjs；apps/web/src/features/canvas/render/renderer.ts L155-163 |
| TC-RND-04 | ParagraphCache | P0 | 边界/故障注入 | `new ParagraphCache(fakeCK, fakeFontMgr, capacity=3)`，Paragraph 为记录 `delete()` 调用的假对象 | ①连续 `get()` 4 个不同 key 的 spec；②读 `size`；③断言被淘汰对象的 `delete()` 调用；④重复 `get()` 同一 spec（命中路径）；⑤`dispose()`；⑥同 spec 改 fontSize 再 get（键应不同） | ①size 封顶 3；②**最早插入**的 paragraph 被 `delete()` 且从 Map 移除（显式 delete 防 wasm 堆泄漏）；④命中不重建、builder 不再调用；⑤全部条目 `delete()` 且 `size===0`；⑥键含 fontSize→未命中重建（不出现「改字号没重排」） | 4 个 text spec（text/字号/颜色各异）+ 同键变体（fontSize 12→14） | vitest 单测@apps/web（假 Paragraph 注入，无需真 CanvasKit） | apps/web/src/features/canvas/render/paragraph-cache.ts L66-93（容量上限显式 delete）、L124-127（dispose） |
| TC-RND-05 | 字体加载 | P0 | 故障注入 | 注入 `fetchBytes`：全失败 / 部分（仅 latin-400 成功）/ 全成功 三档 | ①全失败→`loadSceneFonts`；②部分成功→同调；③全成功→同调；④对 ① 的调用方语义核查 | ①`registered===0` 且 `missing` 含全部 6 个 URL——调用方必须按**错误态**处理（画布给「字体加载失败」提示），不得静默回退系统字体；②`registered===1` 且 `missing` 非空=不完整态须显现；③`registered===6`、`missing=[]`，字重 400/500/700 × chinese-simplified/latin 全注册 | 6 个 woff2：`noto-sans-sc-{chinese-simplified,latin}-{400,500,700}-normal.woff2`（public/canvaskit/fonts/ 实存）；HTTP 404/500 注入 | vitest 单测@apps/web（`runtime/scene-fonts.test.ts` 已有注入路径） | apps/web/src/features/canvas/runtime/scene-fonts.ts（ADR-0003 禁静默回退）；apps/web/public/canvaskit/fonts/ |
| TC-RND-06 | 视口·DPR/zoom 极端值 | P1 | 边界 | viewport zoom ∈ {0.02, 1, 256}；dpr ∈ {1, 1.5, 3}；renderer 假 canvas 记录变换序列 | ①`zoomAt` 到 0.02 与 256 边界外（如 0.01/300）→读 zoom；②`screenToWorld`∘`worldToScreen` 往返；③renderer `resize(size, 0)` 后读 dpr；④renderer `draw` 读变换调用序；⑤文本覆盖层 `nodeOverlayBox` 用同组视口 | ①zoom 被 clamp 到 **0.02/256**（MIN_ZOOM/MAX_ZOOM），NaN zoom→1；②往返恒等（误差 < 1e-9，锚点世界点不动）；③dpr≤0 回落 1，backing store = CSS×dpr；④变换序严格为 `scale(dpr)→clear→translate(pan)→scale(zoom)`；⑤覆盖层与渲染层用同一份世界→屏幕换算（无静默按局部坐标落位） | zoom 0.01/0.02/256/300/NaN；dpr 0/-1/1.5；锚点 (720,450) | vitest 单测@packages/engine（viewport clamp）+ @apps/web（renderer 假 canvas 断言变换序） | packages/engine/src/interaction/viewport.ts L18-35；renderer.ts L125-163；text-overlay.tsx（共享 viewport-map 换算） |

### 3.3 编辑器交互与本地功能（TC-UIX-01…08）

| 用例ID | 模块 | 优先级 | 测试类型 | 前置条件 | 操作步骤 | 预期结果 | 测试数据 | 自动化建议 | 追溯 |
|---|---|---|---|---|---|---|---|---|---|
| TC-UIX-01 | 文本编辑·IME | P0 | 兼容性 | 画布含 text 节点；双击进入编辑（DOM textarea 覆盖层） | ①focus 后触发 compositionstart→compositionupdate（插入「设计」拼音串）→compositionend；②组合期间模拟 blur；③组合完成后 blur（正常提交）；④对提交后文档 `undo()` 一次 | ①组合期间引擎编辑缓冲随 onChange 同步但**不产生任何命令/历史条目**（commit 仅 blur/⌘⏎ 两路）；②「取消后紧跟 blur 不提交」护栏不被 IME 误触发（cancelledRef 语义）；③blur 后历史**恰新增 1 条** `node.update`；④一次 undo 回退**整段**编辑（文本回到编辑前） | 中文 IME 序列「sheji→设计」；对比组：Esc 取消后 blur（历史不变） | RTL 组件测试@apps/web（react 合成事件 fireComposition* + 命令栈 history 断言；真实 IME 行为补充手工验证） | apps/web/src/features/canvas/ui/text-overlay.tsx L118-131、L156-163（失焦提交/Esc 取消）；packages/engine/src/interaction/text-edit.ts L95-110（会话产出单条 node.update） |
| TC-UIX-02 | 快捷键·编辑态屏蔽 | P1 | 功能 | 画布选中节点；先未进入编辑、再进入文本编辑态两轮 | ①未编辑态依次派发 Delete / mod+[ / mod+] / mod+= / mod+- / mod+0 / Shift+1 / Shift+R / Enter / 方向键；②进入编辑态重复①；③编辑态派发 Escape；④宿主 input/textarea 聚焦时派发同组键 | ①全部命中（`handleKeyDown` 返回对应 id）；②除 `whileEditing` 条目外**全部返回 null**（不执行删除/层级/缩放/微移，按键让给文本编辑）；③Escape 命中（取消编辑）；④宿主输入框内不劫持（DOM 自处理） | SHORTCUTS 全表键位；编辑态判定 = `session.store.getState().editing !== null` | vitest 单测@apps/web（`input/keyboard.ts` 纯函数分派，已有测试扩展 whileEditing 矩阵） | apps/web/src/features/canvas/input/keyboard.ts L309-319（抑制规则）、L333-336（空格手型屏蔽） |
| TC-UIX-03 | 版本快照·回滚链路 | P0 | 功能 | 编辑器载入文档；localStorage 后端（测试用 memory backend）；版本抽屉打开 | ①编辑文档（rect 移位）→建快照 V1；②再改文档→选中 V1→`beginCompare`（第一步）→断言文档未变→`confirmRestore`（第二步）；③列出快照并断言新增条目；④对恢复后文档 `undo()`；⑤构造缺 pages 字段的损坏快照→confirmRestore | ①V1 持**当时文档深拷贝**（后续编辑不影响）；②第一步绝不碰文档；第二步向命令栈落 1 条 `document.replace`（label『恢复版本』），**且落前先自动存一份「回滚前快照」**（当前态可再回来）；③快照列表新→旧排序含自动快照；④undo 成功→文档回到回滚前状态（回滚可撤销）；⑤损坏快照被结构校验整体拒绝：文档/历史不变、不崩 | localStorage 键 `dfg:versions:<docId>`；两份快照（V1 人工 + 回滚前自动）；损坏 fixture：`{id,label,createdAt}` 缺 document | vitest 单测@apps/web（`src/verify/versions-rollback.test.ts` 已覆盖两步确认+损坏快照，本用例收口为回归链） | apps/web/src/features/editor-review/versions/versions-store.ts L124-138（回滚前自动快照）；snapshots.ts L186-188（restoreCommands）；src/verify/versions-rollback.test.ts |
| TC-UIX-04 | 评论·状态机 | P1 | 功能 | memory backend（键 `dfg:comments:<docId>`）；空线程表 | ①`createThread`（正文合法）→读状态；②`replyToThread` 追加回复；③`resolveThread` 后再 `replyToThread`；④`reopenThread` 后再回复；⑤空正文创建/回复；⑥`groupThreads` 分组 | ①`resolved=false`、isEditable=true；②回复追加成功且正文 trim；③抛 `CommentError('resolved-thread')`——已解决线程禁回复；④重开后回复成功、`resolved=false`；⑤抛 `CommentError('empty-body')`（`isValidBody` 拦截）；⑥open/resolved 两组互斥且组内新→旧排序 | 正文「设计稿第 2 版布局问题」；空串/纯空格正文；回复 2 条 | vitest 单测@apps/web（`comments/threads.ts` 纯函数 + `storage.ts` 形状过滤） | apps/web/src/features/editor-review/comments/threads.ts L88-123（状态机）、storage.ts（dfg:comments:<docId> 兜底口径） |
| TC-UIX-05 | 回收站·50 条上限 | P1 | 边界 | memory backend 种入 50 条合法记录（键 `dfg-home-trash-v1`） | ①追加第 51 条新 id 记录；②读回长度与首尾；③追加与已有同 id 的记录；④种入坏数据（非法 JSON / 数组含缺 name 项）→`parseTrashRecords` | ①长度恒 **50**（`TRASH_RECORD_LIMIT`），最老一条被淘汰，新记录在最前；②读回 `parseTrashRecords(serializeTrashRecords(...))` 往返一致；③同 id 直接去重返回原数组（不重复、不淘汰）；④坏 JSON→[]、坏项丢弃、合法项保留——**不抛错不整块清空** | 50 条 `{id:doc_i, name, deletedAt}` + 第 51 条；坏数据：`'not-json'`、`[{"id":"x"}]`（缺 name） | vitest 单测@apps/web（`home/lib/trash.test.ts` + `home-store.test.ts` 已有，补 51 条淘汰序断言） | apps/web/src/features/home/lib/trash.ts L21-63（TRASH_RECORD_LIMIT=50、appendTrashRecord）；home/state/home-store.ts L106-108 |
| TC-UIX-06 | 设置·凭据流 | P1 | 安全 | daemon 临时实例（fastify inject）+ 设置页 RTL（注入假 SettingsApi） | ①输入合法 key（sk- 前缀长串）→保存→`PUT configCredentialsSet`；②输入非法形态（无 sk- 前缀）→保存；③保存成功后读界面回显与 DOM；④响应体核查；⑤清除 key→`DELETE`→AI 降级态 | ①daemon 校验通过，响应**只含** `summary.maskedKey`（形如 `sk-…abcd`），明文不出响应作用域；②fail 信封 `code='credential_invalid'`（「API key 形态不合法」）；③输入框固定 `type="password"`，页面任何 DOM/状态中检索不到明文 key（双向掩码纪律）；④明文仅出现在请求 body，不进响应/日志；⑤清除后 `summary.hasKey=false`、清除按钮随 `source==='env'` 语义隐藏 | 合法 `sk-abcdef1234567890`；非法 `xyz`；maskedKey 断言 `sk-…abcd` | daemon 集成@apps/daemon（fastify inject，`routes/config.test.ts` 模式）+ RTL@apps/web（settings-page 假 api 注入） | apps/daemon/src/routes/config.ts L102-119（响应只回掩码）；settings/api/settings-api.ts（明文不出调用栈）；components/sections.tsx L141-142（password 掩码纪律） |
| TC-UIX-07 | 命令面板·缺陷回归 | P0 | 功能 | 生产构建；回归断言对 UX 审计 §3.3 三项缺陷 | ①静态断言：`features/command-palette/command-palette.css` 被构建产物 import（审计时 25 条规则全仓零 import）；②编辑器按 ⌘/ 与 ⌘K 各一次；③首页/设置页按 ⌘K；④打开后视觉断言面板卡片样式（边框/遮罩/居中）；⑤速查卡视口内可见 | 目标态：①css 存在至少 1 处 import（或 `.dfg-cmdk` 计算样式含 border/背景）；②两个键位均可开面板（键位与清单一致，当前实现仅注册 ⌘/，register.tsx:42）；③首页/设置有入口；④面板为带遮罩居中卡片非裸输入框；⑤速查卡完全在视口内。**当前态为缺陷态：①②③④⑤应判红 → 按门禁三态语义阻塞（exit 2），修复后转绿，禁假绿** | 键位对：⌘K（审计清单 E7）vs ⌘/（实现注册）；断言元素 `[data-df-command]`/`.dfg-cmdk` | RTL@apps/web（registerCommandPalette 开关语义）+ playwright 浏览器门禁（e2e:smoke 或 verify:canvas 挂点，断言计算样式与键位） | docs/quality/ux-audit-2026-10-30.md §3.3；command-palette.css（25 条规则）；register.tsx:42；editor-shell.css:354（迁移注释） |
| TC-UIX-08 | 分享按钮·禁用态 | P1 | 功能/a11y | 编辑器顶栏渲染；命令注册表无 `share.open` 注册（现状） | ①渲染 `EditorTopbar`→定位分享按钮（`data-df-command="share.open"`）；②读 disabled 属性与禁用原因 tooltip；③点击按钮→断言无命令执行副作用；④向注册表注册同名命令（测试桩）→再读按钮态 | ①按钮存在且为 primary 变体；②`disabled=true` 且 `disabledReason` 渲染 t('editor.action.pending')（「尚未接入」语义，非静默假按钮）；③点击为 no-op；④注册后按钮**自动变可点**（入口跟着命令表亮，无需改 UI 代码）；⑤a11y：禁用态有可感知的原因文本而非仅视觉置灰 | 命令 id `share.open`（RESERVED_COMMAND_IDS，tools.ts:64）；测试桩命令注册/注销 | RTL 组件测试@apps/web（topbar + command-entry，`useCommandEntry` 状态断言） | apps/web/src/features/editor-shell/ui/topbar.tsx L66-70；ui/command-entry.tsx L51-97（未注册=禁用+原因）；tools.ts:63-64 |

### 3.4 文档存储与文件系统持久化（TC-DOC-01…12）

> 分区口径：所有锚点已读仓核实（代码路径:行号）；daemon 用例一律自起临时实例（临时数据根 + 空闲端口，禁连真实 daemon/~/.dforge，禁 /tmp 做工作树）；错误码 HTTP 状态映射真源 `packages/contracts/src/ipc/errors.ts:58-90`（doc_invalid_manifest=422、doc_exists/doc_last_page/conflict=409、doc_not_found/export_page_not_found=404、doc_invalid_*=400、export_render_failed=500）。标「缺口」的为现有 13 个 daemon 测试文件 / web 侧既有用例未覆盖、需新增的项。

| 用例ID | 模块 | 优先级 | 测试类型 | 前置条件 | 操作步骤 | 预期结果 | 测试数据 | 自动化建议 | 追溯 |
|---|---|---|---|---|---|---|---|---|---|
| TC-DOC-01 | 文档存储·CRUD 生命周期 | P0 | 功能 | 自起 daemon（临时数据根+空闲端口）；workspace 内无同名 `.dfg` | ①POST /documents {name:'测试文档 A'} ②GET /documents/:id ③PUT /documents/:id/pages/page-1 保存正文 ④GET 读回该页 ⑤PATCH /documents/:id 重命名 ⑥GET /documents 列表 ⑦直接读盘 `<workspace>/<id>.dfg/manifest.json` 与 `pages/page-1.json` | ①201 且 document.pageCount=1 ②200 字段同①、directory=绝对路径 ③④200 正文保真 ⑤200 且 name 变、id/目录不变 ⑥恰 1 项、按 updatedAt 倒序 ⑦manifest.json 可 JSON.parse 且 schema='df.dfg.manifest/v1'、version 自增、pages 含 page-1（'页面 1'）；目录内无 `.*.tmp` 残留 | name='测试文档 A'（中文+空格→id 空白转 `-`）；正文 `{$format:'dforge.canvas.page',$version:1,page,tokens}` | daemon 集成@自起临时实例（createTestDaemon + app.inject）；可挂 verify:daemon 契约冒烟。现覆盖：documents.test.ts:20-76 | apps/daemon/src/documents/store.ts:307-351,361-384; apps/daemon/src/routes/documents.ts:57; packages/contracts/src/documents/index.ts:156-173 |
| TC-DOC-02 | 文档存储·manifest 强校验 | P0 | 安全 | 临时数据根；绕过 API 手工伪造 `<id>.dfg/manifest.json`（模拟克隆来的不可信目录） | ①写截断 JSON 的 manifest ②GET /documents/:id ③GET /documents ④换 schema 字段非法的 manifest 再测 ②③ ⑤manifest pages[].id='..%2Fx' 再测 ②③ ⑥删掉 manifest 再 GET | ②422 {error:{code:'doc_invalid_manifest'}} ③列表跳过该目录且 warnings 含 {code:'manifest_invalid'}、其余文档照常返回 ④422 ⑤422 且未读写任何 pages 文件（树外零副作用）⑥404 doc_not_found（missing 与 invalid-json 是不同分支） | 截断串 `{"schema":"df.dfg.manifest`；schema='df.dfg.manifest/v2'；pages:[{id:'..%2Fx',name:'x',updatedAt:''}] | daemon 集成@自起临时实例。现覆盖：documents.test.ts:121、documents.security.test.ts:222-263 | apps/daemon/src/documents/store.ts:180-214,286-305; apps/daemon/src/fs-atomic.ts:54-68; packages/contracts/src/documents/index.ts:156-173 |
| TC-DOC-03 | 文档存储·正文嵌套深度边界 | P1 | 边界 | 已建文档与 page-1 | ①PUT page-1 body=嵌套链长 1023 层 ②链长 1024 层 ③链长 1025 层 ④链长 1026 层 ⑤GET 回读①的正文 | ①②③200 且 manifest version 各 +1 ④400 {code:'doc_invalid_body', details.maxDepth=1024} 且不落盘、version 不变 ⑤正文逐字节保真。计数口径按 exceedsJsonDepth（根=第 0 层，判 depth>1024）：链长≤1025 接受、1026 拒——本用例同时固化该 off-by-one 语义，防实现改判时无报警 | 生成器 `nested(n)`=n 层对象逐层包裹（最内层 {}）；各档 n=1023/1024/1025/1026 | daemon 集成@自起临时实例 + exceedsJsonDepth 纯函数 vitest 单测@daemon（path-safety）。现覆盖仅 adversarial.test.ts:226（深嵌套→4xx 不含三档边界） | apps/daemon/src/documents/store.ts:103,472-480; apps/daemon/src/path-safety.ts:162-180 |
| TC-DOC-04 | 文档存储·文档名非法字符与中文 | P0 | 边界 | 临时数据根，空 workspace | ①POST name='' 与 '   ' ②name='.hidden' ③name 含 '/'、'\\'、':'、'*' ④name 65 字符 ⑤name 含控制字符 ⑥name='中文 设计稿' ⑦以同名 NFD 归开形态再 POST | ①400 doc_invalid_name（分因 empty）②③④⑤400 doc_invalid_name（invalid/too_long，分因由 describeDocumentNameIssue 单测固化）⑥201 且 id='中文-设计稿'（trim+空白转 `-`、NFC 归一）⑦NFC 撞同名→409 doc_exists，磁盘仅一个 `.dfg` 目录（NFD/NFC 同名不产生两个目录） | 各档名称字面量；NFD 串用 U+8A2D 分解形构造；65 字=『字』×65 | daemon 集成@自起临时实例 + contracts 纯函数 vitest 单测（describeDocumentNameIssue/isValidDocumentId）。现覆盖：documents.test.ts:53-76、documents.security.test.ts:298-365 | packages/contracts/src/documents/index.ts:111-153; apps/daemon/src/path-safety.ts:60-69; apps/daemon/src/documents/store.ts:316-327 |
| TC-DOC-05 | 文档存储·原子写中途 kill -9 崩溃恢复 | P0 | 故障注入 | spawn 真子进程 daemon（`node src/main.ts --data-root=<临时> --port=<空闲>`），已建文档并成功保存 v1 正文 | ①发起数 MB 大正文 PUT ②写入中途对进程发 SIGKILL（随机延迟 5–80ms，重复 10 轮）③同数据根重启 daemon ④GET manifest 与 page-1 ⑤ls `.dfg/` 与 `pages/` 后再执行一次 PUT+GET | ④manifest.json 与 pages/page-1.json 均可 JSON.parse，读侧只见一致旧态（v1）或一致新态——绝无半截 JSON、绝无 version 与正文错位（manifest 是提交点）⑤允许残留 `.<hex>.tmp` 随机临时文件，但 GET/list/后续写全部不受影响（读只认目标名）；新写入成功后目标文件完整 | 数 MB JSON 正文扩大写入窗口；kill 延迟抖动序列 | daemon 故障注入@子进程 SIGKILL（vitest，POSIX only；断言幂等 10 轮）。缺口：现无覆盖（documents.test.ts:20 仅断言正常路径无残留临时文件） | apps/daemon/src/fs-atomic.ts:29-51,85-96; apps/daemon/src/documents/store.ts:489-491; apps/daemon/src/testing/harness.ts:119-127 |
| TC-DOC-06 | 文档存储·提交顺序故障注入（正文成功、manifest 写失败） | P1 | 故障注入 | vitest 内 vi.mock fs-atomic 的 writeFileAtomic：同一次 savePage 中第 1 次（页面正文）成功、第 2 次（manifest）抛 EACCES；已建文档 v1 | ①PUT savePage v2 正文 ②捕获响应 ③解除 mock ④GET /documents/:id/pages/page-1 ⑤GET /documents/:id | ①返回 5xx 错误信封（失败冒泡，不假成功）④读侧仍见一致 v1：body=v1 正文、manifest version 未自增（读者只见旧/新一致态，绝不出现「v2 正文+旧 manifest」的错位读）⑤列表 sizeBytes/pageCount 自洽 | v1={mark:1}、v2={mark:2} 可区分正文 | vitest 单测@daemon store.ts（mock fs 层，不走 HTTP）。缺口：现无覆盖 | apps/daemon/src/documents/store.ts:242-272,484-497; apps/daemon/src/fs-atomic.ts:29-51; docs/plan/architecture-v1.1.md §5.1 |
| TC-DOC-07 | 文档存储·跨进程并发写 conflict(409) | P1 | 并发 | 同一 DF_WORKSPACE_DIR 起两个 daemon 进程（不同空闲端口），同文档同页 page-1 | ①A/B 两进程各循环 PUT page-1 共 N=40 次（正文带进程标记+序号，Promise.all 全并发）②收集全部响应码 ③终态 GET 读回正文与 manifest | ①每个请求要么 200（写后重读比对一致）要么 409 {code:'conflict'}（重试 3 次用尽），无其他码、无悬挂 ③最终正文=某一次完整提交（非两进程内容混合），manifest version 与成功提交次数自洽、可 JSON.parse | 每请求正文 `proc-A-#i` / `proc-B-#j` 互不相同 | daemon 集成@双子进程（spawn×2，vitest 串行防端口互踩）。缺口：documents.security.test.ts:428 仅进程内并发；跨进程 write-reread-retry 语义无覆盖 | apps/daemon/src/documents/store.ts:106,249-272; apps/daemon/src/mutex.ts |
| TC-DOC-08 | 文档存储·双窗口后写覆盖风险确认 | P1 | 并发 | e2e 环境（真 daemon+生产站），两个浏览器 context 打开同一文档编辑器 | ①窗口 A 画矩形（红色）→保存成功 ②窗口 B（未刷新）改同页矩形（蓝色）→保存成功 ③窗口 A 再保存 ④两窗口各重载读回 | ③后正文为 A 的版本（B 的改动被静默覆盖）——PUT 无条件覆盖同页、无冲突提示、无乐观锁（确认 last-write-wins 为当前行为并在测试报告登记已知风险）④重载后两窗口读到同一最终正文、无半态、无 5xx | 可区分矩形填充色 #FF0000/#0000FF | playwright 双 context（可作 e2e:smoke editor 场景扩展）+ 手工确认。缺口：现无覆盖 | apps/web/src/features/canvas/persistence/documents-client.ts:168-175,218-240; apps/daemon/src/documents/store.ts:456-500; scripts/e2e/scenarios/editor.mjs |
| TC-DOC-09 | 文档存储·进程内 mutex 串行读改写 | P0 | 并发 | 单 daemon 进程，已建文档（1 页） | ①Promise.all 并发 20×POST /documents/:id/pages（建页）②混合 12×PUT 不同页 + 10×PUT 同一页 ③读回 manifest 与 `pages/` 目录清单 ④断言 lock 泄漏 | ①全 201、page-2…page-21 齐全无丢失（已回 201 的页面不被覆盖丢弃）③manifest.pages 与磁盘 pages/*.json 一一对应、version 与成功提交次数一致；同页 10 次保存终态=其中一次完整正文 ④keyed mutex size() 归 0（无锁泄漏） | 正文带序号标记便于终态归属判定 | vitest 单测@daemon（app.inject + Promise.all；进程内语义无端口依赖）。现覆盖：documents.security.test.ts:427-513、adversarial.test.ts:127-193（回归保持） | apps/daemon/src/mutex.ts; apps/daemon/src/documents/store.ts:483,513,545 |
| TC-DOC-10 | 文档存储·建文档 mkdir EEXIST 原子冲突 | P1 | 并发 | 临时数据根空 workspace | ①单进程 Promise.all 10×POST 同名文档 ②双进程（同 DF_WORKSPACE_DIR、不同端口）各 1×POST 同名 ③POST 与既有文档空白变体同名（'a b' 已存在→POST 'a  b' 归同 id） | ①②每个数据根上恰 1 个 201，其余全部 409 {code:'doc_exists', details.id}；磁盘仅一个 `<id>.dfg` 目录且 manifest 完整可读 ③409 doc_exists（名→id 归一后撞同名） | name='并发文档'；双进程变体端口错开 | daemon 集成@自起临时实例（+双子进程变体）。进程内现覆盖：documents.security.test.ts:463-489；双进程变体缺口 | apps/daemon/src/documents/store.ts:320-330; packages/contracts/src/documents/index.ts:151-153 |
| TC-DOC-11 | 文档存储·删除后落盘一致性 | P0 | 功能 | 已建文档含 2 页（page-1/page-2，均有正文） | ①DELETE /documents/:id/pages/page-2 ②查 manifest 与 pages 目录 ③DELETE page-1（最后一页）④DELETE /documents/:id ⑤GET /documents/:id ⑥GET /documents ⑦再次 DELETE 同 id ⑧ls workspace | ①200 且 manifest.pages 仅剩 page-1、version+1、pages/page-2.json 已物理消失（manifest 先提交、正文后删）③409 {code:'doc_last_page'}（页面常驻 ≥1）④200 {id,deleted:true} ⑤404 doc_not_found ⑥列表不含该文档 ⑦404 ⑧`<id>.dfg` 目录整体不存在（物理 rm -rf、无软删除、无墓碑） | 正文各写标记内容 | daemon 集成@自起临时实例。现覆盖：documents.test.ts:228-276、documents.security.test.ts:163-219 | apps/daemon/src/documents/store.ts:536-574,386-425,422; apps/daemon/src/path-safety.ts:143-155 |
| TC-DOC-12 | 文档存储·version 自增与 $version 只读不迁移风险 | P2 | 边界 | 已建文档（manifest version=1）；web 侧 documents-client 可注入 fetch | ①依次 savePage/rename/createPage/deletePage 各 1 次记录 version ②PUT 正文 {$format:'dforge.canvas.page',$version:99,…} ③GET 读回 ④前端 loadDesignDocument 读该文档 ⑤手工写非本格式正文（如 [1,2,3]）再前端加载 ⑥git diff `.dfg` 目录 | ①每次操作 version 严格 +1（无跳变无回退）②③daemon 原样落盘读回 $version:99——daemon 不校验不迁移 $version（只读透传，版本迁移不存在）④$version≠1 不触发迁移：decodePageBody 按 format 命中解出或按结构错误上报，绝不静默丢数据 ⑤非本格式且非空→前端报「文档结构非法」（不吞别人数据）⑥manifest diff 干净可读（仅 version/updatedAt 行变化） | $version:99 信封；非法正文 [1,2,3] | daemon 集成@自起临时实例 + vitest 单测@web documents-client（decodePageBody/loadDesignDocument，fetch 注入）。缺口：$version 只读语义现无显式用例 | apps/daemon/src/documents/store.ts:378,493,527,563; apps/web/src/features/canvas/persistence/documents-client.ts:16-25,200-211,249-289 |

### 3.5 导出与导入（TC-EXP-01…06）

| 用例ID | 模块 | 优先级 | 测试类型 | 前置条件 | 操作步骤 | 预期结果 | 测试数据 | 自动化建议 | 追溯 |
|---|---|---|---|---|---|---|---|---|---|
| TC-EXP-01 | 导出·PNG 产物格式正确性 | P0 | 功能 | 已建文档；页面正文含已知几何（background #FFFFFF、rect #FF0000@(10,10,100,50)、ellipse #00FF00） | ①POST /export {format:'png',scale:1} ②base64 解码断言魔数 89504E470D0A1A0A ③解析 IHDR（宽高/位深/色型）④逐像素断言背景与矩形/椭圆填充色 ⑤scale=2 重复①-④ ⑥检查落盘与 sha256/length 自洽 ⑦scale=0 与 scale=9 | ①200 artifact.mimeType='image/png' ②③真 PNG（任意标准解码器可开）：IHDR 位深 8、色型 6(RGBA)、宽高=场景×scale ④像素色值精确 ⑤尺寸×2 ⑥`<dataRoot>/exports/<docId>-<pageId>.png` 存在且 sha256、length 与响应一致 ⑦scale=0→400 bad_request；scale=9→钳制为 4（响应 maxScale=4） | 上表几何；scale 序列 0/1/2/4/9 | daemon 集成@自起临时实例（app.inject+PNG 解码）。现覆盖：export.test.ts:120-145、adversarial.test.ts:356-421（回归保持） | apps/daemon/src/export/png.ts:184-205; apps/daemon/src/export/index.ts:18,35-39; apps/daemon/src/routes/export.ts:37-41,66-83 |
| TC-EXP-02 | 导出·PNG 已知缺陷确认（文本/位图跳过） | P1 | 边界 | 已建文档；页面正文同时含 rect、text（'标题'）、image 三类节点 | ①POST /export {format:'png'} ②断言响应码与 skippedNodes ③像素断言 text/image 覆盖区域 ④同场景导出 SVG 对照 ⑤报告登记 | ①200 不报错——文本与位图跳过是**静默降级**（过渡实现口径）②skippedNodes 计数反映被跳过节点 ③text/image 区域仍为背景色（PNG 光栅化明确排除 text/image，无占位）④同场景 SVG 含 `<text>`（差距仅在 PNG 光栅化层，SVG/PDF 侧文本行为不同）⑤差距如实写入测试报告，作为引擎序列化接入后的回归基线 | text 节点 fontSize=24 置于场景中央便于像素采样 | daemon 集成@自起临时实例。缺口：现无文本跳过的显式像素断言（export.test.ts:120 仅矩形/椭圆） | apps/daemon/src/export/png.ts:5-7,132-149; apps/daemon/src/export/scene.ts:117-122; apps/daemon/src/routes/export.ts:95-99 |
| TC-EXP-03 | 导出·SVG 文本 sans-serif 降级与 XML 安全 | P1 | 功能 | 已建文档；正文含 text 节点（内容含 `<script>alert(1)</script>`、fill、fontSize=20）与 image 节点 | ①POST /export {format:'svg'} ②产物（注释头+`<svg>`）过 XML 解析器 ③断言 `<text>` 元素与 font-family ④检查转义 ⑤image 节点产物形态 ⑥viewBox/背景 rect ⑦落盘+sha256 | ①200 mimeType='image/svg+xml' ②XML 可解析、无未闭合标签 ③文本用 `<text font-family="sans-serif">`——不嵌字体、不做文本度量（B 级视觉等价降级，登记口径）④`<>&"'` 全部实体转义、无未转义脚本内容（XML 注入面为零）⑤image→占位 `<rect fill="none" stroke="#B3B3B3">` ⑥viewBox=场景宽高、含背景 rect ⑦exports 落盘自洽 | text 内容=『`<script>alert(1)</script>`』；image 节点带几何 | daemon 集成@自起临时实例（DOMParser/xml 解码断言）。现覆盖：export.test.ts:78-118（转义断言需复核补强） | apps/daemon/src/export/svg.ts:11-18,34-43,54-68; apps/daemon/src/export/index.ts:52-61 |
| TC-EXP-04 | 导出·PDF-1.4 手写结构可解析 | P1 | 功能 | 已建文档；正文含 background+rect+ellipse（几何已知） | ①POST /export {format:'pdf'} ②断言首字节 '%PDF-1.4' 与结尾 '%%EOF' ③按 startxref 偏移逐项复核 xref 表（10 位偏移+` 00000 n `）与各 obj 起始 ④trailer /Size /Root 1 0 R ⑤独立 PDF 解析器打开（pdf-lib 或同类）⑥断言 /MediaBox=[0 0 W H]、/Count 1 ⑦同场景二次导出比对 sha256 | ②③④结构合法：xref 偏移精确指向对象、xref 段 0000000000 65535 f 头正确 ⑤解析成功零致命错误（若解析器拒绝，记缺陷并按阻塞语义上报，不静默放行）⑥单页、页面尺寸=场景宽高 ⑦字节级一致（确定性输出：不含生成时间等易变字段） | 上表几何；两次连续导出 | daemon 集成@自起临时实例+解析器断言。现覆盖：export.test.ts:146-169（结构自检）；独立解析器交叉验证待补 | apps/daemon/src/export/pdf.ts:64-102; apps/daemon/src/routes/export.ts:62-83 |
| TC-EXP-05 | 导出·15s 超时与失败码分派 | P0 | 故障注入 | web 侧 export-client（fetchImpl 注入）；daemon 集成环境 | ①注入永挂起 fetch+timeoutMs=20 调 exportDocument ②fetch 直接 reject（连接拒绝）③daemon 返回非 JSON 信封 ④daemon 500 {code:'export_render_failed'} ⑤断言缺省 timeoutMs 常量 ⑥真实大页面导出计时 | ①{ok:false,code:'timeout'} 不悬挂（AbortController 主动 abort + Promise.race 双保险，任何 fetch 实现下都收敛）②code='daemon_offline'（与超时区分，面板出「本地服务未启动」文案）③code='daemon_invalid_response' ④解包为 code='export_render_failed' 原样透传 ⑤缺省=15000ms ⑥正常 200 且耗时<15s（回归防劣化） | 挂起 fetch=never-resolve Promise；500 响应体按 daemon 信封伪造 | vitest 单测@web export-client（注入替身；15s 用常量断言而非真实等待）。现覆盖：export-client.test.ts:87-174；缺省常量断言待补 | apps/web/src/features/inspect-export/model/export-client.ts:51,56-84,100-110; apps/daemon/src/routes/export.ts:62-64 |
| TC-EXP-06 | 导出·产物文件名路径安全 | P0 | 安全 | 已建正常文档；另备恶意 id 序列；exports 目录已建 | ①POST /export documentId='..%2Fvictim' ②documentId 含 NUL（'a%00b'）与控制字符 ③手工伪造 manifest pages[].id 越界后对合法 docId 导出 ④正常导出后 ls `<dataRoot>/exports/` ⑤中文 id（'中文-设计稿'）正常导出 ⑥树外预置 victim 文件内容比对 | ①②400 {code:'doc_invalid_id'}（读页前置即拒；错误消息与 details 不回显原始 id、不泄漏目录布局）③422 doc_invalid_manifest（恶意页 id 整体拒绝）④产物名恰为 `<documentId>-<pageId>.<format>` 且只出现在 exports/ 内——fileName 一律经 resolveWithin 二次把关，越界→export_render_failed 拒写 ⑤中文 id 产物正常 ⑥树外文件零改动 | id 序列：'..%2Fvictim'、'a%00b'、'中文-设计稿'；树外哨兵文件 | daemon 集成@自起临时实例（含树外哨兵断言）。现覆盖：documents.security.test.ts:88-160、adversarial.test.ts:82-125；export 链路特化断言待补 | apps/daemon/src/routes/export.ts:43-51,68-73; apps/daemon/src/export/index.ts:50; apps/daemon/src/path-safety.ts:123-137 |

### 3.6 浏览器本地态（TC-LS-01…05）

| 用例ID | 模块 | 优先级 | 测试类型 | 前置条件 | 操作步骤 | 预期结果 | 测试数据 | 自动化建议 | 追溯 |
|---|---|---|---|---|---|---|---|---|---|
| TC-LS-01 | 本地态·配额满写入行为 | P1 | 故障注入 | jsdom/内存后端注入 createLocalStore（comments + versions 两条链路） | ①注入 setItem 恒抛 QuotaExceededError 的后端 ②提交一条评论 ③保存一个版本快照（快照含全文档，体积最大最易触顶）④断言 onWriteError spy ⑤换回正常后端再 load | ②③不抛错、UI 内存态照常更新（commit 先 storage.save 后 set——save 吞错后 set 仍执行）④onWriteError 收到原始 error 对象（供上层提示「本地保存失败」，不白屏）⑤load 只返回此前成功持久化的条目；失败那次不持久化、不产生半条记录 | throw 后端 spy；合法 CommentThread/VersionSnapshot 各 1 条 | vitest 单测@web editor-review（storage/comments-store/versions-store 三层）。现覆盖：storage.test.ts:69-74；versions-store 配额场景待补 | apps/web/src/features/editor-review/storage.ts:74-87; apps/web/src/features/editor-review/comments/comments-store.ts:101-108 |
| TC-LS-02 | 本地态·隐私模式/禁用 localStorage 降级 | P1 | 边界 | web 组件测试环境（backend 可注入）；真实浏览器备用 | ①backend=undefined（模拟 browserBackend 无 window/localStorage）②load 评论与版本 ③save 写入 ④backend.getItem 恒抛 SecurityError（模拟隐私模式）⑤真实浏览器隐私模式打开编辑器手工走查 | ②返回 [] 不抛错 ③静默空操作（不崩、无未捕获异常）④load 捕获后返回 []（getItem try/catch 分支）⑤编辑器/评论/版本面板全部可用，仅「重开不恢复」降级语义；无白屏、无报错弹窗 | 抛 SecurityError 的后端替身 | vitest 单测@web storage.ts（注入替身）+ 手工@真实浏览器隐私模式。现覆盖：storage.test.ts:63-67（无后端分支）；隐私模式手工走查待补 | apps/web/src/features/editor-review/storage.ts:42-46,49-71,74-87 |
| TC-LS-03 | 本地态·坏 JSON 逐条丢弃不崩 | P0 | 边界 | 内存后端预置坏数据 | ①向 dfg:comments:<docId> 分别写 'not json'、'{"a":1}'、含坏项的数组 ②向 dfg:versions:<docId> 写缺 pages 字段的快照数组 ③向 dfg-home-trash-v1 写坏项数组与非数组 ④三处 load ⑤UI 打开对应面板 | ④一律返回过滤后的合法条目或 []，绝不抛错；非数组 JSON→[]；坏项逐条丢弃、同数组内合法项保留 ⑤评论/版本/回收站面板空态或部分数据渲染，无白屏无崩溃（存储是可丢缓存） | 4 类坏串×3 键；坏项=缺 id/comment 的对象 | vitest 单测@web editor-review storage + home trash。现覆盖：storage.test.ts:49-61、trash.test.ts:24-33（回归保持） | apps/web/src/features/editor-review/storage.ts:49-71,114-147; apps/web/src/features/home/lib/trash.ts:39-48 |
| TC-LS-04 | 本地态·版本/评论键跨文档隔离 | P1 | 功能 | 内存后端；docA 与 docB 两个 comments/versions store 实例 | ①docA 写 2 条评论+1 个版本快照 ②读 docB 的评论与版本 ③DELETE /documents/docA（daemon 物理删除+记回收站）④再读 docB ⑤重开 docA 对应编辑器 | ②docB 均为空（键 dfg:comments:docA ≠ dfg:comments:docB，零串扰）④docB 数据完好 ⑤docA 键空间残留（当前实现：daemon 删除不清理 localStorage 的 dfg:* 键——已核 trash/home 无清理路径）；残留键按文档 id 隔离不污染其他文档，作为已知口径登记 | docId='doc-a'/'doc-b'；合法线程/快照各若干 | vitest 单测@web editor-review（同 backend 双实例）。缺口：现无跨文档隔离显式用例 | apps/web/src/features/editor-review/storage.ts:104-111; apps/web/src/features/editor-review/comments/comments-store.ts:89-96; apps/web/src/features/home/state/home-store.ts:106-114 |
| TC-LS-05 | 本地态·回收站流水与物理删除正文不一致 | P2 | 边界 | 已建 docX；home 场景（真 daemon 或 mock DELETE 均可） | ①DELETE /documents/docX ②读 dfg-home-trash-v1 ③手工篡改流水：追加一条 id 指向不存在文档的记录 ④渲染回收站分区 ⑤对同一文档 id 重复触发删除 ⑥造 51 条记录 ⑦点遍回收站所有可交互元素 | ②记录 {id,name,deletedAt} 落键 ④回收站如实展示记录、**无「恢复」按钮**（daemon 物理删除正文不可恢复——恢复出空文档比不给更糟），记录不依赖 .dfg 存在性校验、不因正文缺失报错 ⑤appendTrashRecord 同 id 去重只留 1 条 ⑥截断最老保留 50 条（TRASH_RECORD_LIMIT）⑦无「彻底删除」之外的动作产生「已恢复」假象 | 51 条合成记录；篡改流水=合法形状+不存在 id | vitest 单测@web trash + RTL 组件@TrashList。现覆盖：trash.test.ts:42-74、TrashList.test.tsx；与 daemon DELETE 的联动断言待补（e2e home 场景扩展） | apps/web/src/features/home/lib/trash.ts:4-8,21-24,55-68; apps/web/src/features/home/components/TrashList.tsx:6-8 |

### 3.7 AI 文本代理（TC-AI-01…06）

> 分区口径（3.7–3.11）：所有锚点已读仓核实（代码路径:行号）；daemon 用例一律自起临时实例（临时数据根 + 空闲端口，禁连真实 daemon/~/.dforge，禁 /tmp）；统一响应信封成功 `{ok:true,result}` / 失败 `{ok:false,error:{code,message,details?}}`，HTTP 状态码真源 `packages/contracts/src/ipc/errors.ts:58-90`（mcp_ack_invalid=403、mcp_ack_expired=410、mcp_tool_unknown/ai_invalid_request/credential_invalid=400、market_asset_not_found=404）；门禁三态 0/1/2（2=阻塞禁假绿）。标「回归保持」的为现有用例已覆盖、纳入回归集；标「缺口」的为需新增项。

| 用例ID | 模块 | 优先级 | 测试类型 | 前置条件 | 操作步骤 | 预期结果 | 测试数据 | 自动化建议 | 追溯 |
|---|---|---|---|---|---|---|---|---|---|
| TC-AI-01 | AI 两态·降级同构与四步时序 | P0 | 功能 | daemon 临时实例（临时数据根+独立端口）；态A 无 DF_DEEPSEEK_API_KEY 且无凭据库；态B 本机 mock 上游（OpenAI 兼容 SSE，不出机）+ 哨兵 key | ①态A GET /ai/status 读信封；②态A POST /ai/chat（stream:true）读 SSE 全文；③态A POST /ai/chat（非流式）；④态A stream:true 发空 messages；⑤态B PUT /config/credentials（哨兵 key）→ PUT /config（ai.baseUrl→mock）→ stream:true 请求逐帧收集 delta；⑥对②⑤原文喂前端适配层 createAiRunReader 读 timeline | ①200 + result.configured=false + degradedHint 非空字符串；②帧序 start(degraded:true)→done（无 delta），done.response 与真响应同构：degraded=true / degradedReason='no-credentials' / finishReason='degraded' / suggestions 数组；③200 同构降级（同一形状口径）；④SSE 通道已建立 → HTTP 200 + `event: error` 帧 code=ai_invalid_request（不换形状出 JSON 400）；⑤start(degraded:false)→delta*→done，done.response.content=mock 三段拼接、degraded=false、usage.totalTokens=16（mock 注入值）；⑥两态 timeline 均严格 queued>llm>validate>compile、snapshot.phase='done' | 哨兵 key `sk-verify-FE10-AI-0123456789-zzzz`；mock deltas ['按钮组','已按','设计令牌生成']；非法请求体 `{messages:[]}` | 脚本门禁 verify:ai-two-state（态A/态B/UI 挂载段已实现——回归保持）+ daemon 集成@临时实例+mock 上游（routes/ai.test.ts 两态/请求校验已覆盖——回归保持） | scripts/verify-ai-two-state.mjs:42-46,319-323,403-415；apps/daemon/src/ai/client.ts:79-97,303-315；apps/daemon/src/routes/ai.ts:16-25,45-54；apps/web/src/features/ai/stream.ts；docs/plan/architecture-v1.1.md §4.5.1/§5.6 |
| TC-AI-02 | SSE 异常·断流/半行/上游非 200 | P0 | 故障注入 | daemon 临时实例 + 可编程 mock 上游（分档：非 200 / 半行拆帧 / 中途断流 / 非 event-stream / 零 data） | ①上游 503 → stream:true 请求收全帧；②上游 200 但 content-type=application/json（一次性 JSON 体）；③上游 200 + event-stream 但一条 data 都没有；④上游把一条 `data: {...}\n\n` 拆成两个 TCP chunk（半行）再补全，随后正常 finish_reason:stop+[DONE]；⑤流以残行结束（最后半行无换行即 EOF）；⑥上游写到一半 socket.destroy()（断流）；⑦客户端（fetch 读到一半）AbortController.abort() | ①start→done(degraded，reason='upstream-error')，无 delta 帧——流式**不重试**；②done(degraded reason='invalid-response')（200 但非事件流不假成功）；③同②（零 data 帧同判 invalid-response）；④delta 完整解析出该条（缓冲按换行切分残行保留回填）；⑤残行静默丢弃，done 按已累积 content 收尾（不悬挂不假成功）；⑥done(degraded reason='upstream-error'，partialContent=断流前已累积内容)；⑦立即中止上游读取、不再产出任何帧、连接正常收尾 | mock 上游分档脚本（503 / JSON 体 / 空 event-stream / 跨 chunk 拆帧 / destroy）；abort 前已收 ≥1 delta | daemon 集成@临时实例+mock 上游（routes/ai.test.ts:354-401 已覆盖非 SSE/零 data/客户端断开——回归保持；**半行拆帧与中途断流两档为缺口**需补 mock 用例） | apps/daemon/src/ai/client.ts:333-365（非 200/非 SSE）、:367-429（缓冲与残行）、:445-459（异常收尾）、:22-25（60s 超时/流式不重试注释） |
| TC-AI-03 | CORS 3.1 缺陷回归（SSE 通道无 ACAO） | P0 | 安全 | daemon 临时实例（默认白名单含 http://localhost:3000 / 127.0.0.1:3000，corsOriginsFromEnv 可覆盖）；回归锚定 ux-audit 断点 3.1 | ①带 `Origin: http://localhost:3000` POST /ai/chat（stream:true，mock 上游）→ 读响应头全量；②同 Origin 非流式对照请求；③带 `Origin: null`（打包壳 file:// 形态）复测①；④真浏览器从 http://localhost:3000 页面调 chatStream 发起生成；⑤修复后重跑①-④作绿判 | **当前缺陷态**：①SSE 响应无任何 access-control-* 头（raw.writeHead 于 routes/ai.ts:33 直写 socket，绕过 cors.ts 的 onRequest 钩子），②非流式对照带 ACAO（缺陷仅流式通道）；③同为无 ACAO；④浏览器必然 `Failed to fetch`（ACAO 缺失被同源策略拦截），抽屉只呈现「排队 失败」。按门禁三态语义该回归**判红/阻塞（exit 2），修复后转绿，禁假绿**。**目标态**：①③响应头含 access-control-allow-origin=<回显 Origin> + vary:Origin + content-type: text/event-stream，④浏览器端正常收到 start→delta*→done | Origin 三档：http://localhost:3000 / null / http://evil.example；请求体 `{messages:[...],stream:true}` | daemon 集成@临时实例（真 listen + fetch 断言响应头；**缺口**：routes/cors.test.ts 只覆盖非流式通道，未覆盖 /ai/chat 流式）+ playwright 浏览器回归（verify:ai-two-state UI 段可承载④，当前未断言 ACAO——缺口） | docs/quality/ux-audit-2026-10-30.md §3.1；apps/daemon/src/routes/ai.ts:32-37；apps/daemon/src/cors.ts:86-110；apps/web/src/features/ai/client.ts:82-106（抽屉只走 chatStream、无降级分支）；scripts/verify-ai-two-state.mjs（UI 挂载段挂点） |
| TC-AI-04 | 3.2 假步骤回归（validate/compile 无 IR 出口） | P1 | 功能 | 前端适配层 createAiRunReader + done 帧；契约与源码静态扫描环境 | ①静态断言 AiChatResponse 字段集；②全仓扫描「AI 文本 → Design IR」编译路径（daemon ai/client.ts 对 @dforge/engine 的 import）；③喂真实 done 帧给 reader，读 timeline 最后两拍与各拍间隔；④渲染态核查：AiDrawer 结果区动作集 | **当前缺陷态（审计证据链断言）**：①AiChatResponse 仅 content:string，无 IR/ops/事务字段（packages/contracts/src/ai/index.ts:64-74）；②零 import——全仓无 AI→IR 编译路径；③done 帧之后**同一拍**推进 validate→compile（stream.ts:144-149），背后无任何校验/编译发生（时序假步骤）；④结果区只渲染文本，无「插入画布/应用/查看 diff」任何动作（AiDrawer.tsx:199-213）。**目标态（修复后）**：validate/compile 要么移除、要么有真实 IR 出口（如 apply→MCP dryRun 提案）；断言随修复改写，修复前不得判绿 | done 帧样例（content=mock 文本、degraded=false）；扫描正则 `from '@dforge/engine'` 限定 apps/daemon/src/ai/** | vitest 单测@apps/web（stream.ts timeline 同拍性——**缺口**，现门禁只断言顺序不断言假步骤）+ 静态扫描（脚本断言 import 集）+ RTL 组件@apps/web（AiDrawer 动作集） | docs/quality/ux-audit-2026-10-30.md §3.2；packages/contracts/src/ai/index.ts:64-84；apps/web/src/features/ai/stream.ts:144-149；scripts/verify-ai-two-state.mjs:319-323（现时序断言=现状形状） |
| TC-AI-05 | BYOK 泄漏防线（响应/日志/审计/遥测不含明文 key） | P0 | 安全 | daemon 临时实例；哨兵 key 经 PUT /config/credentials 注入；mock 上游记录收到的 Authorization；审计与遥测落盘路径就绪 | ①PUT /config/credentials 读响应全文与退出信封；②GET /ai/status 读全文；③stream:true 全帧文本 + 非流式响应全文，检索哨兵 key 明文与显著片段 `FE10-AI-0123456789`；④读 mock 上游收到的 Authorization 头与调用次数；⑤daemon 进程 stdout/stderr 日志全文检索；⑥读 <dataRoot>/audit/mcp-audit.jsonl 与 telemetry/events.jsonl 检索；⑦GET /config/credentials summary 复核 | ①只含 summary.maskedKey=`sk-…zzzz`（maskSecret：保留 sk- 前缀+末 4 位，明文不出响应作用域）；②configured=true 且全文零命中；③零命中（帧内只有 runId/model/content/usage）；④Authorization 恰为 `Bearer <哨兵 key>` 且只在 daemon→上游方向出现（恰 1 次调用）；⑤⑥全部零命中；⑦maskedKey/source/updatedAt 字段，无明文 | 哨兵 key `sk-verify-FE10-AI-0123456789-zzzz`（掩码→`sk-…zzzz`）；检索片段 `FE10-AI-0123456789` | 脚本门禁 verify:ai-two-state 泄漏防线断言已实现（:369-376,417-427——回归保持）+ daemon 集成补审计/遥测落盘面检索（增量） | apps/daemon/src/ai/client.ts:1-9（纪律头注释）、:136-144（Authorization 仅上游方向）；packages/contracts/src/config/index.ts:144-148（maskSecret）；apps/daemon/src/app.ts:107（DF_DEEPSEEK_API_KEY env 优先只读） |
| TC-AI-06 | 上游 5xx/429/超时降级（重试与退避） | P1 | 故障注入 | daemon 临时实例（createAiClient 注入 retryDelaysMs=[300,900] + sleep 即时化）；mock 上游可编程连续失败 | ①上游连续 3 次 500 → 非流式请求；②上游连续 3 次 429；③上游挂起超过超时阈（生产 60s；测试注入短阈值或 mock 延时）；④前 2 次 500、第 3 次 200；⑤上游 200 但 body 非 JSON / choices[0].message.content 缺失；⑥核对上游调用次数 | ①恰 3 次上游调用（初试+2 重试），响应 degraded=true / degradedReason='upstream-error' / finishReason='degraded' / suggestions 含 retry-later+manual-edit；②degradedReason='rate-limited'（429 与 5xx 同退避策略 300/900ms）；③degradedReason='timeout'（超时/网络错误**不重试**立即降级）；④真响应 degraded=false（重试后成功）；⑤degradedReason='invalid-response'（errorBody 只留前 500 字符、不外泄上游体）；⑥①=3 次、④=3 次、③=1 次（不重试） | mock 计数器 + 注入 sleep；errorBody 样本（含长文本验证 500 截断） | daemon 集成@apps/daemon（routes/ai.test.ts:65-140,191-256 已覆盖 5xx/429/invalid-response/重试后成功——回归保持；**超时档挂起注入为缺口**） | apps/daemon/src/ai/client.ts:22-25（UPSTREAM_TIMEOUT_MS=60_000、退避 [300,900]）、:218-226（reasonOf/isRetryable）、:248-284（重试循环与超时映射） |

### 3.8 MCP 提案闸门（TC-MCP-01…06）

| 用例ID | 模块 | 优先级 | 测试类型 | 前置条件 | 操作步骤 | 预期结果 | 测试数据 | 自动化建议 | 追溯 |
|---|---|---|---|---|---|---|---|---|---|
| TC-MCP-01 | 提案→ack→审计全链 | P0 | 功能 | daemon 临时实例（审计路径 <dataRoot>/audit/mcp-audit.jsonl） | ①POST /mcp/proposals {tool:'df_apply_patch', args, caller:'mcp:zcode', documentId} 读 201 信封；②POST /mcp/ack {ackToken, approve:true}；③GET /mcp/audit；④直接读 JSONL 文件核对行数与字段 | ①201 + proposalId（prop_ 前缀）/ dryRun:true / ackToken（48 位 hex）/ expiresAt（≈120s 后 ISO）/ auditId / stub:true / diff 摘要（ops[0].op=工具名、summary 含「桩」说明）；②200 + {proposalId, applied:false, decision:'approved', auditId, note 含「桩实现」}——**桩不真改文档**；③④审计至少 2 条：decision='pending'（提案落档）→'approved'（确认追加），每行字段 auditId/at/caller/tool/proposalId/argsDigest/applied:false 齐全 | args={patchId:'p1', ops:3}；caller 五枚举各抽 1（user/local-ai/mcp:workbuddy/importer 回归轮） | daemon 集成@临时实例（routes/mcp.test.ts:26-95 已覆盖——回归保持）+ 脚本门禁 verify:mcp-stub 态A（回归保持） | apps/daemon/src/mcp/stub.ts:75-136,138-194；apps/daemon/src/routes/mcp.ts:16-86；scripts/verify-mcp-stub.mjs（态A 全链取证）；docs/plan/architecture-v1.1.md §4.5.4 |
| TC-MCP-02 | 重放拒绝 403（一次性 token） | P0 | 安全 | 同 TC-MCP-01 | ①提案取 ackToken；②第一次 ack approve:true；③同一 token 第二次 ack（同参重放）；④伪造不存在 token ack；⑤approve:false 合法走一遍（拒绝路径）后重放 | ②200 approved；③HTTP **403** + error.code='mcp_ack_invalid'（一次性 token 不可复用）；④403 mcp_ack_invalid；⑤拒绝路径 200 decision='rejected'，重放同样 403；③④⑤重放均不新增 approved/rejected 审计行（decision 不被覆盖） | 同一 token 复用 2 次；随机伪造 48 hex token | daemon 集成（routes/mcp.test.ts:97-117 已覆盖——回归保持）+ verify:mcp-stub 态A 重放段（回归保持） | apps/daemon/src/mcp/stub.ts:138-146（consumed 标记）；packages/contracts/src/ipc/errors.ts:85（mcp_ack_invalid→403）；scripts/verify-mcp-stub.mjs 头注释（重放被拒已验证） |
| TC-MCP-03 | 过期 410（TTL 120s / 注入短 TTL） | P1 | 边界 | 同 TC-MCP-01；createMcpStub 可注入 ackTtlMs（测试唯一免 120s 空等观察口） | ①默认 TTL 提案 → 断言 expiresAt 与本地时间差；②注入 ackTtlMs=400ms 提案 → 等 500ms → ack；③过期 ack 后重新提案（同 args）再 ack；④TTL 边界：注入 ackTtlMs 后立即 ack（未过期） | ①差值=MCP_ACK_TTL_MS=120_000ms（±时钟粒度）；②HTTP **410** + error.code='mcp_ack_expired'，审计追加 decision='expired'、applied:false；③新提案新 token 正常走完（过期非粘死态，需重新 dryRun）；④立即 ack 正常 approved（边界内不误杀） | ackTtlMs=400ms（verify-mcp-stub 态B 同款）；边界档 ackTtlMs=50ms 立即 ack | daemon 集成（routes/mcp.test.ts:119-137 注入短 TTL 已覆盖——回归保持）+ verify:mcp-stub 态B（harness ackTtlMs=400ms、证据如实标注——回归保持） | packages/contracts/src/mcp/index.ts:28（MCP_ACK_TTL_MS=120_000）；apps/daemon/src/mcp/stub.ts:147-165（过期标 consumed+审计 expired）；scripts/verify-mcp-stub.mjs:7-11（态B 注入口径） |
| TC-MCP-04 | ackToken/args 只存哈希不落明文 | P0 | 安全 | 同 TC-MCP-01；args 埋标记串 | ①提案 args 塞标记串 'ARGS-PLAIN-xyz' → 收 ackToken；②逐行读 audit JSONL 原文；③独立计算 sha256(JSON.stringify(args)) 与记录 argsDigest 比对；④ack 后再读审计全文；⑤GET /mcp/audit 响应全文检索 | ②JSONL 任何行**不含** ackToken 明文、不含 args 原文/标记串；argsDigest 格式 `sha256:<64hex>` 且与③计算值一致；④ack 后仍零明文（token 只作内存 Map 键，审计仅哈希）；⑤响应同零明文（contract McpAuditRecord 无 token/args 原文字段） | args={'note':'ARGS-PLAIN-xyz','payload':[1,2,3]}；标记串另入 ack 后 note 检索 | daemon 集成（routes/mcp.test.ts:26-56 已断言「token 只以哈希入档」——回归保持）+ verify:mcp-stub（审计留痕段——回归保持） | apps/daemon/src/mcp/stub.ts:60-63（tokenHash）、:84（argsDigest=sha256 前缀串）、:102-123（审计无明文）；packages/contracts/src/mcp/index.ts:61,94-98（契约注释：不得日志/响应外泄） |
| TC-MCP-05 | 前端确认条 stub 语义与失效态 | P1 | 功能 | RTL 环境；McpConfirmBar 注入 dryRun 提案（stub:true）；confirm.ts 适配层可驱动 | ①渲染收到提案的确认条 → 定位角标与 title；②走 approve 确认流程（createConfirmation）→ 断言发出的 ack 请求与结果区；③注入 settleAckError 两态（mcp_ack_invalid / mcp_ack_expired）→ 查提示文案；④静态断言挂点与 zh-CN 消息键 | ①角标「桩」可见（`data-df-stub="true"` + title=t('mcp.stub.desc')）——桩身份显式标注；②确认发 POST /mcp/ack(approve:true)，结果区渲染 applied:false 桩说明（mcp.result.stubNote），不出现「已写入」假成功；③两态均渲染 mcp.error.reissue「需重新发起 dryRun」语义，不崩不假绿；④挂点 `data-df-stub` 与消息键在源码逐字存在（门禁挂点） | 提案 fixture：{tool:'df_apply_patch', stub:true, diff:{ops:[…]}}；失效响应 {ok:false,error:{code:'mcp_ack_expired'}} | RTL 组件@apps/web（McpConfirmBar.test.tsx + McpConfirmBar.adversarial.test.tsx 已覆盖——回归保持）+ verify:mcp-stub 态B 用前端 confirm.ts 复核失效语义（回归保持） | apps/web/src/features/mcp/components/McpConfirmBar.tsx:127-130,172-188；apps/web/src/features/mcp/confirm.ts；scripts/verify-mcp-stub.mjs:8-14（显式桩标注断言） |
| TC-MCP-06 | 审计 JSONL 0600、损坏行容错与契约守卫 | P1 | 安全 | 同 TC-MCP-01；另备损坏 JSONL fixture | ①stat <dataRoot>/audit/mcp-audit.jsonl 权限位；②向文件手插一条非法 JSON 行 + 合法行混排 → GET /mcp/audit；③跑 guard:mcp-contract 记录退出码；④caller 传枚举外值提案；⑤tool 传未知名提案；⑥GET /mcp/audit?limit=0 / limit=5000 | ①权限 **0600**；②非法行跳过、合法行照常返回（不 500 不整文件拒读），记录新→旧（倒序）；③guard:mcp-contract 当前未实现 → **exit 2**（按三态语义阻塞，禁止当绿，接 CI 前不得计入通过链）；④400 bad_request（caller 必须是 user/local-ai/mcp:zcode/mcp:workbuddy/importer 之一）；⑤400 mcp_tool_unknown + details.writeTools=7 个写工具全清单；⑥limit 钳制 1..1000（0/5000 均回退合法区间） | 损坏行 `{oops`；caller:'root'；tool:'df_drop_database' | daemon 集成（routes/mcp.test.ts:139-160 已覆盖④⑤——回归保持；**损坏行混排与权限断言为缺口**）+ 脚本门禁（verify:mcp-stub 已实现；guard:mcp-contract 未实现恒 exit 2） | apps/daemon/src/mcp/stub.ts:70-72（appendJsonLine 0600）、:203-214（单行损坏跳过+limit 钳制）；apps/daemon/src/context.ts:45（audit 路径）；scripts/guard-mcp-contract.mjs（未实现 exit 2 声明）；packages/contracts/src/mcp/index.ts:14-22（7 写工具） |

### 3.9 市场与数据飞轮（TC-MKT-01…05）

| 用例ID | 模块 | 优先级 | 测试类型 | 前置条件 | 操作步骤 | 预期结果 | 测试数据 | 自动化建议 | 追溯 |
|---|---|---|---|---|---|---|---|---|---|
| TC-MKT-01 | BM25 检索与空态 | P0 | 功能 | daemon 临时实例；数据根种入 MK-04 产物 df.marketplace.index.v1.json + market_search_index.v1.json（同目录） | ①GET /market/query?q=幻灯片；②GET /market/query?q=PPT（等价类词项）；③GET /market/query（无 q）；④GET /market/query?q=绝不存在的词xyz；⑤limit=999&offset=-5；⑥带 kind 过滤叠加检索 | ①②HTTP 200、命中数>0（中文重叠二元组切词 + 术语等价类「幻灯片/PPT/deck」互查），排序=归一相关度×质量分，warnings 不含 search-index-*；③state='ok' 全量卡片默认质量分倒序（并列比星标）；④state='empty'、total=0、items=[]——**空态非错误非 500**；⑤limit 钳制 ≤200、offset≥0，total=过滤后总数（分页不虚报）；⑥筛选面与倒排命中求交（kind 外的不进结果） | 产物含含「幻灯片」关键词的 skill 资产 ≥1 条 + 不含词资产对照 | daemon 集成@临时实例（routes/market.test.ts:416-530 已覆盖①-④⑥——回归保持）+ 脚本门禁 verify:market E1/E3（回归保持） | apps/daemon/src/market/service.ts:176-227；apps/daemon/src/market/search-index.ts（与 CLI 同口径消费 @dforge/ingest/ads searchMarketIndex）；scripts/verify-market.mjs（E1 中文检索/E3 统计口径） |
| TC-MKT-02 | 索引损坏降级字面过滤 | P0 | 故障注入 | daemon 临时实例；可编程数据根（六档 fixture） | ①数据根无任何索引 → GET /market/query；②市场索引 JSON 语法损坏 → 同查；③市场索引 schema 不匹配 → 同查；④市场索引正常但检索索引缺失 → GET /market/query?q=幻灯片；⑤检索索引 JSON 损坏 → 同查；⑥检索索引 schema 不符 → 同查；⑦每档统计响应状态码 | ①200 + state='empty' + warnings[0].code='index-missing'（正常空态）；②③200 + state='empty' + 'index-invalid'（**不 500**）；④200 + 命中走字面过滤（大小写不敏感包含匹配 name/displayName/summary/source.repo/tags）+ warnings 含 'search-index-missing'；⑤⑥'search-index-invalid' 同降级字面过滤；⑦①-⑥**零个 5xx**，warnings 均为稳定 code 可断言 | 六档 fixture；坏索引文件内容 `{oops`；schema 串改写为 market.index.v0 | daemon 集成（routes/market.test.ts:92-130,482-530 已覆盖——回归保持） | apps/daemon/src/market/service.ts:53-91（空态/warning）、:113-125（matchLiteral）、:185-193（降级分派）；apps/daemon/src/market/search-index.ts:119-156（warning 码语义） |
| TC-MKT-03 | assetId 详情与容错 | P1 | 边界 | daemon 临时实例 + 正常市场索引（≥1 条资产） | ①GET /market/assets/<真实id>；②GET /market/assets/不存在id；③GET /market/assets/..%2F..%2Fetc%2Fpasswd（穿越形态 assetId）；④POST /market/load-plan {assetId:''}；⑤load-plan 传不存在 assetId；⑥②的响应 details 核对 | ①200 + {found:true, asset}（全字段 facets/quality/installGate）；②404 + error.code='market_asset_not_found' + details.assetId 回显；③404（assetId 仅作索引键等值查找，**绝不作路径拼接/文件读取**，穿越串无副作用）；④400 bad_request（assetId 必须是非空字符串）；⑤404 market_asset_not_found；⑥error 形状为统一 DaemonError（code/message/details） | 真实 id 取 fixture 资产；穿越串与超长串（1e4 字符） | daemon 集成（routes/market.test.ts:238-262 已覆盖①②⑤——回归保持；**③穿越形态与④空串为缺口**需补参数化用例） | apps/daemon/src/routes/market.ts:76-104；apps/daemon/src/market/service.ts:149-153,229-232（仅索引键查找）；packages/contracts/src/ipc/errors.ts:84（market_asset_not_found→404） |
| TC-MKT-04 | load-plan 只读元数据（无代码执行） | P0 | 安全 | daemon 临时实例 + 索引含 installGate 三档资产（loadable/view-only/blocked） | ①对三档各 POST /market/load-plan；②静态扫描 daemon 市场服务/路由源码（exec/spawn/eval/child_process/Function 构造）；③响应字段白名单核查；④loadable 档 ackRequired 与 targetPathHint 联动 | ①三档分别 mode='loadable'（loadable:true + targetPathHint='.dfg/market/<kind>/<name>/' + ackRequired 透传）/ 'view-only' / 'blocked'（后两档 loadable:false + targetPathHint:null）；均含 license{spdx,gate,evidencePath,evidenceSha256}/reasons/notice 三态文案；②扫描 **0 命中**（纯读索引+组元数据，无任何执行面）；③响应只含提案元数据七字段，无执行句柄/命令串/脚本内容；④blocked/view-only 档 hint 恒 null（不给落点防误装载） | 三档 installGate fixture；license evidence 带 sha256 | daemon 集成（routes/market.test.ts:264-414 已覆盖三档结构——回归保持）+ 静态扫描断言（guard:feature-boundaries 同思路，脚本化为增量） | apps/daemon/src/market/service.ts:234-260（loadPlan 纯元数据）、:10（真实写入归 MCP 桩注释）；apps/daemon/src/routes/market.ts:87-104 |
| TC-MKT-05 | ingest 限速熔断与 --replay 离线重放 | P1 | 故障注入 | services/ingest 采集线；注入 Clock（虚拟时间）+ fetch 桩；CI 注入占位 GH_TOKEN + fetch 桩（CI 无 gh 凭据口径） | ①fetch 桩连续返回 403/429 → 跑 collect run 全链；②虚拟时钟下验证令牌桶节奏（core 容量 4/1s、search 2/2.5s=24/分）与串行队列；③--replay 指向 responses.jsonl 样本目录复跑；④无 GH_TOKEN/GITHUB_TOKEN/gh auth token 跑真网模式；⑤核对退出码映射链 | ①连续限速抛 ConsecutiveRateLimitAbort → 证据 step verdict='blocked' → **退出码 2**（不伪造数据、不无限重试）；②请求节奏符合桶容量（虚拟时钟零真实 sleep）、任意时刻并发=1、304 不计预算；③离线重放不触网、产出与在线等价的 ODS 记录（replay 样本确定性复跑）；④blockedReason 含「无 GitHub 凭据……——阻塞」，退出码 2；⑤exitCodeOf：blocked→2 > 任一断言 fail→1 > 全过→0（禁止假绿） | 连续 429 桩序列；--replay 样本目录（replay-sample.test.ts 同源 fixture）；空 env 跑真网档 | vitest 单测@services/ingest（collect/ratelimit.test.ts 18 例、collect/run.test.ts、collect/replay-sample.test.ts 等 52 个测试文件已覆盖——回归保持）；CI 注入占位 GH_TOKEN+fetch 桩（口径：无凭据环境不得跑真网） | services/ingest/src/collect/ratelimit.ts:300（ConsecutiveRateLimitAbort）+模块头（core 4/1s、search 24/分、串行并发=1）；services/ingest/src/collect/evidence.ts:21（exitCodeOf blocked>fail>pass）；services/ingest/src/collect/run.ts:672（无凭据阻塞）；services/ingest/src/collect/cli.ts:71,153（--replay） |

### 3.10 桌面壳（TC-SHELL-01…04）

| 用例ID | 模块 | 优先级 | 测试类型 | 前置条件 | 操作步骤 | 预期结果 | 测试数据 | 自动化建议 | 追溯 |
|---|---|---|---|---|---|---|---|---|---|
| TC-SHELL-01 | 五项安全基线（静态 AST + 运行时探针） | P0 | 安全 | 仓库工作树（无 Electron 二进制环境跑①②纯静态段）；有二进制环境补③④运行时段 | ①跑 guard:electron-baseline 记录退出码；②核对 window-options.ts 对象字面量形状（禁条件展开/env 注入/函数拼装）；③有二进制环境跑 `--df-baseline-probe` 打印 JSON 快照；④probe/smoke 自检硬超时窗口行为（30s） | ①静态 AST 断言五项：contextIsolation:true / sandbox:true / nodeIntegration:false / webSecurity:true / allowRunningInsecureContent:false；webPreferences 声明点全文件**唯一**、必须直接展开 SECURITY_BASELINE、其后无同名键覆盖——违规 exit 1、静态判不出（外部对象/展开成环）exit 2（禁当通过）；②纯字面量五键直书；③④运行时 security 快照与五项逐键一致；测不到的键（null，如 webSecurity 间接量）守卫退 **exit 2** 不判通过（禁假绿） | 篡改变体：webPreferences 后置覆盖 sandbox:false（应 exit 1）；外部对象展开（应 exit 2） | 脚本门禁 guard:electron-baseline（已实现已接 CI——回归保持）+ vitest 单测@apps/desktop（window-options.test.ts / shell-selfcheck.test.ts 判据已覆盖——回归保持）；运行时段无二进制环境如实阻塞 | apps/desktop/src/main/window-options.ts:14-25,48-74；scripts/guard-electron-baseline.mjs:9-13,38,514-537（三态出口）；apps/desktop/src/main/shell-selfcheck.ts:14-21,76-90（null≠违规→阻塞）；apps/desktop/src/preload/preload.cjs:29-32 |
| TC-SHELL-02 | dforgeShell 只读暴露面 | P1 | 安全 | 静态扫描环境；壳内真浏览器环境（有 Electron 二进制时） | ①静态断言 preload.cjs 对 contextBridge.exposeInMainWorld 的调用恰 1 次；②枚举暴露键集与值类型；③壳内执行 window.dforgeShell 核对运行时值；④尝试改写 window.dforgeShell.security 与全局检索 require/module/exports；⑤核对暴露面无任何 IPC 通道（ipcRenderer/on/send） | ①恰 1 次调用；②暴露键恰为 runtime/versions/platform/security 四键、全为只读值（security 两布尔取自 preload 侧 process.contextIsolated / process.sandboxed）；③runtime='@dforge/desktop'、versions 含 electron/chrome/node 三串、platform 与宿主一致；④改写不生效或真值不变，页面侧无 Node 全局（sandbox+contextIsolation 语义）；⑤零 IPC 暴露（本地能力全走 daemon HTTP，接口形状先立、握手归圈外） | 无（结构断言）；篡改变体：preload 追加 exposeInMainWorld('evil',…)（静态断言应失败） | 静态断言（并入 guard:electron-baseline 或独立脚本；**暴露面键集与「零 IPC」断言当前为缺口**，preload-path.test.ts 只覆盖路径/CJS 口径）+ 壳内真浏览器断言（归 verify:shell-parity smoke 段扩展——缺口） | apps/desktop/src/preload/preload.cjs:11-33（四键只读暴露）；apps/desktop/src/main/preload-path.ts（沙箱下必须 CJS）；docs/plan/architecture-v1.1.md（issue #25 本地连接口径预留） |
| TC-SHELL-03 | 外链/导航白名单（setWindowOpenHandler / will-navigate） | P0 | 安全 | vitest 环境（决策纯函数无需 Electron）；主进程接线静态核对 | ①新窗口决策矩阵：https://github.com/<repo> 、http://github.com（非 https）、https://evil-github.com（仿冒）、https://github.com.evil.com（白名单域作后缀）、https://sub.github.com（合法子域）、畸形 URL；②页内导航矩阵：同源、devtools:、跨源 github.com 白名单、跨源其余、file: 装载下跨路径、file: 同路径；③主进程接线核对：setWindowOpenHandler 默认 {action:'deny'}、放行仅转 shell.openExternal；webview attach 阻止 | ①仅 https + 白名单域（精确或子域）→ allow-external，其余全部 deny（**默认拒绝**，白名单唯一 github.com）；②同源 allow / devtools: allow / 跨源白名单 open-external / 其余 deny / file: 跨路径 deny、同路径 allow；③deny 是唯一默认，无 window.open 直通路径；④新增对外入口只能改 EXTERNAL_LINK_ALLOWLIST 且被本矩阵钉死（改白名单必触发用例更新） | URL 矩阵 10+ 条（含端口/查询串变体）；file:///fallback.html 跨路径档 | vitest 单测@apps/desktop（external-links.test.ts + external-links.adversarial.test.ts 已覆盖①②矩阵含仿冒/畸形反例——回归保持）；主进程接线静态核对（增量断言） | apps/desktop/src/main/external-links.ts:14,20-23,35-89；apps/desktop/src/main/external-links.adversarial.test.ts:36-88 |
| TC-SHELL-04 | static-server 路径遍历 404 与装载链 | P0 | 安全 | vitest 环境（resolveStaticFileRequest 纯函数 + 临时产物目录 fixture）；真实壳环境补 smoke | ①穿越矩阵逐一喂 resolveStaticFileRequest：/../../etc/passwd、/%2e%2e/%2e%2e/etc/passwd、含 \0、含 '.' 段、%ZZ 解码失败、合法深路径；②根请求与目录请求；③不存在路径；④startStaticServer 监听地址与 MIME；⑤装载链逐级注入：DFORGE_SHELL_URL → DFORGE_SHELL_STATIC → apps/web/out → resources/fallback.html；⑥stat 后删除竞态（readFileSync 抛错） | ①六档全部 {status:404}——`..`/`.`/`\0`/解码失败一律 404，normalize 后必须仍落 rootDir 内（穿越防护不是一刀切：合法路径照常 200）；②映射该目录 index.html 且拼接无双斜杠/逃逸；③404（body '404'）；④监听 127.0.0.1 + 随机端口（listen(0)），MIME 走显式表（未知扩展 application/octet-stream 不猜）；⑤优先序严格四级，fallback 诊断页带自报 marker（web 产物页为 null）；⑥读失败同样走 404 出口——请求处理绝不让主进程未捕获异常打断壳 | 穿越串 6 档；产物 fixture（含 index.html + _next/static 深层文件）；env 三档组合 | vitest 单测@apps/desktop（static-server.test.ts + static-server.adversarial.test.ts 覆盖①②③⑥、load-target.test.ts 覆盖⑤——回归保持）+ 脚本门禁 verify:shell-parity smoke 段端到端（真实壳；无 Electron 二进制环境 exit 2 阻塞、禁假绿） | apps/desktop/src/main/static-server.ts:48-91（穿越防护）、:100-146（isRegularFile/读失败 404/随机端口）；apps/desktop/src/main/load-target.ts:16-18,70-107（四级装载链）；scripts/verify-shell-parity.mjs:5-26,58-67（smoke/alive 35s/parity diffRatio ≤0.001 三段式） |

### 3.11 CLI 与遥测（TC-CLI-01…03）

| 用例ID | 模块 | 优先级 | 测试类型 | 前置条件 | 操作步骤 | 预期结果 | 测试数据 | 自动化建议 | 追溯 |
|---|---|---|---|---|---|---|---|---|---|
| TC-CLI-01 | set-key 管道注入（掩码/不进 shell 历史/0600 落库） | P0 | 安全 | daemon 临时实例；CLI 指向该实例；测试注入假 stdin 流；真机手工档补 shell 历史核对 | ①`echo -n 'sk-…' \| df config set-key --stdin` 读 stdout 全文与退出码；②直接 stat 并读凭据库两文件（credentials.json / credentials.key）权限与内容形态；③`df config set-key`（--stdin/--clear 都不给）；④两 flag 同给；⑤argv 形式传 key（构造不存在通道）；⑥TTY 档（假 isTTY+setRawMode）逐字符输入；⑦`df config set-key --clear` 后 GET /ai/status | ①退出码 0，stdout 只含掩码（形如 sk-…0zzz）与来源标签（env 优先时标「环境变量（优先，只读）」），**零明文**；key 经 PUT /config/credentials 进 daemon；②两文件均 **0600**，credentials.json 为 {version:1, cipher:'aes-256-gcm', entries} 密文（零明文 key）；③④⑤均 CliUsageError → 退出码 **2**（阻塞）——argv 传 key 进 shell 历史，命令刻意不设此通道；⑥TTY 关回显（setRawMode(true) 逐字符读、回车确认、Ctrl+C 取消、退格可改），不回显不落历史；⑦cleared=true、/ai/status configured=false 回降级态 | 合法 `sk-abcdef1234567890zzzz`（掩码 sk-…zzzz）；非法空 stdin（→ CliUsageError 阻塞）；历史核对命令行样本 | vitest 单测@tools/cli（config-cli.test.ts 假流注入已覆盖主链——回归保持）+ daemon 集成核对 0600 落库（credentials/store 单测已有——回归保持）+ 手工档：history/grep 一次验证（记录证据） | tools/cli/src/config/index.ts:68-101（stdin 两态）、:132-144（恰给其一）、:174-201（掩码输出）；apps/daemon/src/credentials/store.ts:4-11,114,146-147（AES-256-GCM/0600）；apps/daemon/src/app.ts:107（env 优先只读）；README.md:29 |
| TC-CLI-02 | df market search 输出契约 | P1 | 功能 | 临时数据根预置 ADS 产物（df.marketplace.index.v1.json + market_search_index.v1.json）；df bin 可执行（tools/cli/bin/df.mjs） | ①`df market search --q 幻灯片` 读 stdout 行；②`--query-set` 跑全部示例查询；③移除 ADS 产物后重跑①；④同词对照 daemon GET /market/query?q=；⑤统计每条查询耗时分布 | ①每命中行含 id/名称/质量分/相关度/命中词（与倒排产物一致）；②逐条断言：每条 ≥1 命中、≥5 条 ≥3 命中（QUERY_SET_MIN_TOTAL / QUERY_SET_MIN_QUERIES_WITH_3），记录 P95 耗时（首版无硬门槛仅记录），退出码 **0**；③退出码 **2**（阻塞：ADS 产物缺失，不伪造结果）；④与 daemon 命中 id 集一致（同走 searchMarketIndex 倒排直查，不重建索引）；⑤耗时行如实记录无假值 | 示例查询集（query-set.ts 全量）；产物缺失档 | CLI 集成@临时数据根（跑真 bin 断言 stdout 与退出码——部分缺口：args/outcome/pipeline 单测已有，真 bin 端到端为增量）+ vitest 单测@tools/cli（现有 search 侧测试——回归保持） | tools/cli/src/market/search-cmd.ts:1-14（两模式与退出码 0/1/2）；tools/cli/src/market/query-set.ts（QUERY_SET_MIN_*）；README.md:60（df market 命令面） |
| TC-CLI-03 | 遥测脱敏与一键清空 | P0 | 安全 | daemon 临时实例（telemetry.enabled=true 主档 + false 对照档） | ①POST /telemetry/events {name:'ai.run', payload:{apiKey:'sk-plain-123', nested:{authorization:'Bearer x'}, tags:['token-abc'], keep:1}}；②直接读 <dataRoot>/telemetry/events.jsonl 权限与内容；③GET /telemetry/events；④DELETE /telemetry/events；⑤enabled=false 档重复①；⑥未知事件名 / payload 为数组 | ①200 + {stored:true, id}；②文件 **0600**；落盘值**按键名判定**：apiKey=[redacted]、nested.authorization=[redacted]（键名保留、递归路径清单返回）；tags 数组元素 'token-abc' 为**值非键**、且键名 tags 不命中敏感正则 → 原样保留（脱敏语义=按键名，钉死现状口径边界）；keep=1 原样；③查询回读与文件一致（最新在前）；④{cleared:true, removed:N}、文件清空；⑤{stored:false, reason:'disabled'}、不落盘；⑥均 400 telemetry_invalid_event | 载荷含嵌套敏感键 + 数组敏感值（钉「按键名判定」边界）；enabled 两档 | vitest 单测@packages/contracts（sanitizeTelemetryPayload 递归路径清单——回归保持）+ daemon 集成（routes/telemetry.test.ts:11-110 已覆盖写入/脱敏/开关/非法名——回归保持；**数组值边界与 0600 权限断言为缺口**补强） | packages/contracts/src/telemetry/index.ts:76-125（正则/占位符 [redacted]/递归 walk）；apps/daemon/src/telemetry（appendJsonLine 0600）；apps/daemon/src/routes/telemetry.ts（POST/GET/DELETE 与校验） |

### 3.12 出图与 ComfyUI 调度（TC-IMG）

| 用例ID | 模块 | 优先级 | 测试类型 | 前置条件 | 操作步骤 | 预期结果 | 测试数据 | 自动化建议 | 追溯 |
|---|---|---|---|---|---|---|---|---|---|
| TC-IMG-01 | 出图 | P2 | 功能/故障注入 | 临时数据根 daemon；**ComfyUI 未启动** | ① `GET /image/probe` ② 前端打开 ImagePanel ③ 核对 UI 态 | probe 返回结构化「未启动」失败态（一等失败，非超时空白）；前端展示失败态且**不静默回退云端**；日志无假成功 | — | daemon 集成 + RTL（ImagePanel 两态） | `apps/daemon/src/image/client.ts`、`apps/web/src/features/image/components/ImagePanel.tsx` |
| TC-IMG-02 | 出图 | P2 | 功能/边界 | mock ComfyUI 上游（probe/run 桩） | ① `POST /image/runs` ② 轮询 `GET /image/runs/:runId` 至终态 ③ `POST /image/runs/:runId/cancel` 后再查 | 状态机推进可观测（提交→运行→终态）；cancel 后 run 进入取消终态、不再落资产 | 桩响应序列 | daemon 集成@mock 上游 | `apps/daemon/src/image/client.ts:53`、verify-image-two-state |
| TC-IMG-03 | 出图 | P2 | 故障注入 | 同上，run 进行中 | ① run 运行中 `kill -9` daemon ② 重启 daemon（同数据根）③ `GET /image/runs/:runId` | 返回**一等失败态**（run 不存在/已中断），非挂起、非伪造进度（内存态崩溃即失为已登记取舍 4.4） | run 语料 | daemon 集成+信号注入 | `image/client.ts`（「崩溃恢复归 P4b」注释） |
| TC-IMG-04 | 出图资产 | P2 | 功能/安全 | mock 上游产出图片字节 | ① 同一内容出图两次 ② 核对 `image/assets/` 落盘 | 按 sha256 命名（`<sha256>.<ext>`）内容寻址去重（仅一份）；原子写无半态；权限 0644 | 两次相同产出 | daemon 集成（fs 断言） | `apps/daemon/src/image/client.ts:331-338` |

---

## 四、持久化与数据专项测试清单

**映射声明**：本产品无关系数据库（全仓无 SQL/ORM/迁移代码，已侦察确认），用户模板的「数据库专项」按数据真值层映射为四个存储面 + 一组预留项；模板的每个 DB 检查点在 4.5 对照表中逐条落到用例 ID 或「不适用」。

### 4.1 `.dfg` 文档持久化（文件系统=存储引擎）

- 数据模型：`<workspaceDir>/<documentId>.dfg/{manifest.json, pages/<pageId>.json}`；manifest 强类型（`df.dfg.manifest/v1`，保存 version 自增）；页面正文为 opaque JSON（引擎侧另有 `dforge.designir/v1` 强校验：稳定键序/幂等往返/拒 NaN/拒超深/丢 `__proto__`）。
- 事务性（ACID 映射）：原子性=同目录临时文件→write→fsync→rename→目录 fsync；提交点=页面正文先落盘、manifest 最后写；删除=先提交 manifest 再删正文。隔离性=每文档进程内 keyed mutex + 跨进程「写后重读比对+有界重试 3 次→`conflict`(409)」。持久性=fsync 双段；无 WAL/重放日志。
- 核对命令（SQL 不适用的 shell 等价物）：
  - 完整性：`find <dataRoot>/workspace -name '*.json' | xargs -I{} node -e 'JSON.parse(fs.readFileSync(process.argv[1]))' {}`
  - 半态残留：`find <dataRoot>/workspace -name '*.tmp-*'`（应只读目标名，残留不污染读取，但积累需报警）
  - manifest/pages 对账：逐 `.dfg` 校验 `pages/*.json` 文件名集合 ⊆ manifest 页表
- 关键用例：TC-DOC-01…12（见 3.4）；路径安全 TC-SEC-06/07。

### 4.2 localStorage（浏览器本地态）

- 键空间：`dfg:versions:<docId>`（整文档深拷贝快照）、`dfg:comments:<docId>`、`dfg-home-trash-v1`（上限 50 条）；读取策略=坏 JSON/坏形状逐条丢弃不抛错。
- 风险面：配额满（~5MB）写失败静默？隐私模式禁用？跨标签页竞态？快照非持久（清浏览器数据即失）无警示。
- 关键用例：TC-LS-01…05（见 3.6）、TC-UIX-03/05。

### 4.3 遥测/审计 JSONL（追加写面）

- `telemetry/events.jsonl`（0600，敏感键正则递归脱敏→`[redacted]`；**按键名判定**——敏感值挂在非敏感键（如 `tags:['token-…']`）不会被脱敏，口径钉死于 TC-CLI-03）、`audit/mcp-audit.jsonl`（0600，argsDigest=`sha256:<64hex>` 前缀串）；追加写非原子（单进程假设）。
- 关键用例：TC-CLI-03（脱敏与清空）、TC-MCP-06（审计完整性）；追加写竞态列为 TC-DR-04 的伴随断言。

### 4.4 内存态（非持久面，崩溃即失——已登记的架构取舍）

- 出图 run 登记（注释明言「崩溃恢复与持久队列归 P4b」）、MCP 提案与 ackToken（「桩不做崩溃恢复」）。
- 测试立场：**不当缺陷测，当契约测**——用例断言「进程重启后 run 查询返回一等失败态（非挂起/非假数据）」：TC-IMG-03。

### 4.5 模板 DB 检查点对照表

| 模板检查点 | 实际落点 | 用例 |
|---|---|---|
| schema 与约束 | contracts 手写守卫（isDfgManifest/文档名规则/深度 1024） | TC-DOC-02/03/04 |
| 迁移回滚 | **无迁移代码**（`$version` 只读不迁移）——风险确认用例；回滚=引擎版本快照 | TC-DOC-12、TC-UIX-03 |
| 事务 ACID | 原子写+提交点+fsync | TC-DOC-05/06 |
| 隔离级别/并发写 | keyed mutex + 409 冲突 | TC-DOC-07/08/09 |
| 死锁 | mutex 为单文档 key 粒度、无嵌套锁——锁序审计（代码走查类用例） | TC-DOC-09 伴随断言 |
| 索引与慢查询 | 市场 BM25 只读 JSON 索引（损坏降级） | TC-MKT-01/02 |
| 分页 | `/documents` 列表行为（侦察未见分页参数，文档量大时全量返回——**待补确认**） | 列入十、残余风险 |
| 软删除 | **无**（物理 rm -rf；前端回收站仅流水） | TC-LS-05 |
| 审计日志 | mcp-audit.jsonl | TC-MCP-06 |
| 版本历史 | localStorage 快照（非 daemon） | TC-UIX-03 |
| 多租户/行级权限 | 不适用（单用户本地产品） | — |
| 缓存/队列最终一致性 | 内存 TTL 缓存+内存 run（崩溃即失） | TC-IMG-03 |
| 备份恢复 | 数据根 tar 快照+恢复演练 | TC-DR-02 |
| 故障注入 | kill -9/磁盘满/坏 config | TC-DOC-05、TC-DR-01/03 |
| 数据清理与隔离 | 临时数据根纪律+可重试删除 | §2.1/2.3 |

---

## 五、实时协作与 WebSocket 专项

### 5.1 现状判定（侦察结论，非假设）

- 全仓 WebSocket/socket.io/CRDT/yjs/automerge/OT/presence **代码零命中**（仅文档命中）；daemon 依赖仅 fastify，无 ws 库。
- `docs/plan/architecture-v1.1.md` §2.2 官方明确不做多人实时协同；「本地双窗口只读同步」为文档承诺、**无实现**——该承诺与实现的差距本身登记为待办（十、残余风险 R-4）。
- 实时面仅剩两处非 WebSocket 流：`POST /ai/chat`（SSE）与出图 run 轮询（fetch 间隔轮询）。

### 5.2 当前真实「协同」风险面（多窗口/多进程）

无锁无合并之下，同文档两窗口=后写整页覆盖先写（PUT 无版本条件）；跨进程防线仅有 409 冲突检测。用例：TC-DOC-07/08；产品级缓解建议（非测试范围）：写前版本条件（If-Match）+ 覆盖前 UI 提示。

### 5.3 SSE 流专项（AI）

断言面：事件序列 `queued→llm→validate→compile` 完整有序（两态时序）、断流恢复、半行/超长行解析、非 200/5xx 降级、CORS（**已知断点 3.1**：修复后浏览器端必须可用，作为回归门禁）、BYOK 哨兵不泄漏。用例：TC-AI-01…06。

### 5.4 出图轮询专项（ComfyUI 调度）

probe 未启动=一等失败态（禁静默回退云端）、run 轮询→cancel 语义、run 内存态进程重启后查询行为。用例：TC-IMG-01…03。

### 5.5 协作立项测试预留清单（当前不适用，立项时启用）

| # | 预留检查点 | 对应模板要求 |
|---|---|---|
| P-1 | OT/CRDT 收敛性（并发操作最终一致、意图保持） | 协同冲突 |
| P-2 | 消息乱序/重复/丢失（序号+去重+重传） | 传输可靠性 |
| P-3 | 断线重连+离线合并（增量同步、冲突降级 UI） | 离线 |
| P-4 | 多人光标/选区（presence 读写放大、隐私） | 实时感知 |
| P-5 | 锁与抢占（编辑会话、评论锚点失效） | 并发控制 |
| P-6 | 版本回滚对在线客户端的广播一致性 | 版本 |
| P-7 | 时钟偏移（服务器时间戳权威、NTP 漂移容差） | 时序 |
| P-8 | 评论同步与已读状态 | 协同面 |

---

## 六、安全与权限专项

### 6.1 威胁模型（本地特权面）

攻击者=本机浏览器中的任意恶意网页（及被诱导打开的文档/市场索引）。资产=用户全部设计文档、DeepSeek API key、出图/导出/文档删除能力。信任边界=回环监听（daemon 自认「真正的访问控制边界在回环监听与未来令牌」，`apps/daemon/src/cors.ts:13`）。已确认暴露面：

1. **无鉴权**：33 条路由对任意本机进程开放；
2. **CORS 白名单外不拒绝执行**：仅不加放行响应头，非浏览器客户端（或绕过预检的简单请求）照常生效；
3. **`Origin: null` 恒放行**（为打包壳 file:// 取舍）；
4. 无 Host 校验 → DNS rebinding 理论可达；
5. 主密钥明文落盘 `credentials.key`（0600，与密文同目录）——本机root/同用户进程可读（属本地威胁模型内取舍，须登记）。

### 6.2 安全用例

| 用例ID | 模块 | 优先级 | 测试类型 | 前置条件 | 操作步骤 | 预期结果 | 测试数据 | 自动化建议 | 追溯 |
|---|---|---|---|---|---|---|---|---|---|
| TC-SEC-01 | daemon 特权面 | P0 | 安全 | 临时数据根 daemon 于空闲端口；恶意页托管于另一端口 | ① 恶意页 `fetch('http://127.0.0.1:<port>/documents',{method:'POST',headers:{'content-type':'application/json'},body:…})` ② 断言响应 ③ `GET /documents` 核对 | 现状预期：**请求被执行**（新文档出现）=缺陷确认；若已加防护：非白名单 Origin 请求 403 拒绝 | 恶意页+最小文档体 | daemon 集成@临时实例（模拟跨源请求带 Origin 头）+playwright 双源页 | `apps/daemon/src/cors.ts:83,94`、threat model §6.1 |
| TC-SEC-02 | daemon 特权面 | P0 | 安全 | 同上，自建 rebind 测试域（hosts 指向 127.0.0.1） | ① 以恶意域名（Host≠localhost）发起 DELETE /documents/:id ② 核对文档是否被删 | 现状预期：被执行=Host 校验缺失确认；目标态：非本机 Host 403 | rebind 域 | daemon 集成（伪造 Host 头） | `apps/daemon/src/server.ts`、threat model §6.1 |
| TC-SEC-03 | CORS | P1 | 安全/边界 | 临时 daemon | ① 发 `Origin: null` 请求 ② 断言放行头与执行结果 ③ 对照 `DFORGE_CORS_ORIGINS` 自定义白名单行为 | `Origin: null` 放行（现状契约）；白名单内正常放行头；白名单外无放行头但请求被执行（现状契约，登记） | 三组 Origin | daemon 集成 | `apps/daemon/src/cors.ts:67` |
| TC-SEC-04 | 凭据存储 | P0 | 安全 | 临时数据根 | ① 写入合法 key（形态 `sk-`+8位+）② 核对 `credentials.json`/`credentials.key` 权限位 0600 ③ 核对密文非明文、iv/authTag 存在 ④ 损坏 key 文件→读取行为 | 权限 0600；密文 AES-256-GCM（version:1）；key 文件损坏**不覆盖**、凭据读取报错不崩溃 | 合法/损坏 key | daemon 集成（fs 断言） | `apps/daemon/src/credentials/store.ts:95-147` |
| TC-SEC-05 | 凭据掩码 | P1 | 安全 | 同上 | ① set-key 后查询凭据摘要 ② 遍历 daemon 全路由响应+日志文件 grep 明文 key | 任何响应/日志只含掩码（前缀+末4位）；明文零命中 | 哨兵 key（演练后轮换） | daemon 集成+日志 grep 断言 | `packages/contracts/src/config/index.ts:144-153`、TC-CLI-01 |
| TC-SEC-06 | 路径安全 | P0 | 安全/边界 | 临时数据根 | ① 依次以恶意 documentId/pageId 调 CRUD：`../逃逸`、绝对路径、`%2e%2e`、NUL、非 NFC、软链指向仓外 ② 核对全部拒绝且无仓外文件产生 | 全部 4xx（doc_invalid/页 id 白名单拒绝）；realpath 校验拦软链；数据根外零写入 | 恶意 id 语料集 | daemon 集成（adversarial 扩展） | `apps/daemon/src/path-safety.ts:43-155` |
| TC-SEC-07 | 输入健壮性 | P1 | 边界/安全 | 临时 daemon | ① PUT 嵌套链长 1023/1024/1025/1026 层页 JSON ② `NaN`/`Infinity` 裸字面量（非法 JSON） ③ `{"__proto__":{...}}` ④ 畸形 JSON ⑤ 1MB 单行 JSON | ①1023–1025 →200（exceedsJsonDepth 判 depth>1024、根为第 0 层，链长≤1025 接受——口径详见 TC-DOC-03）；1026 →400 doc_invalid_body 不落盘 ②③④400（JSON.parse 层拒绝） ③的 `__proto__` 键被引擎序列化层剥离、不触发原型污染 ⑤可解析则按契约接受 | 深度语料四档（1023/1024/1025/1026） | daemon 集成+engine 单测 | `store.ts:103,472-480`、`path-safety.ts:162-180`、`packages/engine/src/serialize/serialize.ts`（引擎侧另为 512/2048 双层，见 TC-ENG-07） |
| TC-SEC-08 | Electron 基线 | P0 | 安全 | Electron 二进制就位 | ① 静态：guard-electron-baseline 全绿 ② 运行时：`--df-baseline-probe` 探针实测五项 ③ 尝试 `window.open` 外链、`will-navigate` 跨源、webview attach | 五项=contextIsolation/sandbox true、nodeIntegration/webSecurity true、禁混合内容；open 一律 deny+白名单（github.com）转系统浏览器；跨源导航拒；webview 阻止 | 白名单外恶意 URL | 脚本门禁（本机） | `apps/desktop/src/main/window-options.ts:14-25`、`main.ts:221-255`、`guard-electron-baseline.mjs` |
| TC-SEC-09 | 市场供应链 | P1 | 安全 | 冻结索引样本 | ① load-plan 断言响应仅元数据（mode/license/targetPathHint/notice）② 全 daemon 代码 grep exec/spawn/eval 于 market 路径 ③ 索引含未知字段/未知枚举→忽略/归 other 不崩溃 | 零代码执行面；畸形索引降级不崩 | 恶意字段语料 | daemon 集成+静态 grep 断言 | `apps/daemon/src/market/service.ts:234-263`、`packages/contracts/src/market/index.ts:6` |
| TC-SEC-10 | AI 隐私 | P1 | 安全/隐私 | mock 上游+哨兵 key | ① 发含敏感字符串的消息 ② 抓 mock 上游收到的 body ③ grep 全链路（日志/遥测/审计/响应）哨兵 | 现状契约：**内容原样透传上游**（无脱敏开关=已登记取舍）；key 明文零命中；遥测敏感键 `[redacted]` | 哨兵 key+敏感语料 | daemon 集成（mock 上游回捕） | `apps/daemon/src/ai/client.ts:126-144`、`packages/contracts/src/telemetry/index.ts:76-125` |
| TC-SEC-11 | 日志面 | P2 | 安全 | 临时 daemon pino info 级 | ① 执行凭据/AI/MCP 全链路 ② grep 日志输出明文 key/凭据材料 | 无独立脱敏函数（现状）→断言至少无 key 明文；登记「日志脱敏缺失」为加固项 | 哨兵 key | daemon 集成 | `apps/daemon/src/main.ts:52` |
| TC-SEC-12 | CSP | P2 | 安全 | web 生产产物 | ① 抓主装载页响应头与 meta ② 断言现状：无 CSP（登记）；fallback.html 有 `default-src 'none'` | 现状=主装载页无 CSP（登记为加固项）；fallback 保持 `default-src 'none'` | — | playwright 响应头断言（本机） | `apps/desktop/resources/fallback.html:5` |

### 6.3 已知安全取舍登记表（代码自认，非缺陷误报）

| 取舍 | 位置 | 建议处置 |
|---|---|---|
| 「访问控制边界在回环监听与未来令牌」 | `apps/daemon/src/cors.ts:13` | 引入本地 pairing token（guard:channel-pairing 挂点）前，至少加 Host 校验（TC-SEC-02） |
| `Origin: null` 恒放行 | `cors.ts:67` | 打包壳迁移到自定义协议或静态服务后收紧 |
| 白名单外照常执行 | `cors.ts:83,94` | 短期：对写方法（POST/PUT/PATCH/DELETE）拒非白名单 Origin；长期：token |
| 主密钥明文落盘同目录 | `credentials/store.ts:95-116` | 迁移 OS 钥匙串/safeStorage（注释已标注归 FE-12 接入） |
| AI 上游内容无脱敏开关 | `ai/client.ts`、README「可脱敏」承诺 | 脱敏开关落地或修正 README 承诺口径 |

---

## 七、性能与灾备专项

### 7.1 性能指标体系（verify-perf M1–M7，真链路）

真链路=确定性文档→真 daemon→Next 生产构建→Chromium；三档文档 1k/5k/20k 节点；minFrames=240；基线 `docs/quality/perf-baseline-v1.json` 当前 provisional:true=恒阻塞（exit 2）。

| 指标 | 含义 | 模板阈值（1k/5k 档） | 20k 档 |
|---|---|---|---|
| M1 首帧 | 首帧耗时 | 1000/1500ms | null（记录性） |
| M2 帧率 p95 | 交互帧时间 | 16.7ms | null |
| M3 选中→面板 | 选中到检查器更新 | 100ms | null |
| M4 撤销 | 撤销往返 | 50ms | null |
| M5 保存往返 | 保存 RPC 全程 | 300ms | null |
| M6 heap | 内存 | 记录 | 记录 |
| M7 剔除率 | clipped 画板数（现状全量重绘，仅记录） | 记录 | 记录 |

### 7.2 性能用例

| 用例ID | 模块 | 优先级 | 测试类型 | 前置条件 | 操作步骤 | 预期结果 | 测试数据 | 自动化建议 | 追溯 |
|---|---|---|---|---|---|---|---|---|---|
| TC-PERF-01 | 渲染 | P1 | 性能 | 基线转正（两轮实采回填 provisional=false） | ① 1k/5k 档跑 M1–M5 全量 ② 三态判定 | M1≤1000/1500ms、M2 p95≤16.7ms、M3≤100ms、M4≤50ms、M5≤300ms；违规 exit 1 | benchmark-doc 1k/5k | `verify:perf`（真链路，本机） | `scripts/verify-perf.mjs`、`docs/quality/perf-baseline-v1.json` |
| TC-PERF-02 | 渲染 | P2 | 性能/记录 | 同上 | ① 20k 档采集 M1–M7 ② 记录并滚动更新 20k 阈值 | 产出 20k 档实测分布→回填基线（当前 null 的补齐路径） | benchmark-doc 20k | verify:perf 记录段 | 同上 |
| TC-PERF-03 | 内存 | P1 | 性能/泄漏 | 生产构建+Chromium | ① 连续 1000 次文本编辑会话（ParagraphCache 反复创建/淘汰）② 200 次缩放往复 ③ M6 heap 采样对比首尾 | heap 无单调增长趋势（ParagraphCache 容量上限显式 delete 生效）；增长>阈值=泄漏 | 编辑语料 | verify:perf M6 扩展或 playwright 长会话脚本 | `apps/web/src/features/canvas/render/paragraph-cache.ts` |
| TC-PERF-04 | 撤销 | P2 | 性能/边界 | 引擎基准 | ① 连续 200+ 次命令入栈（越过 historyLimit=200）② 测撤销延迟与栈深 | 溢出后旧事务出栈、延迟稳定无劣化；撤销次数≤200 | 命令流水 | engine 单测（性能断言放宽阈值） | `packages/engine/src/commands/stack.ts:49-56,250-254` |
| TC-PERF-05 | 保存 | P1 | 性能/集成 | 临时 daemon+5k 文档 | ① 连续 50 次保存往返 ② p95 与 M5 对齐 | p95≤300ms；无 mutex 排队雪崩 | 5k 文档 | daemon 集成+性能断言 | `store.ts`、M5 |
| TC-PERF-06 | 导出 | P2 | 性能 | 临时 daemon+5k 文档 | ① POST /export 三档各 10 次 ② 记录耗时分布与 15s 超时占比 | 产出基线数据（当前无导出耗时阈值——登记待补） | 5k 文档 | daemon 集成 | `apps/daemon/src/export/index.ts` |

### 7.3 灾备与故障恢复用例

| 用例ID | 模块 | 优先级 | 测试类型 | 前置条件 | 操作步骤 | 预期结果 | 测试数据 | 自动化建议 | 追溯 |
|---|---|---|---|---|---|---|---|---|---|
| TC-DR-01 | daemon 崩溃 | P0 | 故障注入 | 临时数据根+已存 3 文档 | ① 写入中途 `kill -9` daemon（正文已写/manifest 未写两处注入点各一次）② 重启 daemon ③ 读全量文档核对 | 重启后：或旧版完整态或新版完整态，**无半态**（正文有则 manifest 有）；`GET /health` 恢复 | 3 文档+注入点脚本 | daemon 集成+信号注入脚本 | `fs-atomic.ts:29-96`、`store.ts:489-491` |
| TC-DR-02 | 备份恢复 | P0 | 故障注入 | 临时数据根快照（tar+sha256） | ① 快照→写入新文档→**人为损坏**一个 `.dfg`（截断 manifest）② 从快照恢复 ③ 全量哈希比对+读校验 | 恢复后哈希与快照一致、全部文档可读；损坏文档在恢复前被 `GET /documents/:id` 显式报错（非静默空文档） | 快照脚本 | shell 脚本+daemon 集成 | §4.5 备份恢复行 |
| TC-DR-03 | 磁盘满 | P1 | 故障注入 | 临时数据根挂小容量 tmpfs 轮替（仓外盘符，非 /tmp 系统盘） | ① 写大页面 JSON 至 ENOSPC ② 断言错误响应与已落盘状态 ③ 释放后重试保存 | ENOSPC→显式错误（非静默成功）；已落盘部分保持原子（旧态完整）；释放后可继续保存 | 大页面体 | daemon 集成（注入 fs 错误或小盘） | `fs-atomic.ts` |
| TC-DR-04 | 坏配置/坏凭据 | P1 | 故障注入 | 临时数据根 | ① `config.json` 置坏 JSON→启动 ② `credentials.key` 置坏→读凭据 ③ 断言回退/报错与**不覆盖** | config 坏→深合并回退默认值不崩溃；key 坏→凭据读取报错且不覆盖损坏文件 | 损坏文件语料 | daemon 集成 | `config/store.ts:63-84`、`credentials/store.ts` |
| TC-DR-05 | 端口窗耗尽 | P2 | 故障注入 | 占用 4318 起 +32 连续端口 | ① 起 daemon ② 断言探测至 +32 上限后的失败语义 | 显式阻塞错误（exit 2 语义/清晰日志），非挂起 | 端口占用脚本 | daemon 集成 | `apps/daemon/src/server.ts:8,44-47` |
| TC-DR-06 | 遥测/审计追加竞态 | P3 | 故障注入 | 临时数据根 | ① 高频事件写入中立刻关闭+可重试删除数据根 ② 断言无 ENOTEMPTY 未捕获异常 | 清理路径带 maxRetries，无未捕获异常（回归防线） | 批量事件 | daemon 集成 | `docs/agents/implementation-workflow.md` ENOTEMPTY 先例 |

### 7.4 监控与容量（人工巡检项，当前无告警系统——如实登记）

- 遥测事件量与 `events.jsonl` 增长（提供 `DELETE /telemetry/events` 清空，巡检周期建议月度）；
- `exports/`、`image/assets/` 累积（无清理机制——登记待补）；
- daemon pino 日志级别与轮转（当前无轮转——登记待补）。

---

## 八、自动化与 CI 建议

### 8.1 门禁现状全景（实况快照，2026-11-03）

| 门禁 | 验证目标 | CI 状态 | 备注 |
|---|---|---|---|
| guard:tokens / guard:vocab / guard:feature-boundaries / guard:electron-baseline | 裸值禁令 / 词表真源 / feature 边界 / Electron 五项基线 | ✅ 已接 CI | — |
| verify:engine / test:scripts | 引擎全测+序列化哈希复核 / 门禁脚本自测 | ✅ 已接 CI | — |
| verify:figma-baseline / verify:motion / verify:perf | 参照集冻结元数据 / 动效断言 / M1–M7 | ⛔ CI 跑「阻塞语义断言」（断 exit 2 非当绿） | 分别待 REF-01 冻结 / 断言实现 / 基线转正 |
| verify-canvas / e2e:smoke / verify-figma-home·editor·inspect·component / verify-shell-parity / verify-daemon | 浏览器与真进程门禁 | 🔌 挂点未接 CI | 需 Chromium / Electron / 仓外参照集 |
| verify-ai-two-state / verify-image-two-state / verify-mcp-stub | AI/出图/MCP 两态取证 | 🔌 挂点未接 CI | mock 上游可在 CI 跑（建议接入，见 8.3） |
| verify-mk-01…05 / verify-market / verify-self-designed | 市场六环判据链 | 🔌 挂点（需仓外证据） | 离线重放覆盖于 ingest 单测 |
| guard:deps / guard:mcp-contract / guard:channel-pairing | 依赖方向 / MCP 契约快照 / 通道配对 | ⛔ 未实现（exit 2，不接 CI） | 按三态纪律禁假绿 |

### 8.2 差距 → 接入路线（四阶段，按风险排序）

1. **阶段 1（零新基建，1 个迭代内）**：修复 UX 审计三断点（3.1 CORS / 3.2 假步骤 / 3.3 面板未挂载）并各转一条回归（RTL/vitest，入常规链）；daemon 集成层补 TC-SEC-01/02/06、TC-DOC-05/07（临时实例自起，现有 `startFixtureDaemon` 先例）与 SSE 通道两档缺口（TC-AI-02 半行拆帧/中途断流、TC-AI-03 流式 CORS 断言）；`verify-ai-two-state`/`verify-image-two-state`/`verify-mcp-stub` 接 CI（纯 mock 无浏览器依赖）。
2. **阶段 2（浏览器门禁解冻）**：CI 缓存 Chromium（playwright-core 1.63 锁 chromium-1243）→ 冻结 REF-01 参照集 → `verify-figma-home/editor/inspect/component`、`verify-canvas`、`e2e:smoke` 接 CI。
3. **阶段 3（性能/动效转正）**：dev 机两轮实采回填 `perf-baseline-v1.json`（provisional=false，补 20k 档阈值）→ `verify:perf` 转真判定接 CI；`verify:motion` 实现断言后接 CI。
4. **阶段 4（纵深）**：`guard:mcp-contract`（routes.ts 真源与路由注册一致性快照）实现；故障注入常态化（TC-DR-01/03 转夜跑 job）；engine 引入 fast-check 属性测试（序列化幂等、命令栈逆序可逆）选型验证。

### 8.3 CI 环境适配清单（写用例前逐条对照）

| CI 差异 | 适配 | 先例 |
|---|---|---|
| 无 gh 凭据 | 占位 GH_TOKEN 注入+fetch 桩 | `tools/cli/src/verify-market/cli-replay.test.ts` |
| runner 慢 3–4× | 只放宽超时上限（包级 testTimeout 30s），不放宽断言 | `services/ingest/vitest.config.ts` |
| 无仓外证据 | 冻结样本进仓 + `--replay` | ingest 冻结样本 |
| 无 Electron 二进制 | 桌面用例纯静态断言 | guard:electron-baseline |
| 追加写清理竞态 | 可重试删除 maxRetries:5 | `apps/daemon/src/testing/harness.ts` |

### 8.4 测试分层建议

现状 314 个测试文件中 jsdom/node 层占绝对多数，浏览器/真进程层薄弱（浏览器门禁整体阻塞态）。目标比例建议：单元（现状保持）↔ daemon 集成（自起临时实例，阶段 1 扩到覆盖全部 33 路由的安全/并发面）↔ e2e（4 场景扩到市场/AI/MCP 真链路）。**每修复一个 P0 缺陷即转化一条门禁或用例**（见 9.2）。

---

## 九、缺陷模板与回归策略

### 9.1 缺陷报告模板

```markdown
### [P0-P3] <一句话标题>
- 票号/追溯：<issue #> ／ 用例ID：TC-XXX-NN ／ 需求锚点：<docs/plan 章节 | UX 审计编号>
- 环境：E1 开发机 | E2 CI | E3 Vercel ＋ node/pnpm 版本 + 相关门禁版本
- 复现步骤：①…②…③…（可直接执行的命令/操作）
- 预期 vs 实际：<可断言的预期> ／ <实际观察>
- 证据：<~/df-evidence/<票号>/ 下截图|证据 JSON|日志路径>（仓库外，路径必填）
- 门禁关联：<涉及哪个 verify-*/guard-*；若该缺陷应由此门禁拦截，为何漏过>
- 三态判定：0 通过 / 1 违规 / 2 阻塞（未实现/前置不成立——**不得把 2 当 0**）
- 修复要求：P0 必须附带回归用例（红→绿）后方可关闭
```

### 9.2 回归策略

1. **三态纪律**：任何「未实现当绿」按缺陷处理；改门禁必须同步 `implementation-workflow.md` 与 `AGENTS.md` 两处实况行（DoD 硬性要求）。
2. **P0 缺陷 → 门禁转化律**：每个 P0（如 3.1 CORS）关闭时必须落地一条可自动化用例/门禁（本方案的 TC-AI-03 等即为预留回归位）。
3. **视觉基线更新流程**：参照集冻结（版本+日期+逐图 sha256，`baseline.json`）→ 仓库内不存 PNG → 更新须走新 REF 版本，禁原地覆盖；差异率阈值 0.1（A 级 0.1%）只紧不松。
4. **性能基线转正流程**：dev 机两轮独立实采→回填 `perf-baseline-v1.json`→`provisional:false`→进入 0/1 判定；阈值只紧不松，20k 档由记录转阈值同流程。
5. **UX 审计回归清单**：`docs/quality/ux-audit-2026-10-30.md` 54 项中三断点（3.1/3.2/3.3）为 P0 回归项、N 项（C17 无入口/D4 不可达）为 P2 回归项，其余按「部分 17 项」逐票收口。
6. **回归范围裁剪**：修复后重跑=常规链 + 受影响包测试 + 受影响门禁；合并前全量 `pnpm verify` + 已接 CI 门禁绿。

---

## 十、通过标准与残余风险

### 10.1 通过标准（按发布门槛分级）

| 门槛 | 标准 |
|---|---|
| G1 每票合并 | `pnpm verify` 绿 + 已接 CI 门禁绿 + 本票追溯用例通过 + 证据落 `~/df-evidence/<票号>/` |
| G2 P0 收口 | TC-SEC-01/02/04/06/08、TC-DOC-05/07、TC-DR-01、TC-AI-03（3.1 回归）全绿；三断点 3.1/3.2/3.3 关闭且各带回归门禁 |
| G3 视觉/性能解冻 | REF-01 冻结→pixelmatch 门禁接入并绿；`perf-baseline-v1` 转正→M1–M5 达标、M6/M7 无泄漏无单调增长 |
| G4 全量验收 | 本方案 P0 用例 100% 通过、P1 ≥95% 有结论（通过/已知取舍登记/缺陷挂票）；十、残余风险逐条有 Owner 与去向 |

### 10.2 残余风险清单（截至 2026-11-03，如实登记）

| # | 残余风险 | 等级 | 去向 |
|---|---|---|---|
| R-1 | 本地特权面无鉴权/无 Host 校验（6.1），在 pairing token 落地前恶意网页可触达全部路由 | P0 | TC-SEC-01/02 确认→guard:channel-pairing 立项 |
| R-2 | 版本快照/评论仅存 localStorage：清浏览器数据即永久丢失（daemon 无版本路由） | P0（数据丢失） | 产品决策：daemon 版本持久化票 |
| R-3 | 无自动保存：手动 `file.save` 前崩溃丢失全部未存编辑 | P0（数据丢失） | 产品决策：autosave 票（当前状态机已备 dirty/saving/saved/error） |
| R-4 | 「双窗口只读同步」文档承诺与实现差距；双窗口并发写=后写整页覆盖 | P1 | 架构决策：实现或从文档移除承诺；短期加 If-Match/覆盖提示 |
| R-5 | 导出为简化过渡实现：PNG 不画文本/位图、SVG 不嵌字体、PDF 手写 1.4 | P1 | 导出真光栅化票（服务端渲染或浏览器端） |
| R-6 | `$version` 只读不迁移：未来格式升级旧文档无升级路径 | P1 | 迁移器设计票（读取侧识别+升级） |
| R-7 | 出图 run/MCP 提案内存态：进程重启即失 | P2 | 已登记 P4b（持久队列） |
| R-8 | 视觉基线未冻结+性能基线 provisional：当前 CI 对视觉/性能回归**零拦截** | P1 | 阶段 2/3（8.2） |
| R-9 | Vercel 线上产物一致性、Windows/macOS、a11y、/documents 分页行为：均未验证 | P2 | 兼容性专项票（依赖 H-7/H-9 补齐） |
| R-10 | AI 上游内容无脱敏开关（README 承诺「可脱敏」与实现不符） | P2 | 脱敏开关票或修正 README |
| R-11 | exports/image-assets 无清理、日志无轮转、遥测无告警 | P3 | 运维巡检制度（7.4） |

### 10.3 覆盖度声明

本方案对模板十二类范围的处理：功能（覆盖，3.1–3.11/3.15）、数据库专项（映射覆盖，四章）、API（覆盖，daemon 33 路由用例分散于 3.4/3.7–3.9/3.12）、实时协作（现状判定+预留，五章）、渲染与文件（覆盖，3.2/3.5）、权限安全（覆盖，六章）、性能灾备（覆盖，七章）、兼容性（受限覆盖：浏览器兼容未列专项——Chromium 单引擎现状+H-7/H-9 登记；i18n 仅 zh-CN）、a11y（**未系统覆盖**——登记为缺口，建议键盘可达性专项票）、运维灾备（覆盖，7.3/7.4）。未穷尽之处以「覆盖依据+残余风险」逐模块声明于一章。

---

## 附：追溯索引

- 需求锚点：`README.md`（三支柱）· `docs/plan/architecture-v1.1.md` · `docs/plan/skeleton-and-package-layout-v1.md` · GitHub Issues `QIUZI-HONG/DesignForge`（wayfinder:map）
- 缺陷源：`docs/quality/ux-audit-2026-10-30.md`（54 项，三断点 3.1/3.2/3.3）
- 纪律源：`docs/agents/implementation-workflow.md`（三态门禁/工作树/CI 差异/数据事故先例）· `AGENTS.md`
- 代码真源：`packages/contracts/src/ipc/routes.ts`（接口）· `apps/daemon/src/*`（持久化/安全）· `packages/engine/src/*`（内核）· `apps/web/src/features/*`（交互）
- 证据纪律：`~/df-evidence/<票号>/`（仓外）；参照集 `~/df-evidence/reference-v1/`
