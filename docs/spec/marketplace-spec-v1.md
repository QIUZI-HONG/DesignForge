# 技能市场规格 v1（设界 · 寻路图 #9）

- 状态：**v1 定稿**（2026-10-15，#9 收口）
- 上游票面：issue #9（逐条：数据模型 / 四类识别 / 评分 / 页面与交互 / 装载边界 / 产出）
- 依据材料：
  - 研究 #3 WorkBuddy 市场形态（`research/workbuddy-market` 分支 `docs/research/2026-10-15-workbuddy-market.md`）
  - 研究 #4 GitHub 供给与采集策略（`research/github-supply` 分支 `docs/research/2026-10-15-github-supply.md`）
  - 《DesignForge-架构设计说明》v1.1：§4.4（采集线）、§4.5.3（能力白名单）、§4.5.4（MCP 写路径治理）、§5.3（市场索引）、§7.6（采集工程细节）、§12（采集端可独立跑）
  - `docs/spec/page-inventory-v1.md` D 区（D1–D6 六项，自设计页）与 `docs/spec/acceptance-standard-v1.md` §5/§6
  - `docs/spec/frontend-impl-spec-v1.md` §三 FE-11
  - 术语以根 `GLOSSARY.md` 为准（技能市场 / 四类资产 / 采集线 / 本地优先）
- 下游：《市场首实现范围与跑通判据》（#10，入仓 `docs/spec/market-first-impl-v1.md`）拆出 MK-01…MK-05；FE-11（市场前端 + 数据看板）。
- 本文档性质：**规格（plan, don't do）**——只拍口径与契约，不含实现代码。

## 0. 范围与定位

- **技能市场**（GLOSSARY）= GitHub 四类资产 → 四层仓库 → 五维评分 → 混合检索 → 卡片/装载/回流；呈现形态「类似 WorkBuddy 的 skill 市场」（信息架构借鉴，语义换域为设计领域）。
- **采集线**（GLOSSARY）= 上游数据工程链路：采集 → ODS/DWD/DWS/ADS 四层 → 评分 → 索引；首批**独立可跑**，不依赖编辑器/桌面壳（v1.1 §12 建议）。
- 本文档回答两件事：**市场数据的契约**（§1–§5、§7 词表、§8）+ **市场产品的形态**（§6 页面与交互、§7 装载边界）。
- 与 `df.marketplace.index/v1`（v1.1 §5.3）的关系：v1.1 给形状，本文档**逐字段定稿**（含新增字段与枚举词表），并声明版本演进规则（§1.5）。

---

## 1. 数据模型 `df.marketplace.index/v1`（逐字段定稿）

索引是 **ADS 应用层产物**（market_card 的真值），消费方 = 市场前端（FE-11）、CLI 检索、编辑器内面板（D5）。采集线内部表结构见 §4。

### 1.1 顶层结构

| 字段 | 类型 | 必填 | 语义 | 示例 |
|---|---|---|---|---|
| `schema` | string | 是 | 契约标识，精确匹配（§1.5） | `"df.marketplace.index/v1"` |
| `generatedAt` | string（ISO8601 UTC） | 是 | 索引生成时刻；取自批次元数据（可注入以复现，见 §4.3） | `"2026-10-15T12:00:00Z"` |
| `collector` | object | 是 | 生成者与批次溯源：`{name, version, runId, odsWatermark}` | `{"name":"df-market","version":"0.1.0","runId":"20261015-2201","odsWatermark":"2026-10-15T22:00:00Z"}` |
| `counts` | object | 是 | 条目计数：`{total, byKind, loadable}` | `{"total":40,"byKind":{"skill":15,"plugin":9,"design-system":8,"template":8},"loadable":31}` |
| `assets` | array\<Asset\> | 是 | 资产卡片数组；`installGate.mode=blocked` 者**不出现**（§7.2） | 见 §1.2 |

### 1.2 Asset 字段表

| 字段 | 类型 | 必填 | 语义 | 示例 |
|---|---|---|---|---|
| `id` | string | 是 | 稳定资产标识：`gh:<owner>/<repo>#<资产根相对路径>`；**不含 commit**（commit 在 `source.ref`），装载/更新以此为键 | `"gh:anthropics/skills#skills/pdf"` |
| `kind` | enum | 是 | 四类资产之一：`skill \| plugin \| design-system \| template` | `"design-system"` |
| `name` | string | 是 | 机器名（slug；来自 frontmatter `name` 或目录名规范化） | `"pdf-export"` |
| `displayName` | object | 是 | 双语展示名 `{zh-CN, en}`；缺一言回退另一言，皆缺回退 `name` | `{"zh-CN":"PDF 导出","en":"PDF Export"}` |
| `summary` | object | 是 | 双语一句话简介（中文 ≤80 字）；卡片主文案 | `{"zh-CN":"把设计稿一键导出为分页 PDF","en":"Export designs to paginated PDF"}` |
| `description` | string | 否 | 长文概述原文（详情页「概述」；双语策略见 §6.3） | — |
| `source` | object | 是 | 溯源块（§1.3） | — |
| `capabilities` | array\<string\> | 是 | 能力白名单（词表见 §7.1）；资产未声明时缺省 `["prompt:inject"]` | `["prompt:inject","fs:read"]` |
| `facets` | object | 是 | 分类面（§1.4） | — |
| `quality` | object | 是 | 五维评分与可解释（§5） | — |
| `installGate` | object | 是 | 装载门：`{mode, licenseGate, security, reasons[], ackRequired[]}`；`mode ∈ loadable \| view-only \| blocked`（§7.2） | `{"mode":"loadable","licenseGate":"loadable","security":"pass","reasons":[],"ackRequired":[]}` |
| `digest` | string | 是 | 资产内容哈希 `sha256:<hex>`（算法见 §1.6） | `"sha256:9f2c…"` |
| `version` | string | 否 | 资产自声明版本（frontmatter/manifest 原样） | `"1.2.0"` |
| `embeddingRef` | string \| null | 是 | 向量引用；**首版恒 `null`**（向量检索圈外，§9） | `null` |
| `metrics` | object | 否 | 本地回流计数 `{installs, adoptions, favorites, lastUsedAt}`；**首版全 0/空**（遥测默认仅本地，§8.3） | `{"installs":0,"adoptions":0,"favorites":0,"lastUsedAt":null}` |
| `yanked` | object \| null | 是 | 下架标记 `{reason, at, source}`（§8.2）；非空时卡片显示下架说明 | `null` |

### 1.3 `source` 溯源块

| 字段 | 类型 | 必填 | 语义 | 示例 |
|---|---|---|---|---|
| `repo` | string | 是 | `owner/repo` | `"anthropics/skills"` |
| `repoId` | number | 是 | GitHub 仓库数据库 id——**入库去重主键**（研究 #4 §6.1：同一仓会被多 topic 召回） | `123456789` |
| `path` | string | 是 | 资产根目录（仓库根 = `""`） | `"skills/pdf"` |
| `ref` | string | 是 | 采集时点 commit（40 位 hex）——卡片与详情必须显示短哈希，装载记录以此对齐 | `"a1b2c3d…"` |
| `fetchedAt` | string | 是 | 该资产快照采集时刻 | `"2026-10-15T22:05:11Z"` |
| `license` | object | 是 | `{spdx: string\|null, gate, evidence:{path, sha256}}`；`gate` 三档见 §7.2 | `{"spdx":"MIT","gate":"loadable","evidence":{"path":"LICENSE","sha256":"77aa…"}}` |
| `stars` | number | 是 | 采集时点星数（生态热度信号源，不直接作排序键） | `1234` |
| `pushedAt` | string | 是 | 仓库最后 push（维护活跃信号源） | `"2026-10-01T09:00:00Z"` |
| `archived` | boolean | 是 | 归档仓（研究 #4：样本池 archived=5/90） | `false` |
| `homepage` | string \| null | 否 | 项目主页 | `null` |
| `upstream` | string \| null | 否 | 同源上游（`owner/repo` 或 URL）；研究 #4 §6.5：1 上游 : 11 落点，同源簇聚合的依据 | `"zarazhangrui/beautiful-html-templates"` |
| `brandDerived` | boolean | 是 | 品牌复刻判定（如品牌设计语言复刻）；`true` → `installGate.mode=blocked`（§7.2、研究 #4 §6.7） | `false` |

### 1.4 `facets` 分类面

| 字段 | 类型 | 必填 | 语义 | 示例 |
|---|---|---|---|---|
| `category` | enum | 是 | 设计品类（词表见下） | `"幻灯片"` |
| `lane` | enum | 是 | 工作泳道：`create`（新建产出）/ `refine`（改造现有设计）/ `deliver`（交付导出） | `"create"` |
| `mode` | enum \| null | 否 | 资产形态：`template \| design-system \| prototype \| components \| tokens \| utility \| other` | `"design-system"` |
| `tags` | array\<string\> | 是 | 自由标签（≤10；来自资产声明 `tags` 或 topics 校准后） | `["dashboard","chart"]` |
| `scenes` | array\<string\> | 是（可为空数组） | 场景 id（D1 场景化入口绑定） | `["ppt-design"]` |

**`category` 词表（9 场景种子 + 兜底，源自研究 #3 §2.3 `scenes.json` design 场景，中文命名待术语表校准——见 §9）**：
`网站设计 / 移动端App / 设计系统 / Web App / PPT设计 / 交互原型 / 品牌设计 / 图标&插画 / 视觉海报 / 其他`

### 1.5 版本演进规则

1. **消费方契约**：按 `schema` 字符串**精确匹配主版本**；**未知字段必须忽略**（前向兼容）；未知枚举值一律归 `other` 处理，不得报错退出。
2. **v1 内演进（允许）**：新增**可选**字段；新增枚举值；新增 `reasons`/`deductions` 原因码。三者都不改必填语义、不改既有字段含义、不改 `digest` 算法。
3. **必须升主版本 `v2` 的变更**：必填字段增删或改语义、枚举删除或改名、`digest` 算法变更、`id` 形态变更。
4. **过渡**：升 v2 时**双写**（同批产出 v1 + v2），ADS 保留前主版本 ≥1 个发布周期；差异写入迁移说明（`docs/spec/` 内新增文档，不就地改写本文档）。
5. **冻结**：本文档发布即 v1 字段语义冻结；变更走规格修订（新增文档或本文档修订记录段），不改历史结论。

### 1.6 `digest` 计算（资产内容哈希）

- 输入 = 资产根目录内**全部文件**（含许可原文），逐个取 `sha256`。
- 清单流 = 按相对路径**字典序**拼接的行：`"<相对路径>\0<文件 sha256>\0<字节数>\n"`（统一 LF，UTF-8）。
- `digest = "sha256:" + sha256(清单流)`。确定性要求：同 commit 同路径 → 同 digest；不同 commit 内容变 → digest 变。
- 用途：装载校验（写入前比对）、更新判定（digest 变 = 内容变）、证据 JSON 溯源（与 `source.ref` 成对出现）。

---

## 2. 四类资产识别规则

### 2.1 总则

1. **topic 只作候选发现，不作资产认定**（研究 #4 §0.1）：`design-system` 池首条是后端架构书、7 条 `awesome-*` 清单；`figma-plugin` 池首条是设计系统 → topic 仅用于**缩小候选集**。
2. **认定 = 结构探针 + 内容校验**，两级都必须过：结构探针（路径模式，Trees API 单次调用可得）→ 内容校验（读描述性文本，防纯文件名误报，研究 #4 §3.4 反例）。
3. 资产粒度 = **目录**；一仓可产出多资产。**同目录多命中**时取一（优先级 `plugin > design-system > template > skill`，理由：Plugin 天然包含 Skill，不重复计入）。
4. **清单仓（awesome/list）单列 `kind=list`，不入索引、不参与评分**（可作发现源，研究 #4 §6.2）。
5. 内容校验使用的字段（frontmatter `name`/`description`、token 形态、清单字段）**只取描述性文本与结构，不下二进制、不克隆仓库**（§8.1）。

### 2.2 Skill

| 项 | 口径 |
|---|---|
| 结构探针 | `**/SKILL.md`（大小写敏感） |
| 内容校验 | ① YAML frontmatter 可解析；② 含非空 `name` 与 `description`（研究 #4 §3.4：种子 537 个中 530 个满足；7 个无 frontmatter 的作**不合规样本标记**，可入库但不计规范分）；③ 正文非空且非纯清单（排除仅罗列链接的 redirect 型文件） |
| 反例 | 同名 `skill.md`（小写）不算；无 frontmatter 且正文 <144 字节（种子最小值）标记为 `suspect` |
| 判据提示 | 装载落点目录名应与 `name` 一致（不一致记入 `deductions`，见 §5.3） |

### 2.3 Plugin

| 项 | 口径 |
|---|---|
| 结构探针 | 清单文件之一：`**/.claude-plugin/plugin.json`、`**/plugin.json`（仓根或资产根）、市场清单条目（`marketplace.json` 内 `source` 指向本仓）、`package.json` 含 `contributes`/`df-plugin` 声明 |
| 内容校验 | ① 清单 JSON 可解析且含 `name`；② 声明了 `skills`/`components`/`commands` 等条目字段，或**同目录/同仓存在 ≥1 个通过校验的 SKILL.md**（Plugin = Skill 的打包，v1.1 §4.4.1） |
| 反例（防误报） | `**/.mcp.json` **单独出现不构成 Plugin**——它只是 MCP 连接器声明（映射为 `capabilities:["mcp"]` 的证据，不升类）；`package.json` 无插件声明字段的普通库不算 |
| 备注 | 连接器（MCP）不是第五类资产：并入 Plugin 的 `capabilities` 表达（研究 #3 §4.2 换域表） |

### 2.4 Design System

| 项 | 口径 |
|---|---|
| 结构探针 | `**/DESIGN.md`、`**/design-tokens.json`、`**/tokens.css`、`**/tailwind-v4.css`（v1.1 §4.4.1 的 `tailwind.config` 归入 tokens 证据） |
| 内容校验（硬门槛，≥2 项结构件） | ① 至少一个 token 文件通过**形态校验**：JSON 内见 DTCG 形态（`$value`/`$type` 键）或 `tokens.css`/`tailwind-v4.css` 见 CSS 变量/主题块；② 另有 ≥1 项：`DESIGN.md`、`manifest.json`（设计系统清单）、`components.manifest.json` 或 `preview/` 目录 |
| **反例（必须实现，研究 #4 §3.4）** | `tokens-studio/figma-plugin` 命中 8 个 `tokens.json` **全部是 i18n 词表**（`src/i18n/lang/*/tokens.json`）——路径含 `i18n`/`langs`/`locale` 的 token 文件**直接丢弃**；JSON 无 `$value`/`$type` 且值为纯字符串映射（词表形态）→ 丢弃 |
| 品牌复刻 | `DESIGN.md` 内容与公开品牌设计语言高度一致（名称含品牌名、`source.type=bundled` 类证据）→ 记 `brandDerived=true`（§7.2 守门，研究 #4 §4.3 种子 0 许可且多为品牌复刻） |

### 2.5 Template

| 项 | 口径 |
|---|---|
| 结构探针 | 模板清单（`manifest.json`/`template.json`/市场条目声明模板类型）+ `**/preview/` 或 `**/examples/` 目录（v1.1 §4.4.1） |
| 内容校验 | ① 清单可解析且条目 ≥1，条目文件在 Trees 清单中存在（存在性校验，不下载）；② `preview/` 或 `examples/` 含 ≥1 个渲染产物（`.html`/`.svg`/`.png` 之一）；③ 排除「组件库」反例：有 `preview/` 但无条目清单、且产物是组件画廊（研究 #4 §1.1：`react-bits` 类）→ 不认定 |
| 备注 | 幻灯片/海报/网页模板优先（研究 #3 §4.2：模板 = 可复用任务起点，字段照 `scenes.json` 的 `prompts/promptTitles` 形态） |

### 2.6 同源聚合与近重复（采集期即处理）

1. **精确重复**：正文规范化（去 BOM/空白/许可头）后 SHA-256 同 hash → 合并，保留最新/最全一份。
2. **近重复**：正文 >5KB 用 Shingle(5-gram) + MinHash(128) + LSH(b=16, r=8, 阈值≈0.85)；≤5KB 用 SimHash（研究 #4 §6.6 参数草案）。
3. **结构同源**：`upstream` 字段相同 → 必进同簇；目录指纹 Jaccard ≥0.9 自动合并、0.7–0.9 人工队列（研究 #4 §6.6）。
4. **市场层以「同源簇」排序去稀释**（研究 #4 §6.5：1 上游 → 68 落点的极端案例），簇内只保留质量最高者进 `assets`，其余在 DWD 保留并标 `clusterId`。
5. 仓内自重复（研究 #4 §6.3：`design-extract` 的 gallery 同模板副本）按上述流程处理。

---

## 3. 采集纪律

### 3.1 限额与预算表（研究 #4 §3.1 实测 + §3.2 官方文档）

| 资源 | 限额 | 本规格采集预算 | 说明 |
|---|---|---|---|
| core | 5,000/时 | **≤4,000/时**（留 20% 余量） | `repos/{o}/{r}`、`git/trees`、`contents` 等 |
| search | 30/分 | **≤24/分**（1 req/2.5s 令牌桶） | 候选发现专用 |
| code_search | 10/分 | **仅单仓钻取，禁全局普查** | 研究 #4 §8.3：全局 `filename:SKILL.md` 数值不可复核 |
| 失败请求 | — | **照扣配额**（实测：12 次误发 POST 全 404 但 core 照扣） | 故错误路径也要计预算 |

**首批成本**：40 仓 × 3–5 core 调用 ≈ 120–200 次 → 一小时限内可复跑约 20 遍（研究 #4 §5）。**首月上限 ≤300 仓 + 增量**；全量普查不做。

### 3.2 条件请求（ETag）

- 对**不变/少变**资源（repo 元数据、`contents/` 文件、Trees）保存 `{etag, last_modified, body_digest, fetched_at}`（SQLite 表 `http_cache`），下次同 URL 带 `If-None-Match`。
- `304` → 只更新 `fetched_at`，**不计主限额**（官方文档原文，研究 #4 §3.2）；`200` → 落 ODS 并更新 ETag。
- **列表类端点（search）不用 ETag**（结果集天然漂移）；条件请求不适用于非 GET（文档明示）。

### 3.3 增量（since 游标）

- 基线：一次全量，按 `pushed:` 时间窗切片绕过搜索结果 1,000 条上限（研究 #4 §3.3）。
- 增量：`q='topic:<t> pushed:>=<水位>'`，**水位 = 上次运行开始时间 − 5 分钟**（防边界漏）。
- 二次去重：每仓 `pushed_at` 与本地值比对，未变 + ETag 304 → 跳过。
- 节奏（研究 #4 §3.6 实测）：Skill 类日更；Design System / Design Tokens 周更；**僵尸仓停跟**（>540 天未 push 且 <50★）。

### 3.4 串行限速与退避（可实施参数）

```
core       : 容量 4，速率 1 req/s（串行队列）
search     : 容量 2，速率 1 req/2.5s（=24/分 < 30/分）
code_search: 容量 1，速率 1 req/7s，仅单仓钻取
并发 = 1（官方建议串行，非并发）
```

| 响应 | 动作 |
|---|---|
| `retry-after: N` | 睡 N 秒（最高优先） |
| `x-ratelimit-remaining: 0` | 睡到 `x-ratelimit-reset + 5s` |
| 403 / 429（无 retry-after） | 先睡 ≥60s；指数退避 1s→2s→4s…（±20% 抖动），上限 5 次后落 `dead_letter` |
| 5xx | 同上指数退避，上限 5 次 |
| 401 / 404 | **不重试**（配置/权限问题），记录并跳过 |
| 连续限速失败 | 停整条流水线（文档警告：持续越限可能封禁） |

### 3.5 分页

- **只按 Link header 走**；禁止手拼 `page` 参数、禁止预测 URL 结构（官方文档明示）。
- 翻页上限意识：搜索结果最多 1,000 条 → 用时间窗/限定符切片而非深度翻页（研究 #4 §1.2）。

### 3.6 `gh api` 的坑（研究 #4 §3.7 实测）

- **`gh api -f` 会默认把请求变成 POST**：本次 12 次调用全 404 且**照扣 core 配额**。
- 规矩：**一律显式 `gh api --method GET`**（或在 URL 直写查询串）；写进采集器的请求封装与代码评审清单。
- 不假设宿主有 `jq`（实测本机无）；用 `gh --jq` 或语言运行时解析。
- 搜索返回的 `topics` 数组**不作认定依据**（`semi-design` 同时挂 `design-system` 与 `figma-plugin`）。

### 3.7 每仓调用账（研究 #4 §3.5）

| 阶段 | 每仓调用 | 备注 |
|---|---|---|
| 元数据 `repos/{o}/{r}` | 1 | 第二次起 ETag → 304 免费 |
| Trees 递归 `?recursive=1` | 1 | `truncated=true` 时降级：contents 逐目录钻取或单仓 code_search |
| Contents 抽样（frontmatter/清单正文） | 1–3 | 只取描述性文本 |
| 合计 | **3–5** | 按 4,000 core/时 → ≈800–1,300 仓/时（串行） |

---

## 4. 四层仓（ODS → DWD → DWS → ADS）

### 4.1 目录布局

```
data/
├── ods/                               # 原始层：只追加、不修改
│   ├── raw_events/date=<YYYY-MM-DD>/<runId>.jsonl.gz
│   ├── raw_snapshots/<owner>__<repo>/<commit>/files.json
│   └── blobs/<sha256>                 # 被采集正文（描述性文本），内容寻址
├── dwd/                               # 明细层：Parquet
│   ├── repo.parquet  asset.parquet  asset_file.parquet  license.parquet
├── dws/                               # 汇总层：Parquet
│   ├── asset_quality.parquet  asset_facet.parquet  asset_trend.parquet
│   ├── asset_cluster.parquet（同源簇）· asset_embedding（**预留，首版不产出**）
└── ads/                               # 应用层：JSON（契约产物）
    ├── df.marketplace.index.v1.json   # 市场卡片真值（§1）
    ├── market_search_index.v1.json    # BM25 倒排
    ├── market_rank.v1.json            # 榜单（首版可为基础排序）
    └── market_feedback.jsonl          # 回流（首版空文件占位）
```

### 4.2 落盘格式抉择（并说明理由）

| 层 | 格式 | 理由 |
|---|---|---|
| ODS | **gzip JSONL**（事件）+ JSON（文件清单）+ 内容寻址 blob | 只追加、行级可审计、半结构化灵活；gzip 压体积；blob 按 sha256 天然去重幂等 |
| DWD / DWS | **Parquet** | 列存 + 高压缩；DuckDB 直接读（v1.1 §4.4.6 选型），无集群；schema 演进友好 |
| ADS | **JSON** | 对外契约（FE/CLI 直接消费）；可读可 diff（本地优先：`.dfg`/Git 可审阅）；体积由卡片数可控 |

### 4.3 幂等与可离线复跑

1. **幂等键**：ODS 文件清单 = `(repoId, commit, path)`；资产 = `id`（§1.2）；ADS 组织键 = `id`。
2. **纯函数重建**：DWD/DWS/ADS = f(ODS)；**去网络、去时钟依赖**（时间戳一律取自 ODS 记录；`generatedAt` 可取批次 `asOf` 注入）→ 同输入同输出。
3. **任一层重建**：删任一上层目录，从上层重跑结果一致（v1.1 §4.4.2 / §7.6 不变式）。
4. **离线复跑**：`collect --replay <离线样本集>` 不触网重放；复跑报告比对 digest（byte-identical 或给出差异清单）。
5. **溯源链**：每条 ADS 卡片 → `source.ref`（commit）+ `digest`（文件级哈希）→ ODS 快照 → 原始 API 事件（含 ETag 与配额余量）。

### 4.4 四层字段（摘要，实现票展开）

- **ODS `raw_events`**（每行 = 一次 API 往返）：`{ts, runId, request:{method,url,params}, response:{status, etag, linkNext, bodyDigest, quota:{core,search}}, blobRef?}`；携带 `fetched_at` / `etag` / `api_quota_left`（v1.1 §4.4.2）。
- **DWD**：`asset`（资产主表，含 `kind/name/display_name/summary/ref/path/cluster_id/license_gate`）· `asset_file`（相对路径 + sha256 + size）· `repo`（repoId/stars/pushed_at/archived/fork/upstream）· `license`（spdx 原文 + 判定档 + 证据哈希）。
- **DWS**：`asset_quality`（五维 + 扣分原因码，§5）· `asset_facet`（category/lane/mode/tags/scenes）· `asset_trend`（星标增速/提交活跃/发布节奏）· `asset_cluster`（同源簇）。
- **ADS**：§1 契约产物；`market_search_index` = 倒排（词项 → 资产 id 与权重）；`market_rank` = 排序键快照（质量分 × 相关度，§6.3）。

---

## 5. 五维评分口径

### 5.1 权重与总分

| 维度 | 键 | 权重 |
|---|---|---|
| 规范符合度 | `spec` | **0.25** |
| 维护活跃度 | `maintenance` | **0.20** |
| 文档完备度 | `docs` | **0.20** |
| 安全性 | `security` | **0.20** |
| 生态热度 | `ecosystem` | **0.15** |

- 每维 [0,1]；`score = Σ(权重 × 维度分)`，两位小数（v1.1 §4.4.3）。
- **总分不单独展示**——卡片给分维度雷达图 + 总分徽标（「为什么推荐」可解释）。

### 5.2 分维度信号与算法

**规范符合度 `spec`（.25）**：frontmatter 字段完整度（`name`+`description` 必有，`triggers`/`tags` 加分）· `description` 是否写成「何时使用」（含触发语境）· 正文是否有显式工作流（步骤/命令块）· 是否附 `references/` 或 `examples/` · 清单 schema 符合度（plugin.json / design-system manifest 字段齐）。
**维护活跃度 `maintenance`（.20）**：最近 90 天提交数 · 最近一次 release 距今 · 是否有 CI（`.github/workflows/` 存在性）· `pushed_at` 新鲜度。_v1 只用 Trees + repo 元数据可得的信号；issue 响应中位数与提交数为 v1+ 增强信号（需额外调用预算，列入 §9）。_
**文档完备度 `docs`（.20）**：README 是否含安装与使用示例 · 是否有预览资产（`preview/` 图或 `components.html`）· 是否有 changelog · 许可说明是否清晰（含上游署名）。
**安全性 `security`（.20）**：是否含隐藏安装脚本（`postinstall`/`preinstall`/shell 脚本）· 是否声明所需权限（`allowedTools`/capabilities）· 可疑网络调用（出站域名是否声明）· 敏感路径访问（工作目录外读写）。
**生态热度 `ecosystem`（.15）**：星标 + **星标增速** · fork 数 · 被引用数（被其他仓引用/同源落点数）。**防马太：用增速与分位，不用绝对星标排名**（v1.1 §4.4.3 明示）。

### 5.3 可解释输出（扣分原因与雷达）

- `quality.explain.<dim> = {signals: [{code, value, weight}], deductions: [{code, reason, delta}]}`。
- 原因码词表（示例，可扩展）：`S1 缺 description` · `S2 description 未写「何时使用」` · `S3 无显式工作流` · `M1 >365 天未更新` · `M2 僵尸仓（>540 天且 <50★）` · `D1 无 README` · `D2 无使用示例` · `D3 无预览资产` · `X1 含 postinstall 等安装脚本` · `X2 未声明权限` · `X3 未声明出站域名` · `E1 星标增速低` · `L1 许可档非可装载（不扣分，走守门，§7.2）`。
- **展示**：详情页分维度雷达（五轴）+ 「为什么是这个分」列表（每维前 2–3 条扣分原因，人话文案）；雷达数据点在**无信号**时显示为空心（区别于 0 分）。

### 5.4 冷启动与边界用例

- 新资产（<90 天）或零采纳：用 `spec + maintenance` 托底，避免「零采纳永远排最后」（v1.1 §4.4.4）。
- 无 license / `NOASSERTION`：**不从安全性扣分**（走 license 守门，§7.2）；`security` 分只反映静态审计结果。
- 归档仓：`maintenance` 封顶（如 ≤0.3）+ 卡片显示「已归档」。
- 合规样本（7 个无 frontmatter 的 SKILL.md）：入库但 `spec` 分走低，`confidence=low`。

---

## 6. 页面与交互（D1–D6）

### 6.1 信息架构（借鉴 WorkBuddy 形态，研究 #3 §4.1）

照搬骨架、语义换域（研究 #3 结论：**骨架照搬（信息架构与交互范式），语义换域（设计领域资产）**）：

| WorkBuddy 骨架 | 设界对应 |
|---|---|
| 统一市场页 + 一级标签（技能/连接器/专家） | 市场页 = **一级标签按四类资产**（全部 / 技能 / 插件 / 设计系统 / 模板）+ **场景 chips**（9 场景种子）；二级 `市场 \| 已装载` |
| 市场内来源生态分签 | 来源筛选：`内置 / 本地自建 / 社区（GitHub）`（社区**必须显示 repo + commit**） |
| 卡片：名称/描述/来源/指标行/标签/主按钮 | 名称（中文主）+ 一句话 + kind 徽标 + 来源徽标（repo@短哈希）+ 指标行（总分徽标 + 采纳/装载/收藏）+ 标签（需连接器/需云端 key/本地离线可用 + 许可档）+ 主状态按钮（装载\|已装载\|可更新\|装载中）+ 更多操作（启停/卸载/置顶/查看来源） |
| 详情模态（可被宿主唤起） | D2 详情面板（模态；可被 AI 抽屉/命令面板唤起） |
| 三流程确认门（装/卸/更新） | §7.3/§7.4 同构（确认门 + 本地改动二次确认 + 自动更新默认关） |
| 场景化入口（scenes.json） | D1 顶部「按场景浏览」：场景 = 若干资产 + 示例话术（字段照 `prompts/promptTitles` 形态） |
| 对话内安装协议（搜索→候选→确认→逐项如实报告） | 同款：AI 代装必须**用户确认后**装载，逐项报告 `已装载/已存在/已拒绝`（研究 #3 §3.8） |
| 付费/云同步 | **不照搬**（本地优先、离线完整可用） |

**排序**（研究 #3 §3.4 换域）：综合评分（`quality.score` × 相关度）· 采纳量 · 最近更新；**默认「综合评分」**，指标行在首版无回流数据时隐藏采纳/收藏两列。

### 6.2 D1–D6 逐页口径

- **D1 市场首页（发现/精选/分类）**：卡片网格 + 筛选栏；场景 chips；「精选」= 质量分 Top-N（按场景分组）；悬停抬升；空态/加载态/错误态按验收标准 §5。
- **D2 资源详情**：左预览（`preview/` 首图或占位）+ 右信息栏：基本信息（来源 repo/commit/路径、License、版本、ID、作者）→ 概述（长文 + 翻译声明，§6.3）→ 五维雷达 + 扣分原因 → 能力与安全（能力清单 + 静态审计结论 + 许可档）→ 试试这样用（示例话术）→ 使用案例（「一键做同款」→ 生成 `.dfg` 变更提案，走受控 AI 写入管线）→ 更多（版本/ID/digest 短哈希）。装载按钮三态（可装载/仅看/已装载）。
- **D3 搜索与筛选**：搜索框（名称/描述/标签/正文，首版 BM25 + 中英术语等价类，「PPT/幻灯片/deck」起步）；筛选（kind/来源/场景/许可档/是否已装载）；无结果空态、加载失败态、**部分失败态**（借 WorkBuddy「部分社区结果加载失败」语义，研究 #3 §3.4）。
- **D4 装载确认与权限清单**：确认弹窗（装载位置 `.dfg/market/<kind>/<slug>/`；同名覆盖确认）→ 能力清单**逐项**（§7.1 词表 + 风险标色 + `subprocess` 类红标）→ license 档位与署名要求 → **一次性 token**：dryRun 预览 → 用户批准 → `ackToken` → 单事务写入 → 审计（v1.1 §4.5.4）。超时未批准 → token 失效态。
- **D5 编辑器内市场面板（深色）**：面板列表 + 详情 + 「试跑」入口（在沙箱中运行示例话术，默认 dryRun 无副作用）+ 采纳展示（本地计数）。P0，随 FE-11。
- **D6 数据看板**：采集进度（批次/水位）· 四层状态（各层条目数/最近重建时间）· 质量三看板 = **完整性**（字段缺失率）/ **一致性**（重复率、孤儿引用率）/ **时效性**（数据新鲜度分布）（v1.1 §7.6）。

### 6.3 中英双语卡片口径（与 ADR-0003 的关系）

- **数据层双语**：`displayName`/`summary` 为 `{zh-CN, en}`（§1.2）；资产原文（README/SKILL.md 正文）保留原语言。
- **界面层中文唯一**（ADR-0003 不破）：**不提供界面语言切换**；卡片主文案取 `zh-CN`（缺失回退 `en`）。
- 详情页原文呈现：中文缺失/为英文时，按 WorkBuddy 型**自动翻译声明**处理（「正文由英文自动翻译，代码与字段名保留原文」，研究 #3 §3.3）——这是**资产内容**的翻译标注，不是界面语言切换。
- 最终呈现形态（原文折叠 vs 并列）待 FE-11 联调定稿（§9）。

### 6.4 自设计页验收

- D1–D6 全部为**自设计页**（`docs/spec/page-inventory-v1.md` D 区）：不逐像素对照 Figma 本体；按验收标准 §6 三类检查（设计系统一致性 / 状态覆盖 §5 / 与相邻对照页风格同族）+ 本规格的交互要求。
- 主题（清单 v1）：D1–D3、D6 浅色；D5 深色；D4 随上下文。

---

## 7. 装载边界

### 7.1 能力白名单（词表沿用 v1.1 §4.5.3，不新增词）

| 能力 | 授予口径 |
|---|---|
| `prompt:inject` | **默认授予**（仅注入指令，零副作用） |
| `fs:read` / `fs:write` | 限定**项目工作目录内**（路径规范化 + 目录逃逸检测） |
| `mcp` | 允许调用已授权的 MCP 工具 |
| `subprocess` / `bash` | **默认拒绝**；需在装载确认条上**显式授权**（一次性 token），逐次审计 |
| `network` / `connector:<id>` | 需声明**域名白名单**；`connector:*` 走本地凭据库 |
| `comfy:generate` | 仅回环地址、仅模板内参数（不允许自定义任意 workflow 节点） |
| `llm:call` | 走适配层（默认 DeepSeek）+ 预算闸门 |

- 装载第三方资产时**展示完整能力清单与来源**（仓库/commit/license/五维评分），不静默装载。
- 执行沙箱：Node `vm` + `isolated-vm`（重活）或 WASM（纯计算），超时与内存上限硬约束（v1.1 §4.5.3）。
- `installGate.ackRequired` 列出需显式授权的能力，作为 D4 确认的门禁输入。

### 7.2 license 三档守门

| 档位 | 触发条件（研究 #4 §2 实测比例） | 行为 |
|---|---|---|
| **可装载 `loadable`** | 宽松许可：MIT / Apache-2.0 / BSD-3-Clause / CC0-1.0 / Unlicense（样本 78.9%） | 可装载；随包携带许可原文 + 上游署名（`upstream`） |
| **仅看 `view-only`** | `NOASSERTION`（13.3%，**≠无许可**）· 自定义条款 · AGPL-3.0（3.3%）· 无 license（4.4%，默认全保留权利）· 归档仓 | 可浏览与溯源（显示许可原文与守门理由），**不可装载**；`NOASSERTION`/自定义经**人工复核**可改判 `loadable`（复核记录入审计） |
| **禁 `blocked`** | 许可明确禁止再分发/商用 · 下架（yank，§8.2）· 品牌复刻（`brandDerived=true`，商标风险） | **不进市场列表**（或仅显示下架占位）；不可装载、不可进入回流聚合 |

- 比例提醒：**21.1% 的资产不能走自动装载**（研究 #4 §2.2 核心发现），UI 需如实展示、不做乐观默认。
- 工程口径，非法务结论（AGPL 再分发与商标问题留待人工/法务，§9）。

### 7.3 一次性 token 与确认门（受控 AI 三支柱：本地真值 / 受控 AI / 数据飞轮）

1. 装载/更新/卸载 = **提案 → 用户确认 → 单事务写入 → 审计记录**（v1.1 §4.5.4 同构）。
2. dryRun 先出 diff/清单 → 用户批准 → 一次性 `ackToken`（短时效、绑定本次操作）→ 写入；超时失效。
3. 审计字段：调用方（用户/AI/MCP）、资产 id、`source.ref`、`digest`、能力授权清单、结果与前后哈希。

### 7.4 卸载与更新策略

- **装载落点**：`.dfg/market/<kind>/<slug>/`（本地真值、可 Git diff）+ 清单缓存回写（字段集对齐研究 #3 §2.2，去掉本机绝对路径，改相对路径 + `digest`）。
- **卸载**：删目录 + 清单回写（全部可 `git diff` 审阅）；支持批量；「已装载但被引用（场景/文档引用）」需提示。
- **更新**：判定 = `digest` 变化 + 自声明 `version` 变化（双条件，§9）；**本地已改动 → 更新前二次确认**（「更新会覆盖你的修改」，对齐 WorkBuddy `isMarketContentEdited`）；**自动更新默认关**（研究 #3 §3.5）。
- **停用 ≠ 卸载**（研究 #3 §3.5 文档原文同义）：停用仅停止模型调用；卸载彻底移除。

---

## 8. 合规

### 8.1 公开元数据口径

- 只调用 GitHub **公开 REST** 端点（`search/repositories`、`repos/*`、`git/trees`、`contents/*`、`rate_limit`）；只读**公开元数据与描述性文本**（README/SKILL.md/DESIGN.md/清单/frontmatter）。
- **不**访问私有仓、**不**克隆第三方仓库、**不**下载第三方二进制/资产、**不**用 GraphQL 深抓、**不**绕过限流（研究 #4 §7 自述口径）。
- 请求串行 + 声明式工具（`gh`）；`fetched_at` 与 `ref` 全量留痕，供权利人核验。
- 采集产物（blob）默认**仅本地/离线研究**，不随仓库分发（local-first）。

### 8.2 下架通道（yank）

- 触发：权利人请求 / 许可变更 / 违规或风险内容（三来源均记 `yanked.source`）。
- 动作：ADS 卡片置 `yanked{reason, at, source}` → 市场列表隐藏或显示下架说明 → **已装载资产不静默删除**（提示 + 一键卸载）→ 回流聚合剔除。
- 语义借鉴 open-design registry strategy 的 yank/deprecation 与「PR 发布流程」形态（研究 #4 §4.4），字段名自定。

### 8.3 遥测默认仅本地

- 埋点（装载/运行/采纳/放弃 + 耗时节省）**默认只存本地**（SQLite）；用户显式授权后才参与云端聚合（v1.1 §4.4.5）。
- 提供**一键查看原始记录**与**一键删除**；`metrics` 字段（§1.2）在未授权时恒为本地值。
- **首版不实现云聚合**（#10 圈外）；本条款先约束数据形态与默认值。

---

## 9. 未决点（明确列出）

1. **中文生态未采样**（研究 #4 §8.5）：中文技能多不打 topic；首批 40 仓未含中文专项扫描 → 是否在 MK-05 跑通后补 `in:name,description` 中文关键词批次，待定。
2. **`topic:agent-skills`(32,659) vs `agent-skill`(5,273) 差异未复核**（研究 #4 §8.2，疑词干/包含匹配）→ 所有 total_count 按**上界**解读；放量前需复核。
3. **fork/镜像仓未采样**（本机 `fork:true` 缺失，研究 #4 §8.4）→ 同源聚合是否覆盖镜像仓（当前仅 `upstream` + 正文链接 + 目录指纹）。
4. **AGPL 再分发与品牌复刻商标的最终口径**（研究 #4 §8.7）——工程侧按最保守处理（§7.2），法务结论未定。
5. **搜索「1,000 次/时」硬顶未证实**（研究 #4 §8.1）→ 限流以「30/分 + 保守桶」为硬约束；若实测存在小时级硬顶，采集节奏需再调。
6. **向量检索与嵌入模型选型**（bge-m3 或国产）——首版圈外；`asset_embedding` 表结构预留、`embeddingRef` 恒 `null`。
7. **更新比对算法**：WorkBuddy 亦未见版本比较实现（研究 #3 §5.6）；本规格暂定「digest + 声明版本」双条件，实现期（MK-01/MK-05）确认。
8. **`maintenance` 维的增强信号**（issue 响应中位数、提交数）需额外调用预算，v1 是否纳入待 MK-03 决策。
9. **双语展示最终形态**（原文折叠 vs 并列对照，§6.3）——FE-11 联调定稿。
10. **场景清单（9 个 design 场景）的最终中文命名与 id** 需与术语对照表校准程序（页面清单附录 B）对齐。
11. **D6 数据看板的阈值口径**（完整性/一致性/时效性的判红绿线）——随 MK 实现定，本规格只给形态。
12. **`metrics` 指标行在首版（全 0）的展示口径**（隐藏 vs 显示占位）——FE-11 联调决定。

---

## 附录 A：本规格的票面应答对照（#9）

| #9 票面条目 | 本文档章节 |
|---|---|
| 1. 数据模型逐字段定稿 | §1（含版本演进规则 §1.5、digest §1.6） |
| 2. 四类字段与识别规则 | §2（结构探针 + 内容校验 + 反例） |
| 3. 评分口径复核与可解释展示 | §5（权重 .25/.20/.20/.20/.15 + 雷达 + 扣分原因） |
| 4. 页面与交互（含 R2 形态借鉴、双语卡片） | §6（D1–D6 + WorkBuddy 换域表 + §6.3） |
| 5. 装载边界（能力白名单/license/卸载更新） | §7 |
| 6. 产出《技能市场规格 v1》 | 本文档；下游拆票见 `docs/spec/market-first-impl-v1.md` |
| 补充：采集纪律 | §3（研究 #4 实测坑与预算） |
| 补充：四层仓与合规 | §4、§8（含遥测默认仅本地） |

## 附录 B：引用来源

- 研究 #3：`research/workbuddy-market` 分支 `docs/research/2026-10-15-workbuddy-market.md`（§2.2 字段结构、§3.3 详情字段、§3.5 三流程、§4.1–4.4 呈现要求草案与换域表）
- 研究 #4：`research/github-supply` 分支 `docs/research/2026-10-15-github-supply.md`（§1 供给量级、§2 license 分布、§3 采集纪律、§3.4 探针与反例、§5 首批建议、§6 同源聚合）
- 《DesignForge-架构设计说明》v1.1：§4.4（四类/四层/五维/混合检索/飞轮/规模）、§4.5.3（能力白名单）、§4.5.4（dryRun → ackToken → 审计）、§5.3（索引形状）、§7.6（工程质量项）、§12（采集端先独立跑）
- `docs/spec/page-inventory-v1.md` D 区；`docs/spec/acceptance-standard-v1.md` §5/§6；`docs/spec/frontend-impl-spec-v1.md` §三 FE-11；根 `GLOSSARY.md`。
