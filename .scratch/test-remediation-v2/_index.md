# test-remediation-v2 · 全仓企业测试审查第二轮修复批（26 票）

来源：2026-11-01 全仓多智能体审查（固定点 `main@a838281`；7 名 Standards/Spec 审查者 + 4 名猎手 + 专职安全 + 4 名独立验证者 + 主控门禁实跑 41 项）。
完整证据与精确坐标：`~/df-evidence/test-2026-11-01/report.md`（含 `gate-summary.tsv` / `gate-summary-b.tsv` / 逐门禁日志 / `audit-prod.log`）。
去重基线：上一轮 `~/df-evidence/test-2026-10-31/report.md`（A1–F3，18 项 Important）与其工单包 `.scratch/test-remediation/01–16`。**本包只登记新条目**；旧条目只在「仍未落地」口径下引用编号，不重复开票。

## 开工前必须先定的两件事（人工决策，见报告 §八）

1. **基线（报告 §三 X1）**：`.scratch/test-remediation`（16 票）与 `.scratch/ux-audit-remediation`（17 票）**状态全为 `ready-for-agent`，且两目录在主树里是未跟踪状态**，而 `fix/test-remediation` 已领先 `main` 73 commits 未并 → v2 票开工前先决定「先并主干」还是「在 main 上并行」。票 18、20 与本包多条都跟旧票同文件，顺序错了会互踩。
2. **浏览器/E2E 深度未达成**：缺 `libnspr4 / libnss3 / libnssutil3 / libsmime3 / libasound2` 且无 sudo → 票 01/02/04 的「用户可见后果」目前只有代码级证据；装库后必须复跑 Phase B 才算验收。

## 工单与阻塞边

| # | 工单 | 来源 | 阻塞 |
|---|---|---|---|
| 01 | figma 门禁空目标集即通过 | Standards S2 | 无 |
| 02 | daemon 流式 AI 丢 CORS 头 | Standards S1 | 04 |
| 03 | AI 降级态必须产出非空本地建议 | Spec X2 | 无（= ux-audit 票 03 复活） |
| 04 | 浏览器门禁改生产构建（禁 `next dev`） | Standards S3 | 无 |
| 05 | 门禁夹具端口显式化 + 临时根离 `/tmp` | Standards S4 | 无 |
| 06 | 门禁三态退出码映射与优先级 | Standards S5 | 05 |
| 07 | 引擎快照禁自重基线 + CI 脏树检查 | Standards S6 | 无 |
| 08 | CI 阻塞语义步骤 exit 0 须附凭据 | Standards S7 | 无 |
| 09 | `test:scripts` glob 命中下限 | Standards S8 | 无 |
| 10 | 参照集冻结须人工签字入退出码 | Standards S9 | 无（与 REF-01 协同） |
| 11 | 状态族逐族完整断言 | Standards S10 | 无 |
| 12 | 壳导航守卫接线 + 守卫判据 + 权限面 | Standards S11 | 无 |
| 13 | 测试清理统一可重试删除 | Standards S12 | 无 |
| 14 | CLI 凭据外发加回环/https 守门 | 安全 §4.2 | 无（与旧票 02 同凭据面） |
| 15 | `fast-uri` 8 项与 S-04 判据对齐 | Spec X4 | 无 |
| 16 | 门禁实况两处同源同步 + 规模基线重冻 | Spec X3 | **01–15、17–20 收口后** |
| 17 | 粘贴悬空组件引用 → 文档不可重开（潜伏） | 数据类（猎手 runtime + 复核） | 无 |
| 18 | 导出节点预算静默截断 | 数据类 | 旧票 01（同一函数） |
| 19 | 文档 409 时正文已落盘 + 无 manifest 目录占名 | 数据类 | 无 |
| 20 | 判据与夹具卫生 nit 批 | Nit 池 | 无 |
| 21 | 文档跨进程写锁（票 19 遗留：conflict 分支无确定性判据） | 票 19 实施中发现 | 无（前提：票 19 已并） |
| 22 | `verify:ai-two-state` 态 B 到不了被测路径（本机 mock 被白名单拒） | 门禁可信度 | 无 |
| 23 | 读回侧「能打开」的降级路径（票 17 blocker 3 未做） | 数据类 | 票 17（已并） |
| 24 | 跨文档粘贴的组件来源不可证（id 相撞重绑到无关组件并穿过两道门落盘） | 二轮审查 CL-2（**既有**，非本 diff 引入） | 票 17（已并） |
| 25 | 异步提交期间焦点被 `disabled` 踢出浮层，Esc 与焦点陷阱同时失效 | 三轮 UI 实跑（**既有**，非本 diff 引入） | 票 05 的选择器修复（已并，否则第④步跑不到） |
| 26 | 浮层之外的异步按钮把焦点交回 `<body>`（票 25 扫描的遗留面） | 票 25 blocker 5 的同族扫描（**既有**） | 无（票 25 已并，层内 5 处不再重复计） |

**按用户价值的开工顺序建议**：17 / 19 / 18（数据不可逆类）→ 02 / 03（AI 主功能与承诺）→ 01 / 04–09 / 13（门禁可信度：假绿与纪律）→ 10–12 / 14 / 15 → 16 收口。
前沿（可立即开工）：01、04–05、07–15、20–24、26。06 待 05；02 的验收待 04 与装库；16 必须最后。**已收口（第 1 批）**：17（blocker 3 → 票 23）、18、19（conflict 分支 → 票 21）、02、03。票 22 由本批门禁实况单立。**已收口（第 3 批）**：05、25（层外遗留 → 票 26）。

## 批次纪律

- 全部 `ready-for-agent`；一票一树 `/home/QIU/df-wt/<票号>`，**禁用 `/tmp`**，完成即提交。
- 合并前在集成分支跑全量门禁（本轮 Phase A/B 两条链都要跑），证据落 `~/df-evidence/<票号>/`。
- 01/04/05/06/07/08/09/13 都在改 `scripts/**`：按「先改共用库（`scripts/lib/`）、后改各门禁」排序，避免互踩。
- 17/18/19 触碰 `packages/engine/src/clipboard` 与 `apps/daemon/src/documents|export`，与旧包 01/07 同文件——先定基线（本文第 1 条）再开工。
- 票 16 落地必须同步两处实况表（`implementation-workflow.md` 守卫实况段 + `AGENTS.md` 工程命令行），否则按 DoD 视为未完成。

## 本轮开工记录（2026-11-01 第 1 批）

人工决策（已定）：
1. **基线** = 先并 `fix/test-remediation`（上一轮 16 票的 73 commits）再开工。集成分支
   `integration/test-remediation-v2` @ `3f3603c`，worktree `/home/QIU/df-wt/v2-integration`；主树 `/home/QIU/OpenDesign` 保持 main 不动。
   → 本文「开工前必须先定的两件事」第 1 条据此关闭。
2. **范围** = 只做数据不可逆 + 主功能五票：**17 / 19 / 18 / 02 / 03**。其余 15 票维持 `ready-for-agent`，下一批再排。

基线核对结论（全文 `~/df-evidence/test-remediation-v2/notes/baseline-audit.md`）：
- 票 18：上一轮票 01（阻塞边）已在基线内 → **解除**；信封分支一通即「用户可见静默截断」，级别上调；blocker 4（尺寸护栏）已由 e1ecb84 落地，改为注明。
- 票 02：完整存活；`CorsPolicy.isAllowed` / `isLoopbackOrigin` 是必须复用的单一口径，禁止第二处拼头。浏览器段仍不可验收（票 04 不在本轮 + 本机缺 Chromium 系统库、无 sudo）→ 本轮交付代码 + 真 socket 线路级正/负断言，浏览器验收挂待人工。
- 票 03：**工单前提在新基线上不成立**——`ai/client.ts:37-75` 每个降级原因已产出 1–2 条本地建议，`AiDrawer` 已渲染 title/detail + 操作按钮，且空正文时显示「本地模板」说明文案。降级态 `content` 为空是设计而非缺陷，判据不得写成「content 非空」。残活＝断言加固（`adversarial.test.ts:287-301` 键级断言升级、`verify-ai-two-state.mjs` 无 key 段断渲染后可操作建议清单可见）+ 与 `.scratch/ux-audit-remediation/issues/03` 留痕对齐。审查报告里的路径 `routes/ai.adversarial.test.ts` 系误写，实为 `apps/daemon/src/adversarial.test.ts`。
- 票 17：存活，仍属**潜伏**（无页签切换、生产无剪贴板注入点）。blocker 3（只读/修复模式）属产品结构决策，本轮不实现，落「写侧拒绝 + 读侧错误分类」并另立后续票。
- 票 19：存活，行号已迁移；`isRemovableDocDirectory` 守卫与 `list()` 的 `manifest_unreadable` 告警可直接复用。

本轮并行面（无文件重叠，可一树一票）：18 → export；02 → routes/ai + cors；03 → adversarial 测试 + verify 脚本；17 → clipboard/session/documents-client；19 → documents/store。

## 第 2 批开工记录（2026-11-01 二轮修复 · 增量合并）

**「开工前必须先定的两件事」第 2 条据此关闭**：Chromium 五个缺库（`libnspr4 / libnss3 / libnssutil3 / libsmime3 / libasound2t64`，注意 26.04 上后者已改名 `libasound2t64`）以**无 sudo** 路线补齐——`apt-get download` + `dpkg -x` 到 `/home/QIU/df-local-libs`，跑门禁时加 `LD_LIBRARY_PATH=/home/QIU/df-local-libs/usr/lib/x86_64-linux-gnu`；关键一手是 Playwright 默认 headless 用的是 **`chrome-headless-shell`** 而非 `chrome`。实测：`verify:image-two-state` → **0**（真浏览器 12 步 0 失败）。**未写系统目录、`~/.dforge` 逐字节未变**。日志与库清单：`~/df-evidence/env-browser-libs/`。

浏览器段仍出 2 的两个门，原因**不再是环境**：`verify:canvas` 与 `verify:figma-inspect` 卡在「参照集未冻结（REF-01，票 10）」，`verify:figma-inspect` 另加一条「daemon 未启动」（该门不自起，避免污染用户数据根，属设计）。→ 需人工拍：冻结参照集，或在票 10 上显式登记「本轮不适用」。

增量合并（三条腿各自 worktree，文件所有权不重叠）：

| 腿 | 分支 | 合入点 | 覆盖的二轮阻断项 |
|---|---|---|---|
| impl-c | `fix/v2r-c-ref-integrity` | `01cec5e` | CL-1 · SE-1 · SE-3（只说实话，扩码转票 23/人工决定 1）· H1 文案 · 新建票 24 |
| impl-b | `fix/v2r-b-export-honesty` | `d448754` | ST-1 · SP-1 · EX-1 · G4（票 22 段 B 显式 SKIP 并退 2） |
| impl-a | `fix/v2r-a-daemon-commit` | 待合 | DA-1 · DA-2 · DA-3 · SP-2 · SE-2 · SE-4 · SE-5 |

合并后门禁复算（`~/df-evidence/merge-implb-2026-11-01/`，脚本 `~/df-evidence/v2-merge3/run-gates.sh`）：Node 链 9 项全 0；`scripts/**` 读 `.complete` 的消费方命中由 **0 → 4**（ST-1 机检口径成立）；冻结基线 vs `3f3603c` 与 vs `main` 均**零 diff**；`~/.dforge` 未触碰；跑完 `git status` 干净。出 2 的 5 项里 3 项是「守卫未实现（设计如此）」，2 项是 REF-01。

**流程教训（不是产品缺陷，但要记账）**：第 1 批三名实现者**全部**在 150 轮上限处被截断，其中 impl-b、impl-c 截断时**一个提交都没落**（13 个 / 8 个脏文件），impl-a 落了 5 个提交所以只剩一片在途。共同故障形状是「攒着不提交 + 提交前无限打磨变异检验」。据此的接手纪律（已写进三名接手人的任务书并生效）：**前 10～15 次工具调用内必须落下第一个提交，任何时刻未提交切片不超过一个，变异检验放在切片提交之后**。

工单自述不可照抄，两处实测反例：前一名 impl-b 在票 18 里自称「typecheck 0」**不实**（`exactOptionalPropertyTypes` 下 `putBodyAndExport` 是红的，接手人已修）；`verify:ai-two-state` 二轮换到 18 步 5 红后，G4 的推断被**逐字证据**替换——段 B 的 `degradedReason:"upstream-error"` + `provider:"deepseek"` 证明它确实在试图真出网，而脚本用 `cloudCalls: 0` 认证「不出机」（`cloudCalls` 数的是本地 mock 收到几次，真实上游被拒时恒 0）。详见 `~/df-evidence/v2-review2/reports/g4-ai-two-state-live-egress.md`。

待第三轮判定的一条：段 B 改显式 SKIP 后，`verify:ai-two-state` 退 2，但仍有 2 个 UI 步报「判据不可评估」（`ui.degraded-suggestions` 的 `page.click` 与 `ui.degraded-result-nonblank` 的 `locator.innerText` 各超时 30s）。**未定**是产品缺陷（抽屉打不开/结果区不渲染）还是门禁驱动方式的问题——`ui.entry.visible` 是过的，且同一浏览器链路在 `verify:image-two-state` 全绿。

## 第 3 批开工记录（2026-11-02 三轮 · 复核 + 修复 + 合并）

上一节「待第三轮判定的一条」据此关闭：两步红的**成因是门禁选择器越界**（票 05，已在 `2002973` 修为 `getByRole('button',{name:'生成'})`），修好后第③步真正走完降级提交，两步转 `[ok]`；但接着暴露出**第④步 Esc 关不掉抽屉**——那是**产品缺陷**，单列票 25。一条判据错、一条真缺陷，两件事必须分开记，不能因为「红的是门禁」就把后面那条也归成门禁。

三条腿的合入点（本轮范围仍限数据不可逆 + 主功能；`pnpm run lint` 仅剩既存告警、`typecheck` 全仓 Done、`apps/daemon` vitest 252/252、`verify:daemon` 54 步 0 失败退出 0）：

| 腿 | 合入点 | 覆盖的三轮阻断项 |
|---|---|---|
| r3-a 门禁诚实度 | `2002973` | S1 三态判定由事实推导（中途不再写 exitCode，违规 1 优先于阻塞 2）· P1 段 B 未装替身就不装 key、不发请求 · UI 选择器改可及性口径 |
| r3-c 导出 | `e288264` | E1 存量顶层分支「看不见」不再认证成完整 · E2 部分产物侧文件按内容摘要命名（同页两次部分结果不再互顶）· E3 导出段补 6 条负向腿 |
| r3-b daemon 一族 | `4bcfa95` + `81ae096` | S2 声明释放先比内容再删 · D1 提交路径 fs 错误按性质分类（errno + preemptedBy）· D2 递归删只认「名字与形状同时命中」的自有外壳 · SEC-A 422 清单条数与单条长度双向有界 · SEC-B「不抛」承诺改到代码给得了的值域 · SEC-C 查表改 `Object.hasOwn` |

验证口径的两处自我修正（都是**先按推断写、后被实测推翻**，留痕以免复用错判据）：

1. **EACCES/EPERM/ENOSPC/EIO 不改判 409**。它们不是用户的并发冲突而是宿主环境坏了；说成 409 会让客户端以为重试能成功，并把运维唯一的信号（500 + daemon 日志）抹平。只有 ENOENT/ENOTDIR/EEXIST 是竞态形状（F4 已裁决口径）。
2. **网络竞态风暴不作证明**。`保存 × 删除` 交叉 60 轮在 HEAD 上只有约 1/3 的轮次能观察到窗口（`windowsSeen` 是随机变量），拿它当判别证据就是拿偶然当结论。确定性判别改由**把 `pages/` 换成普通文件**的用例给出：HEAD 3/3 塌成 500，修复后 3/3 落 409 + `errno:EEXIST` + `preemptedBy:plan`、manifest 字节逐字节未动、恢复目录后重试 200 且无 `.tmp` 残骸。SEC-A/SEC-C 同此打法（单条 issue 长度 120031 → ≤200；原型上藏节点 `[]` → `['missing-component']`）。

一条**未修、记为待判**的既存不稳定：`documents.atomicity.test.ts` 的「两个实例并发保存同一页：成功次数必须等于版本前进数」偶发报 `成功 120 笔但版本只前进 121`。计数实况：改动后的树上单独复跑 14 次出 1 次，其后再跑 10 次与 8 次全绿；HEAD 单独跑 6 次全绿；本笔**未触碰该用例的判据**。按协议读，败者在 CAS 之后、发布之前被抢占时可能已把 manifest 写成，重试成功即为第二次前进——「成功数 == 版本前进数」在这种交错下是**过强不变式**，不是产品缺陷。不改判据、不加超时（同一纪律），是否放宽断言留人工决定。

七条待人工（详见 `~/df-evidence/v2-review3/00-scope-and-open-items.md`）：SE-3 路由范围（11 条致命码补齐与否，票 23）、票 21 跨进程真锁、回环 CORS 放行面、票 22 选项 A/B/C（要不要让 daemon 认本机 mock）、浏览器验收归属、REF-01 参照集冻结、以及上一条「成功数 == 版本前进数」断言是否放宽。（原第八条「票 25 现在修 vs 带着红门并」已由人工默认取向收口：**不带红门并**——已修，见下节。）

### 票 25 收口（2026-11-02 · UI 段焦点接回）

- 判据先红后绿：`packages/ui` 新增 6 条，其中 Drawer/Modal 两条接回判据对 HEAD 的 `use-overlay.ts` **实跑判红 2 条**，修复后 `packages/ui` 256/256 绿（可逆验证：`cp` HEAD 版换入再换回，日志 `~/df-evidence/25/`）。
- 工单原文的「置 loading 后断言焦点仍在层内」在 jsdom 30 **恒过**（`unfocusingSteps` 见旧目标不可聚焦即 return，`focusing.js:194`），已换成事件驱动口径；「Esc 关不掉」的真判据在 Chromium：`verify:ai-two-state` 由 **1 → 诚实的 2**，新点亮 `ui.drawer.closes [ok]`，段 B 仍按票 22 显式 SKIP。
- 修在 `useOverlayBehavior`（层内共用），`Button` 未改：异步期间焦点由浮层接管。同族扫描的**层外 11 处**另立票 26，不静默丢弃。
- 全仓复算：`pnpm run verify`（lint + typecheck + `pnpm -r test`）**退出码 0**、`pnpm run test:scripts` 0。
