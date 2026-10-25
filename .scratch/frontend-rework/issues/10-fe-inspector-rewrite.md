# 10: fe · Inspector 重写

**What to build:** Inspector 重写：选中切换即时刷新、键盘焦点落位合理、数值 scrubbing（拖拽改值）、效果分区（可见且可调，联动画布）。

**Blocked by:** 07, 09

**Status:** code-complete（待 dev 机验证——本机 Windows/WSL 均无 node，未实跑）

blockers: 07,09

- [ ] 点击节点→面板反映延迟达标（M3 口径）——已实现 zustand 选择态自订阅（`selectionStore`，工作区 `PanelsUiStore` 结构兼容）+ memo 分区（页签/折叠切换不重渲字段树）；延迟实测待 dev 机
- [x] 数值 scrubbing 可用（含撤销一步回退）——全数值字段（位置/尺寸/旋转/圆角/间距/效果参数/不透明度）经 scrub 会话（`model/scrub-session`，引擎 interaction 会话同语义：拖拽零写入、松手单事务）
- [x] 效果分区调值画布实时联动——效果列表可见（`readEffects` 三态）+ 增/删/改/可见性经 node.update 命令族，单事务落栈（09 渲染已就绪）
- [x] 焦点管理：面板内 Tab 序稳定——UI-kit Tabs roving tabindex（设计/导出双页签）+ Collapse 触发器原生按钮序；折叠开合跨选中切换记忆
