# 审计 04 · 编辑器与评审深挖（含 axe）

- **状态**：已完成（本票证据 `~/df-evidence/audit-50/aud-04/`；机器可读汇总 `editor-review-2026-10-17T13-06-41.json`）
- **日期**：2026-10-17（UTC 12:57–13:07；本地 UTC+8）
- **代码基线**：`integration/audit-v1` @ `9079f02`（= `main` @ `c6b1654` + 审计 01 报告）
- **本票分支/工作树**：`audit/04-editor-review` / `/home/QIU/df-wt/aud-04`
- **范围**：画布 13 类交互、保存/重开、版本/评论/演示、文本/自动布局、500 节点基线；首页/编辑器/市场/设置 axe 与键盘路径。视觉像素对照仍因 REF-01 阻塞。

## 0. 结论摘要

1. **主路径是通的**：在生产构建（`next build` + `next start` + 真 daemon + 同源网关）上，13 类画布交互、保存→重载逐字段恢复、评论发布/解决/刷新、版本快照/对比/两步确认/刷新、演示键盘翻页、文本内联编辑与自动布局入口**全部通过**（14 条交互记录 + 3 条持久化 + 9 条评审 + 2 条文本/布局，0 失败）。
2. **axe 发现 2 个 critical、5 个 serious**（按页计规则数）：首页 `aria-allowed-attr`（搜索框）、市场 `aria-required-children`（伪 tablist）各 1 critical；对比度不达标（首页 5 节点、市场 16 节点、设置 1 节点）与「可访问名不含可见文本」（首页 1、编辑器 2 节点）为 serious。四个关键页面 AX 树中**空可访问名的可交互元素为 0**，Tab 顺序未见焦点陷阱。
3. **评审数据只存浏览器 localStorage**：评论/版本不在 daemon 与 `.dfg` 中；新浏览器上下文（同一文档、同一 daemon）看不到已有评论/版本（0 钉点 / 0 版本行）。这是 FE-07 已声明的兜底口径，但对「保存/重开」承诺应记 **partial**。
4. **500 节点基线（measure-only）**：500 个矩形一次会话注入 82.7ms；全选框选 500 节点墙钟 589ms（含 Playwright 往返）；连续微移时 rAF 间隔中位 **33.3ms（≈30fps）**、p95 **50.1ms（≈20fps）**；单次 `selectAll` 0.2ms、`nudge+undo` 3.4ms（页面内计时）。不设预算，留作后续优化判据。
5. **两处门禁工装问题**：`verify-figma-review` 的 `versions/drawer` 取样根是 portal 外的空包裹层（1440×0），冻结参照后也只会截到留白；`verify-canvas` 的 W5 用 `Control+0` 测缩放重置，而壳层注册的是 `⇧0`，`/editor` 上 Ctrl+0 无效。
6. 未发现 A 级缺陷；B 级 5 条（均为可访问性或评审数据持久化），C 级 5 条。无产品代码改动。

## 1. 范围与方法

- **门禁基线**：复跑 `verify-canvas`、`e2e:smoke`、`verify-figma-review`、web 包测试与全量 `pnpm verify`；结果与审计 01 一致。
- **一次性审计脚本**：`scripts/audit/editor-review-audit.mjs`（新增，`pnpm audit:editor-review`）——不是门禁，按「完成即 0」收口；自起临时 daemon（临时数据根）、空闲端口、同源网关与 Chromium，**未触碰 3000/4318 与 `~/.dforge`**。
- **生产构建**：脚本内执行 `next build`（Next 16.4.1，13 条路由）+ `next start`；不使用 `next dev` 做 live 断言。
- **axe**：`axe-core@4.14.0`（新增根 devDependency，走 `pnpm-workspace.yaml` 的 `catalog:`）注入真实页面，`runOnly` 覆盖 WCAG 2.0/2.1/2.2 A+AA；焦点顺序取 25 次 Tab；可访问名取 CDP `Accessibility.getFullAXTree`（可交互角色 + 空名）。
- **数据隔离**：临时数据根 `~/df-evidence/audit-50/aud-04/runtime/<时间戳>/data`；市场索引为单条 view-only 夹具（与 e2e nav 场景同形）。
- **证据**：截图、axe 原始 JSON/摘要、焦点顺序、AX 空名、门禁日志均在 `~/df-evidence/audit-50/aud-04/`。

## 2. 门禁与测试复跑（真实退出码）

| 门禁 | 命令 | 退出码 | 结果 | 证据（`~/df-evidence/audit-50/aud-04/`） |
|---|---|---:|---|---|
| 全量 verify | `pnpm verify` | 0 | 292 文件 / 2765 例全绿（web 155/1343） | `logs/verify.log` |
| scripts 测试 | `pnpm test:scripts` | 0 | 56 例全过 | `logs/test-scripts.log` |
| web 包测试 | `pnpm --filter @dforge/web test` | 0 | 155 文件 / 1343 例 | `logs/web-test.log` |
| 画布门禁 | `pnpm verify:canvas` | **2** | 挂载 7/7（A1–A7）+ 接线 15/15全过；**截图段阻塞**（REF-01） | `logs/verify-canvas.log`；`gate-evidence/fe-06/` |
| e2e 冒烟 | `pnpm e2e:smoke` | 0 | 63/63 步 + 编辑器门禁 7/7 | `logs/e2e-smoke.log`；`gate-evidence/fe-02/e2e/` |
| 评审门禁 | `verify-figma-review`（审计脚本内调用，生产站点） | **2** | 交互 3/3 通过；**参照集未冻结**（`reference-v1/review` 不存在） | `gate-evidence/fe-07/verify-figma-review-2026-10-17T13-06-59.json` |
| 一次性审计 | `pnpm audit:editor-review` | 0 | 见 §3–§6 | `editor-review-2026-10-17T13-06-41.json`；`logs/audit-editor-review-final.log` |

> `verify-canvas` 的 2 是**阻塞不是失败**：功能断言全过，仅 C8 深色截图因 REF-01 无参照集。`verify-figma-review` 同理，交互断言在参照集探测之前已跑完。

## 3. 画布 13 类交互（生产构建 `/editor`）

驱动方式：真实指针/键盘事件；世界坐标经画布视口换算；吸附在确定性断言前后显式开关。全部 `ok`。

| # | 交互 | 断言口径 | 结果 |
|---:|---|---|---|
| W1 | 选择 | 点选 1、Shift 加选 2、框选 ≥2 且框选矩形真实绘制 | ok |
| W2 | 移动 | 吸附关闭，位移恰为 (40, 30) | ok |
| W3 | 缩放 | se 手柄拖动 +60/+40，对侧 x/y 不动，拖拽中 8 手柄 | ok |
| W4 | 旋转 | 角外侧拖动 + Shift，旋转角为 15° 整数倍（实测 120°） | ok |
| W5 | 画布缩放 | `⌘+` 放大到 1.5，`⇧0` 回到 1 | ok |
| W6 | 画布平移 | 中键 +70、空格拖拽 −30（panX） | ok |
| W7 | 复制粘贴 | `⌘C/⌘V` 节点数 +1 | ok |
| W8 | 层级 | `⌘]`/`⇧⌘]`/`⇧⌘[` 的前移/置顶/置底顺序正确 | ok |
| W9 | 编组/解组 | 选中两节点成组（type=group），解组后根节点数复原 | ok |
| W10 | 撤销/重做 | Shift+→ 微移 10；撤销回原值；重做回移后值 | ok |
| W11 | 对齐/分布 | 工具条 `alignLeft` 左缘相等；三节点水平分布间隔相等 | ok |
| W12 | 吸附 | 6px 阈值内吸附到目标 x；绘制期出现参考线/测量 | ok |
| W13 | 文本编辑 | 双击进入覆盖层、输入「设界画布」、失焦提交、撤销回空 | ok |

W1 的框选会连同两个画板一起选中（画板在世界坐标范围内），属预期。

## 4. 保存/重开、评审与文本/自动布局

| ID | 能力 | 断言 | 结果 |
|---|---|---|---|
| P1 | 保存态 | 点击保存后 `data-df-save-state=saved` | ok |
| P2 | daemon 落盘 | `GET /documents/<name>/pages/page-1` 正文含画布节点（5 节点） | ok |
| P3 | 重开 | 刷新后几何 x/y/width/height 逐字段一致 | ok |
| R1 | 评论发布 | 评论模式落点 → 输入 → 发布产生钉点 | ok |
| R2 | 评论解决 | 解决后进入「已解决」折叠段，展开可见 resolved 线程 | ok |
| R3 | 评论刷新 | 刷新后钉点仍在（localStorage） | ok |
| R4 | 版本快照 | 「保存当前版本」后列表出现行；快照时画布已载入（5 节点） | ok |
| R4b | 版本抽屉 DOM | `[data-df-versions-root]` = 1440×0（y=900），真实抽屉 `[role=dialog]` = 421×900 | **观察（见 F-06）** |
| R5 | 版本两步确认 | 对比浮层打开；确认后关闭；文档仍为 5 节点 | ok |
| R6 | 版本刷新 | 刷新后列表仍在；确认恢复追加「回滚前自动保存」行（1→2） | ok |
| R7 | 演示 | 2 个画板：首张 ← 不越界、→ 翻到第 2 张、末张 → 不越界、Esc 退出 | ok |
| R8 | 评审数据隔离 | 新浏览器上下文：评论钉点 0、版本行 0（localStorage 口径） | **partial（见 F-01）** |
| T1 | 文本节点 | W13 撤销后文本内容为空（提交内容见 W13） | ok |
| T2 | 自动布局 | 选中画板 → Inspector「自动布局」开关 → 出现方向（横向/纵向） | ok |

> 评论/版本 UI 在**当前浏览器**内完整可用；跨浏览器上下文与桌面壳不共享（F-01）。版本恢复的深度语义（撤销/重做、损坏快照拒绝）由 `apps/web/src/verify/versions-rollback.test.ts` 单测覆盖，本轮未重复。

## 5. 500 节点交互基线（measure-only，不设硬预算）

夹具：同一 `/editor` 文档内注入 500 个 30×30 矩形（25 列 × 20 行，间距 40），视口 zoom 0.6。所有数值为单次采样，**不构成通过/失败判据**。

| 指标 | 实测 | 说明 |
|---|---:|---|
| 注入 500 节点（`session.createRect` ×500） | 82.7ms | 500 条独立命令/历史条目 |
| 指针框选全量 500 节点 | 589ms 墙钟 | 含 Playwright 指针往返 |
| 键盘 Shift+→ 微移全部选中 | 358ms 墙钟 | 含 Playwright 键盘往返 |
| 键盘撤销 | 363ms 墙钟 | 含 Playwright 键盘往返 |
| 页面内 `selectAll` 中位 / max | 0.2 / 0.4ms | 5 次采样 |
| 页面内 `nudge+undo` 中位 / max | 3.4 / 6.7ms | 5 次采样 |
| 页面内 `zoomIn+zoomOut` 中位 / max | 0 / 0.2ms | 视口操作不写文档 |
| 连续 30 次微移时 rAF 间隔 中位 / p95 / max | **33.3 / 50.1 / 50.1ms** | ≈30fps 中位、≈20fps p95 |
| 渲染统计 | nodesDrawn 500、selectionOutlines 500、handles 8 | 证明 500 节点真实绘制 |

基线只说明「500 节点可交互、连续微移约 30fps」，是否达标留给后续性能预算票。

## 6. axe / 键盘 / 可访问名

### 6.1 WCAG 2.2 AA 自动检查（axe-core 4.14.0）

| 页面 | critical | serious | 规则（节点数） |
|---|---:|---:|---|
| 首页 `/` | **1** | **2** | `aria-allowed-attr`(1)、`color-contrast`(5)、`label-content-name-mismatch`(1) |
| 编辑器 `/editor` | 0 | **1** | `label-content-name-mismatch`(2)；另有 incomplete `target-size`(1) |
| 市场 `/market` | **1** | **1** | `aria-required-children`(1)、`color-contrast`(16) |
| 设置 `/settings` | 0 | **1** | `color-contrast`(1) |
| **合计** | **2** | **5 条规则** | 违规节点合计 27 |

要点：

- **首页搜索框**：`role="searchbox"` 上带 `aria-expanded`（`HomeTopbar.tsx:104-105`），searchbox 不允许该属性；combobox 语义不完整。
- **市场类别筛选**：`role="tablist"` 的直接子元素是 `<button>`（`FilterBar.tsx:130-152`），没有 `role="tab"`；应改为 radiogroup/aria-pressed，或补全 tabs 模式。
- **对比度**：最低 2.09:1（`--dfg-color-text-disabled` #b3b3b3 on #fff，被用于市场结果计数/索引时间/说明文案）；主色按钮白字 2.99:1；选中导航 #0d99ff on #e5f4ff 2.66:1；`#757575` on `#f5f5f5` 4.22:1（差 0.28）。
- **可访问名不含可见文本**：首页文档卡链接 `aria-label="打开「…」"` 排除了卡片可见标题/元信息；编辑器主菜单按钮可见「设界」但 `aria-label="主菜单"`；缩放按钮可见「100%」但 `aria-label="缩放"`（WCAG 2.5.3 Label in Name）。
- **空可访问名**：四个页面的 AX 树可交互角色（button/link/textbox/combobox/tab/menuitem…）中**空名 0 个**；输入框均有 label 或 aria-label。

### 6.2 焦点顺序（25 次 Tab）

| 页面 | 焦点停靠数 | 顺序摘要 | 异常 |
|---|---:|---|---|
| 首页 | 13 | 折叠侧栏 → 最近 → 本地文档 → 回收站 → 搜索 → 新建 → 设置与帮助 → AI → 时间范围 → 排序 → 视图切换 → 文档卡 → 更多操作 → body → 回环 | 无陷阱 |
| 编辑器 | 21 | 主菜单 → 保存 → 版本历史 → 评论 → 6 个工具 → AI → 缩放 → 快捷键 → 图层 treeitem → 编组 → 检查/页面名/背景/网格/网格间距 → body → 回环 | 画布本身不可 Tab 聚焦（快捷键全局可用） |
| 市场 | 16 | 搜索 → 视图切换 → 5 个类别按钮 → 排序 → 品类 → 泳道 → 许可档 → 来源仓库 → 仅已装载 → 精选 → 卡片 → 更多 → body → 回环 | 类别按钮语义错（F-02） |
| 设置 | 6 | 5 个设置分区按钮 → 工作目录输入 → body → 回环 | 无陷阱 |

画布容器是 `role="application"` + `aria-label`（`CanvasStage.tsx:392-394`），但 canvas 内容没有可访问的节点/图层替代表述——读屏用户只能通过图层树间接操作（见 F-09，C 级观察）。

## 7. Findings

五态：working / partial / missing / broken / blocked；级别：A 阻断、B 严重（默认阻断、可书面豁免）、C 一般/观察。**A=0，B=5，C=5。**

| ID | 五态 | 级别 | 标题 | 证据 |
|---|---|---|---|---|
| F-04-01 | partial | **B** | 评论/版本只存浏览器 localStorage，不在 daemon/.dfg，跨上下文/桌面壳不可见 | R8；`editor-review-…13-06-41.json`；`apps/web/src/features/editor-review/storage.ts:1-10` |
| F-04-02 | broken | **B** | 市场类别 `role="tablist"` 子元素不是 `role="tab"`（axe critical） | `axe/market-summary.json`；`FilterBar.tsx:130-152` |
| F-04-03 | broken | **B** | 首页搜索框 `role="searchbox"` 使用 `aria-expanded`（axe critical） | `axe/home-summary.json`；`HomeTopbar.tsx:96-110` |
| F-04-04 | broken | **B** | 三个页面颜色对比度未达 WCAG AA 4.5:1（最低 2.09:1） | `axe/{home,market,settings}-summary.json` |
| F-04-05 | broken | **B** | 可访问名不含可见文本（首页卡片链接、编辑器主菜单/缩放按钮） | `axe/{home,editor}-summary.json`；`app-menu.tsx:86`、`zoom-menu.tsx:88` |
| F-04-06 | broken | C | `verify-figma-review` 的 `versions/drawer` 取样根是 portal 外空层（1440×0），参照冻结后只截留白 | R4b；`scripts/verify-figma-review.mjs:157-158`；`packages/ui/src/components/Drawer.tsx:146` |
| F-04-07 | partial | C | `verify-canvas` W5 用 `Control+0`，壳层注册的是 `⇧0`；`/editor` 上 Ctrl+0 无效，门禁未覆盖真实路由 | W5；`canvas/input/keyboard.ts:191-195`；`canvas/register.tsx:139-143` |
| F-04-08 | partial | C | 打开文档时顺序探测 `page-N` 直到 404：每次打开产生一条 page-2 404 与控制台噪声 | `axe/editor-summary.json` 的 failedResponses；`documents-client.ts:251-260` |
| F-04-09 | partial | C | 画布内容无可访问替代表述（`role=application` + canvas） | `CanvasStage.tsx:392-396`；焦点/AX 证据 |
| F-04-10 | missing | C | 评审六态中 disabled/loading/error 无对应实现；参照集阻塞使 stateCoverage 全 pending | `gate-evidence/fe-07/…13-06-59.json` 的 `stateCoverage`；`verify-figma-review.mjs` 头注释 |

### B 级详情与建议处置

**F-04-01 · 评审数据只存浏览器 localStorage（partial）**
- 复现：同一文档发布评论 + 保存版本 → 新浏览器上下文打开同一 `/editor` → 评论模式 0 钉点、版本抽屉 0 行；新上下文 `localStorage` 只有 `dfg-drawer-ai`。
- 影响：换浏览器、清站点数据、桌面壳与 Web 双端、以及换机器都看不到评审历史；评论/版本不进 `.dfg`，备份/导出不会带走。
- 建议：daemon 增加文档级 comments/versions 路由并纳入 `.dfg`（或明确产品口径把评审定义为浏览器本地草稿）；在能力表里先按 partial 记录。

**F-04-02 · 市场伪 tablist（broken）**
- 复现：`/market?daemon=…` 开 axe → `aria-required-children` critical，target `div[role=tablist][data-df-market=kind-tabs]`。
- 影响：读屏不再宣布 tab 语义/选中态；键盘 Tab 逐个按钮仍可达但缺少 roving tabindex 与方向键。
- 建议：改用 `role="radiogroup"` + `role="radio"`/`aria-checked`，或保留 tablist 并补 `role="tab"`、`aria-selected`、方向键。

**F-04-03 · 首页搜索框 ARIA 不合法（broken）**
- 复现：首页 axe → `aria-allowed-attr` critical，target `input[role=searchbox]`，报 `aria-expanded` 不允许。
- 影响：辅助技术可能忽略展开态；搜索建议面板的语义不完整。
- 建议：用 `role="combobox"` + `aria-controls` + `aria-expanded` + `aria-autocomplete="list"` 的完整模式，或去掉 input 上的 role/aria-expanded，把展开态放到带 combobox 语义的容器。

**F-04-04 · 对比度（broken）**
- 复现：axe 首页/市场/设置，`color-contrast` 共 22 个节点（首页 5、市场 16、设置 1）。
- 影响：低视力用户在弱光/低质量屏幕上难以阅读计数、索引时间、说明、选中导航与主按钮文字。
- 建议：调整浅色主题令牌（`--dfg-color-text-disabled` 不用于信息性文案；主色按钮文字改用更深主色/加深按钮底色；选中态前景加深）；修复后把 axe `critical+serious = 0` 接为浏览器门禁。

**F-04-05 · Label in Name（broken）**
- 复现：首页文档卡（`a.dfg-home__card-link[aria-label]`）、编辑器主菜单/缩放按钮（`aria-label` 覆盖可见文本）。
- 影响：语音控制用户按可见文字（如「设界」「100%」）无法命中控件。
- 建议：可访问名包含可见文本（如 `aria-labelledby` 指向标题 + 图标隐藏），或去掉 `aria-label` 保留可见文本 + `title` 补充说明。

## 8. 编辑器域五态判定（本票范围）

| 能力 | 状态 | 依据 |
|---|---|---|
| 画布 13 类交互 | **working** | 生产构建 `/editor` W1–W13 全过；`verify-canvas` 同结论 |
| 保存/重开 | **working** | P1–P3；e2e 编辑器 17 步 |
| 演示（Present） | **working** | R7；`buildSlides` 只认顶层画板（编组内画板不演示，属既有口径） |
| 文本内联编辑 | **working** | W13；失焦提交/撤销 |
| 自动布局 | **working（子集）** | T2 + engine 单测；主/交叉轴、间距、padding、hug/fixed；主轴 fill 未实现（既有规格边界） |
| 版本 | **partial** | UI/回滚/两步确认可用；持久化仅 localStorage（F-04-01） |
| 评论 | **partial** | 发布/回复/解决/折叠可用；持久化仅 localStorage（F-04-01） |
| 500 节点交互 | **working（基线）** | §5；无硬预算 |
| 编辑器 a11y | **broken** | §6 的 2 critical + 5 serious |
| 视觉/评审像素对照 | **blocked** | REF-01 未冻结；`verify-canvas` / `verify-figma-review` 均 exit 2 |
| 桌面壳内评审 | **blocked** | Electron 二进制未安装（审计 01 事实）；且评审数据非 daemon 共享 |

## 9. 回归候选（不是本票新增的必红测试）

1. **把 13 类交互提升为 e2e 场景**：复用 `scripts/audit/editor-review-audit.mjs` 的断言序列，新增 `scripts/e2e/scenarios/editor-interactions.mjs`（生产构建、`?documentId=` 真实文档）。注意 W9 解组后不要撤销（撤销会把画板重新包进编组，导致 Present 假失败）。
2. **axe 接入现有 e2e runner**：先在首页/编辑器/市场/设置四页断言 `critical=0`，修复 F-04-02/03/04/05 后再接 `serious=0`；`axe-core` 已进根 devDependency（`catalog:`），无需新框架。建议把 `scripts/audit/editor-review-audit.mjs` 的 `auditPageWithAxe` 抽成 `scripts/lib/axe.mjs`（本次未抽，避免新建统一 harness）。
3. **评审持久化契约测试**：daemon 增加评论/版本路由后，补「同文档跨浏览器上下文可见」与「进 `.dfg` 备份」两条；在此之前保留 R8 作为 partial 证据。
4. **门禁工装修复**：`verify-figma-review` 的 `versions/drawer` 改取 `[role=dialog]`；`verify-canvas` W5 改 `⇧0` 并补 `/editor` 用例；两者都可加自测（portal 取样根、快捷键注册表同源）。
5. **500 节点 perf 脚本**：保留 `pnpm audit:editor-review` 的 perf 段作为可选基线；等性能预算票落地后再设阈值（当前只记录）。
6. **文档探测 404**：若 daemon 提供页面清单，去掉 64 次顺序探测；届时应把 console 404 纳入 e2e 的 console 检查。

## 10. 阻塞与未覆盖

| 项 | 原因 | 解除条件 |
|---|---|---|
| canvas C8 / 评审像素对照 | REF-01 参照集未冻结（`~/df-evidence/reference-v1` 不存在） | #28 冻结参照集后复跑 `verify-canvas` / `verify-figma-review` |
| 评审六态截图 | 同上；`stateCoverage` 全 pending | 同上 + 补 disabled/loading/error 实现 |
| 桌面壳内评审 | Electron 二进制缺失；评审数据非 daemon 共享 | 执行 `fetch-electron` + F-04-01 修复 |
| 跨浏览器/跨平台矩阵 | 本轮只跑 Linux + Chromium（WSL2） | CI/发布前矩阵 |
| 500 节点硬预算 | 本票只建基线（规格明确 out of scope） | 性能预算票 |

## 11. 证据索引

| 内容 | 路径（`~/df-evidence/audit-50/aud-04/`） |
|---|---|
| 机器可读汇总（13 交互/评审/500 节点/axe 摘要） | `editor-review-2026-10-17T13-06-41.json` |
| 审计日志（含生产构建输出） | `logs/audit-editor-review-final.log` |
| 全量 verify / scripts / web 测试 / canvas / e2e 日志 | `logs/verify.log`、`logs/test-scripts.log`、`logs/web-test.log`、`logs/verify-canvas.log`、`logs/e2e-smoke.log` |
| axe 原始结果 / 摘要 / 焦点顺序 / AX 空名 | `axe/<page>.json`、`axe/<page>-summary.json`、`axe/<page>-focus.json`、`axe/<page>-ax-gaps.json` |
| 截图（首页/编辑器/市场/设置/交互后/500 节点） | `shots/axe-<page>.png`、`shots/editor-after-interactions.png`、`shots/perf-500.png` |
| 画布门禁证据 | `gate-evidence/fe-06/` |
| e2e 证据 | `gate-evidence/fe-02/e2e/2026-10-17T12-54-48/` |
| 评审门禁证据 | `gate-evidence/fe-07/verify-figma-review-2026-10-17T13-06-59.json` |
| 临时数据根（保留，可复核） | `runtime/2026-10-17T13-06-41/data/` |

> 审计脚本与 axe 依赖属于测试工装变更；未改产品代码。脚本退出 0 表示「审计已执行」，findings 以本报告与证据 JSON 为准，**不是门禁通过**。
