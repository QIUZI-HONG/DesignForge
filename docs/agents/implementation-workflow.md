# 实现工作流（票 / 工作树 / 门禁 / 合并）

本仓实施与合并的纪律与教训。派 implementer / merger / 修复代理前，先读本文件。
（**移植自 `QIUZI-HONG/DesignForge-legacy` 的 `docs/agents/implementation-workflow.md`**，
按设界口径重写：本地优先、pnpm workspace、全中文基线、门禁退出码语义。）

## 多代理批次作战（导航）

本仓按「批次 → 工作包 → 一票一树」组织多代理并行施工。接手战役的新会话先在这里认坐标，
各坐标的细则都在本文件对应小节（本段只做**指针**，不搬内容）：

- **工作树**：一票一树 `/home/QIU/df-wt/<票号>`（**禁用 `/tmp`**）；命名、建法与提交节奏见
  「工作树纪律」。
- **简报**：`~/df-charting/briefs/`——`_shared.md` 是全体实现子代理共享的坐标与纪律
  （**开工前必读**，含目录归属与禁止事项），另有批次简报（如 `fix-batch3.md` = 批次 3 的规格
  与工作包）与各票简报。口径：**票面（GitHub issue）给范围，简报给坐标**，两者都读。
- **证据**：`~/df-evidence/<票号>/`——对照证据（截图 / 证据 JSON / benchmark 输出）一律落仓库外，
  **仓库只存代码与文档**；细则见「证据存仓库外」。
- **门禁实况表的维护 DoD**：实况以**两处同源**记载为准——本文件「门禁退出码语义」的**守卫实况行**，
  与 `AGENTS.md`「工程命令」的**门禁实况行**。**任何改门禁的票**（新增 / 实现 / 接 CI / 退役 /
  桩转真）必须在同一票内**同步这两处**，写清：三态语义、是否已接 CI、仍为挂点的是谁；
  不同步 = 实况表停留在旧口径，下一个会话会按错口径开工。

## 工作树纪律

- 主工作树 `/home/QIU/OpenDesign` **恒在 `main`**；任何代理不得在其中 `checkout` / `switch` / 建分支。
- 一票一工作树：`git worktree add /home/QIU/df-wt/<票号> -b <type>/<slug> main`。
  例：#12 → `/home/QIU/df-wt/repo-landing`，分支 `chore/repo-landing`。
- **禁止用 `/tmp` 当工作树或缓存目录**——本机 tmpfs 仅 3.9G，会被 `node_modules` / `.next`
  撑爆，并可能被系统清空（半成品直接蒸发）。中间产物一律落 `/home/QIU/df-wt/<票号>/`
  或仓库外证据目录 `~/df-evidence/`。
- **每完成一个模块立即提交**（`git add -A && git commit`），不要把整票攒成一次大提交：
  子代理随时可能中断，未提交的成果等于没有成果。
- 提交信息：**中文 Conventional Commits**（`feat(engine): …` / `chore(repo): …`），
  正文写清范围与依据（票号、规格章节）。

## 子代理中断（配额 / 失败）的恢复

implementer 半路死掉会留下未提交半成品 + 残留认领：

1. **先对齐现场**：`git log --oneline -5` + `git status --short`，看清已提交什么、还差什么
   （**不要**凭记忆猜进度，也不要盲目 `reset --hard`）。
2. 清认领：`gh issue edit <n> -R QIUZI-HONG/DesignForge --remove-assignee @me`。
3. 保留其工作树，读现场（跑该包 `pnpm --filter <pkg> test`，必要时读 diff）。
4. 保现场：`git add -A && git commit -m "wip: 接管前任半成品"`；落后就把集成分支并入。
5. 从半成品续做——**绿的部分不推倒**，继续 TDD 循环。

## 合并卫生

- 收尾前：`git status` 干净、全量门禁绿（见下）、工作树随后移除。
- **合并前先把集成分支（或 `main`）的 tip 并入本分支**、解决冲突、再跑全量门禁——
  冲突解决后的代码没跑过门禁，等于没验证。
- `git reset --soft` 保留已跟踪改动，但**未跟踪文件仍是未跟踪**：soft reset 后必须
  `git status --short` 并 `git add -A` 再提交，否则提交会静默丢新文件（legacy 丢过 6 个 web 文件）。
- 杀进程时让 pattern 不要匹配自己的命令行（`pkill -f "http[.]server 81[2]3"`），
  否则会连正在跑 `pkill` 的 shell 一起杀掉。
- 合并/收尾提交必须过钩子；只有保现场的 wip 提交允许 `git commit --no-verify`。
- **Mimosa git 门（本机现状，如实记录）**：本机 Mimosa 插件的 git 门会拦 `git commit` /
  `git push`，且对**跨文件**改动存在误报会把提交打回。**不得用环境变量（`MIMOSA_NO_GIT_GATE`
  一类）绕过**——提交 / 推送改由子代理执行；插件级策略（豁免白名单等）属**用户决策**，
  本仓侧只留这一行痕迹，别每个会话重复撞墙。

## 门禁退出码语义（禁止假绿）

门禁脚本与浏览器门禁**统一三态退出码**：

| 退出码 | 含义 |
|---|---|
| `0` | 通过 |
| `1` | 违规（门禁已实现，且发现真违规） |
| `2` | **阻塞**：未实现、参照集未冻结、前置条件不成立（如 Figma 参照截图集未冻、daemon 未启动） |

- `2` **不是通过**：任何脚本把「未实现」当绿报，都是假绿，一律按缺陷处理。
- 未接入的门禁必须在 CI/文档里显式标注「挂点（随票接入）」，不得静默缺席。
- **守卫实况（2026-10-16 批次 2 后）**：`scripts/guard-tokens.mjs` 与
  `scripts/guard-electron-baseline.mjs`（含检出强度回归 `scripts/tests/guard-electron-baseline.test.mjs`）
  **已实现并接入 CI**；`verify:engine` / `test:scripts` 同批入 CI；`verify:figma-baseline` 以
  「CI 无参照集 → 断言 `exit 2` 且日志点名『阻塞：参照集未冻结』」的**阻塞语义断言**入 CI（不是当绿）。
  仍为桩（`exit 2`、不接 CI）：`guard:deps` / `guard:mcp-contract` / `guard:channel-pairing`。

## 门禁清单（本段）

- 常规链路（CI 与本地同一条）：`pnpm install --frozen-lockfile` → `pnpm lint` →
  `pnpm typecheck` → `pnpm test`；本地等价命令 `pnpm verify`。
- **浏览器门禁（挂点，随票接入）**：`verify-figma-page|component|states|baseline`（逐页/逐组件对照）、
  `verify-canvas`（画布挂载 6 断言）、`e2e:smoke`（10 步冒烟：拖画→持久化→导出/导入往返）、
  壳内渲染一致性断言（FE-12）。
- **驱动口径**：`playwright-core 1.63.0` 锁 `chromium-1243`，headless + 生产构建。
  Node 级测试看不见浏览器专属故障（被遮挡的下拉、`window.setTimeout` 的 Illegal invocation、
  React 版本门禁）——浏览器门禁就是逮住它们的地方。
- 对抗性门禁（如「字体已加载、禁止静默回退」）必须真断言，不能只断言「页面能打开」。

## CI 环境与开发机的差异（写用例前先读）

CI runner（GitHub Actions `ubuntu-latest`，node 22）与开发机（node 24，有 gh 凭据、有仓外证据）
**不是同一个环境**。批次 3 的三处 CI 首红全部源于「用例假设了开发机有、而 CI 没有的东西」——
写用例时先逐条对照本清单，别让 CI 红一轮才发现环境假设。

- **无 gh 凭据**：CI 里 `GH_TOKEN` 与 `github.token` **都没有**（`gh` 也未登录，凭据预检会先于
  任何网络分类抢先阻塞）。凭据相关用例要**注入占位凭据或自起桩**（先例：批次 2
  `tools/cli/src/verify-market/cli-replay.test.ts` 在 `beforeAll` 注入占位 `GH_TOKEN`、
  `afterAll` 还原，走 `resolveGitHubToken` 的「env 优先于 `gh`」口径；真请求仍由 fetch 桩拦截）；
  **不要依赖「本机 gh auth 恰好可用」**——这种环境巧合在 CI 直接翻红。
- **runner 更慢**：CI runner 抖动可达本机 3–4×，**vitest 默认 5s 超时会在 CI 误红**。整管线 /
  回放类用例给足超时上限（先例：批次 2 `services/ingest/vitest.config.ts` 把包级 `testTimeout`
  提到 30s——本机 1.3s 的 3000 条目用例在 runner 上 >5s）。口径：**只放宽超时上限，不放宽任何
  断言**——真退化（复杂度劣化、挂起）仍以超时失败，不引入假绿。
- **无仓外证据**：`~/df-evidence/**` 是开发机产物（按纪律存仓库外，见「证据存仓库外」），
  **CI 上不存在**。用例不得读它——离线回放要读的样本必须**冻结进仓库**（先例：`services/ingest`
  的冻结样本），否则读到的是 `exit 2` / ENOENT，而不是断言。
- **无 Electron 二进制**：CI 不拉 `apps/desktop` 的 Electron 二进制（见「环境与安装」），
  桌面用例必须**纯静态 / 单测**（先例：`guard:electron-baseline` 的窗口选项静态断言 +
  `test:scripts` 的对抗夹具回归），不得 `require('electron')`、更不得起真窗口。
- **追加式落盘的清理竞态**：遥测 / 审计一类**追加写**在 `close()` 返回后仍可能有在途写入，
  与临时目录的递归删除竞速会偶发 `ENOTEMPTY`；清临时根一律用**可重试删除**
  `rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })`（批次 2 实例：
  `apps/daemon/src/testing/harness.ts` 的 `cleanup()`——`export.test.ts` 的 PDF 用例红于
  `ENOTEMPTY: rmdir '.../data/telemetry'`，本机从不复现，CI 才现形）。

## 代码规范

- **TypeScript strict**（根 `tsconfig.base.json`：`strict` + `noUncheckedIndexedAccess` +
  `noImplicitOverride` + `exactOptionalPropertyTypes`），逐包 `tsc --noEmit` 必须过。
- **注释与文档字符串一律中文**；**标识符英文**（变量/函数/类型/文件名）；提交信息与证据中文。
- 标识符与文案分离：界面文案一律经 i18n 目录（zh-CN 唯一暴露，ADR-0003），禁止硬编码中文字面量进组件。
- **禁裸值**：颜色/字号/间距/圆角一律经 `@dforge/ui` 令牌（双基准 × 密度映射），组件内不得出现
  魔法数/裸色值；确需例外时在 PR 里说明并留给 `guard:deps` 同族规则登记。
- **禁 lint 抑制**：不得用 `biome-ignore` / `@ts-ignore` / `eslint-disable` 之类压掉告警；
  确需例外必须单人复核并在代码里写明原因（后续 `guard` 会收口）。
- 依赖方向：apps / services / tools → packages；`@dforge/engine` 保持纯 TS 零 DOM。

## 推送与 CI

- 推送走 SSH（HTTPS 到 github 时断时续）：
  `git -c url."git@github.com:".insteadOf=https://github.com/ push -u origin <branch>`。
- 首次推送新分支必须 `-u origin <branch>`；**每次推送后在宣布完成前读一次 CI 结果**：
  `gh run list -R QIUZI-HONG/DesignForge --limit 1` 须为 `completed/success`
  （legacy 有过整轮里程碑 CI 从第一天红到最后没人发现的先例——检查存在，但没人读它）。
- PR 标题带票号「（#<票号>）」，正文写清：范围、验证命令与**真实输出摘要**、已知偏离与原因。

## 证据存仓库外

- 对照证据（截图、证据 JSON、benchmark 输出）一律落 `~/df-evidence/<票号>/`，
  **不进仓库**（仓库只存代码与文档；`artifacts/` 已 gitignore，不得依赖它传证据）。
- 证据 JSON 字段按《前端验收标准 v1》§4；每票 DoD = 门禁绿 + 本票范围对照证据 + 差异修复记录。
- 参照集（Figma 本体中文界面的逐页截图集）冻结信息（版本 + 日期 + 哈希）落文档，
  冻结前门禁一律 `exit 2`（阻塞），不得按「大概像」判过。

## 环境与安装

- Node ≥ 22（开发机 node 24）+ `pnpm@10.33.2`（由根 `package.json` 的 `packageManager` 锁定）；
  脚本一律经根 `package.json` 的 scripts 走，不在包内自建工具链。
- 依赖版本统一走 `pnpm-workspace.yaml` 的 `catalog:`，不在各包散写版本号。
- Electron 二进制（`apps/desktop`）：electron@44 的 npm 包**没有** postinstall，二进制在首次
  `require('electron')` 时经 `@electron/get` 懒下载——pnpm 10 的 `approve-builds` 白名单对它不适用。
  取二进制走本仓工具（幂等）：`node apps/desktop/tools/fetch-electron.cjs`。
  **网络约束（本机实测）**：GitHub Releases 直连会 `fetch failed`，需带镜像，例如
  `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node apps/desktop/tools/fetch-electron.cjs`（约 123MB）。
  壳的运行法见 README「工程启动」；CI 仍不拉该二进制（`pnpm test` 的桌面用例是纯静态/单测，不依赖二进制）。
