/**
 * @dforge/daemon · AI 代理路由（BYOK；FE-10 AI 抽屉消费）。
 *
 * - GET /ai/status：是否已配置（无 key 不报错，给 degradedHint）；
 * - POST /ai/chat：一次性响应或 SSE 流式；**无 key / 上游失败 → 降级响应（同构）**。
 * 纪律：Authorization 只在 daemon → 上游方向出现；响应/日志不含明文 key。
 */

import type { AiStatusResponse, AiStreamEvent } from '@dforge/contracts';
import { DAEMON_ROUTES, makeError, parseAiChatRequest } from '@dforge/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';

import type { DaemonContext } from '../app.ts';
import { sendFail, sendOk } from '../http.ts';

/** SSE 帧格式（event + data 双行，data 为契约 AiStreamEvent 的 JSON）。 */
function sseFrame(event: AiStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

async function writeStream(
  reply: FastifyReply,
  context: DaemonContext,
  body: unknown,
): Promise<void> {
  const raw = reply.raw;
  raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  const parsed = parseAiChatRequest(body);
  if (!parsed.ok) {
    // 流式通道已建立：参数错误以 error 帧表达（单事件通道内不换形状）
    raw.write(sseFrame({ type: 'error', error: makeError('ai_invalid_request', parsed.message) }));
    raw.end();
    return;
  }
  for await (const event of context.ai.streamChat(parsed.value)) {
    raw.write(sseFrame(event));
  }
  raw.end();
}

/** 注册 AI 路由。 */
export function registerAiRoutes(app: FastifyInstance, context: DaemonContext): void {
  app.get(DAEMON_ROUTES.aiStatus.path, (_request, reply) => {
    const runtime = context.ai.runtime();
    const summary = context.credentials.summary();
    const status: AiStatusResponse = {
      provider: runtime.provider,
      model: runtime.model,
      baseUrl: runtime.baseUrl,
      configured: runtime.apiKey !== null,
      credential: summary,
      degradedHint:
        runtime.apiKey === null
          ? '未配置 DeepSeek key：AI 功能为降级态（建议清单），不影响编辑与出图'
          : null,
    };
    return sendOk(reply, status);
  });

  app.post(DAEMON_ROUTES.aiChat.path, async (request, reply) => {
    const parsed = parseAiChatRequest(request.body);
    if (!parsed.ok) {
      return sendFail(reply, 'ai_invalid_request', parsed.message);
    }
    if (parsed.value.stream === true) {
      await writeStream(reply, context, request.body);
      return reply;
    }
    const response = await context.ai.chat(parsed.value);
    context.telemetry
      .append({
        name: response.degraded ? 'ai.degraded' : 'ai.run',
        payload: {
          runId: response.runId,
          model: response.model,
          degraded: response.degraded,
          degradedReason: response.degradedReason,
          totalTokens: response.usage?.totalTokens ?? null,
        },
        sessionId: null,
        appVersion: null,
        at: null,
      })
      .catch(() => undefined);
    return sendOk(reply, response);
  });
}
