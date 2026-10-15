/**
 * 出图面板测试装配（本票自管）。
 *
 * - RTL 自动清理（vitest 未开 globals）；
 * - 假端口：probe/templates/submit/status/cancel 全是可编程序列，配合 fake timers 推轮询；
 * - 夹具：任务状态与产出文件。
 */
import type { ComfyProbeResponse, ImageRunHandle, ImageRunStatus } from '@dforge/contracts';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import type { ImagePort } from './client';

afterEach(() => {
  cleanup();
});

/** 任务状态夹具。 */
export function runStatus(overrides: Partial<ImageRunStatus> = {}): ImageRunStatus {
  return {
    runId: 'run-1',
    state: 'queued',
    queuePosition: null,
    progress: null,
    artifacts: [],
    provenance: null,
    failure: null,
    ...overrides,
  };
}

/** 探测响应夹具（缺省 = 已连接，含一个可用 checkpoint）。 */
export function probeOk(): ComfyProbeResponse {
  return {
    reachable: true,
    baseUrl: 'http://127.0.0.1:8188',
    checkedAt: '2026-10-15T00:00:00.000Z',
    models: { checkpoints: ['sd15.safetensors'], loras: [], controlnets: [] },
    device: { name: 'NVIDIA GeForce RTX 4060', vramTotalBytes: 8_589_934_592 },
    failure: null,
  };
}

/** 探测响应夹具（未启动）。 */
export function probeUnreachable(): ComfyProbeResponse {
  return {
    reachable: false,
    baseUrl: 'http://127.0.0.1:59999',
    checkedAt: '2026-10-15T00:00:00.000Z',
    models: null,
    device: null,
    failure: {
      code: 'comfy_unreachable',
      message: '未检测到本地 ComfyUI 服务（http://127.0.0.1:59999）',
      actions: ['retry-probe', 'set-base-url', 'launch'],
      missing: [],
      available: [],
    },
  };
}

/** 假端口的可观察面。 */
export interface FakeImagePort extends ImagePort {
  readonly submittedRequests: unknown[];
  readonly probeCalls: number;
  readonly cancelCalls: number;
}

/**
 * 假端口：`statusSequence` 是轮询返回的状态序列（序列耗尽后保持最后一个）；
 * `submitError` 给出时 submit 直接抛错（未启动/缺模型等提交期失败）。
 */
export function fakeImagePort(options: {
  probeSequence?: ComfyProbeResponse[];
  statusSequence?: ImageRunStatus[];
  submitError?: Error;
}): FakeImagePort {
  let probeCalls = 0;
  let cancelCalls = 0;
  let statusIndex = 0;
  const submittedRequests: unknown[] = [];
  const statusSequence = options.statusSequence ?? [runStatus()];
  const probeSequence = options.probeSequence ?? [probeOk()];
  const port: FakeImagePort = {
    get submittedRequests() {
      return submittedRequests;
    },
    get probeCalls() {
      return probeCalls;
    },
    get cancelCalls() {
      return cancelCalls;
    },
    async probe() {
      const index = Math.min(probeCalls, probeSequence.length - 1);
      probeCalls += 1;
      const value = probeSequence[index];
      if (value === undefined) throw new Error('缺少探测夹具');
      return await Promise.resolve(value);
    },
    async templates() {
      return { templates: [], defaultTemplateId: 'default-txt2img' };
    },
    async submit(request) {
      submittedRequests.push(request);
      if (options.submitError !== undefined) throw options.submitError;
      const handle: ImageRunHandle = {
        runId: 'run-1',
        state: 'queued',
        queuePosition: null,
        etaMsHint: null,
      };
      return await Promise.resolve(handle);
    },
    async status() {
      const index = Math.min(statusIndex, statusSequence.length - 1);
      statusIndex += 1;
      const value = statusSequence[index];
      if (value === undefined) throw new Error('缺少状态夹具');
      return await Promise.resolve(value);
    },
    async cancel() {
      cancelCalls += 1;
      const value = runStatus({ state: 'canceled' });
      return await Promise.resolve(value);
    },
  };
  return port;
}
