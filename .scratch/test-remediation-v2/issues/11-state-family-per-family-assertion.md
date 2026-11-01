# 11: fix · 状态族测试按「逐族完整」判，不以并集冒充

**What to build:** `packages/ui/src/state-families.test.ts:47-49` 把各族 `states` 拍成一个 `Set` 再比 `INTERACTION_STATES` —— **只要任一族覆盖某态即通过**；而它的标题与注释写的是「六态被各族完整覆盖（验收标准 §5 缺项即缺陷）」。实证：`packages/ui/src/state-families.ts:66-70` 的 F3 只登记 4/6 态（缺 `loading`、`focus`）而全绿。与上一轮 F2（`.sort()` 抹掉顺序断言）同类：**用例名承诺 > 断言实际**。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] 二选一并落到文字：(a) 断言逐族 `states` 齐备（与族内组件真实支持态一致）；(b) 判据本就是并集口径 → 改测试标题/注释 + 改验收标准 §5 表述。禁止继续背离
- [ ] 若取 (a)：F3 等欠登记族逐族补齐或在表里显式登记「本族不适用 X 态」并给出原因（不适用 ≠ 缺失）
- [ ] 新增一条「登记表与实现脱节」判据：族内声明的每个态都能在该组件的可访问性/样式产物上取到证据（现仅断言组件名可从包入口解析）
- [ ] `pnpm --filter @dforge/ui test` 全绿；不动 `guard:*` 判据
