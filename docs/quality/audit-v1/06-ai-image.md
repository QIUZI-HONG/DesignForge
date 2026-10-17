# 审计 06 · AI 与出图深挖（两态 / 契约 / mock）

- **状态**：已完成（审计阶段；**未改产品代码**，只跑既有门禁 + 仓库外探针与本文档）
- **日期**：2026-10-17（UTC+8 21:05–21:25）
- **代码基线**：`integration/audit-v1` @ `8c21da6`（已含审计 01–04；本票分支收尾前并入）
- **本票分支 / 工作树**：`audit/06-ai-image` / `/home/QIU/df-wt/aud-06`
- **范围**：AI 无 key 降级、有 key mock 流式、BYOK/脱敏/哨兵、prompt injection、受控 AI 写入（B-09）；出图未启动/缺模型/mock 正常态/OOM/取消、任务持久化（B-08）、mock↔真 ComfyUI 契约漂移。
- **证据根**：`~/df-evidence/audit-50/aud-06/`（下称 `$EV`；**全部证据在仓库外**）
- **上游口径**：本票**未使用真实 DeepSeek key、未启动真实 ComfyUI**；只跑无 key 降级 + 本机回环 mock + 契约。真实上游按 **blocked** 记录，不写成通过。
- **关联交接**：`01-baseline.md`（基线）、`02-capability.md`（B-03/B-07 blocked，B-08/B-09 missing）、`03-data-security.md`（F-03-02 CORS `null`、F-03-09 遥测自由文本）。

## 1. 执行摘要

两态门禁与全量 `pnpm verify` 均绿：`verify:ai-two-state` **16/16**（含真浏览器 UI 段，`cloudCalls=0`）、`verify:image-two-state` **12/12**（含真浏览器 UI 段）、`pnpm verify` **292 文件 / 2765 例全过**。无 key 降级、mock 流式四步时序、BYOK 静态加密与哨兵不泄漏、客户端断连中止、60s 超时映射、出图未启动/缺模型结构化失败、产物哈希落盘、OOM 降档均成立。

但深挖发现**主路径级契约缺陷**，且门禁的 mock 保真度不足，未能覆盖这些真实语义：

| 级别 | 数量 | 内容 |
|---|---|---|
| **A** | 0 | — |
| **B** | 5 | 3 条 broken（取消排队任务语义、空流假成功、慢 `/object_info` 误判缺模型）+ 2 条 missing（B-08 出图任务持久化、B-09 受控 AI 写入） |
| **C** | 8 | 产物取回失败仍报成功、任务失联永久 queued、探测缓存使「重新探测」失效、401 错误映射误导、流式丢参数、遥测缺段、门禁取证边界、mock 保真度 |

**Prompt injection 结论**：AI 输出**只展示**（`AiDrawer.tsx:199` 以 React 文本节点渲染），全仓库 AI/出图路径无工具调用、无写路由、无 `dangerouslySetInnerHTML`；注入文本无法触发写入、命令执行或密钥读取。实测恶意 prompt + 恶意上游响应后：工作目录哈希不变、文档列表不变、MCP 审计零记录、遥测无注入文本、仅 1 次上游调用。**当前防线是「能力不存在」（B-09 missing）而不是输入过滤**——一旦 P5 接入工具调用/受控写入，必须在确认闸（dryRun → ack → 应用）和不可信内容溯源上补防线。

**真实上游 blocked**：`DF_DEEPSEEK_API_KEY` 未设置（且按纪律不使用真实 key）；`127.0.0.1:8188` 连接拒绝（`curl` exit 7）。B-03/B-07 仍为 blocked，不能写成通过；F-06-01/F-06-03 的真实服务影响需在 ComfyUI 可用时复验。

## 2. 基线与门禁复跑

| 门禁 | 命令 | 结果 | 证据 |
|---|---|---|---|
| AI 两态 | `pnpm verify:ai-two-state` | **16/16，exit 0**；真浏览器 UI 4/4；`cloudCalls=0` | `$EV/logs/verify-ai-two-state.log`；`$EV/fe-10/verify-ai-two-state.json`；截图 `$EV/fe-10/ui-ai-drawer.png` |
| 出图两态 | `pnpm verify:image-two-state` | **12/12，exit 0**；真浏览器 UI 4/4 | `$EV/logs/verify-image-two-state.log`；`$EV/fe-10/verify-image-two-state.json`；截图 `$EV/fe-10/ui-image-panel.png` |
| 全量门禁 | `pnpm verify` | **exit 0**；9 包 292 文件 / 2765 例 | `$EV/logs/pnpm-verify.log`；合并审计 04 后复跑 `$EV/logs/pnpm-verify-final2.log`（exit 0） |
| 脚本门禁自测 | `pnpm test:scripts` | **exit 0**（fail 0） | `$EV/logs/test-scripts-final.log` |
| 前置（blocked） | `curl --max-time 2 127.0.0.1:8188/system_stats`；`DF_DEEPSEEK_API_KEY` 未设置 | exit 7；unset | `$EV/logs/blocked-prerequisites.log` |

复跑口径与注意：

- 两门禁默认把临时数据根放 `mkdtemp(tmpdir())`（即 `/tmp`，见 `scripts/verify-ai-two-state.mjs:247`、`scripts/verify-image-two-state.mjs:322`）。本轮按审计纪律显式 `TMPDIR=$EV/tmp` 运行，未写 `/tmp`；这本身登记为 F-06-10。
- 门禁 daemon 因 4318 被常驻实例占用，自动落到 4319；**未触碰 4318/3000 与 `~/.dforge`**。UI 段用 4420，跑完已确认无 44xx 监听。
- 两门禁的 UI 段是**真浏览器**（playwright-core + Chromium 1243，真点击、真 daemon 代理），不是 SSR HTML 探测；无 key 降级提示与出图未启动动作均在真实抽屉/面板中断言。
- 合并审计 04 后首次复跑遇到 `node_modules/.vitest-cache` 的 `ENOTEMPTY`（并行包测试共用 vitest 缓存竞态，`$EV/logs/pnpm-verify-final.log`）；清缓存重跑即 exit 0（`pnpm-verify-final2.log`），不是产品失败。该 flake 归 #58 的 flake 观测。
- 门禁 mock 标注成立：AI `stateB.mockUpstream` 明确本机回环、`cloudCalls: 0`；出图 `stateB.mockBaseUrl`、`mockCalls` 可见。出图证据缺显式 `cloudCalls` 字段（C 级，归 F-06-10）。
- 既有单测/对抗套件覆盖良好：daemon 118 例含凭据哨兵全链路、AI 流式断连、出图状态机；但存在两处**断言盲区**：AI「零 data 帧」用例只覆盖 keep-alive（`ai.test.ts:385`），出图取消用例不校验 `/interrupt`/`/queue` 语义（`image.test.ts:317`）。

## 3. 覆盖矩阵（观测 → 判定）

### 3.1 AI

| 观测 | 结果 | 判定 | 证据 |
|---|---|---|---|
| 无 key：`/ai/status` + 流式/一次性 | `configured=false` + `degradedHint`；降级响应同构；上游 0 调用 | **通过** | AI 门禁 A 段；`ai-probes.json` `no-key` |
| 有 key + mock 流式 | `start → delta×3 → done`，四步时序全走完，内容累积正确 | **通过** | AI 门禁 B 段 |
| BYOK 落盘 | `credentials.json` / `credentials.key` 均 `0600`，AES-256-GCM，32 字节主密钥，密文无明文 | **通过** | `ai-probes.json` `byok.write` |
| 哨兵全链路 | 响应/`/config`/`/status`/遥测/磁盘/daemon stdout+stderr **零命中** | **通过** | `byok.write`、`byok.disk-scan`、`byok.telemetry` |
| 重启后解密 | 重启 daemon 后 `configured=true`，流式仍带哨兵到 mock | **通过** | `byok.restart` |
| 清除凭据 | 立即降级；`credentials.json` 删除；主密钥文件保留 `0600`（非机密） | **通过** | `byok.clear` |
| 500 / 429 | 500 → `upstream-error`（3 次尝试）；429 → `rate-limited`（3 次尝试） | **通过** | `error-map` |
| 401 | **`upstream-error`** + 建议「稍后重试」，不提示修 key | **部分 / F-06-07（C）** | `error-map` `http-401-once` |
| 客户端断连 | 客户端 abort 后上游连接关闭（`upstreamClosedDelta=1`），不再推流 | **通过** | `error-map` `stream-client-abort` |
| 上游 60s 超时 | 60.1s 后 `done(degraded, timeout)` | **通过** | `error-map` `stream-upstream-timeout` |
| 上游 200 非 SSE | `invalid-response` 降级，不假成功 | **通过** | `error-map` `stream-sse-json-content` |
| 上游半包（帧跨 TCP 块） | 缓冲拼回，`delta="split"` | **通过** | `ai-param-probe.json` `halfPacket` |
| 上游只发 `[DONE]` / 只发坏 JSON | **`done` 带 `degraded:false, content:"", suggestions:[]`** | **F-06-02（B）** | `error-map` `stream-sse-done-only`、`stream-sse-garbage-only` |
| 流式 `temperature/maxTokens` | 一次性透传；流式**丢弃**（mock 收到 null） | **部分 / F-06-08（C）** | `ai-param-probe.json` |
| 流式遥测 | 流式调用**零** `ai.run`/`ai.degraded`；仅一次性路径落事件 | **部分 / F-06-09（C）** | `ai-probes.json` `byok.telemetry` |
| prompt injection | 1 次上游调用；工作目录/文档不变；MCP 审计零记录；响应=上游恶意文本 | **通过（能力不存在，非过滤）** | `ai-probes.json` `prompt-injection` |
| 受控写入 B-09 | 无 AI 应用/写入路径；MCP 桩 `dryRun` + `applied:false`，文档不变 | **missing** | `controlled-write-b09`；`mcp/stub.ts:188` |

### 3.2 出图

| 观测 | 结果 | 判定 | 证据 |
|---|---|---|---|
| 未启动（死端口） | `/image/probe` 200 `reachable:false`；提交 503 `comfy_unreachable` + actions | **通过** | IMG 门禁 A 段 |
| 缺模型 | 422 `comfy_model_missing`，`missing`/`available` 精确 | **通过** | `image-probes.json` `model-missing` |
| `/object_info` 2.2s（>1.5s 探测超时） | `reachable:true, models:null` → 默认提交 **422 误判缺模型** | **F-06-03（B）** | `object-info-timeout` |
| 「重新探测」 | 服务已在同地址启动，60s 缓存内仍返回 `reachable:false`；force 后才 true | **F-06-06（C）** | `probe-cache-60s` |
| 正常态（mock） | 提交 202 → 轮询 `running → succeeded`；产物 sha256 复算一致 | **通过** | IMG 门禁 B 段 |
| 产物取回失败 | `/view` 404 → `succeeded` + `artifacts:[]` + `failure:null` | **F-06-04（C）** | `artifact-view-failure` |
| 取消运行中任务 | 200 `canceled`，`/interrupt` 调用 | **通过（mock）** | IMG 门禁 B 段 |
| 取消排队中任务 | 200 `canceled`；**全局 `/interrupt`**；队列未删（`queueDeleteCalls=0`），任务仍在 pending | **F-06-01（B）** | `cancel-queued-drift` |
| ComfyUI 侧任务消失 | history 空 + queue 空 → 连续轮询始终 `queued` | **F-06-05（C）** | `task-lost-forever-queued` |
| OOM | `failed` + `comfy_oom`；降档 512→384 / steps 20→15 | **通过** | IMG 门禁 B 段 |
| daemon 重启 | 任务 404 `comfy_run_not_found`；`GET /image/runs` 404；数据根仅有 config/assets/telemetry | **missing（B-08）** | `daemon-restart-b08` |
| 参数校验 | width 越界/positive 空 → 400 `comfy_invalid_request` | **通过** | `param-validation` |
| 与 AI key 解耦 | 无 key 时模板接口正常 | **通过** | `image-independent-of-ai-key` |
| 真实 ComfyUI 8188 | `ECONNREFUSED` | **blocked** | `real-comfyui-8188`；`blocked-prerequisites.log` |

## 4. Findings

> 分级：A = 阻断（主路径不可用 / 安全 / 数据丢失）；B = 严重（规格未达 / 功能受损）；C = 一般/观察。
> 五态：working / partial / missing / broken / blocked。证据均在 `$EV` 下。

| ID | 级别 | 五态 | 摘要 | 证据（`$EV/`） |
|---|---|---|---|---|
| F-06-01 | B | broken | 取消排队任务用全局 `/interrupt`，误杀运行中任务且队列未删 | `probes/image-probes.json` |
| F-06-02 | B | broken | 上游只发 `[DONE]`/坏 JSON 被判成功（空结果假成功） | `probes/ai-probes.json` |
| F-06-03 | B | broken | `/object_info` 慢于 1.5s → 默认提交误判缺模型 | `probes/image-probes.json` |
| F-06-04 | C | broken | 产物取回失败仍报 `succeeded` + 空 artifacts | `probes/image-probes.json` |
| F-06-05 | C | broken | ComfyUI 侧任务消失后永久 `queued` | `probes/image-probes.json` |
| F-06-06 | C | broken | 「重新探测」受 60s 缓存影响仍回未启动 | `probes/image-probes.json` |
| F-06-07 | C | partial | 401/403 映射为通用上游失败，不提示修 key | `probes/ai-probes.json` |
| F-06-08 | C | partial | 流式请求丢弃 `temperature/maxTokens` | `probes/ai-param-probe.json` |
| F-06-09 | C | partial | AI 流式与出图终态遥测缺段 | `probes/ai-probes.json` |
| F-06-10 | C | partial | 门禁取证边界（哨兵不查日志/磁盘、临时根 `/tmp`、UI 用 next dev） | `logs/verify-*.log` |
| F-06-11 | C | partial | mock 保真度不足掩盖取消/空流/失联等漂移 | `logs/verify-*.log` |
| F-06-12 | B | missing | B-08 出图任务持久化/崩溃恢复缺失 | `probes/image-probes.json` |
| F-06-13 | B | missing | B-09 受控 AI 写入/变更提案缺失 | `probes/ai-probes.json` |

### F-06-01 · B · broken · 取消排队中的出图任务会中断「别的」运行任务，且被取消任务仍在 ComfyUI 队列里

- **复现**：mock `/queue` 同时给出 `queue_running=[other-running-job]`、`queue_pending=[mock-2]`；`POST /image/runs/mock-2/cancel` → 200 `canceled`；mock 记录 `interruptCalls=1`、`queueDeleteCalls=0`、`queueWriteCalls=0`，`queue_pending` 仍含 `mock-2`。
- **证据**：`$EV/probes/image-probes.json`（`cancel-queued-drift`）。
- **根因**：`apps/daemon/src/image/client.ts:615-622` 的取消只做两件事：本地 `cancelRequested=true` + `POST /interrupt`。ComfyUI 的 `/interrupt` 语义是**中断当前执行**，不是按 `prompt_id` 取消；删除排队任务应走 `POST /queue {"delete":[prompt_id]}`。daemon 从不发后者。
- **影响**：取消一个排队任务可能**杀掉另一个正在跑的任务**；被取消的任务仍会在 ComfyUI 中执行并消耗 GPU，daemon 随后丢弃产物。UI 显示 canceled 与真实状态不一致。
- **建议**：区分 `running` / `queued`：running 才 `/interrupt`；queued 必须 `POST /queue` 删除并校验返回；无法确认时返回显式失败而不是直接 canceled。回归见 R-06-01。
- **五态**：broken（mock 复现契约漂移；真实 ComfyUI 待 B-07 解锁后复验）。

### F-06-02 · B · broken · 上游只发 `[DONE]` 或坏 JSON 时被判成功（空结果假成功）

- **复现**：mock SSE 分别只写 `data: [DONE]` 与 `data: {not-json}`；`POST /ai/chat(stream:true)` 返回 `start + done`，`done.response = { degraded:false, content:"", finishReason:null, suggestions:[] }`。
- **证据**：`$EV/probes/ai-probes.json`（`error-map.stream-sse-done-only`、`stream-sse-garbage-only`）。
- **根因**：`apps/daemon/src/ai/client.ts:321,385` 把**任意** `data:` 行（含 `[DONE]` 与解析失败行）都置 `sawData=true`；`417-429` 仅在「一帧 data 都没有」时归 `invalid-response`。现有用例 `apps/daemon/src/routes/ai.test.ts:385` 只测 keep-alive 零 data 帧，漏掉了这两种形态。
- **影响**：上游故障/代理截断时用户得到「成功但空白」的结果，无「本地模板」角标、无建议清单，违背契约「上游响应不可解析 → invalid-response 降级」与「不假成功」。
- **建议**：只有解析出至少一个合法 `delta`/`finish_reason` 才算有效流；`[DONE]` 不计入 `sawData`；有效帧为 0 → `invalid-response`。补用例覆盖 `[DONE]`-only 与坏 JSON。回归见 R-06-02。
- **五态**：broken。

### F-06-03 · B · broken · 真实 ComfyUI `/object_info` 慢于 1.5s 时，默认提交被误判「缺模型」

- **复现**：mock `/system_stats` 立即返回、`/object_info` 延迟 2.2s；`POST /config/connectivity`（force）后 `/image/probe` 为 `reachable:true, models:null`；随后默认 `POST /image/runs` → **422 `comfy_model_missing`**，`missing=["（无可用 checkpoint）"]`、`available=[]`。
- **证据**：`$EV/probes/image-probes.json`（`object-info-timeout`）。
- **根因**：`apps/daemon/src/image/client.ts:33` 探测超时 1500ms；`186-211` 对 `/object_info` 超时只把 `models` 置 null，不当失败；`421-433` 在 `models===null` 时无法选 checkpoint（默认模板 `requiredModels.checkpoints=[]`），于是 `requestedCheckpoint=null` → 缺模型失败。真实 ComfyUI 的 `/object_info` 体量大、首载慢，1.5s 很容易不够。
- **影响**：ComfyUI 已启动且模型齐全时，默认出图仍可能被报「缺模型/无可用 checkpoint」，且引导用户去查模型清单——诊断方向错误。真实服务当前 blocked，未在真机复验。
- **建议**：`/object_info` 给独立更长超时（如 10s）并区分「不可达」与「清单未知」；`models===null` 时不要做存在性判定（交给 ComfyUI 的 `/prompt` 错误）或先用模板 `requiredModels` 兜底；探测失败可重试一次。回归见 R-06-03。
- **五态**：broken（mock 复现；真实 ComfyUI 待 B-07）。

### F-06-04 · C · broken · 产物取回失败时仍报 `succeeded` 且 `artifacts=[]`（静默丢产物）

- **复现**：history 已 success，mock `/view` 返回 404；`GET /image/runs/:id` → `state:"succeeded"`, `artifacts:[]`, `failure:null`。恢复 `/view` 后再查才拿到产物，但前端轮询器在第一次 `succeeded` 就停表（`apps/web/src/features/image/run.ts:68-71`），用户不会自动再查。
- **证据**：`$EV/probes/image-probes.json`（`artifact-view-failure`）。
- **根因**：`apps/daemon/src/image/client.ts:315-349` 下载失败返回 null，`549-557` 仍无条件返回 `succeeded`；没有 `comfy_artifact_missing` 一类的失败态或重试。
- **影响**：ComfyUI 短暂 `/view` 故障/文件被清时，用户看到「成功」但没有图，也无「重试」入口（只能重新提交）。
- **建议**：成功但零产物 → `failed`（`comfy_artifact_missing`）或带自动重试；至少 `failure` 非空并给 `retry` 动作。回归见 R-06-04。
- **五态**：broken。

### F-06-05 · C · broken · ComfyUI 侧任务消失后 daemon 永远回 `queued`，前端无限轮询

- **复现**：提交后 mock `/history` 恒 `{}`、`/queue` 恒 `{running:[],pending:[]}`；连续 3 次 `GET /image/runs/:id` 均为 `queued`，`failure:null`。前端轮询器无最大次数/超时（`apps/web/src/features/image/run.ts:55-73`）。
- **证据**：`$EV/probes/image-probes.json`（`task-lost-forever-queued`）。
- **根因**：`apps/daemon/src/image/client.ts:589-612` 在 history 无记录且 queue 为空时返回 `queued`（`609`），没有「失联/超时」终态；ComfyUI 重启、清队列、任务被外部删除都会命中。
- **影响**：任务永远排队，进度条不结束；用户只能取消或重开面板。与「任务可靠性」目标冲突（B-08 的另一面）。
- **建议**：进程内记录提交时间/最后可见时间；超过阈值（如 10 分钟或 3 次连续不可见）→ `failed`（`comfy_task_lost`）；或结合 `/history` 的 `status` 与 ComfyUI 重启标记判定。回归见 R-06-05。
- **五态**：broken。

### F-06-06 · C · broken · 「重新探测」在 60s 缓存内仍返回未启动

- **复现**：探测死端口 `reachable:false`（缓存）；在同一端口启动服务后立即 `GET /image/probe` 仍 `reachable:false`；`POST /config/connectivity`（内部 force）后 `reachable:true`。
- **证据**：`$EV/probes/image-probes.json`（`probe-cache-60s`）。
- **根因**：`apps/daemon/src/image/client.ts:133-146` 的探测缓存 TTL 60s；`apps/daemon/src/routes/image.ts:26-28` 的 `GET /image/probe` 不提供 `force`；前端「重新探测」正是调它（`use-image-run.ts:62-73`）。
- **影响**：用户按文档动作启动 ComfyUI 后点「重新探测」，最多 60s 内仍显示「未检测到」，恢复动作看起来无效。改 `comfy.baseUrl` 会因缓存键变化立即刷新（可绕过）。
- **建议**：给 `GET /image/probe?force=1`（或 POST）并在「重新探测」时使用；或把 TTL 降到秒级并让失败结果不缓存。回归见 R-06-06。
- **五态**：broken。

### F-06-07 · C · partial · 401/403 与通用上游失败同映射，建议清单不指向「修 key」

- **复现**：mock 401 → 200 降级，`degradedReason:"upstream-error"`，建议 `retry-later` + `manual-edit`，没有 `configure-credentials`。
- **证据**：`$EV/probes/ai-probes.json`（`error-map.http-401-once`）。
- **根因**：`apps/daemon/src/ai/client.ts:218-223` 只映射 429 与解析失败；契约 `AiDegradeReason`（`packages/contracts/src/ai/index.ts:33-38`）没有「凭据无效」分支。
- **影响**：key 被吊销/填错时用户被建议「稍后重试」，而不是去设置页换 key；降级提示与真实原因不符。
- **建议**：契约增加 `unauthorized`（或 `invalid-credentials`），401/403 映射到它并给 `configure-credentials` 建议。回归见 R-06-07。
- **五态**：partial。

### F-06-08 · C · partial · 流式请求丢弃 `temperature` / `maxTokens`

- **复现**：同参数分别发一次性与流式；mock 记录一次性收到 `temperature:0.25, max_tokens:64`，流式收到 `null/null`。
- **证据**：`$EV/probes/ai-param-probe.json`（`requests`、`verdict`）。
- **根因**：`apps/daemon/src/ai/client.ts:126-144` 的 `callUpstream` 透传参数；`streamChat` 的请求体（`330`）只有 `model/messages/stream`。UI 只用流式（`use-ai-run.ts`），所以用户路径上参数永远不生效。
- **影响**：契约字段被静默忽略；接入方按契约设置的采样/上限无效。当前 UI 未暴露这两个参数，故未升级为 B。
- **建议**：流式请求体与一次性共用同一参数拼装；补契约用例。回归见 R-06-08。
- **五态**：partial。

### F-06-09 · C · partial · AI 流式与出图终态遥测缺段

- **复现**：3 次流式 AI 调用后遥测只有 2 条一次性路径事件（`ai.degraded`、`ai.run`）；出图侧只写入 `image.run.submitted`。
- **证据**：`$EV/probes/ai-probes.json`（`byok.telemetry`）；代码 `apps/daemon/src/routes/ai.ts:96-110`（仅非流式 append），`apps/daemon/src/routes/image.ts:43-56`（仅 submitted）；`packages/contracts/src/telemetry/index.ts:20-22` 声明了 `image.run.completed/failed` 但无写入方。
- **影响**：诊断面板/看板低估真实使用；出图成功/失败无本地审计链。**好消息**：AI prompt 不进入遥测（F-03-09 的自由文本风险不成立于 AI 路径），本票实测遥测无 prompt/哨兵。
- **建议**：流式在 `done` 收口时落 `ai.run/ai.degraded`；出图在终态落 completed/failed（含 runId、耗时、产物哈希）。回归见 R-06-09。
- **五态**：partial。

### F-06-10 · C · partial · 两态门禁的取证边界不足（哨兵只查响应、临时根落 /tmp、UI 段用 next dev）

- **复现/观察**：
  1. `verify-ai-two-state` 的哨兵断言只覆盖响应文本（`scripts/verify-ai-two-state.mjs:422-427`）；daemon 日志只存哈希（`488-489`），临时根成功即删——**门禁自身无法证明日志/磁盘无明文**。本轮用独立探针补证（`ai-probes.json` `byok.disk-scan` 零命中），门禁仍应自证。
  2. 两门禁用 `mkdtemp(tmpdir())`（`verify-ai-two-state.mjs:247`、`verify-image-two-state.mjs:322`），默认 `/tmp`；审计纪律明确禁用（tmpfs 3.9G，可能 ENOSPC/被清）。
  3. UI 段自起 `next dev`（`scripts/lib/ui-mount.mjs:151`），与《实现工作流》「live 浏览器门禁一律 `next build` + `next start`」的现行口径不一致；本轮通过，但属环境敏感偏离。
  4. 出图证据缺显式 `cloudCalls: 0` 标注（AI 门禁有）。
- **证据**：上述行号；本轮日志 `$EV/logs/verify-ai-two-state.log`、`verify-image-two-state.log`。
- **影响**：门禁绿的含义弱于其声明；后续若出现日志/磁盘泄漏，现门禁不会红。
- **建议**：哨兵断言扩展到 daemon stdout/stderr 与临时数据根（在删除前扫描）；临时根默认落 `$DF_EVIDENCE_DIR/tmp` 或显式 `DF_TMP_ROOT`；UI 段切生产构建；证据统一 `cloudCalls`。归 #60 门禁硬化，回归 R-06-10。
- **五态**：partial（门禁工具，不是产品功能）。

### F-06-11 · C · partial · mock 保真度不足，掩盖真实契约漂移

- **复现/观察**：
  1. 出图 mock 的 `/interrupt` 只回 `{ok:true}`，不模拟「全局中断当前执行」、也不模拟 `/queue delete`（`scripts/verify-image-two-state.mjs:187-190`）；因此门禁的取消 AC 在 F-06-01 存在时仍全绿。
  2. AI mock 只发完整合法 SSE；单测「零 data 帧」只覆盖 keep-alive（`apps/daemon/src/routes/ai.test.ts:385`），未覆盖 `[DONE]`-only/坏 JSON（F-06-02）。
  3. 出图 mock 固定 `/view` 200、固定 history success，不覆盖取回失败/任务失联/daemon 重启（F-06-04/05/B-08）。
- **证据**：见各条；`$EV/logs/verify-image-two-state.log`、`verify-ai-two-state.log`。
- **影响**：mock 绿不能代表真 ComfyUI/真上游契约；B 级缺陷穿门而过。
- **建议**：mock 建模 ComfyUI 队列删除与全局中断、SSE 空流/坏帧、`/view` 失败与任务失联；把 F-06-01/02/04/05 纳入回归。回归 R-06-11。
- **五态**：partial（测试工装）。

### F-06-12 · B · missing · 出图任务持久化 / 崩溃恢复（B-08 / P4b）

- **复现**：提交任务 → 重启 daemon（同一 dataRoot/workspace）→ `GET /image/runs/:id` 404 `comfy_run_not_found`；`GET /image/runs` 404 `not_found`；数据根只剩 `config.json`、`image/assets/<sha>.png`、`telemetry/events.jsonl`。
- **证据**：`$EV/probes/image-probes.json`（`daemon-restart-b08`）。
- **根因**：任务登记与溯源只在进程内 `Map`（`apps/daemon/src/image/client.ts:63-77,134`）；路由无任务清单（`apps/daemon/src/routes/image.ts:60-70`）；契约注释提到的 `provenance/image-runs.jsonl`（`packages/contracts/src/image/index.ts:74`）**没有任何写入方**；`targetNodeId/documentId` 只接收不使用（P4b）。
- **影响**：daemon 崩溃/升级/重启后，进行中与历史任务全部「消失」；已生成的图还在磁盘但无索引/溯源；画布回写不可用。属路线图 P4b 缺口，按 missing 登记，不计为 broken。
- **建议**：`<dataRoot>/image/runs.jsonl`（或 SQLite）记录 runId/promptId/模板/参数/状态/产物哈希，启动时恢复 `queued/running` 并以 ComfyUI `/history` 对账；`/image/runs` 提供清单；产物索引与 `image-runs.jsonl` 对齐。实现后补回归。
- **五态**：missing。

### F-06-13 · B · missing · 受控 AI 写入 / 变更提案（B-09 / P5）

- **复现/证据**：
  - AI 输出在抽屉里以文本节点渲染（`apps/web/src/features/ai/components/AiDrawer.tsx:199`）；AI/出图 feature 无 `dangerouslySetInnerHTML`、无工具调用解析、无 apply/write 路由（`grep` 全仓确认）。
  - MCP 桩接受 `caller:"local-ai"` 的 `df_apply_patch` 提案（201，`stub:true`），ack 后 `applied:false`，文档不变（`apps/daemon/src/mcp/stub.ts:169-193`）。
  - 注入探针后文档/工作目录/MCP 审计/遥测均无变化。
- **影响**：AI 只能「建议文本」，不能把建议应用到画布；这正是 prompt injection 当前无越权写路径的原因，但产品侧也缺 P5 闭环。属路线图缺口，按 missing 登记。
- **建议**：P5 接入时保持三段式（AI 只产生 proposal → 用户确认 → 应用），提案带 `documentId/baseRev/ops` 与不可信内容来源；MCP 桩的 `stub:true/applied:false` 已为该契约留位。实现后补注入回归（R-06-12）。
- **五态**：missing。

## 5. Prompt injection 专项结论

1. **攻击面**：当前只有「用户输入 → daemon → DeepSeek → 文本回显」一条链；AI 不读取市场内容/文档名/文档正文，也没有 tool/function call、命令执行、文件读写或 MCP 调用路径。
2. **展示边界**：`AiDrawer` 用 React 文本节点渲染 `state.content`（`AiDrawer.tsx:199`），`<script>`/`onerror` 等被转义；AI/出图 feature 无 `dangerouslySetInnerHTML`。
3. **实测**：恶意 prompt（要求删文档、`rm -rf ~/.dforge`、读 `credentials.key`、自动 MCP ack）+ 恶意上游响应（带 `<script>`、`df_apply_patch` JSON、`rm -rf`、外链）后：上游调用 1 次；workspace 文件哈希与文档列表不变；MCP 审计零记录；遥测无注入文本；响应内容与上游一致（仅展示）。
4. **结论**：**当前无越权写入/命令执行/密钥读取**；防线是「能力不存在」（B-09 missing），不是过滤或模型对齐。残余风险是**误导性文本/社工**与未来 P5 接线后的工具滥用。
5. **交叉引用**：AI prompt 不落遥测/磁盘（F-03-09 的自由文本风险不成立于本路径）；但 prompt 会按设计发往上游，用户粘贴密钥仍会外发——属使用边界，建议设置页提示「不要把密钥粘进 prompt」。BYOK 本身只在 daemon→上游方向出现，响应/日志/磁盘/遥测均无明文（`ai-probes.json` `byok.*`）。

## 6. 本域五态能力表

| ID | 能力 | 五态 | 级别 | 证据/说明 |
|---|---|---|---|---|
| B-01 | AI 抽屉/意图卡/步骤流 | **working** | C | AI 门禁 16 步；四步时序 queued→llm→validate→compile；F-06-02 为结果正确性缺陷，不否定步骤流 |
| B-02 | 无 key/上游失败降级 | **working** | C | 门禁 A 段 + `no-key`/`error-map` |
| B-03 | 有 key 真 DeepSeek 上游 | **blocked** | B | 无真实 key；只验 mock；B-03 不写成通过 |
| B-04 | BYOK 凭据安全 | **working** | C | 0600/AES-GCM/掩码/重启/清除；日志+磁盘+响应+遥测零明文 |
| B-05 | 出图面板（进度/取消/OOM 降档） | **partial** | B（关联 F-06-01） | 正常态/OOM/运行中取消通过；排队取消语义错、任务失联永久 queued、产物空成功 |
| B-06 | ComfyUI 未启动/缺模型结构化失败 | **partial** | B（关联 F-06-03） | 未启动/真缺模型结构化通过；`object_info` 超时误判缺模型、重新探测受缓存影响 |
| B-07 | 真 ComfyUI 正常态 | **blocked** | B | 8188 ECONNREFUSED；mock 正常态通过 |
| B-08 | 出图任务持久化/崩溃恢复（P4b） | **missing** | B | F-06-12；重启 404、无清单、无 provenance 落盘 |
| B-09 | 受控 AI 写入/变更提案（P5） | **missing** | B | F-06-13；MCP 桩只提案 `applied:false` |

汇总：**working 3 / partial 2 / missing 2 / blocked 2**（B-01…B-09 共 9 项；B-03/B-07 为环境 blocked，B-08/B-09 为路线图 missing）。

## 7. Blocked（不得写成通过）

| 项 | 前置 | 本票实测 | 影响 |
|---|---|---|---|
| B-03 真 DeepSeek | 真实 key（一次性安全注入） | `DF_DEEPSEEK_API_KEY` unset；全部上游为本机 mock | 真实模型输出质量/限流/鉴权未验；F-06-02/07 的真实触发率未知 |
| B-07 真 ComfyUI | ComfyUI 服务 + 模型 | `127.0.0.1:8188` ECONNREFUSED（exit 7） | F-06-01（取消语义）、F-06-03（object_info 超时）按 ComfyUI 公开 API 语义 + mock 判定，真实服务影响待解锁复验 |
| REF-01 视觉对照 | 参照集冻结 | 不在本票范围 | 本域无像素级结论 |

## 8. 回归候选（修复后补；当前不写必红测试）

| ID | 对应 | 断言建议 |
|---|---|---|
| R-06-01 | F-06-01 | mock Comfy：排队任务 cancel → `POST /queue {delete:[id]}` 恰好一次且不调 `/interrupt`；运行中任务 cancel → `/interrupt`；终态与 ComfyUI 队列一致 |
| R-06-02 | F-06-02 | 上游 SSE 只发 `[DONE]`/坏 JSON/空 choices → `done.degraded=true, degradedReason=invalid-response`；至少 1 个合法 delta 才算成功 |
| R-06-03 | F-06-03 | 慢 `/object_info`（>1.5s）→ 不得误判 `comfy_model_missing`；探测/提交给出可重试或延长超时 |
| R-06-04 | F-06-04 | history success + `/view` 失败 → 不得 `succeeded+空 artifacts`；应为失败态或可重试 |
| R-06-05 | F-06-05 | ComfyUI 侧任务消失 N 次/超时 → `failed(comfy_task_lost)`，前端停表并给动作 |
| R-06-06 | F-06-06 | 服务恢复后「重新探测」立即 reachable（force 或失败结果不缓存） |
| R-06-07 | F-06-07 | 401/403 → `unauthorized` + `configure-credentials` 建议 |
| R-06-08 | F-06-08 | 流式与一次性同样透传 `temperature/maxTokens` |
| R-06-09 | F-06-09 | 流式 AI 落 `ai.run/ai.degraded`；出图终态落 completed/failed（不含 prompt 明文） |
| R-06-10 | F-06-10 | 门禁：哨兵在 daemon 日志 + 临时数据根零命中；临时根不在 `/tmp`；UI 段生产构建；证据含 `cloudCalls: 0` |
| R-06-11 | F-06-11 | mock 建模 ComfyUI 全局中断/队列删除、SSE 空流/坏帧、`/view` 失败、任务失联、daemon 重启 |
| R-06-12 | B-09/P5 | 注入文本 + 工具调用提案：未确认前文档零变化；确认后仅在 `baseRev` 匹配时应用；审计含来源 |

## 9. 证据索引

全部证据在 `~/df-evidence/audit-50/aud-06/`；哈希见 `$EV/logs/evidence-sha256.txt`。

| 证据 | 路径 | 内容 |
|---|---|---|
| AI 两态门禁 | `$EV/logs/verify-ai-two-state.log`；`$EV/fe-10/verify-ai-two-state.json` | 16 步、UI passed、`cloudCalls:0`（sha256 `4784e0e5…`） |
| 出图两态门禁 | `$EV/logs/verify-image-two-state.log`；`$EV/fe-10/verify-image-two-state.json` | 12 步、UI passed（sha256 `55d5a368…`） |
| 真浏览器截图 | `$EV/fe-10/ui-ai-drawer.png`；`$EV/fe-10/ui-image-panel.png` | 降级提示 / 未启动恢复动作 |
| AI 探针 | `$EV/probes/ai-probes.json`；`$EV/logs/ai-probes.log` | 无 key、BYOK 哨兵/权限/重启/清除、错误映射、断连、超时、注入、B-09 |
| 出图探针 | `$EV/probes/image-probes.json`；`$EV/logs/image-probes.log` | 缺模型、object_info 超时、探测缓存、产物失败、取消漂移、任务失联、重启、8188 |
| AI 参数/半包探针 | `$EV/probes/ai-param-probe.json`；`$EV/logs/ai-param-probe.log` | 流式丢参数；SSE 半包拼回 |
| 全量门禁 | `$EV/logs/pnpm-verify.log`；`$EV/logs/pnpm-verify-final2.log`；`$EV/logs/test-scripts-final.log` | 292 文件 / 2765 例，exit 0；合并 04 后复跑 exit 0；脚本自测 exit 0 |
| 探针脚本 | `$EV/probes/probe-lib.mjs`、`ai-probes.mjs`、`image-probes.mjs`、`ai-param-probe.mjs` | 仓库外探针；临时根已删除（含假哨兵密文），结果 JSON 不含 key |

## 10. 未做 / 边界

- **未改产品代码**、未新增仓库测试；本票只产出报告与仓库外证据（按 #50「未实现功能不写必红测试」）。修复建议已逐条写明。
- **未使用真实 key**、未向聊天/日志/证据写真实 key；探针哨兵为运行时拼接的假值，临时数据根在取证后删除。
- **未启动真实 ComfyUI**；F-06-01/F-06-03 的真实服务触发率需在 B-07 解锁后复验（尤其 `/object_info` 体积与 `/interrupt` 版本差异）。
- 未做真实模型下的 prompt injection 效果评估（模型行为不可控）；结构结论「无写入/工具路径」与模型无关。
- 未做视觉/像素对照（REF-01 blocked，归 #59 汇总）。
