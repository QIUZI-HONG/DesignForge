# 企业级测试规程（测试执行阶段 1 完成后的终局验收轮）

- 触发条件：implement-spec 流水线全部完成（tp1-01…05 合入 `integration/test-execution-phase1`，code-review 通过、发现项收口，工作树清理完毕）。
- 依据：《测试设计》§10.1 通过标准 G1–G4；本规程把「大厂企业级测试」落为可执行清单与报告模板。
- 产物：`docs/quality/enterprise-test-report-2026-11.md`（测试报告）+ 证据 `~/df-evidence/enterprise-final/`。

## E1 常规链全量（CI 同链）

`pnpm verify`（lint + typecheck + test，全部包）+ `pnpm test:scripts`。记录：包数、测试文件数、用例数、耗时。任何非绿=阻断项，按缺陷模板挂票。

## E2 门禁矩阵（逐门禁记录退出码与三态判定）

| 类别 | 门禁 | 预期 |
|---|---|---|
| 守卫 | guard:tokens / vocab / feature-boundaries / electron-baseline | 0 |
| 引擎 | verify:engine | 0 |
| 两态门禁 | verify-ai-two-state / verify-image-two-state / verify-mcp-stub | 0（tp1-05 接 CI 后 CI 侧同步验证） |
| 阻塞语义 | verify:figma-baseline / verify:motion / verify:perf | exit 2 + 指定文案（禁假绿口径） |
| 未实现守卫 | guard:deps / guard:mcp-contract / guard:channel-pairing | exit 2（如实登记） |
| 浏览器（本机） | e2e:smoke / verify:canvas / verify-shell-parity（有 Electron 二进制时） | 0；无前置则如实记 2 并注明原因 |

## E3 P0 用例终验（对照《测试设计》三章逐条销号）

- 已自动化为回归的 P0（tp1-01/02/03/04 交付）：引用对应测试名+运行结果。
- 手工/浏览器级 P0（如 TC-AI-03 步骤④⑤真浏览器验证、TC-UIX-07 速查卡视口）：主会话用浏览器自动化实测并截图存证；无法执行的如实记「未执行+原因」。
- 销号表：用例 ID | 执行方式 | 结果 | 证据路径。

## E4 对抗性抽查（企业级区别于常规回归的动作）

1. 畸形语料轮：对 daemon 以畸形 JSON/超深/超大/非 NFC 文档名做一轮黑盒 fuzz 脚本（30 条语料），记录全部响应码分布（预期零 5xx、零崩溃）。
2. 长会话抽查：e2e editor 场景连续跑 3 轮核对幂等。
3. 双窗口覆盖确认（TC-DOC-08）：playwright 双 context 实测一次，结果登记（last-write-wins 现状确认，R-4 不在本轮修复）。

## E5 报告模板（写入 docs/quality/enterprise-test-report-2026-11.md）

1. 摘要（一屏）：E1–E4 结论 + G1–G4 逐条判定。
2. 环境与版本：分支 tip SHA、node/pnpm、门禁版本口径。
3. 结果矩阵：E1/E2/E3/E4 明细（含跳过项与原因——禁静默缺席）。
4. 缺陷清单：编号 | 严重度 | 用例 | 现象 | 去向（本轮修复 / 挂票 / 已登记残余风险）。
5. 通过标准判定：G1 每票合并证据链 / G2 P0 收口 / G3 视觉性能解冻状态 / G4 全量验收。
6. 残余风险更新：对照《测试设计》§10.2 R-1~R-11 逐条复核状态变化。

## 完成判据

E1 全绿、E2 无意外退出码、E3 P0 销号表无「未执行且无原因」项、E4 无新增 P0/P1 缺陷 → 企业级测试轮通过；否则缺陷挂票并重跑受影响面。
