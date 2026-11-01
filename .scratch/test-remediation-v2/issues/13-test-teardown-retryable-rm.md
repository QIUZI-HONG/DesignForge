# 13: fix · 测试清理统一「可重试删除」，断言失败不得泄漏临时根

**What to build:** 判据原文 `implementation-workflow.md:134-135`「清临时根一律可重试删除」（正确形态见 `apps/daemon/src/harness.ts:125`，带 `maxRetries/retryDelay`）。现状：`apps/daemon/src/routes/adversarial.test.ts:443-455` 的 `rm` 写在 `try` 内、`finally` 只关 server → **断言一失败就不删临时根**，且没有重试参数。同类（仅缺重试、不泄漏）：`apps/desktop/src/main/static-server.test.ts:97`。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] 全仓清理临时根改用同一个可重试删除工具（抽到共享 harness，不在各测试里手写 `rm`）
- [ ] 清理一律落 `finally`（或 `afterEach`），断言失败路径也必须执行
- [ ] 静态判据或守卫：测试文件里出现不带 `maxRetries` 的递归 `rm` 即违规（并入票 04/05 的 scripts 守卫族或 `pnpm test:scripts`）
- [ ] 复跑 daemon/desktop 两套测试，`ls` 确认临时根无残留
