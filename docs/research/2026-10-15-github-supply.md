# GitHub 四类资产供给与采集策略（票 #4）

- 日期：2026-10-15
- 执行：寻路地图研究子代理（无人值守，票面 #4）
- 采样时刻：2026-10-15 22:31–22:36（WSL 本机时钟；`pushed_at` 为 UTC）
- 范围：GitHub 公开仓库元数据与描述性文本（REST API），本地离线种子盘点
- 合规：只读公开元数据；不抓取非公开内容；未克隆任何第三方仓库、未下载第三方代码
- 证据落盘：原料 JSON 在 `/home/QIU/df-research/github-supply/.sample/`（本机未入库），种子解包在 `/home/QIU/df-research/github-supply-seed/open-design-main/`

---

## 0. 结论速览

1. **供给充足但不均**：四类资产用 topic 粗测合计 10 万量级（Skill 类 `agent-skill` 5,273 + `claude-skill` 6,110 + `ai-skill` 1,241；Plugin 类 `mcp-server` 36,687 + `claude-plugin` 2,736 + `ai-plugin` 111；Design System 类 `design-system` 7,958 + `design-tokens` 2,112；Template 类 `tailwind` 23,827 + `html-template` 1,242）。**但 topic 噪声很大**：`design-system` 首条是《System Design Primer》（后端架构书）、池内含 7 条 `awesome-*` 清单仓 → **topic 只能做「候选发现」，不能做「资产认定」**；认定必须靠结构探针（SKILL.md / DESIGN.md / manifest.json 等，见 §5）。
2. **license 守门比例（90 条样本实测）**：宽松许可（MIT/Apache/BSD/CC0/Unlicense）**78.9%**，AGPL **3.3%**，`NOASSERTION`（有 LICENSE 但 GitHub 无法识别）**13.3%**，无 LICENSE **4.4%**。→ 建议守门三态：**可装载**（宽松）/ **人工复核后可装载**（NOASSERTION + 自定义条款）/ **仅可查看**（none + 明确禁再分发）。`NOASSERTION` 占 13.3% 是此前容易漏掉的一档，不能并入「无许可」。
3. **API 纪律（实测 + 官方文档）**：核心 5,000/时、搜索 30/分、代码搜索 10/分（实测值）；条件请求 304 **不计**主限额（官方文档原文）；请求应**串行**而非并发；`retry-after` 优先、其次 `x-ratelimit-reset`、再退避≥60s。**鲜活的坑：`gh api -f` 会默认把 `-f` 变成 POST body，12 次调用全部 404 且照扣核心配额**——必须写 `gh api --method GET`（见 §4.5）。
4. **目录发现可行且有反例**：Trees API `?recursive=1` 一次核心调用可枚举全仓路径（实测 `Manavarya09/design-extract`：2,126 条、`truncated=false`，命中 SKILL.md 25 / DESIGN.md 38 / design-tokens.json 38）。**但纯文件名匹配会误报**：`tokens-studio/figma-plugin` 的 8 个 `tokens.json` 全是 i18n 词表（见 §5）。
5. **本地种子是高价值「协议参照 + 离线语料」，但不能原样上架**：`open-design` v0.23.1（Apache-2.0，`package.json private:true`）实含 **537 个 SKILL.md**（票面写 540，实测 537）、**153 套 design-systems**（每套中位 24 个文件、152/153 带 DESIGN.md）、114 个 design-templates。它自带 marketplace registry + 插件 SPEC（含 `license` 字段、`source: github:owner/repo@ref/path` 寻址、trust 词汇 `official|trusted|restricted`）——**正是设界市场协议的最贴近参照物**；但内部 87 个 LICENSE 来自 47 个上游仓（MIT 转售/署名要求）且 design-systems 多为品牌复刻（Apple/Bugatti/Binance/Raycast…，0 个 LICENSE 文件）→ **只作离线种子与协议样例，装载前须逐条核对 `upstream_license`**。
6. **首批规模建议**：精选 **40 个仓库**跑通全链路（四类各 ≥5，从 8 个 topic 各取 top-5 + 种子 `od.upstream` 里已署名的上游仓 20 个），按本次 license 比例推算约 31 个可自动装载、6-7 个需人工复核、2 个降为「仅可查看」。全量普查不现实：候选池 ~10 万（含噪声），按 1,600 仓/时的串行预算（3 core calls/仓）也要 2–3 天且不留余量 → **首月只索引 ≤300 仓 + 增量**。
7. **重复/同源是真风险，不是理论风险**：同一页样本内 `design-system`∩`design-tokens` 30 条重叠 3 条；`VoltAgent/awesome-design-md` 一条就跨 2 个 topic；**查询默认排除 fork**（本次 90 条池内 fork=0）→ 镜像仓统计必须先补 `fork:true` 能力；种子内单个上游 `zarazhangrui/beautiful-html-templates` 被 68 个 SKILL.md 重复引用，证明「一份上游内容 → N 个落点」是生态常态。
8. **未验证项 5 条**（详见 §8）：搜索是否有「1,000 次/时」硬顶（票面所述，本次未触发）；`topic:agent-skills`=32,659 与 `topic:agent-skill`=5,273 的巨大差异未复核（疑为词干/包含匹配）；代码搜索供给量不可用（见 §8）；未做 `fork:true` 镜像采样；种子 zip 的上游来源为推断。

---

## 1. 供给量级采样

方法：`gh api --method GET search/repositories -f q='topic:<t>' -f per_page=<1|30>`，**共 14 次搜索调用**（预算 ≤20，用掉 70%）。`per_page=30` 的三个 topic 同时充当许可/星标/活跃度样本池（§2）。

### 1.1 total_count 采样表

| 资产类 | topic | total_count | 采样深度 | 说明（噪声观察） |
|---|---|---|---|---|
| Skill | `agent-skill` | **5,273** | 30 条 | 最贴近「技能包」语义，池内质量集中（含多个设计类 skill） |
| Skill | `claude-skill` | **6,110** | 1 条 | 首条 `AgriciDaniel/claude-obsidian`（15.5k★，topics 含 `claude-code-skill`） |
| Skill | `ai-skill` | **1,241** | 1 条 | 名称偏泛，需结构探针过滤 |
| Plugin | `claude-plugin` | **2,736** | 1 条 | 与 Skill 类交叉（topics 常同时挂 agent-skills/claude-plugin） |
| Plugin | `ai-plugin` | **111** | 1 条 | 很小；首条是 awesome 清单仓（`hashgraph-online/awesome-ai-plugins`） |
| Plugin | `mcp-server` | **36,687** | 1 条 | 量大但混入大量 SDK/框架/示例仓，非「可装载插件」 |
| Design System | `design-system` | **7,958** | 30 条 | 噪声最大：首条为 `donnemartin/system-design-primer`（374k★，后端书），另有 UI 库（MUI/Chakra/daisyUI）、`awesome-*` 清单 |
| Design System | `design-tokens` | **2,112** | 30 条 | 噪声中等：含 i18n 词表类误报（见 §5 反例）、外挂工具（theo/diez、figmagic） |
| Template | `tailwind` | **23,827** | 1 条 | 首条 `DavidHDev/react-bits`（组件库，不是模板）——topic 语义漂移明显 |
| Template | `template` | **38,560** | 1 条 | 极泛，首条 `sveltejs/svelte`（编译器）→ 不可用于资产认定 |
| Template | `html-template` | **1,242** | 1 条 | 首条 `ColorlibHQ/gentelella`（后台模板），语义比 `template` 干净得多 |
| Template | `figma-template` | **6** | 1 条 | 几乎空；Figma 侧资产不走这个 topic |
| Skill（异常） | `agent-skills` | **32,659** | 1 条 | 与 `agent-skill` 差 6 倍 → 疑为词干/包含匹配，**未复核，见 §8 缺口 2** |
| Plugin（异常） | `figma-plugin` | **1,006** | 1 条 | 首条 `DouyinFE/semi-design`（设计系统挂了 figma-plugin topic）→ 再次印证 topic ≠ 资产类型 |

**要点**：四类的「真供给」不能取 total_count 之和。建议草案口径：
- Skill 供给 ≈ `topic:agent-skill` + `topic:claude-skill` 去重（≈1.1 万，扣除 awesome/课程/示例仓后**推断**活跃技能包 2–4 千）；
- Plugin 供给 ≈ `topic:claude-plugin`（2,736），`mcp-server` 仅作「工具生态规模」参考；
- Design System 供给 ≈ `topic:design-system`（7,958）∩ 结构探针（DESIGN.md + tokens）→ **推断** 真实「套件」数百级；
- Template 供给 ≈ `topic:html-template`（1,242）为主，`tailwind` 只做样式来源池。

### 1.2 采样偏差声明（重要）

- 搜索 API 默认 `sort=best match`，返回页被高星仓主导：90 条池内**最低星 536、中位 3,651、最高 374,295**。→ 页面样本**不能代表长尾分布**；长尾估算只能用 total_count + 限定符（如 `stars:>10`）另行采样（本次未做，见 §8）。
- 分页上限：搜索结果最多可取 1,000 条（`per_page≤100`），`total_count` 可以大于 1,000 但翻不到 → 采集器必须按「时间窗/限定符切片」而非靠深度分页穷举（**推断自 API 文档常识，本次未翻页验证**，见 §8 缺口 1）。

---

## 2. license 分布（守门依据）

样本池：3 个 topic 各一页 30 条 = **90 条记录 / 86 个唯一仓库**（`design-system` 与 `design-tokens` 页有 3 条重复）。字段取 `license.spdx_id`。

### 2.1 总体分布

| 档位 | 计数 | 占比 | 建议守门动作 |
|---|---|---|---|
| 宽松（MIT/Apache-2.0/BSD-3-Clause/CC0-1.0/Unlicense） | 71 | **78.9%** | 可装载（保留署名/许可文本） |
| `NOASSERTION`（有 LICENSE，但非标准/未被识别） | 12 | **13.3%** | **人工复核**后决定（不能等同无许可，也不可自动装载） |
| 无 license（`license=null`） | 4 | **4.4%** | 仅可查看，不装载（默认全保留权利） |
| 强 copyleft（AGPL-3.0） | 3 | **3.3%** | 复核后谨慎（市场若再分发需评估 AGPL 义务） |

细分：MIT 62（68.9%）、NOASSERTION 12（13.3%）、Apache-2.0 6（6.7%）、none 4（4.4%）、AGPL-3.0 3（3.3%）、BSD-3-Clause / Unlicense / CC0-1.0 各 1。

按 topic 看：
- `agent-skill`（n=30）：MIT 20 · AGPL 3 · NOASSERTION 4 · none 2（**无许可风险最高的一类**）
- `design-system`（n=30）：MIT 20 · NOASSERTION 5 · Apache 4 · none 1
- `design-tokens`（n=30）：MIT 22 · NOASSERTION 3 · Apache 1 · BSD/Unlicense/CC0 各 1 · none 1

### 2.2 结论

- 「无 license → 仅可查看不可装载」的守门**依据成立**，但**必须拆成三档**：`none`（4.4%）、`NOASSERTION`（13.3%）、明确 copyleft（3.3%）——合计 **21.1% 的资产不能走自动装载**。这与「只有 4.4% 有问题」的直觉差 5 倍，是本次最重要的守门发现。
- AGPL 全部出现在 Skill 类 → Skill 市场上的再分发态需要单独策略（只做「引用安装」而非「镜像分发」更安全；**推断**，需法务确认）。
- 样本明细见附录 B。

---

## 3. 采集器参数草案（API 纪律）

### 3.1 限额（实测）

| 资源 | 实测值 | 来源 |
|---|---|---|
| 核心（core） | 5,000/时 | `gh api rate_limit` 实测 `limit=5000` |
| 搜索（search） | 30/分（窗口 60s） | 同上 `limit=30`（认证态） |
| 代码搜索（code_search） | 10/分 | 同上 `limit=10` |
| 搜索「1,000 次/时」 | 未观测到该字段 | 票面所述，本次未触发也未验证 → §8 缺口 1 |

实测消耗（本次研究）：core `used` 15 → 29（含 12 次失败调用），search 14 次，code_search 1 次。**注意：失败的请求也扣配额**。

### 3.2 条件请求（ETag）——可把重复巡检做成近零成本

官方文档原文（GitHub REST "Best practices"）：*"Making a conditional request does not count against your primary rate limit if a `304` response is returned"*，且 *"each `304 Not Modified` response is fast and does not use your rate limit"*。做法：保存响应的 `etag`，下次同 URL 带 `if-none-match`。

草案：
- 每个资源 URL 在本地缓存 `{etag, last_modified, body_digest, fetched_at}`（SQLite 表 `http_cache`）。
- 巡检默认发条件请求；`304` → 只更新 `fetched_at`；`200` → 落库并更新 ETag。
- 只对**不变/少变**资源用 ETag（repo 元数据、`contents/` 文件、Trees）；**列表类端点（search）不建议**（结果集天然漂移）。
- 工具面：`gh api --cache <dur>` 与 `-H 'If-None-Match: ...'` 均可用（gh 2.101.0 实测支持 `--cache duration`、`-H`、`--paginate`、`--slurp`）。
- 注意：条件请求不适用于 POST/PUT/PATCH/DELETE（文档明示）。

### 3.3 令牌桶 + 退避（可实施参数）

```
core    : 容量 4，速率 1 req/s（串行队列），保留 20% 余量（≥1000 调用/时不用）
search  : 容量 2，速率 1 req/2.5s（=24/分 < 30/分）
code_search: 容量 1，速率 1 req/7s；且仅用于单仓钻取，禁用于全局普查
并发     : 1（官方文档："you should make requests serially instead of concurrently"）
分页     : 只按 Link header 走；禁止手拼 page 参数、禁预测 URL 结构（文档明示）
```

退避/失败处理（照官方建议映射为参数）：
| 响应 | 动作 |
|---|---|
| `retry-after: N` | 睡 N 秒再试（最高优先） |
| `x-ratelimit-remaining: 0` | 睡到 `x-ratelimit-reset + 5s` |
| 403/429（无 retry-after） | 先睡 ≥60s；重试用指数退避（1s→2s→4s…±20% 抖动），上限 5 次后落 `dead_letter` |
| 5xx | 指数退避同上，上限 5 次 |
| 401/404 | **不重试**（配置/权限问题），记录并跳过 |
| 连续限速失败 | 停整条流水线（文档警告：持续越限可能导致集成被封禁） |

增量游标（`since`）：
- 基线：一次全量（按 `pushed:` 时间窗切片绕过 1,000 条上限）。
- 增量：`q='topic:agent-skill pushed:>=<上次水位>'`，水位取「上次运行开始时间 − 5 分钟」防边界漏；每仓再以 `repos/{o}/{r}` 的 `pushed_at` 与本地值比对，未变则跳过（配合 ETag）。
- 建议节奏（实测活跃度得出，见 §2.5）：Skill 类**日更**；Design System / Design Tokens 类**周更**（见 §3.6 数据依据）。

### 3.4 目录发现策略（四类资产的结构探针）

```
1) GET repos/{o}/{r}                     -> default_branch, license, pushed_at, fork, archived, size
2) GET repos/{o}/{r}/git/trees/{sha}?recursive=1   -> 全路径清单（1 次 core 调用）
3) 路径匹配（大小写敏感，逐类）
   Skill        : **/SKILL.md  （Claude 技能约定；种子内 537 个均用此名）
   Plugin       : **/.claude-plugin/plugin.json | **/open-design.json | **/.mcp.json
   Design System: **/DESIGN.md 且（**/design-tokens.json | **/tokens.css | **/tailwind-v4.css）
   Template     : **/*.html + （package.json | 模板清单）
4) 语义校验（防误报，必须做）
   tokens 文件：JSON 内需见 DTCG 形态（$value/$type 键）或非空 token 集；含 "i18n"/"langs" 路径的 tokens.json 直接丢弃
   SKILL.md    ：需有 YAML frontmatter 且含 name+description（种子实测 537 个里 530 个有 name/description）
5) truncated=true 时降级：改 contents API 逐目录钻取，或对该仓用 code_search 'repo:o/r filename:SKILL.md'（每次 1 个 code_search 配额）
```

- 实测正例：`Manavarya09/design-extract`（2,126 路径、未截断）一次调用命中 SKILL.md×25、DESIGN.md×38、design-tokens.json×38 → **1 次 core 调用就能完成四类探针**。
- 实测反例：`tokens-studio/figma-plugin`（2,137 路径）命中 `tokens.json`×8，**全部是 i18n 词表**（`src/i18n/lang/en/tokens.json`），且 0 个 DESIGN.md → 纯文件名匹配在本仓 100% 误报。

### 3.5 目录/元数据抓取的最小调用账（估算，**推断**）

| 阶段 | 每仓调用 | 备注 |
|---|---|---|
| 元数据 `repos/{o}/{r}` | 1 | 幂等，第二次起 ETag→304 免费 |
| Trees 递归 | 1 | `truncated` 时 +1~3 |
| Contents 抽样（SKILL.md/manifest 正文） | 1–3 | 只看描述性文本与 frontmatter，不下二进制 |
| 合计 | **3–5** | 按 4,000 可用 core/时（留 20%）→ **≈800–1,300 仓/时**（串行） |

### 3.6 活跃度与「采集频率」依据（90 条池实测）

| topic | 星标中位 | 距上次 push 中位 | 距上次 push 最大值 | 建议巡检频率 |
|---|---|---|---|---|
| `agent-skill` | 2,434 | **3 天** | 105 天 | 日更 |
| `design-system` | 11,153 | 5 天 | 1,384 天 | 周更 |
| `design-tokens` | 1,238 | **56 天** | 2,414 天 | 周更/双周 |

`<=30 天有 push` 的占 61%，`>365 天未 push` 的占 13%（池内 90 条）→ 采集器应有「僵尸仓降权/停跟」规则（如 >540 天未 push 且 <50★ → 停跟）。

### 3.7 本次实测的坑（写进实施备忘）

- **`gh api -f` 默认 POST**：`gh api search/repositories -f q='topic:x'` 会发 POST 到 `/search/repositories` → **404 且照扣核心配额**（本次 12 次全 404，core used 15→27）。正确写法：`gh api --method GET search/repositories -f q='...'`（或查询串直接写进 URL）。
- 本机无 `jq`（解析用 `python3 -c` / `gh --jq`）。做采集器时不要假设宿主有 jq；用 `--jq`（gh 内置）或语言运行时。
- 搜索返回的 `topics` 数组对「资产归类」有参考价值但**不可信为认定**（例：`DouyinFE/semi-design` 同时挂 `design-system` 与 `figma-plugin`）。

---

## 4. 本地种子盘点（`open-design-main.zip`）

解包位置：`/home/QIU/df-research/github-supply-seed/open-design-main/`（314 MB / 15,318 条目；zip 原始 180 MB，mtime 2026-10-04）。

### 4.1 身份与许可

| 项 | 值 |
|---|---|
| 项目名 / 版本 | `open-design` / `0.23.1`（`package.json`） |
| 许可 | **Apache-2.0**（根 `LICENSE` + `package.json.license`） |
| `package.json.private` | `true`（未发布为 npm 包） |
| 上游来源 | **推断**为 GitHub `nexu-io/open-design@main`——证据：registry 条目里的 `source: "github:nexu-io/open-design@main/plugins/_official/atoms/build-test"`、`github:nexu-io/open-design@main/plugins/community/registry-starter`；另 `.claude-plugin/plugin.json` 声明 MCP（stdio）暴露 projects/files/preview |
| 描述 | "Local-first design product: detects your installed code-agent CLI, runs design skills + design systems, streams artifacts into a sandboxed preview." |

**与设界的定位高度重合**（本地优先设计产品 + 技能/设计系统 + 出图预览），可用作**协议与结构参照物**。

### 4.2 SKILL.md 盘点：**537 个**（票面 540，实测 537）

分布（按载体）：

| 位置 | 数量 |
|---|---|
| `plugins/_official/examples` | 182 |
| `skills/*` | 163 |
| `plugins/_official/video-templates` | 23 |
| `plugins/_official/scenarios` | 14 |
| `plugins/_official/atoms` | 13 |
| `plugins/spec/examples` | 12 |
| 其它（community 插件、tools、docs、design-templates、apps…） | 130（多为 1 处 1 个） |

frontmatter 协议字段（出现次数 / 537）：`name` 530、`description` 530、**`od:` 502（自定义命名空间）**、`triggers` 404、`en_name`/`zh_name` 182/181、`tags` 178、`zh_description`/`en_description` 177、`emoji`/`category`/`scenario`/`aspect_hint`/`example_id` 各 49。**7 个 SKILL.md 无 frontmatter**（不合规样本，采集器需能容忍/标记）。

`od:` 子字段示例（对采集器的启发：这是一套「资产元数据」字段）：
```yaml
od:
  mode: design-system        # template | design-system | prototype | ...
  category: marketing-creative
  surface: web               # web | video | ...
  platform: desktop
  upstream: "https://github.com/coreyhaines31/marketingskills"   # ← 溯源字段！
```

规模与语言：SKILL.md 体积中位 **3,609 B**、均值 4,957 B、最大 87,788 B、最小 144 B；**318/537（59%）含中文字符**（双语字段 `zh_*` 是常态）→ 种子天然支持多语言资产；**196/537 在正文提到许可**。

### 4.3 design-systems 盘点：**153 套**（票面 153，实测一致）

每套结构高度一致（文件出现次数/153）：

| 文件 | 出现 |
|---|---|
| `manifest.json` | 152 |
| `DESIGN.md` | 152 |
| `tokens.css` | 152 |
| `components.html` | 152 |
| `USAGE.md` | 151 |
| `components.manifest.json` | 151 |
| `preview/{spacing,typography,colors}.html` | 151 各 |
| `source/evidence.md` | 151 |
| `design-tokens.json` | 150 |
| `tailwind-v4.css` | 150 |
| `system/{kit.html,kit.dark.html,index.html}` | 150 各 |
| `system/artifacts/{landing,deck}.html` | 150 各 |

每套文件数：**中位 24、最大 41**；`DESIGN.md` 覆盖 152/153。`manifest.json` 自带 schema：`schemaVersion: "od-design-system-project/v1"`，字段含 `id/name/category/description/source{type,origin}/files{design,tokens,designTokens,tailwind,components}/usage/componentsManifest/importMode`。

**注意**：`design-systems/` 下 **0 个 LICENSE 文件**，且名称多为品牌/产品（apple、bugatti、binance、raycast、sanity、superhuman、webex…），`source.type` 标为 `bundled`、`origin: "OpenDesign curated bundled fixture"` → **推断**为品牌设计语言的「策展式复刻」（非官方资产）。用于离线种子研究可行；**若进入市场分发，商标与形象风险需单独评估，建议去品牌化或列为不可装载**（合规章节外，非法律意见）。

### 4.4 其它可提取结构

- `design-templates/`：**114 个**目录（每目录文件数中位 2、最大 225），部分含 HTML-PPT 类模板与上游署名。
- `templates/`：2 项（`deck-framework.html`、`kami-deck.html`）。
- `plugins/registry/{official,community}/open-design-marketplace.json`：**自带市场清单格式**（`$schema: .../marketplace.v1.json`、`specVersion`、`trust: official`、条目含 `name/title/version/source( github:owner/repo@ref/path )/publisher/capabilitiesSummary/description/tags/homepage`、官方清单声明 `bundledPreinstallCount: 414`）。
- `plugins/spec/SPEC.md`：插件协议（含 manifest 示例里的 **`license: "MIT"`** 字段、`compat.agentSkills[].path -> ./SKILL.md`、能力白名单 `prompt:inject|fs:read|fs:write|mcp|subprocess|bash|network|connector`）。
- `specs/current/plugin-registry-strategy-plan.md`：**trust 词汇表** `official|trusted|restricted`、安装记录字段（`sourceKind`、`resolvedSource`、`resolvedRef`、`manifestDigest`、`archiveIntegrity`）、yank/deprecation 语义、PR 发布流程 → **对手册/协议层是现成参照**。
- **同源聚合的实证**：`od.upstream` 指向 **47 个不同 GitHub 上游仓**，集中度极高：`zarazhangrui/beautiful-html-templates` 68 次、`lewislulu/html-ppt-skill` 61 次、`nexu-io/html-anything` 48 次、`Leonxlnx/taste-skill` 13、`fal-ai-community/skills` 12、`anthropics/skills` 10、`openai/skills` 9、`greensock/gsap-skills` 9、`figma/skills` 7、`MiniMax-AI/skills` 6、`veniceai/skills` 5。
  → 这 11 个上游仓可直接作为设界**首批采集白名单**（已被上游策展验证过、且署名线索现成）。
- 全仓 LICENSE 文件 87 个（skills 下 20 个），正文多处写 "Vendored from upstream MIT-licensed…" + `upstream_license: MIT` → **种子自身已实践「逐资产许可+上游署名」**，可直接借用为设界的资产生效规则（每个资产记录 `upstream_url` + `upstream_license` + 许可原文随包）。

### 4.5 作「离线种子语料」的可用性结论

| 维度 | 评级 | 说明 |
|---|---|---|
| 协议字段参照 | **★★★★★** | SKILL.md frontmatter（含 od 命名空间）、design-system manifest schema、marketplace.v1.json、插件 SPEC —— 四类资产都有现成 schema 可对齐/裁剪 |
| 结构与规模 | **★★★★★** | 537 skill + 153 设计系统 + 114 模板 + 414 预装插件计数，规模足够做检索/评分/加载压测 |
| 多语言 | **★★★★☆** | zh/en 双字段 177–182 个资产；59% 含中文正文 → 天然中英双语语料 |
| 许可洁净度 | **★★☆☆☆** | 根 Apache-2.0，但内含 47 个上游的 MIT 内容（署名要求）+ 87 个 LICENSE + design-systems 无许可&品牌复刻 → **可做离线研究/协议参照，不可直接作为可分发市场资产** |
| 与在线采集的互补 | 高 | 在线采集拿「元数据 + 结构探针」，种子拿「真实正文 + 完整包结构」→ 可先用种子把加载/渲染/评分链路跑通，再逐步替换为在线资产（**推断**，需产品决策） |

---

## 5. 首批规模建议

**建议：首批 40 仓（可装载候选 ≈31）。** 构成：

| 来源 | 数量 | 选取方式 |
|---|---|---|
| `agent-skill` 等 8 个 topic | 20 | 每 topic top-5（`sort=stars` 与 `sort=updated` 各取一版，避免单一偏差） |
| 种子 `od.upstream` 白名单上游 | 12 | `anthropics/skills`、`openai/skills`、`figma/skills`、`greensock/gsap-skills`、`fal-ai-community/skills`、`MiniMax-AI/skills`、`veniceai/skills`、`nexu-io/open-design`、`zarazhangrui/beautiful-html-templates`、`lewislulu/html-ppt-skill`、`nexu-io/html-anything`、`Leonxlnx/taste-skill` |
| Design System / Template 补位 | 8 | `design-system`/`design-tokens`/`html-template` 各取 2–3（优先 MIT/Apache，避开 awesome 清单与品牌复刻） |

预期分布（按 §2 比例外推，**推断**）：可装载 ≈31、需人工复核 ≈5、仅可查看 ≈2、AGPL 复核 ≈1-2。四类覆盖：Skill ≥15、Plugin ≥8、Design System ≥8、Template ≥5。

**成本**：40 仓 × 3–5 core calls ≈ 120–200 次调用，**一小时限额内可跑 20 遍**——瓶颈不是配额而是审核人力。全量普查（候选 ~10 万含噪声；按结构探针后**推断**真实 2 万级）需 6–10 万次调用 ≈ 1–2 个整天满配，**不建议**；首月建议 ≤300 仓 + `since` 增量。

---

## 6. 近重复与同源聚合风险

1. **跨查询重复**（实测）：`design-system` 页与 `design-tokens` 页 30 条里重叠 3 条（`Shopify/polaris-react-archive`、`VoltAgent/awesome-design-md`、`chakra-ui/panda`）→ 同一仓会被多个 topic 召回，**入库键必须是 repo id（`node_id`/`full_name`）而非查询命中**。
2. **清单仓污染**（实测）：90 条池中 7 条为 `awesome-*` 清单（`VoltAgent/awesome-design-md`、`gztchan/awesome-design`、`klaufel/awesome-design-systems`、`sturobson/Awesome-Design-Tokens`、`LearnPrompt/awesome-seedance`、`Meliwat/awesome-ios-design-md` 等）→ 需单列 `kind=list`，**不参与资产评分**（但可作发现源）。
3. **仓内自重复**（实测）：`Manavarya09/design-extract` 一个仓就有 25 个 SKILL.md，其中 `website/public/gallery/<site>/.claude/skills/designlang/SKILL.md` 是**按站点成批生成的同模板副本** → 采集器必须做仓内去重（同 frontmatter + 正文近同 → 只留最新/最全一份）。
4. **镜像/fork 不可见**（重要缺口）：本次 90 条池内 `fork=0` 条——因为 **GitHub 仓库搜索默认排除 fork**。镜像仓统计必须显式 `fork:true` 另行采样（本次受配额约束未做，见 §8）。
5. **同源聚合的规模（种子实证）**：47 个上游 → 537 个落点（平均 1 上游 : 11 落点），极端如 `beautiful-html-templates` → 68 个 SKILL.md。若设界直接按「文件/仓」计价或排序，会被「一份内容 N 份副本」稀释。→ **建议在采集期就抽 `upstream`/`source` 字段与正文链接，做「同源簇」聚合，市场层以簇为单位排序**。
6. **去重算法参数草案**：
   - **精确**：正文规范化（去 BOM/空白/许可头、代码块可选）后取 SHA-256 → 同 hash 直接合并；
   - **近重复**：Shingle(5-gram, 词级，中英混排按 unicode 分词) + MinHash(128 perm) + LSH(b=16, r=8, 阈值≈0.85)；`SKILL.md` 正文 >5KB 才做（中位 3.6KB，小文本用 SimHash 更划算）；
   - **结构同源**：比对 `od.upstream` / `source` / 正文 GitHub 链接 + 目录指纹（相对路径集合的 Jaccard）→ 抓「同模板批量生成」的仓（如 design-extract 的 gallery 模式）；
   - **阈值**：Jaccard ≥0.9 自动合并、0.7–0.9 人工队列、`upstream` 相同则必进同簇。
7. **商标/形象风险**：topic 名既含技术资产也含品牌复刻（种子内 apple/binance 等；线上 `design-system` 池亦出现 `Shopify/polaris-react-archive`、`vmware-archive/clarity` 等归档/品牌仓）→ 市场需 `kind=brand-derived | original` 标签与「不装载品牌复刻」默认策略（**合规建议，非法律意见**）。

---

## 7. 合规自述（本次研究）

- 只调用公开 REST 端点（`search/repositories`、`search/code`、`rate_limit`、`git/trees`）与 `gh issue view`；未访问私有仓、未使用 GraphQL 深抓、未克隆第三方仓库、未下载第三方代码或资产。
- 本地种子来自用户持有的 zip（不涉及网络抓取）；种子内第三方内容仅做**结构与字段统计**，未在报告内复制其正文。
- 遵守 ToS：串行请求、控制总量（搜索 14 次 ≤20 预算）、不并发、不使用未认证匿名轮换。

---

## 8. 缺口与未验证项

1. **搜索「1,000 次/时」未验证**：实测 `rate_limit.resources.search.limit=30`（60s 窗），未见小时级字段；票面所述 1,000/时 未触发也未证实 → 采集器需自测（建议在隔离配额下压测，或直接以「30/分 + 保守桶」为硬约束）。同理搜索结果 1,000 条上限为文档常识，**本次未翻页验证**。
2. **`topic:agent-skills`=32,659 vs `topic:agent-skill`=5,273 未复核**：怀疑 GitHub topic 匹配存在词干/包含行为（而非精确 topic 等值），但本次只取了 1 条样本，**未复核**。若为真，所有 total_count 都要按「上界」解读。
3. **代码搜索不可用于供给估算**：`filename:SKILL.md` 返回 `total_count=6,299,648`、`incomplete_results=false`——数值不可复核（远大于仓库级常识），且 code_search 只有 10/分。**建议弃用 code search 做全局统计**，仅用于单仓钻取。
4. **未做 `fork:true` 镜像采样**、未做 `stars:>N` 分层采样、未对同一 topic 做 `sort=updated` 采样 → 长尾与镜像规模仍是空白。
5. **中文生态未采样**：中文语境的技能分享多不打 topic（或打 `claude-code-skill` 等混合名），建议补 `in:name,description` 中文关键词扫描（本次未做）。
6. **种子上游来源为推断**（`nexu-io/open-design@main`）：zip 内无 `.git`，未做在线比对；`package.json private:true` 与 registry 里的 `github:nexu-io/...` 是全部线索。
7. **许可合规判断为工程视角**：AGPL 再分发、品牌复刻的商标问题均需法务确认（本报告只给工程守门阈值）。
8. **未验证**：`304` 不计限额（仅官方文档，未实测）；`--cache` 的语义边界（gh 2.101.0 支持但未实测其与 ETag 的配合）。

---

## 附录 A：本次 API 用量（实测）

| 资源 | 限额 | 起始 | 结束 | 本次净用 | 说明 |
|---|---|---|---|---|---|
| core | 5,000/时 | used 15 | used 29 | **14** | 含 12 次失败调用（`gh api -f` 误发 POST）——失败照扣 |
| search | 30/分 | used 0 | used 14（两次窗口合计） | **14** | 12 个 topic + `html-template` + `figma-template`，预算 ≤20 ✅ |
| code_search | 10/分 | used 0 | used 1 | **1** | `filename:SKILL.md`（结论见缺口 3） |

调用清单：`gh issue view 4` ×1；`gh api rate_limit` ×5；`search/repositories` ×14（12 成功 + 12 次 POST 404 未计搜索额度但计核心）；`search/code` ×1；`git/trees/HEAD?recursive=1` ×2。原始响应在 `/home/QIU/df-research/github-supply/.sample/*.json`（含 `pooled_rows.json` 明细）。

## 附录 B:90 条样本明细（license / stars / pushed_at / fork）

见 `.sample/pooled_rows.json`；摘要统计如下（86 唯一仓）：

- 无 license（`none`）：`jangviktor-web/nihaixia`、`Arekejoker/qwen21-nsfw-pose-skill`、`gztchan/awesome-design`、`system-ui/theme-specification`
- AGPL-3.0：`chuspeeism/dashi-ppt-skill`、`op7418/guizang-social-card-skill`、`patrickchugh/terravision`
- `NOASSERTION` 12 条：含 `donnemartin/system-design-primer`、`DouyinFE/semi-design`、`elastic/eui`、`Shopify/polaris-react-archive`、`design-tokens/community-group`、`diez/diez`、`stenciljs/core`、`isjiamu/gzh-design-skill`、`feitangyuan/onetake`、`lyra81604/zhengxi-views`、`reticlehq/reticle`
- fork=0/90（搜索默认排除 fork）· archived=5/90（含 `vmware-archive/clarity`、`Shopify/polaris-react-archive`）
- 活跃度：≤30 天有 push 55 条（61%）；>365 天 12 条（13%）

## 附录 C：复现命令

```bash
# 1) 限额与采样（务必显式 GET，否则 -f 会变 POST → 404 且扣核心配额）
gh api rate_limit -q '{core: .resources.core, search: .resources.search}'
gh api --method GET search/repositories -f q='topic:agent-skill'   -f per_page=30 > agent_skill.json
gh api --method GET search/repositories -f q='topic:claude-skill'  -f per_page=1
gh api --method GET search/repositories -f q='topic:design-system' -f per_page=30 > design_system.json
# 2) 结构探针
gh api "repos/Manavarya09/design-extract/git/trees/HEAD?recursive=1" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('truncated'),len(d['tree']))"
# 3) 种子解包（本机无 unzip，用 python）
python3 -c "import zipfile;zipfile.ZipFile('/mnt/c/Users/22724/Desktop/毕业设计/open-design-main.zip').extractall('/home/QIU/df-research/github-supply-seed')"
find /home/QIU/df-research/github-supply-seed/open-design-main -name 'SKILL.md' | wc -l   # -> 537
```

## 附录 D：来源

- GitHub REST "Best practices for using the REST API"（条件请求 304 不计限额、串行请求、retry-after/x-ratelimit-reset 处理、Link header 分页）：https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api （2026-10-15 取用）
- `gh api` 帮助（本机 gh 2.101.0）：`--method`、`--cache`、`-H`、`--paginate`、`--slurp`
- 实测数据：本文 §1–§3、§6 中标注「实测」的表格与数字，原始 JSON 见附录 A 路径
- 票面 #4：`gh issue view 4 -R QIUZI-HONG/DesignForge`（问卷与验收口径）
