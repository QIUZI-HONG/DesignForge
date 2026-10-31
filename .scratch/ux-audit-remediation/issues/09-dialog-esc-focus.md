# 09: 新建对话框 Esc 与焦点

**What to build:** 首页「新建设计文件」对话框提交失败（如重名）后，焦点回到对话框内首个非法字段（或对话框容器），Esc 恢复关闭能力——当前焦点落在 BODY，Esc 无效只能点「取消」。行为与删除确认框对齐（焦点在框内时 Esc 可关）。空名/超长/非法字符的既有分因提示保持不变。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 组件测试：提交失败后 `document.activeElement` 在对话框内；Esc 关闭对话框
- [ ] 组件测试：「取消」路径与成功路径行为不变
- [ ] 浏览器实测：重名提交失败 → Esc 关闭 → 重开流程正常
