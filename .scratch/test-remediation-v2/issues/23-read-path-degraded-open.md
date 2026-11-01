# 23: follow-up · 读回侧要有「能打开」的降级路径（票 17 blocker 3 未做）

**What to build:** 结构非法不等于文档死刑。票 17 把写侧补齐了（粘贴不留悬空引用、web 保存前 `validateDocument`、daemon 对 `dforge.canvas.page` 信封做引用完整性守门 422），但**读侧仍是全有或全无**：`packages/engine/src/serialize/serialize.ts:164-170` 只要 `validateDocument` 有**任何** issue 就 `throw domainError('invalid-argument', ...)`，`apps/web/src/features/canvas/persistence/documents-client.ts` 的读回路径直接失败 → UI 里这份文档**打不开**。

写侧守门只能保证「从现在起不再产生」，不能救**已经躺在盘上的**：票 17 之前的历史保存、手工改过的 JSON、第三方导入、以及票 19 之前 create/保存失败留下的形状。这类文档今天没有任何恢复路径，只能手改 JSON。

**Blocked by:** 票 17（已完成，写侧口径是本票的前提）

**Status:** ready-for-agent

blockers:

- [ ] 定「降级读」的产品语义并写进工单（这条是**人类决策**，不由实现者代答）：只读打开 / 可编辑但标红问题节点 / 提供「一键剥离非法引用后打开」——三者数据后果不同（只读不损数据；剥离即改数据，必须可撤销且不静默覆盖盘上原文件）
- [ ] 按选定语义实现读侧分支：`deserializeDocument` 不再对全部 issue 一视同仁——把 issue 分成「可降级」（悬空引用、未知键）与「不可读」（形状/深度非法）两级，前者产出带标记的文档 + 结构化告警（沿用契约错误码口径，不新造字符串错误）
- [ ] 端到端用例（真形状，不用 `app.inject` 绕开）：手工写一份含悬空 `componentId` 的 `.dfg` 到临时工作目录 → 打开 → 断言「文档可见 + 告警可见 + 原盘上文件未被降级读改写」；再断言「保存一次之后盘上形状按选定语义收敛」
- [ ] 与票 19 的口径衔接：降级读不得把「已修复的形状」当作成功保存偷偷落盘（票 19 刚把「失败即盘上没变」做成构造性保证）

## 备注

票 17 的 `blocker 3` 原文即本票，实施时按「另立后续」处理（原因：本票需要先裁决产品语义，且改动面横跨 engine/contracts/web 三层，与票 17 的引用完整性修复不在同一竖切片）。票 17 的完成记录与本票互指。

## 待人工决定 1（2026-11-01 · 二轮复核 SE-3）：daemon 写侧守门要不要补齐到 13 码

**事实（二轮实跑，非推断）**：`apps/daemon/src/documents/canvas-integrity.ts` 只镜像引擎 `validatePage` 13 个页面级致命码里的 **2 个**（`missing-component` / `missing-component-set`）。形状正当、只带 `orphan-node` / `cycle` / `missing-child` / `multiple-parents` / `missing-field` / `non-finite-number`（`1e400`）/ `missing-root` 的正文，PUT 一律 **200 落盘**，随后 web 读回硬失败（引擎读侧拒载）。web 客户端自己造不出这些形状（`documents-client.ts` 写前 `validateDocument` 全校验），**直连 HTTP / MCP / CLI 全都造得出**——所以「写读对称」目前只对引用两条码成立。

**`$format` 绕过（同一实跑）**：不带 / 大小写不同 / 版本号不同 / `$format` 非字符串的四种正文都能 200 落盘，但**没有换来引用完整性锁定**：web 读回侧先以「正文不是设界画布格式」拒（`documents-client.ts:236`、`:350-360`），走不到 `packages/engine/src/serialize/serialize.ts:164-170`，文档仍可正常打开——只是这一页在编辑器里不可用。

**本轮已做（不属于扩大覆盖面）**：把 `canvas-integrity.ts` 文件头「同源同强度 / 强度对称」的自述改成与实测一致的口径，并用 `apps/daemon/src/documents/canvas-integrity.test.ts`（32 例）钉住现状边界——9 类范围外形状明确断言放行、非信封正文返回 null 的 opaque 口径、恶意 id 形状不抛（SE-1：命中 2 码时 `String()` 曾抛 `TypeError` → 500 并回显内部信息，现已改为带类型拒绝）、以及路由层「其余致命码当前 200 落盘」。**将来谁要扩到 13 码，必须显式改这些用例**，不会静默漂移。

**要人类裁决的三选一（实现者不代答）**：

- [ ] **A. 补齐 13 码**：daemon 变成「半个引擎」，正文语义解析进本地服务。代价——`canvas-integrity.ts` 要与引擎保持逐条同步（两份实现必然漂移，本票的「同源」承诺才真正成立）；且 daemon 的 opaque JSON 口径（第三方正文/导入格式）需要重新划界。
- [ ] **B. 只补「读回会永久锁死」的那几码**（`cycle` / `orphan-node` / `missing-root` / `missing-child` / `multiple-parents` / `non-finite-number` / `max-depth-exceeded`），其余交给读侧降级（本票 blocker 1/2）。代价——判据是「锁死与否」，与本票的降级语义耦合，建议与本票 blocker 1 一起裁决。
- [ ] **C. 维持现状**：把「daemon 只守 2 码、其余由读侧降级兜」定成正式口径。代价——本票（读侧降级）从「可另立后续」升级为**硬前提**，在降级路径落地前，直连写入者仍可一次写坏整份文档。

`checkCanvasPageIntegrity`/`canvasPageReferenceIssues` 的返回形状是 `string[] | null`（`store.ts:546` 按它 `join('；')` 拼 422 message），任何扩范围的实施都**不得改签名**，否则连带改 store。
