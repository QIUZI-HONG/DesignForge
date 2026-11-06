# 优化仓库计划（OPTIMIZATION_PLAN）— RFC v1 · 2026-11-06

> **状态：已收官（2026-11-07）。10/10 批全部合入 main，逐批复验与验收记录见 docs/audit/PR_BATCH_1~10.md；已知偏离与挂点（verify:perf CI 挂点、浏览器级门禁）登记于 PR_BATCH_7/10。**
> 依据：`BASELINE.md` · `TEST_PLAN.md` · `TEST_REPORT.md` · `E2E_REPORT.md` · `DEFECTS.md`（D-xx 编号沿用）。
> 施工纪律：一票一树（`/home/QIU/df-wt/<票号>`）· 中文 Conventional Commits · 每批过全量门禁 + 钩子 · 证据落 `~/df-evidence/<票号>/` · 每批输出 `PR_BATCH_*.md`。

## 1. 现状与问题

门禁常规链全绿（3372+128 例 0 失败）、覆盖率行覆盖 8 包全 ≥80%、无假绿；但浏览器门禁实跑揭出 **3 个 P1**（canvas 持久化往返断裂、daemon 本地特权面、/editor 导入未接线）、9 个 P2（保存无超时、静默丢更新、ingest 整批炸、bodyLimit、门禁脚本缺陷组、i18n 落差、覆盖率基建、依赖）与 5 个 P3 卫生项。flaky 率 0%，工程底子好——问题集中在「夹具页与主链路分叉」「本地安全取舍过时」「门禁等待信号错误」三类。

## 2. 目标

1. P0/P1 清零：verify-canvas 与 e2e:smoke 转绿（D-01）、/editor 导入可用（D-03）、D-02 本地访问面收敛到「沙箱 iframe 不可读」。
2. 健壮性：保存有超时可恢复、ingest 损坏输入不整批炸、大文档不被 1MB 上限拒绝。
3. 质量基建常设化：coverage 入 CI、分支覆盖关键路径 ≥90%、perf 真基线（provisional:false）。
4. 依赖 0 high（dev 面含）+ 0 critical（prod 已达标）；卫生项清零。

## 3. 非目标

- 不升大版本依赖（electron 45、next 17 不动）；不改公共 API 形状（`{ok,result,error}` 信封保持）；不做 UI 改版；不引入新测试框架；不动 `~/.dforge` 真实数据。

## 4. 批次拆分（10 批，按「P1 → 测试 → 性能/依赖/重构」排序）

| 批 | 主题（PR） | 改动文件/模块 | 测试计划（红转绿或绿保绿） | 风险 | 回滚 | 工时 |
|---|---|---|---|---|---|---|
| 1 | **D-01 canvas 持久化往返**：夹具页 id 对齐 daemon 缺省 + documentId 投影延后至内容落盘 | `canvas-studio.tsx`(页id、保存时序) · `document-bridge.ts` · 门禁 `verify-canvas.mjs`(等 saved 信号+空守卫) · `scripts/e2e/scenarios/canvas.mjs` | verify-canvas→exit 0（红转绿）· e2e:smoke→exit 0 · pnpm test 全绿 · **旧文档兼容读**（已存 page_1 文档）回归 | 页 id 语义变更波及已存档 → 需 loadPageSet 兼容旧页 id（批内含） | revert 单 PR | 1d |
| 2 | **D-02 本地访问控制收敛**（⚠️ 方向需你确认，见 §6-Q1）：`Origin:null` 白名单化 + 写路径本地令牌（daemon 首启生成，壳经启动参数注入） | `apps/daemon/src/cors.ts` · `app.ts` · `apps/desktop` 装载参数 · 新增对抗单测 | h1-probe 复跑：P2（null 全读）与 P4（跨源写）必须转败 · cors 单测 · desktop 静态守卫 · e2e 全绿（确认合法链路不破） | file:// 壳兼容性；与 ADR-0004 取舍相关 | revert；临时可关令牌开关（env） | 1-2d |
| 3 | **D-03 /editor 导入接线**：复用 /_canvas 的 importIr 路径 | editor 接线处（canvas-debug.ts:165 兜底替换） | E2E J5 红转绿 · e2e:smoke editor 场景保绿 | 低 | revert | 0.5d |
| 4 | **D-04+D-10 保存超时与文案**：fetch AbortSignal（复用 gateway-timeout 模式）+ 失败文案统一 `editor.save.failed.network` 形态 + 8 处硬编码文案入 i18n | `documents-client.ts` · `daemon-client.ts` · `i18n/` · HomeView 等 8 文件 | J9 红转绿（挂 30s → 超时+可重试）· J7 文案断言 · guard:vocab · pnpm test | 低（超时阈值需给足，避免慢盘误伤） | revert | 1d |
| 5 | **D-06+D-07+D-08 数据面容错**：坏 JSON 格降级、坏行跳过、bodyLimit 上调可配置 | `transform/dwd/store.ts` · `collect/client.ts` · `apps/daemon/src/app.ts` | **恢复审计红测**（~/df-evidence/audit-2026-11/quality/ 两份 .test.ts）转绿 · daemon 413 用例 · ingest 全测 | 低 | revert | 1d |
| 6 | **D-05 保存冲突检测**（⚠️ 设计决策见 §6-Q2）：revision/If-Match → 409 + 前端「文档已被另一窗口修改」提示 | daemon documents 路由 + contracts + 前端保存链 | J8 双页场景红转绿（后写收到 409 而非静默覆盖）· daemon 409 既有单测保绿 | 中（协议变更，保持向后兼容：无版本头走旧行为） | revert | 2d |
| 7 | **D-09 门禁可信度**：verify-perf 改 `addInitScript` · DF_WEB_URL 回收仅限自起子进程 · canvas 红转绿后**重采 perf 基线**（写入 `docs/quality/perf-baseline-v1.json`，provisional:false） | `scripts/verify-perf.mjs` · 3 个 persist 门禁 release() · perf-baseline-v1.json | verify:perf → exit 0/1 正式判定（阻塞解除）· persist 门禁复用站点模式复跑 | 低 | revert | 0.5d |
| 8 | **D-11 覆盖率常设化+补测**：coverage 配置入仓 + CI 报数步骤 + daemon/cli 关键分支补测（路由错误分支、命令参数分支） | 各包 vitest.config · `ci.yml` · daemon/cli 新 test 文件 | 核心行覆盖保持 ≥80% · daemon/cli 关键分支 ≥90% · pnpm verify 全绿 | 低 | revert | 1.5d |
| 9 | **D-12 依赖补丁批**：fastify 5.12.8 / next 16.4.5 / electron 44.9.1 + fast-uri overrides | `pnpm-workspace.yaml` catalog · lockfile | pnpm verify · pnpm audit 复跑（prod 0 moderate/low 目标，dev 0 high）· e2e:smoke 保绿 | 低（全为补丁版本） | `git revert` + lockfile 还原 | 0.5d |
| 10 | **D-13~D-17 卫生批**：useDocumentSnapshot 去重为单源 · `.gitignore` 补 `.scratch/` · Q11 `'use client'` 补齐或撤销 · biome-ignore 10 条复核登记 · （用户侧）轮换 VERCEL token、清理 4318 旧测试文档 | ui/web 相应文件 · `.gitignore` | pnpm verify · guard:vocab · 重复文件消失断言（grep） | 低 | revert | 1d |

**依赖顺序**：批1 → 批7（canvas 红转绿是 perf 真链路前提）；批5 → 批7（bodyLimit 是 @5k 采集前提）；批2 独立可并行；批6 建议在批4 后；其余独立。
**总工时**：约 10 人日（含每批门禁与证据）。

## 5. 验收标准（对照总目标）

- P0/P1 清零：verify-canvas=e2e:smoke=exit 0 · J5/J9/J1-J10 全过（10/10）· h1 探针 P2/P4 转败。
- 覆盖率：核心行 ≥80%（已达标保持）· daemon/cli 关键分支 ≥90%。
- E2E 关键路径通过率 100% · flaky <2%（现 0%，保持）。
- 安全/依赖：prod 0 high/critical · dev 0 high · 跟踪文件 0 密钥（保持）。
- 性能：perf-baseline-v1.json provisional:false，优化后无 >10% 回退（基线对比）。
- CI：ci.yml 每批全绿可重复。

## 6. 需要你确认的决策点

- **Q1（批2）**：本地访问控制收敛方向——A. 壳启动注入一次性令牌 + `Origin:null` 白名单化（推荐，收口沙箱 iframe 全读）；B. 仅对写路径（POST/PUT/DELETE）加令牌、读路径维持现状（改动最小）。两案都不改 ADR-0004 的「本地优先」定位。
- **Q2（批6）**：并发冲突语义——A. 409 拒绝+手动刷新（简单可靠，推荐）；B. 自动合并（复杂度高，不建议本期做）。
- **Q3（批9）**：electron 44.7.2 → 44.9.1 为补丁内升级（修 dev 面 1 high），是否认可「补丁版本不属大版本升级」。

## 7. 假设与声明

- 全部结论可复现：命令与证据路径在各报告内；无伪造（红即红、阻塞即阻塞）。
- 批1 的「旧文档兼容」以仓内现有 .dfg 样本验证；若发现更早版本档式差异，该批扩为两段提交并在 PR_BATCH_1 说明。
- 阶段5 每批开始前将重述：批次目标、改动范围、测试命令、回滚方式；每批结束附 PR_BATCH_*.md。
