# 17: fix · 粘贴产生的悬空组件引用无校验落盘 → 整份文档不可重开（潜伏）

**What to build:** 写入侧与读取侧的校验强度必须对称——现在是**写不校验、读全校验**，一旦悬空引用进了盘，整份文档就打不开。链路：

- `packages/engine/src/clipboard/clipboard.ts:122-124` 载荷自检**有意**不套用 `missing-component`/`missing-component-set`（注释写明「跨页粘贴靠 `componentRemap` 接手」），`:398` 在没有 remap 时保留原 `componentId`；
- `apps/web/src/features/canvas/state/session.ts:829` `pasteCommands(payload, { pageId, ids })` —— **从不传 `componentRemap`**；
- `apps/web/src/features/canvas/persistence/documents-client.ts:190-196` `encodePageBody` 原样封装落盘，零校验；
- 读回 `documents-client.ts:276` → `packages/engine/src/serialize/serialize.ts:166-172`：`validateDocument` 有**任何** issue 就 `throw`，`packages/engine/src/scene/validate.ts:451-459` 的 `missing-component` 正在其列 → 载入返回「文档结构非法」，用户在 UI 里**再也打不开这份文档**（除手工改 JSON 无恢复路径）。
- 引擎侧 `packages/engine/src/__verify__/clipboard-hierarchy.test.ts:109-128` 反而把悬空引用**钉成期望行为**。

**可达性（独立复核结论，必须照此定级，不许写成「正在丢用户数据」）**：今天**走不到** —— 页面切换 API `setPageId` 全仓只在 `apps/web/src/features/canvas/workspace/workspace-session.ts:206` 以 `firstPageId` 调用一次（无页签切换），且 `session.ts:305` 的 `clipboardPort` 在生产里**没有任何非测试注入点**（系统剪贴板读回路径未接线）。所以这是**潜伏类**：任意未来「页签切换 / 系统剪贴板接线 / 外部载荷导入」一落地即成不可逆锁定。同族的跨父级坐标问题见上一轮票 07（B4），本票只处理**引用完整性**。

**Blocked by:** None (can start immediately)

**Status:** code-complete（Node 门禁全绿；证据 `~/df-evidence/v2b-17/` + `~/df-evidence/v2-merge/`；blocker 3 另立票 23）

blockers:

- [x] 粘贴时若无 `componentRemap`：`settleComponentRefs`（`packages/engine/src/clipboard/clipboard.ts`）三分支——载荷内主组件随复制（id 重映射接手）或显式 `componentRemap` 接手 → 引用有效原样保留；目标页快照里被引用节点在位 → 保留；**都不成立（含无目标页快照）→ 实例降级为普通帧**（几何/样式保留荷原值，`children` 置空、`clipsContent:true`、`autoLayout:null`），悬空引用绝不进页面
- [x] 写入侧对称校验，两层同源引擎口径：web 侧 `documents-client.saveDesignDocument` 动任何写盘之前跑 `validateDocument`，非空 issue 拒绝落盘并回可执行提示（盘上零变化）；daemon 侧新增 `documents/canvas-integrity.ts`，对 `dforge.canvas.page` 信封查引用存在性（与引擎 `validatePage` 同强度），PUT 即 422 `doc_invalid_structure`（issue 文案带 `missing-component` / `missing-component-set` 前缀）。opaque 口径的唯一例外已在模块头与路由头写清理由
- [ ] **未做，另立票 23**：读回侧「能打开」的降级路径。`serialize.ts:164-170` 仍是「有任何 issue 即 throw」——写侧守门只能保证从现在起不再产生，救不了历史保存/手工 JSON/第三方导入的已损形状。本票实施时按「另立后续」处理并留痕（原因见票 23 备注）
- [x] 端到端用例：`apps/web/src/features/canvas/workspace/document-bridge.test.ts` 补真形状竖切片——实例复制到无主组件的另一页 → 降级为帧 → 保存合法（daemon 200）→ 重开不锁死；daemon 侧 `routes/documents.test.ts` 补 422 拒绝落盘与「拒绝后盘上零变化」两条
- [x] `clipboard-hierarchy.test.ts` 的悬空期望改为「降级为帧」，`clipboard.ts` 模块头与载荷自检注释同步改口径（原注释「指向载荷之外的引用保持原值」已失效）

## 完成记录（2026-11-01 · `integration/test-remediation-v2`）

实施者竖切片（分支 `fix/v2b-17-paste-ref-integrity`）：`8b84630` 实例降级 → `1982f3d` 合法路径钉死 → `ed98fae` 组件集引用置 null → `d348fe4` daemon 422（实例）→ `110ceb8` daemon 422（组件集）→ `fae9429` web 写前校验 → `deaa7a8` 端到端；`3d40cd0` 并入集成分支。

**主代理收口两件事（实施者到达回合上限未做完）**：

1. **合并后 `pnpm run lint` 红**：票 17 把带 sha256 的回归基线 `packages/engine/__snapshots__/fixed-document.json` 重冻了。根因不在格式而在夹具：`regression.test.ts` 第 7 步粘贴没传 `page`，走进本票新增的「无目标页快照 → 存在性不可证 → 降级」分支，把 `inst_1000` 从 instance 变成 frame。web 真路径（`session.ts:830`）一直传 `page: page()`。补上后重新生成 + biome 格式化，`git diff main -- __snapshots__/` **为空**——本票对冻结 attestation 的改动归零（提交 `a5549a1`）。
2. **这条正好是票 07 记的机理在现实中发生了一次**：冻结基线可以被一次夹具疏忽带着重冻，而**测试全绿**（sha256 是自算的规范哈希，跟着一起改），最后只有 `lint` 的格式化口径抓到。判据建议（留给票 07）：`UPDATE_SNAPSHOT=1` 路径应额外断言「新哈希必须等于文件内已提交哈希，除非同时给出人工签署的变更说明」。

门禁实况（合并并修正后的树 `a5549a1`，日志 `~/df-evidence/v2-merge/gates/17–24`）：`pnpm -r test` 9 包全绿（daemon 19 文件 / 179 用例，engine 26 / 377）、`lint` 0、`typecheck` 0、`test:scripts` 0（93/93）、`verify:daemon` 0（42/42）、`verify:engine` 0、`verify:mcp-stub` 0、`guard:tokens/vocab/feature-boundaries` 0。

**未过与原因**（都不是本票引入，逐条见 `~/df-evidence/v2-merge/evidence.md`）：`verify:ai-two-state` 1（态 B 被 AI baseUrl 白名单挡死 → 已立票 22；UI 段缺 `libnspr4` 等库）、`verify:canvas` 1（Chromium 起不来）、`verify:image-two-state` 2（8 步 0 失败但 UI 挂载段未执行，按「2 = 阻塞」上报，另注：它在 `/tmp` 保留现场，违「禁用 /tmp」，属票 05 面）、`verify:market` 2（需常驻 daemon 4318）、`verify:shell-parity` 2（Electron 二进制缺失 + 参照集未冻结）、`verify:motion` 2 与 `guard:deps/channel-pairing/mcp-contract` 2（脚本自陈未实现）。

**本票不能证明**：真浏览器里的粘贴—保存—重开闭环（缺库，待人工）；跨文档（不同 `.dfg`）粘贴的组件集引用语义——`settleComponentRefs` 的「无页快照即降级」分支只由单元测试覆盖。

## 基线核对（2026-11-01 · 集成分支 integration/test-remediation-v2 @ 3f3603c）

工单正文行号取自 main@a838281，已过期。新基线上的实况坐标、上一轮已做掉的部分、剩余缺口与判据修正：
`~/df-evidence/test-remediation-v2/notes/baseline-audit.md` 同名小节（开工前必读）。

## 二轮复核补记（2026-11-01 · 分支 `fix/v2r-c-ref-integrity`）

票 17 写侧门落地后，二轮实跑暴露三条后续，均已在本轮收口（证据 `~/df-evidence/v2r-c/`）：

1. **CL-1 · 删除路径不留悬空引用**（`2520478`）：本票只做了**粘贴**侧，**删除**主组件仍是裸 `node.remove`（`packages/engine/src/commands/helpers.ts:40-47` → `commands/apply.ts:96-116` → `scene/mutate.ts:145-163` 不扫实例），留下的悬空引用被本票新加的**整份级**写侧门拒绝——实测连干净的 p2 也存不了。定级说明：这不是回归（改之前删得下去但重开永久锁定＝票 23 主题；改之后盘不动、撤销可逆），剩余工作就是**不再产生悬空引用**。`deleteNodesCommands` 现按 `clipboard.settleComponentRefs` 同一条口径收口依赖者（实例降级为普通帧、悬空组件集引用置 null），并与删除本身**合成同一条事务**（一次撤销同时复原），用既有命令表达（`node.remove` + 同 id 回插 / `node.restore`），不新增命令类型。覆盖面缺口同步补：`invariants.test.ts` 的操作脚本原先从不删 `c1`，现含删主组件与删组件集两笔意图级事务。回归缝：`packages/engine/src/commands/delete-settle.test.ts`（新）。
2. **H1 · 写侧拒绝文案可行动**（`96a2f04`）：`documents-client` 的拒绝文案旧版只有 `code:message` 串，用户看不出是哪一页哪一层、也看不出撤销可解。现文案含问题码 + 落点（页名/页 id/节点 id）+「未写盘 · 撤销后重试」，走 i18n（zh-CN / en 各 5 个 `editor.save.*` key，成对）。
3. **SE-1 / SE-3 · daemon 守门的强度与说实话**（`f73b07f`）：SE-1 是缺陷（恶意节点形状令守门 `String()` 抛 `TypeError` → 500 且回显内部信息；现非字符串 id 一律带类型拒绝，签名 `string[] | null` 不变）；SE-3 的范围口径（只镜像 2 码、其余 11 类对直连写入者不设防、`$format` 绕过不产生锁定）已改写为实测一致，现状由 `apps/daemon/src/documents/canvas-integrity.test.ts` 钉住，**要不要补齐 13 码留作票 23 的「待人工决定 1」**，本轮不代答。

另立 **票 24**（`issues/24-cross-document-paste-provenance.md`）：跨文档粘贴 id 相撞会静默重绑到无关组件（CL-2，既有缺陷、非本 diff 引入）——本票 `settleComponentRefs` 证明的是**存在性**而非**同一性**，不在本票范围内扩判据。

