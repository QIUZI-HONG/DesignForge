# E2E 报告（E2E_REPORT）— 阶段2 · 2026-11-05/06

- 工具选择：**playwright-core 1.63.0 + chromium-1243**（仓内既定栈：与既有门禁脚本同框架，零新增依赖；负载工具未引入——本地单用户产品无并发负载场景，并发类用 J8 双页实测替代）。
- B1 环境修复记录：Chromium 缺 5 系统库 → **免 root 方案**（`apt-get download libnss3 libnspr4 libasound2t64` + `dpkg -x` 至 `~/df-evidence/chromium-deps/root` + `LD_LIBRARY_PATH`），缺库 0、Chromium 可启动；用户未执行 sudo 版本。
- 站点：生产构建（`pnpm --filter @dforge/web build`，Next 16.4.1）+ `next start -p 3100`；门禁自包含模式（各自管理站点+夹具 daemon 生命周期）。
- 证据根：`~/df-evidence/audit-2026-11/gate-browser/`（门禁）与 `~/df-evidence/audit-2026-11/e2e/journeys/`（旅程，含 steps.json/trace.zip/截图）。

## 0. 结论摘要

- **浏览器门禁 4 绿 + 2 红项（均为真缺陷，已根因定位）+ 1 预期阻塞**；FE-10 两态门禁 **UI 段全绿（exit 0）**——阶段0 的最大阻塞面彻底解除。
- **机器人旅程 8/10 通过（步级 57/60）**；J5/J9 为确定性产品缺陷（非 flaky）；**flaky 率 0%**（J1 三轮全过、J5 三轮全红同因）。
- 关键新发现：canvas 页持久化往返断裂（产品缺陷 A+B）、editor 导入未接线、保存无超时兜底（Q6 实证）、双页并发静默丢更新、错误文案双形态（i18n 落差）。

## 1. 浏览器门禁矩阵（自包含实跑，2026-11-05 16:33-16:37）

| 门禁 | 退出码 | 判定 | 耗时 |
|---|---|---|---|
| verify:command-palette | 0 | ✅ 通过 | 12s |
| verify:layers-reorder-persist | 0 | ✅ 通过（拖拽重排+undo+持久+眼睛） | 13s |
| verify:ruler-guides-persist | 0 | ✅ 通过 | 11s |
| verify:text-inline-edit | 0 | ✅ 通过 | 12s |
| verify:canvas | **1** | ❌ A6 持久化往返断（其余 6 挂载+14 接线断言全过）→ 根因=产品缺陷 A+B | 51s |
| e2e:smoke | **1** | ❌ canvas 场景 45s 超时（editor/home/nav 场景全过：建→画→存→重开→导出 PNG/SVG/PDF ✓） | 67s |
| verify:shell-parity | 2 | 预期阻塞（REF-01 参照集未冻结；**shell-smoke 与 shell-alive 两段已实跑通过**——Electron 二进制经镜像拉取后解锁） | 36s |
| verify-ai-two-state | **0** | ✅ **UI 段解除阻塞，全过**（阶段0 为 exit 2） | 4s |
| verify-image-two-state | **0** | ✅ **UI 段解除阻塞，全过** | 4s |
| verify:perf | 2 | 阻塞——三档三墙：①`page.evaluateOnNewDocument is not a function`（**门禁脚本 puppeteer API 误用**）②@5k `Request body is too large`（**daemon bodyLimit 1MB 上限，真实产品限制**）③@20k fetch failed | 7s |

## 2. 机器人用户旅程（10 条，真实点击/键盘/指针，每轮独立夹具 daemon + trace/截图存证）

| # | 旅程 | 结果 | 轮次 | 证据 |
|---|---|---|---|---|
| J1 | 核心创作：新建→画→拖→缩放→保存 | ✅ 3/3（flaky 探针 0%） | 5.5-5.8s/轮 | journeys/J1/r1-r3 |
| J2 | 图层重排→F5 保持 | ✅ | 3.9s | journeys/J2/r1 |
| J3 | 文本双击改写→刷新保持 | ✅ | 3.7s | journeys/J3/r1 |
| J4 | 命令面板⌘K→形态→执行→Esc | ✅ | 3.3s | journeys/J4/r1 |
| J5 | 导出→刷新→导入往返 | ❌ 0/3 | 4.2s | journeys/J5/r1-r3 |
| J6 | AI 两态（确认桩/拒绝/降级） | ✅ | 3.7s | journeys/J6/r1 |
| J7 | daemon 故障恢复（kill→错误态→同端口重启→恢复） | ✅ | 6s | journeys/J7/r1 |
| J8 | 重复提交（连点5）+双页并发 | ✅（发现静默丢更新，见 DEFECTS） | 6.7s | journeys/J8/r1 |
| J9 | 断网 abort + 保存挂起 30s | ❌ 0/3（Q6 实证） | 25s | journeys/J9/r1-r3 |
| J10 | 会话收尾数据完整性 | ✅（manifest/页体齐全无半写） | 3.9s | journeys/J10/r1 |

- 通过率：旅程级 8/10（80%）；步级 57/60。flaky 率 **0%**（J1 0/3 失败；J5/J9 为确定性缺陷，重复 3 轮同因同位）。
- J5 根因：**导入未在 /editor 接线**——`importIr` 恒回 `{"ok":false,"error":"未接入导入"}`；仅 `/_canvas` 接线（canvas-studio.tsx:391），/editor 走兜底（canvas-debug.ts:165）。
- J9 根因：**保存链路无超时**——请求挂 30s，顶栏恒「保存中…」不收口（Q6 实证）；web 侧仅 daemon 探测有超时（daemon-endpoint.ts:200）。
- Q1 实证（错误文案双形态）：502 →「保存失败：响应不是合法 JSON（HTTP 502）」（技术直出）；fetch abort → 人话文案+可折叠技术详情。两形态不一致。

## 3. 数据隔离核查

- 旅程代理页面曾疑连缺省 daemon → **核查 4318 用户真实 daemon：本次审计零写入**（`ux-audit-*` 3 文档时间戳 2026-10-30，为用户早前会话残留，非本次产物；证据 `e2e/contamination-4318.txt`）。
- 全部门禁/旅程均用临时数据根；收尾无残留 daemon 进程、5200-5299 无监听。

## 4. 环境事件（如实记录）

- 16:23-16:40 共享站点被 layers 门禁 release() 的「回收残留监听进程（端口 3100）」误杀 → 门禁改自包含模式重跑；旅程首批 J7-J10 受波及后全部重跑。**教训（进优化计划）：门禁对外部 DF_WEB_URL 站点的回收语义需与「复用」模式自洽。**

## 5. 下一步

红项根因与 5 Whys 见 `DEFECTS.md`；处置进 `OPTIMIZATION_PLAN.md`。
