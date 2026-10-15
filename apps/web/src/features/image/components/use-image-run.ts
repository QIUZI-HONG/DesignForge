'use client';

/**
 * 出图运行状态（React 侧）——探测 + 提交 + 轮询 + 取消的接线。
 *
 * 纪律：轮询与失败映射都在纯模块（`run.ts` / `failure.ts`）里；这里只做
 * 「调端口 → 起轮询器 → 落 state」与「卸载即停表」。
 */
import type { ComfyProbeResponse, ImageRunInputs, ImageRunStatus } from '@dforge/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ImagePort } from '../client';
import {
  type ComfyFailureView,
  canDowngrade,
  downgradeInputs,
  failureFromStatus,
  failureOf,
} from '../failure';
import { type ImageRunTracker, trackImageRun } from '../run';

/** hook 返回值。 */
export interface UseImageRunResult {
  /** 最近一次探测结果（null = 尚未探测）。 */
  probe: ComfyProbeResponse | null;
  probing: boolean;
  /** 最近一次任务状态（含进度/产出/失败）。 */
  status: ImageRunStatus | null;
  /** 失败视图（提交期异常或任务终态失败）。 */
  failure: ComfyFailureView | null;
  submitting: boolean;
  /** 上一次提交的参数（「降档重试」的基准）。 */
  lastInputs: ImageRunInputs | null;
  submit: (inputs: ImageRunInputs) => void;
  cancel: () => void;
  recheckProbe: () => void;
  /** 以「降一档」的参数重提交（仅 OOM 场景使用）。 */
  downgradeRetry: () => void;
  canDowngrade: boolean;
}

/** 创建出图运行状态。 */
export function useImageRun(options: { port: ImagePort }): UseImageRunResult {
  const { port } = options;
  const [probe, setProbe] = useState<ComfyProbeResponse | null>(null);
  const [probing, setProbing] = useState(false);
  const [status, setStatus] = useState<ImageRunStatus | null>(null);
  const [failure, setFailure] = useState<ComfyFailureView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastInputs, setLastInputs] = useState<ImageRunInputs | null>(null);
  const trackerRef = useRef<ImageRunTracker | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      trackerRef.current?.stop();
    };
  }, []);

  const recheckProbe = useCallback(() => {
    setProbing(true);
    port
      .probe()
      .then((value) => {
        if (mountedRef.current) setProbe(value);
      })
      .catch(() => undefined)
      .finally(() => {
        if (mountedRef.current) setProbing(false);
      });
  }, [port]);

  useEffect(() => {
    recheckProbe();
  }, [recheckProbe]);

  const submit = useCallback(
    (inputs: ImageRunInputs) => {
      trackerRef.current?.stop();
      setLastInputs(inputs);
      setFailure(null);
      setStatus(null);
      setSubmitting(true);
      port
        .submit({ inputs })
        .then((handle) => {
          if (!mountedRef.current) return;
          setStatus({
            runId: handle.runId,
            state: handle.state,
            queuePosition: handle.queuePosition,
            progress: null,
            artifacts: [],
            provenance: null,
            failure: null,
          });
          trackerRef.current = trackImageRun({
            runId: handle.runId,
            port,
            onUpdate: (value) => {
              if (!mountedRef.current) return;
              setStatus(value);
              if (value.state === 'failed' && value.failure !== null) {
                setFailure(failureFromStatus(value.failure));
              }
            },
            onError: (error) => {
              if (mountedRef.current) setFailure(failureOf(error));
            },
          });
        })
        .catch((error: unknown) => {
          if (mountedRef.current) setFailure(failureOf(error));
        })
        .finally(() => {
          if (mountedRef.current) setSubmitting(false);
        });
    },
    [port],
  );

  const cancel = useCallback(() => {
    void trackerRef.current?.cancel();
  }, []);

  const downgradeRetry = useCallback(() => {
    if (lastInputs === null) return;
    submit(downgradeInputs(lastInputs));
  }, [lastInputs, submit]);

  return {
    probe,
    probing,
    status,
    failure,
    submitting,
    lastInputs,
    submit,
    cancel,
    recheckProbe,
    downgradeRetry,
    canDowngrade: lastInputs !== null && canDowngrade(lastInputs),
  };
}
