# 03: feat · AI 降级态必须产出非空本地建议（复活 ux-audit 票 03）

**What to build:** 未配置 DeepSeek key 时，AI 面板提交后拿到的是**真内容**（本地建议清单），而不是一片空白。现状：`apps/daemon/src/ai/client.ts:90` `content: options.partialContent ?? ''` 无 key 即空串；规格判据在 `ux-audit` spec P0-2 / 报告 M-04「降级不假绿」，承接它的 `.scratch/ux-audit-remediation/issues/03`（本地建议生成器）**从未开工**。三重门禁全放行：`apps/daemon/src/routes/ai.adversarial.test.ts:287-301` 只断降级信封的键存在、不 assert `content` 非空；`scripts/verify-ai-two-state.mjs:231-234` 只断 `degradedHint` 文案出现。

**Blocked by:** None (can start immediately)

**Status:** code-complete（断言加固 S1/S2/S3 落码；证据 `~/df-evidence/v2b-03/`；UI 段真浏览器未实跑、态 B 受基线白名单冲突阻塞——见完成记录 deferred）

## 基线核对（2026-11-01 · 集成分支 integration/test-remediation-v2 @ 3f3603c）

工单正文行号取自 main@a838281，已过期。新基线上的实况坐标、上一轮已做掉的部分、剩余缺口与判据修正：
`~/df-evidence/test-remediation-v2/notes/baseline-audit.md` 同名小节（开工前必读）。

blockers:

- [x] 降级路径产出非空本地建议（模板/启发式，来源与局限在 UI 里说清，不得伪装成模型输出）
      —— **改判后勾选**：该能力已在基线内实现（`apps/daemon/src/ai/client.ts:37-75` `suggestionsFor` 对全部 5 个
      降级原因各产出 1–2 条建议；UI 侧 `AiDrawer.tsx:61-97/199-213` 渲染清单+「本地模板」角标与来源说明）。
      本票未二实现，只把两侧行为用断言钉死（S1/S3，变异可判红）。
- [x] adversarial 用例把判据从「键存在」升级为 `content.trim().length > 0` + 建议条数下限
      —— **判据经改判修正**：`content.trim().length > 0` 是**错误判据**（降级 content 为空是设计，见下方完成记录），
      按原判据会把正确实现判红。实际落地为：逐字段（statusCode/ok/finishReason=degraded/usage=null/content=''/runId 形状）
      + 建议条数下限 + kind 合法枚举 + no-credentials 必含 configure-credentials + 无 key 明文 + 流式↔一次性同构。
- [x] `verify-ai-two-state` 无 key 段断言**渲染后正文非空**（不止降级提示）
      —— **判据经改判修正**：改断「渲染后**建议清单**可见 ≥1 条 + 结果区非空白且如实标注本地模板」。
      态 A 数据面已实跑全过；UI 段脚本判定已落码但本机 Chromium 缺 libnspr4 **未实跑**——渲染层判据由
      S3 组件真渲染（jsdom）+ 变异验证旁证，真浏览器实跑挂**待人工**。
- [x] 有 key 段仍守 BYOK 哨兵不泄漏（沿用现判据，不得削弱）
      —— 态 B 判据原样未动（`B.credentials.masked`/`B.no-leak`/`B.upstream.authorization`）。**如实记录**：
      态 B 在本基线上整体判红——`PUT /config ai.baseUrl→本机 mock` 被 DeepSeek 官方域白名单
      （f3c9c08，票 02·§A5c 引入）400 拒绝，属基线既有冲突，本票未修（见 deferred）。

## 完成记录（2026-11-02 · fix/v2b-03-ai-degraded-assertions）

**改判复核结论：成立。** 上一轮审查报告的前提「降级态是空白 AI 面板」在新基线（fe1adba）上不成立：
① daemon 侧 `client.ts:37-75` `suggestionsFor` 对 no-credentials/rate-limited/timeout/invalid-response/
upstream-error 全部产出 1–2 条本地建议，`:90` `content: partialContent ?? ''` 虽成立，但空正文是
**同构信封设计**而非缺陷；② web 侧 `AiDrawer.tsx` 不空白——`:199-205` content 空且 done+degraded 时
显示 `ai.badge.localTemplate.desc`（「本地模板」角标 title 同文案，来源如实、未冒充模型输出），
`:207-213` done 时挂载建议清单（configure→去配置 / retry-later→重试按钮）。
原判据（blocker 2 的 `content.trim().length > 0`）会把上述**正确实现判红**——本票按改判口径做
「断言加固」，未新增功能。工单正文的坐标勘误同步确认：`routes/ai.adversarial.test.ts` 不存在，
降级键级断言实际在 `apps/daemon/src/adversarial.test.ts:287-301`。

**本轮实际改动（三切片，全部为断言/门禁强度；当前实现上即绿=回归护栏，非缺陷复现）：**
- S1 `apps/daemon/src/adversarial.test.ts`：无 key 降级段逐字段判据 + 建议语义（条数下限/kind 枚举/
  可操作出口/无 key 片段）+ 新增 SSE done 帧与一次性键集同构判据。变异验证：finishReason 伪装 stop、
  建议清空、usage 伪造——三组各自判红（`s1-mutation-falsifiability.log`）。
- S2 `scripts/verify-ai-two-state.mjs`：态 A 从「子串在场」改为解析 done 帧逐字段审计（原判据对
  `"suggestions":[]` 假绿）；UI 段在降级提示后真提交一轮：角标+`ul[aria-label=建议动作]` 计数 ≥1+
  结果区非空白。三态退出码复核：断言失败→1、启动/UI 阻塞→2、违规优先于阻塞，无 0 混放路径。
- S3 `apps/web/src/features/ai/{test-utils.tsx,components/AiDrawer.test.tsx}`：降级态用户可见结果判据
  （角标 title、结果区 done 且非空白、`.dfg-ai__content` 不出现=不显示假成功、role=list 名称「建议动作」、
  「去配置 key」点击真触达回调）+ rate-limited 新用例。变异验证：删说明段/摘除清单/去角标——各自判红
  （`s3-mutation-falsifiability-round3.log`、`s3-…-round1.log` 变异 C）。`degradedResponse` 工厂扩到
  5 个降级原因（期望值独立誊写自契约语义，不 import daemon 实现）。

**门禁实况（收口后，证据 `~/df-evidence/v2b-03/`）：**
| 检查 | 命令 | 退出码 | 结果 |
|------|------|--------|------|
| S1 | `pnpm --filter @dforge/daemon exec vitest run src/adversarial.test.ts` | 0 | 11/11 绿（合并前后各一跑） |
| S3 | `pnpm --filter @dforge/web exec vitest run src/features/ai` | 0 | 26/26 绿（合并前后各一跑） |
| S2 门禁 | `NODE_OPTIONS=--experimental-strip-types… pnpm run verify:ai-two-state` | **1** | 态 A 5 项新判据全过；UI 段**阻塞**（Chromium 缺 libnspr4，既有环境问题）；态 B 4 红=基线既有白名单冲突（非本票引入，合并前基线同红） |
| 全仓 lint | `pnpm run lint` | 1 | 红点均在非本票文件（services/ingest 43a70a9、tools/cli 15f11f6 于基点已红；documents.atomicity.test.ts 来自合并的票 19）；本票 3 文件 `biome check` 干净，web 包整包 lint 绿 |
| 全仓 typecheck | `pnpm run typecheck` | 0 | 全绿 |
| 全仓 test | `pnpm -r test` | 0 | 9 包全绿 |

**Deferred / 未做（如实）：**
1. UI 段真浏览器实跑：本机 Chromium 缺系统库（libnspr4）、sudo 需交互认证 → 待人工环境。
2. 态 B mock 上游通道与 ai.baseUrl 官方域白名单的冲突修复：需 daemon 侧测试注入口（app/main/config 面），
   越出本票文件所有权与「断言加固」范围 → 建议另票。
3. **发现的产品面缺口**：done-degraded 态下建议「稍后重试」按钮点击无动作——`use-ai-run.ts:109` 与
   `steps.ts:126` `retryAiRun` 均只对 failed 态生效。S3 特意不钉「点击是否重新发起」以免焊死现状；
   接通属功能面 → 建议后续票。
4. 基线笔记要求的 `.scratch/ux-audit-remediation/issues/03` 状态对齐：该目录在当前基线树不存在
   （仅存在于旧快照 main@a838281），无法改其状态行 → 对齐留痕合并记录于本文件。

**本票不能证明的**：真浏览器下抽屉渲染（UI 段未实跑）；态 B「有 key 真流式」端到端（被基线冲突阻塞）；
建议文案的语言质量（只断结构与语义出口，不断措辞）。
