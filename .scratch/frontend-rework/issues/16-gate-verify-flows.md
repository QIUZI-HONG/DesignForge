# 16: gate · 动线固化 + verify:flows

**What to build:** 三条核心动线固化为步数断言门禁：首页→新建/打开→编辑→保存→返回；市场→装载资产→回编辑器；设置→凭据注入→AI 状态反馈。真链路运行，steps=0 即 fail 防假绿。

**Blocked by:** 03

**Status:** ready-for-agent

blockers: 03

- [ ] 动线清单全部断言通过
- [ ] verify:flows 真链路门禁转绿（真 daemon + 生产构建 + 真 Chromium）
- [ ] 证据落盘（df.flows.evidence）
