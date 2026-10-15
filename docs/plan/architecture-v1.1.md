> 收编自桌面《DesignForge-架构设计说明》v1.1，2026-10-15

# DesignForge（设界）· 整体架构设计说明

> 类 Figma 设计工作台 × GitHub Skill 大数据市场 × DeepSeek/ComfyUI 双链路 AI × MCP 双端接入
> 毕业设计 · 概要设计文档 v1.1 · 2026-10-15
>
> v1.1 变更：明确 **LLM = DeepSeek（用户自带 key）**、新增 **§4.5.6 ComfyUI 本地出图子系统**、**§5.5 出图任务契约**、**§5.6 凭据与密钥管理**、**§7.7 出图管线**；用户故事 32→40 条、功能域 9→10 个；新增"AI 算力归属"架构决策与相关风险/合规条目。

---

## 0. 文档约定

### 0.1 设计依据（三类信源，严格分级）

| 标记 | 信源 | 用途 |
|---|---|---|
| **【逆】** | 本次 `figma逆向报告/`（REA 6.5.0 对 Figma 桌面端 126.10.10 的静态逆向，含逐条证据与哈希留痕） | 提供**竞品桌面端的可观测产品结构**：壳/桥/IPC/多标签/稳定性工程/Agent 进程归属 |
| **【公】** | 公开生态约定：Figma 定价页公开功能面、Claude Code `SKILL.md` 约定、MCP 规范、W3C DTCG 设计令牌规范、GitHub REST/GraphQL API 条款 | 提供**接口与格式的行业共识**，是本项目协议的兼容基线 |
| **【设】** | 本设计方案（自主定义） | 架构、协议、算法、指标、路线图 |

### 0.2 Clean-room 声明（答辩必读，也是本项目的合规底线）

本项目采用 **全新自研** 路线：

1. **只借鉴"对外可观测的产品结构与交互范式"**——即【逆】报告记录的事实（标签工作台、错误分类、更新通道、Agent 作为宿主能力、MCP 归属层级等）与【公】的公开约定。
2. **不复制任何第三方源码、协议文本、资产文件**。仓库内 `open-design-main.zip` 仅作为"同类开源实现的公开产品形态"参照物，**不作为代码来源**，不进入毕设交付物，不参与提交。
3. 逆向报告本身的定位是 **"方法学成果 + 竞品事实来源"**：把"用静态逆向手段拿到竞品桌面端的产品结构"作为方法论亮点写进论文，而不是把逆向产物当实现素材。
4. 所有 Figma 侧结论引用时**标注证据等级与来源文件**，不把推断写成事实（这是【逆】报告 §5 反复强调的口径）。

> 一句话合规口径：**我们复刻的是"公开可见的交互范式"，自研的是"全部实现"；逆向报告是证据链，不是素材库。**

---

## 1. 定位与三条支柱

### 1.1 一句话定位

**DesignForge 是一个"设计真值在本地、AI 写入可审批、技能资产从 GitHub 大数据流进来"的类 Figma 设计工作台。**

它同时回答四个问题：

| 问题 | 本项目的主张 |
|---|---|
| 设计工具为什么非要上云？ | **本地即真值**：文档是可 Git diff 的目录态开放格式，离线完整可用，默认不出机 |
| AI 生成设计为什么不敢用？ | **受控写入管线**：自然语言 → 设计 IR → 双重校验 → 逐项 diff 审批 → 单事务 → 审计回放 |
| 技能从哪来、好不好用？ | **大数据驱动市场**：采集 GitHub 四类设计资产 → 仓库分层建模 → 多维质量评分 → 混合检索 → 采纳率回流 |
| AI 算力怎么用才不失控？ | **按边界拆分**：文本上云（**DeepSeek**，用户自带 key、可脱敏、可一键关闭）+ 图像本地（**ComfyUI**，零出机、零成本、全参数可复现） |

### 1.2 三条支柱（与竞品的真实差异，非功能多少之差）

| 支柱 | DesignForge | 对照物（Figma / 通用 SaaS 设计工具） | 差异性质 |
|---|---|---|---|
| **本地优先** | 文件原生在本地，`.dfg` 目录态可 diff，离线完整编辑；**出图也在本地 GPU**，仅文本 AI 需联网 | 文档在云，桌面端只是"云文件的本地副本"（make local）【逆+公】 | **真值在哪** 的差异 |
| **受控 AI** | 唯一写入口 + 五类 actor 等价 + 逐项 diff 审批 + 一次性 ackToken + 审计回放 | 平台级 AI 功能，服务端闭环，写路径不可观测【公】 | **可控/可审计** 的差异 |
| **数据飞轮** | 外部：GitHub 资产大数据入库评分；内部：本地采纳率/耗时节省回流排序 | Skills 是 Agent 侧预置提示词资产【公】 | **同名不同物**，比的是数据闭环 |

---

## 2. 需求拆解：从用户任务到功能域

按"用户任务"而非"功能总数"组织（这是【逆】报告 §4 的方法论，本项目沿用）。

### 2.1 用户故事全景（40 条 → 10 个功能域）

| 功能域 | US | 用户可见能力 |
|---|---|---|
| A 画布与编辑 | 1–5 | 画板/矩形/椭圆/文本/钢笔；多选变换 + 吸附对齐；图层树；撤销重做/复制粘贴/快捷键/⌘K 命令面板；性能基线（500 节点 ≥55 FPS） |
| B 自动布局与约束 | 6–7 | 自动布局（方向/间距/内边距/对齐）；六向约束 |
| C 组件与设计系统 | 8–11 | 主组件/实例/覆盖/交换；组件变体；Token 绑定（面板显示 token 名）；DTCG 导入导出 |
| D 文件、版本与评论 | 12–15 | `.dfg` 本地开放格式 + Git diff；崩溃恢复 ≤5s；命名版本/对比/回滚（二次确认）；PNG/SVG/PDF 导入导出；评论锚定节点 |
| E AI 生成（受控） | 16–21 | 自然语言生成；**逐项 diff 审批**；单事务 + 一键撤销；patch 与审计回放；失败重试 ≤2 次后降级建议清单；布局/可访问性建议 |
| F **Skill 大数据市场**（亮点一） | 22–27 | 四类资产采集（Skill/Plugin/Design System/Template）；多维质量评分与榜单；中英双语卡片；关键词+语义混合检索；一键装载试跑；采纳率与耗时节省回流 |
| G LLM 与 MCP | 28–30 | **DeepSeek 为主模型**（给 key 即用），适配层可插拔；本地/云端双通道；MCP 双向（作为 Client 消费外部工具，作为 Server 暴露设计真值）；写操作 dryRun→ackToken→审计 |
| H **本地出图（ComfyUI）** | 31–34 | 启动探测与连通性自检；workflow 模板参数化（prompt/尺寸/步数/seed/ControlNet）；出图任务队列与进度回传；**首次生成图自动回写画布并记录 prompt/seed/model 到溯源** |
| I 双端接入 | 35–36 | **ZCode** 与 **WorkBuddy** 通过同一 MCP 网关读写同一份设计真值；Agent 注册适配器；外部 Agent 请求以确认条呈现 |
| J 工程与体验 | 37–40 | 四步引导（工作目录→DeepSeek 配置→ComfyUI 探测→GitHub 采集与埋点授权）；中文全量本地化；诊断包导出；多标签工作台与错误分类自愈（对标【逆】§2.2 C/D 组） |

> 计数口径：40 条用户故事，覆盖"编辑 → 设计系统 → 版本 → 受控 AI → 出图 → 市场 → 集成 → 工程"全链路。
>
> **AI 能力分工（重要）**：文本/意图/代码 → **DeepSeek（云端 API，用户自带 key）**；图像 → **ComfyUI（本地 GPU，零成本、零出机）**。两条链路各自独立降级：DeepSeek 不可用不影响出图，ComfyUI 不可用不影响 AI 改设计。

### 2.2 明确不做（Non-goals，防范围蔓延）

| 不做 | 理由 | 答辩口径 |
|---|---|---|
| 多人实时协同 | 需要 CRDT/OT + 长连接网关 + 冲突可视化，工作量与毕设周期不匹配 | 用**本地双窗口只读同步**做形态演示，并在 PPT 明确标注为「取舍」而非「缺失」 |
| 插件（代码级）生态 | 需要宿主 SDK 版本治理 + 沙箱 + 审核体系 | **以 MCP + Skill 生态替代插件生态**：扩展面从"代码插件"上移到"协议工具" |
| 原型交互 / 动效时间轴 | 与编辑器内核耦合浅、但演示堆时长 | 范围外，展望章提及 |
| `.fig` 完整导入 | 私有二进制格式，逆向成本不可控 | 只做"从 Figma 导出的 SVG/PNG 导入"，`.fig` 列为展望 |
| 自研光栅化引擎 | 单人毕设无法承担 | 渲染层用 Skia（CanvasKit WASM），把精力放在**场景图/命令栈/布局**这三块真正有学术含量的地方 |
| 服务端多租户/SSO | 本地优先形态不需要 | 展望章提及 |

---

## 3. 整体架构

### 3.1 五层 + 一横切

```text
┌──────────────────────────────────────────────────────────────────────┐
│  L4 集成层   ZCode  ·  WorkBuddy  ·  通用编码 Agent  ·  CLI(df)       │
│              ↑↓ MCP stdio / HTTP(SSE)                                │
├──────────────────────────────────────────────────────────────────────┤
│  L3 应用层   Web 应用（Next.js）  │  Electron 桌面壳（多标签工作台）  │
│              ↑↓ 同源 HTTP + SSE   │  ↑↓ dfHost 白名单桥（3 成员）     │
├──────────────────────────────────────────────────────────────────────┤
│  L2 服务层   Daemon（服务权威）                                       │
│   项目/文档 · 运行编排 · Skill 市场 · MCP 网关 · LLM 适配（DeepSeek）│
│   · 出图调度（ComfyUI）· 导出 · 遥测与审计                            │
│              ↑↓ 进程内调用                                            │
├──────────────────────────────────────────────────────────────────────┤
│  L1 内核层   编辑器引擎（纯 TS，零 DOM）                              │
│   场景图 · 命令栈 · 布局引擎 · 组件系统 · Token 系统 · 渲染器 · 命中  │
│              ↑↓ 读写                                                  │
├──────────────────────────────────────────────────────────────────────┤
│  L0 数据层   本地真值（.dfg + SQLite）  │  大数据资产库（GitHub 采集） │
└──────────────────────────────────────────────────────────────────────┘
        横切：i18n / 权限与能力白名单 / 凭据库 / 审计 / 可观测 / 工程守卫 CI

外部依赖（两个都是"可断"的，断了只降级不崩）：
  DeepSeek API（云端·文本与意图）         ComfyUI 本地服务（127.0.0.1·图像）
```

**关键架构决策（与【逆】报告对照的三条结构性差异）**

| 决策 | DesignForge 选择 | 对照物 | 依据 |
|---|---|---|---|
| **本体在哪** | 引擎 + 渲染器都在本地（CanvasKit WASM） | Figma 桌面端 asar 内**无画布引擎**，设计器是远端 web 应用【逆 §2.1】 | 本地优先目标倒推 |
| **AI/MCP 归属哪层** | 放 **Daemon**，与桌面壳解耦 | Figma 把 MCP 服务与 Agent 进程放**壳内**（`codegen_mcp_server.js` + `figma_agent.exe`）【逆 §2.5/§2.6】 | 只有解耦，CLI/MCP/ZCode/WorkBuddy 才能独立接入同一真值源 |
| **宿主桥暴露面** | 极小（`dfHost` 3–5 成员 + 通道配对守卫） | Figma 壳 8 个桥 / **75 个成员** / 58 个 IPC【逆 §2.4】 | Figma 是"浏览器壳"所以面大；我们是"应用本体"所以面小，且**小的面更安全** |
| **AI 算力归属** | **文本上云（DeepSeek）+ 图像本地（ComfyUI GPU）** | Figma 的图像/文本 AI 全在平台侧，不可替换、按额度计费【公】 | 免费/开源与国产优先；图像不出机是"本地优先"的自然延伸 |

### 3.2 进程与部署形态（三态一源）

| 形态 | 组成 | 用途 |
|---|---|---|
| **源码开发态** | `pnpm dev` 拉起 daemon + web + desktop 三个 sidecar，端口由调度器分配 | 日常开发 |
| **打包桌面态** | Electron 壳 + 打包 daemon（本地回环） | 毕设演示主形态、离线可用 |
| **容器/纯 Web 态** | daemon 托管 Next.js 静态导出（单源同端口） | 在线链接展示、投递作品 |

> 三态共用同一份 daemon 与同一份文档格式，**端口只是传输细节，不定义进程身份**。

---

## 4. 各模块职责

### 4.1 L1 编辑器引擎（`packages/engine`）——学术含量最高的一块

| 模块 | 职责 | 关键设计 |
|---|---|---|
| **场景图 SceneGraph** | 维护节点树 + 变换矩阵 + 绘制顺序，是所有视图的唯一数据源 | 扁平化存储（`Map<nodeId, Node>` + `children[]`）而非深层嵌套，避免深拷贝；脏标记位驱动增量重绘 |
| **命令栈 CommandStack** | 所有写操作的唯一入口 `applyTransaction(txn)` | 事务 = 原子操作数组；五类 actor（用户/本地 AI/外部 MCP/导入器/协作模拟）在事务层**等价**，不存在"绕过通道改数据"的路径 |
| **布局引擎 Layout** | 自动布局（flex 语义：方向/间距/内边距/对齐/换行）+ 六向约束 | 两遍布局（测量 → 排布），支持嵌套；约束用"相对父容器锚点 + 固定/自适应"求解 |
| **组件系统 Components** | 主组件 / 实例 / 覆盖 / 交换 / 变体 | 实例持有"覆盖表（override map）"，不复制子树；变体用属性维度笛卡尔积索引 |
| **Token 系统 Tokens** | W3C DTCG 令牌 + 模式（light/dark/品牌）+ 别名引用链 | 令牌求值做**拓扑排序 + 环检测**；导出为 CSS 变量 / JSON / Tailwind 主题 |
| **渲染器 Renderer** | 绘制场景图到 Canvas，处理 DPR、视口变换、离屏缓存 | **CanvasKit（Skia WASM）**：跨平台像素级一致、零原生插件、打包成本低 |
| **命中测试 HitTest** | 点选/框选/悬停/吸附 | 空间索引（R-tree）+ 逆变换，避免全树遍历；5000 节点下命中延迟目标 <8ms |
| **工具状态机 Tools** | 选择/矩形/椭圆/文本/钢笔/手型 等工具的行为与状态迁移 | 每个工具是显式状态机（idle → drag → commit），避免 `if (tool === ...)` 蔓延 |
| **版本与历史 Versions** | 命名版本、结构 diff、回滚（二次确认） | diff 基于节点树的 id 对齐 + 属性级比较；回滚本身也是一次事务 |

> **为什么内核要"纯 TS、零 DOM"**：这样才能 (a) 在 Web Worker / Node 侧跑批量计算（如布局审计、批量导出），(b) 单测不依赖浏览器，(c) 未来复用给小游戏/小程序端。

### 4.2 L2 服务层 Daemon（`apps/daemon`）——服务权威

| 服务 | 职责 |
|---|---|
| **项目与文档** | 项目 CRUD、文档读写、资产上传、导入导出、外部目录挂载（校验并限定在用户选定目录内） |
| **运行编排 Runs** | Agent 检测 → 启动 → 运行记账 → 取消 → 事件流（SSE）；prompt 组装（设计系统 + 主 Skill + craft 规则 + 项目元数据 + 本轮追加） |
| **Skill 市场服务** | 市场索引查询、资产详情、装载/卸载、版本解析、采纳与效果埋点上报 |
| **采集与资产管理** | 调度采集任务、管理原始快照、触发规范化与评分流水线（详见 §4.4） |
| **MCP 网关** | 双向：作为 Client 连接外部 MCP server；作为 Server 暴露本项目工具（见 §4.5） |
| **LLM 适配层（DeepSeek）** | 统一 OpenAI-compatible 协议，默认后端 DeepSeek；超时/重试/退避、流式归一化、用量记账、额度保护（见 §4.5.1） |
| **出图调度（ComfyUI）** | 探测本地 ComfyUI 服务、workflow 模板参数化、任务队列与并发闸门、进度回传（WebSocket）、产出回写与溯源（见 §4.5.6） |
| **凭据库 Credentials** | 集中管理 DeepSeek key 与第三方 token；**只存本地、只给 daemon 用**、永不进入前端包与仓库（见 §5.6） |
| **导出与交付** | PNG/SVG/PDF 导出、Design→Code（React+Tailwind / HTML）、交接包 |
| **遥测与审计** | 命令级埋点（**默认仅本地**）、白名单脱敏、审计日志（AI 与 MCP 写入全留痕）、一键删除 |
| **诊断** | 诊断包导出（版本/环境/日志/最近错误分类/**DeepSeek 与 ComfyUI 连通性自检**）、崩溃恢复 |

**技术栈**：`Fastify 5 + Zod + Drizzle ORM + better-sqlite3 + SSE`。选 Fastify 而非 Express 是因为路由/序列化性能与 schema-first 校验更契合"契约快照"这类工程守卫。

### 4.3 L3 应用层

#### 4.3.1 Web 应用（`apps/web`）

- **框架**：Next.js 16 App Router + React 18 + TypeScript；静态导出（`output: 'export'`）交给 daemon 托管，实现"单源同端口"。
- **状态**：文档状态归引擎（不进 React state）；UI 状态用 Zustand（选择集、面板开合、视口）。
- **面板体系**（对齐 Figma 的分区心智）：
  - 左：图层面板 / 资产面板 / Skill 市场面板
  - 右：Inspector（属性）/ Token 面板 / 布局建议面板 / MCP 确认面板
  - 顶：工具栏 + 文件名 + 版本/评论入口 + 呈现（Present）
  - 浮层：AI 抽屉（DeepSeek）/ 出图面板（ComfyUI）/ 代码导出 / 评论线程 / 诊断
- **渲染与预览**：画布用 CanvasKit；HTML 预览用**沙箱 iframe（srcDoc 优先）**，消息处理校验来源 iframe。

#### 4.3.2 Electron 桌面壳（`apps/desktop`）

按【逆】报告 §4.3 的"可借鉴清单"逐条落地（这些是 Figma 桌面端做过、通用 web 应用打不开的能力）：

| 借鉴点【逆】 | 本项目的落地 |
|---|---|
| 通道命名空间前缀 + RPC 四件套 | 通道统一 `df:` 前缀；预留 `df-callback:` / `df-cancel:` / `df-promise:resolve|reject` 四件套（用于主进程反向调用：MCP 确认气泡、AI 流式进度） |
| 通道配对完整性守卫 | CI 内扫描 `dist/main` 与 `dist/preload` 的通道清单做集合比对，`unpaired` 必须为 0 |
| 窗口安全基线静态守卫 | `guard:electron-baseline` 断言 `contextIsolation=true` / `sandbox=true` / `nodeIntegration=false` / `webSecurity=true` + preload 路径存在 |
| 每窗口独立 preload | 主窗口 `dfHost`；若加托盘/浮层（通知、MCP 确认浮层）另建独立桥，不膨胀 `dfHost` |
| handler 的 sender 校验 | 多窗口出现后，主进程 handler 必须校验 `event.senderFrame` |
| 更新/运维通道与业务隔离 | `df:update:*` 与 `df:agent:*`（Agent 状态/重启）独立成通道组 |
| 多标签工作台 | 标签/标签组（颜色/折叠）/最近关闭三级回收/悬停预览/固定常驻标签 |
| 错误分类与会话自救 | 错误标签分类（403/404/407/502/503/连接错误/渲染崩溃）+ 自救工具（清缓存重启、重载全部标签、导出性能与网络日志） |
| 更新面一等公民 | electron-builder + electron-updater，更新对话框（立即/下次启动）+ 失败手动下载兜底 |

> 注意：这些是**产品结构层面的范式借鉴**，实现全部自研，符合 §0.2 的 clean-room 边界。

### 4.4 L0-A 大数据资产库（`services/ingest`）——亮点一

这是"大数据技术"落点，按**数据仓库分层**组织，可直接作为论文的数据工程章节。

#### 4.4.1 采集范围：四类资产

| 资产类型 | 识别特征 | 主要来源 |
|---|---|---|
| **Skill** | 含 `SKILL.md`（YAML frontmatter：`name` / `description` / `triggers`） | GitHub topic：`agent-skill`、`claude-skill`、`ai-skill`；技能聚合索引 |
| **Plugin** | 含 `SKILL.md` + 清单文件（`*.json` / `package.json` 内 `contributes`） | GitHub topic：`ai-plugin`、`mcp-server`；插件注册表索引 |
| **Design System** | 含 `DESIGN.md` / `tokens.json`（W3C DTCG）/ `tailwind.config` | 品牌系统仓库、token 仓库 |
| **Template** | 含模板清单 + `preview/` 或 `examples/` | 模板集合仓库 |

#### 4.4.2 数据流（ODS → DWD → DWS → ADS）

```text
[采集 Sources]
  GitHub REST v3 + GraphQL v4（ETag 条件请求 / since 游标 / 分页限流退避）
  + 目录树遍历（Git Trees API 取 SKILL.md 路径）
        │
        ▼
[ODS 原始层]  raw_events(gzip JSONL) + raw_snapshots(文件级 sha256)
        │      只追加、不修改；保留 fetched_at / etag / api_quota_left
        ▼
[DWD 明细层]  asset(资产主表) · asset_file(文件清单) · repo(仓库维度) · license(协议)
        │      解析 SKILL.md frontmatter、清单 JSON、DTCG token；MinHash+LSH 近重复归一
        ▼
[DWS 汇总层]  asset_quality(五维评分) · asset_facet(标签/场景/模式) · asset_embedding(向量)
        │      · asset_trend(星标增速/提交活跃/issue 响应)
        │      聚类打标（规则优先 + 向量聚类补漏）
        ▼
[ADS 应用层]  market_card(市场卡片) · market_rank(榜单) · market_search_index(BM25 倒排 + HNSW 向量)
              · market_reco(个性化/相似推荐)
```

**为什么要分层**：可重跑（任一层可从上层重建）、可溯源（每条市场卡片能回链到具体 commit 与文件哈希）、可审计（协议与许可证全程携带）。

#### 4.4.3 质量评分模型（五维加权，可解释）

| 维度 | 权重 | 信号 |
|---|---|---|
| 规范符合度 | 0.25 | frontmatter 字段完整度、`description` 是否写成"何时使用"、正文是否有显式工作流、是否附 `references/` |
| 维护活跃度 | 0.20 | 最近 90 天提交数、issue 响应中位数、release 节奏、是否有 CI |
| 文档完备度 | 0.20 | README 是否含安装与使用示例、是否含预览资产、是否有 changelog |
| 安全性 | 0.20 | 是否含隐藏安装脚本、是否声明所需权限、是否有可疑网络调用、依赖是否有已知漏洞 |
| 生态热度 | 0.15 | 星标 + 星标增速、被 fork 数、被其他仓库引用数（**不是绝对星标排名**，防马太效应） |

- 总分 0–1，市场卡片显示**分维度雷达图**而非只给一个分数（"为什么推荐"可解释）。
- **许可证守门**：无 license / 禁止再分发 / 含未知条款 → 降级为"仅可查看，不可装载"。

#### 4.4.4 检索：混合召回 + 重排

```text
query ──┬─ BM25 倒排（名称/描述/标签/正文）        ┐
        └─ 向量召回（HNSW，bge-m3 或国产 embedding）├─ RRF 融合 ── 重排
                                                 ┘   （质量分 × 语义分 × 采纳率）
```

- 中文优先：中文 query 走中文 embedding + 中文标签；同时用术语表做中英映射（"PPT/幻灯片/deck" 等价）。
- 冷启动：新资产用"规范符合度 + 维护活跃度"托底，避免"零采纳永远排最后"。

#### 4.4.5 数据飞轮闭环（内部行为回流）

```text
本地埋点（默认仅本地） → 装载/运行/采纳/放弃 + 耗时节省 → 聚合为 asset_feedback
      → 回流重排权重（采纳率高则提权）→ 市场排序变化 → 影响下一次选择
```

- 埋点**默认只存本地**，用户授权后才参与云端聚合；提供一键删除与查看原始记录。
- 这是与"提示词资产"最本质的区别：**技能的价值由真实使用数据决定，而非作者自述**。

#### 4.4.6 调度与规模估算

| 项 | 方案 |
|---|---|
| 调度 | 每日增量批（GitHub `since` 游标 + ETag 命中即跳过）；热门仓库每 6 小时热更新 |
| 并发与限流 | 令牌桶 + 退避重试；遵守 GitHub API 速率限制与 ToS，不抓取非公开内容 |
| 规模预估 | topic 长尾 + 聚合索引 ≈ 1–5 万仓库 → 十万级文件 → ODS 原始层 GB 级 |
| 计算引擎 | 规范化/评分用 **DuckDB**（嵌入式 OLAP，直接读 Parquet，无需集群） |
| 存储 | 本地 FS/MinIO 存快照 + SQLite/PG 存结构化 + HNSW 存向量 |

### 4.5 L2/L4 智能层：DeepSeek、ComfyUI、Skill 执行器、MCP 网关

> **能力分工（一句话）**：**文本与意图 → DeepSeek 云端 API（用户自带 key）；图像 → ComfyUI 本地 GPU（零成本、零出机）**。两条链路物理隔离、各自独立降级。

#### 4.5.1 LLM 适配层（默认后端：DeepSeek）

| 能力 | 设计 |
|---|---|
| 主后端 | **DeepSeek**（用户提供 API key）——`deepseek-chat` 用于意图解析/IR 生成/代码导出；`deepseek-reasoner` 用于复杂布局推理与多步规划（可切换） |
| 协议 | 统一 **OpenAI-compatible**（`/chat/completions` + `stream: true`）；DeepSeek 官方兼容该协议，因此"换后端"只是改 baseURL + model + key 三个字段 |
| 可插拔 | 适配器接口预留：Qwen / 混元 / GLM / 本地 Ollama / vLLM；**切换不影响上层**（上层只认统一事件模型） |
| 编排 | 失败重试 ≤2 次（指数退避，区分 429 限流与 5xx）；仍失败 → 降级到"建议清单"（不硬失败）；流式事件归一化为统一事件模型 |
| 上下文策略 | prompt 组装顺序 = `设计系统上下文 + 主 Skill 正文 + craft 规则 + 项目元数据 + 本轮追加`（顺序即优先级）；长文档按节点子树裁剪，避免整树塞进上下文 |
| 结构化输出 | IR 生成走 **JSON 输出模式 + 严格 Schema 提示**；解析失败先做一次"修复重试"，再失败才降级 |
| 用量记账 | 记录 token 用量与估算成本（本地表），支持月度预算上限与"超限暂停"开关 |
| 密钥安全 | key 只存**本地凭据库**、只在 daemon 侧解密使用；**绝不进入前端 bundle、日志、埋点、诊断包、Git 仓库**（见 §5.6） |

#### 4.5.2 受控 AI 写入管线（核心差异化）

```text
自然语言
   │
   ▼
[1] 意图解析 → 生成 Design IR（design-patch/v1）
   │            ops[] = insert_node | delete_node | set_prop | move_node | swap_instance ...
   ▼
[2] 双重校验：① JSON Schema 结构校验  ② 语义校验（父节点存在/索引合法/token 已定义/无环）
   │            任一失败 → 回退到"建议清单"，不产生半成品
   ▼
[3] 逐项 diff 审批（UI 上按 op 逐条列出：改了什么、影响哪些节点）
   │            用户可勾选部分 op 应用
   ▼
[4] 单事务 applyTransaction(txn)
   │            原子：全成功或全回滚；同时入撤销栈（一键撤销）
   ▼
[5] 审计回放：run 记录（prompt 摘要 + op 列表 + 用户决策 + 前后哈希）
```

**为什么这是差异化**：Figma 的同类能力在服务端且闭源，静态证据里无对应物【逆 §4.4】。我们的口径是——**AI 不是"帮你改文件"，而是"向你提交一份可审批的变更申请"**。

#### 4.5.3 Skill 执行器与能力白名单

| 能力 | 说明 |
|---|---|
| `prompt:inject` | 默认授予，仅注入指令，零副作用 |
| `fs:read` / `fs:write` | 限定在项目工作目录内（路径规范化 + 目录逃逸检测） |
| `mcp` | 允许该 Skill 调用已授权的 MCP 工具 |
| `subprocess` / `bash` | **默认拒绝**，需用户在确认条上显式授权（一次性 token） |
| `network` / `connector:<id>` | 需声明域名白名单；`connector:*` 走本地凭据库 |
| `comfy:generate` | 允许该 Skill 向本地 ComfyUI 提交出图任务（**仅回环地址、仅模板内参数**，不允许自定义任意 workflow 节点） |
| `llm:call` | 允许该 Skill 调用已配置的 LLM（默认 DeepSeek，走适配层、受预算闸门约束） |

- 装载第三方 Skill 时**展示完整能力清单与来源**（仓库、commit、license、五维评分），不静默装载。
- 执行沙箱：Node `vm` 模块 + `isolated-vm`（重活）或 WASM（纯计算型），超时与内存上限硬约束。

#### 4.5.4 MCP 网关：双向

```text
        ┌──────────────── 方向 A：作为 MCP Client ────────────────┐
        │  LLM 需要外部能力时 → 连接用户配置的外部 MCP server      │
        │  （浏览器自动化、数据库、搜索…）→ 工具结果回注 prompt     │
        └────────────────────────────────────────────────────────┘

        ┌──────────────── 方向 B：作为 MCP Server（主通道）──────┐
        │  ZCode / WorkBuddy / 通用编码 Agent                      │
        │        │  stdio（本地）/ streamable HTTP（可选）          │
        │        ▼                                                 │
        │   无状态 MCP 服务进程：不碰文件系统，全部转发 daemon HTTP │
        │        ▼                                                 │
        │   读工具（12） / 写工具（7） / 确认工具（1）              │
        └────────────────────────────────────────────────────────┘
```

**工具契约（共 20 个，读写分离 + 写路径受控）**

| 分类 | 工具 | 说明 |
|---|---|---|
| 读 | `df_get_tree` · `df_get_node` · `df_search_nodes` · `df_get_tokens` · `df_list_components` · `df_list_files` · `df_read_file` | 设计真值读取 |
| 读 | `df_export_asset` · `df_screenshot` · `df_layout_audit` · `df_to_code` · `df_list_skills` | 产出与能力发现 |
| 写 | `df_apply_patch` · `df_create_component` · `df_swap_instance` · `df_run_skill` · `df_sync_tokens` · `df_comment_add` · `df_version_restore` | 受控写入 |
| 确认 | `df_ack` | 提交一次性 ackToken，确认高危写操作 |

> **刻意不膨胀工具面**：出图走 `df_run_skill`（调用声明了 `comfy:generate` 的 Skill），不新增图像类工具；进度复用统一运行事件流。**扩展能力靠 Skill，不靠堆 MCP 工具**——工具面越小越安全（呼应 §3.1 "宿主桥极小"原则）。

**写路径治理（三段式）**

1. 写工具首次调用默认 `dryRun=true` → 返回将产生的 diff 与 `ackToken`；
2. 用户在 UI 的 MCP 确认面板批准 → 外部 Agent 用 `df_ack(ackToken)` 提交；
3. 落库审计（调用方、工具、参数摘要、结果、前后哈希）；`ackToken` 一次性、短时效、绑定具体 diff。

> 回答"Figma 也有 MCP，你有什么不同"：差异不在有没有，而在 **① 我们是真值唯一入口（读写同层，含 7 个写工具）；② 写操作 dryRun→一次性 ackToken→审计；③ 本地 stdio、无配额、不经过云。**

#### 4.5.5 Agent 运行时注册表与双端接入

**注册表模型**：每个运行时一个声明式定义（启动方式、prompt 投递方式、模型发现、鉴权探测、流格式、可选能力），共享生命周期引擎。检测逻辑必须先走"实际会启动的路径"，避免"检测到但跑不起来"。

**能力矩阵**

| Agent | 接入方式 | 说明 |
|---|---|---|
| **ZCode** | MCP stdio | 注册适配器写入其 MCP 配置（见下表策略） |
| **WorkBuddy** | MCP stdio | 同上；另可复用通用 `SKILL.md` 约定做技能互通 |
| Claude Code / Codex / Gemini CLI / Qwen CLI | MCP stdio | 走各自 `xxx mcp add` 子命令（`cli` 策略） |
| Cursor / Trae / Copilot / Cline / Kiro 等 | MCP json | 深度合并一条 server 条目，绝不覆盖用户已有配置 |
| 未知/未验证 Agent | MCP manual | **拒绝猜测路径**，只打印可直接粘贴的片段 + 已知位置 |

```jsonc
// 注册适配器三策略
cli    : 调用该 Agent 自带的 `mcp add/remove/get`，继承它的合并与校验规则
json   : 读取已知 schema 的 JSON 配置，深合并一条 server 条目（保留其余内容）
manual : 无法权威确认路径/格式 → 只输出片段，不写文件（写错会污染用户配置）
```

**"两端一真值"语义**：ZCode 与 WorkBuddy 都不持有设计文档副本；它们通过 MCP 工具读写同一份 `.dfg`，所有变更走同一写路径、同一审计。这样"外部 Agent 改了设计"与"用户手改"在数据层面完全等价、完全可回滚。

#### 4.5.6 ComfyUI 出图子系统（`services/comfy`）——亮点补充

**定位**：负责一切**位图产出**。它是"本地优先"在 AI 侧的自然延伸——**图像不出机**，与"文本上云（DeepSeek）"形成清晰分工。

**与 DeepSeek 的协作（这是两条链路唯一交汇处）**

```text
用户中文描述（"帮我做一张废土风格的装备图标，暖色，厚涂"）
        │
        ▼  DeepSeek（云端）  ① 语义补全 → ② 翻译/扩写为英文正向 prompt
   { positive, negative, style_tags, suggested_size }
        │                    ③ 可选：生成 workflow 参数建议（步数/CFG/采样器）
        ▼
   ComfyUI（本地 GPU）  workflow 模板 + 参数注入 → 出图 → 回写画布
        │
        ▼
   provenance/image-runs.jsonl  ← 全参数留痕，可"同种子重跑"
```

> 关键设计：**DeepSeek 只负责"把中文说清楚成英文 prompt 与参数建议"，不参与像素生成**。这样既绕开了国外付费图像 API，又让出图完全离线可用。

**接入方式**（ComfyUI 原生 HTTP + WebSocket，无需改造 ComfyUI）

| 用途 | 接口 |
|---|---|
| 能力探测 | `GET /object_info` 取可用节点、checkpoint / LoRA / ControlNet 模型清单；`GET /system_stats` 取显存与设备状态 |
| 提交任务 | `POST /prompt`（API 格式 workflow JSON + `client_id`）→ 返回 `prompt_id` |
| 进度回传 | `WS /ws?clientId=…` 监听 `executing` / `progress` / `executed` 事件 → 映射为统一运行事件 |
| 取结果 | `GET /history/{prompt_id}` → `GET /view?filename=…&type=output` |
| 取消/中断 | `POST /interrupt`、`POST /queue`（删除待执行项） |

**Workflow 模板参数化**（不硬编码整份 workflow）

```jsonc
// workflow 模板：API 格式 JSON + 一张参数占位表
{
  "templateId": "icon-fantasy-v1",
  "templateVersion": 3,
  "params": {
    "positive":     { "path": "6.inputs.text",              "type": "string",  "from": "prompt" },
    "negative":     { "path": "7.inputs.text",              "type": "string",  "from": "negative" },
    "checkpoint":   { "path": "4.inputs.ckpt_name",         "type": "enum",    "from": "model" },
    "width":        { "path": "5.inputs.width",             "type": "int",     "range": [256, 1024] },
    "seed":         { "path": "3.inputs.seed",              "type": "int",     "from": "user|random" },
    "steps":        { "path": "3.inputs.steps",             "type": "int",     "range": [10, 40] },
    "cfg":          { "path": "3.inputs.cfg",               "type": "float",   "range": [1, 12] },
    "control_image":{ "path": "12.inputs.image",            "type": "asset",   "optional": true },
    "cn_strength":  { "path": "12.inputs.strength",         "type": "float",   "optional": true }
  }
}
```

- 模板由用户在 ComfyUI 里调好后以 **API 格式**导出，再在 DesignForge 里"标注可调参数"（可视化点选节点字段）→ 降低使用门槛。
- 模板进版本管理（`templateVersion`），出图记录引用具体版本 → **可复现**。

**硬件约束与闸门（针对 8GB 显存，如 RTX 4060）**

| 约束 | 策略 |
|---|---|
| 显存 | 默认边长 512–768；≥1024 走"先出低分辨率 + latent 放大"两段式，不一次出大图 |
| 并发 | **串行队列 + 单任务闸门**（并发 >1 极易 OOM）；队列深度上限，超出提示排队位置 |
| ControlNet | 建议同时最多挂 1–2 个（每挂一个都吃显存）；预检显存不足时提示降档 |
| 模型 | 启动时用 `/object_info` 校验模板引用的 checkpoint/LoRA/CN 是否存在，缺失则**明确列出缺哪个 + 当前可用清单** |
| 超时 | 单任务看门狗；超时中断并保留进度与错误信息 |
| OOM | 捕获后**自动降一档分辨率重试一次**，仍失败则给出参数建议（降步数/换采样器/减 CN） |

**产出回写与溯源**（与 §5.1 的 `.dfg` 格式对齐）

- 输出图按内容哈希写入 `assets/<sha256>.png`，画布插入一个引用该资产的图片节点；
- 同时追加一条 `provenance/image-runs.jsonl`：
  `{ runId, templateId, templateVersion, checkpoint, loras[], controlnets[], positive, negative, seed, steps, cfg, sampler, width, height, durationMs, assetSha256 }`
- 由此获得两个能力：**① 同种子重跑**（一键复现，改一个参数做 A/B）；**② 资产复用**（哈希去重，同图不重复存）。

**降级策略（可断链）**

| 情况 | 表现 |
|---|---|
| ComfyUI 未启动 | 出图面板显示"未检测到本地服务"+ 三个动作：重试探测 / 手动填地址 / 一键启动（已配置安装路径时直接拉起 `main.py`） |
| ComfyUI 崩溃 | 队列挂起、任务标记失败，**编辑器与 DeepSeek 链路不受影响** |
| 不装 ComfyUI | 出图面板整体隐藏，其余功能完整可用（图片节点仍可手动上传/导入） |

**与 Skill / MCP 的关系（刻意不膨胀工具面）**

- 出图**不新增 MCP 工具**：它作为一个声明了 `comfy:generate` 能力的 **Skill** 被调用，外部 Agent 走 `df_run_skill(skillId, inputs)` 即可触发，进度复用统一运行事件流。
- 理由：MCP 工具面越小越安全（呼应 §3.1 的"宿主桥极小"原则）——**扩展能力靠 Skill，不靠堆工具**。

---

## 5. 关键数据与协议设计

### 5.1 文档格式 `.dfg`（目录态开放文本格式）

```text
my-project.dfg/
  manifest.json            # 文档元信息：id / 名称 / 版本 / pages 列表 / 创建与修改时间
  pages/<pageId>.json      # 场景图（节点树 + 变换 + 样式引用）
  components.json          # 主组件、变体集、属性维度
  tokens.json              # W3C DTCG 令牌（含模式与别名）
  assets/<sha256>.<ext>    # 位图/字体等二进制资产，按内容哈希命名（天然去重）
  comments.json            # 锚定节点的评论线程
  versions/<versionId>.json# 命名版本快照
  provenance/
    ai-runs.jsonl          # AI 生成的 prompt 摘要 / op 列表 / 用户决策（追加式）
    image-runs.jsonl       # ComfyUI 出图全参数（模板/模型/seed/prompt/哈希，追加式）
    mcp-audit.jsonl        # 外部 Agent 写入审计（追加式）
  .dfgignore               # 导出与 diff 忽略规则
```

**设计要点**
- **纯 JSON + 内容哈希资产** → `git diff` 天然可读；两人各改不同页面不会互相冲掉整个文件。
- **没有单一巨型二进制** → 与"云文档"最本质的区别；崩溃恢复靠"最后一次事务落盘 + 追加式日志"。
- 可选 `.zip` 投影：用于对外交付时打包成单文件。

### 5.2 Design IR（AI 与 MCP 写操作的统一中间表示）

```jsonc
{
  "irVersion": "design-patch/1",
  "runId": "run_...",
  "actor": "local-ai | mcp:zcode | mcp:workbuddy | user | importer",
  "baseRev": "rev_8f3a...",          // 基于哪个版本生成，防陈旧覆盖
  "ops": [
    { "op": "insert_node", "parent": "frame:1", "index": 2, "node": { /* 节点定义 */ } },
    { "op": "set_prop", "id": "rect:7", "path": "fills[0].color", "value": "#E0A458" },
    { "op": "run_skill", "skillId": "gh:owner/repo#path", "inputs": { } }
  ]
}
```

- 所有写路径（用户、AI、MCP）**最终都编译成 IR ops**，因此天生具备：可 diff、可审批、可回放、可审计。

### 5.3 市场索引 `df.marketplace.index/v1`（ADS 层产物）

```jsonc
{
  "schema": "df.marketplace.index/v1",
  "generatedAt": "2026-10-15T12:00:00Z",
  "assets": [{
    "id": "gh:owner/repo#skills/my-skill",
    "kind": "skill | plugin | design-system | template",
    "name": "my-skill",
    "displayName": { "zh-CN": "我的技能", "en": "My Skill" },
    "source": { "repo": "owner/repo", "path": "skills/my-skill", "ref": "<commit>",
                "license": "MIT", "stars": 1234, "pushedAt": "2026-10-01T..." },
    "capabilities": ["prompt:inject", "fs:read"],
    "facets": { "lane": "create", "mode": "prototype", "tags": ["prototype","dashboard"] },
    "quality": { "score": 0.87,
                 "dims": { "spec": 0.9, "maintenance": 0.8, "docs": 0.85, "security": 0.95, "ecosystem": 0.75 } },
    "embeddingRef": "vec:asset/<id>",
    "digest": "sha256:<资产内容哈希>"
  }]
}
```

### 5.4 桌面桥与通道约定

```text
桥：dfHost（3 成员，最小暴露面）
    getDaemonInfo()      取 daemon 握手信息（端口/令牌/数据目录）
    getAppInfo()         取应用版本与运行时标识
    openDirectory()      打开原生目录选择器（导入项目用）

通道：统一 df: 前缀
    df:daemon-info | df:app-info | df:dialog-open          （业务）
    df:update:check|install|defer                           （更新组，与业务隔离）
    df:agent:status|restart                                 （运维组，与业务隔离）
    预留四件套：df-callback: / df-cancel: / df-promise:resolve|reject
    df:comfy:probe|start                                     （出图服务运维组）
```

### 5.5 出图任务契约 `df.image-run/v1`

```jsonc
// POST /api/comfy/runs  请求
{
  "templateId": "icon-fantasy-v1", "templateVersion": 3,
  "inputs": {
    "positive": "wasteland gear icon, warm palette, thick paint, centered",
    "negative": "text, watermark, low quality, extra limbs",
    "checkpoint": "anything-v5.safetensors",
    "width": 768, "height": 768, "steps": 24, "cfg": 7.0,
    "sampler": "dpmpp_2m", "seed": 123456,
    "controlnets": [{ "name": "depth", "assetSha256": "…", "strength": 0.7 }]
  },
  "targetNodeId": "frame:1",          // 产出插到哪个容器
  "concurrencyKey": "local-gpu"        // 同一 GPU 串行
}

// 响应（立即返回任务句柄，进度走 SSE / WS）
{ "runId": "img_…", "state": "queued", "queuePosition": 1, "etaMsHint": 18000 }

// 完成事件携带的溯源记录（同 provenance/image-runs.jsonl 一条）
{ "runId": "img_…", "state": "succeeded", "assetSha256": "…",
  "provenance": { "templateId": "icon-fantasy-v1", "templateVersion": 3,
                  "checkpoint": "anything-v5.safetensors", "loras": [],
                  "controlnets": [{ "name": "depth", "strength": 0.7 }],
                  "positive": "…", "negative": "…", "seed": 123456,
                  "steps": 24, "cfg": 7.0, "sampler": "dpmpp_2m",
                  "width": 768, "height": 768, "durationMs": 17240 } }
```

**失败态**（前端需分别给出可操作提示，而非统一报错）

| 错误码 | 含义 | 前端动作 |
|---|---|---|
| `comfy_unreachable` | 本地服务未启动/端口不通 | 重试探测 / 手填地址 / 一键启动 |
| `comfy_model_missing` | 模板引用的模型不存在 | 列出缺失模型名 + 当前可用清单 |
| `comfy_oom` | 显存不足 | 提示已自动降档重试；给出降参建议 |
| `comfy_timeout` | 超时 | 保留已完成进度信息，允许续跑或改参重跑 |
| `comfy_interrupted` | 用户主动取消 | 静默（非错误） |

### 5.6 凭据与密钥管理（针对 DeepSeek key）

| 原则 | 做法 |
|---|---|
| 存储位置 | 仅存**本地凭据库**（Electron `safeStorage` 加密后落盘，或 OS 钥匙串）；**绝不明文存 DB / 配置文件** |
| 使用位置 | 仅 **daemon 侧**解密使用；渲染进程（web）永远拿不到明文 |
| 输入方式 | 走设置面板的密码输入框，或环境变量 `DF_DEEPSEEK_API_KEY`；**不写入代码、不写进 `.env` 提交** |
| 日志与导出 | 密钥在日志、埋点、诊断包、错误栈中**统一脱敏为 `sk-****`**（白名单脱敏器兜底） |
| 仓库安全 | `.gitignore` 覆盖 `*.key` / `.env*` / `credentials*`；提交前 `gitleaks` 类预检 |
| 轮换与撤销 | 设置面板提供"更换 key"与"清除凭据"；清除后所有 AI 功能立即降级为"未配置"而非报错 |
| 用量保护 | 记录 token 用量与估算成本，支持月度上限 + 超限暂停，防 key 被盗刷 |
| 出图豁免 | **ComfyUI 完全不出机、不需要任何 key**——这是"本地优先"在成本与隐私上的直接收益 |

> ⚠️ 提醒：DeepSeek key 请**只通过设置面板或环境变量注入**，不要直接贴在聊天记录、代码文件或截图里。若曾以明文形式出现在任何地方，建议先在 DeepSeek 控制台轮换一次再使用。

---

## 6. 关键技术选型

| 层 | 选型 | 理由 | 备选/被否 |
|---|---|---|---|
| 语言 | **TypeScript 全栈**（Node 22 LTS） | 引擎/daemon/web/桌面共用类型契约；MCP/Skill 生态本身是 TS 主导 | Rust 引擎（性能好但单人毕设构建成本过高） |
| 前端框架 | **Next.js 16 App Router + React 18** | 静态导出可被 daemon 单源托管；SSR/SEO 对作品展示页有用 | Vite + React（更轻，但失去静态导出托管一体化） |
| 画布渲染 | **CanvasKit（Skia WASM）** | 跨平台像素一致、零原生插件（无 `.node` 编译矩阵，打包便宜）、2D 性能足够 | WebGL2 自研（控制力强但工作量大）；原生 Skia addon（打包地狱） |
| 编辑器内核 | **自研纯 TS 引擎** | 毕设学术含量所在（场景图/命令栈/布局/命中算法） | 直接用开源白板库（学术贡献归零） |
| 服务端 | **Fastify 5 + Zod** | schema-first，性能好，便于"契约快照"守卫 | Express 5（生态大但校验弱） |
| 本地库 | **SQLite（better-sqlite3）+ Drizzle ORM** | 单文件、同步快、离线天然契合；Drizzle 提供类型安全 | Prisma（运行时重） |
| 云端库（可选） | **PostgreSQL + pgvector** | 同一 schema 可迁移；向量与关系库合一，运维简单 | 独立向量库（多一个组件） |
| 文档格式 | **自定义 `.dfg` 目录态 JSON** | 可 Git diff、可崩溃恢复、可被 Git 与 Agent 共同读写 | 单文件二进制（diff 黑盒） |
| 大数据计算 | **DuckDB + Parquet** | 嵌入式 OLAP，单机秒级聚合，无需集群（毕设场景最合适） | Spark（需要集群，过重）；纯 SQLite（OLAP 弱） |
| 采集 | **GitHub REST v3 + GraphQL v4** | 官方 API，条件请求省配额，遵守 ToS | 网页抓取（违规风险，拒绝） |
| 近重复检测 | **MinHash + LSH** | 十万级文件的近似去重可线性扩展 | 两两比较（O(n²) 不可行） |
| 向量检索 | **HNSW（hnswlib / pgvector）** | 召回快、内存可控 | 暴力检索 |
| 关键词检索 | **BM25 倒排** | 精确匹配术语（"PPT"、"deck"）不被向量抹平 | 纯向量（术语精确性差） |
| Embedding | **bge-m3 / bge-small-zh（本地 ONNX）**，可切国产 API | 免费、离线、中文强 | 国外付费 embedding（不符合选型偏好） |
| LLM（文本/意图） | **DeepSeek 为主后端**（用户自带 key），外面包一层 OpenAI-compatible 适配层 | DeepSeek 官方兼容 OpenAI 协议 → 接入成本极低；国产、便宜、中文强；适配层保证不被单一厂商锁死 | 直接调 SDK（锁死厂商）；国外闭源模型（付费且不符合选型偏好） |
| 图像生成 | **ComfyUI（本地 HTTP + WebSocket）** | 免费开源、本地 GPU、**零出机零成本**；已有现成部署（anything-v5 + ControlNet）可直接复用；节点式 workflow 可导出为 API 格式做参数化 | 云图像 API（付费 + 数据出机）；自研 diffusion 推理（工作量不现实） |
| MCP | **`@modelcontextprotocol/sdk`（stdio）** | 官方实现；stdio 本地零网络暴露 | 自研协议（脱离生态） |
| 桌面壳 | **Electron + electron-builder + electron-updater** | 与【逆】报告的对照点最全（安全基线/多标签/更新通道） | Tauri（体积小但生态与现成范式证据少） |
| 沙箱 | **Node `vm` + `isolated-vm`**，纯计算型走 WASM | 与能力白名单配合，超时与内存可硬约束 | 无沙箱直接跑（不可接受） |
| 凭据存储 | **Electron `safeStorage` / OS 钥匙串** | OS 级加密；明文永不落盘、永不进前端 | 明文配置文件（不可接受） |
| i18n | **ICU MessageFormat（zh-CN 主语言 + en 兜底）** | 复数/占位符规范；术语表集中管理 | 硬编码文案 |
| 测试与守卫 | **Vitest + Playwright + 自研 guard 脚本**（依赖方向/Electron 安全基线/MCP 工具契约快照/通道配对） | 【逆】§4.3 明确建议把安全基线与通道配对做成 CI 守卫 | 只靠人工 review（压缩产物下不可靠） |
| 包管理 | **pnpm workspace monorepo** | 依赖隔离严格，符号链接省空间 | npm workspaces |

---

## 7. 实现思路（关键路径）

### 7.1 场景图与命令栈（先做对，再做快）

```text
写操作唯一入口：
  userAction / aiPatch / mcpCall / importer
        └────────────► compileToIR() ──► validate() ──► Transaction
                                                        ├─ 预演（试算新状态）
                                                        ├─ 冲突检查（baseRev）
                                                        └─ commit(): 应用 + 入撤销栈 + 落盘 + 发事件
```

- **不变式**：任何时刻不能有"绕过 `applyTransaction` 修改节点的路径"。这条不变式让撤销、审计、协作模拟三件事同时成立。
- **性能策略**：节点扁平存储 + 脏矩形/脏子树标记 + 视口裁剪；渲染只在 `requestAnimationFrame` 里做，命令栈在微任务里结算。

### 7.2 渲染与命中测试

- 视口变换：世界坐标 ⇄ 屏幕坐标用 3×3 矩阵，命中时先做屏幕→世界逆变换再做局部判定。
- 空间索引：R-tree（按包围盒），框选与悬停先查索引再精确判定。
- 优化：静态子树光栅缓存到离屏 `Image`，仅变换时平移而非重绘。

### 7.3 自动布局与约束（两遍算法）

```text
pass 1 测量：自底向上算内在尺寸（文本测量走离屏文本度量，结果缓存）
pass 2 排布：自顶向下按 flex 语义（direction / gap / padding / align / grow）分配
约束：相对父容器锚点（左/右/上/下/居中/缩放）+ 固定/自适应 求解
```

### 7.4 AI 写入管线（见 §4.5.2，实现要点）

- **baseRev 检查**：AI 生成期间若文档被改，`baseRev` 不匹配 → 拒绝并请求重新生成（防陈旧覆盖）。
- **降级路径**：LLM 连续失败 2 次 → 输出"布局建议清单 + 一键应用"，而不是报错中断。
- **可回放**：`provenance/ai-runs.jsonl` 存 op 列表与决策，支持"重放到第 N 步"。

### 7.5 MCP 网关的无状态化

```text
od/df mcp serve
  ├─ 启动即读 daemon URL（环境变量或 daemon.json）
  ├─ 不持有任何状态、不碰文件系统，每个工具 = 一次 fetch(daemon)
  ├─ daemon 不可达 → 工具调用返回清晰错误，但**服务仍可启动**（客户端能列 schema）
  └─ 空闲超时自动退出（避免僵尸进程）
```

> 这条"无状态代理"设计直接来自对【逆】报告的理解：Figma 把 MCP 服务塞进壳内变得很重；我们把 MCP 服务做成**可被任意宿主 spawn 的轻进程**，ZCode 与 WorkBuddy 各拉起一个即可。

### 7.6 采集管道的工程细节

| 问题 | 方案 |
|---|---|
| API 限流 | 令牌桶 + `Retry-After` 遵循 + 分区并行（按 topic/语言/星标区间分片） |
| 增量 | `since` 游标 + ETag；命中 304 直接跳过（省配额的关键） |
| 目录发现 | Trees API 递归取树 → 本地匹配 `SKILL.md` / `DESIGN.md` / `tokens.json` → 只对命中仓库取文件内容 |
| 大仓库 | 文件大小与深度双上限；超限只取元数据并标注"仅索引" |
| 可重跑 | ODS 只追加；DWD/DWS/ADS 支持"从任一层重建" |
| 数据质量监控 | 三张看板：完整性（字段缺失率）、一致性（重复率/孤儿引用率）、时效性（数据新鲜度分布） |

### 7.7 出图管线（ComfyUI 适配层工程要点）

```text
[1] 探测  GET /object_info + /system_stats
      ├─ 缓存模型清单（checkpoint / LoRA / ControlNet）与显存状态 TTL=60s
      └─ 校验模板引用的模型是否齐备 → 不齐则"缺什么"直接告诉用户

[2] 中文 → 英文 prompt（DeepSeek 侧，唯一交汇点）
      ├─ 正向：语义补全 + 风格词 + 构图词（可套用 Skill 里的风格后缀模板）
      ├─ 反向：固定质量负向词库 + 场景特定负向词
      └─ 参数建议：分辨率 / 步数 / CFG / 采样器（按模板的合法区间裁剪）

[3] 参数注入  workflow 模板 + params 映射表 → 生成完整 API 格式 workflow
      └─ 注入后做一次"节点存在性 + 类型匹配"校验（防模板与本地节点版本不匹配）

[4] 提交与排队  POST /prompt（带 client_id）
      ├─ concurrencyKey = "local-gpu" → 同一 GPU 严格串行
      ├─ 队列持久化到 SQLite（崩溃后可恢复"未完成"任务状态）
      └─ 看门狗：单任务超时上限（默认 180s，可配）

[5] 进度  WS /ws?clientId=…  → 归一化为统一运行事件（供 UI 进度条与 SSE 中转）

[6] 取回与回写  GET /history/{id} → GET /view → 读字节 → 算 sha256
      ├─ 写入 .dfg/assets/<sha256>.png（哈希去重，同图不重复存）
      └─ 在 targetNodeId 下插入图片节点 —— 走统一的 applyTransaction（与 AI 改设计同一写路径）

[7] 溯源  追加 provenance/image-runs.jsonl（全参数 + 哈希）
      └─ UI 提供"同种子重跑"/"改一个参数再跑"两个按钮 → 参数可复现、可做 A/B
```

**工程要点**

- **显存闸门优先于并发性能**：8GB 卡上"并发 2"的收益远小于 OOM 的代价，因此默认串行；队列深度可见、可取消、可调序。
- **两段式出大图**：`768 出图 → latent/模型放大`，避免一次直接出 1024+ 导致 OOM。
- **模板即资产**：workflow 模板本身也进版本管理，甚至可以作为一种"Template 资产"被采集/分享（与 §4.4 的四类资产打通）——出图能力可以像 Skill 一样被市场分发。
- **模型清单只读探测**：ComfyUI 的模型目录只读探测，本项目**不改动**用户的 ComfyUI 安装（不做模型下载/替换），避免把出图链路的故障面扩大到用户既有的 AI 环境。

---

## 8. 实现路线图

| 期 | 主题 | 主要交付物 | 验收标志 |
|---|---|---|---|
| **P0** | 骨架搭建 | pnpm monorepo、Electron 壳、Next.js、daemon 握手、i18n 骨架、CI 四守卫 | 三态都能跑起来；安全基线守卫通过 |
| **P1** | 编辑器内核 | 场景图、命令栈、CanvasKit 渲染、选择/变换/吸附、图层面板、Inspector、快捷键与 ⌘K | 500 节点 ≥55 FPS；5000 节点可打开 |
| **P2** | 设计系统 | 自动布局、六向约束、组件/实例/变体、DTCG Token、版本与回滚、评论 | US 6–15 全部可演示 |
| **P3** | **大数据市场** | 采集器、四层仓库、评分模型、混合检索、市场 UI、双语卡片 | 采到 ≥1 万资产；检索 P95 <300ms；榜单可解释 |
| **P4** | **受控 AI 与本地出图** | **P4a（文本）**：DeepSeek 适配层与凭据库、Design IR、双重校验、逐项 diff 审批、审计回放、降级清单<br>**P4b（图像）**：ComfyUI 探测与模型校验、workflow 模板参数化、串行队列与进度回传、产出回写与溯源、"同种子重跑" | 两条独立验收：① 自然语言 → 可审批 diff → 单事务应用 → 撤销 全链路；② 中文描述 → 英文 prompt → 本地出图 → 回写画布 → 同种子重跑 |
| **P5** | **MCP 与双端接入** | MCP 网关（20 工具）、ZCode 适配器、WorkBuddy 适配器、写路径三段式 | 在 ZCode 与 WorkBuddy 里各跑通"读设计→改设计→审批→回滚" |
| **P6** | 打磨与答辩 | 中文全量本地化、诊断包（含 DeepSeek 与 ComfyUI 连通性自检）、性能基线报告、演示脚本与 Q&A 备份 | 三分钟可演示完整故事线 |

**关键路径**：P1（内核）→ P4（AI 与出图）→ P5（MCP）。P3（大数据）与 P1/P2 可并行（采集端不依赖编辑器）；**P4b（出图）不依赖 P4a（文本）**，若 DeepSeek key 尚未就绪，可先单独把出图链路跑通。

---

## 9. 风险、取舍与合规

### 9.1 技术风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 引擎工作量大（最难的是自动布局 + 组件变体） | 可能拖垮进度 | 严格按 US 顺序交付；自动布局先做"单层 + 固定方向"，嵌套放 P2 后半 |
| 渲染性能不达标 | 演示卡顿 | 早做性能基线（P1 就压 500/5000 节点）；离屏缓存 + R-tree |
| 采集被限流/规模失控 | 市场数据不足 | 增量 + ETag；文件大小上限；先做"精选 500 资产跑通全链路"再放量 |
| AI 生成质量不稳定 | 演示翻车 | 固定 demo 脚本 + 提前录制；降级清单兜底 |
| MCP 在两端配置差异大 | 接不通 | 先做 `manual` 策略保证"给得出可用片段"，再逐步升级为 `json`/`cli` 自动注册 |
| **8GB 显存出图 OOM**（4060 等） | 出图中断、演示翻车 | 串行队列 + 单任务闸门；默认 512–768 边长；大图两段式放大；OOM 自动降档重试一次；预检显存与模型 |
| ComfyUI 版本/节点不匹配 | 模板注入后跑不起来 | 提交前做"节点存在性 + 类型匹配"校验；模板绑定 `templateVersion`；探测 `/object_info` 拿到真实节点清单再校验 |
| 出图耗时长（数十秒） | 演示节奏被打断 | 后台任务不阻塞编辑；演示脚本预置已出好的图并演示"同种子重跑"；进度条全程可见 |
| DeepSeek key 泄漏/被盗刷 | 费用损失、隐私风险 | 只存本地凭据库、仅 daemon 解密；日志/埋点/诊断包统一脱敏；用量记账 + 月度上限 + 超限暂停；提供轮换与清除 |
| DeepSeek 限流或不可用 | AI 改设计功能停摆 | 指数退避重试；429/5xx 分别处理；仍失败降级为"建议清单"；**出图链路完全不受影响** |

### 9.2 合规与隐私（毕设必须写清的一节）

| 项 | 做法 |
|---|---|
| 采集合规 | 只走 GitHub 官方 API，遵守其 ToS 与速率限制；只索引**公开**仓库的元数据与描述性文本 |
| 许可证 | 全程携带 license，未知/禁止再分发 → 仅可查看不可装载；市场卡片显示来源与协议 |
| 署名与下架 | 卡片强制显示仓库链接与 commit；提供"申诉/移除"通道 |
| 个人信息 | 埋点默认仅本地、白名单脱敏、一键删除与查看原始记录；不上传设备指纹 |
| 用户数据 | 设计文档默认不出机；只有用户显式调用云端 LLM 时，才发送组装后的 prompt（并在 UI 明示发送内容） |
| **图像数据** | **出图全程本地**——ComfyUI 跑在 `127.0.0.1`，图像与参考图不出机、不需要任何第三方密钥 |
| **云端边界** | 仅当用户显式使用"AI 改设计 / 生成 prompt"时，才把组装后的**文本**发给 DeepSeek；UI 明示将发送的内容摘要；提供"停用云端 AI"开关（关闭后**编辑器与出图仍完整可用**，只有文本 AI 降级） |
| AI 输出 | 所有 AI 写入进入 `provenance/ai-runs.jsonl`，出图进入 `provenance/image-runs.jsonl`，均可追溯、可回滚 |

> 这条也能直接回答"你这个 Skill 市场是不是在抄袭别人的劳动成果"：**我们只做索引与评分，内容始终指向原始仓库、保留协议、支持下架**——本质是搜索/发现层，不是再分发层。

---

## 10. 答辩亮点与 Q&A 备份

### 10.1 四个主张（一句话版）

1. **不是 Figma 的缩小版**，而是把"Figma 的编辑器范式"搬进"数据不出机 + 可被 Agent 读写"的本地工作台，并把 AI 写入做成可审批、可回滚、可审计的管线。
2. **不是技能商店**，而是"用大数据方法给 GitHub 上散落的技能资产建立可计算的质量与匹配信号"的数据工程闭环。
3. **不是又一个 MCP 客户端**，而是"把设计真值作为唯一可写协议面"，让 ZCode 与 WorkBuddy 在同一写路径上协作。
4. **不是"随便接个 AI"**，而是把 AI 算力按边界拆开：**文本上云（DeepSeek，用户自带 key、可脱敏、可关闭）+ 图像本地（ComfyUI，零出机、零成本、可复现）**——算力分工本身就是"本地优先"这条主张的延伸。

### 10.2 高频刁难问题与口径

| 问法 | 事实 | 口径 |
|---|---|---|
| "Figma 也有 MCP，你的 MCP 有什么不同？" | Figma 桌面端壳内有 MCP 服务与独立 Agent 进程【逆 §2.5】 | 差异在 **① 真值唯一入口（读写同层，含 7 个写工具）② dryRun→一次性 ackToken→审计 ③ 本地 stdio、无配额、不经云** |
| "Figma 也有 Skills" | Figma Agent 能力含 Skills【公】 | 那是 **Agent 侧提示词资产**；我们的是**从 GitHub 大数据采集 + 五维评分 + 采纳率回流**的市场资产——同名不同物 |
| "Figma 也有本地（make local）" | 桌面端有 make local / save local copy【逆+公】 | 那是**云文件的下游投影**；我们是**文件原生在本地**（`.dfg` 可 Git diff、离线完整可用）——差的是"真值在哪" |
| "你这是不是抄 Figma / 抄开源项目？" | — | 见 §0.2 clean-room 声明：只借鉴公开可观测的产品结构与交互范式，代码 100% 自研；逆向报告是**证据链与方法论**，不是素材库 |
| "大数据体现在哪？" | — | 五处：**采集（增量/条件请求）→ 仓库分层（ODS/DWD/DWS/ADS）→ 质量建模（五维可解释评分）→ 混合检索（BM25+HNSW+RRF 重排）→ 数据飞轮（使用数据回流排序）** |
| "为什么不做实时协同？" | Figma 的强项 | 主动取舍：CRDT 会吃掉整个毕设周期。用**本地双窗口只读同步**演示形态，并说明技术路径（将来换 CRDT 只需替换事务层的合并策略） |
| "出图是不是调了国外的付费 API？" | — | **不是**。出图走本地 ComfyUI（`127.0.0.1`），零出机、零成本、不需要任何第三方密钥；只有"文本"这一层上云，且用的是**国产** DeepSeek |
| "文本为什么上云，图像为什么本地？" | — | 不是技术能力问题，是**边界判断**：文本推理本地跑不动（8GB 显存），且文本上下文可脱敏、出机风险可控；**图像与参考图数据敏感度更高、本地算力又刚好够**，所以坚决不出机 |
| "只用 DeepSeek 一个模型，是不是被厂商绑定了？" | — | 适配层是 OpenAI-compatible 的，**换后端只改 baseURL + model + key 三个字段**；选 DeepSeek 是因为它兼容该协议、国产、中文强、便宜——是"默认值"而非"硬绑定" |
| "出图不可复现怎么办？" | — | 每次出图把模板版本 + 模型 + seed + 全部参数 + 产出哈希写进 `image-runs.jsonl`，UI 提供"同种子重跑"，因此**可复现、可做 A/B** |

### 10.3 建议的演示故事线（3 分钟）

```text
1) 打开独立桌面端 → 多标签工作台（对比说明"桌面端为什么需要标签/错误分类/自救"）
2) 画布上拖出画板 + 自动布局 + 绑定 Token（展示 Inspector 与图层）
3) 打开 Skill 市场 → 搜索"数据看板" → 展示五维评分与来源（说明它从哪来）
4) 一键装载并试跑 → AI 生成 → **逐项 diff 审批** → 单事务应用 → 一键撤销 → 看审计
   （此处明确一句："这一步的文本推理走 DeepSeek，但所有改动都得你点头才落地"）
5) 打开出图面板 → 中文描述"废土装备图标，暖色，厚涂" → 看 DeepSeek 把中文扩写成英文 prompt
   → 本地 ComfyUI 出图（进度条可见）→ 自动回写画布 → 点"同种子重跑"改一个参数再跑
   （此处明确一句："整条出图链路没有离开这台机器"）
6) 切到 ZCode：MCP 读到同一个设计 → 改一个 Token → 回到设计端看见确认条 → 批准 → 回滚
7) 打开 `.dfg` 目录在 Git 里 diff（说明"真值在本地"）
```

> 故事线的叙事骨架：**改设计可控（第 4 步）→ 出图不出机（第 5 步）→ 外部 Agent 同一真值（第 6 步）→ 真值可 diff（第 7 步）**。

---

## 11. 附录：与逆向报告的结论映射

| 逆向报告结论 | 本项目用法 |
|---|---|
| Figma 桌面端是"浏览器壳"，asar 内无画布引擎【逆 §2.1/§2.2】 | 支撑"本体必须在本地"这条架构决策；也解释为什么我们不做远端 web 视图桥 |
| 壳 8 桥 / 75 成员 / 58 IPC；桥面很大【逆 §2.4】 | 反面教材 → 我们的 `dfHost` 压到 3 成员 + 通道命名规范 + 配对守卫 |
| 安全基线两边一致（contextIsolation/sandbox/nodeIntegration）【逆 §2.3】 | 直接落地为 `guard:electron-baseline` CI 守卫（【逆 §4.3-4 建议） |
| 通道 RPC 四件套、sender 校验稀疏【逆 §2.4/§4.3-5】 | 预留四件套命名；把"sender 校验"写进多窗口后的强制约定 |
| 桌面端把更新/Agent 运维做成独立通道【逆 §4.3-6】 | 落地为 `df:update:*` / `df:agent:*` 两组隔离通道 |
| 错误分类 + 自救工具 + 多标签 + 最近关闭【逆 §2.2 A/C/D】 | 直接进入 P6 打磨清单（这是"桌面端相对 web 的真实价值"） |
| Agent/MCP 归属：Figma 在壳内，ODS 类实现在 daemon【逆 §4.2】 | 我们选 daemon（理由：CLI/MCP/两端 Agent 需独立接入同一真值源） |
| REA 的能力边界（压缩产物降级、channel 种子 no-match）【逆 §5】 | 写进论文"工具评测"小节；所有 Figma 侧结论标注证据等级 |
| 竞品对照矩阵按"用户任务"而非功能总数【逆 §4】 | 本文件 §2.1 与 §10.1 沿用该方法论 |

---

## 12. 下一步建议

1. **先把 P1 的性能基线与不变式定下来**（500 节点 ≥55 FPS、写操作唯一入口），这两条一旦破了，后面所有功能都不可信。
2. **P3 的采集端可以先独立跑**：不依赖编辑器，一周内就能出第一版市场数据，早期就能验证"大数据"这条线是否立得住。
3. **P5 的 ZCode / WorkBuddy 适配，建议先各写 `manual` 策略的片段生成器**——保证"即使自动注册失败也能用"，然后再升级为自动注册。
4. 建议尽早把 **`SKILL.md` 通用约定**作为技能包的规范基线（这样采到的资产天然可在多个 Agent 生态间迁移），把本项目特有的字段放在独立的 sidecar 清单里，保持便携性。
5. **DeepSeek key 先落到凭据库再动代码**：设置面板用密码框输入 → `safeStorage` 加密落盘 → 只在 daemon 侧解密；同时把"脱敏器 + 用量记账 + 月度上限"一起做掉（这三件是附带的，但漏了会在答辩时被问）。
6. **ComfyUI 侧零改动优先**：先只做**只读探测**（`/object_info`、`/system_stats`）把"能不能连上、有哪些模型"跑通，再做出图。**不要动用户既有的 ComfyUI 安装与模型目录**——你机器上那套 anything-v5 + 14 个 ControlNet 是现成可用的资产，别把它变成故障面。
7. **先在 4060 上量一遍真实耗时**（768×768 / steps 24 / 单 ControlNet），拿到实测数据再定队列策略与超时阈值——这类数字写进论文比拍脑袋的"预计"可信得多。

---

*本文档为概要设计（v1.0，含 DeepSeek + ComfyUI 补充）。建议后续拆分为：① 详细设计（引擎算法与数据模型）② 数据工程专题（采集/仓库分层/评分模型）③ 集成专题（MCP 工具契约与双端适配）④ **AI 能力专题（DeepSeek 适配 + ComfyUI 出图链路与显存调优）** ⑤ 测试与质量专题。*
