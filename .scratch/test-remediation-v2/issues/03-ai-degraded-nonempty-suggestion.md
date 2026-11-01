# 03: feat · AI 降级态必须产出非空本地建议（复活 ux-audit 票 03）

**What to build:** 未配置 DeepSeek key 时，AI 面板提交后拿到的是**真内容**（本地建议清单），而不是一片空白。现状：`apps/daemon/src/ai/client.ts:90` `content: options.partialContent ?? ''` 无 key 即空串；规格判据在 `ux-audit` spec P0-2 / 报告 M-04「降级不假绿」，承接它的 `.scratch/ux-audit-remediation/issues/03`（本地建议生成器）**从未开工**。三重门禁全放行：`apps/daemon/src/routes/ai.adversarial.test.ts:287-301` 只断降级信封的键存在、不 assert `content` 非空；`scripts/verify-ai-two-state.mjs:231-234` 只断 `degradedHint` 文案出现。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] 降级路径产出非空本地建议（模板/启发式，来源与局限在 UI 里说清，不得伪装成模型输出）
- [ ] adversarial 用例把判据从「键存在」升级为 `content.trim().length > 0` + 建议条数下限
- [ ] `verify-ai-two-state` 无 key 段断言**渲染后正文非空**（不止降级提示）
- [ ] 有 key 段仍守 BYOK 哨兵不泄漏（沿用现判据，不得削弱）

## 基线核对（2026-11-01 · 集成分支 integration/test-remediation-v2 @ 3f3603c）

工单正文行号取自 main@a838281，已过期。新基线上的实况坐标、上一轮已做掉的部分、剩余缺口与判据修正：
`~/df-evidence/test-remediation-v2/notes/baseline-audit.md` 同名小节（开工前必读）。
