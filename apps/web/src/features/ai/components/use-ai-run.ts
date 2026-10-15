'use client';

/**
 * AI 运行状态（React 侧）——把端口 + 适配层接成组件可订阅的 state。
 *
 * 纪律：状态机与流式解析都在纯模块（`steps.ts` / `stream.ts`）里，这里只负责
 * 「发起请求 → 把文本块喂给阅读器 → 落 state」与「卸载即中止」。
 */
import type { AiStatusResponse } from '@dforge/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AiPort } from '../client';
import { type AiRunState, initialAiRun } from '../steps';
import { type AiRunReader, type AiStreamUpdate, createAiRunReader } from '../stream';

/** hook 返回值。 */
export interface UseAiRunResult {
  /** 当前运行状态（步骤流 / 降级标记 / 结果 / 错误）。 */
  state: AiRunState;
  /** `/ai/status`（未配置时含降级提示；失败为 null，不阻塞抽屉可用）。 */
  status: AiStatusResponse | null;
  /** 提交一次生成（运行中忽略）。 */
  submit: (prompt: string) => void;
  /** 失败后重试（沿用上一次输入）。 */
  retry: () => void;
}

/** 创建 AI 运行状态（port 可注入：测试与门禁用假端口）。 */
export function useAiRun(options: { port: AiPort }): UseAiRunResult {
  const { port } = options;
  const [state, setState] = useState<AiRunState>(initialAiRun);
  const [status, setStatus] = useState<AiStatusResponse | null>(null);
  const readerRef = useRef<AiRunReader | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const promptRef = useRef<string>('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    port
      .status(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setStatus(value);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [port]);

  const apply = useCallback((updates: AiStreamUpdate[]) => {
    if (updates.length === 0) return;
    const last = updates[updates.length - 1];
    if (last !== undefined) setState(last.state);
  }, []);

  const run = useCallback(
    (prompt: string) => {
      const reader = createAiRunReader();
      readerRef.current = reader;
      promptRef.current = prompt;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState(reader.begin().state);

      void (async () => {
        try {
          for await (const chunk of port.chatStream(
            { messages: [{ role: 'user', content: prompt }] },
            controller.signal,
          )) {
            if (controller.signal.aborted || !mountedRef.current) return;
            apply(reader.pushText(chunk));
          }
          if (!mountedRef.current) return;
          // 流结束但未收到 done 帧（连接被提前掐断）：显式落到失败态，避免停在假活动步
          if (reader.snapshot().phase === 'running') {
            apply([reader.fail('流式通道提前关闭')]);
          }
        } catch (error) {
          if (controller.signal.aborted || !mountedRef.current) return;
          apply([reader.fail(error instanceof Error ? error.message : '请求失败')]);
        }
      })();
    },
    [apply, port],
  );

  const submit = useCallback(
    (prompt: string) => {
      if (state.phase === 'running') return;
      const trimmed = prompt.trim();
      if (trimmed.length === 0) return;
      run(trimmed);
    },
    [run, state.phase],
  );

  const retry = useCallback(() => {
    if (state.phase !== 'failed') return;
    const prompt = promptRef.current;
    if (prompt.length === 0) {
      // 没有可用的上一次输入：直接从初始态重开（等价于清空后重新提交）
      setState(initialAiRun());
      return;
    }
    const reader = readerRef.current;
    if (reader === null) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState(reader.retry().state);
    void (async () => {
      try {
        for await (const chunk of port.chatStream(
          { messages: [{ role: 'user', content: prompt }] },
          controller.signal,
        )) {
          if (controller.signal.aborted || !mountedRef.current) return;
          apply(reader.pushText(chunk));
        }
        if (!mountedRef.current) return;
        if (reader.snapshot().phase === 'running') {
          apply([reader.fail('流式通道提前关闭')]);
        }
      } catch (error) {
        if (controller.signal.aborted || !mountedRef.current) return;
        apply([reader.fail(error instanceof Error ? error.message : '请求失败')]);
      }
    })();
  }, [apply, port, state.phase]);

  return { state, status, submit, retry };
}
