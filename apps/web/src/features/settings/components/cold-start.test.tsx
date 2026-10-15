// @vitest-environment jsdom
/**
 * 空库冷启动组件测试（FE-09 · 清单 E6）。
 *
 * 断言角度：空库判定（空 → 空态；非空 → 「已有 N 个文件」分流）、
 * 一键示例（创建文档 → 进入编辑器）、daemon 未启动的明确错误态与重试、
 * 创建失败的失败提示与再次尝试。
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DaemonClientError } from '../api/daemon-client';
import type { SettingsApi } from '../api/settings-api';

import { ColdStart } from './cold-start';
import { EXAMPLE_DOC, makeApi, renderWithToast } from './settings-fixtures';

/** 渲染冷启动页。 */
function renderColdStart(api: SettingsApi, onEnterEditor: (id: string) => void) {
  return renderWithToast(<ColdStart api={api} onEnterEditor={onEnterEditor} />);
}

describe('空库冷启动', () => {
  it('加载期有 loading 挂点；空库 → 空态（empty 挂点 + 一键示例主按钮）', async () => {
    const api = makeApi();
    const { container } = renderColdStart(api, vi.fn());
    expect(container.querySelector('[data-df-state="loading"]')).not.toBeNull();

    expect(await screen.findByText('还没有文件')).toBeTruthy();
    expect(screen.getByText('先创建一个示例文件看看编辑器，之后可以随时删除。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '一键示例' })).toBeTruthy();
    expect(container.querySelector('[data-df-state="empty"]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: '欢迎使用设界' })).toBeTruthy();
  });

  it('一键示例：创建示例文档 → 进入编辑器（携带文档 id）', async () => {
    const api = makeApi();
    const onEnterEditor = vi.fn();
    const user = userEvent.setup();
    renderColdStart(api, onEnterEditor);

    await user.click(await screen.findByRole('button', { name: '一键示例' }));

    expect(api.createDocument).toHaveBeenCalledWith('示例设计');
    expect(onEnterEditor).toHaveBeenCalledWith('示例设计');
  });

  it('daemon 未启动：明确错误态（error 挂点 + 文案 + 重试），重试可恢复', async () => {
    const listDocuments = vi
      .fn<SettingsApi['listDocuments']>()
      .mockRejectedValueOnce(
        new DaemonClientError({
          kind: 'network',
          message: '无法连接本地服务（http://127.0.0.1:4318）',
        }),
      )
      .mockResolvedValueOnce({ documents: [], warnings: [] });
    const api = makeApi({ listDocuments });
    const user = userEvent.setup();
    const { container } = renderColdStart(api, vi.fn());

    expect(
      await screen.findByText('示例文件由本地服务创建。请先启动本地服务（daemon）再重试。'),
    ).toBeTruthy();
    expect(screen.getByText('无法连接本地服务（http://127.0.0.1:4318）')).toBeTruthy();
    expect(container.querySelector('[data-df-state="error"]')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('还没有文件')).toBeTruthy();
  });

  it('创建失败：原样展示失败文案，再点「一键示例」可重试成功', async () => {
    const createDocument = vi
      .fn<SettingsApi['createDocument']>()
      .mockRejectedValueOnce(
        new DaemonClientError({
          kind: 'api',
          code: 'doc_invalid_name',
          message: '文档名不合法',
          status: 400,
        }),
      )
      .mockResolvedValueOnce(EXAMPLE_DOC);
    const api = makeApi({ createDocument });
    const onEnterEditor = vi.fn();
    const user = userEvent.setup();
    renderColdStart(api, onEnterEditor);

    await user.click(await screen.findByRole('button', { name: '一键示例' }));
    expect(await screen.findByText('创建示例失败：文档名不合法')).toBeTruthy();
    expect(onEnterEditor).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '一键示例' }));
    expect(onEnterEditor).toHaveBeenCalledWith('示例设计');
  });

  it('库中已有文件：分流提示（不出现空态与一键示例）', async () => {
    const api = makeApi({
      listDocuments: vi.fn(async () => ({ documents: [EXAMPLE_DOC], warnings: [] })),
    });
    renderColdStart(api, vi.fn());

    expect(await screen.findByText('本地已有 1 个文件')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '一键示例' })).toBeNull();
    expect(screen.getByRole('link', { name: '返回首页' }).getAttribute('href')).toBe('/');
  });

  it('示例已存在（重按一键示例）：不报错，直接打开既有示例文档', async () => {
    const createDocument = vi.fn<SettingsApi['createDocument']>().mockRejectedValueOnce(
      new DaemonClientError({
        kind: 'api',
        code: 'doc_exists',
        message: '同名文档已存在',
        status: 409,
      }),
    );
    const api = makeApi({
      createDocument,
      // 第二次查询要能看到已存在的示例（首次判定空库时为空）
      listDocuments: vi
        .fn<SettingsApi['listDocuments']>()
        .mockResolvedValueOnce({ documents: [], warnings: [] })
        .mockResolvedValueOnce({ documents: [EXAMPLE_DOC], warnings: [] }),
    });
    const onEnterEditor = vi.fn();
    const user = userEvent.setup();
    renderColdStart(api, onEnterEditor);

    await user.click(await screen.findByRole('button', { name: '一键示例' }));

    expect(onEnterEditor).toHaveBeenCalledWith('示例设计');
    expect(screen.queryByText(/创建示例失败/)).toBeNull();
  });

  it('缺省跳转（未注入 onEnterEditor）：地址形状与 FE-02 首页一致（?documentId=）', async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign },
    });
    try {
      const user = userEvent.setup();
      renderWithToast(<ColdStart api={makeApi()} />);
      await user.click(await screen.findByRole('button', { name: '一键示例' }));
      expect(assign).toHaveBeenCalledWith(
        '/editor?documentId=%E7%A4%BA%E4%BE%8B%E8%AE%BE%E8%AE%A1',
      );
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});
