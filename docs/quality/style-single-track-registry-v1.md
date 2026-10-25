# 样式单轨 · 内联样式豁免登记表 v1

常驻真源（原载工单 06 `.scratch/frontend-rework/issues/06-ds-style-single-track.md`，
2026-10 修复批迁入 docs/quality 常驻——工单树会随批次归档，豁免登记是**长期口径**，须常驻可查）。

**口径**：应用层（`apps/web/src`）内联 `style={` 仅保留三类场景并逐条登记于此——
**几何算式**（CSS 无法表达的世界坐标 → 屏幕换算）、**动态值**（运行时数据驱动的取值）、
**非样式**（产物字符串等形似实非）。其余一律迁域内 CSS + 类名，由
`guard:tokens`（R1-R4 对 `.css` 同权扫描）与组件测试同轨约束。

**守卫**：`apps/web/src/verify/style-single-track.test.ts` 扫描 `apps/web/src` 非测试源码的
全部 `style={` 出现点，逐条比对本表（本表首列为仓库相对路径，测试解析本表），双向断言：

- 代码里冒出未登记的内联样式 → 测试红（迁 CSS，或在此登记理由）；
- 本表条目指向已不再有 `style={` 的文件 → 测试红（撤销登记）。

即：**改样式路径的票必须同批维护本表**，保持代码面与登记面一致。

## 登记表

| 路径 | 类别 | 理由 |
| --- | --- | --- |
| apps/web/src/features/canvas/ui/floating-toolbar.tsx | 几何算式 | C9 浮层工具条锚点 `left/top` 由画布世界坐标 × zoom + pan 算出（CSS 无法表达世界坐标换算） |
| apps/web/src/features/canvas/ui/context-menu.tsx | 几何算式 | C11 右键菜单容器 `left/top` = 右键指针坐标（画布容器内 CSS 像素）；并按 `DENSITY` 常量行内覆盖 `--dfg-row-height-md`（覆盖的是令牌值，非裸值） |
| apps/web/src/features/canvas/ui/text-overlay.tsx | 几何/文档数据 | C10 文本覆盖层 `left/top/width/height` = 世界矩形经 `nodeOverlayBox` 共享换算（× zoom + pan + 祖先旋转），`fontSize/letterSpacing` 随 zoom 缩放、颜色取节点填充（文档数据）；基线样式 `OVERLAY_BASE` 与几何值合成同一对象注入 |
| apps/web/src/features/editor-review/comments/CommentLayer.tsx | 几何算式 | 钉点/预览卡/草稿卡屏幕坐标 = 世界坐标 × zoom + pan（+ 常量偏移）；其余视觉已全部落 review.css |
| apps/web/src/features/editor-review/present/SlidePreview.tsx | 几何/文档数据 | 幻灯片缩放尺寸（宽高 = 画板尺寸 × fitScale）与画板底色来自 Design IR 文档数据——按图渲染是本分，颜色不是界面令牌 |
| apps/web/src/features/editor-panels/components/AssetsPanel.tsx | 动态值（文档数据） | Token 色块 `background` = 文档令牌解析值（任意色，非界面令牌；与 inspector/controls.tsx 同类；底座样式已在 editor-panels.css） |
| apps/web/src/features/editor-panels/components/LayerContextMenu.tsx | 几何算式 | 菜单容器 `position: fixed` 的 `left/top` = 右键指针视口坐标（与 floating-toolbar 同类几何换算） |
| apps/web/src/features/dashboard/DashboardView.tsx | 动态值 | 看板 meter 填充宽度 = 数据百分比（时效分桶计数 / 最大值） |
| apps/web/src/features/market/components/QualityPanel.tsx | 动态值 | 质量 meter 填充宽度 = 维度得分百分比 |
| apps/web/src/features/inspector/components/controls.tsx | 动态值 | 字段色样 `background` = 文档令牌解析值（文档数据，非界面样式；底座样式已在 inspector.css） |
| apps/web/src/app/_design/page.tsx | 动态值 | 预览页色样/圆角样取值 = 运行时枚举的令牌变量引用（`var(${name})`，枚举对象是数据） |
| apps/web/src/features/inspect-export/model/codegen.ts | 非样式 | 生成的**代码文本**（codegen 产物字符串，不是运行时样式路径） |

## 变更记录（增补/撤销随票登记）

- **RW-13（图层面板 Tree 接入同批）**：`LayerRow.tsx` 随面板重写删除——行深缩进改由 Tree 的
  组级联（`.dfg-tree__group`）承接，`--dfg-layer-depth` 行内注入不复存在，豁免随之撤销；
  `EditorPanels.tsx` 的两处内联样式对象迁移为 editor-panels.css 类（`.dfg-panels__group` /
  `__tab-strip`），退出登记；增补 `AssetsPanel.tsx` / `LayerContextMenu.tsx`（FE-04 既有内联
  样式补登记，此前漏登，属工单 06 的存量债）。
- **2026-10 修复批（code-review P1-1 对表）**：登记面与代码面曾失真——全仓 `style={` 实得
  16 个非测试文件，本表只覆盖 10 个。对表处置：
  - 迁出豁免面（改类名，未登记）：`market/panel/MarketPanel.tsx`（残留 `hintStyle` 引用，06 首批
    漏改）、`app/dashboard/page.tsx` 与 `app/market/[assetId]/page.tsx`（对 06 首批已删除的
    `headerStyle` 等样式对象仍存幻影导入，编译即断）——三处均迁 market.css 版式类；
  - 删除无主 API：`canvas/ui/canvas-stage.tsx` 的 `style` 透传 prop（仓内无任何调用方注入，
    亦非几何/动态值场景）——`style={` 出现点随 prop 移除消失，不登记；
  - 补登：`canvas/ui/context-menu.tsx`、`canvas/ui/text-overlay.tsx`（canvas 域几何/文档数据
    场景，此前漏登）。
  终态：12 条（上表），与代码面双向一致。
