# 02: fix · daemon 流式 AI 响应丢 CORS 头（浏览器里 AI 流式整条不可用）

**What to build:** 跨源浏览器客户端能真的读到 `POST /ai/chat` 的 SSE 正文。现状：`apps/daemon/src/routes/ai.ts:32-37` 用 `reply.raw.writeHead(200, {content-type, cache-control, connection})`，`:86-88` 之后 `return reply` 不经 `reply.send`；CORS 钩子（`apps/daemon/src/cors.ts:87-104`）把 `vary` / `access-control-allow-origin` 缓冲在 reply 上，raw 路径整体绕开 → **写出的 SSE 响应没有 ACAO**。预检走 `reply.code(204).send()` 有头，于是浏览器「放行预检、拒收正文」，表现为 AI 流式在跨源形态（web :3000 → daemon :4318 直连）永远拿不到一个字。消费方确在用它：`apps/web/src/features/ai/client.ts:86`（`stream: true`）、`apps/web/src/features/ai/stream.ts`。

**Blocked by:** 04（验收断言要在生产构建 + 真浏览器里跑，dev 模式取证的结论不作数）

**Status:** ready-for-agent

blockers:

- [ ] 流式分支把 CORS 判定结果显式写进 `writeHead` 头（或改 `reply.hijack()` + 手工头 + 同口径 vary），白名单外 Origin 不得带放行头
- [ ] daemon 层新增「带 `Origin: http://localhost:3000` 的 stream 用例」并断言**线路上**的 `access-control-allow-origin`（当前 `ai.test.ts` 的 stream 用例从不带 Origin，`cors.test.ts` 只测非流式）
- [ ] 负向用例：非白名单 Origin 的 stream 响应不含放行头（上一轮已记「白名单用例缺反向断言」，本票一并补）
- [ ] 浏览器段：生产构建站跨源直连测试 daemon，AI 面板流式逐帧可见（证据 JSON + 截图落 `~/df-evidence/<票号>/`）

## 基线核对（2026-11-01 · 集成分支 integration/test-remediation-v2 @ 3f3603c）

工单正文行号取自 main@a838281，已过期。新基线上的实况坐标、上一轮已做掉的部分、剩余缺口与判据修正：
`~/df-evidence/test-remediation-v2/notes/baseline-audit.md` 同名小节（开工前必读）。
