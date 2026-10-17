## Agent skills

### Issue tracker

Issues 存放在 `QIUZI-HONG/DesignForge` 的 GitHub Issues；gh 命令统一带 `-R QIUZI-HONG/DesignForge`。See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical defaults, unchanged: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` at the repo root plus `docs/adr/`. See `docs/agents/domain.md`.

### Implementation workflow

工作树、门禁退出码、合并卫生与代码规范：**开工前必读** `docs/agents/implementation-workflow.md`。

## 工程命令

- 安装：`pnpm install`（Node ≥ 22，pnpm 10.33.2 由根 `packageManager` 锁定；版本目录见 `pnpm-workspace.yaml` 的 `catalog:`）。
- 门禁：`pnpm verify` = `pnpm lint` + `pnpm typecheck` + `pnpm test`；CI（`.github/workflows/ci.yml`）在此基础上还跑 `test:coverage`（#107 / 审计 10a 提供）与 `pnpm --filter @dforge/web build`（生产构建），再跑脚本单测与非浏览器守卫。
- 单包：`pnpm --filter @dforge/<pkg> <script>`（如 `pnpm --filter @dforge/web build`）。
- 工作树：一票一树 `/home/QIU/df-wt/<票号>`；**禁用 /tmp**（tmpfs 3.9G 会撑爆）。
- 门禁实况：`guard:tokens` / `guard:vocab` / `guard:feature-boundaries` / `guard:electron-baseline` / `guard:mcp-contract`（MCP 工具集与跨端路由/信封契约快照，快照 `scripts/snapshots/mcp-contract.v1.json`；审计 05 实现）/ `verify:engine` / `test:scripts` **已实现且已接 CI**（`ci.yml`）；`pnpm --filter @dforge/web build`（生产构建）与 `test:coverage`（#107 / 审计 10a 提供）**已接 CI**，覆盖率产物随 run 上传；`test:mutation` / `audit:a11y`（#107 提供，随 #60a → #60b 合并生效）已实现、**仅本地**（mutation 选择性、默认不进 CI；axe 审计期仍有 2 critical / 5 serious，修复前不接必过）；`e2e:smoke` 6 场景 114 步，4 条 known-red（F-07-01×3 #69 + F-05-01×1 #79），**仅本地、未接 CI**；`verify:resilience` 47 步 / 9 条 known-red（#67 等 A/B 缺陷），**仅本地、未接 CI**；`verify:figma-baseline` 以「阻塞语义断言」入 CI（无参照集时断言 exit 2）；浏览器门禁（`verify:figma-*` / `verify:canvas` / `verify:shell-parity`）仍为**挂点**；`guard:deps` / `guard:channel-pairing` 未实现（`exit 2` 阻塞，禁止当绿）。供应链：`.github/dependabot.yml`（npm + Actions，weekly）、`codeql.yml`（JS/TS）、`dependency-review.yml`（依赖图未启用，暂手动；启用后 PR）、`dependency-audit.yml`（weekly `pnpm audit --prod`，网络失败重试后按阻塞退出）已配置；branch protection、Dependabot security updates、CodeQL 仓库设置属**人工项**，命令见 `docs/quality/audit-v1/60-ci-hardening.md`。三态语义与清单见 `docs/agents/implementation-workflow.md`。
