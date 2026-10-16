/**
 * @dforge/daemon · 出图路由（ComfyUI 调度；FE-10 出图面板消费）。
 *
 * 未启动 / 缺模型都是一等状态：以结构化失败态 + 可执行动作返回（架构 §5.5 表），
 * 前端据此给「重试探测 / 手填地址 / 一键启动」等提示，而非统一报错。
 */

import type { ComfyFailure, ImageRunRequest } from '@dforge/contracts';
import { DAEMON_ROUTES, parseImageRunRequest } from '@dforge/contracts';
import type { FastifyInstance } from 'fastify';

import type { DaemonContext } from '../app.ts';
import { sendFail, sendOk } from '../http.ts';

/** 把客户端失败态映射为统一错误响应（details 携带穷尽信息）。 */
function sendComfyFailure(reply: Parameters<typeof sendFail>[0], failure: ComfyFailure) {
  return sendFail(reply, failure.code, failure.message, {
    actions: failure.actions,
    missing: failure.missing,
    available: failure.available,
  });
}

/** 注册出图路由。 */
export function registerImageRoutes(app: FastifyInstance, context: DaemonContext): void {
  app.get(DAEMON_ROUTES.imageProbe.path, async (_request, reply) => {
    return sendOk(reply, await context.comfy.probe());
  });

  app.get(DAEMON_ROUTES.imageTemplates.path, async (_request, reply) => {
    return sendOk(reply, await context.comfy.templates());
  });

  app.post(DAEMON_ROUTES.imageRunsCreate.path, async (request, reply) => {
    const parsed = parseImageRunRequest(request.body);
    if (!parsed.ok) {
      return sendFail(reply, 'comfy_invalid_request', parsed.message);
    }
    const result = await context.comfy.submit(parsed.value);
    if (!result.ok) {
      return sendComfyFailure(reply, result.failure);
    }
    context.telemetry
      .append({
        name: 'image.run.submitted',
        payload: {
          runId: result.handle.runId,
          templateId: result.template.templateId,
          templateVersion: result.template.templateVersion,
          seed: result.seed,
        },
        sessionId: null,
        appVersion: null,
        at: null,
      })
      .catch(() => undefined);
    return sendOk(reply, result.handle, 202);
  });

  app.get(DAEMON_ROUTES.imageRunsList.path, async (_request, reply) => {
    return sendFail(reply, 'not_found', '任务清单未提供（按 runId 查询单任务）');
  });

  app.get(DAEMON_ROUTES.imageRunGet.path, async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const status = await context.comfy.status(runId);
    if (status === null) {
      return sendFail(reply, 'comfy_run_not_found', '未知出图任务（可能已重启 daemon）', { runId });
    }
    return sendOk(reply, status);
  });

  app.post(DAEMON_ROUTES.imageRunCancel.path, async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const status = await context.comfy.cancel(runId);
    if (status === null) {
      return sendFail(reply, 'comfy_run_not_found', '未知出图任务（可能已重启 daemon）', { runId });
    }
    return sendOk(reply, status);
  });
}

/** 便于测试与文档：把请求体声明为契约类型的引用。 */
export type ImageRunRouteBody = ImageRunRequest;
