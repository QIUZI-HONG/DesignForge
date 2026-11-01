# 22: fix · `verify:ai-two-state` 的态 B 到不了被测路径（本机 mock 被 AI baseUrl 白名单永久拒）

**What to build:** 让「AI 真上游通路」这条门禁能真的跑通并回 0，或者把它拆成**如实标注未覆盖**的两段——现在它是 12 步里 4 步恒红、退出码 1，而红的原因不是产品有缺陷，是门禁自己的设计与 SSRF 守卫互斥：`scripts/verify-ai-two-state.mjs:487-489` 把 `ai.baseUrl` 指到本机回环 mock，`apps/daemon/src/access-control.ts:79 isAllowedAiBaseUrl` 要求「仅 https + host 精确命中 `api.deepseek.com`」，于是 `PUT /config` 恒回 400，mock 上游收到 **0 次调用**，下游三项（`B.stream.content-accumulated`、`B.upstream.authorization`、`B.once.real-response`）连带失败。

**门禁实况（证据 `~/df-evidence/v2-merge/gates/06-verify-ai-two-state.log`，集成分支 `b862619`）**：`LINT=0 TYPECHECK=0 VERIFY_DAEMON=0 TEST_SCRIPTS=0 VERIFY_AI_TWO_STATE=1`。票 02、票 03 两位实施者各自把自己票的实现文件回退到基点再跑同一脚本，红点完全相同 → 与本轮改动无关，是基点既有缺陷（此前报告把它记在票 02/03 的门禁表里，未单独立票，本票补上）。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] 裁决测试通路怎么走，并在工单里写清**为什么不会放宽生产边界**（三选一）：
  - A. 夹具 daemon 支持测试期注入假上游（`fetchImpl` 走 `startFixtureDaemon` 的 env 或 `--fixture-upstream`），`/config` 不参与——门禁不再依赖 baseUrl 白名单；
  - B. 新增**仅测试态生效**的白名单扩展 env（如 `DF_AI_BASE_URL_TEST_ALLOW_EXTRA`），要求 daemon 同时以 `NODE_ENV=test`/显式 fixture 标记启动，并在门禁日志里 attestation「本次放宽只在夹具进程生效」；
  - C. 承认「真上游通路不可自动化覆盖」，把这 4 步从门禁里删掉，改成显式的 `SKIPPED（原因）` 输出 + 在文档实况表登记未覆盖面。**不许**留着恒红的步骤还称其为门禁。
- [ ] 修好后要求态 B 的判据**逐项真过**：mock 必须记录到 ≥1 次调用且 `Authorization` 为哨兵 key（BYOK 只在 daemon→上游方向出现）、delta 累积等于 mock 文本、`usage.totalTokens` 来自 mock 而非编造。若沿用票 03 加固后的语义判据（`degradedShapeAudit` 同口径），一次性响应也要过结构审计
- [ ] 与本票相邻但**不在范围**：同一脚本的 UI 挂载段因缺 `libnspr4/libnss3/libnssutil3/libsmime3/libasound2` 起不了 Chromium（`exitCode=127`），由票 04（浏览器门禁 + 生产构建）与人工环境安装承担；本票完成后若 UI 段仍不可跑，退出码必须仍为 1 且在日志里指名是哪一段缺依赖

## 为什么值得单列

`B.status.configured`、`B.stream.steps-timeline` 这两步在 mock 从未被调用的情况下**照样 `[ok]`**——说明它们的判据（configured=true、四步时序）在降级路径上也成立。这正是本轮报告反复出现的模式：步骤「绿」不等于被测路径「跑过」。本票交付时要顺手复核这两步的判据是否需要收紧到能区分「真上游」与「降级」。

## 收口裁决（round-2 G4 · fix/v2r-b-export-honesty）

采用 **C 段 B 显式跳过 + opt-in 出机**（原三选一中的 C，附加显式 opt-in）。

**判据**：
- **段 B 默认整块 skip**，`steps.push({ id, ok: null, skipped: true, detail })` 八条一步不裁；
  `blockedReason` 打印完整原因（写清「回环 mock 走不进 allowlist；不设 opt-in 就发起 /ai/chat 会以哨兵 key 打真实官方端」）；
  段 B skip → 门禁**强制 exit 2**（三态里 2 = 阻塞 ≠ 通过，与纪律一致）。
- **`DF_ALLOW_AI_EGRESS=1` 显式 opt-in** 才走段 B 原路径。理由：本仓无上游探针，操作者一旦设该标志即
  **声明已知并接受真实出机风险**；不设就绝不会有 `/ai/chat` 打到 `api.deepseek.com`——这是 finding
  「no code path issues an outbound request without an explicit opt-in env flag off by default」的直接落地。
- **不再 attestation「未出机 / cloudCalls: 0」**：本脚本没有网络观测能力，任何「0 次云端调用」的
  断言都是编不出证的假绿。改口为两条可证事实：
  - `meta.egressAttemptedByGate: false`（段 B 默认 skip 时）—— 声明**本脚本代码路径**未发起 /ai/chat；
  - `meta.egressObservability: 'no-probe：脚本不观测上游、不声称未出机'`；
  - `evidence.states.stateA/B` 同步落 `egressAttemptedByGate` 与 `eggressObservability`；
  - 段 B 若被 opt-in 打开，stateB 上写 `egressAttemptedByGate: true` + `status: 'executed-with-opt-in'`，
    「未出机」仍不由本门禁断言。

**顺带修**（G4 hygiene）：
- `ui.degraded-suggestions` / `ui.degraded-result-nonblank` 拆两段独立 try/catch：原共一段时，
  后者失败被外层 catch 里的兜底 `record('ui.degraded-suggestions', false, ...)` 冒名顶替，等于
  **漏报第二步骤覆盖、错报第一步骤状态**；现在每步各自 catch、各自 record，兜底文案也如实写
  「判据不可评估」而不是「Suggestion=false」。
- SSE 帧解析：`parseSseFrames` 从脚本内联挪到 `scripts/lib/sse-frames.mjs`（`scripts/tests/sse-frames.test.mjs`
  自测 8 条），处理 CRLF / 多行 data / 注释 / `[DONE]`，畸形 JSON 直接**抛错**而不是 `catch {}` 静默丢；
  门禁段 A 新增 `A.stream.sse-frames-accounted` 步骤，钉「线上 data 行数 = 事件数 + DONE 数」，
  丢帧/畸形帧在门禁里再也隐身不了。

**未做（deferral）**：
- 段 B 若 opt-in，**当前仍不能观测真实出机**——要真给「未出机」背书，需要在 daemon 侧或
  脚本侧装上游代理/黑名单拦截器，超出本票范围；opt-in 段 B 只是把「显式同意出机」的
  责任转嫁给操作者。
- 段 B 的 `B.status.configured` / `B.stream.steps-timeline` **是否要收紧**（区分「真上游」与「降级」）
  的复核：本票默认跳过，判据本身未动；一旦段 B 真跑通（未来 daemon 支持 fixture 假上游，即选项 A），
  这两步必须改写——留待那条路径落地时再修，本票不再扩面。
- daemon 侧 `isAllowedAiBaseUrl`（`access-control.ts:79`）**未动**：这是票 01/A2 定下的 SSRF 边界，
  不在本轮 G4 范围内、也不是我 exclusive 的文件；因此选 C（脚本改），不选 A/B（改 daemon）。
