# 市场首实现跑通报告 · 首批 40 仓判据链（MK-05 / issue #34）

- 日期：2026-10-16（抓取时刻以各批次证据 JSON 的 `asOf` 为准；本报告随批次冻结）
- 分支：`feat/mk-05-cli-runthrough`（基线 `integration/p0`）
- 权威规格：`docs/spec/market-first-impl-v1.md`（六环判据链）· `docs/spec/marketplace-spec-v1.md`（§3 采集纪律 / §4 四层仓 / §7 装载边界）
- 证据根（仓库外，本地优先）：`~/df-evidence/mk-05/`（`batch/` 在线批次 · `replay/` 离线复跑批次 · `work/` 探针与提取脚本）
- 门禁脚本：`scripts/verify-mk-05.mjs`（六环逐环断言，退出码 0/1/2）

## 0. 结论（先读这段）

⟨TBD-结论表⟩

## 1. 运行形态（`df market collect|score|index|search`）

四条子命令落在 `tools/cli/src/market/**`（入口 `tools/cli/bin/df.mjs`，Node 原生 TS 类型擦除直跑，
**不依赖编辑器 / 桌面壳 / daemon**）；数据面 = `<data>/{ods,dwd,dws,ads,evidence}`：

| 子命令 | 职责 | 环 |
|---|---|---|
| `collect` | 采集（真网/重放）→ ODS 规整 → DWD 四表；`--stage raw\|ods\|dwd\|all` | 1–2 |
| `score` | DWD → 五维评分（DWS，含 `explain` 与确定性自证） | 3 |
| `index` | DWS → `df.marketplace.index/v1` + BM25 倒排（ADS，schema 不过即拒写） | 4 |
| `search` | 只读 ADS 产物检索；`--query-set` 跑示例查询集并逐条断言 | 5 |

集成面新增的适配层（本票范围，逐项在 §4 声明）：`dwd-map.ts`（DWD 四表 → 评分输入契约）、
`facets.ts`（DWS 分类面推导）、`ads-join.ts`（DWD 资产 × 评分 × 分类面 → ADS 输入）。

## 2. 阶段 A · 对接面缺口修复（改了什么 / 为何 / 规格依据）

**缺口来源**：MK-03 在真产物上的探针（`~/df-evidence/mk-03/work/mk02-gap.json`）给出 **851 条**
契约问题，全部落在「text 抽取组为空壳」+「`repo.createdAt` / `trend.stars90dAgo` / `trend.referencedBy` /
`files.truncated` 缺失」。修法与复核如下。

### 2.1 采集侧（`services/ingest/src/collect/**`）

| 改动 | 为何 | 规格依据 |
|---|---|---|
| 内容取回优先级重排：仓根 README/CHANGELOG → SKILL.md/DESIGN.md 正文 → 清单族 → tokens → 资产根 README/.mcp.json | 原优先级把清单排在正文前、且**从不取 README / DESIGN.md / .mcp.json** → `text` 组无源可落 | §4.4 `text` 抽取组；§5.2 五维信号源 |
| **完整资产根优先**（根内全部文本文件一次性取回；含二进制/超大文件的根直接跳过） | 规格 §1.6 的 `digest` 需要资产根内**全部文件**的内容 sha256，缺一即 `digest=null`（MK-02 如实标注）→ 卡片 §1.2 `digest` 必填无从落成；而 §8.1 禁下载二进制 → 含非文本文件的根不可能齐备，跳过以免空耗预算 | §1.6 / §8.1 / §1.2 |
| 完整根按**类群份额**装填（plugin / design-system / template / skill / other 均分预算，群内按根规模升序，用不完的份额顺延、余量全群兜底） | 只按规模会一路吃「1 文件小根」，实测 5 仓小跑 design-system 卡片 0 张——市场要四类齐 | §2.1.3 类优先级；§2.1 四类构成 |
| 仓级字段补齐：`repo.createdAt`（冷启动判定）、`stars90dAgo`（星标水位，`stargazers` 二分定位，预算 10 次/仓，取不到 null + 原因码不阻塞） | 冷启动托底与生态维的输入；`createdAt` 缺失会让「新资产」误判 | §5.4 / §5.2 |
| ODS 校验器补 `repo-created-at` / `repo-stars-90d` 规则；证据指标加覆盖度 | 缺口闭合可机器判定（防回归） | §6.1 断言 + 证据 |

### 2.2 规范化侧（`services/ingest/src/transform/**`）

- JSON-01（`transform/dwd/tables.ts`）：
  - `asset` 表新增 `text_frontmatter / text_body / text_readme / text_manifest / text_package_json / text_mcp_json / text_changelog`（规格 §4.4 `text` 组逐列落成，与评分输入契约 `DwdTextView` 同构）；
  - `repo` 表新增 `created_at / stars_90d_ago / referenced_by / tree_truncated / tree_entry_count`。
- JSON-02（`transform/dwd/build.ts`）：README 取「资产根优先、回退仓库根」（§4.4 口径）；
  `referenced_by` = **同批仓中 `upstream` 指向本仓的仓数**（批次内可观测口径，见 §4 裁决 R6）；
  `text.body` 只收 SKILL.md/DESIGN.md 正文，其余类目可为 null（§4.4 注释口径）。
- JSON-03（`transform/parse/frontmatter.ts`）：补 `flat` 平坦键值视图（`text.frontmatter` 的直接来源；
  嵌套映射记 null 不臆造）。

### 2.3 复核（真网 `--limit 5` 小批 + MK-03 探针改装版）

- 探针：`~/df-evidence/mk-05/work/probe-mk05-dwd.mjs`（用**与 CLI 相同的适配层**映射 DWD → 评分输入，
  再跑 MK-03 的校验器）；证据：`~/df-evidence/mk-05/work/mk05-gap-closure.json`。
- 结果：**851 → 0** 条契约问题；`text` 覆盖 860/860（body 44 / readme 860 / manifest 21）；
  `created_at` 5/5；`stars90dAgo` 0/5（原因见 §4 R4，如实留 null + 原因码，不阻塞）。

## 3. 判据链六环（逐环断言与证据）

⟨TBD-六环表⟩

## 4. 漂移与裁决（集成期发现，逐条登记）

| # | 现象（复现） | 裁决 | 依据 |
|---|---|---|---|
| R1 | **MK-04 校验器与其构造器口径不一致**：`toMarketAsset` 把缺失的许可证据写成空串（注释明示「空串表达无证据」），而 `schema.ts` 对 `evidence.sha256` 先 `allowEmpty` 再要求 hex → 空串被拒，真批次必然校验失败 | 不伪造证据：**无许可原文 sha256 的资产不入首版索引**（逐条写 `<data>/dws/_index_excluded.json`）。集成债登记：建议 MK-04 侧把校验器改为「空串合法或与构造器同口径」 | §1.3 / §7.2（仅看资产本该可浏览，但卡片契约缺证据无从表达） |
| R2 | **§1.6（digest 需全部文件内容哈希）× §8.1（禁下载二进制）张力**：含图片/字体的资产根永远无法齐备 → `digest=null` → 不可入索引。open-design 的 153 个 design-system 资产根（24–41 文件，纯文本）在 48 文件预算下也装不下 | 以合规为准（§8.1 优先）：无完整 digest 的资产**保留在 DWD、不入首版索引**并逐条留痕；设计系统类卡片依赖「文本根小」的设计系统仓（下方批次数字）。建议下轮以「文本子集 digest + 二进制清单指纹」修订 §1.6 | §1.6 / §8.1 / §1.2 |
| R3 | MK-03 的 `DwdAsset.text` 组在 MK-02 产物里为空壳（851 条） | 阶段 A 已修（§2）；评分 CLI 由 exit 2 转为 exit 0（866 条输入 0 排除） | §4.4 |
| R4 | **`stargazers` 端点在当前上游返回 404**（`/repos/{o}/{r}/stargazers` 与 `/subscribers` 均 404，`repos/*`、`commits`、`releases` 正常） | `stars90dAgo` 实现保留（二分定位 + 预算 10 次/仓），取不到即 **null + 原因码**入 ODS（`repo.starsHistory`），不阻塞链路；生态维按 MK-03 的「不可得信号不参与加权」处理 | §5.2 / 《市场首实现》§6.1（阻塞语义不滥用） |
| R5 | **种子白名单漂移**：`figma/skills` 已 404（研究 #4 §4.4 名单里的 12 仓之一） | 采集如实记 `skippedRepos: ['figma/skills', 'HTTP 404']`；名单收敛为 11 仓，四类构成不受影响 | §2.1 名单冻结口径（采集时刻冻结 + 如实记录） |
| R6 | `trend.referencedBy` 无现成数据源 | 口径定为**同批仓 upstream 反向计数**（`repo.referenced_by`），随报告声明；批次外引用不可知 → 0 不等于「无引用」 | §5.2（被引用/同源落点数） |
| R7 | `facets`（DWS `asset_facet`）四票无人认领 | 本票在 CLI 侧落成 `facets.ts`（category/lane/mode/tags 确定性推导；`scenes` 留空——9 个场景 id 是 §9.10 未决项，不臆造 id），并在 `dws/asset_facet.jsonl` 留痕 | §1.4 / §4.4 |
| R8 | 层间重复词表（`AssetKind`/`LicenseGate`/`sha256Hex` 等） | 按集成裁决**只登记不重构**（`services/ingest/src/index.ts` 头注释）；本票新增的镜像（`isTextLikePath` ↔ MK-02 `classifyMediaType`）并入同一笔债 | 集成纪律（_shared §2） |
| R9 | `design-system` topic 首条是后端架构书（`donnemartin/system-design-primer`，0 资产） | 与规格 §2.1.1 实测一致：**topic 只作候选、认定靠探针 + 内容校验**；该仓如实进 ODS、产出 0 资产、不进索引 | §2.1.1 |

## 5. 离线复跑（不触网 + digest 比对）

⟨TBD-复跑⟩

## 6. 未决项（不阻塞本票）

1. `stars90dAgo` 的上游可用性（R4）：待上游恢复后重跑即可回填（样本/缓存已留痕）。
2. 设计系统类卡片的覆盖率（R2）：取决于 §1.6 的修订或「文本子集 digest」口径。
3. 索引规模与 `--max-content` 的关系：本批以 48/72 文件每仓跑通；放量（≤300 仓）前需按 §3.1 预算重算。
4. `scenes`（§9.10 场景 id）与 `category` 中文词表的最终校准（术语对照表程序）。
5. 中文生态补充批次（研究 #4 §8.5）是否在下一批并入。

## 7. 证据索引（路径 + sha256）

⟨TBD-证据索引⟩

---

### 附录 A · 批次运行命令（可复跑）

⟨TBD-命令⟩
