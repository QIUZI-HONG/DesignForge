# ADR-0004 · 架构边界与 daemon 端点解析收敛（工作包 E 裁决）

日期：2026-10-16
状态：已生效

## 背景

修复批次 2 的架构侦察（工作包 E）确认两类「边界发散」问题：

1. **daemon 端口/基址解析三处并存**：首页族「查询参数 → env → 端口窗探测」、FE-10 家族
   （AI / MCP / 出图 / 诊断）「env → 4318」、编辑器工作区「查询参数 → env → 4318」。
   同一会话里不同面板可能指向不同端口（画布连得上、市场连不上，或反之），排查成本高、
   门禁与端到端场景不可确定性复现；端口窗口常量也散落在消费方各处。
2. **feature 没有公开面**：跨 feature 消费直接引内部路径（`features/<a>/{components,lib,…}`），
   改内部实现可能静默打断他人；市场测试夹具被看板与 app 路由经 `__fixtures__` 深路径复用。
3. **ingest 各层各自维护词表**：ODS / DWD / 评分 / DWS / 索引各层重复声明资产 kind、lane
   等词表（见下「决策 ③」的证据清单），层间漂移风险随市场线规模放大。

## 决策

### ① daemon 端口/基址解析收敛为单点模块（全站唯一）

- **单点实现**：`apps/web/src/lib/daemon-endpoint.ts`；端口窗常量取
  `@dforge/contracts`（`DAEMON_PORT_BASE` / `DAEMON_PORT_MAX_OFFSET`），前端不另立数字。
- **统一解析顺序**（先到先用，全站一致，不改协议语义）：
  1. 查询参数 `?daemon=http://host:port`（门禁/调试/宿主显式指向；原样采用，**不探测**）；
  2. 构建期环境变量 `NEXT_PUBLIC_DF_DAEMON_URL`（Electron 壳/部署注入）；
  3. 缺省端点 `DAEMON_ENDPOINT_DEFAULT`（端口窗起点）；异步路径继续端口窗健康探测
     （起点起逐端口、命中即止、进程内缓存；全段不可达抛 `DaemonEndpointError('daemon_unreachable')`）。
- **两个入口，按消费方需要取**：`resolveDaemonEndpointSync()`（同步、不探测、不缓存——
  给「创建端口即要字符串」的 AI / MCP / 出图 / 诊断 / 设置 / 市场 / 画布工作室 / 导出客户端）；
  `resolveDaemonEndpoint()`（异步完整路径 + 探测 + 缓存——给页面级取数，如首页）。
- **纪律**：任何 feature / 路由 / 测试夹具不得自行读该环境变量、自行解析 `?daemon=`、
  或自拼缺省端口；错误类型归一（如首页把 `DaemonEndpointError` 映射为 `DocumentApiError`）
  在消费方自己的适配层做。依赖方向：`features/* → lib/*` 允许，`lib/* → features/*` 禁止
  （单点模块不认识任何 feature）。
- 本裁决**只统一解析顺序**：daemon 侧端口纪律、HTTP 路由、信封形状、前端协议参数均未改动。

### ② feature 公开面与跨 feature 导入纪律

- 每个 feature 一个公开面 `features/<name>/index.ts`，只导出跨边界消费面（组件 / 工厂 /
  hook / 类型 / 页面级纯逻辑），**按实际消费面最小导出**；内部实现件（`model` / `state` /
  `api` / `hooks` / `testing` / `__fixtures__` 等）刻意不导出，理由写在各自模块头。
- 消费方（其它 feature 与 `app/**` 路由层）**只能经 `@/features/<name>` 导入**，禁深导入内部路径。
  公开面变更（新增跨边界消费）= 在 `index.ts` 显式加一行，评审可见。
- 测试夹具若需跨 feature 复用，经公开面的**命名空间导出**（如 market 的 `marketFixtures`），
  并在模块头声明「仅供 `*.test.*`，生产代码不得引用」。
- **唯一第二入口（具名例外）**：FE-03 插槽约定的挂载接缝 `features/<name>/register`——
  只允许 `app/**` 路由层引其引导组件（如 `app/editor/page.tsx` 引 `WorkspaceBootstrap` /
  `ReviewBootstrap`），feature 之间禁引。**为什么不经 `index.ts` 转出**：注册模块带模块级副作用
  （`setWorkspaceBootstrap(...)` / `createReviewSession(...)`），经 index 转出会把副作用带进
  所有公开面消费方（含只想要一个展示组件的路由页），属行为与包体双重回归。

### ③ 「ingest 层间重复词表」登记为技术债（本批不修）

- **事实**（同一批 kind/lane 词表在多层重复声明，代表位置）：
  `services/ingest/src/transform/ods/schema.ts`、`transform/dwd/validate.ts`、
  `score/dwd.ts`、`index/dws.ts`、`index/schema.ts`、`collect/identify.ts`；
  同族字面量在 `packages/contracts/src/market/index.ts` 也再出现一份。
- **本批不修**（范围与风险控制）：市场采集线（工作包 D）正在并行改动同目录，词表归一属
  跨批重构，混改会放大冲突面。
- **后续收敛方案（建议，单开一票执行）**：词表提升为单一真源（`@dforge/contracts` 导出
  规范词表 + 类型守卫；各层只声明「本层关心的子集」并 import），配一个「词表同源」门禁
  （层间不一致即 `exit 1`，与既有三态退出码语义一致）。**执行时机**：市场采集线稳定后。
- **不收敛期间的风险**：同一概念在不同层命不同名/缺项，表现为 DWS 聚合口径与 ADS 卡片口径
  不一致；当前以既有测试与门禁兜底，发现漂移按缺陷处理。

### ④ 「卡表 digest 口径」留待 D 线报告与用户裁决（本 ADR 不下结论）

- D 线（市场采集）报告提出：design-system 资产因 digest 门槛与内容预算的组合而可能被全量
  排除（首批索引 DS 卡片为 0），并给出「按文本子集 digest」等候选口径。
- 该问题触及《技能市场规格 v1》§1.6 的规格级语义（digest 覆盖范围），**不在本 ADR 裁决**：
  结论以 D 线报告与用户裁决为准；届时若口径变更，在此补记条目号，并同步规格与门禁口径。

## 后果

- 端口纪律改一处生效全站；同一会话所有面板指向同一 daemon，异常可复现、门禁可确定性驱动。
- 单点模块不反向依赖任何 feature，错误类型归一在消费方适配层，边界干净。
- 公开面让「谁消费谁的什么」显式化；深导入归零后，feature 内部重构不再有隐式外部契约。
- 代价：`index.ts` 需人工维护（不引入自动 barrel）；`export *` 仅限「整模块即共享面」的模块
  （如 market 的 `filters` / `load-store` / `styles` / `components`），其余按名导出。
- 技术债 ③ 在收敛前持续存在（已登记，勿静默遗忘）；④ 待 D 线与用户裁决后回填。
