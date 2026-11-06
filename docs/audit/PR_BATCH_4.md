# PR_BATCH_4 — D-04/D-10 保存超时可重试 + 文案单形态 i18n（audit-d04）

- **分支**：`fix/save-timeout-i18n`（工作树 `/home/QIU/df-wt/audit-d04`）→ **已合并 main**（merge `6fafe0f`，合并后 main 复验 `pnpm verify`=0 · `test:scripts`=0 · `verify:mcp-stub`=0）
- **依据**：`docs/audit/DEFECTS.md` D-04 / D-10 · `docs/audit/OPTIMIZATION_PLAN.md` §4 批4 行 · J9 三轮审计红证（`~/df-evidence/audit-2026-11/e2e/journeys/J9/r1-r3`，20s 窗恒 saving）

## 变更说明（2 commits，20 文件 +440/-60，全部在 apps/web）

| 缺陷 | 文件 | 变更 |
|---|---|---|
| D-04 | 新增 `src/lib/request-timeout.ts`（88 行）+ `documents-client.ts` / `daemon-client.ts` / `gateway-timeout.ts` 接线 | race+abort 机制单点：`DAEMON_REQUEST_TIMEOUT_MS=30s`（写路径给足慢盘余量）；`RequestTimeoutError` 走 i18n `daemon.requestTimeout`；保存主链路（J9 现场）与设置数据面接超时，请求挂死不再永久「保存中…」；gateway-timeout 改委托同一机制（公开 API 不变） |
| D-04 | `daemon-failure.ts` + 新增 `documents-client.timeout.test.ts`（4 例）+ `daemon-client.test.ts` 补超时用例 | 网络族新增「请求超时」短语：超时错误归网络族 → 保存态渲染 `editor.save.failed.network` 统一人话 + 可重试（与 D-10 单形态衔接） |
| D-10 | `daemon-failure.ts` | 网络族新增网关族 5xx（HTTP 502/503/504）：同源网关在 daemon 失联时代理成 502，修复前与 fetch abort 双形态并存（502 技术直出 vs abort 人话）；现统一渲染人话 + 原文沉技术详情（J7 单形态）；翻转旧钉「HTTP 502 不算网络失败」为 4xx/5xx 有响应状态反例 |
| D-10 | 硬编码中文 8 处收口（audit 清单全量 grep 复核）：`HomeView.tsx:179` 与 `home/api/documents.ts` 3 条 unreachable/脏响应文案（`home.error.*` 同键同源）、`McpConfirmBar` 兜底（`mcp.error.confirmFailed`）、`canvas-stage` 字体缺失计数（`canvas.status.fontsMissing`）、`import-ir` 与 `document-bridge` 无可用页面（`editor.load.noPages` 两宿主同键）、`daemon-client` 3 条 network 文案（`settings.error.network.*`）、`CreateComponentDialog` 默认名、`CodeExportPanel` 剪贴板兜底（`editor.export.code.clipboardUnsupported`） | `messages/{zh-CN,en}.json` 同步 11 键（zh-CN 唯一暴露，ADR-0003） |
| 断言 | `save-control.test.tsx` 新增 J7 单形态断言 + J9 UI 断言 | fetch abort、网关 502（非 JSON）、超时三种传输失败统一渲染 `editor.save.failed.network` 人话 + 原文沉技术详情 + 保存按钮可重按；daemon 明确拒绝（409 信封）维持「保存失败：doc_exists：…」不被误统一（回归钉） |

## J9 前后对照（浏览器级，同一把尺 `j9-compare.mjs` · 红转绿 1→0）

口径：生产构建（`next build` + `next start`，非 dev）+ playwright-core 1.63.0 / chromium-1243 headless；自起临时实例（daemon 5202 + 同源网关 + web 3210/3211 + 仓外临时数据根 + `?dfToken=` 令牌注入）；B 段把保存请求**无限期挂死**，观察窗 45s（> 30s 修复后上限，只放宽窗口不放宽断言）。

| 轮 | 构建 | 结果 | 关键步 |
|---|---|---|---|
| 修复前 | main tip `3598786`（`j9-before/`） | **exit 1（6/8）** | 45s 观察窗内恒 `saving`（时间线仅 35ms 一条）——Q6/D-04 缺陷复现；文案步骤同红 |
| 修复后 | 本分支（`j9-after/`） | **exit 0（8/8）** | `saving` 50ms → **30107ms 落失败态**（30s 超时兜底收口）；文案单形态「保存失败——无法连接本地服务，请确认 daemon 已启动后重新保存。」+ 技术详情含「本地服务请求超时：30000 毫秒内未响应」；重按保存恢复 `saved` |

## 测试结果（证据 `~/df-evidence/audit-d04/`）

| 验收 | 结果 |
|---|---|
| `pnpm verify`（分支上） | **exit 0**（9 包 3438 例：contracts 85 / engine 396 / ui 283 / desktop 125 / comfy 1 / web 1727 / ingest 586 / cli 45 / daemon 190） |
| J7/J9 单测（4 文件） | **exit 0**（38 例：daemon-failure 14 / daemon-client 15 / documents-client.timeout 4 / save-control 5） |
| `node scripts/guard-vocab.mjs` | **exit 0** |
| J9 浏览器级前后对照 | 前 **exit 1**（6/8）→ 后 **exit 0**（8/8） |
| 合并后 main 复验 | verify=0 · test:scripts=0 · mcp-stub=0 |

## 风险

- 30s 超时对慢盘大文档写路径可能误伤——`DAEMON_REQUEST_TIMEOUT_MS` 缺省 30s 是按写路径「给足余量」取的，env 可调；超时后保存态可重按，失败有界（不静默丢写）。
- 超时错误归网络族渲染统一人话：daemon 明确拒绝（409 信封）仍有回归钉保护，不被误统一。

## 回滚

`git revert -m 1 6fafe0f`；运行期可将 `DAEMON_REQUEST_TIMEOUT_MS` 调大（不改代码回滚阀）。

## 遗留

无新增遗留。审计原始红证轮（20s 窗恒 saving）为修复前口径，已由 45s 窗前后对照覆盖；Q6/D-04、J7 文案项随本批销号。
