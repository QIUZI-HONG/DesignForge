/**
 * @dforge/daemon · DeepSeek 适配层（OpenAI-compatible，BYOK）。
 *
 * 纪律（架构 v1.1 §4.5.1 / §5.6）：
 * - key 只在 daemon 侧解密使用；请求头携带 Authorization，**任何响应/日志不含明文 key**；
 * - 无 key / 上游失败 → **降级响应与真响应同构**（degraded + suggestions），前端无需分支；
 * - 失败重试 ≤2 次（指数退避；429 与 5xx 同策略，超时/网络错误不重试）；
 * - 流式：SSE 帧为契约的 AiStreamEvent；`done` 永远携带完整响应（降级时亦然）。
 */

import { randomBytes } from 'node:crypto';

import type {
  AiChatRequest,
  AiChatResponse,
  AiDegradeReason,
  AiStreamEvent,
  AiSuggestion,
  AiUsage,
} from '@dforge/contracts';

/** 上游单次请求超时。 */
const UPSTREAM_TIMEOUT_MS = 60_000;
/** 失败重试次数（架构：≤2 次）+ 退避序列（可注入以便测试即时化）。 */
const DEFAULT_RETRY_DELAYS_MS = [300, 900];

/** 上游响应统一映射为响应对象（不抛异常）。 */
interface UpstreamResult {
  ok: boolean;
  status: number;
  content: string;
  finishReason: AiChatResponse['finishReason'];
  usage: AiUsage | null;
  errorBody: string | null;
}

function suggestionsFor(reason: AiDegradeReason): AiSuggestion[] {
  switch (reason) {
    case 'no-credentials':
      return [
        {
          kind: 'configure-credentials',
          title: '未配置 DeepSeek API key',
          detail: '在设置页填入 key（sk-…）后即可使用 AI 功能；本地编辑器与出图不受影响',
        },
      ];
    case 'rate-limited':
      return [
        {
          kind: 'retry-later',
          title: '触发上游限流（429）',
          detail: '已按指数退避重试 2 次仍失败；稍后再试或降低频率',
        },
        { kind: 'manual-edit', title: '可先手动完成本次修改', detail: null },
      ];
    case 'timeout':
      return [
        { kind: 'retry-later', title: '请求超时', detail: '网络较慢或上游拥堵，可稍后重试' },
        { kind: 'manual-edit', title: '可先手动完成本次修改', detail: null },
      ];
    case 'invalid-response':
      return [
        { kind: 'retry-later', title: '上游响应不可解析', detail: '已降级，可重试一次' },
        { kind: 'manual-edit', title: '可先手动完成本次修改', detail: null },
      ];
    default:
      return [
        {
          kind: 'retry-later',
          title: '上游服务暂不可用',
          detail: '已自动降级为建议清单，不中断编辑',
        },
        { kind: 'manual-edit', title: '可先手动完成本次修改', detail: null },
      ];
  }
}

/** 构造降级响应（与真响应同构：前端只看 degraded/degradedReason/suggestions）。 */
export function degradedResponse(options: {
  runId: string;
  provider: AiChatResponse['provider'];
  model: string;
  reason: AiDegradeReason;
  partialContent?: string;
}): AiChatResponse {
  return {
    runId: options.runId,
    provider: options.provider,
    model: options.model,
    content: options.partialContent ?? '',
    finishReason: 'degraded',
    usage: null,
    degraded: true,
    degradedReason: options.reason,
    suggestions: suggestionsFor(options.reason),
  };
}

/** AI 客户端接口。 */
export interface AiClient {
  /** 是否已配置 key 与运行时模型/baseUrl（供 /ai/status 与连通性自检）。 */
  runtime(): { apiKey: string | null; model: string; baseUrl: string; provider: 'deepseek' };
  chat(request: AiChatRequest): Promise<AiChatResponse>;
  /** 流式（SSE）：start → delta* → done（降级时 done 携带降级响应，不再发 error）。 */
  streamChat(request: AiChatRequest): AsyncGenerator<AiStreamEvent>;
}

/** 创建 AI 客户端（fetchImpl 注入；retryDelaysMs 注入让测试即时）。 */
export function createAiClient(options: {
  resolveApiKey: () => string | null;
  config: () => { model: string; baseUrl: string };
  fetchImpl: typeof fetch;
  retryDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}): AiClient {
  const retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  const callUpstream = async (request: AiChatRequest, apiKey: string): Promise<UpstreamResult> => {
    const { model, baseUrl } = options.config();
    const body: Record<string, unknown> = {
      model: request.model ?? model,
      messages: request.messages,
      stream: false,
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;

    const response = await options.fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      return {
        ok: false,
        status: response.status,
        content: '',
        finishReason: null,
        usage: null,
        errorBody: errorBody.slice(0, 500),
      };
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    if (typeof payload !== 'object' || payload === null) {
      return {
        ok: false,
        status: response.status,
        content: '',
        finishReason: null,
        usage: null,
        errorBody: 'invalid-json',
      };
    }
    const record = payload as Record<string, unknown>;
    const choices = Array.isArray(record.choices) ? record.choices : [];
    const first = choices[0];
    const message =
      typeof first === 'object' && first !== null
        ? (first as Record<string, unknown>).message
        : undefined;
    const content =
      typeof message === 'object' &&
      message !== null &&
      typeof (message as Record<string, unknown>).content === 'string'
        ? ((message as Record<string, unknown>).content as string)
        : null;
    if (content === null) {
      return {
        ok: false,
        status: response.status,
        content: '',
        finishReason: null,
        usage: null,
        errorBody: 'missing-content',
      };
    }
    const rawFinish =
      typeof first === 'object' && first !== null
        ? (first as Record<string, unknown>).finish_reason
        : undefined;
    const finishReason = rawFinish === 'stop' || rawFinish === 'length' ? rawFinish : null;
    const rawUsage = record.usage;
    const usage =
      typeof rawUsage === 'object' && rawUsage !== null
        ? {
            promptTokens:
              typeof (rawUsage as Record<string, unknown>).prompt_tokens === 'number'
                ? ((rawUsage as Record<string, unknown>).prompt_tokens as number)
                : null,
            completionTokens:
              typeof (rawUsage as Record<string, unknown>).completion_tokens === 'number'
                ? ((rawUsage as Record<string, unknown>).completion_tokens as number)
                : null,
            totalTokens:
              typeof (rawUsage as Record<string, unknown>).total_tokens === 'number'
                ? ((rawUsage as Record<string, unknown>).total_tokens as number)
                : null,
          }
        : null;
    return { ok: true, status: response.status, content, finishReason, usage, errorBody: null };
  };

  const reasonOf = (result: UpstreamResult): AiDegradeReason => {
    if (result.status === 429) return 'rate-limited';
    if (result.errorBody === 'invalid-json' || result.errorBody === 'missing-content')
      return 'invalid-response';
    return 'upstream-error';
  };

  const isRetryable = (result: UpstreamResult): boolean =>
    result.status === 429 || result.status >= 500;

  return {
    runtime() {
      const { model, baseUrl } = options.config();
      return { apiKey: options.resolveApiKey(), model, baseUrl, provider: 'deepseek' as const };
    },

    async chat(request: AiChatRequest): Promise<AiChatResponse> {
      const { model } = options.config();
      const runId = `ai_${randomBytes(8).toString('hex')}`;
      const apiKey = options.resolveApiKey();
      if (apiKey === null) {
        return degradedResponse({
          runId,
          provider: 'deepseek',
          model: request.model ?? model,
          reason: 'no-credentials',
        });
      }

      let lastResult: UpstreamResult | null = null;
      for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
        let result: UpstreamResult;
        try {
          result = await callUpstream(request, apiKey);
        } catch (error) {
          const isTimeout = error instanceof Error && error.name === 'TimeoutError';
          return degradedResponse({
            runId,
            provider: 'deepseek',
            model: request.model ?? model,
            reason: isTimeout ? 'timeout' : 'upstream-error',
          });
        }
        if (result.ok) {
          return {
            runId,
            provider: 'deepseek',
            model: request.model ?? model,
            content: result.content,
            finishReason: result.finishReason,
            usage: result.usage,
            degraded: false,
            degradedReason: null,
            suggestions: [],
          };
        }
        lastResult = result;
        if (!isRetryable(result) || attempt === retryDelays.length) break;
        await sleep(retryDelays[attempt] ?? 0);
      }

      return degradedResponse({
        runId,
        provider: 'deepseek',
        model: request.model ?? model,
        reason: lastResult === null ? 'upstream-error' : reasonOf(lastResult),
      });
    },

    async *streamChat(request: AiChatRequest): AsyncGenerator<AiStreamEvent> {
      const { model } = options.config();
      const runId = `ai_${randomBytes(8).toString('hex')}`;
      const apiKey = options.resolveApiKey();
      const effectiveModel = request.model ?? model;

      if (apiKey === null) {
        yield { type: 'start', runId, provider: 'deepseek', model: effectiveModel, degraded: true };
        yield {
          type: 'done',
          response: degradedResponse({
            runId,
            provider: 'deepseek',
            model: effectiveModel,
            reason: 'no-credentials',
          }),
        };
        return;
      }

      // 上游流式失败不重试（已开始传输即无法无损重放）——统一以 done(降级) 收尾
      yield { type: 'start', runId, provider: 'deepseek', model: effectiveModel, degraded: false };

      let content = '';
      try {
        const { baseUrl } = options.config();
        const response = await options.fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model: effectiveModel, messages: request.messages, stream: true }),
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
        if (!response.ok || response.body === null) {
          const reason: AiDegradeReason =
            response.status === 429 ? 'rate-limited' : 'upstream-error';
          yield {
            type: 'done',
            response: degradedResponse({
              runId,
              provider: 'deepseek',
              model: effectiveModel,
              reason,
              partialContent: content,
            }),
          };
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finishReason: AiChatResponse['finishReason'] = null;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') continue;
            let parsed: unknown;
            try {
              parsed = JSON.parse(data) as unknown;
            } catch {
              continue;
            }
            if (typeof parsed !== 'object' || parsed === null) continue;
            const choices = Array.isArray((parsed as Record<string, unknown>).choices)
              ? ((parsed as Record<string, unknown>).choices as unknown[])
              : [];
            const first = choices[0];
            if (typeof first !== 'object' || first === null) continue;
            const delta =
              typeof (first as Record<string, unknown>).delta === 'object' &&
              (first as Record<string, unknown>).delta !== null
                ? ((first as Record<string, unknown>).delta as Record<string, unknown>)
                : {};
            const piece = typeof delta.content === 'string' ? delta.content : '';
            if (piece.length > 0) {
              content += piece;
              yield { type: 'delta', delta: piece };
            }
            const rawFinish = (first as Record<string, unknown>).finish_reason;
            if (rawFinish === 'stop' || rawFinish === 'length') finishReason = rawFinish;
          }
        }

        yield {
          type: 'done',
          response: {
            runId,
            provider: 'deepseek',
            model: effectiveModel,
            content,
            finishReason,
            usage: null,
            degraded: false,
            degradedReason: null,
            suggestions: [],
          },
        };
      } catch (error) {
        const isTimeout = error instanceof Error && error.name === 'TimeoutError';
        yield {
          type: 'done',
          response: degradedResponse({
            runId,
            provider: 'deepseek',
            model: effectiveModel,
            reason: isTimeout ? 'timeout' : 'upstream-error',
            partialContent: content,
          }),
        };
      }
    },
  };
}
