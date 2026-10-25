# 设计软件对标与优化报告 v1

| 项 | 值 |
| --- | --- |
| 文档 | `docs/plan/competitive-benchmark-and-optimization-v1.md` |
| 日期 | 2026-10-24 |
| 性质 | 事实调研 + 对标分析 + 可执行优化建议（产品/工程/AI 三层） |
| 受众 | 施工指导为主，兼顾答辩引用 |
| 标注约定 | 【事实】= 可指到证据锚点（文件:行 / 官方链接 / 仓库文档）；【判断】= 含推理的主观结论；【宣称】= 竞品官方口径，未独立验证 |
| 决策口径 | 本报告范围经会话裁决（见 §1.5），AI 章节严格在既有 AI 边界内（DeepSeek 文本上云 + ComfyUI 图像本地），不提任何边界扩展项 |
| 优先级映射 | 段位（当前段/P1/P2/P3）为**建议值**，最终以 wayfinder 寻路图 Issues 仲裁（本报告撰写时 `gh` 不可用，未能拉取实图，见 §6.3 caveat） |

---

## 0. 执行摘要

**总评【判断】**：设界（DesignForge）的工程底盘——纯函数引擎、命令栈事务、三态门禁、证据外置、2711 用例——纪律强度**超过本次调研的全部竞品的公开可观测水平**（竞品闭源，只能比较公开工程叙事）；受控 AI 管线（NL → Design IR → 双重校验 → diff 审批 → 单事务 → 审计）在行业普遍做「生成魔盒」的背景下是清晰的差异化定位。真正的差距集中在两处：**重工程渲染深度**（效果渲染、矢量路径、图片节点、文本排版、大文档性能工程）和 **AI 功能的产品化密度**（竞品已把对话式改稿、一致性检查、多方案生成做成常规功能，设界的受控管线还只有一次性生成入口）。

**五条核心结论**：

1. **功能覆盖**：选择/变换/吸附/对齐/组件/撤销等「编辑内核」已达 Figma P0 对标口径；缺的是四块「重工程」——矢量路径（无 path 节点）、图片（无 image 节点）、效果渲染（数据模型有、渲染管线明确不画）、自动布局主轴 fill。§3.1
2. **体验细节**：缺命令面板（Figma Quick Actions）与快捷键体系收口，这是成本最低、手感收益最高的对标项。§3.2
3. **性能**：渲染技术与 Figma 同源系（CanvasKit-WASM/Skia），但无 Worker 下放、无脏区/分层缓存、无空间索引，大文档（万级节点）有数量级风险；已给出可挂门禁的基准方案（§4），**先测后优化**。
4. **AI 方向**：行业把 AI 做成黑盒生成，设界把 AI 做成受控管线——应把管线入口从「一次性生成」扩展为「常驻工作流」（对话式改稿、令牌一致性检查、多方案、组件感知生成），全部可在 DeepSeek + ComfyUI 边界内落地，且复用既有审批/审计/两态验收设施。§5
5. **工程治理**：存在一批「已知欠账」的低成本收口项（`guard:deps` 空壳、research 分支未合并、README 状态滞后、`services/comfy` 骨架与 daemon 真实现重复），建议先清偿再开新战场。§6.2

**Top 5 行动（按收益/成本比排序）**：

| # | 行动 | 层面 | 成本 | 详见 |
| --- | --- | --- | --- | --- |
| 1 | 受控 AI 提案/写入管线（AI-A0，即 Issues #91）打通后接 A1 对话式改稿：AI 产出 → IR 提案 → diff 审批 → 单事务 | AI | M | §5.3 |
| 2 | 效果渲染管线补齐（P-1）：投影/内阴影/模糊，数据模型已备 | 产品 | M | §6.1 |
| 3 | 命令面板 + 快捷键收口（P-2） | 产品 | S | §6.1 |
| 4 | 工程欠账清偿包（E-1/E-2/E-9）：guard:deps、research 合并、comfy 收敛 | 工程 | XS-S | §6.2 |
| 5 | 性能基准门禁 `verify:perf` 挂点（E-4）：先测后优化，防盲目投入 | 工程 | M | §4 |

> **v1.1 回注（勘误）**：① 前端体验项（P-1/P-2/P-3/P-4 等）的段位已由《前端整体改版总纲 v1》（`frontend-rework-v1.md`）吸收重排，**拆票以总纲 §6 为准**，本报告段位保留作历史口径；② Top5 第 1 项自 v1.1 起以 A0 管线为前置——v1.0 误将「AI 产出→审批→事务」当作已实现（被 Issues #91 证伪），详见 §5.1 与 §7.3。

---

## 1. 范围、方法与口径

### 1.1 竞品集合

- **主锚：Figma 本体**（GLOSSARY 已定：界面与交互以真实 Figma 为逐页对照基准，见 ADR-0002）。
- **横向参照**：Motiff 妙多（AI 功能密度最高）、Penpot（开源同类、自托管）、MasterGo（国内企业级）、即时设计（国内轻量+资源社区）。
- 背景：Sketch、Adobe XD 仅作行业沿革参考，不进矩阵。

### 1.2 对标维度

核心功能覆盖 / 交互体验细节 / 性能表现 / 工程架构 / AI 智能化（五维）。

### 1.3 事实与判断的区分

全文以【事实】【判断】【宣称】标注。竞品闭源部分只能以官方博客/文档/官网口径为准，一律标【宣称】或给出来源；设界自身事实均带仓库内证据锚点。**凡未标锚点的竞品细节均为公开二手资料。**

### 1.4 本项目现状快照（事实）

| 面 | 事实 | 锚点 |
| --- | --- | --- |
| 形态 | 本地优先类 Figma 工作台：Next.js 16.4.1 + React 18.3.1 web、Electron 44.7.2 最小壳、Fastify 5.12.7 本地 daemon（仅 127.0.0.1，端口 4318 起 +32 探测） | `apps/web/package.json`、`apps/daemon/package.json`、`packages/contracts/src/ipc/routes.ts:56-76` |
| 渲染 | CanvasKit-WASM 0.42（Skia 系），递归 + canvas 变换绘制；P0 子集显式声明：效果不画、描边中心线近似、无离屏合成 | `apps/web/package.json:21`、`apps/web/src/features/canvas/render/draw-scene.ts:1-14` |
| 内核 | `@dforge/engine` 纯 TS 零 DOM 零运行时依赖：扁平节点表 Design IR、16 种可序列化命令、CommandStack（事务原子/逆命令 undo/历史上限 200/微任务合并） | `packages/engine/src/model/node.ts:20-28`、`commands/types.ts:157-173`、`commands/stack.ts:109-180` |
| 存储 | 无数据库：文档 = `.dfg` 目录树（manifest 自增 version + pages/*.json 原子写），序列化信封 `$format: dforge.designir, $version: 1`，稳定键序可 Git diff | `apps/daemon/src/documents/store.ts:243-261`、`packages/engine/src/serialize/serialize.ts:34-44` |
| AI | DeepSeek 单供应商（白名单硬编码）、BYOK AES-256-GCM 0600 凭据库、SSE 流式、四步状态机 `queued→llm→validate→compile`、真/降级同构两态验收 | `apps/daemon/src/config/store.ts:30-35,151-155`、`apps/web/src/features/ai/steps.ts:5-15` |
| 出图 | ComfyUI 本地（默认 127.0.0.1:8188），原生 HTTP 客户端真实现（probe/templates/runs + sha256 资产库） | `apps/daemon/src/image/client.ts:2-35,589-612` |
| MCP | 确认桩（dryRun → 一次性 ackToken TTL 2min 只存哈希 → 审计 JSONL）；真实网关归 P5 | `apps/daemon/src/mcp/stub.ts:1-8` |
| 质量 | 292 个测试文件 / 约 2711 用例 / 约 43k 行测试代码（测试量超源码）；20+ `verify:*` 门禁 + 7 `guard:*`，三态退出码（0 过/1 违规/2 阻塞）禁假绿 | `docs/quality/test-report-v1.md`、根 `package.json` |
| 进度 | P0 实际已完成并通过验收（e2e 63/63、机器人回归 68/68、DEF-01/DEF-R1 已修），README「起步中（P0）」叙述滞后 | `docs/quality/test-report-v1.md`、`docs/quality/retro-2026-10-17.md` |

### 1.5 决策口径登记（本次会话裁决）

| # | 决策 | 裁决 |
| --- | --- | --- |
| 1 | 竞品集合 | 5 家全对标（§1.1） |
| 2 | 报告受众 | 施工为主，兼顾答辩 |
| 3 | 与排期关系 | 建议映射到现有优先级体系，可建议调整排序 |
| 4 | AI 章节边界 | **严格边界内**：不提出任何边界扩展项 |
| 5 | 性能口径 | 差距分析 + 基准测试方案（不实跑，留门禁挂点） |
| 6 | 产出形态 | 本文档（Markdown 入 `docs/plan/`） |
| 7 | 时间跑道 | 不设硬截止，优先级按收益/成本比排序 |
| 8 | 建议去向 | 先不建票，报告评审后再定 |

---

## 2. 竞品横向调研

### 2.1 Figma（主锚）

**定位与形态**【事实】：Web 优先 + 桌面壳，多人文档协作 SaaS，企业级（组织库/SSO/管理台）。

**核心功能**【事实】：界面设计（Frame/Auto Layout/组件/变体/变量 Variables/样式）、原型（Flows/Smart Animate）、Dev Mode（inspect + 设计→代码）、版本历史、多人文档实时协作、评论、插件社区。AI 套件（2025-2026）：**Figma Make**（prompt 生成可运行原型/应用）、**First Draft**（自然语言 → 可编辑线框/设计稿）、**Figma agent**（对话助手，可搜索文件、支持用户可配置设计规范，已出 beta）、图像生成/编辑。（来源：[Figma AI](https://www.figma.com/ai)、[First Draft 帮助文档](https://help.figma.com/hc/en-us/articles/23955143044247-Use-First-Draft-with-Figma-AI)、[Figma Make](https://www.figma.com/make)、[Release Notes](https://www.figma.com/release-notes)）

**交互体验**【事实】：全量快捷键体系 + **Quick Actions 命令面板**（`Cmd/Ctrl+/`）；数值输入框拖拽 scrubbing；智能吸附与等距测量提示；多人光标与跟随；评论钉。

**性能与架构**【事实】：C++ 核心编译 WASM（官方 2017 博客：加载时间降为 1/3）；渲染 2025-09 已从 WebGL 迁移 **WebGPU**；引擎与 UI 分层、多线程 worker；文档**分形/按需加载**支撑超大文件；绘制直连 GPU 画布而非 DOM。（来源：[WebGPU 迁移](https://www.figma.com/blog/figma-rendering-powered-by-webgpu)、[WASM 3x](https://www.figma.com/blog/webassembly-cut-figmas-load-time-by-3x)、[madebyevan.com/figma](https://madebyevan.com/figma)）

### 2.2 Motiff 妙多

**定位**【宣称】：猿辅导系看云软件出品，「AI 时代设计工具」；愿景从 Copilot 到 Autopilot。（[官网](https://miaoduo.com)、[AI 页](https://www.miaoduo.com/ai)）

**AI 功能密度（行业最高梯队）**【宣称】：AI 生成 UI（多模态：文本/草图/参考图，支持 3000 字长需求）；对话式 AI（基于设计风格生成、迭代现有设计、「指哪改哪」）；**AI 魔法框**（结合上下文的局部智能编辑）；AI 风格匹配/整站改版；**AI 一致性检查**（设计规范一致性）。

**功能与性能**【宣称】：Figma 同构功能面（组件/变体/自动布局/协作）；自研渲染引擎，官方称大文档流畅。

### 2.3 Penpot

**定位**【事实】：开源（MPL）设计平台，**自托管优先**（Docker/K8s/air-gap），前端-设计协作叙事。（[官网](https://penpot.app)、[自托管](https://penpot.app/self-host)、[GitHub](https://github.com/penpot/penpot)）

**核心**【事实】：基于开放标准（文件以 SVG/CSS/HTML 表达，无私有格式）；Clojure 后端 + PostgreSQL；2.x 起自研 **WASM 渲染器**；组件/设计令牌/DevMode；面向设计与代码协作的插件体系（公开资料，未深核）。

**对本项目的意义**【判断】：Penpot 是「开放格式 + 自托管」路线的唯一规模化先例，与设界「`.dfg` 目录态 + 本地优先 + 无私有黑盒」同路；其 WASM 渲染器演进路径印证了设界 CanvasKit-WASM 选型。

### 2.4 MasterGo（莫高设计）

**定位**【宣称】：企业级产设研一体化平台；宣称国内协同设计市占 79.25%（出自其自家 2025 年报告，需打折看）。（[官网](https://mastergo.com)、[2025 报告](https://mastergo.com/blog/105)）

**核心**【宣称】：500 人在线协同；组件/变体/自动布局/Figma 文件导入；**AI 设计助手**（画布内自然语言：生成设计稿、调整所选区域、生成图片素材）；**AI 快搭**（页面级快速搭建）；**AI 深度理解企业 Design System**（生成时调用企业现有样式/组件/图标，保证符合业务规范）；**D2C Pro**（设计转代码，宣称 100+ 头部企业采用）。

### 2.5 即时设计

**定位**【宣称】：Web 端专业 UI 工具 + 资源社区，免费策略激进。（[官网](https://js.design)、[AI 文章](https://js.design/special/article/js-%20design-ai.html)）

**核心**【宣称】：**即时 AI**——自然语言一次生成 4 张**可二次编辑**的矢量 UI 稿（含矢量图层与图标，非图片）；文字/手绘/图片三种生成模式；Sketch 源文件导入；自动布局/组件/变体/白板/原型/标注切图一体。

### 2.6 背景：Sketch 与 Adobe XD

【判断·行业常识】Sketch（macOS 原生）是 Figma 兴起前的事实标准，单人文档+文件交付模式在协作维度被全面替代；Adobe XD 在 2023 年 Adobe 放弃收购 Figma 后实际进入维持态。两者对设界的参考价值仅在「桌面原生交互惯性」与「本地文件形态」，不构成对标对象。

### 2.7 横向归纳矩阵

| 维度 | Figma | Motiff | Penpot | MasterGo | 即时设计 | **设界（本项目）** |
| --- | --- | --- | --- | --- | --- | --- |
| 形态 | Web+桌面 SaaS | Web 协作 SaaS | 开源自托管 | Web 企业 SaaS | Web SaaS | **本地优先（web/daemon/桌面壳）** |
| 文档真值 | 云端私有格式 | 云端 | **开放 SVG/CSS** | 云端 | 云端 | **本地 `.dfg` 目录态，可 Git diff** |
| 渲染技术 | C++/WASM + **WebGPU** | 自研（宣称） | 自研 WASM | 未公开 | 未公开 | **CanvasKit-WASM (Skia)** |
| 协作 | 实时多人（标杆） | 实时多人 | 实时多人 | 宣称 500 人 | 实时多人 | **无 CRDT/OT（主动取舍）** |
| 组件/设计系统 | 组件+变体+Variables | 同构 Figma | 组件+令牌 | 同构+企业 DS 深度理解 | 同构 | **组件 P0 + 文档内嵌 W3C DTCG 令牌** |
| AI 生成 | Make/First Draft/agent | 生成 UI+对话改稿+魔法框+一致性检查 | 弱（探索 AI 工作流） | AI 助手+快搭+DS 理解+D2C | 文生 UI（4 张可编辑矢量稿） | **受控管线（定位口径；应用路径待 A0 接线，#91）** |
| AI 出图 | 云端生成 | 云端 | 无 | 云端素材 | 云端 | **本地 ComfyUI（零出机零成本）** |
| 生态扩展 | 插件社区 + Dev Mode MCP | 插件 | 插件体系 | 开放 API/D2C | 资源社区 | **MCP 双端（ZCode/WorkBuddy）+ 技能市场** |
| 导入导出 | 导 Sketch；导 PNG/SVG/PDF/代码 | 导 Figma/Sketch | 开放格式互导 | 导 Figma/Sketch | 导 Sketch | **导出 pdf/png/svg/scene；无导入器** |
| 商业模式 | 席位订阅 | 订阅+免费档 | 开源+托管服务 | 企业订阅 | 免费增值 | **毕业设计/开源（无商业化）** |

### 2.8 行业共性趋势【判断】

1. **AI 从「功能」变「入口」**：五家竞品全部把 AI 生成做进主工作流（画布内助手/对话改稿），不再是独立菜单。
2. **AI 与设计系统融合**是分水岭：MasterGo 的「企业 DS 深度理解」与 Motiff 的「一致性检查」代表 AI 从「出稿」走向「守规范」——这恰与设界的令牌+校验设施天然互补。
3. **渲染内核 WASM 化**已成行业共识（Figma/Motiff/Penpot 三家独立走通），设界选型站在了正确的一边；下一梯队的分差在 **WebGPU、Worker 化、分形加载**这些「重工程」投入。

---

## 3. 对标分析：设界 vs 基准

对比总则：主锚 = Figma 本体；验收口径沿用 ADR-0002 + `docs/spec/acceptance-standard-v1.md`（A 级像素级断言，1440×900/DPR 1.5，差异率 ≤0.1%）。

### 3.1 核心功能覆盖差距

| 功能域 | 设界现状（事实，带锚点） | Figma 本体 | 差距判定 |
| --- | --- | --- | --- |
| 基础图形 | 8 类节点：rect/ellipse/text/frame/group/component/component_set/instance（`node.ts:20-28`） | 另有矢量路径、图片、布尔组、section 等 | **缺失（重大）：无 path/image 节点** |
| 选择与变换 | 点选+框选、旋转节点、clipsContent 裁剪、编组穿透、实例原子（`hit-test.ts` 165 行） | 同级 | 对齐 |
| 吸附/对齐/分布 | 6px 屏幕阈值按 zoom 换算、参考线+测量数据（`snap.ts:18-25`）；align/distribute 命令族 | 同级 | 对齐 |
| 组件系统 | 主↔实例、覆盖/重置、变体（P0 子集，`components.ts` 238 行） | 嵌套属性变体、推荐变体 | 部分对齐 |
| 自动布局 | 两遍求解子集；**主轴 fill 伸缩未实现**（`auto-layout.ts:21`） | 完整 | 差距（已挂账） |
| 文本 | 数据面+结构化编辑操作（`text.ts`）；**无文本测量/排版引擎**（依赖渲染层供给） | 完整排版/OpenType/字体回退链 | 差距 |
| 效果 | effects 数据模型存在（`node.ts` Paint 数组），**渲染 P0 明确不画**（`draw-scene.ts:11-14`） | 投影/内阴影/模糊全渲染 | **差距（数据已备，只差渲染管线）** |
| 圆角/混合 | 四角统一（`node.ts:57`）；blendMode 仅 6 档（`node.ts:34`） | 四角独立 + 全档 | 小差距（低成本收口） |
| 设计令牌 | 文档内嵌 W3C DTCG 子集 + 别名链/环检测解析 | Variables + 团队库 | 形态对齐（**本地/标准格式是差异化**） |
| 原型交互 | 无 | Flows/Smart Animate | **缺失（重大）** |
| 评论 | FE-07 已落地（评论/重开/版本遮罩） | 评论/回复/已解决 | 部分对齐 |
| 版本 | manifest 自增 version + `document.replace` 回滚 + 版本遮罩；本地 Git 补位 | 无限云历史 | 部分对齐（**Git 可 diff 是差异化**） |
| 多人协同 | 无 CRDT/OT，主动取舍（`architecture-v1.1.md:87`；预留 actor 等价性） | 实时多人 | 缺失（**明示取舍，非缺陷**） |
| 检查/导出 | inspect-export feature + daemon 导出 pdf/png/svg/scene（已知保真缺陷 #86：跳过文本/位图、PDF 无圆角透明度、无多页；超大导出无预检 #98） | Dev Mode + 多格式 | 部分对齐 |
| 文件导入 | 无 | Figma 导 Sketch；MasterGo/即时导 Figma/Sketch | **缺失** |
| AI 生成 | 受控四步状态机（`steps.ts:15`）；**产出仅文本，应用路径未接线（#91）** | Make/First Draft | 形态差异（§3.5） |
| AI 出图 | ComfyUI 本地真实现 | 云端生成 | **差异化（零出机/零成本/可复现）** |
| 生态 | MCP 确认桩 + 技能市场四类资产 | 插件社区 + Dev Mode MCP | **差异化方向（agent 原生）** |
| i18n | 全中文唯一暴露（ADR-0003，捆绑 Noto Sans SC 禁静默回退） | 多语言 | 按定位对齐 |

**小结【判断】**：「编辑内核」层（选择/变换/吸附/组件/撤销）质量高、可对标；「重工程」层（path/image/效果/排版/自动布局 fill）与「生态」层（导入器/原型）是两片明确空地。**渲染差距最便宜**（effects 数据已在），**path 节点最贵**（动 model/hit-test/render/edit 四层）。

### 3.2 交互体验细节差距

| 项 | 现状（事实/未证实标注） | Figma 本体 | 建议 |
| --- | --- | --- | --- |
| 命令面板 | 无（feature 域清单中无对应物）【事实】 | Quick Actions（`Cmd+/` 全命令可达） | **P-2，成本最低的手感对标项** |
| 快捷键 | 引擎 `input/keyboard.ts` + 13 类交互白名单已覆盖基础键位【事实】 | 全量体系 + 键位速查卡 | 收口 + 速查浮层 |
| 数值 scrubbing | Inspector 是否支持拖拽改值**未证实**（未逐文件核查） | 输入框拖拽 scrubbing | 若无则列为 Inspector 打磨项 |
| 空态/错误文案 | 批次 4 G 包已打磨（分因文案、错误码沉入「诊断信息」、行内反馈）【事实】 | 同级 | 维持 |
| 主题 | 双基准令牌（首页浅色族/编辑器深色族）+ 密度轴 +「禁裸值」机器守卫【事实】 | UI3 双态 | 对齐 |
| 引导层 | 无 onboarding/首用引导【事实】 | 有 | P3（毕业设计受众可后置） |

### 3.3 性能表现差距（分析性对比）

**Figma 的性能构成**【事实】：C++ 引擎 WASM 化 + 多线程 worker + WebGPU 直绘 + 文档分形加载；效果是「数万图层 60fps 滚动缩放」。

**设界的现状**【事实】：渲染在主线程单 rAF 循环（`render/frame-loop.ts`），每帧递归遍历可见节点树绘制（`draw-scene.ts`），已做：文本段落缓存（`paragraph-cache.ts`）、Skia 对象复用（`DrawTools`）、渲染计数器（`SceneDrawCounters` nodes/clipped——可支撑剔除率度量）。未做：Worker 下放、脏矩形/分层缓存、空间索引、分页惰性加载。

**风险判断【判断】**：千级节点内体验预计对齐（引擎纯函数 + Skia 对象复用已消除两大常见坑）；万级节点有数量级风险——递归遍历 + 全量重绘的复杂度上限决定。**先测后优化**：§4 基准方案给出可挂门禁的度量，避免在无数据情况下投入 Worker 化/空间索引这类 L 级工程。

### 3.4 工程架构对比

**设界的强项（对照竞品公开叙事）【事实+判断】**：

1. **文档真值架构**：`.dfg` 目录态 + manifest 版本 + 原子写 + 序列化幂等往返（`serialize.ts:1-8`），本地可 Git diff——Penpot 的开放格式是同类理念，但设界的结构化 manifest 更进一步（页级文件、回滚命令、提交点语义）。
2. **命令栈事务**：写操作唯一入口、失败整体回滚、逆命令 undo、高频写入微任务合并、历史深拷冻结（`stack.ts:109-271`）——与 Figma 的多人历史模型同构度高的单人子集。
3. **AI 即 actor**：用户/AI/导入器/MCP/协作模拟五类 actor 在事务层等价（`engine/commands/types.ts:4-7`）——这是竞品（黑盒 AI 直接改文档）没有的架构性质。
4. **质量工程**：三态门禁禁假绿 + 证据外置 + 对抗测试 + 行为快照 sha256 独立复核 + 2711 用例——超过所有竞品可观测的公开工程叙事。

**可借鉴点【判断】**：

- **Figma：Worker 化与分形加载**。引擎零 DOM 纯 TS，天然可下放 Worker（命令栈/布局计算）；`.dfg` 页级文件天然支持页级惰性加载。两项都以 §4 基准数据为前提。
- **Figma：WebGPU 路线图**。CanvasKit-WASM 与 WebGPU 同为 Skia 系下游，渲染层接口（`DrawContext`）已隔离实现，未来切换有通路，现在**只需保持接口不漏 DOM** 即可，零成本保留选项。
- **Penpot：开放格式互导**。`.dfg` 已是结构化目录，`inspect-export` 可补「导出带 CSS 的 HTML」一步到位服务产研交接。
- **MasterGo：AI × 设计系统**（进入 §5 主线）、**即时设计：资源社区**（对应设界技能市场，验证方向正确）。

**工程治理缺口（事实清单，全部低成本）**：

| 缺口 | 证据 |
| --- | --- |
| `guard:deps` 依赖方向守卫是 exit 2 空壳 | `scripts/guard-deps.mjs:3,22` |
| `guard:mcp-contract` / `guard:channel-pairing` 未实现 | `AGENTS.md` 门禁实况行 |
| 浏览器门禁（verify-figma-*/canvas/e2e:smoke/shell-parity）未入 CI | `ci.yml:83-101` |
| README 状态行滞后（P0 已完成仍写「起步中」） | `README.md:11-13` vs `docs/quality/test-report-v1.md` |
| research/* 三篇报告（Figma 盘点/WorkBuddy/GitHub 供给）散落分支未并 main | packed-refs |
| 序列化只识别 `$version`，无迁移机制 | `serialize.ts:119-172` |
| `services/comfy` 骨架占位与 daemon 真 client 重复 | `services/comfy/src/index.ts:1-11` |
| 市场数据欠账：DS 卡 0 张、1152 资产未入索引（ADR-0004 ④ 待裁决） | `docs/research/2026-10-16-market-first-runthrough.md` |

### 3.5 AI 智能化定位对比

| AI 能力 | Figma | Motiff | MasterGo | 即时设计 | **设界** |
| --- | --- | --- | --- | --- | --- |
| 文生设计稿 | First Draft | AI 生成 UI | AI 助手/快搭 | 即时 AI（4 张） | 受控管线（单次） |
| 对话式改稿 | agent | 指哪改哪 | 画布内助手 | — | **无（管线可支撑）** |
| 一致性检查 | —（guidelines 可配） | **有** | 企业 DS 理解 | — | **无（validate 步可扩展）** |
| 多方案生成 | — | 风格匹配 | — | **4 张/次** | 无 |
| AI 出图 | 云 | 云 | 云 | 云 | **本地 ComfyUI** |
| 生成可控性 | 黑盒出稿 | 黑盒 | 黑盒（DS 约束） | 黑盒 | **IR→校验→diff 审批→事务→审计** |

**定位判断【判断】**：行业主流是「生成魔盒」——AI 直接产出结果，用户事后收拾；设界是「受控管线」——AI 产出必须是 Design IR、过双重校验、逐项 diff 审批、单事务落库、全程审计可回放。**后者在架构上更正确**（AI 永远不破坏文档不变式，`invariants.test.ts` 对 AI actor 同样成立），且「审计回放」在答辩场景是独有叙事。**短板在产品感知密度**：竞品的对话式改稿/一致性检查/多方案已是常规功能，设界受控管线目前只有一次性生成一个入口。**结论：不换定位，扩入口**——这正是 §5 的主线。

### 3.6 设界差异化优势清单（防失衡叙事，答辩可引用）

1. 本地真值 + Git diff + 离线完整可用（五家竞品全云端锁死）。
2. 受控 AI：diff 审批 + 审计回放 + 真/降级同构两态验收——行业独有。
3. 本地出图（ComfyUI）：零出机、零成本、可复现。
4. MCP 双端（ZCode/WorkBuddy 读写同一设计真值）：agent 原生方向，竞品仅 Figma Dev Mode MCP 相近且只读向。
5. 技能市场数据飞轮（采集→四层→评分→检索→采纳回流）：竞品插件商店无数据工程。
6. 质量工程：三态门禁/证据外置/对抗测试/行为快照——公开可比维度内无竞品对标物。

---

## 4. 性能基准测试方案（不实跑，留门禁挂点）

### 4.1 原则

1. 【裁决 §1.5-5】只给方案不跑分；方案按项目门禁文化设计（三态退出码 + 证据落盘），将来作为 `verify:perf` 挂点接入。
2. 所有度量基于**确定性文档**：引擎已支持注入确定性 `IdFactory`（`model/ids.ts:31-40`），同一生成参数 → 同一文档 → 跨机可比。
3. 真链路优先（`docs/quality/test-plan-v1.md` §2.1 惯例）：量真实 daemon + 生产构建 + 真 Chromium。

### 4.2 指标定义

| 指标 | 定义 | 规模档 | 采集方式 |
| --- | --- | --- | --- |
| M1 首帧时间 | 打开 N 节点文档 → 首个有效绘制帧 | 1k / 5k / 20k | CDP Tracing + rAF 首帧时间戳 |
| M2 交互帧率 | 拖拽/框选/滚轮缩放期间 rAF 间隔分布 | 同上 | CDP `Tracing.start`（devtools.timeline）取帧时长 p95/p99 |
| M3 选中→面板延迟 | 点击节点 → Inspector 反映（paint 完成） | 5k | PerformanceObserver + 自埋点（HUD 已有 `useCanvasHud` 通道） |
| M4 撤销延迟 | 单次 undo 命令施加 + 重绘完成 | 5k | 引擎侧计时（`CommandStack.dispatch`）+ 帧时间 |
| M5 保存往返 | `.dfg` manifest+pages 原子写全程 | 5k / 20k | daemon 路由计时（telemetry JSONL 已有通道） |
| M6 内存峰值 | 打开+操作 20k 文档后 JS heap | 20k | CDP `HeapProfiler` |
| M7 剔除率 | `SceneDrawCounters.clipped / nodes`（无效绘制占比） | 20k | 渲染计数器已有（`draw-scene.ts:46-49`） |

### 4.3 工具与实现要点

- 浏览器侧：复用仓库既有 `playwright-core` + CDP（`scripts/lib/browser-toolchain` 已有封装）；场景脚本放 `scripts/e2e/scenarios/` 同层。
- 引擎侧微基准：命令栈/布局纯 TS，可直接 vitest 计时（无需浏览器），产出 engine 维度基线。
- 确定性文档生成器：`packages/engine` 新增 test 工具（利用 IdFactory），同时服务 M1-M7 与单测。
- 证据：`artifacts/verify-perf/evidence.json`（`df.perf.evidence/v1`：指标→值→阈值→机器信息），沿用证据外置纪律。

### 4.4 初始目标值【判断·全部为初始假设，待基线校准】

| 指标 | 初始目标（本地开发机） | 备注 |
| --- | --- | --- |
| M2 拖拽 rAF p95 | < 16.7ms @ 5k 节点 | 60fps 线；20k 档先记录不设阈值 |
| M1 首帧 | < 1.5s @ 5k | 本地无网络 |
| M4 撤销 | < 50ms | 含重绘 |
| M5 保存 | < 300ms @ 5k | 原子写串行 |
| M7 剔除率 | 视口外剔除 > 60% @ 20k | 若远低于此值，空间索引才立项 |

### 4.5 门禁挂点设计

`verify:perf`：无基准脚本时 exit 2（阻塞语义，与既有挂点一致）；接入后基线值入库（`docs/quality/perf-baseline-v1.md`），回退超阈值 → exit 1。**先记录两轮基线，再决定 E-6/E-7（Worker 化/空间索引）是否立项**——这是「先测后优化」纪律的门禁化。

---

## 5. AI 智能化方向（严格边界内）

**边界纪律**【裁决 §1.5-4】：本章全部建议运行在既有边界内——文本 = DeepSeek 上云（BYOK、可脱敏、可关闭）、图像 = 本地 ComfyUI（零出机）。不提出任何多供应商、多模态或云侧扩展项。

### 5.1 现有 AI 能力盘点（事实）

| 能力 | 现状 | 锚点 |
| --- | --- | --- |
| 生成管线 | 四步状态机 `queued→llm→validate→compile`，失败可重试 | `features/ai/steps.ts:15` |
| 降级纪律 | 真/降级响应同构，UI 与门禁零分支 | `steps.ts:5-7` |
| 两态验收 | 态 A 无 key 降级 / 态 B 本机 mock OpenAI-compatible SSE 上游（不出机） | `scripts/verify-ai-two-state.mjs:1-46` |
| LLM 后端 | DeepSeek `deepseek-chat`，SSE 流式，重试 ≤2（退避 300/900ms，仅 429/5xx），60s 上游超时 | `apps/daemon/src/ai/client.ts`、`config/store.ts:30-35` |
| 凭据 | BYOK，AES-256-GCM 0600 落盘，主密钥分离，响应/日志不含明文 | `apps/daemon/src/credentials/store.ts:4-10,55-69` |
| 提案→文档 | **未接线（v1.1 勘误）**：`AiChatResponse` 仅有 `content` 文本载荷（`contracts/ai/index.ts:64-74`），AI 物理上无法产出可审批的设计变更；「IR→双重校验→diff 审批→单事务」是支柱**口径**与引擎**能力**（命令栈），中间的应用管线为规划项（**Issues #91**）；MCP 确认通道为桩 `applied:false`（#89） | `packages/contracts/src/ai/index.ts`、`apps/daemon/src/mcp/stub.ts`、Issues #91/#89 |
| 出图 | ComfyUI 本地真实现（probe/templates/runs），sha256 资产库，未启动是一等状态；已知缺陷：任务仅内存、重启 404（#90）、取消串扰（#83）、探测误判（#85） | `apps/daemon/src/image/client.ts:2-35` |
| MCP 入口 | 确认桩（dryRun→ackToken→审计），真实网关归 P5 | `apps/daemon/src/mcp/stub.ts` |
| 遥测 | telemetry JSONL 已有通道（采纳率指标的地基）；已知缺陷：自由文本泄漏与 totalTokens 误脱敏（#95），A3 设计前先修 | `apps/daemon/src/routes/` telemetry、Issues #95 |

### 5.2 差距（产品感知密度）【判断】

竞品已成常规的四个 AI 交互，设界缺失：**上下文对话改稿**（Motiff「指哪改哪」/MasterGo 画布内助手）、**一致性检查**（Motiff）、**多方案生成**（即时设计 4 张）、**生成结果进工作流的闭环**（生成→落画布→继续编辑）。共同根因：受控管线目前只有「一次性文生 IR」一个入口，且入口不在画布上下文中。

### 5.3 边界内可引入特性（A0-A8）

每条给出：竞品参照 → 实现路径（精确到既有模块）→ 成本/收益。

**A0 受控 AI 提案/写入管线**（P1 之首；v1.1 新增，即 Issues #91 的实现）
- 路径：契约层为 AI 响应增加**提案载荷**（Design IR 片段 / NodePatch 集，或独立提案端点）→ 复用引擎「五类 actor 在事务层等价」设计（`engine/commands/types.ts:4-7`）经 CommandStack 单事务落库 → 审批 UI 复用 McpConfirmBar 确认骨架（`features/mcp/components/`）做逐项 diff → 审计沿既有 MCP 审计 JSONL 模式延伸。
- 成本 M-L；收益：把「受控 AI」支柱从架构声明变为可运行事实，**是 A1/A2/A3/A4/A6 的共同前置**。

**A1 上下文对话式改稿**（P1，依赖 A0；参照 Motiff/MasterGo）
- 路径：选中节点集 → 以子 IR 快照注入 `/ai/chat` 载荷（`packages/contracts` AI 命名空间扩展字段）；daemon 侧 prompt 组装加「当前选中 + 文档令牌清单」上下文段（`apps/daemon/src/ai/client.ts`）；响应产出 **NodePatch 提案**（A0 载荷）→ 经 A0 的「diff 审批 → 单事务」管线落画布；前端 `AiDrawer` 增加选中上下文条（`features/ai/components/`）。
- 成本 M（自身 S-M，另需 A0 前置）；**收益最高**：把一次性生成升级为常驻工作流，且全程在审批/审计纪律内。

**A2 令牌一致性检查**（P1，参照 Motiff 一致性检查 / MasterGo 企业 DS）
- 路径：`tokens/tokens.ts` 解析结果（别名链/环检测已有）+ 文档扫描（偏离令牌的裸色值/字号）→ 组装进 validate 上下文 → DeepSeek 生成「建议切换到令牌 X」的 `AiSuggestion`（**该类型已存在**，`contracts` AI 命名空间）；UI 在 `AiDrawer` 或 Inspector 展示。
- 成本 S（动作类建议「切换令牌」落画布依赖 A0；纯提示形态可先行）；两态验收直接适用；答辩演示「AI 守规范而非出稿」的最佳载体。

**A3 采纳率遥测闭环**（P1，依赖 A0）
- 路径：审批结果（逐项 accept/reject）写入既有 telemetry JSONL → 汇总采纳率指标 → 喂给技能市场「采纳回流」叙事（数据飞轮支柱的 AI 延伸）；**前置修复 #95**（遥测自由文本泄漏 / totalTokens 误脱敏）。
- 成本 S；把三支柱中的「受控 AI」与「数据飞轮」接通，叙事完整度显著提升。

**A4 多方案生成**（P2，依赖 A0；参照即时设计 4 张）
- 路径：DeepSeek 同 prompt 多次采样（并行 N 次，temperature 扰动）→ 四步状态机扩展为「方案条」形态（`AiRunState` 增加方案数组，纯逻辑层先行，符合本项目「状态机单一真源」纪律）→ 选中方案进入既有审批。
- 成本 M；出图侧 ComfyUI 天然多 seed，可同构支持。

**A5 组件感知生成**（P2，参照 MasterGo 企业 DS 理解）
- 路径：prompt 注入文档组件清单（`component/component_set` 已有）+ IR 指南（「优先用 instance + overrides 表达重复」）；validate 步增加「instance 覆盖率」启发式指标。
- 成本 M；让生成结果天然贴合文档结构，审批 diff 更小、采纳率更高（与 A3 联动）。

**A6 批量文案/真实数据填充**（P2，依赖 A0）
- 路径：枚举选区/页面内 text 节点 → DeepSeek 一次生成文案集 → 单命令事务落库（批量 update 走 `node.update` 命令族）。
- 成本 S；高频刚需（填充假文案是设计流程真实痛点），演示性价比高。

**A7 审计回放可视化**（P2，设界独有卖点）
- 路径：MCP 审计 JSONL + 命令历史（`CommandStack` 快照/订阅已有）→ 只读回放视图（时间轴 + 逐命令 diff）。纯 UI 工程，不动引擎。
- 成本 S-M；「受控 AI」支柱从架构性质变成**看得见的功能**，答辩强项。

**A8 出图闭环落画布**（P3，跨依赖）
- 路径：ComfyUI 生成资产（sha256 已落盘）→ 挂到节点的图片填充。**前置依赖：图片节点/填充类型（P-3）**，此依赖未解前不立项。
- 成本 M；打通「本地出图 → 设计资产」最后一公里。

### 5.4 优先级排序与理由

| 优先级 | 特性 | 排序理由 |
| --- | --- | --- |
| P1 | **A0 提案/写入管线（#91）** → A1 对话改稿、A2 一致性检查、A3 采纳率遥测 | A0 是全章节共同前置（v1.1 勘误：应用路径未接线）；打通后 A1/A2/A3 复用同一管线，边际成本最低；A1 补最大产品感知差距，A2/A3 分别强化「受控 AI」与「数据飞轮」两支柱叙事 |
| P2 | A4 多方案、A5 组件感知、A6 批量文案、A7 审计回放 | 各自独立可并行；A7 是答辩差异化，A4/A5/A6 是功能密度补课 |
| P3 | A8 出图闭环 | 受 P-3（图片节点）阻塞，依赖解除后自动升 P1 |

【判断】以上排序不设硬截止约束（§1.5-7），按「复用既有设施的深度 × 差距大小」排序；若进入答辩冲刺期，A2+A7（演示效果/成本比最高）可临时提级。

---

## 6. 优化建议总表

优先级为**建议段位**：当前段（wayfinder 现行目的地：前端对标 Figma 可验收 + 市场首实现）、P1（次一段）、P2（中期）、P3（远期）。成本 S/M/L = 预估一票/两三票/多票分期。

### 6.1 产品层面

| 编号 | 建议 | 优先级 | 预期收益 | 成本 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| P-1 | **效果渲染管线**：投影/内阴影/层模糊接入 draw-scene（数据模型已备，`node.ts` effects 数组） | 当前段-P1 | 对标页 C 区验收通过率；视觉等价审查不再需要人工豁免 | M | Inspector 效果分区（原计划挂点） |
| P-2 | **命令面板 + 快捷键收口**：Quick Actions（`Cmd+/`）+ 键位速查浮层 | 当前段-P1 | 最高性价比的手感对标；高频用户效率 | S | 无 |
| P-3 | **图片节点与图片填充**：新增 image 节点类型（model/hit-test/render/edit 四层） | P1-P2 | 解锁素材基本盘与 A8 出图闭环 | M | 命令族扩展 + 序列化版本策略（E-5） |
| P-4 | **自动布局主轴 fill**：补两遍求解缺的伸缩语义 | P1 | 布局对标完成度；真实 UI 稿还原必需 | S-M | 无 |
| P-5 | **四角独立圆角 + blendMode 扩档**：P0 挂账收口 | P2 | Inspector 表达力；对标页细节 | S | 无 |
| P-6 | **矢量路径节点（分期）**：先 path 节点 + 直线/折线编辑，后贝塞尔钢笔 | P2-P3 | 与 Figma 最大的单点功能差距 | **L** | P-3 同款四层动土；建议独立寻路段 |
| P-7 | **原型交互最小集**：Flows（链接热区 + 演示模式） | P3 | 产品完整度叙事 | L | 无 |
| P-8 | **导入器**：先 Sketch（开放 zip+JSON）后评估 Figma | P3 | 迁移路径；社区可用性 | L | **clean-room 合规审查前置**（只解析公开文档格式，不取第三方源码）；与 #92（.dfg 外部导入/打包导出缺失）同域，互相引用避免各修一半 |
| P-9 | **布尔运算**：union/subtract/intersect | P3 | 图形编辑完整度 | M-L | 依赖 path（P-6） |
| P-10 | **市场数据质量收口**：ADR-0004 ④ digest 口径裁决；DS 卡 0 张问题；1152 资产入索引 | 当前段 | 数据飞轮可信度（344→1200+ 卡） | S | 无 |

### 6.2 工程层面

| 编号 | 建议 | 优先级 | 预期收益 | 成本 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| E-1 | **实现 `guard:deps`**：把 exit 2 空壳变成真守卫（依赖方向 apps→packages 单向断言） | 立即 | 架构纪律机器化，防止跨层深导入回潮 | S | 无 |
| E-2 | **research/* 三篇合并回 main + README 状态行更新** | 立即 | 知识资产归位；叙述与实况一致 | XS | 无 |
| E-3 | **services/comfy 收敛**：骨架与 daemon 真 client 二选一（保留 contracts 接口） | 立即 | 消除双真源 | XS | 无 |
| E-4 | **`verify:perf` 性能门禁挂点**：按 §4 方案落地 | P1 | 「先测后优化」纪律门禁化 | M | §4 确定性文档生成器 |
| E-5 | **序列化版本迁移机制**：定策略（显式迁移表 vs 前向兼容读）+ 首个迁移示例；**先堵 #87**（未来/非法 `$version` 被静默接受——比缺迁移更急的数据损坏风险，非法版本应显式拒绝） | P1 | `$version` 从「识别」变「可演进且不可误读」，是 P-3/P-6 加节点的前置保险 | S（先定策略） | Issues #87 |
| E-6 | **渲染 Worker 化 + 页级惰性加载**：命令栈/布局下放，`.dfg` 页级按需加载 | P2 | 大文档规模上限 | **L** | **E-4 基准数据前置**（无数据不立项） |
| E-7 | **空间索引/视口剔除优化**：递归遍历 → 索引加速 | P2 | 万级节点帧率 | M | E-4（看 M7 剔除率） |
| E-8 | **MCP 真实网关评估提前**：确认桩 → 真写事务（P5 规划项） | P2 | 「MCP 双端读写真值」支柱闭环；agent 原生差异化落地 | M-L | E-5 版本策略；审批 UI 复用 |
| E-9 | **浏览器门禁入 CI**：Chromium + 冻结参照集 | P1 | 像素级验收自动化（对标流程的核心门禁转正） | M | 参照集冻结（截图集已冻结口径见 ADR-0002） |

### 6.3 与 wayfinder 排期的映射【判断，待实图仲裁】

- **当前段**（前端对标 Figma 可验收）：P-1（效果渲染直接决定 C 区验收）、P-2（命令面板）、P-10、E-1/E-2/E-3（欠账清偿）、E-9（验收自动化）。
- **P1（次一段）**：AI 三条（A1/A2/A3）、P-3/P-4、E-4/E-5、E-8 评估。
- **P2/P3（中期/远期）**：P-5~P-9、A4~A8、E-6/E-7。
- **caveat**：本报告撰写时 `gh` 不可用（exit 255），未能拉取 wayfinder 实图；段位是基于 README 状态行与票号体系（FE/MK/ENG）的推断。**落地前以 Issues 实图仲裁**，冲突时以本报告 §0 Top 5 的收益/成本比排序为协商基准。

### 6.4 风险与依赖链

1. **P-6（path）是最大成本项**且 P-9 依赖它：若资源受限，宁可不做也不做半套（半套 path 会破坏「13 类交互白名单」的语义完备性纪律）。
2. **E-6/E-7 必须后置于 E-4**：无基线数据就上 Worker 化，是本项目纪律文化里典型的「假绿优化」。
3. **P-3/P-6 动 Design IR**：必须先落 E-5（版本迁移策略），否则破坏 `.dfg` 前后兼容。
4. **A8 被 P-3 阻塞**：AI 排期不要抢跑在数据模型前面。

---

## 7. 附录

### 7.1 参考资料

- Figma：[AI 总览](https://www.figma.com/ai) · [First Draft](https://help.figma.com/hc/en-us/articles/23955143044247-Use-First-Draft-with-Figma-AI) · [Figma Make](https://www.figma.com/make) · [Release Notes](https://www.figma.com/release-notes) · [WebGPU 渲染](https://www.figma.com/blog/figma-rendering-powered-by-webgpu) · [WASM 3x 加载](https://www.figma.com/blog/webassembly-cut-figmas-load-time-by-3x) · [引擎技术总览（创始人）](https://madebyevan.com/figma)
- Motiff：[官网](https://miaoduo.com) · [妙多 AI](https://www.miaoduo.com/ai)
- Penpot：[官网](https://penpot.app) · [自托管](https://penpot.app/self-host) · [GitHub](https://github.com/penpot/penpot)
- MasterGo：[官网](https://mastergo.com) · [AI 功能](https://mastergo.com/ai) · [2025 协同设计报告（自家口径）](https://mastergo.com/blog/105)
- 即时设计：[官网](https://js.design) · [即时 AI](https://js.design/special/article/js-%20design-ai.html)

### 7.2 关键证据索引

引擎模型/命令/序列化：`packages/engine/src/model/node.ts`、`commands/types.ts`、`commands/stack.ts`、`serialize/serialize.ts`、`tokens/tokens.ts`；渲染：`apps/web/src/features/canvas/render/draw-scene.ts`、`frame-loop.ts`、`paragraph-cache.ts`；状态架构：`apps/web/src/features/canvas/state/session.ts`；AI：`apps/web/src/features/ai/steps.ts`、`apps/daemon/src/ai/client.ts`、`config/store.ts`、`credentials/store.ts`、`mcp/stub.ts`、`image/client.ts`；市场：`services/ingest/`、`docs/research/2026-10-16-market-first-runthrough.md`；质量：`docs/quality/test-report-v1.md`、`retro-2026-10-17.md`、`ci.yml`；规格：`docs/plan/architecture-v1.1.md`、`docs/spec/acceptance-standard-v1.md`。

### 7.3 修订记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v1 | 2026-10-24 | 初版。事实调研（4 路代码摸底 + 5 家竞品联网调研）+ 会话裁决口径（§1.5）。 |
| v1.1 | 2026-10-24 | 审计勘误：① 修正「受控 AI 应用管线」现状错误（被 #91 证伪，§5.1/§2.7/§3.1），新增 A0 提案/写入管线为 P1 之首，A1/A2/A3/A4/A6 标注依赖并重估成本，Top5 第 1 项重排；② 前端项段位回注「以 frontend-rework-v1.md 为准」；③ 补 Issues 交叉引用（#86/#87/#89/#90/#91/#92/#95/#98）；④ 改造总纲同步（缺陷现场必查、a11y 维度、三态纪律），ADR-0005 增补记。 |
