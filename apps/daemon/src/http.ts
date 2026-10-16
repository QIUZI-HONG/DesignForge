/**
 * @dforge/daemon · HTTP 响应助手。
 *
 * 全站统一响应形状（契约在 `@dforge/contracts`）：
 * 成功 `{ ok: true, result }`；失败 `{ ok: false, error: DaemonError }`，
 * 且 HTTP 状态码取 `DF_ERROR_HTTP_STATUS[code]`——前端可只看信封，也可看状态码短路。
 */

import type { DfErrorCode } from '@dforge/contracts';

import { apiFailure, apiSuccess, DF_ERROR_HTTP_STATUS } from '@dforge/contracts';
import type { FastifyReply } from 'fastify';

/** 返回成功信封（状态码缺省 200）。 */
export function sendOk<T>(reply: FastifyReply, result: T, status = 200): FastifyReply {
  return reply.status(status).send(apiSuccess(result));
}

/** 返回失败信封（状态码由错误码表决定）。 */
export function sendFail(
  reply: FastifyReply,
  code: DfErrorCode,
  message: string,
  details?: Record<string, unknown>,
): FastifyReply {
  return reply.status(DF_ERROR_HTTP_STATUS[code]).send(apiFailure(code, message, details));
}
