# UI 自动化选择器导航

机器人脚本 / 门禁 / 单测共用的**稳定选择器契约**。写脚本前先读本页：优先用
`data-df-*` 挂点与可访问名（role + name），**不要**用样式类、DOM 层级或全页文本正则猜控件。
本页的挂点均于 2026-10-17 在代码中逐项核实（批次 5 · 工作包 C），新增/改挂点须同步本页。

约定：

- `data-df-*` 是**门禁取样契约**；改其名/取值 = 改契约，须同步 `scripts/` 里的消费方。
- 六态覆盖（验收标准 §5）：`hover / selected / disabled / loading / empty / error`，
  以 `data-df-state="<态>"` 表达；截图取样单元用 `data-df-sample="<面>/<单元>"`，
  页面/主题用 `data-df-page` / `data-df-theme`。
- 机器人脚本与截图证据一律落 `~/df-evidence/<票号>/`（**仓外**），不入库；
  见 `implementation-workflow.md`「证据存仓库外」。

## 挂点表（按界面面分组）

> 路径相对 `apps/web/src/`；行号只作定位参考，以 `grep -rn "data-df-<name>"` 为准。

### 首页（`/`）

| 挂点 | 所在文件 | 用途 |
|---|---|---|
| `data-df-home="filter-row"` | `features/home/components/FilterRow.tsx` | 筛选行取样根（不是表单域） |
| `data-df-home-card={documentId}` | `features/home/components/DocumentCard.tsx` | 文档卡片（遍历/计数） |
| `data-df-trash-record={recordId}` | `features/home/components/TrashList.tsx` | 回收站行 |

首页的「视图 / 时间范围 / 排序」是分段控件与菜单，**按 role 找**（见下节）。

### 编辑器槽位（`/editor` 壳层）

| 挂点 | 所在文件 | 用途 |
|---|---|---|
| `data-df-page="editor"` | `features/editor-shell/ui/editor-shell.tsx` | 编辑器根 |
| `data-df-slot="left-panel"` | `features/editor-shell/ui/editor-shell.tsx` | 左栏槽（**作用域读点**） |
| `data-df-slot="canvas"` | `features/editor-shell/ui/editor-shell.tsx` | 画布槽（**作用域读点**） |
| `data-df-slot="right-panel"` | `features/editor-shell/ui/editor-shell.tsx` | 右栏槽（**作用域读点**） |
| `data-df-slot="toolbar"` | `features/editor-shell/ui/toolbar.tsx` | 工具栏插槽（AI 入口等） |
| `data-df-tool={toolId}` | `features/editor-shell/ui/toolbar.tsx` | 工具按钮（确定性切工具） |
| `data-df-preview="editor/<单元>"` | `features/editor-shell/ui/*.tsx` | 截图门禁取样单元（topbar/toolbar/zoom-menu/command-palette/shortcuts/hud/app-menu/canvas） |
| `data-df-command={commandId}` | `features/editor-shell/ui/command-*.tsx`、`shortcuts-dialog.tsx` | 命令项（命令面板 / 快捷键表） |
| `data-df-zoom={percent}` | `features/editor-shell/ui/zoom-menu.tsx` | 缩放菜单项 |
| `data-df-document-name` | `features/editor-shell/ui/topbar.tsx` | 顶栏文档名 |

### 画布（`/editor` 画布槽 与 `/_canvas` 工作室）

| 挂点 | 所在文件 | 用途 |
|---|---|---|
| `canvas[data-df-canvas]` | `features/canvas/ui/canvas-stage.tsx`（工作室在 `features/canvas/studio/canvas-studio.tsx`） | CanvasKit 画布元素（等它出现 = 运行时就绪） |
| `data-df-canvas-shell` | `features/canvas/ui/canvas-stage.tsx` | 画布宿主容器（滚轮/坐标） |
| `data-df-canvas-status="error" \| "font-error"` | `features/canvas/ui/canvas-stage.tsx` | 画布错误态（字体回退必须报错） |
| `data-df-canvas-toolbar` | `features/canvas/ui/floating-toolbar.tsx` | 浮动工具条 |
| `data-df-canvas-action={actionId}` | `features/canvas/ui/floating-toolbar.tsx` | 浮动工具条动作 |
| `data-df-canvas-context-menu` | `features/canvas/ui/canvas-stage.tsx`、`context-menu.tsx` | 画布右键菜单 |
| `data-df-canvas-hud` | `features/canvas/ui/canvas-hud.tsx` | 画布 HUD（`role="status"`） |
| `data-df-canvaskit={状态}` | `features/canvas/runtime/canvaskit-loader.ts` | CanvasKit 加载状态（调试读点） |
| `data-df-studio-tool={tool}` | `features/canvas/studio/canvas-studio.tsx` | 工作室工具按钮（`/_canvas`） |
| `data-df-studio-action="save" \| "reload" \| "export" \| "import"` | `features/canvas/studio/canvas-studio.tsx` | 工作室动作 |
| `data-df-save-control` / `data-df-save-action="save"` / `data-df-save-state={status}` | `features/canvas/workspace/save-control.tsx` | 保存入口与保存态（确定性读点） |

### 图层与资产（左栏）

| 挂点 | 所在文件 | 用途 |
|---|---|---|
| `data-df-panel-group="editor-panels"` | `features/editor-panels/components/EditorPanels.tsx` | 左栏组合根（页签 + 面板） |
| `data-df-panel="layers"` | `features/editor-panels/components/LayersPanel.tsx` | 图层面板边界 |
| `data-df-panel="assets"` | `features/editor-panels/components/AssetsPanel.tsx` | 资产面板边界 |
| `data-df-layer-count={n}` | `features/editor-panels/components/LayersPanel.tsx` | 图层行数 |
| `data-df-layer-row={id}` | `features/editor-panels/components/LayerRow.tsx` | 图层行（`data-df-state`：selected/hover/default；另有 `data-df-focus`、`data-df-drop-indicator`、`data-df-dragging`） |
| `data-df-asset-component={id}` | `features/editor-panels/components/AssetsPanel.tsx` | 组件卡 |
| `data-df-asset-token={path}` | `features/editor-panels/components/AssetsPanel.tsx` | Token 行 |
| `data-df-segment={components\|tokens}` | `features/editor-panels/components/AssetsPanel.tsx` | 资产分段当前值（读态用，操作仍点 radio） |
| `data-df-sample="layers/…"`、`"assets/…"` | 两面板 | 六态取样单元（empty/loading/error/no-results/tokens 等） |

### Inspector（右栏下半区）

| 挂点 | 所在文件 | 用途 |
|---|---|---|
| `data-df-inspector="panel"` | `features/inspector/components/InspectorPanel.tsx` | 属性面板边界 |
| `data-df-inspector="canvas-settings"` | `features/inspector/components/CanvasSettings.tsx` | 空选态画布设置 |
| `data-df-inspector-section={id}` | `features/inspector/components/Section.tsx` | 分区（layout/text/advanced…） |
| `data-df-inspector-field={field}` | `features/inspector/components/controls.tsx`、`NumberField.tsx`、`InspectorPanel.tsx` | 字段（`data-df-state`：default/mixed/disabled） |
| `data-df-inspect="panel" \| "code" \| "code-export" \| "export-panel" \| …` | `features/inspect-export/**` | 检查 / 代码 / 导出页签内容 |

### 评论（画布层 + 右栏面板）

| 挂点 | 所在文件 | 用途 |
|---|---|---|
| `data-df-comment-layer` | `features/editor-review/comments/CommentLayer.tsx` | 评论覆盖层（`data-df-state="active" \| "idle"`） |
| `data-df-comment-surface` | `features/editor-review/comments/CommentLayer.tsx` | 「在画布上添加评论」落点按钮 |
| `data-df-comment-pin={threadId}` | `features/editor-review/comments/CommentLayer.tsx` | 画布钉点（state：hover/resolved/default） |
| `data-df-comment-hover={threadId}` | `features/editor-review/comments/CommentLayer.tsx` | 钉点悬停预览卡 |
| `data-df-comment-draft` | `features/editor-review/comments/CommentLayer.tsx` | 草稿卡 |
| `data-df-comment-toggle` | `features/editor-review/comments/CommentsModeToggle.tsx` | 评论模式开关 |
| `data-df-panel="comments"` | `features/editor-review/comments/CommentThreadPanel.tsx` | 线程面板边界 |
| `data-df-comment-thread={threadId}` | `features/editor-review/comments/CommentThreadPanel.tsx` | 线程条目（state：open/resolved） |
| `data-df-comment-thread-detail={threadId}` | `features/editor-review/comments/CommentThreadPanel.tsx` | 展开的线程详情 |
| `data-df-comment-resolved-toggle` | `features/editor-review/comments/CommentThreadPanel.tsx` | 「已解决（n）」展开开关 |
| `data-df-comment-reopen={threadId}` | `features/editor-review/comments/CommentThreadPanel.tsx` | 行内「重新打开」（已解决条目） |
| `data-df-sample="comments/empty"`、`"comments/resolved"` | `CommentThreadPanel.tsx` | 空态 / 已解决分段的取样根 |

### 版本（`/editor` 评审面）

| 挂点 | 所在文件 | 用途 |
|---|---|---|
| `data-df-versions-toggle` | `features/editor-review/versions/VersionsButton.tsx` | 「版本历史」开关 |
| `data-df-versions-root` | `features/editor-review/versions/VersionsDrawer.tsx` | 版本抽屉根 |
| `data-df-version-capture` | `features/editor-review/versions/VersionsDrawer.tsx` | 「留存版本」按钮 |
| `data-df-version-row` | `features/editor-review/versions/VersionsDrawer.tsx` | 版本行（`data-df-version-id`、`data-df-version-time`、`data-df-state`） |
| `data-df-version-compare` / `data-df-version-column` / `data-df-version-page` / `data-df-version-diff` / `data-df-version-unchanged` / `data-df-version-confirm` | `features/editor-review/versions/VersionCompare.tsx` | 并排对比浮层、列、页、差异与确认 |
| `data-df-sample="versions/empty"` | `VersionsDrawer.tsx` | 版本空态 |

### 演示（`/editor` 全屏层）

| 挂点 | 所在文件 | 用途 |
|---|---|---|
| `data-df-present-toggle` | `features/editor-review/present/PresentButton.tsx` | 「演示」入口 |
| `data-df-presenter` | `features/editor-review/present/Presenter.tsx` | 全屏层根（`data-df-slide-index` 为当前页序号） |
| `data-df-present-stage` | `features/editor-review/present/Presenter.tsx` | 舞台（state：empty/slide） |
| `data-df-present-controls` | `features/editor-review/present/Presenter.tsx` | 控制条（state：visible/hidden） |
| `data-df-present-page` | `features/editor-review/present/Presenter.tsx` | 页码文本 |
| `data-df-sample="present/empty"` | `features/editor-review/present/Presenter.tsx` | 无页空态 |

### 右栏（编辑器壳的右槽）

| 挂点 | 所在文件 | 用途 |
|---|---|---|
| `data-df-slot="right-panel"` | `features/editor-shell/ui/editor-shell.tsx` | **右栏作用域根**（见下节纪律） |
| `data-df-workspace="right-panel"` | `features/canvas/workspace/slots.tsx` | 工作区右栏内部容器（**不是**槽位选择器） |
| `data-df-workspace="inspector"` | `features/canvas/workspace/slots.tsx` | 工作区 Inspector 内部容器（同上） |
| `data-df-panel="image"` | `features/image/components/ImagePanel.tsx` | 出图抽屉 |
| `data-df-panel="ai"` | `features/ai/components/AiDrawer.tsx` | AI 抽屉 |
| `data-df-ai-entry` | `features/canvas/workspace/slots.tsx` | 工具栏 AI 入口（`aria-pressed` 跟随开合） |
| `data-df-export-hint="need-save"` | `features/canvas/workspace/slots.tsx` | 导出前未落盘提示 |

右栏页签（检查 / 代码 / 导出 / 出图）是 `@dforge/ui` 的 `SegmentedControl`——**按 radio 找**。

### 市场（`/market`、`/market/panel`、`/dashboard`）

| 挂点 | 所在文件 | 用途 |
|---|---|---|
| `data-df-page="market-home"` | `app/market/page.tsx`、`features/market/components/FilterBar.tsx` | 市场首页 |
| `data-df-page="market-panel"` | `features/market/panel/MarketPanel.tsx` | 右栏市场面板 |
| `data-df-market="filter-bar"` | `features/market/components/FilterBar.tsx` | 筛选条 |
| `data-df-market="kind-tabs"` | `features/market/components/FilterBar.tsx` | 类型分段（radio） |
| `data-df-market="result-count"` | `features/market/components/FilterBar.tsx` | 「共 N 个资源」统计行 |
| `data-df-market="grid"` + `data-df-count={n}` | `features/market/components/CardGrid.tsx` | 卡片网格（已载卡片数） |
| `data-df-market="card"` | `features/market/components/MarketCard.tsx` | 资源卡（`data-df-asset` / `data-df-kind` / `data-df-gate` / `data-df-state`） |
| `data-df-market="card-open"` | `features/market/components/MarketCard.tsx` | 卡片主入口 |
| `data-df-market="badge"` + `data-df-badge={loaded\|update\|yanked\|kind\|source\|license\|score}` | `MarketCard.tsx`、`Badges.tsx` | 角标 |
| `data-df-market="pagination"` | `app/market/page.tsx` | 分页行（「加载更多」/「已全部加载（N）」）——**可达性判据** |
| `data-df-market="panel-list"` / `"panel-row"` / `"panel-detail"` / `"panel-run"` / `"panel-adopt"` / `"panel-open-detail"` / `"panel-gate"` | `features/market/panel/MarketPanel.tsx` | 右栏市场面板各行 |
| `data-df-market="detail-*"`（`detail-actions` / `detail-back` / `detail-overview` / `detail-install` / …） | `features/market/components/AssetDetailView.tsx` | 详情页分区与动作 |
| `data-df-market="empty-note"` / `data-df-empty={kind}` | `features/market/components/MarketStates.tsx` | 空态（no-result 等） |
| `data-df-market="progress"` 等 | `features/dashboard/DashboardView.tsx` | 看板分区（`data-df-page="dashboard"`） |

### 设置 / 诊断（`/settings`）

| 挂点 | 所在文件 | 用途 |
|---|---|---|
| `data-df-settings-section={id}` | `features/settings/components/settings-page.tsx` | 设置分区根（当前分区 id） |
| `data-df-panel="diagnostics"` | `features/diagnostics/components/DiagnosticsPanel.tsx` | 诊断面板 |
| `data-df-diagnostics-error="daemon"` | `features/diagnostics/components/DiagnosticsPanel.tsx` | 诊断错误态 |
| `data-df-env-row={id}` | `features/diagnostics/components/DiagnosticsPanel.tsx` | 环境变量行 |
| `data-df-connectivity-item={id}` / `data-df-connectivity-status={status}` | `features/diagnostics/components/DiagnosticsPanel.tsx` | 连通性条目与状态 |

## 分段控件 = 原生 radio + label（点 label，不按 button 找）

`@dforge/ui` 的 `SegmentedControl`（`packages/ui/src/components/SegmentedControl.tsx`）用
**原生单选**渲染：容器 `role="radiogroup"` + `aria-label`，每项是
`label > input[type=radio].dfg-visually-hidden`。因此：

```js
// 正确：按单选语义点 label（可访问名 = 项文案）
await page.getByRole('radio', { name: '列表' }).click();
// 或按组限定，避免同名项跨面撞名
const tabs = page.getByRole('radiogroup', { name: '视图' });
await tabs.getByRole('radio', { name: '列表' }).click();
```

```js
// 错误：分段项不是 button，按 button 找会超时/假红
await page.getByRole('button', { name: '列表' }).click();
```

先例（单测）：`features/home/components/FilterRow.test.tsx`（`radiogroup` + `radio` 视图切换）、
`features/editor-panels/components/AssetsPanel.test.tsx`（组件 / Token 分段）、
`features/editor-panels/components/EditorPanels.test.tsx`（图层 / 资产页签）。
Playwright 的 `getByRole('radio')` 对视觉隐藏的原生 radio 同样有效（label 包裹可点）。

## 左右栏读作用域（retro F-03）

读**右栏**状态时必须先限定槽位、再取控件：

```js
const right = page.locator('[data-df-slot="right-panel"]');
await right.getByRole('radio', { name: '导出' }).click(); // 只点右栏的页签
```

- 左栏 = `[data-df-slot="left-panel"]`，画布 = `[data-df-slot="canvas"]`。
- **禁止**全页 `getByText(/导出/)` / `getByRole(...)` 裸查：左右栏可能同名（中栏页签、工具栏
  与面板都有「导出」「图层」一类词），撞名会把断言落到另一面（F-03 就是这样假红的）。
- `data-df-workspace="right-panel"` / `"inspector"` 只是工作区内部子分组标记，**不得**当作
  槽位作用域使用；槽位契约只有 `data-df-slot`。

## aria 前缀约定（retro F-07）

同一可见文本在不同面出现时，**可访问名必须带界面面前缀**，脚本用前缀正则消歧：

| 面 | 前缀 | 示例（实际 i18n） |
|---|---|---|
| 画布钉点 | `画布钉点：` | `画布钉点：{body}`；已解决 `画布钉点：已解决·{body}` |
| 面板线程条目 | `面板线程：` | `面板线程：{body}` |
| 已解决评论分组开关 | `已解决评论分组` | `已解决评论分组（{count}）`（可见文本仍是 `已解决（{count}）`） |

- **禁止**用 `/已解决/` 这类裸正则跨面匹配：它会同时命中画布钉点（已解决态）与面板开关
  （F-07 的根因）。画布侧用 `/^画布钉点：/`，面板侧用 `已解决评论分组（n）`。
- 新交互元素：`aria-label` 必须带界面前缀，且不得与其它面的可访问名同名；新增控件须
  同步补单测（可访问名断言）与 `zh-CN.json` / `en.json` 键。约定见
  `implementation-workflow.md`「代码规范」（批次 5 · D）。

## 机器人脚本与证据纪律

- 脚本产物（截图、证据 JSON、probe 输出、benchmark）一律落
  `~/df-evidence/<票号>/`（仓外）；仓库只存代码与文档，**不得**依赖 `artifacts/` 传证据。
- 脚本用**稳定挂点 + role/name**；不要按 DOM 层级、样式类或全页文本正则取样。
- 浏览器门禁一律 `next build` + `next start`（生产构建），不要用 `next dev` 跑 live 取证。
- 证据字段按《前端验收标准 v1》§4；参照集未冻结时门禁 `exit 2`（阻塞），不得当绿。
