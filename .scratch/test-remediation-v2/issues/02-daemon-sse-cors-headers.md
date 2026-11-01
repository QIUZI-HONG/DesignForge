# 02: fix · daemon 流式 AI 响应丢 CORS 头（浏览器里 AI 流式整条不可用）

**What to build:** 跨源浏览器客户端能真的读到 `POST /ai/chat` 的 SSE 正文。现状：`apps/daemon/src/routes/ai.ts:32-37` 用 `reply.raw.writeHead(200, {content-type, cache-control, connection})`，`:86-88` 之后 `return reply` 不经 `reply.send`；CORS 钩子（`apps/daemon/src/cors.ts:87-104`）把 `vary` / `access-control-allow-origin` 缓冲在 reply 上，raw 路径整体绕开 → **写出的 SSE 响应没有 ACAO**。预检走 `reply.code(204).send()` 有头，于是浏览器「放行预检、拒收正文」，表现为 AI 流式在跨源形态（web :3000 → daemon :4318 直连）永远拿不到一个字。消费方确在用它：`apps/web/src/features/ai/client.ts:86`（`stream: true`）、`apps/web/src/features/ai/stream.ts`。

**Blocked by:** 04（验收断言要在生产构建 + 真浏览器里跑，dev 模式取证的结论不作数）

**Status:** code-complete（本票改动面 lint/typecheck 0 · 全仓 test 0 · 线路级断言在 vitest 真 socket 与真实子进程 curl 两侧取证；全仓 `pnpm run lint` exit 1 源于票 19 的文件、非本票改动面；浏览器段待人工。证据 `~/df-evidence/v2b-02/`）

blockers:

- [x] 流式分支把 CORS 判定结果显式写进 `writeHead` 头（或改 `reply.hijack()` + 手工头 + 同口径 vary），白名单外 Origin 不得带放行头
- [x] daemon 层新增「带 `Origin: http://localhost:3000` 的 stream 用例」并断言**线路上**的 `access-control-allow-origin`（当前 `ai.test.ts` 的 stream 用例从不带 Origin，`cors.test.ts` 只测非流式）
- [x] 负向用例：非白名单 Origin 的 stream 响应不含放行头（上一轮已记「白名单用例缺反向断言」，本票一并补）
- [ ] 浏览器段：生产构建站跨源直连测试 daemon，AI 面板流式逐帧可见（证据 JSON + 截图落 `~/df-evidence/<票号>/`）——**本轮未跑，待人工**（见下方完成记录「未做部分」）

## 基线核对（2026-11-01 · 集成分支 integration/test-remediation-v2 @ 3f3603c）

工单正文行号取自 main@a838281，已过期。新基线上的实况坐标、上一轮已做掉的部分、剩余缺口与判据修正：
`~/df-evidence/test-remediation-v2/notes/baseline-audit.md` 同名小节（开工前必读）。

## 完成记录（2026-11-01 · 分支 fix/v2b-02-sse-cors-headers · 基点 fe1adba · 证据 `~/df-evidence/v2b-02/`）

**改动面（4 文件，+299/-10；实现 55 行、测试 244 行）**

- `apps/daemon/src/cors.ts`：新增 `corsResponseHeaders(origin, policy)`——CORS 响应头的**单一真源**
  （无 Origin / 重复 Origin 畸形 → 空集合；有 Origin → `vary: Origin`；策略放行才回显该 Origin，绝不用 `*`、
  不发 `allow-credentials`），新增常量 `CORS_VARY_ORIGIN`；`registerCors` 钩子改为从它出头
  （预检附加头与 204 短路语义不变）。票 14 的口径**未回退**：`isLoopbackOrigin` / `isAllowed` / Host 校验顺序 /
  `Origin: null` 拒绝全部原样。
- `apps/daemon/src/app.ts`：`CorsPolicy` 只构造一次，注入 `DaemonContext.corsPolicy`，钩子与绕开钩子的写路径同一判定。
- `apps/daemon/src/routes/ai.ts`：`writeStream` 收 `request.headers.origin`，把判定结果显式并进 `raw.writeHead(200, {...})`。
- `apps/daemon/src/routes/cors.test.ts`：新增 6 条用例（`describe('cors · 流式（SSE）线路级放行头（票 02 · 真 socket）')` 与
  `describe('cors · 头集合单一真源（S3 · 票 02）')`），本文件 18 → 24 条。

**判据（seam 与红线）**

- S1 正面（真 socket）：`app.listen({port:0,host:'127.0.0.1'})` + `fetch` 带跨源 Origin 打 `POST /ai/chat(stream:true)`，
  断言**线路上** `access-control-allow-origin` 逐字回显 + `vary` 含 Origin + `content-type: text/event-stream` +
  逐帧体（`event: delta` / `"delta":"你好"` / `event: done` / `"content":"你好，设界"`）不被破坏 + 响应不含明文 key。
  覆盖三种来源：显式白名单 `localhost:3000`、`127.0.0.1:3000`、票 14 的壳静态随机端口（真 http 夹具起的 Origin）。
  **red 先行**：段 1 提交前该用例红于 `expected null to be 'http://localhost:3000'`（`gates/01-slice1-red.log`，exit 1）。
- S2 反面（真 socket）：`evil.example.com` / `Origin: null` / `127.0.0.2` 伪装回环 / `localhost:3000.evil.example`
  四种来源，线路上的 `access-control-*` 头集合必须**为空**，同时 200 + `vary: Origin` + 帧照常出
  （拒绝只发生在浏览器读数侧，不引入 403「伪安全」）。
- S3 共享头生产者：`corsResponseHeaders` 的产出用字面量钉死（期望值不取实现常量），并加线路级
  **两条写路径头集合逐项相等**（SSE vs `/health` JSON × 命中/白名单外/`null`/无 Origin 四形态）与
  error 帧（`stream:true` + `maxTokens:0`）放行头两条。
- 段 2/3/4/5 的用例在段 1 实现下即绿——**不作 red 冒充**，改用变异校验证明断言会咬：
  放宽为「有 Origin 就回显」→ 6 红（`gates/04`）；白名单外不发 `vary` → 2 红（`gates/07`）；
  摘掉 `writeHead` 里的头展开（即还原原缺陷）→ 本票 4 条线路用例全红（`gates/10`）；三次变异跑完均已回滚（`git diff` 为空）。
- 端口一律 `port: 0`；数据根一律 harness 临时目录；假上游不出网。

**线路级旁证（真实子进程，非夹具）**：`gates/check-realproc-sse-cors.sh` → `gates/20-realproc-sse-cors.log`——
`node apps/daemon/src/main.ts`（空闲端口 + 证据目录内临时数据根）+ curl：白名单 Origin 的 SSE 响应头里有
`access-control-allow-origin: http://localhost:3000` 与 `vary: Origin`，白名单外只有 `vary: Origin`，预检 204 全套齐备。

**未做部分**

1. **浏览器段（blocker 4）待人工**：本机 Chromium 缺 `libnspr4.so`/`libnss3`/`libnssutil3`/`libsmime3`/`libasound2`，
   `sudo` 需交互认证装不了——`verify:ai-two-state` 的 UI 挂载段自己就报「browserType.launch … libnspr4.so cannot open」
   （`gates/18` 内可见），故「生产构建站跨源直连、AI 面板逐帧可见」没有取证，不能标通过。
   另：blocker 4 本身还挂在票 04（生产构建口径）上，本轮范围不含。
2. `apps/daemon/src/routes/ai.test.ts` 未改：原有 stream 用例仍走 `inject` 不带 Origin——线路级断言落在
   `routes/cors.test.ts`（CORS 是本模块判据，且 `cors.test.ts` 已持有 harness 与静态 Origin 夹具）。
3. 未动他人改动面：`adversarial.test.ts`、`scripts/verify-ai-two-state.mjs`、`apps/web/src/features/ai/**` 只读未改；
   `documents.atomicity.test.ts`（票 19）的 lint 错误见下表，属对方文件，本票未代改。

**门禁实况（2026-11-01，全部在本分支 tip 上跑；日志在 `~/df-evidence/v2b-02/gates/`）**

| 门禁 | 命令 | 退出码 | 结果 |
|------|------|--------|------|
| 本票聚焦 | `pnpm --filter @dforge/daemon exec vitest run src/routes/cors.test.ts src/routes/ai.test.ts` | 0 | 38 通过（cors 24 + ai 14）｜`gates/21` |
| 段 1 red | 同上（修复前） | 1 | 线路 `access-control-allow-origin` 为 null｜`gates/01` |
| 变异 ×3 | 同上（临时改实现） | 1 | 6 / 2 / 4 条红，随后回滚｜`gates/04`、`07`、`10` |
| lint（全仓） | `pnpm run lint` | **1** | 2 个 biome 错误在 `apps/daemon/src/routes/documents.atomicity.test.ts`（票 19 文件，与集成分支 tip 逐字节相同，非本票改动面）；本票 4 文件 `biome check` exit 0｜`gates/14` |
| typecheck（全仓） | `pnpm run typecheck` | 0 | 全部包通过｜`gates/15` |
| test（全仓） | `pnpm -r test -- --maxWorkers=2` | 0 | 9 包全绿；daemon 18 文件 / 172 用例｜`gates/16` |
| test:scripts | `pnpm run test:scripts`（带 NODE_OPTIONS） | 0 | 93/93 通过｜`gates/22` |
| verify:daemon | `pnpm run verify:daemon`（带 `NODE_OPTIONS=--experimental-strip-types --no-warnings=ExperimentalWarning`） | 0 | 42 步 0 失败｜`gates/17` |
| verify:daemon（裸跑对照） | 同上去掉 `NODE_OPTIONS` | **2** | 起 daemon 子进程即 `ERR_UNKNOWN_FILE_EXTENSION`（`.ts` 需 strip-types），2 不是通过；既有环境问题，非本票引入｜`gates/23` |
| verify:ai-two-state | 同上脚本 | **1** | 12 步 4 失败（`B.config.base-url` 400 连锁：脚本把 `ai.baseUrl` 指本机 mock，被 access-control 官方域白名单拒 → mock 收到 0 次调用 → 流式与一次性降级）。**与本票无关**：把本票 3 个实现文件回退到基点 fe1adba 再跑，同样 4 项红、exit 1（对照 `gates/19`）；该文件属票 03 改动面，本票未动 |
| 真实子进程线路取证 | `bash gates/check-realproc-sse-cors.sh` | 0 | A 放行头有 / B 无放行头 / C 预检 204 齐备｜`gates/20` |
| 浏览器段 | 生产构建站跨源实测 | **未跑** | 缺系统库（libnspr4 等）、sudo 需交互认证 → 待人工 |

**合入**：`git merge integration/test-remediation-v2`（fe1adba → d162cbc，票 19 段 2 的 `store.ts`/`fs-atomic.ts`/
`documents.atomicity.test.ts`）无冲突，未丢弃对方改动；合并后重跑全仓 lint/typecheck/test 与上表聚焦项。

