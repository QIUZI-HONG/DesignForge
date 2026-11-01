# 16: docs · 门禁实况两处同源同步 + 规模基线重冻

**What to build:** 按 `implementation-workflow.md:19-22` 的同步 DoD（「任何改门禁的票必须同一票内同步两处实况表」），把文档口径重新对齐到实测。现状三处失真：

1. `AGENTS.md:25` 已列 `verify:motion` / `verify:perf` 入 CI（`ci.yml:92,114` 确有），但 `implementation-workflow.md:83-90` 守卫实况段**只字未提** motion/perf。
2. `workflow:101-103` 与 `ci.yml:137` 仍写「e2e 10 步冒烟」「挂载 6 断言」；本轮实测 **63 步（56 场景 + D4 的 7 步）/ 7 条挂载断言（A1–A7）**。
3. `test-plan-v1.md` §2.3 的用例规模基线 **2756**；本轮 `pnpm test` 实测执行 **3001 例**（静态 `it(`/`test(` 2964，6 处 `it.each` 未展开 → 下界）。逐包：文档 1335/312/165，实测 web 1463 / engine 337 / ui 251。另 §2 明细 56 与标题 63 自相矛盾（D4 未入表）。

**Blocked by:** 01–15, 17–20（实况表必须最后写，否则又停在旧口径）

**Status:** ready-for-agent

blockers:

- [ ] 两处实况表逐条重写：三态语义、是否接 CI、仍为挂点/桩者名单（含本轮新接的 audit，见票 15）
- [ ] 规模基线重冻为单一真源（含逐包计数、e2e 步数口径、挂载断言数），并派生给 `test-plan-v1.md` 引用而非另抄一份
- [ ] 加一条机检：文档声明的计数 vs 实测计数不一致即违规（与票 09 的命中下限同源实现）
- [ ] `ci.yml` 文末「未接入门禁与原因」清单同步更新（本轮已证 `verify-daemon`/`verify-mcp-stub`/`verify-self-designed`/`verify-mk-03/04` 在 Node 级真链路可判 0，属可接候选）
