# 设界 · DesignForge 企业级架构设计（v1.0）

- **状态**：已定稿（批次 4 合并前基线）
- **日期**：2026-10-17
- **依据**：《设计文档 v1.1》（`docs/plan/architecture-v1.1.md`）、ADR-0001…0004、前端验收标准 v1、技能市场规格 v1、`docs/agents/implementation-workflow.md`（工程宪法）、批次 4 七包实施与双轴复核记录（PR #42 / issue #41）
- **适用范围**：本仓全部可交付物（web / daemon / desktop / ingest / comfy / cli / 门禁脚本）。本文件回答四件事：**整体架构、模块划分、技术选型、规范约束**；并登记架构债与治理方式。

---

## 1. 架构总览

### 1.1 产品与本段架构目标

设界是**本地优先**的类 Figma 设计工作台（毕业设计项目）。架构服务于三条支柱：

1. **本地真值**：文档真值 = 本地 `.dfg` 目录态（manifest + 页 JSON），可 Git diff、离线完整可用；
2. **受控 AI**：自然语言 → Design IR → 双重校验 → 逐项 diff 审批 → 单事务 → 审计回放；文本上云（BYOK DeepSeek）、图像本地（ComfyUI）；
3. **数据飞轮**：GitHub 技能资产采集 → ODS/DWD/DWS/ADS 四层 → 五维评分 → 混合检索 → 采纳回流。

架构目标（本段判据）：**前端对标 Figma 本体可验收 + 技能市场首实现可独立跑通**；不追求云侧多租户、实时协同与移动端。

### 1.2 系统上下文与运行形态

```
┌────────────┐   http(s)    ┌──────────────┐
│ 浏览器/壳   │ ───────────► │  @dforge/web │  Next.js App Router（SSR 首帧 + 客户端装配）
└─────┬──────┘              └──────┬───────┘
      │  fetch (daemon 端点单点)    │ 同源网关 /df/*（门禁与壳形态）
      ▼                            ▼
┌──────────────────────────────────────────┐
│ @dforge/daemon（Fastify，仅 127.0.0.1）    │ 文档/导出/AI 代理/出图调度/凭据/市场/遥测/MCP 桩
└───────┬───────────────┬──────────────────┘
        │               │
        ▼               ▼
  ~/.dforge 数据根    外部依赖（按需、可关闭）：
  （.dfg 工作区、       DeepSeek（文本 AI，BYOK，可脱敏/可关闭）
   凭据 0600、市场索引、  ComfyUI（本地出图，零出机）
   遥测/审计）          GitHub API（采集线，只读 GET）
```

- **两种运行形态，同一产物**：
  - **canonical 形态**：`web:3000` + `daemon:4318`（README 工程启动；CORS 白名单覆盖 3000 两个来源）；
  - **同源形态**：门禁与桌面壳用反向代理把站点与 daemon 还原为一个源（`/df/*` → daemon），或壳内以 `DFORGE_SHELL_URL`/内置静态服务装载。端点解析由**单点模块** `apps/web/src/lib/daemon-endpoint.ts` 裁决（ADR-0004 ①），批次 4 增加「站内导航续写 `?daemon=`」的传递单点（`withDaemonEndpoint`）。
- **Electron 最小壳**：`apps/desktop` 只做「窗口 + 单工作区 + 与浏览器一致的渲染口径 + 安全基线断言」；不承载 webview，外链走系统浏览器白名单。

### 1.3 关键数据流

| 数据 | 流向 | 真值位置 | 约束 |
|---|---|---|---|
| 设计文档 | web ⇄ daemon ⇄ `.dfg` | 本地工作区 | 写路径唯一（命令栈）；`.dfg` 幂等写；可 Git diff |
| 导出产物 | web → daemon → 文件 | 数据根 `exports/` | PNG/SVG/PDF；编辑器内要求文档已落盘（批次 4：保存态 + 行动建议） |
| AI 文本 | web → daemon → DeepSeek | 无 key 时本地模板降级 | BYOK、脱敏、可关闭；降级态与真态同构呈现 |
| 出图 | web → daemon → ComfyUI | 本地资产目录 | 未启动/缺模型态必须给可执行恢复动作 |
| 市场数据 | CLI 采集 → 四层仓 → ADS 索引 → daemon → web | 数据根 `market/ads/*` | BM25 检索索引与卡片索引同源；缺索引按三态阻塞语义 |
| 遥测 | web/daemon → 本地 JSONL | 本地 | 默认仅本地，不上云 |
| 凭据 | 设置页/CLI → daemon | `~/.dforge/credentials.json` + `credentials.key`（0600） | 不回显；`df config set-key --stdin` 注入 |

---

## 2. 模块划分

### 2.1 依赖方向（硬约束）

```
apps/*（web / daemon / desktop）        services/*（ingest / comfy）        tools/*（cli）
            └──────────────┬──────────────────────┬──────────────────────────┘
                           ▼                      ▼
                    packages/*（contracts / engine / ui）
```

- 规则：**apps / services / tools → packages**；`@dforge/engine` 纯 TS **零 DOM**；跨 feature 只能经公开面导入（`guard:feature-boundaries` 机检，`register` 接缝为登记例外）。
- **已登记例外（ADR-0004 补记）**：`apps/daemon → services/ingest`（经 `@dforge/ingest/ads` 子路径，理由=检索实现单一真源、避免中文分词口径漂移）。该例外受监控，不得再扩大。

### 2.2 模块清单（职责 / 公开面 / 门禁）

| 模块 | 路径 | 职责与边界 | 公开面 | 归属门禁 |
|---|---|---|---|---|
| 契约 | `packages/contracts` | 跨进程类型与校验（Design IR 信封、市场索引 schema、daemon 路由表、文档名分因、daemon 端点构造） | 纯类型/守卫函数；**无运行时依赖** | 包内 vitest |
| 引擎 | `packages/engine` | 场景图/命令栈/布局/命中/序列化/视口；**零 DOM** | 文档与命令 API | `verify:engine`（快照哈希独立复算） |
| 设计系统 | `packages/ui` | 双基准令牌 × 密度映射、基础组件、状态族、浮层栈（Overlay/Drawer/Modal）、菜单（含链接形态） | React 组件与令牌；禁消费业务态 | 组件测试 + `guard:tokens` |
| 前端 | `apps/web` | 首页 / 编辑器（对标页）/ 市场 / 看板 / 设置 / 引导；装配层 `features/canvas/workspace`（编辑器宿主）与 `features/canvas/studio`（内部画布宿主） | Next 路由 + feature 公开面 | `verify-canvas`、`verify-figma-*`、`verify-market`、`verify-self-designed`、`e2e:smoke` |
| 本地服务 | `apps/daemon` | 文档读写（路径安全）/导出/AI 代理/出图调度/凭据/市场（过滤 + BM25 检索）/遥测/MCP 确认桩 | HTTP JSON（统一 ok/result 信封） | `verify:daemon`、`verify:mcp-stub`、`verify-ai-two-state`、`verify-image-two-state` |
| 桌面壳 | `apps/desktop` | 最小窗口 + 装载（URL → 静态产物 → 诊断页）+ 安全基线 + 导航守卫 | Electron 进程内 | `guard:electron-baseline`、`verify-shell-parity`（冒烟/存活/对照三段） |
| 采集线 | `services/ingest` | 候选发现/结构探针/内容校验/ODS→DWD→DWS→ADS/五维评分/BM25 索引（`./ads` 公开子路径） | CLI 与 daemon 复用 | `verify:mk-01…05` |
| 出图适配 | `services/comfy` | 本地 ComfyUI 客户端（队列/进度/取消/OOM 降档） | 客户端 API | 包内 vitest + 两态门禁 |
| CLI | `tools/cli` | `df market collect|score|index|search`、`df config set-key` | CLI 子进程契约 | `verify:mk-05`、`verify-market` 的 CLI 套件 |
| 工程脚本 | `scripts/` | 门禁族（三态退出码）、e2e runner（场景自动发现）、共享件（夹具 daemon/网关/浏览器工具链） | node CLI | 自身即门禁；`test:scripts` |

### 2.3 前端装配模型（批次 4 修订）

```
/editor（用户对标页）
  EditorShell（槽位壳） + WorkspaceBootstrap
    └─ createEditorWorkspace（单例：共享命令栈 + 选择集端口）
         └─ document-bridge（载入/保存编排单点：documentId ↔ .dfg）
              └─ documents-client（HTTP 客户端，端点经 daemon-endpoint 单点）

/_canvas（内部画布宿主，门禁取样页）
  CanvasStudio
    └─ document-bridge（同一编排单点；React 会话换代差异保留）
```

- **单点原则**：载入/保存编排只允许 `document-bridge` 一处；端点解析与传递只允许 `daemon-endpoint` + `withDaemonEndpoint`；工具态以画布会话为唯一真源（外壳高亮跟随）。
- **差异登记**：`/editor` 与 `/_canvas` 在**会话装配层**（命令栈共享 vs React 整会话换代）、URL 参数名（`documentId` vs `doc`）、提示层（顶栏保存态 vs 开发期 notice）仍有差异；其余持久化/客户端能力已同源。

---

## 3. 技术选型

| 领域 | 选型（版本） | 理由 | 风险与对策 |
|---|---|---|---|
| 前端框架 | Next 16.4.1 App Router + Turbopack（React 18.3.1） | SSR 首帧与客户端插槽装配分离；构建快 | **React 18 在 Next 16 已弃用**（构建警告）→ 升 React 19 属后续批次；本段锁版本 |
| 状态 | Zustand 5（仅 UI 态；文档态归 engine） | 文档真值与 UI 态分离，避免 React state 承载真值 | 单例工作区需严格生命周期（批次 4 修过一次锁泄漏） |
| 画布 | CanvasKit（Skia WASM 0.42.0） | 高性能 2D 渲染、文本字形可控 | 首帧冷启动 ~0.6s（实测）；资产 10.4MB 需预拷贝 |
| 本地服务 | Fastify 5（无 SQL、无 ORM） | 低开销、schema 友好；本地单用户 | 内存态过滤+BM25（无持久层）→ 数据规模大时需重估 |
| 桌面 | Electron 44.7.2（最小壳） | 与浏览器同产物；安全基线可断言 | 二进制懒下载（需镜像）；CI 不拉二进制 → 门禁阻塞语义 |
| 类型/校验 | TypeScript ~5.9.3（strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes）+ contracts 手写守卫 | 跨进程契约单点；零运行时依赖 | 手写守卫需测试覆盖（已覆盖） |
| 测试 | Vitest 5.0.5（jsdom 30 组件测试）、playwright-core 1.63.0（锁 chromium-1243）、pixelmatch 8 | 单测快、浏览器门禁真链路 | CI 无显示器/无 Electron → 门禁三态阻塞 |
| 采集数据 | hyparquet / hyparquet-writer（Parquet 四层仓） | 列式存储、可对账、可复算 | 大文件需预算控制（`--max-content`） |
| 国际化 | intl-messageformat + `apps/web/messages`（zh-CN 唯一暴露，en 兜底） | 全中文基线（ADR-0003） | 键集漂移 → 双向键集测试 + 死键清理（批次 4 删过过期键） |
| 工程 | pnpm 10.33.2 workspace + `catalog:` 统一版本；Biome 2.5.15；Node ≥22 | 单版本源、快装、统一 lint | pnpm10 不跑依赖 build script → Electron 二进制需显式获取 |

---

## 4. 规范约束（工程宪法摘要，细则见 implementation-workflow）

1. **代码**：TS strict；注释与文档字符串中文、标识符英文；界面文案一律经 i18n；禁裸值（`@dforge/ui` 令牌）；禁 lint 抑制；engine 零 DOM；跨 feature 只经公开面（机检）。
2. **门禁**：统一三态退出码 `0/1/2`；`2` 不是通过；任何门禁未实现必须显式登记（挂点），不得静默缺席；新增门禁必须带「正例 0 + 违规夹具 1」双侧证据；**不得为通过而调弱门禁**（批次 4 已加护栏：存活窗口下限、注入面标记）。
3. **数据与证据**：文档真值本地 `.dfg`；参照集冻结（版本+日期+哈希）前对照门禁一律 `exit 2`；证据（截图/JSON/日志）落仓库外 `~/df-evidence/`；仓库只存代码与文档。
4. **进程与端口纪律**：主工作树恒在 `main`；一票一树 `/home/QIU/df-wt/<票号>`（禁用 `/tmp`）；**禁止 `pkill -f` 按模式杀进程**（只按精确 PID/自建进程组）；测试用独立端口（远离 3000/4318）与仓外数据根；不得读写真实数据根 `~/.dforge`。
5. **提交与合并**：中文 Conventional Commits；合并前先并入集成 tip 并复跑门禁；合并提交必须过钩子；每次推送后读 CI。
6. **AI 边界**：文本上云仅 BYOK 且可脱敏/可关闭；图像零出机；遥测仅本地；MCP 网关为桩（显式标注）。

---

## 5. 质量属性

| 属性 | 现状与保障 |
|---|---|
| 可测试性 | 五层测试面：包内单测（2756 例）→ 契约/门禁脚本（三态）→ 浏览器门禁（verify-canvas/figma/market/self-designed）→ e2e 真链路（63 步：home/editor/nav/canvas）→ 桌面壳三段（冒烟/存活/对照）。门禁即验收接缝，禁止假绿。 |
| 安全 | daemon 仅回环监听；CORS 白名单（无通配）；路径穿越防护（5 变体实测拦截、文档名注入拒绝）；凭据 0600 + 掩码；`pnpm audit` 0 已知漏洞；外链白名单转系统浏览器。 |
| 性能（记录基线，不入本段判据） | 首页首屏 710ms；画布就绪 631ms；设置 1456ms；市场（344 卡）1993ms；BM25 检索 P95 0.68ms（CLI 侧）。硬指标（500 节点 ≥55FPS）属 P1 基线另立。 |
| 可维护性 | ADR 0001–0004（+批次补记）；模块边界机检；单点收敛（端点/载入保存/工具态/令牌）；批次制交付（一票一树 + merger + 双轴复核）。 |
| 可观测性 | 本地遥测 JSONL、MCP 审计、诊断面板（环境/日志尾部/连通性自检）。 |

---

## 6. 已知架构债与风险登记（截至批次 4）

| # | 债/风险 | 影响面 | 处置 |
|---|---|---|---|
| A-01 | 市场采集 §1.6 digest 口径（全文件摘要 vs 采集预算）未裁决 → 设计系统类卡片为 0 | 市场数据完整性 | #39（人工裁决）；v2「文本子集摘要 + 双写」方案已备 |
| A-02 | 视觉参照集（REF-01）未冻结 → 全部 figma 对照门禁阻塞 | 视觉验收 | #28（人工采集）；冻结后翻为必须 exit 0 |
| A-03 | `/editor` 与 `/_canvas` 装配层差异（会话换代/URL 参数名/提示层） | 可维护性 | 已登记；后续可统一（非阻塞） |
| A-04 | 端点双轨形态（canonical 无参 vs 同源/网关带 `?daemon=`）并存 | 配置复杂度 | 单点化已收敛；新页面必须走 `withDaemonEndpoint` |
| A-05 | Electron 静态导出装载路径未就绪（壳依赖 URL/内置静态服务） | 壳交付形态 | 已登记（R-7 剩余）；正式版内置产物 |
| A-06 | `next dev`（Turbopack）在本机不加载客户端引导件 → live 门禁必须生产构建 | 门禁运行方式 | 已写入工作流纪律 |
| A-07 | 测试环境 flake 面（负载下超时、vitest 共享缓存竞态） | CI 稳定性 | 已登记；超时只放宽上限不放宽断言；`ENOTEMPTY` 用可重试删除 |
| A-08 | 依赖方向例外（apps/daemon→services/ingest） | 架构边界 | ADR-0004 补记登记；受 `guard:deps`（挂点）监控 |
| A-09 | React 18 在 Next 16 弃用 | 升级风险 | 后续批次评估 React 19 |
| A-10 | 市场 UI 与 CLI 的检索口径以 daemon 复用 ingest 实现对齐（单一真源）；`scenes` 场景 id 未定 | 数据面演进 | 规格未决项（marketplace §9.10） |

---

## 7. 治理与演进

- **ADR 索引**：0001 全量重做/旧仓冻结 · 0002 验收基准=Figma 本体 · 0003 全中文基线 · 0004 特性边界与 daemon 端点（② 公开面例外清单、③ 词表同源、① 端点单点、批次 4 补记：方向例外/新公开面/遗留债）。
- **批次机制**：规格（issue）→ 工作包 → 一票一树 → merger 逐包并入 → 双轴 code-review → 单代理修复 → PR。批次 4 为模板。
- **门禁实况表**：`implementation-workflow.md`「守卫实况」与 `AGENTS.md`「工程命令」两处同源维护；改门禁必须同票同步。
- **变更记录**：v1.0 = 批次 4 合并前基线（2026-10-17）。架构级变更须新增 ADR 并更新本文件。
