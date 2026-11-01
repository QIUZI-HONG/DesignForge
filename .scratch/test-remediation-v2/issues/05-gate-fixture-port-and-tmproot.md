# 05: fix · 门禁夹具端口显式化 + 临时根离开 `/tmp`

**What to build:** 任何门禁起的子 daemon 都在**显式分配的独立端口**上、临时数据根**不落 `/tmp`**。两条纪律原文：`implementation-workflow.md` 工作树段「禁止用 `/tmp` 当工作树或缓存目录——本机 tmpfs 仅 3.9G」；测试环境口径「测试一律显式独立端口（远离 3000/4318）」「禁止缺省即连本机」。现状：

- 无 `DF_PORT` 的裸 spawn 四处：`scripts/verify-daemon.mjs:442-500`、`verify-mcp-stub.mjs:136`、`verify-ai-two-state.mjs:275`、`verify-image-two-state.mjs:351`。本轮实跑 `verify-daemon` 监听 **4319**，而 3000/4318 常驻正在 LISTEN → 恰落在禁止窗口。
- `mkdtemp(tmpdir())` 八处：`verify-daemon.mjs:446`、`verify-mcp-stub.mjs:111`、`verify-ai-two-state.mjs:247`、`verify-image-two-state.mjs:322`、`verify-canvas.mjs:383,384`、`verify-figma-baseline.mjs:266`、`verify-perf.mjs:1391`（后者是固定名拼接，连唯一目录都没有）。

**半径诚实**：这些门禁会解析子进程 stdout 公布的 URL 再发请求，**不会**静默打到常驻 daemon，因此不构成「结论错」；风险是端口撞常驻窗口 + tmpfs 撑爆造成的偶发红/挂起（`verify-perf` 尤其）。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] 四处裸 spawn 全改走 `scripts/lib/gates.mjs:110-140 startFixtureDaemon`（它已 `freePort()` + 注入 `DF_PORT/DF_HOST`）
- [ ] 临时根统一取 `DFORGE_TMP_ROOT`（默认 `~/df-evidence/<票号>/tmp`），脚本层禁止新增 `tmpdir()` 用法
- [ ] `verify-perf.mjs:1391` 改 `mkdtemp`（固定名并发互踩）
- [ ] 新增守卫或静态判据：`scripts/**` 出现 `tmpdir()` 或 `next dev` 即违规（与票 04 同一条守卫）
- [ ] 复跑本轮 Phase A/B 两条链，端口分配与临时根路径写进各自日志

## 第 2 批实况（2026-11-01 二轮 · 由 `fix/v2r-b-export-honesty` 部分落地，实测非推断）

已收：

- `verify-daemon.mjs`、`verify-ai-two-state.mjs` 起的夹具 daemon 监听**显式分配端口**（二轮实跑读到 `http://127.0.0.1:42285`），跑完 4318/3000 未被占用。
- `verify-ai-two-state.mjs` 的「保留现场」目录已离开 `/tmp`，实测落 `~/df-evidence/scratch/verify-ai-two-state-*`（此前是 `/tmp/df-verify-fe10-ai-*`）。

订正（三轮 Spec 轴提出、主控在 `5349af7` 复核属实）：本段此前把 `verify-figma-inspect.mjs` 也写成「起夹具 daemon、显式端口」，**是错的**——该脚本在 HEAD 上 `spawn` / `startFixtureDaemon` / `DF_PORT` / `freePort` 命中 **0 次**，它根本不自己起 daemon，而是 `:48` 缺省连常驻 `http://127.0.0.1:4318`。二轮实跑因 4318 未起而退 2（阻塞），所以那条「显式端口」的读数与它无关。真实风险见下面第 1 条。

仍活（**同一族，别只改一处**）：

- [ ] **`verify-figma-inspect.mjs` 缺省即连本机常驻 daemon，并往里写数据**：`:274` `POST /documents`（建「FE-08 门禁导出源」）、`:294` 写页、`:306` `POST /export`、`:386` `DELETE /documents/<id>`——4318 常驻时这些全落进真实数据根 `~/.dforge`。与本票 What to build 里的「禁止缺省即连本机」直接冲突，且比端口问题更重（不是偶发红，而是污染用户数据）。收口方向：改走 `startFixtureDaemon`（显式端口 + `--data-root` 指临时根），或在无法起夹具时**先探测再退 2**，绝不带写操作直连缺省地址。
- [ ] `scripts/verify-image-two-state.mjs:355` 仍不传 `--port` → 与 `scripts/verify-mcp-stub.mjs:141` 并发跑会抢 4318（由二轮 impl-b 交接指出，坐标已复核）。
- [ ] 其余 `mkdtemp(tmpdir())` 位点未统一取 `DFORGE_TMP_ROOT`（本轮只收了 `verify-ai-two-state`）。
- [ ] 「`scripts/**` 出现 `tmpdir()` 或 `next dev` 即违规」的守卫仍不存在——注意 `scripts/lib/ui-mount.mjs` 现在**复用 4420 上的既有 `next dev`**，与本票第 4 条的判据直接冲突；若要机检，先与票 04「浏览器门禁改生产构建」一起裁决，不要在两条票里各说一套。
- [ ] **UI 挂载的选择器口径**（三轮 UI 实跑验证人判定，属本票 UI 挂载面，不是产品缺陷）：`scripts/verify-ai-two-state.mjs:298`
  `page.click('[data-df-panel="ai"] button:text-is("生成")')` 结构上**永不可达**——`packages/ui/src/components/Drawer.tsx:132-140`
  把 `.dfg-drawer__footer` 渲染成 `.dfg-drawer__body` 的**兄弟节点**，而 `AiDrawer.tsx:110-126` 的「生成」按钮在 footer 里，
  `data-df-panel="ai"` 只包 body 的 children（`:140`）。`:323` 的限定本身合法，但提交从未发生（phase 停 `idle`）→ 级联超时。
  现场截图 `~/df-evidence/fe-10/ui-ai-drawer.png` 里按钮清晰可见于右下角、结果区仍是占位文案，对照单测 `AiDrawer.test.tsx:85-103`
  用全局 `getByRole('button',{name:'生成'})` 一点就过——同一条渲染路径，换个查询就绿，这就是越界的直接证据。
  **修法**：改 role 查询或与单测同口径的 footer 限定；**禁止**用加超时解决（永不可达的选择器加多长都红），**禁止**改成 SKIP。
  与票 06/S1 的 sequencing：退出码优先级修好后本门禁会诚实读 **1**，这两步转绿才回到 **2**（段 B 默认 skip）——**两条同轮落地**，别把红门合进去。
