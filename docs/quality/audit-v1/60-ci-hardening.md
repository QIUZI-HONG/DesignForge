# 审计 10b · CI 硬化、供应链与人工项（#108 / #60）

- **状态**：已完成（workflow 与文档改动已提交；**仓库设置未改动**，人工项在本文件登记）
- **日期**：2026-10-17
- **票**：[#108](https://github.com/QIUZI-HONG/DesignForge/issues/108)（父票 [#60](https://github.com/QIUZI-HONG/DesignForge/issues/60)，规格 [#50](https://github.com/QIUZI-HONG/DesignForge/issues/50)）
- **工作树 / 分支**：`/home/QIU/df-wt/aud-10b` / `audit/10b-ci-docs`
- **基线**：`integration/audit-v1` @ `a17034e`（审计 09 收口）
- **本票提交**：`ef48282`（workflow）、`b535bd1`（门禁文档）、`d59a7d9`（本文件与人工项）、证据哈希更新提交（收尾）
- **依赖**：#107（审计 10a）提供 `test:coverage` / `test:mutation` / `audit:a11y`；合并顺序 **#60a → #60b**。收尾时 #107 已在 `audit/10a-test-tooling` 产生提交 `76b3b19`（`test:coverage` = `pnpm -r test --coverage`，各包默认 `coverage/`），但**尚未合并进 `integration/audit-v1`**；本分支 HEAD 仍无该脚本（CI 步骤会显式阻塞，见 §5）。
- **证据根**：`~/df-evidence/audit-50/aud-60b/`（日志与哈希见 §5）
- **事实基线（只读复核，`repo-settings-readonly.log`）**：`main` 无 branch protection（404）；Dependabot alerts 关闭（404）；automated security fixes `enabled=false`；CodeQL default setup `state=not-configured`。

## 1. 已实现（本票）

| 文件 | 改动 | 状态 |
|---|---|---|
| `.github/workflows/ci.yml` | `verify` job 新增 `test:coverage`（#107 提供；脚本缺失时显式 `exit 2` 阻塞，不跳过）、`pnpm --filter @dforge/web build`（生产构建，prebuild 就位 CanvasKit 资产）、覆盖率产物上传（artifact `coverage`，14 天）；job 超时 30 → 45 分钟；`guard:mcp-contract` 步骤已核对在位；known-red 注释更新（e2e 6 场景 114 步 / 4 红；resilience 47 步 / 9 红） | 已实现 |
| `.github/dependabot.yml` | npm（根 pnpm workspace）+ GitHub Actions，weekly；minor/patch 分组、major 独立 PR；limits=5 | 已实现（仓库设置项见 §4.2） |
| `.github/workflows/codeql.yml` | JS/TS（`javascript-typescript`）；push/PR 到 `main` + 每周一 03:17 UTC；advanced setup | 已实现（启用方式见 §4.3） |
| `.github/workflows/dependency-review.yml` | PR 依赖图评审；`fail-on-severity: high`；只读权限、不评论 PR | 已实现；**本仓依赖图未启用，workflow 暂改 `workflow_dispatch`**（见 §4.7） |
| `.github/workflows/dependency-audit.yml` | 每周一 02:23 UTC + `workflow_dispatch`；`pnpm audit --prod --audit-level=high`；仅网络错误重试 3 次；漏洞 `exit 1`、连续网络失败 `exit 2`（阻塞） | 已实现（凭据见 §4.6） |
| `AGENTS.md` / `docs/agents/implementation-workflow.md` | 门禁实况两处同源：coverage/build 已接 CI；mutation/a11y 仅本地；e2e 4 红 / resilience 9 红为 known-red；`guard:mcp-contract` 已接 CI；`guard:deps` / `guard:channel-pairing` 仍为桩；新增「CI 与供应链」小节 | 已实现 |

**明确未做**：`e2e:smoke` 与 `verify:resilience` **没有**接成必过步骤；没有用跳过/重试/放宽断言掩盖已知红；没有改仓库设置；没有改 `package.json` / `pnpm-workspace.yaml` / vitest 配置 / `scripts/e2e-smoke.mjs`（#107 所有）；没有改产品代码。

## 2. CI 步骤与门禁口径

`ci.yml` 的 `verify` job（branch protection 的目标检查，context = `verify`）顺序：

1. `pnpm install --frozen-lockfile`
2. `pnpm lint`（含 `lint:scripts`）
3. `pnpm typecheck`
4. `pnpm test`（9 包 / 2765 例）
5. **`pnpm test:coverage`**（新；#107 提供。根脚本不存在时本步骤打印「阻塞」并 `exit 2`）
6. **覆盖率产物上传**（新；`coverage/` 与各包 `coverage/`，`if-no-files-found: warn`）
7. **`pnpm --filter @dforge/web build`**（新；生产构建，13 路由）
8. `pnpm test:scripts`
9. `guard:tokens` / `guard:vocab` / `guard:feature-boundaries` / `guard:electron-baseline` / **`guard:mcp-contract`（核对：已在位）** / `verify:engine`
10. 参照集阻塞语义断言（无参照集 → 必须 `exit 2`）

覆盖率阈值与 `coverage.reportsDirectory` 由 #107 的 vitest 配置决定；本票不设阈值、不复制数字。#107 未设置 `reportsDirectory`（Vitest 默认各包 `coverage/`，reporter 为 `text-summary` + `json-summary`），本票上传路径已覆盖根目录与 `apps/*`、`packages/*`、`services/*`、`tools/*` 的 `coverage/`；首次 CI run 的 artifact 应包含各包 `coverage-summary.json`。若后续 #107 调整目录，需同步本文件与 `ci.yml`。

## 3. Known-red 登记（不写成通过）

| 门禁 | 当前结果 | 红项 | 处置 |
|---|---|---|---|
| `pnpm e2e:smoke` | 6 场景 **114 步 = 110 pass / 4 fail**（审计 08） | F-07-01×3（[#69](https://github.com/QIUZI-HONG/DesignForge/issues/69) 导出 PNG/SVG/PDF 空白）；F-05-01×1（[#79](https://github.com/QIUZI-HONG/DesignForge/issues/79) 过滤×分页死路） | **仅本地，未接 CI**；修复 #69/#79 且 `e2e:smoke` exit 0 后才评估接必过（§4.5）。不得静默 skip、不得只留完成文案断言 |
| `pnpm verify:resilience` | 47 步 = 31 pass / **9 fail**，exit 1 | 跨进程丢页、根内软链跨文档写、半提交、深嵌套页读取 500、CORS null 等（#67 等 A/B 缺陷） | **仅本地，未接 CI**；修复转绿前不得当通过；缺 C 编译器时故障注入段按 `exit 2` 阻塞点名 |
| `pnpm audit:a11y` | 审计期 2 critical / 5 serious（#74–#77） | axe 自动检查 | 仅本地；critical 修复后先断言 critical=0，再评估进 CI；serious 清零前不设 serious=0 门禁 |
| `pnpm test:mutation` | 选择性工装（#107） | — | 仅本地，默认不进 CI；首批结果由 #107 记录 |

## 4. 人工项（需管理员 / 负责人；本票**未执行**）

以下命令按仓库当前状态（见文首只读复核）编写；执行前先读现状，避免覆盖已有的保护/评审设置。

### 4.1 `main` branch protection（P0）

目标：必须过 `verify`、线性历史、禁 force push、禁删除分支。`strict: true` 要求分支与 base 同步后才可合并。

```bash
# 0) 先读现状（无保护会返回 404）
gh api repos/QIUZI-HONG/DesignForge/branches/main/protection

# 1) 启用保护（PUT 会整体替换现有保护设置；若已有 review 规则，先读出来一并保留）
gh api -X PUT repos/QIUZI-HONG/DesignForge/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["verify"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

# 2) 复核
gh api repos/QIUZI-HONG/DesignForge/branches/main/protection \
  --jq '{checks: .required_status_checks.contexts, strict: .required_status_checks.strict, admins: .enforce_admins.enabled, linear: .required_linear_history.enabled, force: .allow_force_pushes.enabled, delete: .allow_deletions.enabled}'
```

注意：

- 必需检查 context 是 **job 名 `verify`**（不是 workflow 名 `ci`）。若以后拆分/改名 job，必须同步更新 `contexts`。
- `enforce_admins: true` 表示管理员也不能绕过；若需要紧急通道，改为 `false` 并在本文件登记。
- `required_pull_request_reviews: null` = 不强制评审。若要强制至少 1 人评审，把该字段改为
  `{"required_approving_review_count": 1, "dismiss_stale_reviews": true}`。
- 保护只作用于 `main`；`integration/*` 分支不在保护范围。

### 4.2 Dependabot alerts 与 security updates

版本更新 PR 由 `.github/dependabot.yml` 负责（合并到默认分支后生效）；**安全更新是独立仓库设置**，当前均关闭：

```bash
# 开启 Dependabot alerts（漏洞告警）
gh api -X PUT repos/QIUZI-HONG/DesignForge/vulnerability-alerts

# 开启 Dependabot security updates（自动安全修复 PR）
gh api -X PUT repos/QIUZI-HONG/DesignForge/automated-security-fixes

# 复核
gh api repos/QIUZI-HONG/DesignForge/automated-security-fixes --jq '{enabled, paused}'
gh api -i repos/QIUZI-HONG/DesignForge/vulnerability-alerts | head -1   # 204 = 已开启
```

首次启用后检查：

```bash
gh pr list -R QIUZI-HONG/DesignForge --label dependencies --state all --limit 10
```

已知风险：本仓依赖版本集中在 `pnpm-workspace.yaml` 的 `catalog:`。若 Dependabot 无法解析 `catalog:`，
表现为「长期没有更新 PR」——**不得当成「无更新」**；届时改用人工 `pnpm outdated` 巡检，或评估 Renovate（需另立票）。

### 4.3 CodeQL：advanced setup 与 default setup 二选一

本票已提交 **advanced setup**（`.github/workflows/codeql.yml`，代码可评审）。当前仓库 default setup 为
`not-configured`。**两者不能同时启用**（同时开启会导致 advanced workflow 的 SARIF 上传失败）。

推荐：保留 advanced workflow，确认 default setup 保持关闭：

```bash
# 查看 default setup 状态（当前 state=not-configured）
gh api repos/QIUZI-HONG/DesignForge/code-scanning/default-setup

# 如曾被开启，关闭 default setup（保留 advanced workflow）
gh api -X PATCH repos/QIUZI-HONG/DesignForge/code-scanning/default-setup \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{"state": "not-configured"}
JSON
```

替代方案（若负责人更偏好 GitHub 托管配置）：启用 default setup，并在后续 PR 删除 `codeql.yml`：

```bash
gh api -X PATCH repos/QIUZI-HONG/DesignForge/code-scanning/default-setup \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{"state": "configured", "query_suite": "default", "languages": ["javascript-typescript"]}
JSON
```

合并后复核分析结果：

```bash
gh api 'repos/QIUZI-HONG/DesignForge/code-scanning/analyses?per_page=5' \
  --jq '.[] | {id, category, created_at}'
```

公开仓库 CodeQL 免费；仓库转私有后需 GitHub Advanced Security（否则分析无法上传）。

### 4.4 macOS / Windows runner（P2，需负责人决策）

现状：CI 仅 `ubuntu-latest` + Node 22；审计只做 Linux 主判。建议顺序：

1. **Windows 冒烟**（先试跑、后接门禁）：在分支上临时加 `windows-latest` job 跑
   `pnpm install --frozen-lockfile && pnpm verify`，记录失败清单；不得直接把未验证的 job 合入。
   注意：`verify:resilience` 使用 POSIX 信号 / `LD_PRELOAD`，不在 Windows 试跑范围（它本来也不在 CI）。
2. **macOS**：发布前人工验证（签名/公证环境不在本仓），不设常驻 runner。

试跑 job 形态（**不要直接合入**，先单独分支验证）：

```yaml
windows-smoke:
  runs-on: windows-latest
  timeout-minutes: 45
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22, cache: pnpm }
    - run: pnpm install --frozen-lockfile
    - run: pnpm verify
```

### 4.5 e2e 必过的前置（修复 #69 / #79 之后）

**当前不得启用**：`pnpm e2e:smoke` 仍有 4 条 known-red（§3）。满足以下条件后再加 `e2e` job 并纳入
branch protection（first fix, then gate）：

1. [#69](https://github.com/QIUZI-HONG/DesignForge/issues/69)（F-07-01 导出空白）与
   [#79](https://github.com/QIUZI-HONG/DesignForge/issues/79)（F-05-01 过滤×分页）修复；
2. 本地生产构建 + 真 Chromium 下 `pnpm e2e:smoke` **exit 0**（114/114 步）；
3. 连续 3 次运行无 flake（#107 的 JUnit/尝试记录为证据）。

建议 job（待启用；runner 预装 Google Chrome，路径以实际为准）：

```yaml
e2e:
  runs-on: ubuntu-latest
  timeout-minutes: 30
  needs: verify
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22, cache: pnpm }
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter @dforge/web build
      env: { NEXT_TELEMETRY_DISABLED: "1" }
    - name: e2e smoke（修复 #69/#79 前不得启用）
      run: pnpm e2e:smoke
      env:
        BENCH_CHROME_EXECUTABLE: /usr/bin/google-chrome
        DF_EVIDENCE_DIR: ${{ github.workspace }}/e2e-evidence
    - uses: actions/upload-artifact@v4
      if: always()
      with: { name: e2e-evidence, path: e2e-evidence/ }
```

启用后把 `e2e`（context 同名）加入 §4.1 的 `required_status_checks.contexts`。

### 4.6 `pnpm audit` 定时任务与凭据

已实现：`.github/workflows/dependency-audit.yml`（weekly + 手动），**不进 PR 必过门禁**。策略：

- 仅对网络类错误重试 3 次（15s/30s 退避）；发现 high/critical 漏洞 → `exit 1`；
- 连续 3 次网络失败 → `exit 2`（阻塞）：**不是通过**；等 registry 恢复后手动重跑，不得改写成 `continue-on-error`；
- 公开 npm registry 无需凭据。若接入私有 registry，需配置 secret 并在 workflow 注入 `NODE_AUTH_TOKEN`
  （本仓当前无此需求）：

```bash
# 仅在需要私有 registry 时执行
gh secret set NPM_TOKEN -R QIUZI-HONG/DesignForge
```

合并后手动触发与复核：

```bash
gh workflow run dependency-audit.yml -R QIUZI-HONG/DesignForge
gh run list -R QIUZI-HONG/DesignForge --workflow dependency-audit.yml --limit 3
```

### 4.7 Dependency review / 依赖图

`dependency-review.yml` 在 PR 上运行，需要仓库开启 **dependency graph**。公开仓库默认开启；
若 Settings → Code security 中显示关闭，需在网页设置开启（REST 无公开开关）。仓库转私有后该 action
需要 GitHub Advanced Security。

**首轮 CI 实测（2026-10-17，run 39041450955）**：`verify` 与 CodeQL 通过，`dependency-review` 6 秒失败，
日志明确 `Dependency review is not supported on this repository. Please ensure that Dependency graph is enabled`；
只读探测 `GET /repos/.../dependency-graph/sbom` 也返回 404。按「不假绿」纪律，workflow 已改为仅
`workflow_dispatch`（保留完整 action 配置），在管理员启用 dependency graph 后恢复
`pull_request: [main]` 并纳入必过检查。在此之前 PR 不跑该检查；**不得把「没跑」当作通过**。

## 5. 验证与证据

本地执行（证据根 `~/df-evidence/audit-50/aud-60b/`）：

| 命令 | 结果 | 证据 |
|---|---|---|
| `python3 yaml.safe_load` 遍历 `.github/**/*.yml` | 5 个文件全部可解析 | `yaml-parse.log`（sha256 `c92f6df9…`） |
| `pnpm --filter @dforge/web build` | exit 0；13 路由（`next build`） | `web-build.log`（sha256 `cf490fda…`） |
| `pnpm verify` | exit 0；9 包 / **2765 例** | `pnpm-verify.log`（sha256 `f3b3db0a…`） |
| `pnpm test:scripts` | exit 0；**79/79 pass** | `test-scripts.log`（sha256 `bf1dde75…`） |
| `pnpm lint:scripts` | exit 0；1 条**既有** warning（`scripts/e2e-smoke.mjs` optional chain，非本票引入） | `lint-scripts.log`（sha256 `b189ed22…`） |
| CI 覆盖率步骤的「脚本缺失」分支（本地执行同一段 shell） | `exit 2` + 打印「阻塞：…依赖 #107」，证明不会静默跳过 | `coverage-step-blocking-check.log`（sha256 `f5dd8dec…`） |
| 仓库设置只读复核 | main 无保护；alerts/security updates 关闭；CodeQL default setup `not-configured` | `repo-settings-readonly.log`（sha256 `77945a7a…`） |

未执行（如实登记）：

- `pnpm test:coverage`：本分支 HEAD 尚无根脚本（#107 未合并进集成分支）。#107 的
  `audit/10a-test-tooling` @ `76b3b19` 已提供 `test:coverage`（`pnpm -r test --coverage`，
  各包 `coverage/`），合并顺序 #60a → #60b 后本步骤即可运行。CI 步骤已做成「脚本缺失 →
  `exit 2` 阻塞」，不会出现「没跑却绿」。
- CodeQL / dependency-review / dependency-audit：需在 GitHub Actions 上运行，本地不可复现；合并到
  `main` 后读首轮结果（`gh run list`）。
- e2e / resilience / a11y / mutation：known-red 或仅本地，本票不跑、不接门禁（§3）。

完整哈希清单：`~/df-evidence/audit-50/aud-60b/sha256sums.txt`。

### 首轮 CI 实测（PR #61，2026-10-17）

| 检查 | 结果 | 说明 |
|---|---|---|
| `verify` | **pass**（3m52s） | 含 `test:coverage`、web 生产构建、MCP 契约守卫；覆盖率阈值通过 |
| CodeQL | **pass**（2m11s） | advanced workflow 正常上传分析 |
| dependency-review | **fail（6s）→ 已改手动** | 仓库 Dependency graph 未启用；见 §4.7，按阻塞登记，不伪造通过 |

结论：「覆盖率与生产构建进 CI」已实测成立；CodeQL 已实测成立；dependency-review 阻塞于仓库设置，
workflow 暂仅手动触发。PR 首轮红不是代码失败，也不是假绿。

## 6. 未完成 / 风险

1. **#107 依赖**：合并顺序必须 #60a → #60b；若 #107 未合并就合并本票，`ci.yml` 的覆盖率步骤会以
   `exit 2` 阻塞（这是有意的诚实失败，不是 flake）。#107 合并后需复核根脚本名确为 `test:coverage`。
2. **CI 时长**：新增覆盖率与生产构建；本机 `next build` 在 10 秒量级，runner 可能 3–4×。job 超时已提到 45 分钟；
   若仍逼近上限，应拆 job（build/coverage 独立）并保留 `verify` 作为必需检查，而不是放宽断言。
3. **覆盖率阈值**：由 #107 设定；首次进 CI 若阈值导致红，按「先修测试/补覆盖面」处理，不得为转绿无证据降阈值。
4. **CodeQL 双配置冲突**：advanced workflow 与 default setup 互斥（§4.3）。合并后若 default setup 被开启，
   CodeQL job 会红；按 §4.3 二选一。
5. **Dependabot 与 `catalog:`**：支持程度需首轮观察；「没有 PR」不等于「无更新」（§4.2）。
6. **audit job 网络 flake**：定时任务可能因 registry 不可达 `exit 2`；重跑即可，但不得改成
   `continue-on-error` 或吞掉漏洞结果。
7. **新 workflow 生效时点**：push/PR 触发、Dependabot 配置、CodeQL 分析都要在合并进默认分支后才完整生效；
   合并后读首轮 CI 与安全页，不把「配置已写」当成「已运行」。
8. **仓库设置未改**：branch protection / Dependabot / CodeQL 仍需管理员执行 §4；在此之前 CI 绿仍只是约定，
   不是合并强制条件。

## 7. 人工项清单（速查）

| # | 项 | 谁 | 命令/动作 | 状态 |
|---:|---|---|---|---|
| 1 | `main` branch protection（require `verify`、linear history、禁 force push、禁删除、enforce admins） | 管理员 | §4.1 `gh api -X PUT .../protection` | 待执行（当前 404） |
| 2 | Dependabot alerts + security updates | 管理员 | §4.2 两个 `PUT` | 待执行（当前均关闭） |
| 3 | CodeQL 配置二选一 | 管理员 | §4.3（推荐保留 advanced workflow） | 待确认（default setup 当前关闭） |
| 4 | Windows 冒烟试跑 / macOS 发布前人工 | 负责人 | §4.4 | 待决策 |
| 5 | e2e 必过（先修 #69/#79） | 修复票 + 管理员 | §4.5 | 阻塞于缺陷修复 |
| 6 | `pnpm audit` 定时结果巡检（私有 registry 才需凭据） | 维护者 | §4.6 | 已定时，待首轮结果 |
| 7 | 依赖图 / dependency review 可用性 | 管理员 | §4.7 | **阻塞：当前 dependency graph 未启用（首轮 CI 实测 not supported）；workflow 暂手动触发** |
