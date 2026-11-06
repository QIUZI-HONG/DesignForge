# PR_BATCH_3 — D-03 /editor 导入 IR 接线（audit-d03）

- **分支**：`fix/editor-import-wiring`（工作树 `/home/QIU/df-wt/audit-d03`）→ **已合并 main**（merge 后 main 复验 `pnpm verify`=0 · `e2e-smoke`=0）
- **依据**：`docs/audit/DEFECTS.md` D-03 · E2E J5 三轮实证（`{"ok":false,"error":"未接入导入"}`）

## 变更说明（7 文件，+313/−21）

| 文件 | 变更 |
|---|---|
| `apps/web/src/features/canvas/workspace/import-ir.ts`（新增） | 共享单点：解析 IR → `bridge.adoptLocal` → `{ok,error}` 信封（两页同一实现，无跨 feature 深导入） |
| `canvas-studio.tsx` | 改调共享实现（行为不变） |
| `workspace/slots.tsx` | **接线修复本体**：CanvasSlot 挂 `sessionDebugHandle` 时传入 `extras.importIr`（此前缺传 → 兜底桩「未接入导入」） |
| `i18n zh-CN`（+en 兜底） | `editor.import.imported`＝「已导入 IR（{nodes} 个节点）」· `editor.import.failed`＝「导入失败：{message}」 |
| `import-ir.test.ts`（新增） | 8 例：合法 IR 灌 store/落盘身份清空/往返幂等/坏 JSON/结构非法/桥拒采/独立桥形态 |
| `slots.test.tsx` | +2 接线用例（成功 + 坏 IR，HUD 文案断言） |

## 测试结果（证据 `~/df-evidence/audit-d03/`）

| 验收 | 结果 |
|---|---|
| `pnpm verify` | **exit 0**（1717 web 用例等全绿） |
| `e2e-smoke` | **exit 0**（editor 场景 14 步 ✓ · canvas IR 往返 ✓ · 编辑器门禁 8 步 ✓） |
| **J5 旅程红转绿** | 2 次调用 × 3 轮全 pass，导入两步全绿（`{"ok":true}` + 几何逐字段一致），**flakyRate 0** |
| 合并后 main 复验 | verify=0 · e2e=0 |

## 性能对比

不适用（功能接线；J5 轮次耗时 3.9-4.0s 与审计期一致）。

## 风险

- 低：导入失败提示面为画布 HUD（引擎领域校验错误不适用网络层「人话+折叠」风格，失败原文经 i18n 包装，信封不变）。
- /editor 界面本无导入按钮（既有形态非本缺陷范围）；用户可见面=句柄入口 + HUD 提示。

## 回滚

`git revert -m 1 <merge-sha>`（单 merge revert）。

## 遗留

无（J5 适配副本与仓外审计原件的取舍已在证据目录 README 化说明——原件未改动）。
