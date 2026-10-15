# 市场首实现跑通报告 · 首批 40 仓判据链（MK-05 / issue #34）

- 日期：2026-10-16（抓取时刻以各批次证据 JSON 的 `asOf` 为准；本报告随批次冻结）
- 分支：`feat/mk-05-cli-runthrough`（基线 `integration/p0`）
- 权威规格：`docs/spec/market-first-impl-v1.md`（六环判据链）· `docs/spec/marketplace-spec-v1.md`（§3 采集纪律 / §4 四层仓 / §7 装载边界）
- 证据根（仓库外、本地优先）：`~/df-evidence/mk-05/`
  （`batch/` 在线批次 · `replay/` 离线复跑批次 · `work/` 探针与数字提取脚本 · `phase-a4/` 阶段 A 小批复核）
- 门禁脚本：`scripts/verify-mk-05.mjs`（六环逐环断言 + 证据 JSON，退出码 0/1/2）

## 0. 结论（先读这段）

**判据链六环全绿（`node scripts/verify-mk-05.mjs` → exit 0）**，真实批次数字：

| # | 环 | 结论 | 关键数字 |
|---|---|---|---|
| 1 | 请求纪律 | ✅ pass | 事件 2068 条：GET-only 0 违规、串行 0 重叠、core 1950（≤4000/时）、search 16（≤24/分）、304 命中 102、死信 0；配额余量 4257 → 4806（起始/结束留痕） |
| 2 | 四类认定 | ✅ pass | **42 仓**（40 仓目标达成）；四类：Skill 1044 / Plugin 124 / Design System 153 / Template 175（各 ≥5）；**可装载 1135 ≥31**；1496/1496 条认定带探针 + 内容校验结论（可复现） |
| 3 | 评分完整 | ✅ pass | DWS 1496 条全过校验（总分与五维互证）、无 NaN、五维 `explain` 非空、输入 1496 + 排除 0 = DWD 1496（可对账）、同输入重算逐字节一致；空心 26 处（均冷启动，如实记录） |
| 4 | index 产出 | ✅ pass | `df.marketplace.index/v1` 严格校验 **0 错误 0 警告**；**344 卡片**（loadable 298）；blocked 0；`counts` 自洽；检索索引（BM25 倒排）产出 |
| 5 | 检索可命中 | ✅ pass | 15 条示例查询全部达标（每条 ≥1 命中，含来源仓语义期望）；**15 条给出 ≥3 结果（口径要求 ≥5）**；P95 = 0.68ms（基线，首版不设硬门槛） |
| 6 | 证据 + 离线复跑 | ✅ pass | `--replay` 全批复跑（**不触网**）：DWD 四表 / DWS 质量行 / ADS 索引 **digest 逐层一致** |

- 事实边界（不粉饰）：卡片四类分布 = Skill 288 / Plugin 21 / Template 35 / **Design System 0**；1152 个已认定资产未入索引，原因逐条留痕（§4 R1/R2）。
- 结论：**六环判据链在真实数据上跑通**；「设计系统无卡片」「上游 stargazers 404」「白名单 figma/skills 已消失」等 9 项均已登记（§4）。

## 1. 运行形态（`df market collect|score|index|search`）

四条子命令落在 `tools/cli/src/market/**`（入口 `tools/cli/bin/df.mjs`，Node 原生 TS 类型擦除直跑，
**不依赖编辑器 / 桌面壳 / daemon**，前提仅 `gh auth token` 或 `GH_TOKEN`）；数据面 = `<data>/{ods,dwd,dws,ads,evidence}`。

| 子命令 | 职责 | 环 |
|---|---|---|
| `collect` | 采集（真网/重放）→ ODS 规整 → DWD 四表；`--stage raw\|ods\|dwd\|all` | 1–2 |
| `score` | DWD → 五维评分（DWS，含 `explain` 与确定性自证） | 3 |
| `index` | DWS → `df.marketplace.index/v1` + BM25 倒排（ADS；schema 不过即拒写、退出码 1） | 4 |
| `search` | 只读 ADS 产物检索；`--query-set` 跑示例查询集并逐条断言 | 5 |

集成面由本票新增的三块适配层（`tools/cli/src/market/`）：`dwd-map.ts`（DWD 四表 → 评分输入契约）、
`facets.ts`（DWS 分类面推导）、`ads-join.ts`（DWD 资产 × 评分 × 分类面 → ADS 输入契约）。

## 2. 阶段 A · 对接面缺口修复（改了什么 / 为何 / 规格依据）

**缺口来源**：MK-03 在真产物上的探针（`~/df-evidence/mk-03/work/mk02-gap.json`）给出 **851 条**契约问题，
全部落在「`text` 抽取组为空壳」+「`repo.createdAt` / `trend.stars90dAgo` / `trend.referencedBy` / `files.truncated` 缺失」。

### 2.1 采集侧（`services/ingest/src/collect/**`）

| 改动 | 为何 | 规格依据 |
|---|---|---|
| 内容取回优先级重排：仓根 README/CHANGELOG → SKILL.md/DESIGN.md 正文 → 清单族 → tokens → 资产根 README/.mcp.json | 原优先级把清单排在正文前，且**从不取 README / DESIGN.md / .mcp.json** → `text` 组无源可落 | §4.4 `text` 抽取组；§5.2 五维信号源 |
| **完整资产根优先**（根内全部文本文件一次性取回；含二进制/超大文件的根直接跳过） | §1.6 的 `digest` 需资产根内**全部文件**的内容 sha256，缺一即 `digest=null`（MK-02 如实标注）→ 卡片 §1.2 `digest` 必填无从落成；§8.1 禁下载二进制 → 含非文本文件的根不可能齐备，跳过以免空耗预算 | §1.6 / §8.1 / §1.2 |
| 完整根按**类群份额**装填（plugin / design-system / template / skill / other 均分预算；每群份额 ≥ 本群最小根规模、≤ 预算一半；群内按根规模升序；用不完顺延、余量兜底） | 只按规模会一路吃「1 文件小根」——实测 5 仓小跑 design-system 卡片 0 张；份额下限则保证大根类群（设计系统常见 24–41 文件根）在小预算下也能出卡片 | §2.1.3 类优先级；§2.1 四类构成 |
| 仓级字段补齐：`repo.createdAt`（冷启动判定）；`stars90dAgo`（`stargazers` 二分定位，90 天窗口、预算 10 次/仓，取不到 null + 原因码不阻塞） | 冷启动托底与生态维的输入；`createdAt` 缺失会让「新资产」误判 | §5.4 / §5.2 |
| **重放的内容名单以样本为准**（`selectionsFromRecorded`：从样本 `contents` URL 反解每仓取回名单） | 离线复跑要「URL 逐条命中样本」，而取回算法会随版本演进；样本已记录逐条 URL，反解即可让复跑复现**那次真实采集**、与算法版本解耦（实测踩过：批次后修订策略 → 复跑 12 仓缺样本） | §4.3.4（离线复跑） |
| ODS 校验器补 `repo-created-at` / `repo-stars-90d` 规则；证据指标加覆盖度 | 缺口闭合可机器判定（防回归） | §6.1 断言 + 证据 |

### 2.2 规范化侧（`services/ingest/src/transform/**`）

- `asset` 表新增 `text_frontmatter / text_body / text_readme / text_manifest / text_package_json / text_mcp_json / text_changelog`（§4.4 `text` 组逐列落成，与评分输入契约 `DwdTextView` 同构）；
- `repo` 表新增 `created_at / stars_90d_ago / referenced_by / tree_truncated / tree_entry_count`；
- README 取「资产根优先、回退仓库根」（§4.4）；`text.body` 只收 SKILL.md/DESIGN.md 正文；`frontmatter` 补平坦键值视图（嵌套记 null 不臆造）；
- **快照事实补全合并写回**：同 `(repoId, commit)` 的内容 sha256 由 null 补齐 → 合并写回并记 `snapshot-enriched`（非冲突）；非空哈希改值/文件增删仍按 `snapshot-conflict` 不覆盖（只追加纪律不破）；
- **gz 事件源按字节解压再重压**：materialize 原先把上一轮写出的 `.jsonl.gz` 当 UTF-8 读 → 乱码 → 同 runId 事件文件假冲突（多批采集时 CLI 误报 exit 1）。

### 2.3 复核（真网 `--limit 5` 小批 + MK-03 探针改装版）

- 探针：`~/df-evidence/mk-05/work/probe-mk05-dwd.mjs`（用**与 CLI 相同的适配层**把 DWD 映射为评分输入，再跑 MK-03 校验器）；证据 `work/mk05-gap-closure.json`、原始批次 `phase-a4/`。
- 结果：**851 → 0** 条契约问题；`text` 覆盖 860/860（body 44 / readme 860 / manifest 21）；`created_at` 5/5；
  `stars90dAgo` 0/5（原因见 R4，如实 null + 原因码，不阻塞）；评分 CLI 由 exit 2 转为 **exit 0**（860 条输入 0 排除）。

## 3. 判据链六环（逐环断言与证据）

以上 §0 的表即逐环结论；证据文件与哈希：

| 环 | 证据文件（`~/df-evidence/mk-05/`） | sha256（前 16） |
|---|---|---|
| 1 | `batch/data/ods/raw_events/date=2026-10-15/*.jsonl` + `batch/data/evidence/<runId>.json`（5 批） | 见 `verify-mk-05.evidence.json` artifacts |
| 2 | `batch/data/dwd/{repo,asset,asset_file,license}.parquet` + `_dwd_manifest.json` | `3c26ec0c60ddb…`（清单） |
| 3 | `batch/data/dws/asset_quality.jsonl` + `_dws_manifest.json` | `82c831187d5f4…` / 4208296 B |
| 4 | `batch/data/ads/df.marketplace.index.v1.json` / `market_search_index.v1.json` / `dws/_index_excluded.json` | `8c8d2ce3cf500…` / `3b3153936d110…` / `43eafae3760c7…` |
| 5 | `verify-mk-05.evidence.json` → `search.metrics`（15 条查询逐条结果 + P95） | `verify-mk-05.evidence.json` |
| 6 | `replay/data/**`（复跑批次） + `verify-mk-05.evidence.json` → `replay.metrics`（逐层 digest） | 在线/复跑逐层一致 |

汇总证据：`~/df-evidence/mk-05/verify-mk-05.evidence.json`（`df.market.evidence/v1`，`exitCode: 0`）。
批次构成（逐批清单，抓取时刻见各批证据）：P1 种子白名单 12（其中 `figma/skills` 404 → 实收 11）、
P2 design-system/design-tokens/html-template 12（DS 主干与模板补位）、P3 claude-plugin/mcp-server 10、
P4 agent-skill/claude-skill/ai-skill 10、P5 设计系统主仓补跑 1（`nexu-io/open-design`，`--max-content 240`）。
去重后 **42 仓**（`Leonxlnx/taste-skill`、`nexu-io/open-design` 被两批召回）。

## 4. 漂移与裁决（集成期发现，逐条登记）

| # | 现象（复现） | 裁决 | 依据 |
|---|---|---|---|
| R1 | **§1.6（digest 需全部文件内容哈希）× §8.1（禁下载二进制）张力**：含图片/字体的资产根永远无法齐备 → `digest=null` → 不可入索引。本批 1074 条（含 open-design 的设计系统与模板根）因此未入索引 | 以合规为准（§8.1 优先）：无完整 digest 的资产**保留在 DWD、不入首版索引**并逐条留痕（`dws/_index_excluded.json`）。建议下轮以「文本子集 digest + 二进制清单指纹（路径+git sha+size）」修订 §1.6 | §1.6 / §8.1 / §1.2 |
| R2 | **MK-04 校验器与其构造器对空许可证据口径不一致**：`toMarketAsset` 把缺失证据写成空串（注释明示），而 `schema.ts` 先 `allowEmpty` 再要求 hex → 空串被拒 | 不伪造证据：**无许可原文 sha256 的资产不入首版索引**（本批 78 条，如 `anthropics/skills` 仓无 LICENSE 文件）。集成债：建议 MK-04 侧统一口径（空串合法或构造器改判） | §1.3 / §7.2 |
| R3 | 设计系统资产根 24–41 文件（open-design 153 个）；且同仓存在 150 个「探针命中但内容校验不通过」的 2 文件伪根（`plugins/_official/design-systems/*`）在取回顺序中排在真根之前 → 本批设计系统卡片 0 张 | 如实报告 + 明确改进方向：**内容校验前置**（把 MK-01 `validate.ts` 的 token/清单形态判定引入选择阶段，或对伪根做深度/命名模式过滤）；本轮未修，避免把「选择策略」做成一堆启发式 | §2.4（内容校验是认定的必要一步）|
| R4 | **`stargazers` 端点在当前上游返回 404**（`/repos/{o}/{r}/stargazers`、`/subscribers` 均 404；`repos/*`、`commits`、`releases` 正常）。全批 attempts=44，成功 16（小仓/单页即定位），其余 null | `stars90dAgo` 实现保留（二分定位 + 预算 10 次/仓），取不到即 **null + 原因码**入 ODS（`repo.starsHistory`），不阻塞；生态维按 MK-03「不可得信号不参与加权」处理 | §5.2 / 《市场首实现》§6.1 |
| R5 | **种子白名单漂移**：`figma/skills` 已 404（研究 #4 §4.4 名单之一） | 采集如实记 `skippedRepos: ['figma/skills', 'HTTP 404']`；名单收敛为 11，四类构成不受影响 | §2.1 名单冻结口径（抓取时刻冻结 + 如实记录） |
| R6 | `trend.referencedBy` 无现成数据源 | 口径 = **同批仓 upstream 反向计数**（`repo.referenced_by`），批次内可观测；批次外引用不可知 → 0 ≠「无引用」 | §5.2（被引用/同源落点数） |
| R7 | `facets`（DWS `asset_facet`）四票无人认领 | 本票在 CLI 侧落成 `facets.ts`（category/lane/mode/tags 确定性推导；`scenes` 留空——9 个场景 id 是 §9.10 未决项，不臆造 id），并在 `dws/asset_facet.jsonl` 留痕 | §1.4 / §4.4 |
| R8 | 层间重复词表（`AssetKind`/`LicenseGate`/`sha256Hex` 等） | 按集成裁决**只登记不重构**（`services/ingest/src/index.ts` 头注释）；本票新增镜像（`isTextLikePath` ↔ MK-02 `classifyMediaType`）并入同一笔债 | 集成纪律（`_shared` §2） |
| R9 | `design-system` topic 首条是后端架构书（`donnemartin/system-design-primer`，0 资产）；`.../updated` 版本还会召回 0★ 噪声仓 | 与规格 §2.1.1 实测一致：**topic 只作候选、认定靠探针 + 内容校验**；噪声仓如实进 ODS、产出 0 资产、不进索引（约占 6/44 采集名额——首版如实记录，建议放量前加噪声过滤规则） | §2.1.1 |
| R10 | 多批采集时 `ods-normalize` 段报 1 条阻断性问题（`snapshot-conflict`），P2–P4 的 CLI `collect` 因此 exit 1 | 根因 = 同 `(repoId, commit)` 在后续批次取回了更多正文（事实补全）+ gz 源读乱码 → 已修（§2.2 后两条）；批次数据已在修复后重跑 `ods`/`dwd` 归一（`cli-*-ods/dwd.json` exit 0），DWD/评分/索引不受影响 | §4.3.1 幂等键 / §4.3.2 确定性 |
| R11 | 卡片 `quality` 契约无「空心」表达（五维为数字），与 DWS 的 `dim: null`（§5.3 雷达空心）不同构 | 集成裁决：DWS 记录保留 null 与空心说明；**卡片按 §5.1 用折 0 后的五维重算总分**（自洽，与 MK-04 校验器互证一致），空心说明进卡片 `reasons`。首版 26 处（全为冷启动记录） | §1.2 / §5.3 / §5.1 |

## 5. 离线复跑（不触网 + digest 比对）

复跑批次：`~/df-evidence/mk-05/replay/`（逐条命令见附录 A；**不含任何网络请求**）。

| 层 | 在线 | 复跑 | 结论 |
|---|---|---|---|
| DWD `repo.parquet` | `sha256:d3e5c4159b96…` | 同 | ✅ 一致 |
| DWD `asset.parquet` | `sha256:f485483bc381…` | 同 | ✅ 一致 |
| DWD `asset_file.parquet` | `sha256:0ba26903a5af…` | 同 | ✅ 一致 |
| DWD `license.parquet` | `sha256:5055241abc15…` | 同 | ✅ 一致 |
| DWS `asset_quality.jsonl` | `sha256:82c831187d5f…` | 同 | ✅ 一致 |
| ADS `df.marketplace.index.v1.json` | `sha256:8c8d2ce3cf50…` | 同 | ✅ 一致 |

- 已知差异（预期内、不影响逐层 digest）：`raw_events` 的时间戳/时长（复跑用冻结时钟）与快照 `apiQuotaLeft`
  （复跑无配额响应头）——DWD 之上不读取这两处（`raw_snapshots.record` 逐字段一致）。
- 复跑纪律已加固（§2.1 最后一行）：内容名单取自样本，算法演进不再破坏复现能力。

## 6. 未决项（不阻塞本票）

1. 设计系统卡片覆盖率（R1/R3）：取决于 §1.6 修订（文本子集 digest）与「内容校验前置」的选择策略改造。
2. 索引规模与预算：本批 `--max-content` 48/72/240（按仓）跑通；放量（首月 ≤300 仓）前按 §3.1 预算重算（本批 1950 core 调用 / 42 仓 ≈ 46 次/仓）。
3. `stars90dAgo` 的上游可用性（R4）：上游恢复后补跑即可回填（`--stars-history` 已内建）。
4. `scenes`（§9.10 场景 id）与 `category` 中文词表的最终校准；`facets` 的关键词规则表随批次评审演进。
5. 卡片摘要（§1.2 ≤80 字）在数据层已截断，`description` 保留长文原文——详情页「概述」的呈现形态待 FE-11 联调。
6. 中文生态补充批次（研究 #4 §8.5）是否在下一批并入。

## 7. 证据索引（路径 + sha256）

- 汇总证据：`~/df-evidence/mk-05/verify-mk-05.evidence.json`（六环 + 逐环 artifacts 哈希，`exitCode: 0`）
- 阶段 A 探针：`~/df-evidence/mk-05/work/mk05-gap-closure.json`（851 → 0 对照）
- 批次数字提取：`~/df-evidence/mk-05/work/numbers.json`（各批/各层数字，随本报告口径）
- 索引与排除清单：`batch/data/ads/*.json`、`batch/data/dws/_index_excluded.json`
- 逐批证据：`batch/data/evidence/{<runId>.json（MK-01 采集）, cli-<runId>-{ods,dwd,all}.json, score-*.json, index-*.json}`

---

### 附录 A · 批次运行命令（可复跑）

```bash
# 阶段 A 小批复核（真网 5 仓，含探针）
node tools/cli/bin/df.mjs market collect --data ~/df-evidence/mk-05/phase-a4/data --limit 5 \
  --seeds anthropics/skills,nexu-io/open-design,lewislulu/html-ppt-skill,zarazhangrui/beautiful-html-templates,Leonxlnx/taste-skill \
  --topics none --max-content 48 --stars-history
MK05_DWD_DIR=~/df-evidence/mk-05/phase-a4/data/dwd node ~/df-evidence/mk-05/work/probe-mk05-dwd.mjs

# 首批 40 仓批次（≈45 分钟；逐批参数见 ~/df-evidence/mk-05/run-batch.sh）
bash ~/df-evidence/mk-05/run-batch.sh
node tools/cli/bin/df.mjs market score --data ~/df-evidence/mk-05/batch/data
node tools/cli/bin/df.mjs market index --data ~/df-evidence/mk-05/batch/data

# 离线复跑（不触网；逐条命令见 ~/df-evidence/mk-05/run-replay.sh）
bash ~/df-evidence/mk-05/run-replay.sh

# 判据链门禁（六环；可 --skip-tests 跳过 vitest）
node scripts/verify-mk-05.mjs --data ~/df-evidence/mk-05/batch/data \
  --replay-data ~/df-evidence/mk-05/replay/data --out ~/df-evidence/mk-05

# 检索抽查
node tools/cli/bin/df.mjs market search --data ~/df-evidence/mk-05/batch/data --query-set
node tools/cli/bin/df.mjs market search --data ~/df-evidence/mk-05/batch/data --q "幻灯片模板" --limit 5
```

---

### 附录 B · 收尾门禁（合并 `integration/p0` 后）

- `pnpm -r lint` ✅ 全绿（10 个 workspace 包）
- `pnpm -r typecheck` ✅ 全绿
- `pnpm -r test` ✅ 全绿：ingest 524 · cli 17 · engine 208 · ui 97 · web 1066 · daemon 84 · desktop 56 · comfy 1（合计 2053）
- `node scripts/verify-mk-05.mjs --data … --replay-data …` ✅ **exit 0**（含包内 vitest 环）
- 已知阻塞（**非本票引入**，来自集成分支既有提交）：`pnpm run lint:scripts` 在
  `scripts/verify-canvas.mjs`（FE-06，提交 b9abf9a）与 `scripts/verify-market.mjs`（FE-11）上报
  biome 格式/`useTemplate` 等问题——按其归属票收口（本票不改他人的门禁脚本）。
