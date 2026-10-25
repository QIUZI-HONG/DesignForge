# 06: ds · 样式单轨化

**What to build:** 应用层内联样式对象收敛为组件类/CSS（内联仅保留几何算式场景并豁免登记）；主题切换只剩一条路径；guard:tokens 对两轨同等约束。按域分批提交，每批保持门禁全绿。

**Blocked by:** 02

**Status:** code-complete（待 dev 机验证——本机 Windows/WSL 均无 node，未实跑）

blockers: 02

- [x] 应用层不再存在内联颜色/间距/圆角裸值路径（豁免清单登记）——8 个 styles.ts 全部删除，域内 CSS（ai/image/mcp/diagnostics/editor-panels/review/market/settings/design）+ 类名承接；guard R1-R4 对 `.css` 同权扫描（`DEFAULT_ROOTS` 含 `apps/web/src`，`SCAN_EXTENSIONS` 含 `.css`）
- [ ] 相关组件测试与视觉冒烟全绿（按域批次均绿）——**待 dev 机验证**（组件测试已随批改造：类挂载 + CSS 规则文本断言；jsdom 不计算 External CSS，先例 `verify/a11y-keyboard.test.tsx`）
- [x] 主题切换路径唯一（暗色编辑器族/浅色首页族切换无分叉）——所有内联颜色分支（如 stepAccent 按状态算色、modeToggleOn 按开合合对象）删除，色值一律由 `data-theme` 下的令牌变量与状态选择器承接

## 内联样式豁免登记表（已迁出，此处不再维护）

登记表已迁 **`docs/quality/style-single-track-registry-v1.md`**（常驻真源——工单树会随批次归档，
豁免登记是长期口径；守卫测试 `apps/web/src/verify/style-single-track.test.ts` 已改从新位置解析）。
2026-10 修复批同步做了登记面与代码面的对表（market 三文件迁出豁免面、canvas 两件补登、
`canvas-stage.tsx` 无主 style 透传 prop 删除），变更记录见新登记表的「变更记录」节。

## 逐域提交

| 域 | 提交 | 说明 |
| --- | --- | --- |
| ai | e053e24 | aiStyles → ai.css；stepAccent → data-df-step-status 状态选择器 |
| image | c8873e9 | imageStyles → image.css |
| mcp | bc1ac44 | mcpStyles → mcp.css |
| diagnostics | ec7ea1a | diagnosticsStyles → diagnostics.css |
| editor-panels | 0784bb9 | 四组对象 → editor-panels.css；行交互态走 data-df-* 事实（新增 focus-ring/dimmed/active/layer-type 投影）；行深动态值豁免 |
| editor-review | df89dcf | 四组对象 → review.css；几何/文档数据豁免；barrel 样式出口移除 |
| market | 68359dc | 约 40 个导出对象 → market.css；badge/meter tone → 修饰类；app 消费方**部分**同批（首页 `/market` 与面板页 `/market/panel`）——详情页 `/market/[assetId]`、看板 `/dashboard` 与 `MarketPanel` 当时漏迁，残留对已删样式对象的引用（幻影导入），由 2026-10 修复批补迁 market.css 版式类 |
| settings + design | 8e9bbbd | 五组件本地对象 → settings.css；/_design → design.css；hover 改伪类 |
| 守卫与登记 | （本提交） | 豁免登记表 + verify/style-single-track 守卫测试 + guard 覆盖确认（登记表后迁 docs/quality 常驻，见上节指针） |
| 修复批对表 | （2026-10 修复批） | code-review P1-1：market 三文件迁出豁免面；canvas `context-menu` / `text-overlay` 补登；`canvas-stage.tsx` 无主 style 透传 prop 删除——登记面与代码面恢复双向一致（登记表 12 条） |

