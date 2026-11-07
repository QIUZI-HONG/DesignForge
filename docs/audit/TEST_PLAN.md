# 测试计划（TEST_PLAN）— 阶段1/2 执行口径 · 2026-11-05

- 上游基座（**不重复定义用例，直接引用其 TC-ID**）：
  - `docs/quality/fullstack-test-design-2026-11-03.md`（唯一真源：16 模块风险矩阵、环境分层 E1-E3、12 族 160 TC-ID、G1-G4 通过标准）
  - `docs/quality/enterprise-test-protocol-2026-11.md`（终局验收规程 E1-E5）
  - `docs/spec/test-execution-phase1-v1.md`（阶段1规格——已执行完毕，本计划为其**下游复核**）
- 本计划只新增「审计增量」：覆盖率度量、浏览器门禁实跑、机器人用户旅程、非功能基线。

## 1. 范围与环境纪律

- 环境：E1 本机临时数据根 + 独立端口（禁触 4318 在跑 daemon、禁写 `~/.dforge`、禁用 /tmp 作工作区）。
- 驱动：playwright-core 1.63.0 + chromium-1243（仓内既定口径，不引入新框架——理由：与既有门禁脚本同栈，可复用全部取证脚本）。
- 生产构建：一律 `next build` + `next start`（仓纪律：dev 模式 SSR 空槽会假红）。

## 2. 测试矩阵（阶段1）

| 维度 | 内容 | 命令/工具 | 判定 | 状态 |
|---|---|---|---|---|
| 静态 | lint / typecheck / biome 全量诊断 | `pnpm lint` `pnpm typecheck` `biome check . --max-diagnostics=999` | exit 0（info 不阻断） | ✅ 已绿（BASELINE §4） |
| 静态 | SAST-lite（eval/注入/XSS/any/弱哈希/skip） | 子代理 grep 矩阵 | 0 真风险 | ✅ 已完成（BASELINE §5） |
| 依赖 | 漏洞审计 | `pnpm audit --prod` / `--all` | prod 0 high/critical；dev 1 high（electron） | ✅ 已记录（处置进优化计划） |
| 依赖 | 密钥扫描 / License | 全量 grep / node_modules license | 0 泄漏 / 0 copyleft | ✅ 已完成 |
| 单元 | 既有全量回归 | `pnpm test` + `pnpm test:scripts` | 3372+128 全绿 | ✅ 已绿 |
| 单元 | **覆盖率度量（增量）** | 临时安装 `@vitest/coverage-v8@5.0.5` → 逐包 `vitest run --coverage`（json-summary），量完回滚 lockfile | 核心包（engine/daemon/contracts/web 核心 features/ui）行覆盖 ≥80%，关键分支 ≥90% → 差口=补测清单 | ⏳ 本阶段执行 |
| 单元 | **补测（增量）** | 对覆盖差口 + Q12（contracts/cli/ingest 间接覆盖）补 TC | 新增用例只进 test 文件，不动业务逻辑 | ⏳ 覆盖率出来后定 |
| 集成 | daemon 契约 | `verify:mcp-stub`（真实 daemon + 进程内 harness + 临时数据根） | 16 项 0 失败 | ✅ 已绿 |
| 集成 | 两态数据面 | `verify-ai/image-two-state` 数据段 | 数据面 13+8 项 0 失败 | ✅ 已绿（UI 段挂点） |
| 集成 | ingest 管线 | 既有冻结样本回放 + `transform/dwd` 新增损坏输入用例（Q8/Q9 复现） | 损坏输入不得整批炸 | ⏳ 补 TC |
| 集成 | SSE 断点族 | TC-AI 3.1 流式 CORS/断线重连（phase1 已修，复核回归） | 断言红→绿保持 | ⏳ 本阶段复跑 |
| 非功能 | 渲染性能基线 | `verify:perf`（当前 provisional 恒阻塞）→ 真链路（chromium 修复后）采 P95/P99 一轮入 `~/df-evidence` | 建立基线，provisional:false 判定留优化阶段 | ⏳ 依赖 B1 |
| 非功能 | 长会话/内存/错误注入 | 企业规程 E4：畸形语料 fuzz 30 条、长会话幂等、双窗口并发、崩溃注入 | 无泄漏/幂等/崩溃可恢复 | ⏳ 本阶段执行 |
| 安全 | daemon 本地特权面（H1 复核） | 按既有 E4 取证口径复测恶意 Origin/越权端点（127.0.0.1 本地威胁模型内） | 记录实证（不擅自改架构，进缺陷表） | ⏳ 本阶段执行 |

## 3. 机器人模拟用户（阶段2）— E2E 旅程

- **前置**：B1 修复（apt 安装 5 个 Chromium 系统库）；`apps/web` 生产构建已在位（`.next/BUILD_ID` wMUqIbT5…），独立端口起服务。
- **旅程脚本**（每条映射 TC-ID，全旅程录 trace + 关键步截图，证据落 `~/df-evidence/audit-2026-11/e2e/`）：
  1. 冷启动→首页可达→新建文档→画布挂载 6 断言（`verify:canvas` 等价）
  2. 图层拖拽重排 + undo + 持久（票 11）→ 标尺参考线拖出/吸附/删除（票 12）→ 文本双击改写（票 13）
  3. 命令面板遮罩/居中/速查卡（票 04）
  4. 保存→**刷新/返回恢复**→导出/导入往返（`e2e:smoke` 10 步等价）
  5. AI 抽屉两态：确认桩路径 + 拒绝路径（UI 段，票 FE-10）
  6. 异常路径：daemon 停机时前端错误态（「本地服务不可达」文案走 i18n 与否同时记录 Q1 实证）→ daemon 恢复后重连
  7. 重复提交：保存按钮连点/双窗口同文档（409 竞争）
  8. 断网/超时：伪造 fetch 失败 + 挂起（验证 Q6 保存无超时的用户可见后果）
  9. 权限/边界：白名单外 Origin 请求（E4 口径）
  10. 收尾：关闭会话（本地优先无登出语义，以关会话+数据根残留检查替代）
- **flaky 判定**：核心旅程各跑 3 轮，失败率 <2% 计通过；不稳定用例记 DEFECTS。

## 4. 通过标准（对齐企业规程 G1-G4）

- G1 常规链全绿（已达成）；G2 门禁矩阵三态判定与声明一致（已达成，无假绿）；
- G3 P0 缺陷销号（阶段3输出）；G4 对抗抽查通过率与覆盖率达标（核心包行 ≥80%）。
- 缺口处置：凡本计划无法达成项，在 TEST_REPORT 标「阻塞+原因」，不降标准。

## 5. 执行顺序与产出

1. B1 环境修复（阻塞清单请示用户）→ 2. 覆盖率度量 → 3. 补测（差口驱动）→ 4. 非功能/安全专项 → 5. 阶段2 旅程 → 产出 `TEST_REPORT.md`（阶段1+2 合并证据）与 `E2E_REPORT.md` → 阶段3 `DEFECTS.md` → 阶段4 `OPTIMIZATION_PLAN.md` 后**停止等确认**。

## 6. 阻塞清单（需要用户做的）

| ID | 需要什么 | 为什么 |
|---|---|---|
| B1 | 授权安装 Chromium 系统依赖（`sudo apt-get install -y libnspr4 libnss3 libasound2` 等 5 库，或由用户本机执行） | 全部浏览器门禁/E2E 的单一根因；无它则阶段2 整体不可跑 |
| B4 | 认可「临时安装 @vitest/coverage-v8 + 量完回滚 lockfile」属补测试授权范围 | 覆盖率验收目标当前不可度量 |
