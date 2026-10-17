# 审计 10a · 测试工装（覆盖率 + mutation + flake/cache + a11y）

- **票**：QIUZI-HONG/DesignForge#107（父 #60 · 审计 #50）
- **分支**：`audit/10a-test-tooling`（基于 `integration/audit-v1` @ `a17034e`）
- **日期**：2026-10-17
- **证据根**：`~/df-evidence/audit-50/aud-60a/`（详细交接见该目录 `handoff.md`）
- **范围**：只改测试工装（根/包 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、各包 `vitest.config.ts`、`scripts/e2e-smoke.mjs`、`scripts/lib/**`、`scripts/tests/**`、`scripts/audit/**`）；未改 CI、`AGENTS.md`、工作流文档（#108 所有），未改产品代码。

## 交付

| 命令 | 结果 |
|---|---|
| `pnpm test:coverage` | exit 0；9 包 v8 覆盖率；engine/daemon/contracts 设保守阈值（不高于实测） |
| `pnpm test:mutation` | Stryker 单模块基线：139 mutants / 109 killed / 30 survived / score **78.42%**；默认不进 CI |
| `pnpm e2e:smoke` | 114 步 = 110 pass / **4 fail**（F-07-01×3 + F-05-01，如实保留）；新增 JUnit + attempts + 分场景汇总 |
| `pnpm audit:a11y` | axe 逐页（home/editor/market/settings）：**critical=2 / serious=4**，exit 1；对应 #74–#77，修复前为 known-red |

## 覆盖率实测（statements / branches / functions / lines）

| 包 | 实测 | 阈值 |
|---|---|---|
| engine | 85.59 / 77.71 / 85.49 / 88.95 | 82 / 75 / 82 / 85 |
| daemon | 81.68 / 66.40 / 84.86 / 86.28 | 78 / 63 / 80 / 83 |
| contracts | 87.89 / 82.56 / 98.33 / 92.70 | 85 / 80 / 95 / 90 |
| web | 81.50 / 74.16 / 81.45 / 84.49 | 未设 |
| ui | 90.92 / 84.82 / 99.09 / 92.94 | 未设 |
| ingest | 88.94 / 80.09 / 93.38 / 91.40 | 未设 |
| cli | 84.61 / 67.51 / 85.71 / 86.00 | 未设 |
| desktop | 51.97 / 58.33 / 55.35 / 51.50 | 未设 |
| comfy | 100 / 100 / 100 / 100 | 未设（仅 1 个源文件） |

口径：采集 `src` 产品源码，排除测试 / `test-setup` / daemon `testing/**`；未开 perFile。

## flake / vitest 缓存

vitest 5 默认把 fs 模块缓存放在 workspace 根 `node_modules/.vitest-cache`，`pnpm -r test` 并行时偶发 `ENOTEMPTY`（审计 09 N-10）。9 个包统一设 `test.fsModuleCachePath` 到包内 `node_modules/.vitest-cache`；每轮清缓存后连跑 3 次 `pnpm -r test` 全部 exit 0、0 次 ENOTEMPTY。

## mutation 工具限制

`@stryker-mutator/vitest-runner 10.0.0` + vitest 5.0.5：dry-run 正常，但 mutant 阶段每个 mutant 执行 0 个测试（139 个全 survived/NoCoverage）。改用 Stryker **command runner**（显式跑 engine 两个 serialize 测试文件）得到 78.42%；这不是产品缺陷。第二批计划：补齐 survived 的条件分支断言、扩到 contracts/daemon 写路径、评估增量与 nightly 接入；vitest runner 修复前不复用。

## 已知红与不接门禁

- e2e 4 红：F-07-01（#69）×3、F-05-01（#79）×1；JUnit `failures=4`，无重试、无跳过。
- a11y：home `aria-allowed-attr`（#75）、market `aria-required-children`（#74）、color-contrast（#76）×3 页、editor `label-content-name-mismatch`（#77）。
- 覆盖率与 mutation 默认不阻断 CI；CI 步骤、known-red 清单与到期日归 #108。

## 验证

`pnpm install --frozen-lockfile`、`pnpm verify`（292 文件 / 2765 例）、`pnpm test:scripts`（83 例）、`pnpm lint:scripts`、`pnpm test:coverage` 全部 exit 0；e2e / audit:a11y 按上述 known-red exit 1；mutation exit 0。日志与 JSON 见证据根 `logs/`、`coverage/`、`fe-02/e2e/`、`mutation/`、`a11y/`。
