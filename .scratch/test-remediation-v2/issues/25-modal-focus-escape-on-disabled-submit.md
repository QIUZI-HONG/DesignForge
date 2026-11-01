# 25: fix · 异步提交期间焦点被 `disabled` 踢出浮层，Esc 与焦点陷阱同时失效

**What to build:** 浮层开着的时候，键盘焦点**不得**逃出该浮层。现状：`packages/ui/src/components/Button.tsx:72` 用原生
`disabled={isDisabled}`（`isDisabled = disabled === true || loading`，`:59`），而浏览器规范里 **disabled 的表单控件不可聚焦**——
焦点所在元素一旦变 disabled，焦点即被交回 `<body>`。`AiDrawer` 的「生成」按钮正是这个形状：
`apps/web/src/features/ai/components/AiDrawer.tsx:114-117` 同时给 `disabled={running}` 与 `loading={running}`，
于是**点下「生成」的那一瞬间，焦点就从抽屉里消失了**。

后果不是「不好看」，是两条无障碍保证同时失效：

1. **Esc 关不掉浮层**。`packages/ui/src/components/Drawer.tsx:113` 的 `onKeyDown={behavior.onKeyDown}` 挂在 backdrop 上，
   只能收到从浮层子树冒泡上来的按键；焦点在 `<body>` 时事件路径里根本没有 backdrop
   （`packages/ui/src/utils/use-overlay.ts:190-201` 的 Esc/`trapTabKey` 都在这个 handler 里）。
2. **Tab 焦点回环失效**。同一个 handler 负责 `trapTabKey`，收不到事件就等于没有回环——键盘用户可以直接 Tab 到浮层背后的画布与工具栏，
   而 `aria-modal="true"`（`Drawer.tsx:120`）还在告诉读屏器「模态里」。

**实测证据（三轮 UI 段，`~/df-evidence/r3-main/default.log` 与 `optin.log` 两份一致）**：
门禁 `scripts/verify-ai-two-state.mjs` 第③步的点击修好之后（旧选择器把「生成」限定在 `.dfg-drawer__body` 内、
而按钮在 footer，结构上永不可达——见票 05），UI 段第一次真正走完降级提交：
`ui.degraded-suggestions` 与 `ui.degraded-result-nonblank` 双双 `[ok]`（截图 `~/df-evidence/fe-10/ui-ai-drawer.png`：
四步全「已完成」、「本地模板」角标 + 建议标题正文都在），随后第④步
`await page.keyboard.press('Escape')` → `waitForSelector('[data-df-panel="ai"]', {state:'detached'})` **30s 超时**
→ `ui.check.crashed=FAIL` → 门禁诚实退 **1**。此前这一步从未被执行到，所以缺陷一直隐身。

**为什么是本票而不是「门禁写错」**：可以改门禁（Esc 前先 `page.locator('[data-df-panel="ai"]').focus()`）让它变绿，
但那是把真实缺陷重新藏起来——键盘用户点完「生成」之后确实关不掉抽屉、也确实能 Tab 出去。
**禁止**用改判据/加超时/改 SKIP 三种方式收口本票（票 05 与票 06 的同一纪律）。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] 先做**确定性判据**（不靠赛跑）：`packages/ui` 的 Drawer/Modal 测试里，聚焦按钮 → 置 `loading` → 断言
  `document.activeElement` 仍在浮层容器内（现在会断到 `body`）。这条判据必须先红后绿。
- [ ] 收口浮层自身（推荐落点）：`useOverlayBehavior` 在层开着时监听 `focusout`/`blur`，
  若 `document.activeElement` 落到浮层之外（含 `body`）就把焦点交还给容器（`containerRef`，`tabIndex={-1}` 已具备）。
  这把「焦点陷阱」从「只拦 Tab」升级为「栈顶层的不变量」，Modal 与 Drawer 一并受益。
- [ ] `Button` 侧的取舍要写清并只选一处：`aria-disabled` + 自行拦截激活行为（可保持可聚焦，但需检查所有调用方是否依赖原生 disabled 的表单语义），
  还是保留 `disabled` 由上一条的浮层不变量兜住。**若选后者，本条不改动 Button**，只在工单里记「异步期间焦点由浮层接管」。
- [ ] 复跑 `pnpm run verify:ai-two-state` 直到 UI 段四步全 `[ok]`；段 B 默认跳过仍应退 **2**（不是 0，也不是 1）。
  日志与截图入 `~/df-evidence/25/`。
- [ ] 顺带核一遍同族的其它异步按钮（导出面板、上传、保存）是否也在 loading 期间 `disabled` 自己——同一形状的失焦面。

## 归属与级别

三轮 UI 实跑验证人判定「两步红是选择器越界，非产品缺陷」的同时，让第④步第一次跑到，从而**新暴露**出本缺陷。
它不是本分支引入的（`Button.tsx:72` 与 `use-overlay.ts:190` 都在基线里），但它是**用户可见**的无障碍缺陷，
且被本分支修好的门禁步骤直接钉住，因此单列一票、级别按 a11y 主功能缺陷计，不并入票 05/06 的门禁卫生族。
