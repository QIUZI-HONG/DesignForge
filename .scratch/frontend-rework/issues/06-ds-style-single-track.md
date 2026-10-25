# 06: ds · 样式单轨化

**What to build:** 应用层内联样式对象收敛为组件类/CSS（内联仅保留几何算式场景并豁免登记）；主题切换只剩一条路径；guard:tokens 对两轨同等约束。按域分批提交，每批保持门禁全绿。

**Blocked by:** 02

**Status:** code-complete（待 dev 机验证——本机 Windows/WSL 均无 node，未实跑）

blockers: 02

- [x] 应用层不再存在内联颜色/间距/圆角裸值路径（豁免清单登记）——8 个 styles.ts 全部删除，域内 CSS（ai/image/mcp/diagnostics/editor-panels/review/market/settings/design）+ 类名承接；guard R1-R4 对 `.css` 同权扫描（`DEFAULT_ROOTS` 含 `apps/web/src`，`SCAN_EXTENSIONS` 含 `.css`）
- [ ] 相关组件测试与视觉冒烟全绿（按域批次均绿）——**待 dev 机验证**（组件测试已随批改造：类挂载 + CSS 规则文本断言；jsdom 不计算 External CSS，先例 `verify/a11y-keyboard.test.tsx`）
- [x] 主题切换路径唯一（暗色编辑器族/浅色首页族切换无分叉）——所有内联颜色分支（如 stepAccent 按状态算色、modeToggleOn 按开合合对象）删除，色值一律由 `data-theme` 下的令牌变量与状态选择器承接

## 内联样式豁免登记表（验收 §1 的「豁免清单登记」）

静态守卫：`apps/web/src/verify/style-single-track.test.ts` 扫描 `apps/web/src` 的 `style={`
出现点，**逐条比对本表**（首列为仓库相对路径，测试解析本表）；未登记的内联样式即测试红。

| 路径 | 类别 | 理由 |
| --- | --- | --- |
| apps/web/src/features/canvas/ui/floating-toolbar.tsx | 几何算式 | C9 浮层工具条锚点 `left/top` 由画布世界坐标 × zoom + pan 算出（CSS 无法表达世界坐标换算） |
| apps/web/src/features/editor-review/comments/CommentLayer.tsx | 几何算式 | 钉点/预览卡/草稿卡屏幕坐标 = 世界坐标 × zoom + pan（+ 常量偏移）；其余视觉已全部落 review.css |
| apps/web/src/features/editor-review/present/SlidePreview.tsx | 几何/文档数据 | 幻灯片缩放尺寸（宽高 = 画板尺寸 × fitScale）与画板底色来自 Design IR 文档数据——按图渲染是本分，颜色不是界面令牌 |
| apps/web/src/features/editor-panels/components/LayerRow.tsx | 动态值 | 行深经 `--dfg-layer-depth` 自定义变量行内注入，喂 editor-panels.css 的缩进 calc 算式（`attr()` 进 calc 浏览器尚不可用） |
| apps/web/src/features/dashboard/DashboardView.tsx | 动态值 | 看板 meter 填充宽度 = 数据百分比（时效分桶计数 / 最大值） |
| apps/web/src/features/market/components/QualityPanel.tsx | 动态值 | 质量 meter 填充宽度 = 维度得分百分比 |
| apps/web/src/features/inspector/components/controls.tsx | 动态值 | 字段色样 `background` = 文档令牌解析值（文档数据，非界面样式；底座样式已在 inspector.css） |
| apps/web/src/app/_design/page.tsx | 动态值 | 预览页色样/圆角样取值 = 运行时枚举的令牌变量引用（`var(${name})`，枚举对象是数据） |
| apps/web/src/features/inspect-export/model/codegen.ts | 非样式 | 生成的**代码文本**（codegen 产物字符串，不是运行时样式路径） |

## 逐域提交

| 域 | 提交 | 说明 |
| --- | --- | --- |
| ai | e053e24 | aiStyles → ai.css；stepAccent → data-df-step-status 状态选择器 |
| image | c8873e9 | imageStyles → image.css |
| mcp | bc1ac44 | mcpStyles → mcp.css |
| diagnostics | ec7ea1a | diagnosticsStyles → diagnostics.css |
| editor-panels | 0784bb9 | 四组对象 → editor-panels.css；行交互态走 data-df-* 事实（新增 focus-ring/dimmed/active/layer-type 投影）；行深动态值豁免 |
| editor-review | df89dcf | 四组对象 → review.css；几何/文档数据豁免；barrel 样式出口移除 |
| market | 68359dc | 约 40 个导出对象 → market.css；badge/meter tone → 修饰类；app 三页 + dashboard 消费方同批 |
| settings + design | 8e9bbbd | 五组件本地对象 → settings.css；/_design → design.css；hover 改伪类 |
| 守卫与登记 | （本提交） | 豁免登记表 + verify/style-single-track 守卫测试 + guard 覆盖确认 |

