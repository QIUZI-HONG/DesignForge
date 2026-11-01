# 10: fix · 参照集「已冻结」不得自证：人工签字入退出码

**What to build:** 「参照集已冻结且经人工评审」要成为可审计事实。现状 `scripts/verify-figma-baseline.mjs:249-258` 的 `--emit` 用**盘上 PNG 自算 sha256** 写 `baseline.json`，`:186-214` 再拿这份自算值去比同一批 PNG → 只证「文件没被自改」；`:357` `humanReview` 恒为 `pending` 且**不进退出码**。后果：REF-01 一旦落盘，CI 立刻印「参照集门禁正式判定通过」，而人工评审是否发生无处可查——这恰恰把本仓最反对的「自证式通过」引进来。

**Blocked by:** None (can start immediately；与 REF-01 冻结动作协同，但判据先行)

**Status:** ready-for-agent

blockers:

- [ ] `meta` 必须含来源记录（采集会话/命令/时间）+ 人工签字字段（签字者 + 签字哈希或仓外证据路径）
- [ ] `humanReview === 'pending'` → exit 2 并点名「人工评审未完成」，禁止以「文件哈希自洽」判 0
- [ ] `--emit` 与判定分离：emit 只产出待评审清单，判定只读已签字基线
- [ ] 对抗夹具：无签字基线目录必须 exit 2；哈希自洽但缺签字必须不是 0
- [ ] 与票 08/16 的实况口径对齐（REF-01 冻结后何时转正式判定，写清条件）
