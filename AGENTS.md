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
- 门禁实况（2026-11-06 · audit-d07 后）：`guard:tokens` / `guard:vocab` / `guard:feature-boundaries` / `guard:electron-baseline` / `verify:engine` / `test:scripts` / `verify:mcp-stub`（FE-10 桩契约，非浏览器全跑，must-green）**已实现且已接 CI**（`ci.yml`）；`verify:ai-two-state` / `verify:image-two-state`（FE-10 两态取证）**已接 CI**，口径=「数据面两态真跑（mock 上游/ComfyUI + 临时数据根）+ UI 段阻塞语义断言」（exit 0 收；exit 1 数据面违规即红；exit 2 仅当证据 JSON 数据面 0 失败且 UI 段阻塞——阻塞不是通过）；`verify:figma-baseline` / `verify:motion`（挂点已实现：断言待阶段 1 接入，恒阻塞）以「阻塞语义断言」入 CI（同 figma-baseline 模式：断言当前态 `exit 2` 阻塞，禁假绿）；`verify:perf`（2026-11-06 audit-d07 后：已实现+基线实采转正，**dev 机正式判定 0/1，不再恒阻塞**）CI 接入形态=「**正式判定挂点**」（exit 0 收 / exit 1 红真违规 / exit 2 仅「CI 无真链路」族阻塞可收且 provisional 字样即红——**本地是正式判定、CI 仍是挂点**，严格正式判定随浏览器门禁票收口）；浏览器门禁（`verify:figma-*` / `verify:canvas` / `verify:command-palette`（票 04：脚本就绪，待主会话浏览器复核）/ `verify:layers-reorder` / `verify:ruler-guides` / `verify:text-inline-edit`（票 11/12/13：脚本就绪，未接 CI，待主会话浏览器复核）/ `e2e:smoke` / `verify:shell-parity` 及 `verify:ai/image-two-state` 的 **UI 挂载段**（真浏览器断言，随浏览器门禁票接入））仍为**挂点**；`guard:deps` / `guard:mcp-contract` / `guard:channel-pairing` 未实现（`exit 2` 阻塞，禁止当绿）。三态语义与清单见 `docs/agents/implementation-workflow.md`。
