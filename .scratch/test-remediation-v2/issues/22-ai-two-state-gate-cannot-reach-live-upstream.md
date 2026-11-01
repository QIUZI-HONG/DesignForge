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

## 收口补记（round-2 G4 二次 · fix/v2r-b-export-honesty）

在上面的裁决之上补齐三处「诚实度」细节，并把门禁自身的两条红线（不占常驻端口、不用 /tmp）落到本票文件里：

1. **段 B 的帧账与段 A 同口径**：opt-in 分支新增 `B.stream.sse-frames-accounted`
   （`dataLineCount === events.length + doneCount` 且 `malformedCount === 0` 且事件 ≥2），
   delta 改为**从解析后的帧**取（原实现对线上正文做 `"type":"delta"` 正则——丢帧/跨行 JSON 无感，
   正是 finding 说的「没有任何断言把帧数与线上绑定」）；默认跳过清单同步为 9 条 id，
   覆盖面不再少报。旧的内联 `parseSseFrames`（每块只取第一条 `data:` + `catch {}` 静默丢帧）
   已删除，唯一实现是 `scripts/lib/sse-frames.mjs`（`scripts/tests/sse-frames.test.mjs` 8 条自测）。
2. **不再有任何「未出机」背书**：`cloudCalls: 0` 字段整体去掉（段 A/段 B/meta 三处），
   改为 `egressAttemptedByGate`（只声明**本脚本代码路径**未发起 /ai/chat）+
   `egressObservability: 'no-probe：…'`；meta 另落 `stepsSkipped` 与 `aiEgressOptInEnv`。
   段 B 的路线裁决（skip + opt-in vs 可进白名单的环回替身上游）**仍留人工**，本票不代答：
   默认路径就是 exit 2。
3. **端口与现场目录（本仓红线）**：夹具 daemon 改为 `--port 0`（原来写死占常驻 4318；
   三名整改实现者同机并发跑门禁时，后者会与常驻实例抢端口，红点与被测代码无关），
   UI 段代理与 `waitForListening` 都按 daemon 打印的真实端口接线；
   `verify-daemon.mjs` 同改。非 0 退出时保留的「现场」（daemon 数据根/workspace）
   从 `os.tmpdir()` 迁到 `~/df-evidence/scratch/`——本仓禁用 /tmp，且它是证据的一部分。
4. **catch 丢断言 id**：`ui.degraded-suggestions` / `ui.degraded-result-nonblank` 各走独立
   try/catch 与独立 record，兜底文案如实写「判据不可评估」，不再把第二步的失败冒名成第一步。

**实跑（`~/df-evidence/v2r-b/`，WSL Ubuntu，`LD_LIBRARY_PATH=/home/QIU/df-local-libs/usr/lib/x86_64-linux-gnu`）**：
`node scripts/verify-ai-two-state.mjs` → **exit 2**（合并集成分支 tip 后复跑，日志 `final-verify-ai-two-state.log`：
步骤 15 项、失败 0 项、跳过 9 项；段 A 6 步含 `A.stream.sse-frames-accounted` 全 ok；daemon 监听
`http://127.0.0.1:35605`，UI 段代理按同一真实端口接线，**非常驻 4318**；跑完 `ss -ltn` 见 4318/3000 未被占用）。
UI 段本轮**阻塞**（`page.goto http://localhost:4420/editor` 超时 120s——4420 上是被别的会话占用的既有
next dev 实例，`scripts/lib/ui-mount.mjs` 的「复用既有实例」策略在这种场景下会拿到对不上号的站点），
门禁按 §3 纪律如实打「阻塞：UI 段…」并仍退 2，**2 不是通过**。
`node --test scripts/tests/*.test.mjs` → 0；`pnpm run lint:scripts` → 0
（顺带去掉 `? true : false` 的 `noUselessTernary`，非抑制式修复）。
合并 `integration/test-remediation-v2`（tip `01cec5e`）后全量复跑：`pnpm run lint` 0 ·
`pnpm run typecheck` 0 · `pnpm -r test` 0 · `verify:daemon` 0（48 步 0 失败）。

## 三轮补记（opt-in 那条路**仍然到不了被测路径**，且上面 §56 的顺延把话说小了一半）

三轮 Spec 轴提出、主控在 HEAD 复核属实（`P1`）：`:585` 的 `PUT /config { ai: { baseUrl: mock.baseUrl } }` 被白名单**拒**
（`access-control.ts isAllowedAiBaseUrl` 只收 `https://api.deepseek.com`），`:588` 如实记 `ok:false`，
但 `:601` 之后**无条件** `POST ${baseUrl}/ai/chat`。因为 PUT 没生效，daemon 的 baseUrl 仍停在官方默认端，
所以 `DF_ALLOW_AI_EGRESS=1` 这条路不是「把出机责任转嫁给操作者」这么轻——它是**门禁自己会真的向官方端发一次带哨兵 key 的请求**，
而这一段照样覆盖不到 mock（`upstreamCalls` 恒空）。两条后果要分开记账：

- 已在做：`fix/r3-a-gate-honesty` 给这条腿加「替身 baseUrl **确实生效**才发请求」的守卫——不生效就记显式带类型的 skip，
  且证据文件不得再由「只数本机 mock」的计数器推任何出机结论。**这不改变本票的路线裁决**，只是把 opt-in 路径的危险去掉。
- 仍活（本票 blocker 1 的 A/B 选项，**属人工决定，不代答**）：只要白名单不收环回替身，段 B 的「真上游通路」
  在纯脚本层就**不可能被覆盖**——C 路线（默认 skip + exit 2）是诚实的，但它不是覆盖。想覆盖只有 A（夹具注入假上游）
  或 B（测试态白名单扩展 env + 生效范围 attestation）。
- 顺带记：`ui.degraded-*` 两步在 HEAD 上是 `record(id, false)`（`:307-313`、`:327-331`），即**违规级**判定；
  而 §31 那句「段 B skip → 门禁强制 exit 2」把优先级倒置写成了判据。三轮 Standards 轴 S1 已在修（违规优先于阻塞），
  修完这一段的本机读数会是 **1**，不是 2——那是诚实值，别为了「好看」把它调回 2。

