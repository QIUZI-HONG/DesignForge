# 26: fix · 浮层之外的异步按钮把焦点交回 `<body>`（票 25 扫描的遗留面）

**What to build:** 键盘用户在**页面/面板**（非浮层）上点下异步按钮之后，焦点不得凭空消失。
根因与票 25 同一条：`packages/ui/src/components/Button.tsx:72` 的 `disabled={isDisabled}`
（`isDisabled = disabled === true || loading`，`:59`）——规范里 disabled 的表单控件不可聚焦，
焦点所在元素一变 disabled，浏览器就把焦点交回 `<body>`，用户丢失当前位置。

**范围（票 25 blocker 5 的实测扫描，16 处 `loading=` 里层外的 11 处）**：
`apps/web/src/features/canvas/workspace/save-control.tsx:37`、`canvas/studio/canvas-studio.tsx:434`、
`settings/components/sections.tsx:155,159,214`、`settings/components/cold-start.tsx:140`、
`settings/components/save-footer.tsx:52`、`inspect-export/components/ExportPanel.tsx:106`、
`mcp/components/McpConfirmBar.tsx:198`、`home/components/HomeTopbar.tsx:149`、
`packages/ui/src/components/ErrorState.tsx:70`（页面/面板共用，15 个调用点全在层外）。
层内 5 处不在此列——已由票 25 的 `useOverlayBehavior` 中央收口覆盖。

**与票 25 的分工**：票 25 的解法是「把焦点接回浮层容器」，这里**没有容器可接回**，照抄必然错。
两条可选口径，本票要先选一条再动手（选完在工单里记原因，不许两处混用）：
① `Button` 异步期间不再置原生 `disabled`，改 `aria-disabled="true"` + 自行拦截激活行为（一次改动覆盖全站，
但要逐个确认调用方是否依赖原生 disabled 的表单语义，F15 的灰化 + tooltip 原因口径需保持不变）；
② 提交成功后把焦点显式交给随后可见的元素（结果区 / 状态提示 / 重新启用的按钮），逐处落，改动散但每处局部。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] 定口径（①/②）并写清为什么；①若选，须先给 `Button` 的 16 处 loading 调用方逐个记「是否依赖原生 disabled 语义」
- [ ] 判据必须是**真浏览器**的：jsdom 30 的 `unfocusingSteps` 在旧目标已不可聚焦时直接返回
  （`jsdom/lib/jsdom/living/helpers/focusing.js:194`，实测 disabled 后 `activeElement` 仍留在按钮上、也不发事件），
  在 jsdom 里写「点一下 → 断言焦点没丢」**恒过**，是假判据（同票 25 的教训）
- [ ] 至少一条 Chromium 门禁步：点异步按钮 → 断言 `document.activeElement` 仍在文档内且非 `body`
  （落点按选定口径判），日志与截图入 `~/df-evidence/26/`

## 归属与级别

来源：票 25（三轮 UI 段暴露的浮层缺陷）修复时的同族扫描，**既有**缺陷、非本分支引入。
级别按 a11y 次要缺陷计：不打断主功能（不锁死 Esc/Tab，因为不在 `aria-modal` 层里），
但属 WCAG 2.4.3 焦点顺序 / No Focus Lost 的实质违背。延期记录：2026-11-02 由三轮收口登记，owner = 下一轮开工者。
