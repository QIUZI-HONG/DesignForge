# 设界 · 全模块机器人回归 → 架构分析 → UX 优化（retro 2026-10-17 · 批次 5 基线）

- **日期**：2026-10-17
- **对象**：`retro/batch5`（基于 `integration/batch5` @ `9a9b917`，含批次 5：市场增量分页、评论 aria 前缀、评论面板）
- **执行角色**：机器人用户（端到端）· 企业架构师（缺陷分析）· 用户体验设计师（界面与交互优化）
- **机器人脚本与证据（仓外，按纪律不入库）**：`~/df-evidence/retro-2026-10-17-batch5/robot-b5.mjs`、`robot-b5.json`、`shots/`、`probe-client-filter.{mjs,json,log}`
- **结论速览**：全模块 **76 项用户级检查首轮 75 通过 / 1 失败**；唯一真实产品缺陷 **DEF-01（客户端过滤 × 分页死路）** 已修复。架构分析另发现潜伏缺陷 **DEF-02（分页游标回退风险）**，UX 评审另发现视觉缺陷 **DEF-03（评论线程深色底不可读）**，均已在同批修复。修复后机器人复跑 **80 项检查全部通过（0 fail）**，`pnpm verify` 2789 用例与 `e2e:smoke` 76/76 步全绿。

---

## 阶段 1 · 机器人全模块回归（目标 / 输出 / 验证）

### 1.1 目标

用脚本模拟真实用户，覆盖全部功能域：首页、编辑器壳、画布与主路径、图层/资产、Inspector、评论、版本、演示、右栏检查/代码/导出、设置/引导、市场/看板、AI/出图/诊断/异常与边界。记录结果、截图与缺陷，并**逐条区分产品缺陷与脚本/环境误报**。

### 1.2 执行环境

- 生产构建（`next build` + `next start`）+ 真 daemon 子进程 + 同源网关 + 真 Chromium（1440×900，DPR 1.5）。
- 数据根仓外、**含 344 卡真实市场索引**（`~/df-evidence/retro-2026-10-17/env/market/ads/`）；与常驻实例 3000/4318、真实数据根 `~/.dforge` 完全隔离。
- 端口：web 3913 / daemon 4412 / 网关 3914（首轮），随机空闲端口；收工按精确 PID 清理。

### 1.3 结果总览（首轮）

| 模块 | 通过/总数 | 说明 |
|---|---|---|
| M1 首页 | 10/10 | 空库、新建、搜索、排序/视图、删除确认、边界（空名/超长/重名）、刷新持久化 |
| M2 编辑器壳 | 7/7 | 文档名、保存态、工具栏、缩放、命令面板、文件菜单 → 右栏导出 |
| M3 画布主路径 | 10/10 | 矩形/文本/画板、点选、拖动、Inspector 改 X、撤销/重做、右键、保存落盘、重开恢复 |
| M4 图层/资产 | 3/3 | 双击重命名、显隐、资产分段 |
| M5 Inspector | 2/2 | 空选态画布设置、非法输入行内反馈 |
| M6 评论 | 11/11 | 模式开关、草稿聚焦、空内容禁发、发布、解决、已解决分组、重开 |
| M7 版本 | 3/3 | 保存版本、对比 → 恢复、删除二次确认 |
| M8 演示 | 3/3 | 入口、控制条、翻页 + Esc |
| M9 右栏 | 4/4 | 检查、代码、复制反馈、导出 PNG |
| M10 设置/引导 | 5/5 | 四分区 + 诊断、非法 URL 校验、四步引导、首页菜单 → /settings 保参 |
| M11 市场/看板 | 11/12 | **DEF-01 失败**（修复后复跑通过）；344 卡、中文检索、加载更多、详情、装载 dryRun/token/写入、not-found、看板 |
| M12 AI/出图/诊断/异常 | 6/6 | AI 降级、出图未启动提示、诊断、daemon 不可达、中文 404、favicon |
| **合计** | **75/76** | 截图 17 张（+2 张探针）；pageErrors 5 条均为预期（409 重名、3×404、1×故意断连） |

### 1.4 失败项归因

| # | 模块 | 现象 | 归因 | 证据 |
|---|---|---|---|---|
| DEF-01 | M11 | 首屏 60 条内按来源仓库过滤 → 0 卡、显示「没有匹配的资源」、分页/加载更多消失；后 284 条有 25 条命中 | **真实产品缺陷**（误导空态 + 数据不可达） | `probe-client-filter.json`、`shots/14-m11-client-filter-empty.png` |
| 脚本误报 | M12 | 首轮探针用 `/market` 而非 `/market/query` | **脚本缺陷**（已修，非产品） | 修正记录见 `robot-b5.log` |

**复现（DEF-01）**：`/market` 首屏 60 → 来源仓库填 `veniceai/skills` → 0 卡、空态「没有匹配的资源」、分页消失；清空 → 加载 2 次到 180 → 再填同值 → 出 13 卡。daemon 侧证明：首屏 60 命中 0、后续页 25 命中。

### 1.5 分页专项（批次 5 回归）

- 344 全链路：60 → 120 → 180 → 240 → 300 → 344（5 次点击），终点「已全部加载（344）」、按钮消失。
- 中文检索「幻灯片」：首屏 60 → 加载更多 → 78，终点「已全部加载（78）」。
- 结论：增量分页本身正确；缺陷在**客户端过滤与分页的门控叠加**。

---

## 阶段 2 · 企业架构师：缺陷分析与改进方案

### 2.1 边界与契约

- 服务端读模型只认 `q / kinds / category / lane / mode / scene / tags / loadableOnly / sort / limit / offset`（`packages/contracts/src/market/index.ts:429`；`apps/daemon/src/routes/market.ts:25`）；`total` 是服务端命中数（`apps/daemon/src/market/service.ts:222`）。
- 许可档只有粗粒度 `loadableOnly`，来源仓库（`MarketSource.repo`）未进查询面；`toQueryParams` 明确丢弃 `licenseGate / repo / loadedOnly`（`apps/web/src/features/market/filters.ts:64`）。
- 因此客户端过滤只能声明「仅作用于已载 N 条」，不得冒充全量；扩大范围的唯一出口是**继续加载**。

### 2.2 根因

修复前 `apps/web/src/app/market/page.tsx:82-86` 把 `allItems → clientFiltered → visible` 压成单链；`:140` 用 `visible.length === 0` 选空态，`:176` 用同一布尔隐藏分页。状态机缺「已载 / 命中 / 终点」三态，**单一布尔把「本页空」误判成「全量空」**，并切断了继续加载入口。`installedView` 的 `:141` 与 `featuredOnly` 的 `:176` 也共用同一门控，扩大面。

### 2.3 方案对比

| 方案 | 收益 | 成本 | 风险 / 不变量影响 |
|---|---|---|---|
| **A 页内空态 + 保留分页入口**（选用） | 最小、零额外请求、诚实 | 新增 page-empty 文案/分支 | installedView 按 records 分流；featuredOnly 给「取消精选」；preserveOrder / 重试 / 请求预算不变 |
| B 自动加载到命中或终点 | 首屏体验最好 | effect、取消、失败暂停 | 可能自动扫全量，违反「可控请求」；预算/重试语义变 |
| C 许可档/来源仓库下推服务端 | total 真实、无死路 | 契约 + 路由 + service + 客户端 + 测试 | installedView(loadedOnly) 仍不可下推；跨包版本耦合 |
| D A + 有界自动一页 | 体验略好 | 多一次请求与并发态 | 失败/取消复杂，预算 +1 |

**推荐 A**：缺陷是门控错，而非数据不可达；A 拆三态并守住「本地优先、可控请求」的既有决策。

### 2.4 状态推导（已落地）

```
loaded = allItems.length
hasMore = response !== null && loadMoreState !== 'done' && cursor < total
installedEmpty = installedView && records.length === 0
pageScopedEmpty = visible.length === 0 && !installedEmpty && hasMore
terminalEmpty   = visible.length === 0 && !installedEmpty && !hasMore
```

- `pageScopedEmpty` → `MarketPageEmptyState`（`data-df-empty="no-result-page"`）：标题「当前已加载的 N 条中没有匹配」，说明「还有 M 条未检查」，主操作「加载更多」、次操作按模式（清空筛选 / 取消精选 / 去市场），进度 `已加载 N / total` 带 `role="status"`；失败 `role="alert"` + 重试（同 offset）。
- `terminalEmpty` → 终点文案「没有匹配的资源」+「已检查全部 N 条」；精选走 `featured-empty`（取消精选）；已装载有记录但本页无命中 → no-result + 「去市场」。
- 页内空态时**不渲染底部分页行**，避免双按钮；正常结果仍保留底部分页。

### 2.5 潜伏缺陷 DEF-02（架构评审发现）

修复前 `useMarketPagination` 用**去重后的 `items.length`** 当 `offset`（`apps/web/src/features/market/use-market.ts` 旧实现）。当服务端分页漂移或跨页重复时，去重会缩短已载数，下一次请求的 offset 回退，造成重复请求/跳条。修复：`PagedExtra.cursor` 按**服务端原始页长**推进（`offset + result.items.length`），失败保持原 cursor；`hasMore` 由 cursor 与 total 推导。新增「60 + 60（10 重复）+ 60」用例，断言第三次请求 `offset=120`、失败重试仍用同一 offset。

### 2.6 不变量与测试

- 客户端过滤仍**只作用于已载结果**（输入恒为 `allItems` 切片；`toQueryParams` 永不含 `repo/licenseGate/loadedOnly`）。
- 搜索 `preserveOrder`、失败重试、请求预算不变；`installedView` 只在本地记录为 0 时用 installed-empty。
- 测试：`applyClientFilters` 纯函数、`toQueryParams` 字段断言、hook 游标/重试、页面正反例（首屏 0 命中 → page-empty + 分页 → 加载后出卡；全载仍 0 → no-result + 无分页；installedView 有记录本页 0 → 非 installed-empty；featuredOnly 0 → 取消精选）、e2e 跨页仓库过滤。

### 2.7 本轮不做

自动加载（B/D）、服务端下推（C）另立票；全量预取、页码条、无限滚动不做；`featuredOnly` 的 Top-6 语义不变。

---

## 阶段 3 · 用户体验设计师：界面与交互优化

### 3.1 设计决策与落地

| 项 | 问题（截图证据） | 设计改动 | 实现 |
|---|---|---|---|
| DEF-01 页内空态 | 14 号图：首屏过滤无命中就报「没有匹配」并藏分页 | 区分「已载 N 条无匹配」与「全量无结果」；主「加载更多」、次「清空筛选」；进度与失败重试并入空态 | `MarketPageEmptyState` + 三态推导（page.tsx / MarketStates.tsx） |
| DEF-03 评论可读性 | 08 号图：深色面板上线程行只剩时间，作者/正文不可见 | 原生按钮补主文本色与 `font: inherit`；空回复禁用「回复」 | `styles.ts` / `CommentThreadPanel.tsx` + 测试 |
| 无预览占位 | 13/15 号图：16:9 大灰块中央孤立「T」，像坏图 | 固定 64px 高、24px kind 图标 +「暂无预览」、hairline 边框 | `MarketCard.tsx` / `styles.ts` / i18n |
| `仅看` 禁用态 | 15 号图：禁用字对比不足，tooltip 键盘不可达 | 文字色提至 `text-secondary`；同卡给可用「查看详情」次按钮 | `MarketCard.tsx` |
| 分页反馈 | 15 号图：加载/失败/终点层级弱 | `Button loading`（spinner + aria-busy）、进度 `role=status`、失败 `role=alert` + 显式重试、hairline 分隔、终点纯文案 | `page.tsx` / `MarketPageEmptyState` |

### 3.2 i18n

新增 `market.card.noPreview`、`market.empty.noResultPage.*`（filters/featured/installed 标题与说明）、`market.empty.featuredEmpty.*`、`market.featured.cancel`、`market.empty.noResult.checkedAll`、`market.empty.noResult.installedCheckedAll`；`market.list.retry` 复用既有 `market.error.retry`。zh-CN 真源 + en 同步，键集测试通过。

### 3.3 e2e 固化

`scripts/e2e/scenarios/market.mjs`：夹具前 60 条 repo `market-e2e/fixtures`、后 10 条 `market-e2e/later`；新增「回首屏 → 填 later → `no-result-page` + 分页存在 → 加载更多 → 10 卡、空态消失、无误导文案」。最高接缝上锁死 DEF-01。

### 3.4 边界与未做

不做无限滚动、封面抓取/新依赖、市场筛选分层与评论信息架构重排、全局 disabled 令牌改版；详情页 4:3 占位不动。

---

## 收口验证（修复后复跑）

修复提交合入 `retro/batch5` @ `80e905a` 后：

- **`pnpm verify`：exit 0**，292 个测试文件 / **2789 用例全过**；lint 0 error、typecheck 9 包全 Done。
- **`pnpm e2e:smoke`：exit 0，76/76 步**：market **13**（含新增跨页过滤：页内空态 + 分页 + 加载出后 10 条）、nav 21、canvas 10、editor 17、home 8；编辑器真实门禁 7/7。
- **机器人复跑：pass 80 / warn 0 / fail 0，defects 0，截图 20**。实测：
  - DEF-01：首屏 0 卡 + `data-df-empty="no-result-page"` + 分页 1 + 误导文案 0；点 1 次加载更多出 2 卡、空态消失；补探针加载至 344/344 得全量 **25 张命中**、按钮消失；
  - 评论线程 `getComputedStyle` 实测 `color=rgb(255, 255, 255)`（深色面板可读）；
  - 卡片缩略区「暂无预览」、computed 高 64px；view-only 卡 `card-open-secondary=1`。
- 证据：`~/df-evidence/retro-2026-10-17-batch5/final/{verify.log,e2e-smoke.log,robot-rerun.log,robot-rerun.json,probe-def01-full.log}`；截图 `final/shots/16-m11-def01-empty.png`、`17-m11-def01-hits.png`、`21-m11-def01-all-25.png`、`08-m6-comment-thread-readable.png`。

---

## 附：各阶段目标 / 输出 / 验证

| 阶段 | 目标 | 输出 | 验证 |
|---|---|---|---|
| 1 机器人回归 | 全模块模拟真实用户并定位缺陷 | 76 项检查 + 17 截图 + 缺陷归因 | 首轮 75/76；修复后复跑 80/80、0 fail |
| 2 架构分析 | 缺陷边界/契约/状态机归因与方案 | 四方案取舍 + 状态推导 + DEF-02 | 契约未改；单测/页面/e2e |
| 3 UX 优化 | Figma 风格与可读性优化 | 页内空态、评论可读、卡片占位/禁用、分页反馈 | web 2789 用例；e2e 76/76；机器人 80/80 |
