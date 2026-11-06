# PR_BATCH_5 — D-06/D-07/D-08 数据面容错 + bodyLimit（audit-d05）

- **分支**：`fix/ingest-tolerance-bodylimit`（工作树 `/home/QIU/df-wt/audit-d05`）→ **已合并 main**（合并后 main 复验 `pnpm verify`=0 · `verify:mcp-stub`=0）
- **依据**：`docs/audit/DEFECTS.md` D-06/D-07/D-08 · 审计红测（q8-q9-red.log）· perf @5k `Request body is too large` 实证

## 变更说明（4 commits）

| 缺陷 | 文件 | 变更 |
|---|---|---|
| D-06 | `transform/dwd/store.ts` + 导出面 + 新增 `store-corrupt.test.ts`（4 例） | readTable JSON 列坏格**降级 null + 逐格告警**（表名/行号/列名），返回类型不变 |
| D-07 | `collect/client.ts` + 导出面 + `run.ts` 接采集日志 + 新增 `client-corrupt.test.ts`（3 例） | parseRecordedResponses 坏行跳过+逐行告警（含截断原文），非 JSON 与缺 url 两类都兜 |
| D-08 | `contracts/ipc/errors.ts`（`body_too_large`→413）+ daemon `body-limit.ts` 新模块 + `app.ts` 接线 + 9 例测试 | **缺省 32MB**，env `DF_BODY_LIMIT` 可配（非法值回退缺省，≤0/>1GB 拒绝）；413 人话中文信封（含当前上限与 env 提示） |
| 附带 | `services/ingest/src/score/build.test.ts` | 基线预存 lint 红（biome useTemplate）机械修复——语义逐字节不变 |

**告警承载**：可选 `onWarning` 回调 + 缺省 stderr（最小侵入：好数据路径逐字节不变、既有调用方零改动、不静默吞）。

## 测试结果（证据 `~/df-evidence/audit-d05/`）

| 验收 | 结果 |
|---|---|
| `pnpm verify` | **exit 0**（3419 例：contracts 85/engine 396/ui 283/desktop 125/comfy 1/web 1708/ingest 586/cli 45/daemon 190） |
| 审计红测恢复仓内转绿 | **exit 0**（7 例）——Q8/Q9 销号 |
| `verify:mcp-stub` | **exit 0**（16 步 0 失败） |
| 大 body 实测（临时 daemon+令牌） | POST 201 → **PUT ≈2.0MB 200（44ms）** → GET 读回一致 |
| 合并后 main 复验 | verify=0 · mcp-stub=0 |

## 性能对比

2MB PUT 44ms（本机回环）；bodyLimit 上调移除 1MB 拒绝面——perf 门禁 @5k 档的 body 墙解除（正式基线重采在批7）。

## 风险

- bodyLimit 32MB：本机回环+令牌面内非远程攻击面，但 JSON 解析进内存须有界——32MB 留一个数量级余量，env 可收紧。

## 回滚

`git revert -m 1 <merge-sha>`；运行期可将 `DF_BODY_LIMIT` 收紧回 `1mb`（不改代码回滚阀）。

## 遗留

`documents.process.test.ts` 崩溃恢复用例仍取 ≈1MB 正文（注释已更新为「刻意收窄写入窗口」，非限制所迫）。
