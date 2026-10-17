# 审计 10a · 测试工装（覆盖率 + mutation + flake/cache + a11y）

- **票**：QIUZI-HONG/DesignForge#107（父 #60 · 审计 #50）
- **分支**：`audit/10a-test-tooling`（基于 `integration/audit-v1` @ `a17034e`）
- **日期**：2026-10-17
- **证据根**：`~/df-evidence/audit-50/aud-60a/`（详细交接见该目录 `handoff.md`）
- **范围**：只改测试工装（根/包 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、各包 `vitest.config.ts`、`scripts/e2e-smoke.mjs`、`scripts/lib/**`、`scripts/tests/**`、`scripts/audit/**`）；未改 CI、`AGENTS.md`、工作流文档（#108 所有），未改产品代码。

## 交付

| 命令 | 结果 |
|---|---|
| `pnpm test:coverage` | exit 0；9 包 v8 覆盖率；**9 包均设保守阈值**（实测下留 2–5pp，见下表） |
| `pnpm test:mutation` | 在**全新 `pnpm install --frozen-lockfile`** 工作树中 exit 0；Stryker 单模块基线：139 mutants / 109 killed / 30 survived / score **78.42%**；默认不进 CI |
| `pnpm e2e:smoke` | 114 步 = 110 pass / **4 fail**（F-07-01×3 + F-05-01，如实保留）；新增 JUnit + attempts + 分场景汇总 |
| `pnpm audit:a11y` | axe 逐页（home/editor/market/settings）：**critical=2 / serious=5**，exit 1；对应 #74–#77，修复前为 known-red。首页必须先经 daemon API 建文档卡，否则漏掉 `label-content-name-mismatch`（脚本已补夹具，见下） |

### a11y 首页夹具修复（code-review）

`audit:a11y` 原先只播种市场索引、不建文档：首页停在空态，`DocumentCard` 不渲染，axe 的
`label-content-name-mismatch` 无从命中，导致脚本报 2 critical / **4** serious，与审计 04 的
2 critical / **5** serious 不同源。修复：扫描前经 daemon API `POST /documents` 建一份文档
（失败按阻塞 `exit 2`），首页等待 `.dfg-home__card` 出现后再跑 axe。复跑后合计与 04 对齐
（home 1 critical / 2 serious、editor 0/1、market 1/1、settings 0/1）。

## 覆盖率实测（statements / branches / functions / lines）

| 包 | 实测 | 阈值 |
|---|---|---|
| engine | 85.59 / 77.71 / 85.49 / 88.95 | 82 / 75 / 82 / 85 |
| daemon | 81.68 / 66.40 / 84.86 / 86.28 | 78 / 63 / 80 / 83 |
| contracts | 87.89 / 82.56 / 98.33 / 92.70 | 85 / 80 / 95 / 90 |
| web | 81.50 / 74.16 / 81.45 / 84.49 | 78 / 71 / 78 / 81 |
| ui | 90.92 / 84.82 / 99.09 / 92.94 | 87 / 81 / 96 / 89 |
| ingest | 88.94 / 80.09 / 93.38 / 91.40 | 85 / 77 / 90 / 88 |
| cli | 84.61 / 67.51 / 85.71 / 86.00 | 81 / 64 / 82 / 83 |
| desktop | 51.97 / 58.33 / 55.35 / 51.50 | 48 / 55 / 52 / 48 |
| comfy | 100 / 100 / 100 / 100 | 97 / 97 / 97 / 97（仅 1 个源文件） |

口径：采集 `src` 产品源码，排除测试 / `test-setup` / daemon `testing/**`；未开 perFile。阈值一律
**实测下留 2–5pp 余量**（不是「下取整」），只降不升；提升阈值需单独评审。

## flake / vitest 缓存

vitest 5 默认把 fs 模块缓存放在 workspace 根 `node_modules/.vitest-cache`，`pnpm -r test` 并行时偶发 `ENOTEMPTY`（审计 09 N-10）。9 个包统一设 `test.fsModuleCachePath` 到包内 `node_modules/.vitest-cache`；每轮清缓存后连跑 3 次 `pnpm -r test` 全部 exit 0、0 次 ENOTEMPTY。

## mutation 工具限制

`@stryker-mutator/vitest-runner 10.0.0` + vitest 5.0.5：dry-run 正常，但 mutant 阶段每个 mutant 执行 0 个测试（139 个全 survived/NoCoverage）。改用 Stryker **command runner**（显式跑 engine 两个 serialize 测试文件）得到 78.42%；这不是产品缺陷。**该 vitest runner 依赖随后已从根 `package.json`、catalog 与 lockfile 移除**（command runner 不需要它，留着会让「未使用依赖」与文档口径分叉）。第二批计划：补齐 survived 的条件分支断言、扩到 contracts/daemon 写路径、评估增量与 nightly 接入；vitest runner 修复前不复用。

### 移植性修复（merger 复现）

- **问题**：command runner 最初写死根 `node_modules/.bin/vitest`。根 `package.json` 未声明 vitest，该 bin 只在开发机的 hoist 布局下偶然存在；全新 `pnpm install --frozen-lockfile` 后不存在，`pnpm test:mutation` 会以 exit 1 失败。
- **修复**：命令改为包内 bin `packages/engine/node_modules/.bin/vitest run --root packages/engine …`（engine 的 devDependency 提供该 bin）；`run-mutation.mjs` 增加前置检查，缺包内 bin 时按阻塞 `exit 2` 点名，而不是 run 到 Stryker 才报错。
- **最终验证**：删除本工作树全部 `node_modules` 后 `pnpm install --frozen-lockfile`（确认根 `node_modules/.bin/vitest` **不存在**、`packages/engine/node_modules/.bin/vitest` 存在），再跑 `pnpm test:mutation` → **exit 0**，139 mutants / 109 killed / 30 survived / score 78.42%（43s）；证据 `mutation/2026-10-17T14-29-48/`、`logs/mutation-clean-install.log`。

## 已知红与不接门禁

- e2e 4 红：F-07-01（#69）×3、F-05-01（#79）×1；JUnit `failures=4`，无重试、无跳过。
- a11y：home `aria-allowed-attr`（#75）、market `aria-required-children`（#74）、color-contrast（#76）×3 页、editor `label-content-name-mismatch`（#77）。
- 覆盖率与 mutation 默认不阻断 CI；CI 步骤、known-red 清单与到期日归 #108。

## 验证

在本工作树删除全部 `node_modules` 后执行 `pnpm install --frozen-lockfile`（exit 0），随后：`pnpm test:mutation`（exit 0，见上）、`pnpm test:scripts`（83 例，exit 0）、`pnpm lint:scripts`（exit 0，1 条既有 warning）。此前已验证 `pnpm verify`（292 文件 / 2765 例）、`pnpm test:coverage` exit 0；e2e / audit:a11y 按上述 known-red exit 1。日志与 JSON 见证据根 `logs/`、`coverage/`、`fe-02/e2e/`、`mutation/`、`a11y/`。
