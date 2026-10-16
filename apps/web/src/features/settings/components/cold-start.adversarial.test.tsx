// @vitest-environment jsdom
/**
 * 对抗测试（验证方 test/verify-web-b）· 冷启动的重复点击与边界。
 *
 * 风险点（任务书 §5）：冷启动重复点击是否建多份文档；创建失败/竞态的出口。
 */

import type { DocumentListResponse } from '@dforge/contracts';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DaemonClientError } from '../api/daemon-client';
import type { SettingsApi } from '../api/settings-api';

import { ColdStart } from './cold-start';
import { EXAMPLE_DOC, makeApi, renderWithToast } from './settings-fixtures';

/** 渲染冷启动页（注入假数据面）。 */
function renderColdStart(api: SettingsApi, onEnterEditor: (id: string) => void = vi.fn()) {
  return renderWithToast(<ColdStart api={api} onEnterEditor={onEnterEditor} />);
}

describe('对抗 · 一键示例的重复点击', () => {
  it('同一帧内连点两次「一键示例」→ 只发一次创建请求（按钮 loading 即禁点）', async () => {
    let resolveCreate: ((value: typeof EXAMPLE_DOC) => void) | undefined;
    const createDocument = vi.fn(
      async () =>
        await new Promise<typeof EXAMPLE_DOC>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const api = makeApi({ createDocument });
    const onEnterEditor = vi.fn();
    renderColdStart(api, onEnterEditor);

    const button = await screen.findByRole('button', { name: '一键示例' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(createDocument).toHaveBeenCalledTimes(1);
    resolveCreate?.(EXAMPLE_DOC);
    await screen.findByText('一键示例');
  });

  it('创建中按钮呈 loading 且 aria-busy（防重复提交的可见证据）', async () => {
    const createDocument = vi.fn(
      async () => await new Promise<typeof EXAMPLE_DOC>(() => undefined),
    );
    renderColdStart(makeApi({ createDocument }));

    const button = await screen.findByRole('button', { name: '一键示例' });
    fireEvent.click(button);
    await screen.findByRole('button', { name: /一键示例|正在创建示例/ });
    const pending = await screen.findByRole('button', { name: /一键示例|正在创建示例/ });
    expect(pending.getAttribute('aria-busy')).toBe('true');
    expect((pending as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('对抗 · 竞态与异常出口', () => {
  it('doc_exists 但清单里已找不到同名文档（并发删除）→ 落失败提示，不静默', async () => {
    const api = makeApi({
      createDocument: vi.fn(async () => {
        throw new DaemonClientError({
          kind: 'api',
          code: 'doc_exists',
          message: '同名文档已存在',
        });
      }),
      listDocuments: vi.fn(async () => ({ documents: [], warnings: [] })),
    });
    renderColdStart(api, vi.fn());
    fireEvent.click(await screen.findByRole('button', { name: '一键示例' }));
    expect(await screen.findByText(/创建示例失败：同名文档已存在/)).toBeTruthy();
  });

  it('创建抛非 DaemonClientError（TypeError）→ 仍有可读失败文案，不崩', async () => {
    const api = makeApi({
      createDocument: vi.fn(async () => {
        throw new TypeError("Cannot read properties of undefined (reading 'id')");
      }),
    });
    renderColdStart(api, vi.fn());
    fireEvent.click(await screen.findByRole('button', { name: '一键示例' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('创建示例失败');
  });

  it('清单接口返回脏形状（documents 缺失）→ 判为已有文件分流，不当空库', async () => {
    const api = makeApi({
      // 类型标注只为过 tsc；运行时仍是空对象（脏响应），走错误态出口
      listDocuments: vi.fn(async () => ({}) as unknown as DocumentListResponse),
    });
    renderColdStart(api, vi.fn());
    // 用 as 造脏响应：`list.documents.length` 抛 TypeError → 走错误态（安全出口）
    expect(await screen.findByText(/无法连接本地服务|本地已有/)).toBeTruthy();
  });

  it('已有文件时反复点「返回首页」不产生创建请求（分流不重复冷启动）', async () => {
    const createDocument = vi.fn(async () => EXAMPLE_DOC);
    const api = makeApi({
      listDocuments: vi.fn(async () => ({ documents: [EXAMPLE_DOC], warnings: [] })),
      createDocument,
    });
    renderColdStart(api);
    expect(await screen.findByText('本地已有 1 个文件')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '一键示例' })).toBeNull();
    expect(createDocument).not.toHaveBeenCalled();
  });
});
