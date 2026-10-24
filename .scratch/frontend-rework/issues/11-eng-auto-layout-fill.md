# 11: eng · 自动布局主轴 fill

**What to build:** 自动布局两遍求解补齐主轴 fill 伸缩语义（对齐 Figma 行为）；引擎布局不变式与交互白名单测试扩展。**ADR-0005「保架构重实现」的预声明例外**：engine 能力补齐、架构结构不动；本套件唯一 engine 票。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] fill 伸缩语义与 Figma 本体人工对照通过
- [ ] 引擎四大不变式测试全绿（写入口唯一/撤销往返/事务回滚/序列化往返）
- [ ] 行为快照按流程更新并独立复核
- [ ] 序列化 `$version` 不变（无格式变更）
