# 01: SSE 响应 CORS 修复（断点一）

**What to build:** 用户在浏览器打开 AI 抽屉、输入任意指令并提交后，请求不再被 CORS 拦截：四步流程走完并呈现降级结果（未配置 key 时为建议清单），而不是「排队 失败 / Failed to fetch」。daemon 的流式（SSE）响应必须由与普通响应**同一个 CORS 策略对象**生成头部——流式写头时合并策略头，不再绕过 onRequest 钩子。白名单语义（本机开发来源 + `Origin: null`）、`vary: Origin`、预检短路、预检缓存全部不变；非白名单 Origin 仍「不加放行头、API 语义不变」。修复后首次可观测的是**降级态**，验收不依赖真实凭据。

**Blocked by:** None (can start immediately)

**Status:** done（已并入 ux-audit-remediation 6226039，浏览器项待复核）

- [x] daemon 路由测试：流式响应对白名单 Origin 返回 `access-control-allow-origin` 回显头（复用既有流式 content-type 断言手法）
- [x] daemon 路由测试：流式响应对非白名单 Origin 不带放行头；`Origin: null` 带放行头
- [ ] curl A/B 复验：同一端点流式与非流式的 CORS 头一致
- [ ] 浏览器实测（未配置 key）：AI 提交走完步骤流，呈现降级结果与建议清单，无 CORS 报错
- [ ] 重试按钮在传输层修复后可用于真实重试（不再必败）
