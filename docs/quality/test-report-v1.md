# 设界 · DesignForge 测试报告（v1.0）

- **状态**：已定稿（执行完毕，结论见 §6）
- **日期**：2026-10-17
- **角色**：企业级测试工程师
- **测试对象**：合并后的 `main`——批次 2/3/4 全部并入（`2eaf9af`），含测试周期内发现并修复的门禁工装缺陷（PR #43 → `76862e1`）
- **配套**：《测试计划 v1》（`test-plan-v1.md`）、《企业级架构设计 v1.0》（`docs/architecture/`）
- **执行证据**：`~/df-evidence/quality-2026-10-17/`（20 个门禁日志 + `summary.txt` + 各门禁证据 JSON）

---

## 1. 执行概况

| 项 | 值 |
|---|---|
| 代码版本 | `main` @ `2eaf9af`（测试执行基线）；缺陷修复后复测 @ `76862e1` |
| 环境 | Node 24.9.0 · pnpm 10.33.2 · Chromium（`~/.cache/ms-playwright`，playwright-core 1.63 锁 1243）· WSLg（DISPLAY=:0，壳门禁） |
| 测试实例 | 独立 daemon 4401 + 生产站 3911 + 仓外数据根（`~/df-evidence/quality-2026-10-17/env`，含 MK-05 真实 344 卡索引 + BM25 索引） |
| 隔离纪律 | 未触碰常驻实例 3000/4318 与真实数据根 `~/.dforge`；进程按精确 PID 回收 |
| 执行方式 | 单条脚本串行执行全部门禁（三态退出码逐条留痕） |

## 2. 执行结果矩阵

| 门禁 | 退出码 | 判定 | 关键数字 |
|---|---|---|---|
| `pnpm verify`（lint+typecheck+test） | **0** | 通过 | **2756 例 / 9 包全绿**（web 1335 · ingest 579 · engine 312 · ui 165 · desktop 121 · daemon 118 · contracts 80 · cli 45 · comfy 1） |
| `pnpm e2e:smoke`（真链路 63 步） | **0** | 通过 | **63/63**：canvas 10 · editor 17 · home 8 · nav 21；0 fail / 0 blocked / 0 pageError |
| `verify-canvas`（浏览器门禁） | **1 → 已修复** | **发现缺陷 DEF-01** | 基线跑：挂载 5/6（A6 保存→重载 502）、接线 15/15；修复复测：**挂载 6/6 + 接线 15/15**，退出码 2（截图段参照集未冻阻塞） |
| `verify-market` | **0** | 通过 | 令牌零裸值、D1–D6 六态挂点全命中、真索引可判定、E1/E2/E3 数据面断言全过 |
| `verify-figma-review` | **2** | 阻塞（预期） | 交互：comments passed / versions·two-step-confirm **passed** / present **skipped**（裸宿主空文档的结构性前置；C 包以产品路径播种画板后该断言已实测 passed，见批次 4 证据）；退出 2 仅因参照集未冻 |
| `verify-self-designed` | **0** | 通过 | 自设计页 §6 自动项 |
| `verify-figma-baseline` | **2** | 阻塞（预期） | 参照集未冻结，无假绿 |
| `verify-shell-parity` | **2** | 阻塞（预期） | 冒烟 **0**（装载真实产物 + 视口 1440×900@DPR1.5 + 安全五顶）· 交互存活 **0**（35s 窗口后仍存活）· 对照段 2（参照集未冻） |
| `verify-engine` | **0** | 通过 | 快照哈希独立复算一致 |
| `verify-daemon` | **0** | 通过 | 冒烟 + 对抗用例（含路径穿越/注入） |
| `verify-mcp-stub` | **0** | 通过 | 三段式 + 超时失效 410 |
| `verify-ai-two-state` | **0** | 通过 | 无 key 降级 + mock 有 key；真浏览器 UI 段 passed（16 步） |
| `verify-image-two-state` | **0** | 通过 | ComfyUI 未启动 + mock 正常态；UI 段 passed（12 步） |
| `verify-mk-01…05` | **0×5** | 通过 | 六环判据链（真实批次：42 仓 / 1496 认定 / 1135 可装载 / 344 卡 / 15 查询 / 复跑逐层 digest 一致） |
| `guard-tokens` / `guard-vocab` / `guard-feature-boundaries` / `guard-electron-baseline` | **0×4** | 通过 | 令牌零裸值（含 `.svg` 扫描面）· 词表同源 · 特性边界 · 壳安全静态基线 |
| `test:scripts` | **0** | 通过 | 门禁脚本自测 |
| `pnpm audit --prod` | **0** | 通过 | **0 已知漏洞** |

**CI**：合并后 `main` 最终 head `2eaf9af` → **success**；缺陷修复 PR #43 → CI 绿后合入（`76862e1`）。

## 3. 用例执行统计

| 类别 | 数量 | 结果 |
|---|---|---|
| 单元/组件/集成用例（9 包） | 2756 | 全通过 |
| e2e 用户路径步骤 | 63 | 全通过（0 fail / 0 blocked） |
| 浏览器门禁断言（canvas：挂载+接线） | 21（6+15） | 修复后全通过 |
| 市场门禁断言（六态挂点 + 数据面） | 通过 | 全通过 |
| 评审交互断言 | 3 | 2 passed + 1 skipped（宿主前置） |
| 采集线判据环 | 6 | 全通过 |
| 门禁脚本自测 | 56 | 全通过 |
| 安全抽检（穿越 5 变体/CORS/凭据/审计） | 8 类 | 全通过（历史验收实弹 + 本轮 audit） |

**阻塞项（按三态语义记为「阻塞」，不计通过也不计失败）**：REF-01 参照集未冻结导致的视觉对照段（figma 族 / canvas 截图段 / shell 对照段）；壳内静态导出对照。**全部点名原因，无假绿。**

## 4. 缺陷记录

### 4.1 本轮发现并已修复

**DEF-01 · 门禁工装回归：`forwardDaemonRequests` 把请求体放进 `headers`**（严重度：中；发现于「复用外部 daemon」的浏览器门禁路径）

- **现象**：`verify-canvas` 挂载断言 `A6-save-reload-restore` 失败，页面提示 `HTTP 502：TypeError: Cannot convert argument to a ByteString ... character at index 9 has a value of 30011`。
- **根因**：批次 4 收口复核 J8「回抽共享件」重构（`6b197d5`）时，把 `body` 从 `fetch` 选项的兄弟位置误放进 `headers`——POST 体（`{"name":"画布夹具"}`）成了 `body` 头的值，第 9 位恰为「画」（U+753B），undici 拒绝非 Latin1 头值 → 请求 502。原 inline 实现是正确的兄弟写法（同族 `gates.mjs` 亦正确）。
- **影响面**：所有复用外部 daemon 的门禁路径（verify-canvas / ui-mount / e2e-smoke 共享此 helper）；**产品运行时代码不受影响**。CI 未拦截的原因：逐包门禁均以「自起 daemon」路径运行（useProxy=false），外部 daemon 转发路径无覆盖。
- **修复**：`body` 移回 fetch 选项兄弟位（PR #43，`9dda208`，单文件 −4/+2）。
- **复测**：同环境复跑 `verify-canvas` → **挂载 6/6 + 接线 15/15 全过**，退出码 2（仅参照集阻塞）；证据 `~/df-evidence/fe-06/verify-canvas-2026-10-17T02-08-51.json`。
- **改进**：为「复用外部 daemon」的转发路径补一条常绿用例（列入后续建议，见 §7）。

### 4.2 开放缺陷与已知债（非本轮引入；均有登记与处置口径）

| # | 项 | 级别 | 状态/口径 |
|---|---|---|---|
| O-01 | REF-01 参照集未冻结 → 全部视觉对照判定不可出结论 | 条件 | 人工采集（#28）；冻结前门禁按 `exit 2` 阻塞属预期，禁假绿 |
| O-02 | 市场 digest 口径未裁决 → 设计系统类卡片 0 | B（数据债） | 人工裁决（#39）；v2 方案已备 |
| O-03 | `/editor` 与 `/_canvas` 装配层剩余差异（会话换代/URL 参数名/提示层） | C | 已登记（架构 §6 A-03），非阻塞 |
| O-04 | Electron 静态导出装载路径未就绪 | C | 已登记（A-05）；壳当前依赖 URL/内置静态服务 |
| O-05 | `next dev` 源下客户端引导件不加载 → live 门禁用生产构建 | C（环境） | 已写入工作流纪律（A-06） |
| O-06 | 负载下测试 flake（超时面）与 vitest 共享缓存竞态 | C（环境） | 已登记（A-07）：只放宽超时上限、不放宽断言；缓存竞态用可重试删除 |
| O-07 | figma 系列与 shell 门禁仍有 Chromium/代理副本未回抽 | C（债） | 已销账（批次 5 · E：8 个门禁脚本改用 `scripts/lib/browser-toolchain.mjs`；ADR-0004 债二补记） |
| O-08 | 评测期本机常驻实例两次被 SIGTERM（一次代理 pkill 误伤、一次成因未明） | 事故（非产品缺陷） | 已恢复并写入纪律：**禁止 `pkill -f` 按模式杀进程** |

### 4.3 Flake 与观测

- `editor` 场景首步「新建→等卡片」曾在批次 4 实施期偶发（3 轮 1 次）→ 根因为新建对话框默认名竞态，已根治（渲染期重置 + `flushSync` 回归锁 + e2e 护栏）；**本轮 3 轮复测 63/63 全绿**，未再复现。
- 本轮 `pnpm verify` 首跑无失败；此前高负载期出现过的 daemon 连接自检 33.9s 超时未复现（判定为负载 flake，已取证）。

## 5. 缺陷趋势与回归

- 批次 4 前：验收记录 8 类工程缺陷（D-1…D-8）+ 21 项 UX 问题。
- 批次 4 后：**D-1…D-8 全部关闭**（editor/nav e2e 与专项门禁固化回归）；UX-01…21 全部落地或登记。
- 本轮（合并后 main）：**新增 1 项缺陷（DEF-01，已修复并复测通过）**；无新增开放缺陷。
- 回归资产：`e2e` 场景 4 个（home/editor/nav/canvas）+ 全部三态门禁 + 双轴复核修复；同类问题不再依赖人工发现。

## 6. 质量评估结论

**结论：通过（附阻塞条件与已知债）**

依据：
1. 预期为 `0` 的全部门禁 **exit 0**（2756 例单测 + 63 步 e2e + 21 条画布断言 + 市场/采集/两态/守卫全绿 + 0 漏洞）；
2. 预期为 `2` 的阻塞项**逐一点名原因**（REF-01 未冻、壳内对照、挂点守卫），无任何假绿；
3. 本轮唯一新发现缺陷（DEF-01）为门禁工装回归，**已修复 + 同接缝复测通过**，产品运行时未受影响；
4. 无未登记的中高风险缺陷；已知债均有登记与处置口径。

**放行建议**：`main` 可交付/可演示。以下事项不构成本轮失败，但应在下一批收口：
- **必须人工**：REF-01 参照集采集冻结 → 复跑对照族并闭环差异；#39 digest 裁决；
- **建议**：为「复用外部 daemon」的转发路径补常绿用例（DEF-01 的逃逸面）；figma/shell 门禁副本回抽（O-07）；React 19 升级评估；桌面壳内置静态产物。

## 7. 交付物索引

| 交付物 | 位置 |
|---|---|
| 测试计划 v1 | `docs/quality/test-plan-v1.md` |
| 本测试报告 v1 | `docs/quality/test-report-v1.md` |
| 执行证据（20 门禁日志 + 摘要） | `~/df-evidence/quality-2026-10-17/` |
| 缺陷修复证据 | `~/df-evidence/fe-06/verify-canvas-2026-10-17T02-08-51.json`（DEF-01 复测） |
| 回归资产 | `scripts/e2e/scenarios/{home,editor,nav,canvas}.mjs`、`scripts/verify-*.mjs`、`scripts/guard-*.mjs` |
| 架构交付物 | `docs/architecture/enterprise-architecture-v1.md` |
| 合并记录 | PR #40 → `8f98d9b5`；PR #42 → `2eaf9aff`；PR #43（缺陷修复）→ `76862e1` |

*报告完 · 2026-10-17*
