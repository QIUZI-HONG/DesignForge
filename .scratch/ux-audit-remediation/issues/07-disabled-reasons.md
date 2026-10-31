# 07: 禁用原因 tooltip 补齐

**What to build:** 编辑器里所有影响用户理解的禁用项，悬停时解释原因。现状只有「分享」有原因提示（「功能尚未接入」），其余只回显名称或无提示：撤销/重做、AI 生成（空输入）、生成图片（无 ComfyUI）、「从模板新建」。复用既有按钮的禁用原因机制（同一机制，不新造）。清单 F15 的口径：灰化 + tooltip 原因。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 组件测试：四处禁用项悬停显示原因 tooltip，文案来自 zh-CN 目录
- [ ] 组件测试：「分享」既有 tooltip 不回退
- [ ] 浏览器实测：截图核对四处 tooltip 均在悬停时出现
