# PR_BATCH_8 — D-11 覆盖率常设化 + 报数入 CI + 关键分支补测（audit-d08）

- **分支**：`feat/coverage-hardening`（工作树 `/home/QIU/df-wt/audit-d08`）→ **已合并 main**（merge `3e22793`，合并后 main 复验 `pnpm verify`=0 · `test:scripts`=0 · `verify:mcp-stub`=0）
- **依据**：`docs/audit/DEFECTS.md` D-11（覆盖率基建未常设化；分支覆盖差口 daemon 70.3%/cli 67.5%/web 77.5%）· `docs/audit/TEST_REPORT.md` §2
- **依赖口径**：批5（bodyLimit，daemon routes 面）→ 批8（routes 目标集补测前提）；批7（ci.yml verify:perf 挂点）与批8（ci.yml 报数步）同文件异位，合并时逐字节保全双方

## 变更说明（5 commits）

| 缺陷 | 文件 | 变更 |
|---|---|---|
| D-11 基建 | `pnpm-workspace.yaml`（catalog 锁 `@vitest/coverage-v8: 5.0.5`）+ 9 包 `package.json` + 根 `package.json`（`test:coverage` / `coverage:report` 脚本）+ 8 个包级 `vitest.config.ts`（daemon/desktop/contracts/engine/comfy/cli 新建，web/ingest/ui 增补） | coverage 常设化：v8 provider、只统计各包 `src/**`（测试文件/类型声明/夹具不计入），reporter 带 `json-summary` 落各包 `coverage/coverage-summary.json`（已 gitignore）供 CI 与审计脚本取数（ab44be6） |
| D-11 差口 | 新增 `apps/daemon/src/routes/error-branches.test.ts`（16 例，560 行） | daemon 路由错误分支补测——routes 目标集分支覆盖 **76.25%→93.87%**（98bd381） |
| D-11 报数 | `.github/workflows/ci.yml`（单元测试步后新增「覆盖率报数」步）+ 新增 `scripts/coverage-report.mjs`（逐包行/分支摘要 + 关键分支目标集聚合）+ `scripts/tests/coverage-report.test.mjs`（5 例回归） | `test:coverage` + `coverage:report` 入 CI（f950e3f）——**报数非门禁**（见下节） |
| D-11 差口 | 新增 `tools/cli/src/arg-branches.test.ts`（303 行）+ `tools/cli/src/config/client-branches.test.ts`（539 行） | cli 命令参数分支补测（+40 例，全包 45→85）——参数面目标集分支覆盖 **69.64%→96.43%**（dc7db2e） |
| D-11 口径 | `apps/desktop/vitest.config.ts` + `services/ingest/vitest.config.ts` + `apps/web/vitest.config.ts` | coverage exclude 口径对齐（f832412，见「口径修正说明」） |

## 合并卫生

- main tip（`d8ebb84`，含批4/批7）**先并入分支**（merge `de9c337`）后重跑分支门禁再进 main：`pnpm verify`=0 · `pnpm test:scripts`=0（139 例）。
- 预期冲突 `.github/workflows/ci.yml` 由 ort 策略自动合并成功，解决方式逐处核验（非盲信自动合并）：
  - 批7 的 **verify:perf「正式判定挂点」步**（exit 0 收 / exit 1 红 / exit 2 仅真链路族阻塞可收 + provisional 字样即红）与合并结果**逐字节一致**（diff 空）；
  - 批8 的**覆盖率报数步**与 f950e3f 原文**逐字节一致**，且按原位置插在「单元测试（逐包 vitest）」步之后、「脚本单测」步之前；
  - 合并结果与 main 版 ci.yml 的全量 diff 恰为报数步 14 行插入，无其他差异。

## 测试结果（证据 `~/df-evidence/audit-d08/coverage/`：baseline / after-daemon / after-cli / after-full）

| 验收 | 结果 |
|---|---|
| `pnpm test:coverage` | **exit 0**（9 包全量插装跑，逐包 `coverage/coverage-summary.json` 落盘） |
| `pnpm coverage:report` | **exit 0**（逐包摘要 + 两条关键分支目标集聚合） |
| 核心行 ≥80%（9 包） | **全达标**：daemon 89.30 / desktop 91.80 / web 88.45 / contracts 92.89 / engine 89.71 / ui 94.62 / comfy 100 / ingest 91.37 / cli 93.41 |
| daemon routes 目标集分支 ≥90% | **93.87%**（245/261）✓ |
| cli 命令参数面目标集分支 ≥90% | **96.43%**（162/168）✓ |
| `pnpm verify`（合并后 main 复验） | **exit 0**（3494 例：contracts 85/engine 396/ui 283/desktop 125/comfy 1/web 1727/ingest 586/cli 85/daemon 206） |
| `pnpm test:scripts`（合并后 main 复验） | **exit 0**（139 例，含 coverage-report 5 例回归） |
| `verify:mcp-stub`（合并后 main 复验） | **exit 0**（16 步 0 失败） |

**main 复验轮与分支交付数字的唯一差异**：web 核心行 88.42%（分支交付实测）→ **88.45%**（main 复验轮实测）——批4/批7 的 web 保存链/超时用例与实现文件随 main tip 并入插装面所致，方向为正，仍 ≥80%；其余 8 包数字与分支交付完全一致。

## 口径修正说明（f832412，防误读为回退）

desktop 核心行 **52.99%→91.80%** 是**测量伪差的修正，不是代码变化**：`src/main/main.ts`（Electron 主进程入口，132 行）与 `src/preload/preload.cjs`（壳桥）须真二进制加载才执行，单测口径恒不可达——不剔除时 `coverage.all` 把它们按 0 行记账，拉低整包读数且与 TEST_REPORT §2 基线度量不可比。剔除理由写在 `apps/desktop/vitest.config.ts` 配置头注释与提交正文；ingest/web 同步剔除数据夹具（同口径对齐）。

## 报数非门禁（三态语义对照）

- **coverage:report 的阈值（核心行 ≥80% · 关键分支 ≥90%）只在输出里标 ⚠，不改退出码**；其非零退出仅代表结构问题（产物全缺/不可解析，即报数管线断了），不是覆盖率判定。
- 阈值是否升格为门禁（exit 1 语义）由后续票按三态语义决策——本批**未动门禁实况表**（`implementation-workflow.md` 守卫实况行与 `AGENTS.md` 门禁实况行均无变更，无门禁三态变化需同步）。
- ci.yml 内报数步注释已如实记录代价：全量用例在本步跑第二遍（覆盖率桩点插装的开销换逐包可复核数字）；既有 `pnpm test` 步骤原样保留（不放宽、不合并）。

## 环境事实（复跑前必读）

- 合并后 main 需先 `pnpm install --frozen-lockfile`（`@vitest/coverage-v8` 经 catalog 入 lockfile，+12 包）——CI 的安装步自动覆盖，本地复跑易漏。
- 本机跑 `test:coverage` 首轮偶发 `node_modules/.vitest-cache` ENOTEMPTY（并行清理竞态，非代码问题），重跑即过。

## 风险

- CI 时长上升：全量用例第二遍插装跑（约翻倍的测试段耗时）——已在 ci.yml 注释记录，属「换逐包可复核数字」的明码代价。
- `config-cli` 子进程用例在 CI runner（本机 3–4× 慢）的时长余量未在真 CI 验证过：**push 前建议主会话读一次真实 CI 结果**（`gh run list -R QIUZI-HONG/DesignForge --limit 1` 须 completed/success）。

## 回滚

`git revert -m 1 3e22793`（整个批次回退，coverage 产物目录本就不进版本库，无运行期状态需清理）。

## 遗留

- CI 报数步的 runner 时长余量待真实 CI 一轮确认（见风险）；超时再议（拆步或缓存 coverage 产物）。
- D-11 的 **web 分支差口（原表 77.5%）本批未设目标集/补测**——本批 ≥90% 口径仅覆盖 daemon routes 与 cli 命令参数面两个目标集；web 整包分支 77.66%（main 复验轮实测）随后续票。
- coverage 阈值升格门禁（⚠ → exit 1）留后续票按三态语义决策。
