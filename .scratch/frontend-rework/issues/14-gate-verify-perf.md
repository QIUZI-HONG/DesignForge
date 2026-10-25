# 14: gate · verify:perf 基准落地

**What to build:** verify:perf 转正：M1-M7 指标（首帧/交互帧率/选中延迟/撤销/保存往返/内存/剔除率）+ 确定性文档生成器；基线入库，回退超阈值 exit 1。「先测后优化」纪律的门禁化——Worker 化/空间索引的立项依据。

**Blocked by:** 04

**Status:** ready-for-agent

blockers: 04

- [ ] 基准脚本真链路产出 df.perf.evidence 证据
- [ ] 确定性文档生成器（注入 IdFactory）入库并服务单测
- [ ] 两轮基线记录，初始目标值校准后写入门禁
