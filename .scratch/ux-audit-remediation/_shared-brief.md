# 共享简报 · ux-audit-remediation（全体实现/合并子代理开工前必读）

本战役把 2026-10-30 UX 巡检的修复 spec（`spec.md`）落成 17 张票（`issues/01–17`）。票面给范围，本简报给坐标。

## 你所在的树与分支

- 集成分支：`ux-audit-remediation`；集成工作树：`/home/QIU/df-wt/integration`（merger 用）。
- 实现工作树：`/home/QIU/df-wt/<NN>-<slug>`，分支 `<type>/<slug>`（建树命令见主会话派单）。
- 开工先 `git status` + `git log --oneline -3` 确认基于集成分支 tip；落后先 `git merge ux-audit-remediation` 解决冲突再动手。
- **主工作树 `/home/QIU/OpenDesign` 恒在 main，任何代理不得在其中 checkout/建分支。**

## 环境事实（每条命令都要用）

- node 不在默认 PATH：**每条 node/pnpm 命令前缀 `PATH=/home/QIU/.zcode/server:$PATH`**（本机 node 22.16）。
- worktree 内首次：`PATH=/home/QIU/.zcode/server:$PATH pnpm install --frozen-lockfile`。
- daemon 直跑 `src/main.ts` 会 `ERR_UNKNOWN_FILE_EXTENSION`——需要 `node --experimental-strip-types src/main.ts`（票 10 落地前的临时事实，不要在别的票里顺手改文档）。
- 浏览器门禁一律 `next build` + `next start`（**禁用 next dev** 跑断言：dev 源在本机不加载客户端引导件）；端口用空闲端口，禁用 3000/4318。

## 铁律（违反即返工）

- **禁用 /tmp** 当工作树或缓存（tmpfs 3.9G）；中间产物落本 worktree 或 `~/df-evidence/<票号>/`。
- **禁按模式杀进程**（`pkill -f`）；只按精确 PID 或自建独立进程组回收自己起的进程。
- **不碰开发机在跑的服务**：3000（web dev）、4318（daemon）与真实数据根 `~/.dforge` 一律不连不写；fixture 用空闲端口 + 临时数据根（先例：`scripts/lib/gates.mjs` 的 `startFixtureDaemon`/`freePort`）。
- **禁 lint 抑制**（`biome-ignore`/`@ts-ignore`/`eslint-disable`）；确需例外写明原因并留登记。
- **界面文案一律经 i18n zh-CN 目录**（ADR-0003），禁硬编码中文字面量进组件；标识符英文、注释中文。
- **禁裸值**：颜色/字号/间距/圆角走 `@dforge/ui` 令牌。
- TypeScript strict（含 `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`），逐包 `tsc --noEmit` 必须过。
- 依赖方向：apps/services/tools → packages；`@dforge/engine` 纯 TS 零 DOM。
- 测试不得依赖开发机 daemon/真实数据根/仓外证据；CI 无 gh 凭据，凭据用例注入占位（先例：`tools/cli/src/verify-market/cli-replay.test.ts`）。
- vitest 默认 5s 超时在慢机会误红：管线类用例只放宽超时上限、不放宽断言。

## 提交与收尾

- **每完成一个模块立即提交**（`git add -A && git commit`），不要攒大提交；中文 Conventional Commits，正文写票号（`issues/<NN>-*.md`）与 spec 章节。
- 收尾前：把集成分支 tip 并入你的分支、解决冲突、跑改动包 `lint`+`typecheck`+`test`（全仓改动跑 `pnpm verify`），然后报告 ≤15 行：改动面、验收勾选情况、已知偏离。
- 验收标准里的「浏览器实测」项：实现代理只负责可自动化项（组件/引擎/路由测试 + 门禁挂点断言），浏览器级复核由主会话在集成分支统一做——在报告里把这类项标成「待主会话浏览器复核」。
- 票面验收全勾后**不要自己改票文件的 Status**——merger 会统一勾选。
