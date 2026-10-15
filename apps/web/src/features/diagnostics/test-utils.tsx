/**
 * 诊断面板测试装配（本票自管）。
 *
 * - RTL 自动清理；
 * - 夹具：握手信息、连通性报告（三项各自的状态组合）、事件日志；
 * - 假端口：每个数据源可编程序列 + 失败注入（daemon 不可达态）。
 */
import type {
  ConnectivityReport,
  DaemonHealthResponse,
  TelemetryEvent,
  TelemetryQueryResponse,
} from '@dforge/contracts';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import type { DiagnosticsPort } from './client';

afterEach(() => {
  cleanup();
});

/** 握手信息夹具。 */
export function healthFixture(overrides: Partial<DaemonHealthResponse> = {}): DaemonHealthResponse {
  return {
    name: '@dforge/daemon',
    version: '0.1.0',
    startedAt: '2026-10-15T00:00:00.000Z',
    uptimeMs: 3_723_000,
    dataRoot: '/home/user/.dforge',
    workspaceDir: '/home/user/designs',
    ...overrides,
  };
}

/** 连通性报告夹具（缺省：本机 ok / ComfyUI 不可用 / AI 未配置 —— 未启动+降级态同屏）。 */
export function connectivityFixture(): ConnectivityReport {
  return {
    checkedAt: '2026-10-15T01:00:00.000Z',
    items: [
      {
        id: 'daemon',
        label: '本地服务',
        status: 'ok',
        detail: '运行中（数据目录 /home/user/.dforge）',
        actions: [],
        code: null,
      },
      {
        id: 'comfyui',
        label: 'ComfyUI 出图',
        status: 'unavailable',
        detail: '未检测到本地服务（http://127.0.0.1:59999）',
        actions: ['retry-probe', 'set-base-url'],
        code: 'comfy_unreachable',
      },
      {
        id: 'ai',
        label: 'DeepSeek（文本 AI）',
        status: 'not-configured',
        detail: '未配置 key：AI 功能当前为降级态（不影响编辑与出图）',
        actions: ['configure-credentials'],
        code: null,
      },
    ],
  };
}

/** 事件日志夹具。 */
export function eventsFixture(): TelemetryQueryResponse {
  const events: TelemetryEvent[] = [
    {
      id: 'e1',
      name: 'image.run.submitted',
      at: '2026-10-15T00:00:01.000Z',
      sessionId: null,
      appVersion: null,
      payload: { runId: 'run-1' },
    },
    {
      id: 'e2',
      name: 'ai.degraded',
      at: '2026-10-15T00:00:02.000Z',
      sessionId: null,
      appVersion: null,
      payload: { runId: 'ai_1', degradedReason: 'no-credentials' },
    },
  ];
  return { events, total: events.length };
}

/** 假端口的可观察面。 */
export interface FakeDiagnosticsPort extends DiagnosticsPort {
  readonly connectivityCalls: number;
  readonly healthCalls: number;
  readonly eventsCalls: number;
}

/** 构建假端口；`healthError` 给出时 health 抛错（daemon 不可达）。 */
export function fakeDiagnosticsPort(
  options: {
    health?: DaemonHealthResponse;
    healthError?: Error;
    /** 前 N 次 health 调用失败（之后成功）——用于「不可达 → 重试 → 恢复」。 */
    healthFailures?: number;
    connectivity?: ConnectivityReport;
    events?: TelemetryQueryResponse;
  } = {},
): FakeDiagnosticsPort {
  let healthCalls = 0;
  let connectivityCalls = 0;
  let eventsCalls = 0;
  const port: FakeDiagnosticsPort = {
    get healthCalls() {
      return healthCalls;
    },
    get connectivityCalls() {
      return connectivityCalls;
    },
    get eventsCalls() {
      return eventsCalls;
    },
    async health() {
      healthCalls += 1;
      if (options.healthError !== undefined) throw options.healthError;
      if (healthCalls <= (options.healthFailures ?? 0)) {
        throw new Error('本地服务不可达');
      }
      return await Promise.resolve(options.health ?? healthFixture());
    },
    async connectivity() {
      connectivityCalls += 1;
      if (healthCalls <= (options.healthFailures ?? 0)) {
        throw new Error('本地服务不可达');
      }
      return await Promise.resolve(options.connectivity ?? connectivityFixture());
    },
    async events() {
      eventsCalls += 1;
      if (healthCalls <= (options.healthFailures ?? 0)) {
        throw new Error('本地服务不可达');
      }
      return await Promise.resolve(options.events ?? eventsFixture());
    },
  };
  return port;
}
