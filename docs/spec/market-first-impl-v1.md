# 市场首实现范围与跑通判据 v1（设界 · 寻路图 #10）

- 状态：**v1 定稿**（2026-10-15，#10 收口）
- 上游：issue #10（逐条：首批规模与类别 / 独立跑法 / 跑通判据 / 验收方式 / 产出拆票）、《技能市场规格 v1》（`docs/spec/marketplace-spec-v1.md`）
- 依据材料：
  - 研究 #4 GitHub 供给与采集策略（`research/github-supply` 分支 `docs/research/2026-10-15-github-supply.md`：§2 license 分布、§3 API 纪律、§5 首批规模建议与成本）
  - 《DesignForge-架构设计说明》v1.1 §4.4（采集线）、§7.6（采集工程细节）、§8（P3 里程碑口径）、§12（采集端可先独立跑）
  - `docs/plan/skeleton-and-package-layout-v1.md`（`services/ingest` + `tools/cli` 落点）
- 下游：实现票 **MK-01…MK-05**（`ready-for-agent`，本规格随票拆出）；完成后回写寻路图。
- 本文档性质：**规格（plan, don't do）**——只定范围、判据与验收方式，不含实现代码。

## 1. 结论（先读这段）

首版 **不做全量市场**，只做「**精选 40 仓跑通全链路**」：

1. **形态**：独立可跑的 CLI —— `df market collect|score|index|search`（不依赖编辑器/桌面壳；对应 v1.1 §12.2「采集端可以先独立跑」）。
2. **规模**：首批 **40 仓**（四类各 ≥5；含种子白名单 12），按研究 #4 取证**预计 ≈31 个可装载**。
3. **判据链**：请求纪律证据 → 四类认定（≥31 可装载）→ 评分完整 → index 产出（schema 校验）→ 检索可命中 → 证据 JSON + 离线复跑报告；**六环全绿才算跑通**。
4. **首版圈外**：向量检索 / 增量调度 / 云聚合 / 付费 / 生成线（§5）。
5. **验收**：断言 + 证据文化；退出码 `0/1/2`（通过 / 失败 / 阻塞），**禁止假绿**（§6）。

## 2. 首批范围（逐条答 #10.1、#10.2）

### 2.1 首批 40 仓构成（研究 #4 §5 取证）

| 来源 | 数量 | 选取方式 |
|---|---|---|
| A. topic 发现 | 20 | 8 个 topic（`agent-skill` / `claude-skill` / `ai-skill` / `claude-plugin` / `mcp-server` / `design-system` / `design-tokens` / `html-template`）各取 top-5，`sort=stars` 与 `sort=updated` 双版本合并去重（避免单一偏差），剔除 `awesome-*` 清单仓与明显噪声后取 20 |
| B. 种子白名单上游 | 12 | 研究 #4 §4.4 高集中度上游：`anthropics/skills`、`openai/skills`、`figma/skills`、`greensock/gsap-skills`、`fal-ai-community/skills`、`MiniMax-AI/skills`、`veniceai/skills`、`nexu-io/open-design`、`zarazhangrui/beautiful-html-templates`、`lewislulu/html-ppt-skill`、`nexu-io/html-anything`、`Leonxlnx/taste-skill` |
| C. Design System / Template 补位 | 8 | `design-system` / `design-tokens` / `html-template` 各取 2–3，优先 MIT/Apache，避开清单仓与品牌复刻 |

- **认定对象是「资产」不是「仓」**：40 仓经结构探针产出资产数 ≥ 36（四类各 ≥5：Skill ≥15 / Plugin ≥8 / Design System ≥8 / Template ≥5，研究 #4 §5 外推）。
- **预期守门分布**（按研究 #4 §2 样本比例外推，**推断**）：可装载 ≈31 · 人工复核 ≈5 · 仅看 ≈2 · AGPL 复核 ≈1–2。
- **名单冻结口径**：精确名单在采集时刻（MK-01 首次运行）冻结入库，排序口径（stars / updated 双版本）写进证据 JSON——**排名随时间漂移，报告必须带抓取时刻**。
- **放量节奏**：首批跑通后首月索引 ≤300 仓 + `since` 增量；全量普查（候选 ~10 万含噪声）不做（研究 #4 §5）。

### 2.2 独立可跑形态（#10.2）

- **选 CLI，不做 daemon 优先**：`df market collect|score|index|search` 四条子命令（`tools/cli` 入口，实职在 `services/ingest`），Node 单进程、配置驱动、**不依赖编辑器/桌面壳/daemon**。
- 数据面落 `data/`（四层仓目录，见《技能市场规格 v1》§4）；daemon 集成（FE-11 读 ADS 产物）留待市场前端联调，不在首版判据内。
- 运行前提：`GH_TOKEN`/`gh` 认证（公开只读）；离线复跑模式**不触网**。

## 3. 数据与产物（首版）

| 产物 | 位置 | 说明 |
|---|---|---|
| 四层仓 | `data/ods` → `data/dwd` → `data/dws` → `data/ads` | ODS gzip JSONL / DWD+DWS Parquet / ADS JSON（《技能市场规格 v1》§4） |
| 市场索引 | `data/ads/df.marketplace.index.v1.json` | 契约产物（§1 逐字段）；schema 校验 |
| 检索索引 | `data/ads/market_search_index.v1.json` | BM25 倒排（关键词版） |
| 证据 JSON | `data/evidence/<runId>.json`（提交入库或随报告附） | 字段口径见 §6.2 |
| 跑通报告 | `docs/research/` 新增报告文件 | 判据链逐项结论 + 证据索引 + 差异说明 |

## 4. 跑通判据链（#10.3，六环全绿）

| # | 环 | 断言（可机器判定） | 证据 |
|---|---|---|---|
| 1 | **请求纪律证据** | 全程串行（并发度 = 1）；`gh api` 调用一律 `--method GET`（无 POST 误用）；search ≤ 24/分、core ≤ 4,000/时；退避/失败全部记录且无越限封禁迹象 | 调用计数、限流余量（起始/结束）、304 命中数、`dead_letter` 清单 |
| 2 | **四类认定 ≥31 可装载** | 四类各 ≥5；`installGate.mode=loadable` 资产数 **≥31**；每条认定可复现（Trees 路径 + 内容校验结论） | 认定表（asset id → kind → 探针命中 → 校验结论） |
| 3 | **评分完整** | 每个入库资产五维齐 + `explain` 非空（无 NaN/缺失，完整性 100%）；同一输入两次评分**逐字节一致**（确定性） | 评分快照 + 边界用例（无 license / NOASSERTION / 新资产托底 / 归档仓） |
| 4 | **index 产出（schema 校验）** | `df.marketplace.index/v1` 通过 schema 校验（必填/枚举/digest 格式/`counts` 自洽）；`blocked` 资产不出现 | 校验器退出码 + 索引文件 sha256 |
| 5 | **检索可命中** | 示例查询集 **≥10 条**逐条执行；每条 ≥1 结果、**≥5 条查询给出 ≥3 结果**；排序 = 质量分 × 相关度（可解释）；**P95 基线记录入库**（首版不设硬门槛；远期口径见 v1.1 P3「P95 <300ms」） | 查询集结果快照 + 耗时分布 |
| 6 | **证据 JSON + 离线复跑报告** | 复跑（`--replay` 离线样本集，不触网）产出与首跑**digest 一致**（或列出逐条差异与原因）；证据 JSON 全字段齐 | 复跑报告 + 两次证据 JSON |

- 判据链的箭头关系与 #10 票面一致：**请求纪律 → 认定 → 评分 → index → 检索 → 证据/复跑**；任一环失败即整体不通过（不做「部分通过」）。
- 判据链同时是 **MK-05 的验收脚本**（一条命令跑完并给退出码）。

## 5. 首版不做（#10 圈外，明确）

| 项 | 归属 |
|---|---|
| 向量检索 / HNSW / embedding（bge-m3 等） | v2（`asset_embedding` 表与 `embeddingRef` 字段预留） |
| 增量调度（cron/daemon 化）与热更新 | 首批后（`since` + ETag 能力在 MK-01 内建，**调度**不做） |
| 云聚合（遥测上云）与多端同步 | 不做（本地优先；遥测默认仅本地） |
| 付费 / 商业化 | 不做（研究 #3 §4.2：最多保留赞助外链，v1 不做） |
| 生成线（ComfyUI 出图资产的采集与分发） | 不做（v1.1 §7.7「模板即资产」留待后续） |
| 全量普查、深度分页穷举 | 不做（研究 #4 §1.2/§5） |
| 市场前端 UI（D1–D6） | FE-11 承载（消费本实现产物） |

## 6. 验收方式（#10.4）

### 6.1 文化：断言 + 证据，禁止假绿

- 每个「判据」= 一段**可自动断言**的检查 + 一件**可复核的证据**（文件 + 哈希）；结论不接受口述。
- **退出码语义**（全链路与各子命令统一）：
  - `0` = 判据成立（全部断言通过）；
  - `1` = 判据不成立（有数据、断言失败——是真失败）；
  - `2` = **阻塞**（无数据 / 无网络 / 依赖不可用 / 样本集缺失 / 未到可判定状态）——必须以 `2` 明确阻塞，**不得以空数据或近似结果冒充通过**。
- 无参照集/无数据时以 `exitCode=2` 上报并写明阻塞原因（沿用前端验收标准 §4 的证据文化）。

### 6.2 证据 JSON（字段口径承《前端验收标准 v1》§4 同族）

```
{
  "schema": "df.market.evidence/v1",
  "runId": "20261015-2201",
  "asOf": "2026-10-15T22:40:00Z",          // 抓取时刻（排名冻结依据）
  "offline": false,                         // true = 离线复跑
  "steps": [{
    "id": "request-discipline", "name": "请求纪律",
    "verdict": "pass | fail | blocked",
    "assertions": [{ "name": "...", "expected": "...", "actual": "...", "ok": true }],
    "artifacts": [{ "path": "data/...", "sha256": "...", "length": 12345 }],
    "metrics": { "coreCalls": 168, "searchCalls": 14, "cacheHits304": 92, "p95Ms": 12 }
  }],
  "exitCode": 0
}
```

- 每个 step 对应判据链一环；`verdict=blocked` 时 `exitCode` 必须为 2。
- 报告（`docs/research/`）= 判据链逐环结论 + 证据索引（文件路径 + sha256）+ 偏离与未决项说明。

## 7. 实现票拆分（#10.5）

| 票 | 范围 | 依赖 |
|---|---|---|
| **MK-01** | 采集器：候选发现 + 结构探针 + 内容校验 + 请求纪律 | 工程骨架落地（#12） |
| **MK-02** | 规范化与四层仓落盘（ODS → DWD） | MK-01 |
| **MK-03** | 五维评分（DWS） | MK-02 |
| **MK-04** | 索引与检索首版（ADS） | MK-03 |
| **MK-05** | CLI 与首批 40 仓跑通（判据链 + 报告） | MK-01…MK-04 |

- 依赖以 GitHub 原生 issue dependencies 表达（blocked_by）；每票正文末尾附「工程纪律（企业标准 · 全票通用）」页脚。
- 各票的接口口径全部引用《技能市场规格 v1》（§1 字段 / §2 识别 / §3 采集纪律 / §4 四层仓 / §5 评分）；冲突时以规格为准。

## 8. 未决点（随 MK 实现裁决，不在批内阻塞）

1. `maintenance` 维增强信号（issue 响应中位数、提交数）是否纳入 v1——取决于额外调用预算（MK-03 裁）。
2. 更新比对算法（`digest` + 声明版本双条件）在实现期确认（MK-01/MK-05）。
3. 检索 P95 的硬门槛数值（首版只记基线；放量后再定）。
4. 首批 40 仓的精确名单与抓取时刻（MK-01 首跑冻结，写进证据 JSON）。
5. 中文生态补充批次（研究 #4 §8.5）是否并入 MK-05 报告后的增量。
6. 离线样本集的规模与存放（`data/ods` 快照复用 vs 另行冻结小样本）——MK-05 定，原则是**可离线复跑且体积可控**。

---

## 附录：票面应答对照（#10）

| #10 票面条目 | 本文档章节 |
|---|---|
| 1. 首批规模与类别（精选小批优先跑通） | §2.1（40 仓：四类各 ≥5 + 种子白名单 12，预计 ≈31 可装载） |
| 2. 独立跑法（CLI vs daemon） | §2.2（CLI `df market collect\|score\|index\|search`） |
| 3. 跑通判据（含 P95 目标、卡片产出、离线复跑） | §4（六环判据链；P95 基线口径） |
| 4. 验收方式（断言 + 证据、门禁） | §6（退出码 0/1/2、证据 JSON、报告） |
| 5. 产出：拆成 ready-for-agent 实现票 | §7（MK-01…MK-05 已开） |
| 补充：首版圈外 | §5 |
