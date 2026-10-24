# 04: seam · 渲染观测通道（挂点起步）

**What to build:** 把渲染循环已有的绘制计数（节点/剔除/文本 run）与帧时长，经既有诊断面（HUD 通道）暴露为门禁可编程只读读取；verify:perf 挂点接入（exit 2 起步）。不新造协议、不加独立上报链路、不逐帧上行遥测。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

blockers:

- [ ] 门禁脚本可读取绘制计数与帧时长（同源只读）
- [ ] daemon 遥测仅接收汇总（沿用 JSONL），无逐帧写入
- [ ] verify:perf 挂点入 CI 语义（exit 2）
