# test-remediation-v2 · 全仓企业测试审查第二轮修复批（24 票）

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

**按用户价值的开工顺序建议**：17 / 19 / 18（数据不可逆类）→ 02 / 03（AI 主功能与承诺）→ 01 / 04–09 / 13（门禁可信度：假绿与纪律）→ 10–12 / 14 / 15 → 16 收口。
前沿（可立即开工）：01、04–05、07–15、20–22。06 待 05；02 的验收待 04 与装库；16 必须最后。**已收口（第 1 批）**：17（blocker 3 → 票 23）、18、19（conflict 分支 → 票 21）、02、03。票 22 由本批门禁实况单立。

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
