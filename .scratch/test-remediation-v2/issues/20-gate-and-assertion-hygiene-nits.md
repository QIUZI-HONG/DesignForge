# 20: chore · 判据与夹具卫生（Nit 批，逐条独立可弃）

**What to build:** 把本轮判定为 Nit 但确实可修的卫生项一次收口。每条都带坐标与判据，任何一条被驳回不影响其余。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] `packages/ui/src/utils/use-overlay.ts:36` `OVERLAY_Z_BASE = 1200` 由 `packages/ui/src/tokens.ts:236` 的 `z.modal` 派生（现值恰等于 `z.modal`，改令牌即脱钩）。注：`guard:tokens` R3 只查「样式对象里的间距/尺寸族裸数字」，**看不见 z-index** → 若要机检，先扩 R3 词族或新增 R6，并同步守卫模块头与实况表
- [ ] `apps/web/src/features/image/components/ImagePanel.tsx:255,264,273`：清空数字框经 `Number('')` 静默变 `0`，只有 `routes/image.ts:35` 的 `parseImageRunRequest` 区间校验兜住 → 加前端即时反馈（红框 + 文案），别让用户把无效值提交到 daemon 才发现。已否定「NaN 死循环」的说法，不要按那条改
- [ ] `scripts/e2e/scenarios/home.mjs:135` 用 `editorBody.trim().length > 0` 判「进入编辑器」，与 `scripts/e2e-smoke.mjs:37-38` 自述「不再有『body 非空』的假绿」矛盾（SSR 报错页也非空）。改为断言 `canvas[data-df-canvas]` 存在 + `pageerror === 0`，与 D4 段同判据。诚实注记：同 runner 的 D4 段已覆盖真判据，故本条属**判据债/文案背离**，不是活跃放行路径
- [ ] `services/ingest/vitest.config.ts:15` 给 30s 超时的 6× 余量 → 劣化 2–4× 不红；收窄到与性能预算相称的余量并注明依据
- [ ] `packages/contracts/src/image/index.ts:168-253`、`market/index.ts:356-363` 的校验文案是硬编码中文字符串。判据 `implementation-workflow.md:150` 的字面范围是「禁止硬编码中文字面量进**组件**」，contracts 是否受管口径不清 → 请裁决后二选一：纳入 i18n 目录口径，或在文档里显式登记「契约层校验文案不受管」。**不要**在未裁决前按违规改
- [ ] `apps/web/src/features/settings/components/settings-fixtures.tsx`、`diagnostics/test-utils.tsx` 里的中文是夹具数据（非生产界面文案），复核后不动；若被判违规，写清判据边界
