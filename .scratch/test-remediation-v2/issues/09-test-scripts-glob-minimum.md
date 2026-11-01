# 09: fix · `test:scripts` 的 glob 命中下限（0 例不得算通过）

**What to build:** 根 `package.json:16` 用 `node --test "scripts/tests/**/*.test.mjs"`。目录改名/glob 失配时 **0 例仍 exit 0**，整层「守卫检出强度回归」静默消失。本轮该目录有文件（`test-scripts.log` 有实跑输出），属潜伏假绿，不是当前假绿。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] 跑前静态断言：`scripts/tests/**/*.test.mjs` 命中数 `>=` 登记下限（下限写进脚本常量，与票 16 的口径表同源）
- [ ] 跑后校验 pass 计数（换 `--test-reporter=tap` 或解析汇总行），0 pass 即 exit 1
- [ ] 同法覆盖 `pnpm test` 各包（各包用例数下限入同一口径表）
- [ ] 反例夹具：空目录形态必须非 0
- [ ] 复跑 `pnpm test:scripts` 全绿
