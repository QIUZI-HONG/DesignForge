# 19: fix · 文档提交：409 时正文已落盘；无 manifest 目录永久占名

**What to build:** 「保存失败」必须等于「盘上没变」，「删除」必须能删掉自己创建的目录。现状两处（`apps/daemon/src/documents/store.ts`）：

1. `:483-489` 在 `commitManifest` 的 plan 回调里**先写正文**（`writeFileAtomic(pagePath, ...)`），manifest 由 `:252-262` 的循环写 + 复读确认；复读不一致即重试，耗尽后 `:264-270` 回 `conflict`（HTTP 409）——**但新正文已在盘上**：保存对用户报失败，数据实际已变（`:486` 注释自陈「正文先落盘、manifest 最后（崩溃时读者仍见一致状态）」，动机对，可观测后果错：并发失败路径没有回滚也没有幂等重放保证）。
2. `:325-347` `create()`：`mkdir` 成功后才写 page 与 manifest，中途任何写失败**不回滚 mkdir** → 留下无 manifest 的 `.dfg` 目录；此后 `create` 因 `EEXIST` 恒回 `doc_exists`（名字被永久占住），而 `:389-391` `remove()` 先读 manifest、读不到即 `doc_not_found` → **删也删不掉**。

上一轮把「正文/manifest 两文件非原子」记为 Nit；本票按**可观测后果**（409 但数据已变、名字永久占用且无恢复路径）升为 Important。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] 失败语义收口：`conflict` 时要么正文写入随事务撤销，要么幂等重放直至 manifest 与正文一致（返回体说明实际落盘状态，禁止「失败但已变」）
- [ ] `create()` 失败路径回滚已建目录（用可重试删除，见票 13）；`remove()` 支持删除「无 manifest 的空壳目录」，按对象级守卫口径
- [ ] 新增**跨进程**用例：两个独立 daemon 实例（各自端口，见票 05）同数据根并发 `PUT` 同页 → 断言失败方的盘上状态；现有并发测试全走 `app.inject` 同一 store 实例，正好绕开本缺陷（本轮覆盖空洞第 4 条）

## 基线核对（2026-11-01 · 集成分支 integration/test-remediation-v2 @ 3f3603c）

工单正文行号取自 main@a838281，已过期。新基线上的实况坐标、上一轮已做掉的部分、剩余缺口与判据修正：
`~/df-evidence/test-remediation-v2/notes/baseline-audit.md` 同名小节（开工前必读）。
