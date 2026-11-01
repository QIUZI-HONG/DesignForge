# 19: fix · 文档提交：409 时正文已落盘；无 manifest 目录永久占名

**What to build:** 「保存失败」必须等于「盘上没变」，「删除」必须能删掉自己创建的目录。现状两处（`apps/daemon/src/documents/store.ts`）：

1. `:483-489` 在 `commitManifest` 的 plan 回调里**先写正文**（`writeFileAtomic(pagePath, ...)`），manifest 由 `:252-262` 的循环写 + 复读确认；复读不一致即重试，耗尽后 `:264-270` 回 `conflict`（HTTP 409）——**但新正文已在盘上**：保存对用户报失败，数据实际已变（`:486` 注释自陈「正文先落盘、manifest 最后（崩溃时读者仍见一致状态）」，动机对，可观测后果错：并发失败路径没有回滚也没有幂等重放保证）。
2. `:325-347` `create()`：`mkdir` 成功后才写 page 与 manifest，中途任何写失败**不回滚 mkdir** → 留下无 manifest 的 `.dfg` 目录；此后 `create` 因 `EEXIST` 恒回 `doc_exists`（名字被永久占住），而 `:389-391` `remove()` 先读 manifest、读不到即 `doc_not_found` → **删也删不掉**。

上一轮把「正文/manifest 两文件非原子」记为 Nit；本票按**可观测后果**（409 但数据已变、名字永久占用且无恢复路径）升为 Important。

**Blocked by:** None (can start immediately)

**Status:** code-complete（Node 门禁全绿；证据 `~/df-evidence/v2-19/`；跨进程文档锁另开后续票，见完成记录）

blockers:

- [x] 失败语义收口：**不采用**「撤销已写正文」（那会覆盖并发胜者的正文），改为构造性保证——正文经 `stageFileAtomic` 暂存，只在 manifest 提交点复读确认通过之后 `publish()`，失败路径 `discard()`。因此「保存失败 = 盘上没变」不再依赖时序；`conflict` 响应体补 `details{documentId, attemptedVersion, manifestVersionOnDisk, published:false}`，消息如实交代「本次保存未生效，盘上仍是提交前的内容」
- [x] `create()` 失败路径回滚已建目录（用票 13 的可重试删除 `removeTree`）；`remove()` 放通「无 manifest 的空壳目录」：仅当 `lstat` 证明它是目录且**不是软链**时才删，守卫口径不变（对象级 + 路径安全）
- [x] 跨进程用例已加（两个独立 daemon 实例、各自真 socket 端口、同一工作目录：`apps/daemon/src/routes/documents.atomicity.test.ts`）。**如实记录覆盖面**：`conflict` 分支需要外部提交正好挤进重试窗口，HTTP 缝上无法确定性构造——探针（`~/df-evidence/v2-19/probe.mjs`，两个真子进程共享工作目录）在修复前树上跑出 8/300 冲突、修复后树 0/300，**计数每轮都在变**，拿它当判据必然飘；且「修复前背离 0」不代表没缺陷（拿到 409 时另一进程的下一笔正文写通常已盖回来，缺陷被并发掩盖）。因此本票用**条件式断言**（返回 409 就必须交代实况）+ `apps/daemon/src/fs-atomic.test.ts` 的原语用例兜住「失败不落正文」；原语用例经变异验证（把暂存改成「暂存即发布」三条全红，见 `mutation-eager-publish.log`）。真实跨进程文档锁另开后续票（`issues/21-cross-process-document-lock.md`）

## 完成记录（2026-11-01 · `integration/test-remediation-v2`）

三段竖切片：`fe1adba`（删除放通无 manifest 空壳）→ `d162cbc`（`create()` mkdir 之后失败即撤刚建目录）→ `1c46bac`（正文只在提交点确认之后发布）。改动文件：`apps/daemon/src/documents/store.ts`、`apps/daemon/src/fs-atomic.ts`（新增 `stageFileAtomic`/`StagedFile`，`writeFileAtomic` 改为暂存+立即发布）、`apps/daemon/src/fs-atomic.test.ts`（新）、`apps/daemon/src/routes/documents.atomicity.test.ts`（新）。

**判据修正（相对工单原文）**：原文给了两条候选——「随事务撤销正文」或「幂等重放直至一致」。两条都不成立：撤销会覆盖并发胜者的正文，重放无法在两个无共享锁的进程间收敛。实际做法是第三条——正文**先暂存、提交点确认之后才发布**，让「保存失败 = 盘上没变」成为构造性保证而不是事后补救；`conflict` 响应体负责「如实交代」，不负责「回到从前」。

门禁实况与未覆盖项见 `~/df-evidence/v2-19/evidence.md`（含变异日志、两次探针原始输出、6 项门禁退出码）。要点：`pnpm -r test` 9 包全绿、lint/typecheck/verify:daemon(42/42)/test:scripts(93/93) 全 0；`verify:ai-two-state` 仍 1，红点是基点既有缺陷（已单立票 22），与本票无关；浏览器/E2E 段因缺 `libnspr4` 等库未跑，证据按纪律记「不完整」，合并前应至少 1 位人工批准。

## 基线核对（2026-11-01 · 集成分支 integration/test-remediation-v2 @ 3f3603c）

工单正文行号取自 main@a838281，已过期。新基线上的实况坐标、上一轮已做掉的部分、剩余缺口与判据修正：
`~/df-evidence/test-remediation-v2/notes/baseline-audit.md` 同名小节（开工前必读）。
