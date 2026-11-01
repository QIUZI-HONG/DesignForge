# 21: follow-up · 文档跨进程写锁（票 19 遗留：conflict 分支无确定性判据）

**What to build:** 让「同一文档被两个 daemon 进程并发写」这件事有确定性可测的失败语义，而不是靠运气挤进重试窗口。票 19 已把「保存失败 = 盘上没变」做成构造性保证（正文只在 manifest 提交点复读确认之后发布），但 `conflict` 这条分支本身仍然测不到：`apps/daemon/src/documents/store.ts:115` 的 `MAX_COMMIT_ATTEMPTS = 3` 加「写后复读比对」（`:260-295`）在绝大多数交错下都会收敛。

**实测数据（证据 `~/df-evidence/v2-19/probe.mjs` + `probe-pre-fix.log` / `probe-post-fix.log`）**：两个真实子进程 daemon 共用同一工作目录，两边各 150 轮串行保存同一页（200 页胖 manifest）。修复前的树跑出 **8 次 `conflict` / 300**，修复后的树跑出 **0 次 / 300**；早前取样还有 1/80、4/300 两种结果——**计数每次都变**，这正是它不能当判据的原因。两棵树的「409 却正文已变」背离都是 0，但修复前那个 0 是并发掩盖造成的（见票 19 完成记录），不能作为缺陷不存在的证据。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] 选一种**跨进程互斥**并在工单里记下选择理由：`open(dirPath/.lock, 'wx')` 锁文件 + 过期接管、`flock`（`fs-ext`/native 依赖需评估），或按文档目录做 O_EXCL 创建 + 心跳续期。纪律：锁不得改变单进程路径上的语义（现有 176 条 daemon 用例不许为过测而放宽），拿不到锁即回结构化 `conflict`（`details` 沿用票 19 的 `published/manifestVersionOnDisk/attemptedVersion` 口径）
- [ ] 加**确定性**用例：夹具起两个真子进程 daemon（票 05 的端口/数据根口径），用可观察的握手（例如让 B 在 A 进入临界区后再进入）断言「B 拿到 conflict 且盘上仍是 A 的内容」——判据不许依赖调度时序，跑 20 次必须同结果
- [ ] 复核票 19 留下的覆盖面说明并同步删改：`apps/daemon/src/routes/documents.atomicity.test.ts` 头注释里「conflict 分支无法确定性构造」那句在本票完成后即失效

## 已知的相邻缺陷（本票完成后另议，不在范围内）

`commitManifest` 在提交点**之后**才 `publish()` 正文；若发布本身失败（目标名被占成目录、权限变更），manifest 已前进而正文未变，请求回 500。危害小于票 19 修掉的「409 但正文已改」（失败方的内容不会被信任，也不覆盖并发胜者），但同样是一处不一致——需要裁决「回滚 manifest 到提交前（会覆盖并发胜者）」还是「把 500 如实升级为 `published:false` 的结构化错误」。
