# 01: fix · 参照/目标集为空时浏览器对照门禁判「通过」

**What to build:** 六个 figma 对照门禁在**一个取样都没拿到**时一律 `exit 2` 并点名原因，绝不出现「零比较 + exit 0」。现状：`scripts/verify-figma-component.mjs:197-200` 的 `ids` 取自页面 DOM（`page.$$eval('[data-df-preview]')`），`:216` 循环、`:283` `failures === 0 ? 0 : 1` → DOM 少一个 `data-df-preview` 就 0 比较、判通过；`--only` 拼错退化成空集的同族四处（`verify-figma-home.mjs:323`、`verify-figma-editor.mjs:266`、`verify-figma-panels.mjs:349`、`verify-figma-review.mjs:526`）与 component `:200` 都没有空集判据——正确写法已存在于同族两处（`verify-figma-inspect.mjs:530-537`、`verify-figma-inspector.mjs:282-285`），本票是**把已有判据铺开**，不是新发明。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] 取样集/目标集构造抽成共用函数，六门禁同一入口，空集一律 `blocked('取样为零：…')` → exit 2
- [ ] `--only=<不存在的 id>` 在 home/editor/panels/review/component 五处均 exit 2 且列出可用 id（当前只有 inspect/inspector 会）
- [ ] 证据 JSON 落 `comparedUnits` 计数，门禁在 `comparedUnits === 0` 时不得写 `verdict: pass`
- [ ] 反例夹具入 `scripts/tests/`（空 DOM / 错 `--only` 两形态），`pnpm test:scripts` 覆盖检出强度
- [ ] 不得改动 `total === 0 ? 0` 之外的像素判据口径（复核已证该分支是死分支，动它属范围外）
