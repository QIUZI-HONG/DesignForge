# PR_BATCH_1 — D-01 canvas 持久化往返修复（audit-d01）

- **分支**：`fix/canvas-persist-roundtrip`（工作树 `/home/QIU/df-wt/audit-d01`）→ **已合并 main**（merge `a820bb2`，合并后 main 全门禁复验通过）
- **依据**：`docs/audit/DEFECTS.md` D-01 · 根因报告 `~/df-evidence/audit-2026-11/gate-browser/`（5 Whys 链）
- **工单偏差**：本机无 gh CLI → GitHub issue 未建，本文件即工单与验收记录

## 变更说明

| 文件 | 变更 |
|---|---|
| `apps/web/src/features/canvas/studio/canvas-studio.tsx` | 夹具页 id `'page_1'` 硬编码 → contracts `DEFAULT_PAGE_ID`（缺陷A）；新增保存态读点 `data-df-save-state` |
| `apps/web/src/features/canvas/workspace/document-bridge.ts` | documentId 投影/URL 同步延后至内容保存成功（缺陷B）；失败路径身份不外泄 |
| `apps/web/src/features/canvas/persistence/page-set.ts` | 旧文档兼容：空占位页沉底（有内容页优先），页 id 校验不动 |
| `page-set.test.ts` / `document-bridge.test.ts` | 新增 4 例：兼容载入 ×2、保存时序 ×2 |
| `scripts/verify-canvas.mjs` | A6 改等 `[data-df-save-state="saved"]`；runWiring 空守卫（消除 undefined.indexOf 掩因崩溃） |
| `scripts/e2e/scenarios/canvas.mjs` | 同改等待信号，超时带状态取证 |
| `packages/ui/src/utils/use-draft-commit.ts` | 计划外前置修复：补 `'use client'`（无它站点编译 500，与主仓未提交热修逐字节一致，已按提交收编——D-16 就此销号） |

## 测试结果（证据 `~/df-evidence/audit-d01/`）

| 命令 | 结果 | 轮次 |
|---|---|---|
| `pnpm verify`（工作树 + 合并后 main 各一轮） | **exit 0** ×2（web 1699 例等全绿） | 2 |
| `node scripts/verify-canvas.mjs` | **exit 2**（REF-01 参照集未冻结，三态语义=阻塞非违规）；**exit 1 违规已消除**：7 挂载断言（含 A6）+15 接线断言两轮零失败 | 2 |
| `node scripts/e2e-smoke.mjs` | **exit 0** ×2（canvas 场景「持久化往返完成」全步 pass） | 2 |
| 磁盘铁证 | 修复前 manifest `[page-1,page_1]` 双 `{}` → 修复后**单页 `page-1` 含 2 节点** | — |

## 性能对比

不适用（功能正确性修复；`pnpm verify` 耗时 31s 与基线持平）。

## 风险

- 页 id 语义变更对**已存档**的兼容由 loadPageSet 兜底（存量 `page_1` 内容页不迁移不删除，当前页=内容页）；两条兼容单测锁定。
- 保存时序变更被 document-bridge 两例时序单测锁定；URL 同步仍仅首存一次，无行为外溢。

## 回滚

`git revert -m 1 a820bb2`（单 merge revert 即整体回退；批次内 3 个 commit 无独立部署语义）。

## 遗留

- verify-canvas 的 exit 0 需 REF-01 参照集冻结后自然达成（伪造参照集=假绿，纪律禁止）。
- 推送策略偏差：本批未 push（终批统一 push 并读 CI——本机无 gh，推送后 CI 结果经仓库网页核验）。
