/**
 * 设置族组件测试夹具（FE-09；`*.test.tsx` 之外的共享件，不参与测试收集）。
 *
 * 期望值一律写死（契约形状 + 中文文案），不按实现口径重算——夹具改一次，
 * 所有断言同源更新，避免各测试文件各写一份漂移的假数据。
 */
import type {
  ConfigResponse,
  ConnectivityReport,
  CredentialSummary,
  DaemonHealthResponse,
  DocumentSummary,
} from '@dforge/contracts';
import { ToastProvider } from '@dforge/ui';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';

import type { SettingsApi } from '../api/settings-api';

/** daemon 归一化后的工作目录（保存响应里回填的形态）。 */
export const NORMALIZED_WORKSPACE = '/home/u/设计';

/** GET /config 夹具。 */
export const CONFIG_RESPONSE: ConfigResponse = {
  config: {
    workspaceDir: '/home/u/设界',
    ai: { provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' },
    comfy: { baseUrl: 'http://127.0.0.1:8188', installPath: null },
    telemetry: { enabled: true },
  },
  credentials: {
    deepseek: {
      provider: 'deepseek',
      hasKey: true,
      maskedKey: 'sk-…wxyz',
      source: 'stored',
      updatedAt: '2026-10-15T00:00:00.000Z',
    },
  },
};

/** GET /health 夹具。 */
export const HEALTH: DaemonHealthResponse = {
  name: 'dforge-daemon',
  version: '0.0.0',
  startedAt: '2026-10-15T00:00:00.000Z',
  uptimeMs: 1000,
  dataRoot: '/home/u/.dforge',
  workspaceDir: '/home/u/设界',
};

/** 连通性报告：ComfyUI 未启动（一等状态）。 */
export const REPORT_COMFY_DOWN: ConnectivityReport = {
  checkedAt: '2026-10-15T00:00:00.000Z',
  items: [
    { id: 'daemon', label: '本地服务', status: 'ok', detail: '运行中', actions: [], code: null },
    {
      id: 'comfyui',
      label: 'ComfyUI 出图',
      status: 'unavailable',
      detail: '未检测到本地服务。',
      actions: ['retry-probe'],
      code: 'comfy_unreachable',
    },
    {
      id: 'ai',
      label: 'DeepSeek（文本 AI）',
      status: 'ok',
      detail: '已配置（sk-…wxyz）',
      actions: [],
      code: null,
    },
  ],
};

/** 连通性报告：ComfyUI 已连接，AI 未配置（降级态）。 */
export const REPORT_COMFY_UP: ConnectivityReport = {
  checkedAt: '2026-10-15T00:00:00.000Z',
  items: [
    { id: 'daemon', label: '本地服务', status: 'ok', detail: '运行中', actions: [], code: null },
    {
      id: 'comfyui',
      label: 'ComfyUI 出图',
      status: 'ok',
      detail: '已连接 http://127.0.0.1:8188',
      actions: [],
      code: null,
    },
    {
      id: 'ai',
      label: 'DeepSeek（文本 AI）',
      status: 'not-configured',
      detail: '未配置 key',
      actions: ['configure-credentials'],
      code: null,
    },
  ],
};

/** 清除凭据后的摘要。 */
export const CLEARED_SUMMARY: CredentialSummary = {
  provider: 'deepseek',
  hasKey: false,
  maskedKey: null,
  source: null,
  updatedAt: null,
};

/** 示例文档（一键示例的创建结果）。 */
export const EXAMPLE_DOC: DocumentSummary = {
  id: '示例设计',
  name: '示例设计',
  directory: '/home/u/设界/示例设计.dfg',
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  pageCount: 1,
  sizeBytes: 128,
};

/** 造一个全量假数据面（逐方法可覆盖）。 */
export function makeApi(overrides: Partial<SettingsApi> = {}): SettingsApi {
  return {
    loadConfig: vi.fn(async () => CONFIG_RESPONSE),
    patchConfig: vi.fn(async () => CONFIG_RESPONSE),
    setApiKey: vi.fn(async () => CONFIG_RESPONSE.credentials.deepseek),
    clearApiKey: vi.fn(async () => CLEARED_SUMMARY),
    checkConnectivity: vi.fn(async () => REPORT_COMFY_DOWN),
    loadHealth: vi.fn(async () => HEALTH),
    listDocuments: vi.fn(async () => ({ documents: [], warnings: [] })),
    createDocument: vi.fn(async () => EXAMPLE_DOC),
    ...overrides,
  };
}

/** 手动结算的 Promise（观察「保存中」这类中间态）。 */
export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 渲染（Toast 与生产同构：根布局已提供 Provider）。 */
export function renderWithToast(element: ReactElement) {
  return render(<ToastProvider>{element}</ToastProvider>);
}
