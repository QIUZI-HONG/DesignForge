/**
 * @dforge/contracts · ai 命名空间。
 *
 * AI 代理（BYOK：key 只在 daemon 解密使用，**key 永不下行**）。
 * 核心口径（前端无需分支）：**无 key / 上游失败 → 降级响应与真响应同构**——
 * 同一 `AiChatResponse` 形状，`degraded=true` + `suggestions` 给出可操作建议；
 * 流式同理，`done` 事件永远携带完整响应。
 * 消费方：FE-10（AI 抽屉）、FE-09（设置页配置凭据）。
 */

import type { AiProvider, CredentialSummary } from '../config/index.ts';
import type { DaemonError } from '../ipc/errors.ts';

/** 消息角色（OpenAI-compatible）。 */
export type AiRole = 'system' | 'user' | 'assistant';

/** 对话消息。 */
export interface AiMessage {
  role: AiRole;
  content: string;
}

/** `POST /ai/chat` 请求。 */
export interface AiChatRequest {
  provider?: AiProvider;
  model?: string;
  messages: AiMessage[];
  /** true → SSE 流式（text/event-stream，帧为 AiStreamEvent）；false/缺省 → 一次性响应。 */
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
}

/** 降级原因（与真响应同构的降级分支只由它区分）。 */
export type AiDegradeReason =
  | 'no-credentials'
  | 'upstream-error'
  | 'timeout'
  | 'rate-limited'
  | 'invalid-response';

/** 降级建议类型（前端按 kind 渲染动作按钮）。 */
export type AiSuggestionKind =
  | 'configure-credentials'
  | 'retry-later'
  | 'check-network'
  | 'manual-edit';

/** 降级建议条目（无 key/失败时给出，替代硬报错）。 */
export interface AiSuggestion {
  kind: AiSuggestionKind;
  title: string;
  detail: string | null;
}

/** 用量记账（上游未返回时为 null 字段）。 */
export interface AiUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

/** AI 对话响应（真响应与降级响应同构）。 */
export interface AiChatResponse {
  runId: string;
  provider: AiProvider;
  model: string;
  content: string;
  finishReason: 'stop' | 'length' | 'degraded' | null;
  usage: AiUsage | null;
  degraded: boolean;
  degradedReason: AiDegradeReason | null;
  suggestions: AiSuggestion[];
}

/** SSE 流事件（text/event-stream 每帧 data 为一个 AiStreamEvent）。 */
export type AiStreamEvent =
  | { type: 'start'; runId: string; provider: AiProvider; model: string; degraded: boolean }
  | { type: 'delta'; delta: string }
  | { type: 'done'; response: AiChatResponse }
  | { type: 'error'; error: DaemonError };

/** `GET /ai/status` 响应（未配置时前端直接展示 degradedHint，不报错）。 */
export interface AiStatusResponse {
  provider: AiProvider;
  model: string;
  baseUrl: string;
  configured: boolean;
  credential: CredentialSummary;
  degradedHint: string | null;
}

/** 解析结果（契约包内手写校验的统一返回形态）。 */
export type AiParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

const AI_ROLES: readonly string[] = ['system', 'user', 'assistant'];

/** 解析并校验 `POST /ai/chat` 请求体（错误信息中文，供统一错误形状直接使用）。 */
export function parseAiChatRequest(value: unknown): AiParseResult<AiChatRequest> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: '请求体必须是 JSON 对象' };
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.messages) || record.messages.length === 0) {
    return { ok: false, message: 'messages 必须是非空数组' };
  }
  const messages: AiMessage[] = [];
  for (const [index, raw] of record.messages.entries()) {
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, message: `messages[${index}] 必须是对象` };
    }
    const message = raw as Record<string, unknown>;
    if (typeof message.role !== 'string' || !AI_ROLES.includes(message.role)) {
      return { ok: false, message: `messages[${index}].role 必须是 system/user/assistant` };
    }
    if (typeof message.content !== 'string') {
      return { ok: false, message: `messages[${index}].content 必须是字符串` };
    }
    messages.push({ role: message.role as AiRole, content: message.content });
  }
  if (record.provider !== undefined && record.provider !== 'deepseek') {
    return { ok: false, message: 'provider 仅支持 deepseek（适配层预留可插拔）' };
  }
  if (record.model !== undefined && typeof record.model !== 'string') {
    return { ok: false, message: 'model 必须是字符串' };
  }
  if (record.stream !== undefined && typeof record.stream !== 'boolean') {
    return { ok: false, message: 'stream 必须是布尔值' };
  }
  if (record.temperature !== undefined) {
    const temperature = record.temperature;
    if (
      typeof temperature !== 'number' ||
      !Number.isFinite(temperature) ||
      temperature < 0 ||
      temperature > 2
    ) {
      return { ok: false, message: 'temperature 必须在 0–2 之间' };
    }
  }
  if (record.maxTokens !== undefined) {
    const maxTokens = record.maxTokens;
    if (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens <= 0) {
      return { ok: false, message: 'maxTokens 必须是正整数' };
    }
  }

  // 逐字段回填（exactOptionalPropertyTypes：可选字段只在出现时赋值）
  const request: AiChatRequest = { messages };
  if (record.provider !== undefined) request.provider = 'deepseek';
  if (typeof record.model === 'string') request.model = record.model;
  if (typeof record.stream === 'boolean') request.stream = record.stream;
  if (typeof record.temperature === 'number') request.temperature = record.temperature;
  if (typeof record.maxTokens === 'number') request.maxTokens = record.maxTokens;
  return { ok: true, value: request };
}
