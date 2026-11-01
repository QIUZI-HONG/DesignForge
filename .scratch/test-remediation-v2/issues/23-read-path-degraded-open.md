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
