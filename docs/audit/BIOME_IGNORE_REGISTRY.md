# biome-ignore 例外登记表（audit-d10 · D-17）

> 仓规（`docs/agents/implementation-workflow.md`「代码规范」）：**禁 lint 抑制**；确需例外必须
> 单人复核并在代码里写明原因。本表是 2026-11-07（audit-d10）对全仓 `biome-ignore` 的逐条复核
> 登记结果：**全仓共 10 条真实抑制，逐条复核后 0 删 10 留**——每条上下文都核实过「合规写法
> 不存在或代价不成比例」，原因已写在代码内（下表与代码同源）。复核方式：全仓
> `git grep -n "biome-ignore"`（排除 docs/lockfile；`.scratch/ux-audit-remediation/_shared-brief.md`
> 的命中是介绍仓规的散文，非抑制），逐条读上下文评估可否改合规写法。
> 另核查 `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` / `eslint-disable`：**全仓 0 条**。
> 纪律：本表新增条目 = 新的 lint 抑制 = 须走同一条单人复核流程；禁用本表变相扩容。

| # | 文件:行 | 规则 | 原因（复核后维持，代码内有同源注释） | 复核日期 |
|---|---|---|---|---|
| 1 | `apps/web/src/features/command-palette/command-palette.tsx:225` | `lint/a11y/noStaticElementInteractions` | combobox 模式的卡片容器只接**冒泡**键位（焦点宿主是搜索输入框；点击 option 后焦点短暂落在 `tabIndex={-1}` 的 option 上，键位处理必须留在容器才能接住）——把 onKeyDown 挪到输入框会在点击后丢键盘导航，属行为回归 | 2026-11-07 |
| 2 | `apps/web/src/features/command-palette/command-palette.tsx:261` | `lint/a11y/useKeyWithClickEvents` | `aria-activedescendant` combobox 漫游模式：option **刻意不可聚焦**，键盘执行统一经搜索框 Enter；给 option 补 onKeyUp 是永不触发的死代码（为过检而写），比抑制更差 | 2026-11-07 |
| 3 | `apps/web/src/features/editor-panels/components/LayersPanel.tsx:313` | `lint/a11y/noStaticElementInteractions` | 图层右键菜单是设计工具惯例（Figma 同款）；键盘等价路径由 Tree 行内漫游（roving tabindex）承担。合规改法需给 Tree 增加行级 onContextMenu API（跨组件重构，非卫生批范围），且现有键盘路径已覆盖同一功能 | 2026-11-07 |
| 4 | `apps/web/src/features/editor-shell/bootstrap/registry.ts:39` | `lint/suspicious/noConfusingVoidType` | `setup: () => void \| (() => void)` 的「无返回或返回清理函数」正是登记项口径本体（与 React `EffectCallback` 同型）；合规改法（返回 `undefined \| 清理函数`）会级联改所有具名登记函数与测试的签名，收益为零 | 2026-11-07 |
| 5 | `apps/web/src/features/home/components/HomeTopbar.tsx:85` | `lint/a11y/noStaticElementInteractions` | 容器只**观察**焦点进出（React 的 onFocus/onBlur 底层是 focusin/focusout，会冒泡，必须挂包裹层才能在「焦点移到结果面板内部」时不误收）；自身无点击/键盘动作，给交互 role 会把装饰性包裹层塞进无障碍树 | 2026-11-07 |
| 6 | `apps/web/src/features/inspect-export/components/CodeExportPanel.tsx:84` | `lint/a11y/noNoninteractiveTabindex` | 代码区是**可滚动区域**（长代码溢出），`tabIndex={0}` 是 WCAG 的滚动区键盘可达手法（方向键滚动）；该规则的放行名单（tabpanel）与「可滚动只读区」语义不符，套 tabpanel/交互 role 反而是假语义 | 2026-11-07 |
| 7 | `packages/ui/src/components/Drawer.tsx:105` | `lint/a11y/noStaticElementInteractions` | 遮罩 onClick 是「点外面关掉」的鼠标便捷路径，键盘等价路径是 Esc 与关闭按钮；遮罩不是控件，给 role 反而污染无障碍树（Radix 同款行为在库内 JS 实现，规则看不见） | 2026-11-07 |
| 8 | `packages/ui/src/components/Modal.tsx:74` | `lint/a11y/noStaticElementInteractions` | 同 #7（模态遮罩，与抽屉同构共用浮层栈行为） | 2026-11-07 |
| 9 | `packages/ui/src/components/Tooltip.tsx:145` | `lint/a11y/noStaticElementInteractions` | 包裹层只观察悬停/聚焦；交互都不落在它身上。必须挂外层：**禁用控件自身不派发事件**（F15 禁用原因提示正需要这种包裹），内挂收不到 disabled 锚点的 hover/focus | 2026-11-07 |
| 10 | `packages/ui/src/components/Tree.tsx:488` | `lint/a11y/useSemanticElements` | 子层容器是 WAI-ARIA tree 模式的固定结构 `role="group"`；唯一「等价」语义元素 fieldset 自带默认边框/内边距，在共享组件里会引入视觉回归，且 fieldset 语义（表单分组）并不比 group 更贴切 | 2026-11-07 |
