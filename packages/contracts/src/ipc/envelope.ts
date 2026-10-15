/**
 * @dforge/contracts · 请求/响应信封。
 *
 * 两种传输共用同一套形状，避免前端为每条链路各写一套解包逻辑：
 * - HTTP（daemon 本地回环）：`{ ok: true, result }` / `{ ok: false, error }`（ApiResponse）；
 * - stdio/SSE（CLI、未来 MCP 网关、Electron 桥）：`{ id, method, params }` /
 *   `{ id, ok, result | error }`（IpcRequest / IpcResponse）——id 用于请求-响应配对。
 */

import type { DaemonError, DfErrorCode } from './errors.ts';
import { makeError } from './errors.ts';

/** HTTP 成功信封。 */
export interface ApiSuccess<T> {
  ok: true;
  result: T;
}

/** HTTP 失败信封（错误形状统一，与状态码配合使用）。 */
export interface ApiFailure {
  ok: false;
  error: DaemonError;
}

/** HTTP 响应信封（daemon 所有路由的唯一响应形状）。 */
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** 构造成功信封。 */
export function apiSuccess<T>(result: T): ApiSuccess<T> {
  return { ok: true, result };
}

/** 构造失败信封。 */
export function apiFailure(
  code: DfErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiFailure {
  return { ok: false, error: makeError(code, message, details) };
}

/** 判别成功信封（可用于 unknown，供前端解包）。 */
export function isApiSuccess<T>(value: unknown): value is ApiSuccess<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { ok?: unknown }).ok === true &&
    'result' in value
  );
}

/** 判别失败信封。 */
export function isApiFailure(value: unknown): value is ApiFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { ok?: unknown }).ok === false &&
    'error' in value
  );
}

/** stdio/SSE 通道请求信封（id 用于配对，method 为契约内的路由键）。 */
export interface IpcRequest<P = unknown> {
  id: string;
  method: string;
  params: P;
}

/** stdio/SSE 通道成功响应。 */
export interface IpcSuccess<R = unknown> {
  id: string;
  ok: true;
  result: R;
}

/** stdio/SSE 通道失败响应。 */
export interface IpcFailure {
  id: string;
  ok: false;
  error: DaemonError;
}

/** stdio/SSE 通道响应信封。 */
export type IpcResponse<R = unknown> = IpcSuccess<R> | IpcFailure;

/** 构造通道成功响应。 */
export function ipcSuccess<R>(id: string, result: R): IpcSuccess<R> {
  return { id, ok: true, result };
}

/** 构造通道失败响应。 */
export function ipcFailure(id: string, error: DaemonError): IpcFailure {
  return { id, ok: false, error };
}
