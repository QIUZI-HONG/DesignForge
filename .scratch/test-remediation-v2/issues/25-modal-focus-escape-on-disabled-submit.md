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

**Status:** code-complete（`pnpm run verify` 全仓 0、`verify:ai-two-state` 由 1 回到诚实的 2；证据 `~/df-evidence/25/`）

blockers:

- [x] 确定性判据已建，但**口径与工单原文不同，如实记**：原文给的「聚焦按钮 → 置 `loading` → 断言 `activeElement`
  仍在层内」在 jsdom 里**恒过**（假判据）——jsdom 30 的 `unfocusingSteps` 见旧目标已不可聚焦就直接返回
  （`jsdom/lib/jsdom/living/helpers/focusing.js:194`，实测置 disabled 后连 `blur()` 都是空操作，`activeElement`
  仍留在那个已禁用的按钮上），焦点根本没被踢出去，所以断什么都在层内。改为**演浏览器一定会发出的那两个事件**：
  `act` 点击转 loading → `fireEvent.blur` + `fireEvent.focusOut` → 断言落点**就是浮层容器本身**（`toBe(dialog)`，
  不是「不在 body」）。判别力经反向验证：对 HEAD 的 `use-overlay.ts` 这两条（Drawer/Modal 各一）**实跑判红**，
  修复后 `packages/ui` 256/256 绿。
- [x] 浮层自身收口（采用的落点）：`useOverlayBehavior` 在层开着时听 `focusout` + document 捕获阶段的 `blur`，
  把焦点接回容器（`containerRef`，`tabIndex={-1}` 已具备）。**判据取「刚离散的那个元素已不可聚焦（或已摘出文档）」，
  不取「此刻 `activeElement` 是 body」**：一次正常焦点转移在派发序列里**也**经过 body，按后者判会把焦点从刚拿到的
  目标元素抢回容器——实测把既有的「Tab 回环」用例判红。另加一次性标志：接回动作自身会让旧持焦者再发一次 blur
  落回同一处理器，不许自激。**Esc/Tab 那条链在 jsdom 里不是判别腿**（HEAD 也绿，理由同上），已如实写进测试注释；
  真判据是 Chromium 门禁的 `ui.drawer.closes`。
  **改判留痕（独立复核提出的，本轮接受）**：本条原文写的是「若 `document.activeElement` 落到浮层之外（含 `body`）
  就把焦点交还给容器」——那条**更宽**的不变式没有照抄，两条实测理由：① 按「activeElement 在层外」判会把
  合法交给吐司/下拉/层外自有控件的焦点抢回来（浮层变成牢笼），② 正常 Tab 转移的中间态就命中它（实测判红既有回环用例）。
  本轮落地的是「**本层**的控件因 `disabled`/摘除而不能再持焦时接回」。**注意这是收窄，不是等价**：
  「`aria-modal="true"` 声称背景 inert，但背景其实没被 inert，焦点仍可合法离层、离层后这层就聋」这条差距**依旧存在**，
  单列票 27，别当本票已覆盖。
- [x] `Button` 侧取舍：**保留原生 `disabled`，本条不改动 Button**。异步期间焦点由浮层接管（上一条），
  不改 `aria-disabled` 是因为 F15（灰化 + tooltip 原因）与 16 处调用方都依赖原生 disabled 的表单语义，
  换实现要把「拦截激活行为」在每处重做一遍——收益不如风险。
- [x] 复跑 `pnpm run verify:ai-two-state`：段 A 六步 + UI 段六步全 `[ok]`，含票 25 修复后新点亮的
  `ui.drawer.closes —— Esc → 抽屉关闭（面板卸载）`；
  段 B 默认跳过 9 项，**步骤 21 项失败 0 项、退出码 2**（不是 0，也不是 1）。
  日志 `~/df-evidence/25/verify-ai-two-state.after-fix.log`，截图 `~/df-evidence/25/ui-ai-drawer.png`
  （门禁自身写死的证据路径另有 `~/df-evidence/fe-10/`，两处同一张）。
- [x] 同族异步按钮已核一遍（16 处 `loading=`）：**层内 5 处**（`AiDrawer.tsx:116`、`CreateDocumentDialog.tsx:81`、
  `DeleteConfirmDialog.tsx:48`、`ImagePanel.tsx:179`（JSX 定义在 173-187，经 `footer={footer}` 传入 `Drawer`，
  按行号判会误判成层外）、`DiagnosticsPanel.tsx:147`）由本次中央收口一并覆盖——修在 `useOverlayBehavior`，不在调用方。
  **层外 11 处**（`save-control.tsx:37`、`canvas-studio.tsx:434`、`settings/sections.tsx:155,159,214`、
  `cold-start.tsx:140`、`save-footer.tsx:52`、`ExportPanel.tsx:106`、`McpConfirmBar.tsx:198`、`HomeTopbar.tsx:149`、
  `ErrorState.tsx:70`（页面/面板共用，15 个调用点全在层外））不在 `aria-modal` 层里，没有焦点陷阱可破，
  但**仍会把焦点交回 `<body>`**（键盘用户点完丢失当前位置）。
  那是同一形状的**通用**失焦缺陷，范围与判据都不同于本票，另立票 26，不静默丢弃。
  **扫描口径已纠正（独立复核提出的，本轮接受）**：上面这份名单是按 `loading=` 这个 **prop 名**数的，会漏掉
  「`disabled=` 直接绑在飞行状态上」的同一症状。按症状重数一遍，层外另有
  `settings/components/section-form.tsx:34,47,69,85`（保存期间被禁用的输入框/开关——光标正在填的字段被踢掉焦点，
  比按钮更疼）、`settings/components/sections.tsx:88,151,211`（把 `disabled` 透传给字段）、
  `app/market/page.tsx:183`（加载更多）、`inspect-export/components/ExportPanel.tsx:108`；
  层内另有 `AiDrawer.tsx:115,156`、`DiagnosticsPanel.tsx:190,217,252`（由本票中央收口覆盖）。
  票 26 的名单与判据按这份补全的口径改写过。

## 完成记录（2026-11-02 · `integration/test-remediation-v2`）

改动两处，都在 `packages/ui`：

- `packages/ui/src/utils/use-overlay.ts`——新增 `isDisabledFormControl`、模块级 `isTopLayer`（`isTop` 与事件回调共用，
  避开 exhaustive-deps 红线，**无 lint 抑制**），以及 open 期间的 `reclaimIfOrphaned` 焦点接回。
- `packages/ui/src/components/overlay.test.tsx`——新增「浮层 · 异步提交期间的焦点」describe（6 条：Drawer 接回、
  Modal 接回、接回后 Esc 关得掉、焦点在层外时这层是聋的（反向腿）、层外自有控件持焦时不抢回、关闭交接不被盖掉）。

判据修正与覆盖面（相对工单原文）：原文的层内断言写法在 jsdom 恒过，已换成事件驱动的写法并做了反向验证；
「卸载聚焦的元素」这条路径 jsdom 30 不发 blur/focusout（实测），本票不假装能测到，实现仍听 `blur`（规范只保证这一条），
Chromium 门禁负责真机链路。这三条限制同时写在测试文件的 describe 注释与实现的 WHY 注释里，不留口头保证。

门禁实况：`pnpm exec biome check` 两文件无改动、`pnpm run typecheck` 全仓 Done、`pnpm -r test` 全绿
（`packages/ui` 256/256、`apps/daemon` 252/252）、`pnpm run test:scripts` 0、`pnpm run verify` **退出码 0**；
`verify:ai-two-state` **退出码 2**（段 A + UI 段全 `[ok]`、段 B 按票 22 默认跳过）。日志 `~/df-evidence/25/`。
