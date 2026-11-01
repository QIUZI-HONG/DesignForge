# 12: fix · 桌面壳导航守卫接线 + 守卫判据 + 权限面收口

**What to build:** 架构文档 `docs/architecture/enterprise-architecture-v1.md:83` 把「导航守卫」列为壳职责并挂 `guard:electron-baseline`，但守卫的**接线时机与检出强度都没人管**。现状：

- `apps/desktop/src/main.ts:288-289`（冒烟）与 `:405-406`（交互）都是 `await loadTarget()` **之后**才 `attachNavigationGuard`；`:245` 是全仓唯一 `will-navigate`，probe 路径 `:263` 根本不挂。
- `scripts/guard-electron-baseline.mjs:397-406` 只查 `setWindowOpenHandler` / `action:'deny'` / `nodeIntegration:true` / remote，对 `will-navigate` **零判据**；`scripts/tests/fixtures/electron-baseline/` 9 个夹具全是 window-options 形态，无 main.ts 反例。
- 全仓零 `setPermissionRequestHandler` / `will-attach-webview`（`load-target.ts:16,52-56` 还允许 `DFORGE_SHELL_URL` 指向任意 http(s) 外站）。

**修正后半径（独立验证已确认，不许夸大）**：302 走 `will-redirect` 而非 `will-navigate`，提前挂也拦不住重定向；真实剩余缺口是「`did-finish-load` 之前的 meta-refresh / 页内跳转」。「整段删掉全仓不红」不准——删 `setWindowOpenHandler` 会让 `apps/desktop/src/guards/electron-baseline-guard.test.ts:20-26` 与 test:scripts 夹具变红，**只有 `attachNavigationGuard` 这条接线无测试会红**。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] 守卫先于装载挂载（冒烟/交互/probe 三条路径一致），并在代码注释写明为何顺序重要
- [ ] `guard:electron-baseline` 增静态判据：`will-navigate` 接线存在 **且** 排在 `loadURL/loadFile` 之前；补一个 main.ts 反例夹具（删接线必须让守卫变红）
- [ ] 权限面按 `setPermissionRequestHandler` 收口（默认拒绝，显式白名单），`will-attach-webview` 一并处理
- [ ] `DFORGE_SHELL_URL` 外站形态给出显式警告或拒绝口径（当前「需自设 env」，属纵深缺失）
- [ ] 与上一轮票 14（`guard:channel-pairing`）对齐钩子清单，别各立一套守卫入口
- [ ] 真机运行验证：带 `Refresh: 0` 的本地页作为 `DFORGE_SHELL_URL`，观察是否跳出（本轮无 sudo/浏览器库，此条待人工或装库后复跑）
