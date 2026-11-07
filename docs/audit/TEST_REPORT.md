# 测试报告（TEST_REPORT）— 阶段1 · 2026-11-05/06

对应计划：`docs/audit/TEST_PLAN.md`。执行环境：node v22.16.0（ZCode 自带，PATH 注入）· pnpm 10.33.2 · 全程未触碰 4318 用户 daemon 与 `~/.dforge`。

## 0. 结论摘要

- **常规链与门禁矩阵全绿**：lint/typecheck/test 3372+128 例 0 失败，4 守卫 + engine + mcp-stub 全 exit 0；9 个 exit-2 全部为 AGENTS.md 声明的预期阻塞位，无假绿。
- **覆盖率（临时安装 @vitest/coverage-v8@5.0.5 度量，量完已回滚清单）**：**8 包行覆盖全部 ≥80% 达标（86.0%~94.6%）**；分支覆盖未达 90% 目标（67.5%~89.9%）→ G4 偏差记入缺陷表，补测差口聚焦 daemon/cli 关键分支。
- **安全实测**：H1（daemon 本地特权面）在临时实例上**利用链实证**（P1）；Q8/Q9 数据面健壮性缺陷以红测**复现实锤**（P2）。
- **依赖**：生产面 0 high/critical（fast-uri 8 条 moderate/low）；dev 面 1 high（electron <44.9.1）。

## 1. 门禁矩阵（同 BASELINE §4，此处为终版判定）

通过=0：install / lint / typecheck / test / test:scripts / guard×4 / verify:engine / verify:mcp-stub。
预期阻塞=2×9：ai/image 两态（数据面 13+8 项 0 失败，仅 UI 段缺 Chromium）、figma-baseline / motion / perf（挂点）、guard:deps / mcp-contract / channel-pairing（未实现）。
真违规=1×0。**三态语义契约完好**。

## 2. 覆盖率度量结果（vitest run --coverage，报告全量落 `~/df-evidence/audit-2026-11/coverage/`）

| 包 | Lines | Branches | Functions | 行≥80% | 分支≥90% |
|---|---|---|---|---|---|
| @dforge/ui | **94.62%** | 86.24% | 98.19% | ✅ | ✗ |
| @dforge/contracts | **92.89%** | 82.89% | 98.38% | ✅ | ✗ |
| @dforge/desktop | **91.12%** | 89.90% | 86.11% | ✅ | ✗ |
| @dforge/ingest | **91.40%** | 80.09% | 93.38% | ✅ | ✗ |
| @dforge/engine | **89.71%** | 79.49% | 86.55% | ✅ | ✗ |
| @dforge/daemon | **89.07%** | **70.27%** | 88.41% | ✅ | ✗（最弱之一） |
| @dforge/web | **88.64%** | 77.45% | 85.53% | ✅ | ✗ |
| @dforge/cli | **86.00%** | **67.51%** | 85.71% | ✅ | ✗（最弱） |

- 行覆盖目标（核心模块 ≥80%）**全达标**——先前 test/source 比低估了实际覆盖。
- 分支覆盖差口：daemon 70.27%（路由错误分支/边界）、cli 67.51%（命令参数分支）、web 77.45%。**G4 判定：分支目标未达，列为补测差口**（进 OPTIMIZATION_PLAN 分批补，不阻塞本次审计结论）。
- 覆盖率基建已验证可用（一次安装即可度量）——优化计划可含「coverage 常设化 + CI 报数」。

## 3. 安全专项

### H1 daemon 本地特权面（P1 · 利用链实证）
临时实例（DF_PORT=47391 / 临时数据根 / 用毕按 PID 回收）探针，证据 `~/df-evidence/audit-2026-11/baseline/h1-probe.txt`：
- P1 恶意 Origin `http://evil.example`：**200 + 全量数据**返回，无 ACAO 头（浏览器 JS 读不到，但服务端照常处理）。
- P2 `Origin: null`：**200 + `access-control-allow-origin: null`**——沙箱 iframe（无 allow-same-origin）的 Origin 恒为 null，即**任意网页可借沙箱 iframe 完整读取本地文档数据**（CORS 全授予）。
- P4 恶意 Origin POST：请求照常进入业务处理（无鉴权拦截）→ **跨源写路径（建/删/改）可被简单请求触发**（副作用发生，响应不可读）。
- 结论：`cors.ts:64-67` 的「`null` 恒放行」在沙箱 iframe 威胁下形同全开；「访问控制边界在回环与未来令牌」的取舍需重新评估（记录为 P1，处置进优化计划，不擅自改架构）。

### Q8/Q9 数据面健壮性（P2 · 红测复现实锤）
- Q8 `services/ingest/src/transform/dwd/store.ts:74`：真实 parquet（hyparquet-writer 构造，含损坏 `topics` JSON 列）→ `readTable` 整批 `SyntaxError`（好行 2 行全损）。
- Q9 `services/ingest/src/collect/client.ts:530`：JSONL 含 1 坏行 → `parseRecordedResponses` 整批 `SyntaxError`。
- 证据：`~/df-evidence/audit-2026-11/quality/q8-q9-red.log`（红测文件副本同目录，仓库内已移除保持干净——优化阶段随修复一起以「红转绿」回归恢复）。

## 4. 静态与依赖（摘要，明细见 BASELINE §3/§5）

- SAST-lite：eval/注入/XSS/any/TODO/弱哈希/硬 skip 全 0；10 条 biome-ignore 走例外注释路径（复核状态待确认）。
- 密钥：跟踪文件 0 泄漏；本机 `.env.local` 真实 VERCEL_OIDC_TOKEN 建议轮换（M2）。
- 依赖：prod 8 条 moderate/low（fast-uri）；dev 1 high（electron <44.9.1）；18 项过时；License 全 MIT/BSD/OFL。

## 5. 缺口与偏差

| ID | 缺口 | 处置 |
|---|---|---|
| D1 | 分支覆盖 <90%（8 包全数） | 补测差口进优化计划（daemon/cli 优先），不阻塞审计 |
| D2 | 性能基线 provisional（verify:perf 恒阻塞） | 真链路采集需 Chromium（B1），随阶段2补 |
| D3 | 非功能 E4（fuzz 30 条/长会话/双窗口） | daemon 崩溃注入/409/路径穿越已在单测覆盖（167 例内）；浏览器侧双窗口随阶段2 |
| B1 | Chromium 缺系统库 → 阶段2 E2E 全阻 | 已获授权修复，等 sudo 执行（命令已给出） |

## 6. 证据索引

- 覆盖率：`~/df-evidence/audit-2026-11/coverage/`（summary.txt + 各包 json-summary）
- H1 探针：`~/df-evidence/audit-2026-11/baseline/h1-probe.txt` + `tmp-data/h1-daemon.log`
- Q8/Q9 红测：`~/df-evidence/audit-2026-11/quality/q8-q9-red.log`
- 门禁日志：`~/df-evidence/audit-2026-11/gate-logs/`（01~13）
- 两态证据 JSON：`~/df-evidence/audit-2026-11/gate-evidence/fe-10/`
