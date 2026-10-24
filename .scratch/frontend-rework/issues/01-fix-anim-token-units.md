# 01: fix · 动效单位缺陷修复 + 令牌单位守卫

**What to build:** 修复时长令牌落盘为 px 的缺陷后，设界的全部组件动效（菜单/弹窗/抽屉/Toast 入场、悬停过渡）真实生效；guard:tokens 获得单位合法性断言（时长必须 ms、长度必须 px、字重/行高/层级必须无单位）；verify:motion 门禁以挂点接入（exit 2 起步）。这是缺陷修复，不是设计超越。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] 任一弹窗/抽屉可见入场动画（计算样式时长为有效 ms 且 ≠0）
- [ ] guard:tokens 对单位错误报违规（含既有误用检出）
- [ ] tokens 一致性测试按正确单位修正后全绿
- [ ] verify:motion 挂点入 CI 语义（无实现段 exit 2）
