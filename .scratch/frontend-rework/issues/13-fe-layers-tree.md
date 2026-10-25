# 13: fe · 图层面板树接入

**What to build:** 图层面板接入树控件：展开/折叠、重命名、拖拽排序、选中与画布双向联动。

**Blocked by:** 07

**Status:** code-complete（待 dev 机验证——本机 Windows/WSL 均无 node，未实跑）

blockers: 07

- [ ] 树操作全链路可用且与画布选中双向同步——**代码完成，测试待 dev 机执行（本机无 node）**
- [ ] 大图层树（千级节点）展开滚动不卡顿——**代码完成（零依赖渲染窗口化），测试待 dev 机执行**
- [ ] 组件级测试覆盖——**代码完成（LayersPanel.test.tsx 重写 + tree-drop.test.ts 新增），待 dev 机执行**

## 交付纪要（RW-13 消费口径，代码内注释同源）

- **Tree 接入**：`LayersPanel` 重写为消费 `@dforge/ui` Tree（RW-07）；文档树 → `TreeNodeSpec`
  映射抽在 `components/layers-tree-model.tsx`（同级逆绘制顺序、类型图标落 `data-df-layer-type`）。
- **单选与双向联动**：Tree `selectedId` = 选择集 `activeId`（Tree v1 单选语义，画布多选时面板只高亮
  主选中行）；画布写入 → 面板滚动定位（`scrollIntoView nearest`）+ 自动展开折叠的祖先链。
- **落位约定（兑现 RW-07 留给本票的「落位语义」，真源 `commands/tree-drop.ts`）**：
  Tree `onReorder(source, target)` 只上报拖拽对；指针 Y 由面板 document 级 `dragover` 自记、
  target 行矩形 drop 时量取；**上/下各半**判定插入位置（上=之前/下=之后，中点归下半，
  无指针按「之前」降级）；**跨父拖拽 = reparent**（`moveLayerCommands` →
  `reparentPreservingWorldCommands`，世界位置保持）；一次 drop 恰好一次 `session.run`（单事务，
  不碰 `CommandStack.enqueue` 合并语义）；「放入容器内部」不在 Tree v1 约定内（拖入容器 =
  展开后落到其子行上；空/折叠容器走画布拖拽）。
- **重命名**：Tree 行内编辑（双击/F2）→ `renameLayerCommands`（`node.update` 补丁）。
  右键菜单**移除「重命名」条目**（Tree v1 编辑态是组件私有状态，菜单无法触达；行内入口更短），
  菜单保留删除/编组/解组/上移到顶/下移到底。
- **行级状态**：`disabled` = 实例虚节点（结构只读：不可选中/拖拽/重命名，键盘跳过；
  选中与属性编辑走画布/Inspector）；`loading`/`error` 在同步命令栈文档下不产生，挂点透传留给
  后续异步装载票（不给 `onRetry` 即关闭错误行入口）。
- **千级图层（零依赖窗口化取舍）**：全量 DOM 挂载（树结构/折叠/键盘漫游完整），屏外行的渲染
  跳过交给 CSS `content-visibility: auto` + `contain-intrinsic-size`（editor-panels.css
  `.dfg-panels__tree .dfg-tree__node`）。不做 JS 窗口化：需要切片 Tree 嵌套 group 结构，
  破坏键盘漫游与 aria 语义；引依赖被禁。
- **随重写的取舍（登记待 owner 复核）**：旧 `LayerRow` 的悬停显隐/锁定按钮**不在本票交付内**——
  Tree v1 行上没有尾随操作插槽；可见性/锁定经 Inspector（工单 10 已交付）与画布入口。
  后续如需行上眼睛/锁，需给 `TreeNodeSpec` 扩展 `actions` 槽（DS 票）。
- **样式与门禁同批**：editor-panels.css 图层面重写（死规则随 LayerRow 删除）；EditorPanels 两处
  内联样式对象迁移为类；06 豁免登记表删 `LayerRow.tsx` 行、增补 `AssetsPanel.tsx` /
  `LayerContextMenu.tsx`（FE-04 存量漏登）；verify/selection-parity 组件级两测跟随
  `data-node-id` 新契约（断言意图不变）。
