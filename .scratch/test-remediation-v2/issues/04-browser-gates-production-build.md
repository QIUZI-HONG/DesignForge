# 04: fix · 浏览器门禁改走生产构建（禁 `next dev` 取证）

**What to build:** 一切 live 浏览器门禁与取证都在 `next build` + `next start` 的产物上跑，证据覆盖真实交付形态。判据原文：`docs/agents/implementation-workflow.md` 取证段——「不要用 `next dev` 跑 live 浏览器门禁/取证……一律 `next build` + `next start`」。实际违反两处：`scripts/lib/ui-mount.mjs:151` `spawnDetached('pnpm', ['--filter','@dforge/web','exec','next','dev','-p',String(port)])`（受影响门禁：`verify-ai-two-state`、`verify-image-two-state`）；`scripts/verify-canvas.mjs:25,30,166,246,268,292,410,438` 全篇以 `next dev` 为口径，`:438` 更写「复用已运行的 next dev：${existingUrl}（Next 16 每项目单实例）」。为什么重要：上一轮 E1–E4 全部是「只在生产构建+浏览器里才暴露」的缺陷类，用 dev 取证等于把这条门禁的结论降级为参考。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] `ui-mount.mjs` 改 `next build` + `next start`；构建一次、多门禁复用（端口与生命周期走 `scripts/lib/gates.mjs`）
- [ ] `verify-canvas.mjs` 全部 `next dev` 引用与「复用已运行的 dev」路径清除；站点前置不成立 → exit 2（不是回退 dev）
- [ ] 证据 JSON 落 `buildMode: 'production'` + 构建产物指纹，门禁拒绝任何非生产构建的判定输入
- [ ] 若确需 dev 快轮：另立 `--dev` 显式开关，退出码只能是 2 并在结论行点名「dev 取证不作判据」
- [ ] 装库后复跑 `pnpm e2e:smoke` + `verify-canvas` + 两个 two-state 门禁，日志入 `~/df-evidence/<票号>/`
- [ ] 同步实况表两处（与票 16 口径一致）
