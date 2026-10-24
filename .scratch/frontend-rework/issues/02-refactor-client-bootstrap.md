# 02: refactor · 统一客户端引导与声明式注册表

**What to build:** 编辑器相关插槽与命令注册收口为单一客户端引导 + 声明式注册表；散点 return-null 引导件删除；服务端/客户端首帧一致性保持。新增插槽只需注册表一处声明，hydration 时序脆弱性消除。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] 新增一个插槽仅需注册表一处声明即可挂载
- [ ] e2e:smoke 与既有组件测试全绿，无 hydration 不匹配回归
- [ ] 散点引导件清零（编辑器域内不可再见）
