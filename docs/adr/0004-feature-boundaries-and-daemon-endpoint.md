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

## 补记 · ③ 「ingest 层间重复词表」技术债收敛完成（修复批次 3）

日期：2026-10-16（批次 3 · 工作包 B；上文 ③ 的「本批不修」结论不动，此为后续执行记录）

- **真源位置**：`packages/contracts/src/market/vocab.ts`（本包零运行时依赖纪律保持）——
  规范词表以 `as const` 数组导出、联合类型由数组派生，并配运行时类型守卫：
  `MARKET_ASSET_KINDS` / `MARKET_LANES` / `MARKET_LICENSE_GATES` / `MARKET_COMPLIANCES` /
  `MARKET_SECURITY_LEVELS` / `MARKET_LICENSE_TIERS` / `MARKET_CATEGORIES` / `MARKET_MODES` /
  `MARKET_QUALITY_DIMENSIONS` / `MARKET_QUALITY_WEIGHTS`（守卫：`isMarketAssetKind` /
  `isMarketLane` / `isLicenseGate` / `isMarketCompliance` / `isMarketSecurityLevel` /
  `isMarketLicenseTier`）。值冻结声明见 `vocab.test.ts`（词表变动须走票面）。
- **门禁名**：`pnpm guard:vocab`（`scripts/guard-vocab.mjs`；已接入 CI ci.yml，照 guard:tokens
  接线模式）。三态退出码：0 通过 / 1 违规（层内登记词表的字面量声明、派生根不在真源、
  类型词表字面量联合）/ 2 阻塞（真源缺项、层路径缺失、初始化表达式静态判不出根）。
  双侧证据夹具回归：`scripts/tests/guard-vocab.test.mjs`（正例 exit 0 + 违规夹具 exit 1 +
  阻塞 exit 2，`pnpm test:scripts`）。
- **清偿清单**（ADR ③ 代表位置逐一，另含相邻类型声明与消费点）：
  - `services/ingest/src/transform/ods/schema.ts`：`ASSET_KINDS`/`LICENSE_GATES`/内联 compliance 字面量删除，改守卫；
  - `services/ingest/src/transform/dwd/validate.ts`：同三项 +
    `LICENSE_TIERS` 字面量删除，改守卫（`DIGEST_STATUS`/`CLUSTER_REASONS` 为 DWD 层本地词表，注明不属同源范围）；
  - `services/ingest/src/score/dwd.ts`：`KINDS`/`GATES`/`COMPLIANCES` 字面量删除，改守卫；
  - `services/ingest/src/index/dws.ts`：`KINDS`/`LANES` 字面量与内联 gate/security 判定删除，改守卫；
  - `services/ingest/src/index/schema.ts`：`ASSET_KINDS`/`LANES`/`GATES`/`SECURITY_LEVELS` 删除，
    `QUALITY_WEIGHTS` 改由 `MARKET_QUALITY_WEIGHTS` 派生（评分与索引自洽校验共源）；
  - `services/ingest/src/collect/identify.ts`：`KIND_PRIORITY` 改由 `MARKET_ASSET_KINDS` 派生
    （名次表 `Record<MarketAssetKind, number>` 编译期全排校验）；
  - `services/ingest/src/collect/ods.ts` / `run.ts`：内联 `.includes([…])` 链里的 kind /
    合规 / 三档字面量数组清偿为守卫（由门禁 R5「内联字面量」规则实捕）；
  - 相邻收敛：`collect/types.ts`、`transform/types.ts`、`score/types.ts` 的
    `AssetKind`/`LicenseGate`/`Compliance`/`LicenseTier` 类型退化为真源别名；
    `score/types.ts` 的 `DIMENSIONS`/`DIM_WEIGHTS` 与 `packages/contracts/src/market/index.ts`
    的同族字面量一并清偿（后者改接守卫）。
- **遗留（未纳入本批扫描登记）**：`apps/daemon/src/routes/market.ts` 与
  `apps/web/src/features/market/components/FilterBar.tsx` 各有一份 kind/lane 字面量
  （属各自票目录，未在本批范围内触碰）；接入 `guard:vocab` 登记清单即可收口，留待后续票。

## 补记 · ③ 续：「各层」登记面补漏（修复批次 3 收口 · code-review 整改）

日期：2026-10-16（同上 ③ 补记之后追加；③ 的清偿清单结论不动，本条记**补漏**。）

- **事实**：③ 补记的清偿清单漏了三处层内字面量，且 `guard:vocab` 的登记面**看不见**它们
  （登记名清单未覆盖），即「收敛已完成但判据缺席」的半做状态：
  `packages/contracts/src/market/index.ts` 的 `InstallGateMode`（第二份
  `'loadable' | 'view-only' | 'blocked'`）与 `MarketInstallGate.security`（内联联合）、
  `services/ingest/src/collect/run.ts` 的两处 `Record<'loadable' | 'view-only' | 'blocked', …>`。
- **收口（已清偿）**：前两处改为真源派生（`InstallGateMode = LicenseGate`、
  `security: MarketSecurityLevel`），`run.ts` 改 `Record<LicenseGate, …>`。
- **登记面补漏（不得静默）**：`LicenseGate` 条目登记 `InstallGateMode` 为层内类型别名
  （`guard:vocab` 的 `VOCAB_REGISTRY`），R4 判据即可直接点名该形态；报告**始终**带
  `registry`（登记词表 + 放行别名）与 `limits`（静态判据覆盖不到的形态：
  接口属性内联联合 / 类型实参字面量 / 跨文件类型链），`--registry` 可人类可读打印。
- **同包相对导入**：R3/R4 的「真源根」判据补充——契约包内的市场模块只能相对引
  `./vocab.ts`（自引包名成环），该相对导入视作真源根；层树外的相对路径仍判 foreign
  （正/负例夹具各一，双侧证据见 `scripts/tests/guard-vocab.test.mjs`）。

## 补记 · ② feature 公开面「样式入口 `*.css`」登记为第二类例外（修复批次 3 收口）

日期：2026-10-16（批次 3 · 工作包 E 收口；上文 ② 的「唯一第二入口（具名例外）」结论不动，
此为**追加登记**——E 线实现（`scripts/guard-feature-boundaries.mjs` 的 `REGISTERED_EXCEPTIONS`）
把此前字面上属越界的样式直引补记为具名例外，让实现与 ADR 字面一致。）

- **例外内容**：`features/<name>/*.css`（样式入口）是公开面之外的**第二类登记例外**，
  **只对 `app/**` 路由层生效**。
- **为什么不经 `index.ts` 转出**（与 register 接缝同理）：公开面按 ② 只导出「组件 / 工厂 /
  hook / 类型 / 页面级纯逻辑」，CSS 资源无从 `index.ts` 转出——转出即等于给**所有**公开面
  消费方带上全局样式副作用（含只想要一个展示组件的路由页），属行为与包体双重回归。
- **为什么限 app 路由层**：Next 路由层直引 feature 样式是既有接线（`app/page.tsx` →
  `home.css`、`app/editor/layout.tsx` → `editor-shell.css`）；feature→feature 引他 feature
  样式仍判违规（避免把别人的全局样式带进本 feature 包体），门禁报错会注明依据。
- **门禁可见性**：例外在守卫的登记面（`REGISTERED_EXCEPTIONS`）与报告 `scope.exceptions`
  中逐条列出（含依据文案），未登记形态不得静默放行。

## 补记 · ④ digest v2「接入点预留」（修复批次 3 收口）

日期：2026-10-16（批次 3 收口；上文 ④ 的「留待 D 线报告与用户裁决」结论不动，
本条只**预留接入点**，不改变 v1 行为、不实现 v2。）

- **接入点（真实路径已核实）**：`services/ingest/src/transform/lineage/digest.ts` 的
  `computeAssetDigest(files: readonly AssetFileHash[])` —— 现行 v1 口径：资产根目录内全部文件
  逐个取内容 sha256，按相对路径字典序拼清单流后取 `sha256:`（规格 §1.6）。
- **调用链**：`transform/dwd/build.ts` 的 build 阶段装配（`computeAssetDigest(...)`）是唯一
  消费点，v2 口径若定，参数与返回结构在此扩展（如新增 `digestScope` 字段），
  DWD 表与 ADS 卡片的透出随之下游同步。
- **待裁决项**：v2 `digestScope`（文本子集摘要）+ 双写过渡（《技能市场规格 v1》§1.5.3）；
  裁决后按该路径实施，并同步更新规格、`guard:vocab` 相关门禁口径与本 ADR 的结论条目。
- **本批状态**：仅预留接入点（本补记即登记）；不改 `computeAssetDigest` 的行为与签名。

## 补记 · ① daemon 端点随站内导航传递（修复批次 4 · 工作包 B）

日期：2026-10-16（缺陷来源 D-3 / UX-01：客户端跳转丢 `?daemon=`，下一页面回退端口窗探测，
在同源网关/非默认端口形态下整页「无法连接本地服务」。上文 ① 的解析顺序结论不动，
本条只**追加**「端点的站内传递」这一子口径。）

- **单点新增（纯函数，仍在 `apps/web/src/lib/daemon-endpoint.ts`）**：
  `withDaemonEndpoint(href, options?)` —— 当前页带**合法** `?daemon=`（http/https 绝对地址）
  时把同一参数续写到站内地址；否则**原样返回**（canonical / env 注入形态的 URL 保持干净）。
  只动 `daemon` 这一个参数（不用 `URLSearchParams` 重建整串——它会把 `%20` 规范化成 `+`，
  改变既有地址的字节形态）；幂等（已有同名参数则覆盖）；保留 `#hash`；站外地址不改
  （不把本地端点泄到站外）。
- **React 绑定拆独立模块**：`apps/web/src/lib/daemon-href.ts` 的 `useDaemonEndpointHref(href)`
  —— 首帧返回基址（与 SSR 输出逐字一致，避免 hydration 属性不一致），挂载后经 effect 补写。
  为什么不在单点模块里：单点模块经 `features/market` 数据面被 Server Component
  （`app/market/layout.tsx`）间接导入，挂 React hook 会让 `next build` 失败（RSC 边界）。
- **纪律**：站内 `Link`/客户端跳转一律经该单点构造地址（`href=` / `router.push` /
  `window.location.assign` 三类入口一次收口），不得各自拼查询串；本轮覆盖首页卡片→编辑器、
  首页市场命中→市场、市场卡片→详情、详情→返回市场、市场面板→详情、看板→市场、
  冷启动→编辑器与返回首页、引导→冷启动页。
- **回归固定**：`scripts/e2e/scenarios/nav.mjs`（同源网关形态：跳转后 URL 携带端点参数、
  取数请求经网关 `/df`、全程无 4318 越权调用与 CORS 类错误）。

## 补记 · ① app → services 依赖方向例外与 `./ads` 服务公开面登记（修复批次 4 · code-review 整改）

日期：2026-10-16（复核 H1；上文 ① 的解析顺序结论不动，本条只**登记依赖方向与公开面**，
不改任何解析行为。）

- **事实**：daemon 的市场检索消费 `@dforge/ingest/ads`——`apps/daemon/src/market/search-index.ts`
  与 `apps/daemon/src/market/service.ts` 直接引入 ingest 的 `searchMarketIndex`
  （`import { searchMarketIndex } from '@dforge/ingest/ads'`）。
- **为什么是必然的（不是随手跨界）**：检索语义（中文重叠二元组切词 + 术语等价类扩展 +
  BM25 k1/b 打分）必须与 CLI `df market search` **同一条代码路径**——在 daemon 里重抄第二份
  必然与 ingest 层漂移（中文分词口径漂移正是本仓已登记过的词表债同族），表现为
  「UI 命中 ≠ CLI 命中」（UX-08 缺陷现场即此）。故按「实现单一真源」裁决保留该方向，
  并在此登记为**依赖方向命名例外**：`apps/** → services/**` 允许（守卫预留口径
  `apps → services/tools → packages` 本已涵盖此方向，此处补记防误判为越界）。
- **`./ads` 子路径 = 服务包公开面**：`services/ingest/package.json` 的 `exports` 只暴露
  `.`（采集全链）与 `./ads`（ADS 检索层：index/terms/search/schema/pipeline）两个入口。
  daemon **只能经 `./ads` 子路径**消费（禁深导入 `services/ingest/src/**`）；运行时只装载 ADS 层，
  **不**把采集线与 Parquet 依赖带进 daemon 进程（daemon 的 `package.json` 仅声明 `@dforge/ingest`）。
  该子路径即服务包的公开面登记项（ADR-0004 ② 口径的「服务包版」）。
- **门禁可见性**：`scripts/guard-deps.mjs` 是四守卫挂点之一（未接入 CI 前一律 `exit 2` 阻塞）；
  其头注释已按本条口径写明预期（允许方向 + `./ads` 公开面 + 深导入判违规），
  接入时无需再翻本 ADR 之外的出处。

## 补记 · ② 新增公开面与登记例外清单增补（修复批次 4 · code-review 整改）

日期：2026-10-16（复核 Spec b2/b3/b6 · P2-15；上文 ② 与「样式入口」补记的既有例外结论不动，
本条按 ② 的「新增跨边界消费 = 显式加行」纪律**逐条登记**本轮新增面。）

- **`packages/ui` 新增公开面（包级 `index.ts` 显式导出，正常加行）**：
  `Overlay`（+ `type OverlayProps`）——演示舞台等全屏浮层与抽屉/模态走同一条浮层栈
  （C1/D-4 修复的落点）；`MenuItemSpec.href`（链接条目渲染为 `<a role="menuitem">`）——
  首页「设置 / 键盘快捷键」入口接通（D2/UX-09）的承载面；消费方为 `apps/web`（经包公开面导入，
  不深导入 `packages/ui/src/**`）。
- **canvas feature barrel 的 workspace 接缝**：`features/canvas/index.ts` 显式导出
  `getWorkspace` / `setWorkspace` / `subscribeWorkspace` / `resetWorkspace` 与 `type EditorWorkspace`
  ——评审会话（FE-07）的文档端口与画布必须读**同一份**文档真值（演示判定/版本快照），
  这是刻意的跨 feature 公开面（不是深导入例外）。`connectDocumentBridge` 虽从 `./register.tsx`
  导出，但按上文 ② 的 register 接缝口径，**只有** `app/**` 路由层与同 feature 测试可用。
- **contracts `describeDocumentNameIssue`**：新建文件对话框的分因前置校验（空 / 超长 ≤64 /
  非法字符 / 重名分流，G2/UX-11）由 `packages/contracts/src/documents` 公开面承载，
  前端与 daemon 共源同判据（`DOCUMENT_NAME_MAX_LENGTH` 一并导出）；消费方经
  `@dforge/contracts` 包公开面导入。
- **无新增深导入例外**：以上三条都是「经公开面显式加行」的正常形态；本轮未出现
  feature→feature 深导入或 `services/**` 深导入的新增（daemon→`./ads` 见上一条补记）。
  若后续出现，仍按 ② 的纪律先在 `scripts/guard-feature-boundaries.mjs` 的
  `REGISTERED_EXCEPTIONS` 登记并在此补行，未登记形态不得静默放行。
