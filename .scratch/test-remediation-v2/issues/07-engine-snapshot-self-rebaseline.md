# 07: fix · 引擎快照禁「自重基线」+ CI 增脏树检查

**What to build:** 「行为漂移即失败」这条承诺要真的成立。现状：`packages/engine/src/regression.test.ts:268-272` 在快照文件缺失或 `UPDATE_SNAPSHOT=1` 时**重写 json + sha256 后 `return`**（该用例零断言仍绿）；`scripts/verify-engine.mjs:56` 先跑 vitest，`:71`「缺失即违规」分支因此不可达，`:88` 只比同一轮刚写出的两份产物（恒等）。

**修正后半径（独立验证已确认）**：两份快照文件均已 git 跟踪、工作树干净、只读复算哈希一致（`d5bf9876…`）→ **当前 main 不处于「丢失即假绿」**；`:280-282` 的确定性用例与包内其余测试仍真断言。真缺口是：`.github/workflows/ci.yml` 没有任何脏树/产物变更检查，谁删掉或重生成快照，CI 会静默接受新基线。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] 门禁执行期禁重生成：检测到 `UPDATE_SNAPSHOT` 或基线文件缺失 → exit 2 并点名「基线缺失，禁止自产」
- [ ] 比对基线取 **HEAD 的 git blob**（不是同轮产物互比），实现改坏与基线改绿不再能同时发生
- [ ] `ci.yml` 增一步：门禁跑完 `git status --porcelain` 必须为空（任何门禁写仓库即违规）
- [ ] 反例夹具入 `scripts/tests/`：删快照 / 置 `UPDATE_SNAPSHOT=1` 两形态都必须非 0
- [ ] 复跑 `pnpm verify:engine` 与 `pnpm test:scripts` 全绿
