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
