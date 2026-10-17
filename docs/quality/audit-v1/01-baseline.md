# 审计 01 · 基线复跑与 CI 事实清单

- **状态**：已完成（本票证据见 §7；机器可读结果 `~/df-evidence/audit-50/aud-01/baseline.json`）
- **日期**：2026-10-17（UTC 12:43–12:50；本地 UTC+8）
- **代码基线**：`main` @ `c6b1654495685649652a3ab0a1a272f783805a26`（= `integration/audit-v1` 起点）
- **本票分支/工作树**：`audit/01-baseline` / `/home/QIU/df-wt/aud-01`
- **范围**：全部门禁 + 生产构建的真实退出码；CI 覆盖矩阵与 CI 事实；不引用旧报告数字，不改产品代码。

## 1. 环境

| 项 | 值 | 证据 |
|---|---|---|
| OS / 内核 | Linux（WSL2）6.18.33.2-microsoft-standard-WSL2 x86_64 | `uname -a` |
| Node | v24.9.0 | `node --version` |
| pnpm | 10.33.2（根 `packageManager` 锁定） | `pnpm --version` |
| Chromium | playwright-core 1.63.0 缓存 `chromium-1243`（+ `chromium_headless_shell-1243`） | `~/.cache/ms-playwright` |
| 显示 | `DISPLAY=:0`、`WAYLAND_DISPLAY=wayland-0`（WSLg 可用） | shell 环境 |
| 依赖安装 | `pnpm install --frozen-lockfile`，exit 0，`Done in 722ms`（工作树原无 `node_modules`） | `logs/install.log` |
| 磁盘 | `/home/QIU` 1007G，已用 59G | `df -h` |
| Electron | **未安装**：`apps/desktop/node_modules/electron/dist/electron` 不存在（`pnpm install` 不拉二进制，仓内工具按需下载） | `logs/verify-shell-parity.log` |

### 执行纪律

- 临时目录统一 `TMPDIR=~/df-evidence/audit-50/aud-01/tmp`（`/home` 盘），**未使用 `/tmp`**。
- 门禁证据统一 `DF_EVIDENCE_DIR=~/df-evidence/audit-50/aud-01/gate-evidence`（不支持该变量的脚本按自身缺省落 `~/df-evidence/<ticket>/`，见证据列）。
- **未触碰常驻 3000（主工作树 next dev）与 4318（常驻 daemon），未读写 `~/.dforge`**。所有会起服务的门禁均自起临时实例（空闲端口 + 临时数据根）；`verify-market` 缺省会探测 4318，本轮改为显式 `DF_DAEMON_URL=http://127.0.0.1:<临时端口>`。
- 未使用 `pkill -f`；临时 daemon 只按精确 PID 回收。
- 统一执行器：`~/df-evidence/audit-50/aud-01/run-gate.sh`、`run-with-daemon.sh`；逐条 `timeout` 限时，stdout/stderr 落 `logs/<gate>.log`。

## 2. 门禁结果（真实退出码）

汇总：**29 次执行 = 0 退出码 22 次 + 退出码 1 共 0 次 + 退出码 2 共 7 次 + 超时 0 次**。
退出码语义按仓库纪律：`0` 通过 / `1` 真违规 / `2` 阻塞（**不是通过**）。

| # | 门禁 | 命令 | 退出码 | 耗时 | 证据（`~/df-evidence/audit-50/aud-01/`） | 备注 |
|---:|---|---|---:|---:|---|---|
| 1 | verify | `pnpm verify` | 0 | 28s | `logs/verify.log` | lint + typecheck + test：9 包、292 文件、2765 例全绿 |
| 2 | test-scripts | `pnpm test:scripts` | 0 | 5s | `logs/test-scripts.log` | 56 例全过（含守卫检出强度回归） |
| 3 | guard-tokens | `pnpm guard:tokens` | 0 | 1s | `logs/guard-tokens.log` | 0 违规（R1/R2/R3） |
| 4 | guard-vocab | `pnpm guard:vocab` | 0 | <1s | `logs/guard-vocab.log` | 65 文件；词表同源 |
| 5 | guard-feature-boundaries | `pnpm guard:feature-boundaries` | 0 | 1s | `logs/guard-feature-boundaries.log` | 412 文件；5 条登记例外 |
| 6 | guard-electron-baseline | `pnpm guard:electron-baseline` | 0 | <1s | `logs/guard-electron-baseline.log` | 安全五项静态判定通过 |
| 7 | guard-deps | `pnpm guard:deps` | **2** | 1s | `logs/guard-deps.log` | **未实现桩**（exit 2，禁止当绿） |
| 8 | guard-mcp-contract | `pnpm guard:mcp-contract` | **2** | <1s | `logs/guard-mcp-contract.log` | **未实现桩** |
| 9 | guard-channel-pairing | `pnpm guard:channel-pairing` | **2** | <1s | `logs/guard-channel-pairing.log` | **未实现桩** |
| 10 | verify-engine | `pnpm verify:engine` | 0 | 1s | `logs/verify-engine.log` | 23 文件 / 312 例；快照哈希一致（`d5bf98762842…`） |
| 11 | verify-figma-baseline | `pnpm verify:figma-baseline` | **2** | 1s | `logs/verify-figma-baseline.log`；`gate-evidence/ref-01/…12-44-14.json` | **阻塞：参照集未冻结**（`~/df-evidence/reference-v1` 不存在）；自测 6 态辨别力全过 |
| 12 | verify-daemon | `pnpm verify:daemon` | 0 | 1s | `logs/verify-daemon.log`；`~/df-evidence/inf-01/verify-daemon.evidence.json` | 37 项冒烟 0 失败；临时数据根 |
| 13 | verify-market（未播种） | `pnpm verify:market`（临时 daemon，空数据根） | **2** | <1s | `logs/verify-market.log`；`gate-evidence/fe-11/…12-44-23.json` | 静态两项通过；**市场索引缺失 → 阻塞**（新临时根无 `market/ads/*`） |
| 14 | verify-market（播种 MK-05 索引） | 同上，数据根注入 `~/df-evidence/mk-05/batch/data/ads/*.json` | 0 | 1s | `logs/verify-market-seeded.log`；`gate-evidence/fe-11/…12-49-25.json` | 4 项全过（令牌 / 六态 / 真数据面 / E1–E3），仍不接 CI |
| 15 | verify-mcp-stub | `pnpm verify:mcp-stub` | 0 | 1s | `logs/verify-mcp-stub.log`；`gate-evidence/fe-10/verify-mcp-stub.json` | 16 步 0 失败；临时 daemon 4319 |
| 16 | verify-ai-two-state | `pnpm verify:ai-two-state` | 0 | 9s | `logs/verify-ai-two-state.log`；`gate-evidence/fe-10/verify-ai-two-state.json` | 16 步；无 key 降级 + mock 有 key；真浏览器 UI 段通过 |
| 17 | verify-image-two-state | `pnpm verify:image-two-state` | 0 | 9s | `logs/verify-image-two-state.log`；`gate-evidence/fe-10/verify-image-two-state.json` | 12 步；未启动 / mock 正常 / 取消 / OOM |
| 18 | verify-canvas | `pnpm verify:canvas` | **2** | 21s | `logs/verify-canvas.log`；`gate-evidence/fe-06/…12-44-55.json` | **功能断言 7/7 + 接线 15/15 全过**；截图对照段因参照集未冻结阻塞；notes 记 1 条 console 404 |
| 19 | e2e-smoke | `pnpm e2e:smoke` | 0 | 22s | `logs/e2e-smoke.log`；`gate-evidence/fe-02/e2e/…12-45-20/e2e-smoke-…json` | 生产构建 + 真 daemon + 同源网关；63 步 63 pass（canvas 10 / editor 17 / home 8 / nav 21）+ 编辑器门禁 7 步 |
| 20 | verify-self-designed | `pnpm verify:self-designed` | 0 | <1s | `logs/verify-self-designed.log`；`~/df-evidence/fe-09/…12-45-44.json` | 自动项通过；人工 B 级项 pending |
| 21 | verify-shell-parity | `pnpm verify:shell-parity` | **2** | <1s | `logs/verify-shell-parity.log`；`gate-evidence/fe-12/shell-parity-…12-45-44Z/evidence.json` | 三段均 2：**Electron 二进制缺失** + **参照集未冻结**；显示环境可用、壳已构建 |
| 22 | verify-mk-01 | `pnpm verify:mk-01` | 0 | 11s | `logs/verify-mk-01.log`；`~/df-evidence/mk-01` | 单测 + 请求纪律 + ODS schema + 证据 JSON；5 仓 / 846 资产 |
| 23 | verify-mk-02 | `pnpm verify:mk-02` | 0 | 16s | `logs/verify-mk-02.log`；`~/df-evidence/mk-02` | ODS→DWD 全链路，重建字节一致 |
| 24 | verify-mk-03 | `pnpm verify:mk-03` | 0 | 12s | `logs/verify-mk-03.log`；`~/df-evidence/mk-03` | 确定性 ×3、边界口径、产物自证 |
| 25 | verify-mk-04 | `pnpm verify:mk-04` | 0 | 11s | `logs/verify-mk-04.log`；`~/df-evidence/mk-04` | 索引 schema / 检索 / P95 基线（0.025ms） |
| 26 | verify-mk-05 | `pnpm verify:mk-05` | 0 | 14s | `logs/verify-mk-05.log`；`~/df-evidence/mk-05` | 六环全绿：42 仓 / 1496 认定 / 344 卡 / 15 查询 / 逐层 digest 一致 |
| 27 | 生产构建 web（clean） | `rm -rf apps/web/.next && pnpm --filter @dforge/web build` | 0 | 10s | `logs/build-web-clean.log` | 13 条路由静态/动态生成成功 |
| 28 | 生产构建 desktop（clean） | `rm -rf apps/desktop/dist && pnpm --filter @dforge/desktop build` | 0 | <1s | `logs/build-desktop-clean.log` | `tsc -p tsconfig.build.json` |
| 29 | 依赖审计 | `pnpm audit --prod` | 0 | 78s | `logs/audit-prod.log` | `No known vulnerabilities found`；期间 registry 两次 ETIMEDOUT 后重试成功 |

补充（非上表计数）：先跑的 `build-web` / `build-desktop` 为增量构建（3s / <1s），与 clean 构建同退出码 0；保留在 `logs/` 与 `results.tsv`。

### 2.1 测试规模（本轮实测）

| 包 | 测试文件 | 用例 |
|---|---:|---:|
| web | 155 | 1343 |
| ingest | 52 | 579 |
| engine | 23 | 312 |
| ui | 13 | 165 |
| desktop | 13 | 122 |
| daemon | 13 | 118 |
| contracts | 13 | 80 |
| cli | 9 | 45 |
| comfy | 1 | 1 |
| **合计** | **292** | **2765** |

另：`test:scripts` 56 例；e2e 63 步 + 编辑器门禁 7 步；canvas 7 挂载/行为断言 + 15 条接线；daemon 冒烟 37 项；mcp-stub 16 步；AI 两态 16 步；出图两态 12 步；MK 线 5 个门禁全绿。

## 3. CI 事实清单

### 3.1 工作流事实（`.github/workflows/ci.yml`，仓库唯一的 workflow）

- 触发：`push` 到 `main`；`pull_request` 到 `main`。**其它 base 的 PR 不触发**。
- 运行环境：`ubuntu-latest`、Node 22、pnpm（版本取根 `packageManager`）、30 分钟超时；单一 job `verify`。
- 步骤：`pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm test:scripts` →
  `guard:tokens` / `guard:vocab` / `guard:feature-boundaries` / `guard:electron-baseline` → `verify:engine` →
  `verify:figma-baseline`（**只断言阻塞语义**：无参照集必须 exit 2 且日志含「阻塞：参照集未冻结」；不是门禁通过）。
- 未纳入 CI 的门禁与原因（ci.yml 文末自述，本轮核对一致）：浏览器门禁族、`verify:canvas`、`e2e:smoke`、
  `verify:shell-parity`、`verify:mk-01`（需仓外采集产物）；三个未实现守卫一律 `exit 2`。
- `.github` 下**没有** Dependabot 配置、CodeQL workflow、dependency review workflow。

### 3.2 CI 覆盖矩阵（本轮 29 次执行 vs ci.yml）

| 门禁 | 在 CI？ | CI 中的形式 | 说明 |
|---|---|---|---|
| lint / typecheck / test | 是 | 必过步骤 | 与本地 `pnpm verify` 同链 |
| test:scripts | 是 | 必过步骤 | |
| guard:tokens / vocab / feature-boundaries / electron-baseline | 是 | 必过步骤 | 四个守卫已实现 |
| verify:engine | 是 | 必过步骤 | |
| verify:figma-baseline | **部分** | 阻塞语义断言 | CI 无参照集，只验证 exit 2 + 点名；非通过 |
| guard:deps / mcp-contract / channel-pairing | 否 | — | 未实现桩（exit 2），未接 CI |
| verify:daemon / mcp-stub / ai-two-state / image-two-state | 否 | — | 仅本地 |
| verify:market | 否 | — | 仅本地；且需播种市场索引 |
| verify:canvas / e2e:smoke | 否 | — | 仅本地（浏览器 + 生产构建） |
| verify:self-designed | 否 | — | 仅本地（静态） |
| verify:shell-parity | 否 | — | 仅本地；需 Electron 二进制与显示环境 |
| verify:mk-01…05 | 否 | — | 需仓外采集/评测产物 |
| 生产构建 web / desktop | 否 | — | 仅本地手工 |
| `pnpm audit --prod` | 否 | — | 手工快照 |
| figma 逐页/逐组件门禁（home/editor/panels/inspect/inspector/component/review） | 否 | — | 浏览器挂点，本票未执行 |
| CodeQL / Dependabot / dependency review | 否 | — | 仓库无配置 |

结论：ci.yml 覆盖 **10 个步骤组**；本轮执行的 29 项中，CI 会跑的是 lint/typecheck/test/test:scripts/4 守卫/engine 与 figma-baseline 的阻塞语义断言，其余（生产构建、e2e、浏览器门禁、daemon、market、mcp-stub、两态、self-designed、shell、mk-01…05、依赖审计）**全部只在本地**。

### 3.3 仓库与 PR 状态（`gh -R QIUZI-HONG/DesignForge`，2026-10-17）

- `main` **没有 branch protection**：`GET /branches/main/protection` → 404 `Branch not protected`。
- 最近 CI：`main` 最新 run **success**（id 39003912682，2026-10-17T04:47:58Z）；`integration/batch5` 有成功 run。
- PR **#48**（base `main`）有 `verify` 检查，结论 SUCCESS。
- PR **#49**（base `integration/batch5`）`statusCheckRollup` 为**空**：**完全没有 CI 检查**，与规格描述一致。
- 本票 #51 是 issue；分支 `audit/01-baseline` 未推送，故本轮无 CI 检查。
- 仍开着的裁决/前置：#28（REF-01 参照集冻结）、#39（digest 口径）、#46（批次 5 可测性）、#47（Mimosa 策略）。

## 4. 基线观察（文档与实际偏差 / 红与阻塞）

1. **基线整体为绿，但「7 个 exit 2」必须按阻塞记账**：三个未实现守卫（deps/mcp-contract/channel-pairing）、figma-baseline、未播种的 market、canvas（仅视觉段）、shell-parity。没有 exit 1，也没有超时。证据：上表 7/8/9/11/13/18/21 行。
2. **REF-01（#28）是三条门禁的共同阻塞源**：`verify-figma-baseline`、`verify-canvas` 截图段、`verify-shell-parity` 对照段均因 `~/df-evidence/reference-v1` 不存在而 exit 2。canvas 的 7 条功能断言与 15 条接线**全部通过**，阻塞只来自缺少冻结参照。证据：`logs/verify-canvas.log`、`gate-evidence/fe-06/…json`、`logs/verify-figma-baseline.log`。
3. **Electron 二进制不在 `pnpm install` 的产物里**：fresh worktree 中壳冒烟/存活两段均因缺 `apps/desktop/node_modules/electron/dist/electron` exit 2；显示环境实际可用（WSLg），壳也已构建。运行态结论需先按文档执行 `pnpm --filter @dforge/desktop fetch-electron`（镜像可配）再复跑。证据：`logs/verify-shell-parity.log`。
4. **`verify-market` 的结论依赖数据根是否播种**：空临时根 exit 2（索引缺失，符合三态语义）；把 MK-05 的 `ads/*.json` 注入临时根后 exit 0（4 项全过）。基线/审计若要用它做产品判定，必须显式声明数据根来源。证据：`logs/verify-market.log`、`logs/verify-market-seeded.log`。
5. **CI 覆盖面显著小于本地门禁面**：生产构建、e2e、canvas、daemon、market、mcp-stub、两态、self-designed、shell、mk 线、依赖审计均不在 CI；figma-baseline 只断言阻塞语义。CI 的「绿」不能代表这些能力可用。证据：§3.2 矩阵与 `.github/workflows/ci.yml`。
6. **合并入口没有强制力**：`main` 无 branch protection；PR #49 因 base 是 `integration/batch5` 而零检查。CI 仍是「约定」而非「门禁」。证据：§3.3。
7. **文档/旧报告数字已漂移**：
   - 旧报告：2756 例（web 1335 / desktop 121）；本轮：**2765 例**（web 1343 / desktop 122）。
   - 旧报告 canvas「挂载 6/6」；本轮实际 **7 条挂载/行为断言**（A1–A7，含 A7 深色主题）+ 15 条接线。
   - ci.yml 注释与工作流文档仍写 e2e「10 步冒烟」；实际场景为 **63 步 + 编辑器 7 步**。
   - `docs/agents/implementation-workflow.md` 要求浏览器门禁用生产构建、不要用 `next dev`；本轮 `verify-canvas`、`verify-ai-two-state`、`verify-image-two-state` 仍自起 `next dev`（三者在本次环境均通过，但口径与文档不一致，属门禁工装债）。
8. **依赖审计是手工快照**：`pnpm audit --prod` 本次 exit 0、0 已知漏洞，但耗时 78s 且出现两次 `ETIMEDOUT` 重试；CI 无 audit/CodeQL/Dependabot，结论不可在合并时复现。证据：`logs/audit-prod.log`。
9. **canvas 运行期记到 1 条 console 404**（`Failed to load resource … 404`），未影响 7 条功能断言；证据 JSON 的 `notes` 已如实记录，建议在编辑器深挖票定位资源。证据：`gate-evidence/fe-06/verify-canvas-2026-10-17T12-44-55.json`。
10. **e2e 真链路健康**：63/63 pass、0 fail/blocked，108 次请求全部走同源网关，0 次直连 4318；编辑器段 7/7（含 CanvasKit/Skia/首帧/无未捕获异常）。证据：`gate-evidence/fe-02/e2e/2026-10-17T12-45-20/e2e-smoke-2026-10-17T12-45-20.json`。

## 5. 已知阻塞与原因（本票不改）

| 阻塞 | 原因 | 解除条件 |
|---|---|---|
| REF-01 参照集未冻结 | `~/df-evidence/reference-v1` 不存在（#28 未完成） | 冻结参照集并落 `baseline.json`；随后 figma/canvas/shell 对照段可判定 |
| Electron 二进制缺失 | `pnpm install` 不下载；本机未执行 `fetch-electron` | 按 README/工作流执行 `pnpm --filter @dforge/desktop fetch-electron`（必要时 `ELECTRON_MIRROR`） |
| 市场索引缺失（空根） | 门禁不生成数据；需先 `df market collect|score|index` | 播种 `market/ads/*.json` 或使用已建索引的审计数据根 |
| 三个守卫未实现 | `guard:deps` / `guard:mcp-contract` / `guard:channel-pairing` 仍是 exit 2 桩 | 由后续票实现并接 CI |
| main 无 branch protection | 仓库设置项，需管理员授权 | 启用必需检查（至少 `verify`）并禁止绕过 |
| PR #49 无 CI | base 为 `integration/batch5`，不触发 `pull_request: [main]` | 改 base 到 main，或为集成分支增加触发（改造票 #60 决策） |

## 6. 对后续票的输入

- #52（五态能力表）：可直接引用本票的「功能断言通过但视觉/环境阻塞」区分（canvas vs shell vs market）。
- #53/#54/#55/#56/#57：优先在**已播种数据根 + 生产构建**下复验，避免把「空根阻塞」误判为产品缺陷。
- #59：CI 改造清单至少包含：生产构建、e2e、canvas（功能段可先接，视觉段待 REF-01）、daemon、两态、self-designed、mk 线、
  依赖审计、CodeQL/Dependabot/dependency review、branch protection、集成分支触发。
- #60：先修文档漂移（e2e 步数、canvas 断言数、dev vs 生产构建口径），再谈新增门禁。

## 7. 证据索引

| 内容 | 路径 |
|---|---|
| 原始日志（29 条 + install） | `~/df-evidence/audit-50/aud-01/logs/` |
| 退出码/耗时表 | `~/df-evidence/audit-50/aud-01/results.tsv` |
| 机器可读基线 | `~/df-evidence/audit-50/aud-01/baseline.json` |
| 门禁证据 JSON/截图 | `~/df-evidence/audit-50/aud-01/gate-evidence/`（fe-02/fe-06/fe-10/fe-11/fe-12/ref-01） |
| 硬编码路径的既有证据 | `~/df-evidence/inf-01/`、`~/df-evidence/fe-09/`、`~/df-evidence/mk-01…05/` |
| CI 工作流 | `.github/workflows/ci.yml`（本轮核对版本） |

> 本文件只记录事实与阻塞；修复项、缺口票与 CI 改造由 #59/#60 汇总，不在本票展开。
