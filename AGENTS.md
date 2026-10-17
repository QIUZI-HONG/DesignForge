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
- 门禁：`pnpm verify` = `pnpm lint` + `pnpm typecheck` + `pnpm test`，与 CI（`.github/workflows/ci.yml`）同一条链。
- 单包：`pnpm --filter @dforge/<pkg> <script>`（如 `pnpm --filter @dforge/web build`）。
- 工作树：一票一树 `/home/QIU/df-wt/<票号>`；**禁用 /tmp**（tmpfs 3.9G 会撑爆）。
- 门禁实况：`guard:tokens` / `guard:vocab` / `guard:feature-boundaries` / `guard:electron-baseline` / `guard:mcp-contract`（MCP 工具集与跨端路由/信封契约快照，快照 `scripts/snapshots/mcp-contract.v1.json`；审计 05 实现）/ `verify:engine` / `test:scripts` **已实现且已接 CI**（`ci.yml`）；`verify:figma-baseline` 以「阻塞语义断言」入 CI（无参照集时断言 exit 2）；浏览器门禁（`verify:figma-*` / `verify:canvas` / `e2e:smoke` / `verify:shell-parity`）仍为**挂点**；`verify:resilience`（#53 韧性故障注入，临时数据根 + LD_PRELOAD）已实现、仅本地（未接 CI；审计期因已知 A/B 缺陷 `exit 1`，不得当绿）；`guard:deps` / `guard:channel-pairing` 未实现（`exit 2` 阻塞，禁止当绿）。三态语义与清单见 `docs/agents/implementation-workflow.md`。
